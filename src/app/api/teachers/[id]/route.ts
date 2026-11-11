import { all, get, run, tx } from "@/db";
import type { CourseRow, LessonWithStudents, TeacherRow } from "@/db/types";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 一位老师：资料 + 任教课程 + 这两周要上的课 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const id = Number((await ctx.params).id);
    const teacher = get<TeacherRow>("select * from teacher where id = ?", [id]);
    if (!teacher) return fail("这位老师不存在", 404);
    const courses = all<CourseRow>("select * from course where teacher_id = ? order by name", [id]);
    const lessons = all<LessonWithStudents>(
      `select l.*, c.name as course_name, c.color as course_color, t.name as teacher_name,
        (select group_concat(s.name, '、') from lesson_student ls join student s on s.id = ls.student_id
          where ls.lesson_id = l.id) as student_names,
        (select group_concat(ls.student_id, ',') from lesson_student ls
          where ls.lesson_id = l.id) as student_ids
       from lesson l
       join course c on c.id = l.course_id
       left join teacher t on t.id = l.teacher_id
       where l.teacher_id = ? and l.start_at >= date('now','localtime','-7 day')
       order by l.start_at asc
       limit 60`,
      [id],
    );
    return ok({ teacher, courses, lessons });
  } catch (e) {
    return fail(e, 500);
  }
}

/** 改老师资料（含改任教课程：courseIds 就是这位老师现在带的所有课） */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const id = Number((await ctx.params).id);
    const before = get<TeacherRow>("select * from teacher where id = ?", [id]);
    if (!before) return fail("这位老师不存在", 404);
    const b = await req.json();

    tx(() => {
      const name = b.name === undefined ? before.name : String(b.name).trim();
      run(
        `update teacher set name = ?, phone = ?, subject = ?, color = ?, note = ?, status = ?
          where id = ?`,
        [
          name || before.name,
          b.phone === undefined ? before.phone : b.phone || null,
          b.subject === undefined ? before.subject : b.subject || null,
          b.color === undefined ? before.color : b.color || "#7c5cff",
          b.note === undefined ? before.note : b.note || null,
          b.status === undefined ? before.status : b.status === "inactive" ? "inactive" : "active",
          id,
        ],
      );
      if (Array.isArray(b.courseIds)) {
        const ids: number[] = b.courseIds.map(Number).filter(Boolean);
        run("update course set teacher_id = null where teacher_id = ?", [id]);
        for (const cid of ids) run("update course set teacher_id = ? where id = ?", [id, cid]);
      }
    });
    return ok(get("select * from teacher where id = ?", [id]));
  } catch (e) {
    return fail(e);
  }
}

/**
 * 删老师：已经排过课的老师只停用（历史课的教师名要留着），没排过课的才真删。
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const id = Number((await ctx.params).id);
    const t = get<TeacherRow>("select * from teacher where id = ?", [id]);
    if (!t) return fail("这位老师不存在", 404);
    const used = get<{ n: number }>("select count(*) as n from lesson where teacher_id = ?", [id])?.n ?? 0;
    if (used > 0) {
      run("update teacher set status = 'inactive' where id = ?", [id]);
      return ok({ ok: true, soft: true, lessons: used });
    }
    tx(() => {
      run("update course set teacher_id = null where teacher_id = ?", [id]);
      run("delete from teacher where id = ?", [id]);
    });
    return ok({ ok: true, soft: false });
  } catch (e) {
    return fail(e);
  }
}
