import { NextRequest } from "next/server";
import { all, get, setting } from "@/db";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

interface Row {
  [k: string]: string | number | null;
}

/** 统计页要用的一次性汇总，全部是当场聚合，不落表 */
export function GET(req: NextRequest) {
  const months = Math.min(Math.max(Number(req.nextUrl.searchParams.get("months") ?? 6) || 6, 1), 24);

  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const fromStr = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-01`;

  const revenueTotal = get<{ v: number; n: number }>(
    "select coalesce(sum(amount),0) as v, count(*) as n from payment where paid_at >= ?",
    [fromStr],
  );
  const revenueByMonth = all<{ month: string; amount: number; n: number }>(
    `select substr(paid_at,1,7) as month, coalesce(sum(amount),0) as amount, count(*) as n
     from payment where paid_at >= ? group by month order by month`,
    [fromStr],
  );
  const revenueByMethod = all<{ method: string; amount: number; n: number }>(
    `select coalesce(method,'other') as method, coalesce(sum(amount),0) as amount, count(*) as n
     from payment where paid_at >= ? group by method order by amount desc`,
    [fromStr],
  );

  const soldMinutes = get<{ v: number }>(
    "select coalesce(sum(delta_minutes),0) as v from hours_ledger where delta_minutes > 0 and created_at >= ?",
    [fromStr],
  );
  const usedMinutes = get<{ v: number }>(
    "select coalesce(sum(-delta_minutes),0) as v from hours_ledger where delta_minutes < 0 and created_at >= ?",
    [fromStr],
  );
  const remainMinutes = get<{ v: number }>(
    "select coalesce(sum(delta_minutes),0) as v from hours_ledger",
  );

  const lessonStat = all<{ status: string; n: number }>(
    "select status, count(*) as n from lesson where start_at >= ? group by status",
    [fromStr],
  );
  const attStat = all<{ status: string; n: number }>(
    `select a.status, count(*) as n
     from attendance a join lesson l on l.id = a.lesson_id
     where l.start_at >= ? group by a.status`,
    [fromStr],
  );

  const monthly = all<{ month: string; lessons: number; used: number }>(
    `select substr(l.start_at,1,7) as month,
            count(distinct l.id) as lessons,
            coalesce(sum(case when a.status in ('present','makeup') then a.billed_minutes else 0 end),0) as used
     from lesson l left join attendance a on a.lesson_id = l.id
     where l.start_at >= ? and l.status = 'done'
     group by month order by month`,
    [fromStr],
  );

  const topStudents = all<{ id: number; name: string; used: number; amount: number; lessons: number }>(
    `select s.id, s.name,
            coalesce((select sum(-h.delta_minutes) from hours_ledger h
                      where h.student_id = s.id and h.delta_minutes < 0 and h.created_at >= ?),0) as used,
            coalesce((select sum(p.amount) from payment p
                      where p.student_id = s.id and p.paid_at >= ?),0) as amount,
            coalesce((select count(*) from lesson_student ls join lesson l on l.id = ls.lesson_id
                      where ls.student_id = s.id and l.status = 'done' and l.start_at >= ?),0) as lessons
     from student s where s.status = 'active'
     order by used desc limit 8`,
    [fromStr, fromStr, fromStr],
  );

  const threshold = Number(setting("low_balance_minutes", "450")) || 450;
  const lowBalance = all<{ id: number; name: string; balance: number }>(
    `select s.id, s.name, coalesce(v.balance_minutes,0) as balance
     from student s left join v_student_balance v on v.student_id = s.id
     where s.status = 'active' and coalesce(v.balance_minutes,0) < ?
     order by balance asc limit 12`,
    [threshold],
  );

  const courseShare = all<{ name: string; minutes: number; n: number }>(
    `select c.name, coalesce(sum(l.minutes),0) as minutes, count(*) as n
     from lesson l join course c on c.id = l.course_id
     where l.status = 'done' and l.start_at >= ?
     group by c.id order by minutes desc`,
    [fromStr],
  );

  const studentCount = get<{ n: number }>("select count(*) as n from student where status = 'active'");
  const pendingMakeup = get<{ n: number }>("select count(*) as n from v_makeup_pending");

  // 热力图：最近 26 周（182 天）每天上了几节课
  const heatStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 181);
  const heatFromStr = `${heatStart.getFullYear()}-${String(heatStart.getMonth() + 1).padStart(2, "0")}-${String(
    heatStart.getDate(),
  ).padStart(2, "0")}`;
  const heatmap = all<{ d: string; n: number; done: number }>(
    `select substr(start_at,1,10) as d,
            count(*) as n,
            sum(case when status = 'done' then 1 else 0 end) as done
     from lesson
     where substr(start_at,1,10) >= ? and status <> 'cancelled'
     group by d order by d`,
    [heatFromStr],
  );

  const payload: Row = {
    months,
    from: fromStr,
    revenue: revenueTotal?.v ?? 0,
    revenueCount: revenueTotal?.n ?? 0,
    soldMinutes: soldMinutes?.v ?? 0,
    usedMinutes: usedMinutes?.v ?? 0,
    remainMinutes: remainMinutes?.v ?? 0,
    studentCount: studentCount?.n ?? 0,
    pendingMakeup: pendingMakeup?.n ?? 0,
    lowBalanceThreshold: threshold,
  };

  return ok({
    ...payload,
    revenueByMonth,
    revenueByMethod,
    lessonStat,
    attStat,
    monthly,
    topStudents,
    lowBalance,
    courseShare,
    heatFrom: heatFromStr,
    heatmap,
  });
}
