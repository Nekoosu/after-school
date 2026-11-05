import { all } from "@/db";
import { guard } from "@/lib/apikeys";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 某时间段的课表（含参与学生名）。需要令牌。 */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from") || "0000-01-01";
    const to = url.searchParams.get("to") || "9999-12-31";
    const rows = all<Record<string, unknown>>(
      `select l.id, l.title, l.start_at, l.minutes, l.room, l.status, l.note,
              c.name as course_name,
              (select group_concat(s.name, '、') from lesson_student ls join student s on s.id = ls.student_id
                where ls.lesson_id = l.id) as student_names,
              (select group_concat(ls.student_id, ',') from lesson_student ls
                where ls.lesson_id = l.id) as student_ids
       from lesson l join course c on c.id = l.course_id
       where l.start_at >= ? and l.start_at <= ?
       order by l.start_at asc`,
      [from, to],
    );
    return ok({ from, to, count: rows.length, lessons: rows });
  } catch (e) {
    return fail(e, 500);
  }
}
