import { all } from "@/db";
import { fail, ok } from "@/lib/http";
import { toDateTimeStr, addDays } from "@/lib/dates";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 一个学生的多科课表：过去 2 周 + 未来 5 周，按天分组给前端 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const sid = Number((await ctx.params).id);
    if (!sid) return fail("缺少学生 id");

    const from = toDateTimeStr(addDays(new Date(), -14));
    const to = toDateTimeStr(addDays(new Date(), 35));

    const lessons = all<{
      lesson_id: number;
      start_at: string;
      minutes: number;
      status: string;
      room: string | null;
      title: string | null;
      course_name: string;
      course_color: string | null;
      teacher_name: string | null;
      att_status: string | null;
    }>(
      `select l.id as lesson_id, l.start_at, l.minutes, l.status, l.room, l.title,
              c.name as course_name, c.color as course_color, t.name as teacher_name,
              a.status as att_status
       from lesson_student ls
       join lesson l on l.id = ls.lesson_id
       join course c on c.id = l.course_id
       left join teacher t on t.id = l.teacher_id
       left join attendance a on a.lesson_id = l.id and a.student_id = ls.student_id
       where ls.student_id = ? and l.status <> 'cancelled'
         and l.start_at >= ? and l.start_at <= ?
       order by l.start_at asc`,
      [sid, from, to],
    );

    // 每个班型的余额（学生存的每科各剩多少课时）
    const byCourse = all<{ course_id: number | null; course_name: string; course_color: string | null; balance_minutes: number; last_price: number | null }>(
      `select l.course_id, c.name as course_name, c.color as course_color,
              coalesce(sum(l.delta_minutes), 0) as balance_minutes,
              (select unit_price from hours_ledger h2
                where h2.student_id = l.student_id and h2.kind = 'purchase' and h2.course_id = l.course_id
                order by h2.id desc limit 1) as last_price
       from hours_ledger l
       left join course c on c.id = l.course_id
       where l.student_id = ? and l.course_id is not null
       group by l.course_id, c.name, c.color
       order by balance_minutes desc`,
      [sid],
    );

    return ok({ lessons, byCourse });
  } catch (e) {
    return fail(e, 500);
  }
}
