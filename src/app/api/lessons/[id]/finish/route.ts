import { all, get, run, tx } from "@/db";
import type { LessonRow } from "@/db/types";
import { fail, ok } from "@/lib/http";
import { billedMinutes } from "@/lib/hours";
import { resolvePrice } from "@/lib/pricing";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

interface FinishItem {
  studentId: number;
  status: "present" | "leave" | "absent" | "makeup";
  note?: string | null;
  topic?: string | null;
  level?: number | null;
}

/**
 * 下课记一笔（核心写操作，必须在一个事务里）
 * - 更新 lesson.status = 'done'
 * - 每个学生一条 attendance
 * - present / makeup 才扣课时，写 hours_ledger（负数）
 * - 有 note 内容才写 note 表
 * 幂等保护：已 done 的课不允许重复提交
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const id = Number((await ctx.params).id);
    const lesson = get<LessonRow>("select * from lesson where id = ?", [id]);
    if (!lesson) return fail("这节课不存在", 404);
    if (lesson.status === "done") return fail("这节课已经记过账了，不能重复提交", 409);

    const body = await req.json();
    const items: FinishItem[] = Array.isArray(body.items) ? body.items : [];
    const enrolled = all<{ student_id: number }>(
      "select student_id from lesson_student where lesson_id = ?",
      [id],
    ).map((r) => r.student_id);
    if (enrolled.length === 0) return fail("这节课还没有学生");

    // 以这节课的学生名单为准，缺省按到课处理
    const byStudent = new Map<number, FinishItem>();
    for (const it of items) byStudent.set(Number(it.studentId), it);

    const result = tx(() => {
      let billedTotal = 0;
      let noteCount = 0;
      let chargeTotal = 0;
      const charged: Array<{ studentId: number; billed: number; amount: number | null; unitPrice: number | null }> = [];

      for (const sid of enrolled) {
        const it = byStudent.get(sid) ?? { studentId: sid, status: "present" as const };
        const billed = billedMinutes(it.status, lesson.minutes);
        billedTotal += billed;

        // 课消：单价按「这节课指定 → 学生买的价 → 课程标价」取，金额当快照写进流水
        const price = resolvePrice(sid, lesson.course_id, lesson.price_per_hour, billed);
        if (price.amount) chargeTotal += price.amount;
        charged.push({ studentId: sid, billed, amount: price.amount, unitPrice: price.unitPrice });

        run(
          `insert into attendance (lesson_id, student_id, status, billed_minutes, note)
           values (?, ?, ?, ?, ?)
           on conflict(lesson_id, student_id) do update set
             status = excluded.status,
             billed_minutes = excluded.billed_minutes,
             note = excluded.note`,
          [id, sid, it.status, billed, it.note ?? null],
        );

        if (billed > 0) {
          run(
            `insert into hours_ledger (student_id, course_id, delta_minutes, kind, ref_id, remark, unit_price, amount)
             values (?, ?, ?, 'consume', ?, ?, ?, ?)`,
            [sid, lesson.course_id, -billed, id, it.note ?? null, price.unitPrice, price.amount],
          );
        }

        if (it.note && it.note.trim()) {
          run(
            `insert into note (student_id, lesson_id, kind, topic, level, content) values (?, ?, 'progress', ?, ?, ?)`,
            [sid, id, it.topic ?? null, it.level ?? null, it.note.trim()],
          );
          noteCount++;
        }
      }

      run(
        "update lesson set status = 'done', updated_at = datetime('now','localtime') where id = ?",
        [id],
      );
      return { billedTotal, noteCount, students: enrolled.length, chargeTotal, charged };
    });

    return ok({ ok: true, ...result });
  } catch (e) {
    return fail(e);
  }
}
