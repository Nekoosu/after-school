import { all, get, run, tx } from "@/db";
import type { TeacherWithStats } from "@/db/types";
import { fail, ok } from "@/lib/http";
import { toDateStr } from "@/lib/dates";

export const dynamic = "force-dynamic";

function weekRange(): { from: string; to: string } {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // 周一为 0
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 7);
  return { from: toDateStr(mon), to: toDateStr(sun) };
}

/** 老师列表（带任教课程、学生数、本周课时） */
export async function GET() {
  try {
    const { from, to } = weekRange();
    const rows = all<TeacherWithStats>(
      `select t.*,
        (select group_concat(c.name, '、') from course c where c.teacher_id = t.id) as course_names,
        (select count(distinct e.student_id) from enrollment e
           join course c2 on c2.id = e.course_id
          where c2.teacher_id = t.id and e.status = 'active') as student_count,
        (select count(*) from lesson l
          where l.teacher_id = t.id and l.status <> 'cancelled'
            and l.start_at >= ? and l.start_at < ?) as week_lessons,
        (select coalesce(sum(l.minutes), 0) from lesson l
          where l.teacher_id = t.id and l.status <> 'cancelled'
            and l.start_at >= ? and l.start_at < ?) as week_minutes
       from teacher t
       order by (t.status = 'active') desc, t.name asc`,
      [from, to, from, to],
    );
    return ok(rows);
  } catch (e) {
    return fail(e, 500);
  }
}

/** 新增老师 */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const name = String(b.name ?? "").trim();
    if (!name) return fail("先给老师起个名字");
    if (name.length > 20) return fail("名字太长了，20 个字以内");
    const courseIds: number[] = Array.isArray(b.courseIds) ? b.courseIds.map(Number).filter(Boolean) : [];

    const id = tx(() => {
      const r = run(
        `insert into teacher (name, phone, subject, color, note) values (?, ?, ?, ?, ?)`,
        [name, b.phone ?? null, b.subject ?? null, b.color ?? "#7c5cff", b.note ?? null],
      );
      const tid = Number(r.lastInsertRowid);
      for (const cid of courseIds) {
        run("update course set teacher_id = ? where id = ?", [tid, cid]);
      }
      return tid;
    });

    const row = get("select * from teacher where id = ?", [id]);
    return ok(row, 201);
  } catch (e) {
    return fail(e);
  }
}
