import { all, get, run, tx } from "@/db";
import { fail, need, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export interface ClassWithMembers {
  id: number;
  name: string;
  course_id: number;
  course_name: string;
  weekday: number | null;
  start_time: string | null;
  minutes: number | null;
  room: string | null;
  member_count: number;
  member_ids: string | null;
  member_names: string | null;
}

/** 班列表（含成员） */
export async function GET() {
  try {
    const rows = all<ClassWithMembers>(`
      select g.id, g.name, g.course_id, c.name as course_name, g.weekday, g.start_time,
             g.minutes, g.room,
             (select count(*) from enrollment e where e.class_id = g.id and e.status = 'active') as member_count,
             (select group_concat(e.student_id, ',') from enrollment e where e.class_id = g.id and e.status = 'active') as member_ids,
             (select group_concat(s.name, '、') from enrollment e join student s on s.id = e.student_id
               where e.class_id = g.id and e.status = 'active') as member_names
      from class_group g join course c on c.id = g.course_id
      where g.status = 'active'
      order by g.id
    `);
    return ok(rows);
  } catch (e) {
    return fail(e, 500);
  }
}

/** 建班并设置成员 */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const name = need(b.name, "班级名称");
    const courseId = Number(b.courseId);
    if (!courseId) return fail("缺少 courseId");
    const course = get<{ id: number }>("select id from course where id = ?", [courseId]);
    if (!course) return fail("课程不存在", 404);
    const studentIds: number[] = Array.isArray(b.studentIds)
      ? b.studentIds.map(Number).filter(Boolean)
      : [];

    const id = tx(() => {
      const r = run(
        `insert into class_group (name, course_id, weekday, start_time, minutes, room) values (?, ?, ?, ?, ?, ?)`,
        [name, courseId, b.weekday ?? null, b.startTime ?? null, b.minutes ?? null, b.room ?? null],
      );
      const classId = Number(r.lastInsertRowid);
      for (const sid of studentIds) {
        run(
          `insert or ignore into enrollment (student_id, course_id, class_id) values (?, ?, ?)`,
          [sid, courseId, classId],
        );
      }
      return classId;
    });

    return ok(get<ClassWithMembers>("select * from class_group where id = ?", [id]), 201);
  } catch (e) {
    return fail(e);
  }
}
