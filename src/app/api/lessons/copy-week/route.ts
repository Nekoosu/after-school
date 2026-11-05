import { all, run, tx } from "@/db";
import { fail, ok } from "@/lib/http";
import { findConflicts } from "@/lib/conflicts";
import { isDayStr, parseLocal, toDateTimeStr } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * POST /api/lessons/copy-week { from, to }
 * 把 from~to（一般是一周）里的 planned/makeup 课原样复制到 7 天后：
 * 同一时间、同课程、同学生、同时长。有冲突的那一节直接跳过，最后汇报。
 * 用途：每周的课基本一样，排一周复制一周，不用一节一节点。
 */
export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    const from = String(b.from ?? "").trim();
    const to = String(b.to ?? "").trim();
    if (!isDayStr(from) || !isDayStr(to)) return fail("日期格式应为 YYYY-MM-DD，且要是真实存在的日期");
    if (from > to) return fail("from 不能晚于 to");
    // 只允许复制 31 天以内，防止把整库复制一遍
    const spanDays = Math.round((parseLocal(`${to} 00:00`).getTime() - parseLocal(`${from} 00:00`).getTime()) / 86400000);
    if (spanDays > 30) return fail("一次最多复制 31 天内的课");

    const src = all<{
      id: number;
      course_id: number;
      class_id: number | null;
      plan_id: number | null;
      title: string | null;
      start_at: string;
      minutes: number;
      room: string | null;
      status: string;
      student_ids: string | null;
    }>(
      `select l.*, (select group_concat(ls.student_id, ',') from lesson_student ls where ls.lesson_id = l.id) as student_ids
       from lesson l
       where substr(l.start_at, 1, 10) between ? and ? and l.status in ('planned', 'makeup')
       order by l.start_at asc`,
      [from, to],
    );

    const skipped: string[] = [];
    let copied = 0;

    tx(() => {
      for (const l of src) {
        const d = parseLocal(l.start_at);
        d.setDate(d.getDate() + 7);
        const newStart = toDateTimeStr(d);
        const ids = (l.student_ids ?? "").split(",").map(Number).filter(Boolean);
        if (ids.length === 0) {
          skipped.push(`${l.start_at}「${l.title || "未命名"}」没有学生`);
          continue;
        }
        const conflicts = findConflicts(ids, newStart, l.minutes);
        if (conflicts.length > 0) {
          skipped.push(`${newStart}「${l.title || "未命名"}」与「${conflicts[0].title}」冲突`);
          continue;
        }
        const r = run(
          `insert into lesson (course_id, class_id, plan_id, title, start_at, minutes, room, status)
           values (?, ?, ?, ?, ?, ?, ?, 'planned')`,
          [l.course_id, l.class_id, l.plan_id, l.title, newStart, l.minutes, l.room],
        );
        const newId = Number(r.lastInsertRowid);
        for (const sid of ids) {
          run(`insert or ignore into lesson_student (lesson_id, student_id) values (?, ?)`, [newId, sid]);
        }
        copied += 1;
      }
    });

    return ok({ copied, skipped: skipped.length, skippedTitles: skipped.slice(0, 6) });
  } catch (e) {
    return fail(e);
  }
}
