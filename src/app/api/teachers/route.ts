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
    // 课可能没写 teacher_id（早期排的、或直接挂在课程上），一律 coalesce 回课程的老师
    const own = "coalesce(l.teacher_id, c3.teacher_id) = t.id and l.status <> 'cancelled'";
    const rows = all<TeacherWithStats>(
      `select t.*,
        (select group_concat(c.name, '、') from course c where c.teacher_id = t.id) as course_names,
        (select count(distinct ls.student_id) from lesson l
           join lesson_student ls on ls.lesson_id = l.id
           join course c3 on c3.id = l.course_id
          where ${own}) as student_count,
        (select count(*) from lesson l
           join course c3 on c3.id = l.course_id
          where ${own} and l.start_at >= ? and l.start_at < ?) as week_lessons,
        (select coalesce(sum(l.minutes), 0) from lesson l
           join course c3 on c3.id = l.course_id
          where ${own} and l.start_at >= ? and l.start_at < ?) as week_minutes
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
