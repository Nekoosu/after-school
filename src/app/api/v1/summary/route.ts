import { get } from "@/db";
import { guard } from "@/lib/apikeys";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * 概览：给别的程序拼自己的看板用。
 * 全是数字，不带个人信息。需要令牌。
 */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const students = get<{ n: number }>("select count(*) as n from student where status <> 'left'")?.n ?? 0;
    const lessonsToday =
      get<{ n: number }>(
        "select count(*) as n from lesson where date(start_at) = date('now','localtime') and status <> 'cancelled'",
      )?.n ?? 0;
    const lessonsThisWeek =
      get<{ n: number }>(
        "select count(*) as n from lesson where start_at >= datetime('now','localtime') and start_at < datetime('now','localtime','+7 days') and status <> 'cancelled'",
      )?.n ?? 0;
    const revenueMonth =
      get<{ n: number }>(
        "select coalesce(sum(amount),0) as n from payment where paid_at >= date('now','localtime','start of month')",
      )?.n ?? 0;
    const makeupPending = get<{ n: number }>("select count(*) as n from v_makeup_pending")?.n ?? 0;
    const lowBalance =
      get<{ n: number }>(
        `select count(*) as n from v_student_balance b join setting s on s.key = 'low_balance_minutes'
         where b.balance_minutes < cast(s.value as integer)`,
      )?.n ?? 0;
    return ok({
      students,
      lessonsToday,
      lessonsThisWeek,
      revenueMonth,
      makeupPending,
      lowBalance,
    });
  } catch (e) {
    return fail(e, 500);
  }
}
