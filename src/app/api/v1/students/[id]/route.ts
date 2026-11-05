import { all, get } from "@/db";
import type { NoteRow, StudentRow } from "@/db/types";
import { guard } from "@/lib/apikeys";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 单个学生：档案 + 余额 + 最近学情 + 接下来的课。需要令牌。 */
export async function GET(req: Request, ctx: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const id = Number((await ctx.params).id);
    const student = get<StudentRow>("select * from student where id = ?", [id]);
    if (!student) return fail("学生不存在", 404);

    const balance = get<{ balance_minutes: number; balance_hours: number }>(
      "select balance_minutes, balance_hours from v_student_balance where student_id = ?",
      [id],
    );

    const notes = all<NoteRow>(
      "select * from note where student_id = ? order by created_at desc limit 10",
      [id],
    );

    const lessons = all<{ id: number; start_at: string; minutes: number; status: string; course_name: string; title: string | null }>(
      `select l.id, l.start_at, l.minutes, l.status, c.name as course_name, l.title
       from lesson l join course c on c.id = l.course_id
       join lesson_student ls on ls.lesson_id = l.id and ls.student_id = ?
       where l.start_at >= datetime('now', 'localtime')
       order by l.start_at asc limit 10`,
      [id],
    );

    return ok({
      student,
      balanceMinutes: balance?.balance_minutes ?? 0,
      balanceHours: balance?.balance_hours ?? 0,
      recentNotes: notes,
      upcomingLessons: lessons,
    });
  } catch (e) {
    return fail(e, 500);
  }
}
