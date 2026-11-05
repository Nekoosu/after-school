import { ok, fail } from "@/lib/http";
import { all, get } from "@/db";
import { fileResponse, toCsv, type Col } from "@/lib/csv";

export const dynamic = "force-dynamic";

/**
 * 月报：一个月里每个孩子上了几节、缺了几次、扣了多少课时、交了多少、还剩多少。
 * 口径说明（跟「上课记录」页一致）：
 *  - 上课节数不含已取消的课；
 *  - 出勤 = 出勤 + 补课，请假/缺席单独计数；
 *  - 待记录 = 时间已经过了、但还是 planned 的课（记完就会变 done）；
 *  - 消耗课时取 attendance.billed_minutes 之和，不是按分钟数硬算。
 */
interface Agg {
  student_id: number;
  lessons: number;
  attended: number;
  leave_n: number;
  absent_n: number;
  unrecorded: number;
  cancelled: number;
  billed: number;
}

interface Roster {
  id: number;
  name: string;
  grade: string | null;
  balance_minutes: number;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function monthOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function nowStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const month = (url.searchParams.get("month") ?? "").trim() || monthOf(new Date());
  if (!MONTH_RE.test(month)) return fail(new Error("月份不对，应该像 2026-11"));

  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const from = `${month}-01`;
  const to = `${month}-${pad(lastDay)}`;
  const now = nowStamp();

  const roster = all<Roster>(
    `select s.id,
            s.name,
            s.grade,
            coalesce(v.balance_minutes, 0) as balance_minutes
       from student s
       left join v_student_balance v on v.student_id = s.id
      where s.status <> 'left'
      order by s.name asc`,
  );

  const agg = all<Agg>(
    `select ls.student_id,
            count(distinct case when l.status <> 'cancelled' then l.id end) as lessons,
            sum(case when a.status in ('present', 'makeup') then 1 else 0 end) as attended,
            sum(case when a.status = 'leave' then 1 else 0 end) as leave_n,
            sum(case when a.status = 'absent' then 1 else 0 end) as absent_n,
            sum(case when l.status = 'planned' and l.start_at <= ? then 1 else 0 end) as unrecorded,
            sum(case when l.status = 'cancelled' then 1 else 0 end) as cancelled,
            coalesce(sum(a.billed_minutes), 0) as billed
       from lesson_student ls
       join lesson l on l.id = ls.lesson_id
       left join attendance a on a.lesson_id = l.id and a.student_id = ls.student_id
      where substr(l.start_at, 1, 10) between ? and ?
      group by ls.student_id`,
    [now, from, to],
  );

  const paid = all<{ student_id: number; amount: number }>(
    `select student_id, coalesce(sum(amount), 0) as amount
       from payment
      where substr(paid_at, 1, 10) between ? and ?
      group by student_id`,
    [from, to],
  );

  const aggOf = new Map(agg.map((a) => [a.student_id, a]));
  const paidOf = new Map(paid.map((p) => [p.student_id, p.amount]));

  const rows = roster.map((s) => {
    const a = aggOf.get(s.id);
    const lessons = a?.lessons ?? 0;
    const attended = a?.attended ?? 0;
    const leave = a?.leave_n ?? 0;
    const absent = a?.absent_n ?? 0;
    const billed = a?.billed ?? 0;
    const marked = attended + leave + absent;
    return {
      studentId: s.id,
      name: s.name,
      grade: s.grade,
      lessons,
      attended,
      leave,
      absent,
      unrecorded: a?.unrecorded ?? 0,
      cancelled: a?.cancelled ?? 0,
      billedMinutes: billed,
      billedHours: Math.round((billed / 60) * 10) / 10,
      paid: paidOf.get(s.id) ?? 0,
      balanceMinutes: s.balance_minutes,
      balanceHours: Math.round((s.balance_minutes / 60) * 10) / 10,
      rate: marked > 0 ? Math.round((attended / marked) * 100) : null,
    };
  });

  const lessonTotal = get<{ n: number }>(
    `select count(*) as n
       from lesson
      where substr(start_at, 1, 10) between ? and ?
        and status <> 'cancelled'`,
    [from, to],
  )?.n ?? 0;

  const sum = (key: "attended" | "leave" | "absent" | "billedMinutes" | "paid" | "unrecorded" | "lessons") =>
    rows.reduce((acc, r) => acc + (r[key] as number), 0);

  const markedAll = sum("attended") + sum("leave") + sum("absent");
  const summary = {
    students: rows.filter((r) => r.lessons > 0).length,
    lessons: lessonTotal,
    attended: sum("attended"),
    leave: sum("leave"),
    absent: sum("absent"),
    unrecorded: sum("unrecorded"),
    billedMinutes: sum("billedMinutes"),
    billedHours: Math.round((sum("billedMinutes") / 60) * 10) / 10,
    paid: sum("paid"),
    rate: markedAll > 0 ? Math.round((sum("attended") / markedAll) * 100) : null,
  };

  if (url.searchParams.get("format") === "csv") {
    const cols: Col[] = [
      { key: "name", label: "学生" },
      { key: "grade", label: "年级" },
      { key: "lessons", label: "上课节数" },
      { key: "attended", label: "出勤" },
      { key: "leave", label: "请假" },
      { key: "absent", label: "缺勤" },
      { key: "unrecorded", label: "待记录" },
      { key: "billedHours", label: "消耗课时(小时)" },
      { key: "paid", label: "本月收款" },
      { key: "balanceHours", label: "剩余课时(小时)" },
    ];
    return fileResponse(toCsv(rows, cols), `月报-${month}.csv`, "text/csv");
  }

  return ok({ month, from, to, today: now.slice(0, 10), rows, summary });
}
