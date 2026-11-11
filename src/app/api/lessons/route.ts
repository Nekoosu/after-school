import { all, get, run, tx } from "@/db";
import type { LessonWithStudents } from "@/db/types";
import { fail, ok } from "@/lib/http";
import { findConflicts } from "@/lib/conflicts";
import { parseLocal, toDateTimeStr } from "@/lib/dates";
import { mdText } from "@/lib/format";

export const dynamic = "force-dynamic";

/** 某时间段内的课（含参与学生名） */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from") || "0000-01-01";
    const to = url.searchParams.get("to") || "9999-12-31";
    const rows = all<LessonWithStudents>(
      `select l.*, coalesce(l.teacher_id, c.teacher_id) as teacher_id,
        c.name as course_name, c.color as course_color, t.name as teacher_name,
        (select group_concat(s.name, '、') from lesson_student ls join student s on s.id = ls.student_id
          where ls.lesson_id = l.id) as student_names,
        (select group_concat(ls.student_id, ',') from lesson_student ls
          where ls.lesson_id = l.id) as student_ids
       from lesson l join course c on c.id = l.course_id
       left join teacher t on t.id = coalesce(l.teacher_id, c.teacher_id)
       where l.start_at >= ? and l.start_at <= ?
       order by l.start_at asc`,
      [from, to],
    );
    return ok(rows);
  } catch (e) {
    return fail(e, 500);
  }
}

/**
 * 新建一次课（排课）。
 * b.repeatWeeks > 1 时按周重复排（同一个星期几、同一个时间），一共排 N 周。
 */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const courseId = Number(b.courseId);
    const startAt = String(b.startAt ?? "").trim();
    const minutes = Number(b.minutes) || 90;
    const repeatWeeks = Math.max(1, Math.min(26, Number(b.repeatWeeks) || 1));
    const studentIds: number[] = Array.isArray(b.studentIds)
      ? b.studentIds.map(Number).filter(Boolean)
      : [];

    if (!courseId) return fail("请选择课程");
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(startAt)) return fail("上课时间格式应为 YYYY-MM-DD HH:mm");
    if (studentIds.length === 0) return fail("至少选一个学生");
    if (minutes <= 0) return fail("时长必须大于 0");

    const course = get<{ id: number; teacher_id: number | null }>(
      "select id, teacher_id from course where id = ?",
      [courseId],
    );
    if (!course) return fail("课程不存在", 404);

    // 老师：排课时显式指定优先，否则用这门课默认的老师
    const teacherId = b.teacherId ? Number(b.teacherId) : (course.teacher_id ?? null);
    const pricePerHour = b.pricePerHour === 0 || b.pricePerHour ? Number(b.pricePerHour) : null;
    if (pricePerHour !== null && (!Number.isFinite(pricePerHour) || pricePerHour < 0)) {
      return fail("课消单价得是正数");
    }

    // 重复排课：第一次就是 startAt 本身，之后每次 +7 天，时间不变
    const starts: string[] = [];
    for (let i = 0; i < repeatWeeks; i++) {
      if (i === 0) starts.push(startAt);
      else {
        const d = parseLocal(startAt);
        d.setDate(d.getDate() + i * 7);
        starts.push(toDateTimeStr(d));
      }
    }

    const allConflicts = starts.flatMap((s) => findConflicts(studentIds, s, minutes, 0, teacherId));
    if (allConflicts.length > 0 && !b.force) {
      const detail = allConflicts
        .slice(0, 4)
        .map((c) => `${mdText(c.start_at.slice(0, 10))} ${c.start_at.slice(11)}「${c.title}」${c.kind === "teacher" ? "（这位老师）" : `（${c.who}）`}`)
        .join("；");
      const more = allConflicts.length > 4 ? ` 等 ${allConflicts.length} 处` : "";
      return Response.json(
        { error: `时间冲突：${detail}${more}`, conflicts: allConflicts },
        { status: 409 },
      );
    }

    const status = b.status === "makeup" ? "makeup" : "planned";

    const ids = tx(() => {
      const created: number[] = [];
      for (const s of starts) {
        const r = run(
          `insert into lesson (course_id, class_id, plan_id, teacher_id, title, start_at, minutes, room, status, price_per_hour)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            courseId,
            b.classId ?? null,
            b.planId ? Number(b.planId) : null,
            teacherId,
            b.title ?? null,
            s,
            minutes,
            b.room ?? null,
            status,
            pricePerHour,
          ],
        );
        const lessonId = Number(r.lastInsertRowid);
        for (const sid of studentIds) {
          run(`insert or ignore into lesson_student (lesson_id, student_id) values (?, ?)`, [lessonId, sid]);
        }
        created.push(lessonId);
      }
      return created;
    });

    const first = get<LessonWithStudents>("select * from lesson where id = ?", [ids[0]]);
    return ok({ ...first, ids, count: ids.length }, 201);
  } catch (e) {
    return fail(e);
  }
}
