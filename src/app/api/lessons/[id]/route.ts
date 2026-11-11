import { all, get, run, tx } from "@/db";
import type { LessonRow, NoteRow } from "@/db/types";
import { fail, ok } from "@/lib/http";
import { findConflicts } from "@/lib/conflicts";
import { resolvePrice } from "@/lib/pricing";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 单次课详情：课程、老师、学生、出勤、本次笔记、每人这节的课消预估 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const id = Number((await ctx.params).id);
    const lesson = get<LessonRow & { course_name: string; teacher_name: string | null }>(
      `select l.*, c.name as course_name, t.name as teacher_name
         from lesson l join course c on c.id = l.course_id
         left join teacher t on t.id = l.teacher_id
        where l.id = ?`,
      [id],
    );
    if (!lesson) return fail("这节课不存在", 404);

    const students = all<{
      student_id: number;
      name: string;
      grade: string | null;
      balance_minutes: number | null;
      att_status: string | null;
      billed_minutes: number | null;
      att_note: string | null;
    }>(
      `select ls.student_id, s.name, s.grade, b.balance_minutes,
              a.status as att_status, a.billed_minutes, a.note as att_note
       from lesson_student ls
       join student s on s.id = ls.student_id
       left join v_student_balance b on b.student_id = s.id
       left join attendance a on a.lesson_id = ls.lesson_id and a.student_id = ls.student_id
       where ls.lesson_id = ?
       order by s.name`,
      [id],
    );

    // 每人这节课大概扣多少钱（还没记账时给个预估值，记完了就显示真实值）
    const charged = all<{ student_id: number; amount: number | null; unit_price: number | null; delta_minutes: number }>(
      "select student_id, amount, unit_price, delta_minutes from hours_ledger where kind = 'consume' and ref_id = ?",
      [id],
    );
    const chargedMap = new Map(charged.map((c) => [c.student_id, c]));
    const withPrice = students.map((s) => {
      const real = chargedMap.get(s.student_id);
      if (real) {
        return {
          ...s,
          unit_price: real.unit_price,
          charge_amount: real.amount ?? 0,
          charge_estimate: false,
        };
      }
      const est = resolvePrice(s.student_id, lesson.course_id, lesson.price_per_hour, lesson.minutes);
      return { ...s, unit_price: est.unitPrice, charge_amount: est.amount ?? 0, charge_estimate: true };
    });

    const notes = all<NoteRow>("select * from note where lesson_id = ? order by id", [id]);

    return ok({ lesson, students: withPrice, notes });
  } catch (e) {
    return fail(e, 500);
  }
}

/** 改时间/标题/时长/教室，或取消 */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const id = Number((await ctx.params).id);
    const lesson = get<LessonRow>("select * from lesson where id = ?", [id]);
    if (!lesson) return fail("这节课不存在", 404);
    if (lesson.status === "done") return fail("已上完的课不能修改，请先联系管理员调整流水");

    const b = await req.json();
    const startAt = b.startAt ? String(b.startAt) : lesson.start_at;
    const minutes = b.minutes ? Number(b.minutes) : lesson.minutes;

    // 改时间/时长/老师 → 重跑冲突检测
    if (b.startAt || b.minutes || b.teacherId !== undefined) {
      const ids = all<{ student_id: number }>(
        "select student_id from lesson_student where lesson_id = ?",
        [id],
      ).map((r) => r.student_id);
      const teacherId =
        b.teacherId === undefined ? lesson.teacher_id : b.teacherId ? Number(b.teacherId) : null;
      const conflicts = findConflicts(ids, startAt, minutes, id, teacherId);
      if (conflicts.length > 0 && !b.force) {
        return Response.json(
          {
            error: `时间冲突：${conflicts
              .map((c) => (c.kind === "teacher" ? `${c.who} 这个时段还有「${c.title}」` : `${c.who} 已有课`))
              .join("；")}`,
            conflicts,
          },
          { status: 409 },
        );
      }
    }

    const fields: string[] = [];
    const params: unknown[] = [];
    const map: Record<string, string> = {
      title: "title",
      startAt: "start_at",
      minutes: "minutes",
      room: "room",
      note: "note",
      status: "status",
      teacherId: "teacher_id",
      pricePerHour: "price_per_hour",
    };
    for (const [key, col] of Object.entries(map)) {
      if (b[key] !== undefined) {
        fields.push(`${col} = ?`);
        if (key === "teacherId") params.push(b[key] ? Number(b[key]) : null);
        else if (key === "pricePerHour") params.push(b[key] === "" || b[key] === null ? null : Number(b[key]));
        else params.push(b[key] === "" ? null : b[key]);
      }
    }
    if (fields.length === 0) return fail("没有要修改的字段");
    if (b.status && !["planned", "cancelled", "makeup"].includes(b.status)) {
      return fail("状态只能是 planned / cancelled / makeup");
    }
    fields.push("updated_at = datetime('now','localtime')");
    params.push(id);
    run(`update lesson set ${fields.join(", ")} where id = ?`, params);
    return ok(get<LessonRow>("select * from lesson where id = ?", [id]));
  } catch (e) {
    return fail(e);
  }
}

/** 删除（已上完的课有流水，不允许删） */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const id = Number((await ctx.params).id);
    const lesson = get<LessonRow>("select * from lesson where id = ?", [id]);
    if (!lesson) return fail("这节课不存在", 404);
    if (lesson.status === "done") return fail("已上完的课已产生课时流水，不能删除");
    tx(() => {
      run("delete from lesson_student where lesson_id = ?", [id]);
      run("delete from attendance where lesson_id = ?", [id]);
      run("update note set lesson_id = null where lesson_id = ?", [id]);
      run("delete from lesson where id = ?", [id]);
    });
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
