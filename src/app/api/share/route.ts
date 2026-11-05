import { checkShare } from "@/lib/share";
import { all, get } from "@/db";
import { fail, ok } from "@/lib/http";
import { pad2, toDateStr, toDateTimeStr } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** 家长分享页的数据源：只给能看的，不给联系方式和金额 */
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const id = Number(u.searchParams.get("id"));
    const k = String(u.searchParams.get("k") || "");
    if (!checkShare(id, k)) return fail(new Error("链接不对或已经失效，请联系老师重新发一份"), 403);

    const student = get<{ id: number; name: string; grade: string; school: string; status: string }>(
      "select id, name, grade, school, status from student where id = ?",
      [id],
    );
    if (!student) return fail(new Error("找不到这个学生"), 404);

    const bal = get<{ balance_minutes: number }>("select balance_minutes from v_student_balance where student_id = ?", [
      id,
    ]);

    const lessons = all<{
      id: number;
      start_at: string;
      minutes: number;
      status: string;
      course_name: string;
      title: string;
      att_status: string | null;
    }>(
      `select l.id, l.start_at, l.minutes, l.status, c.name as course_name, l.title, a.status as att_status
         from lesson_student ls
         join lesson l on l.id = ls.lesson_id
         left join course c on c.id = l.course_id
         left join attendance a on a.lesson_id = l.id and a.student_id = ls.student_id
        where ls.student_id = ?
        order by l.start_at desc
        limit 6`,
      [id],
    );

    const notes = all<{ id: number; created_at: string; topic: string; level: number; content: string }>(
      "select id, created_at, topic, level, content from note where student_id = ? order by id desc limit 3",
      [id],
    );

    const next = get<{ id: number; start_at: string; course_name: string; title: string }>(
      `select l.id, l.start_at, c.name as course_name, l.title
         from lesson_student ls
         join lesson l on l.id = ls.lesson_id
         left join course c on c.id = l.course_id
        where ls.student_id = ? and l.start_at >= ? and l.status = 'planned'
        order by l.start_at asc
        limit 1`,
      // start_at 存的是本地时间串，跟它比必须也用本地时间串（用 toISOString 会差 8 小时，
      // 今天下午的课会被当成「已经过去」，家长就看不到「下次上课」了）
      [id, toDateTimeStr(new Date())],
    );

    // 本月小结：上了几节、到了几节——家长最想先看到的两行字
    const today = new Date();
    const monthFrom = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-01`;
    const monthTo = toDateStr(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    const month = get<{
      lessons: number;
      attended: number;
      leave_n: number;
      absent_n: number;
      billed: number;
    }>(
      `select count(distinct case when l.status <> 'cancelled' then l.id end) as lessons,
              sum(case when a.status in ('present', 'makeup') then 1 else 0 end) as attended,
              sum(case when a.status = 'leave' then 1 else 0 end) as leave_n,
              sum(case when a.status = 'absent' then 1 else 0 end) as absent_n,
              coalesce(sum(a.billed_minutes), 0) as billed
         from lesson_student ls
         join lesson l on l.id = ls.lesson_id
         left join attendance a on a.lesson_id = l.id and a.student_id = ls.student_id
        where ls.student_id = ? and substr(l.start_at, 1, 10) between ? and ?`,
      [id, monthFrom, monthTo],
    );

    return ok({
      student: { name: student.name, grade: student.grade, school: student.school },
      balanceMinutes: bal?.balance_minutes ?? 0,
      next: next || null,
      lessons,
      notes,
      month: {
        label: `${today.getMonth() + 1} 月`,
        lessons: month?.lessons ?? 0,
        attended: month?.attended ?? 0,
        leave: month?.leave_n ?? 0,
        absent: month?.absent_n ?? 0,
        billedMinutes: month?.billed ?? 0,
      },
    });
  } catch (e) {
    return fail(e, 500);
  }
}
