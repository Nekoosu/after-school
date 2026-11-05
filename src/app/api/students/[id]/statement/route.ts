import { all, get } from "@/db";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

interface LessonLine {
  id: number;
  start_at: string;
  minutes: number;
  status: string;
  course_name: string;
  title: string | null;
  att_status: string | null;
  billed_minutes: number | null;
}

interface PayLine {
  id: number;
  amount: number;
  minutes: number;
  method: string | null;
  paid_at: string;
  remark: string | null;
}

function monthRange(month: string): { from: string; to: string; ok: boolean } {
  if (!/^\d{4}-\d{2}$/.test(month)) return { from: "", to: "", ok: false };
  const [y, m] = month.split("-").map(Number);
  if (m < 1 || m > 12) return { from: "", to: "", ok: false };
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01 00:00`, to: `${month}-${String(last).padStart(2, "0")} 23:59`, ok: true };
}

/** 学生某个月的对账单：上了哪些课、扣了多少课时、交了多少费、月末还剩多少 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const studentId = Number(id);
    if (!studentId) return fail("学生编号不对", 400);

    const url = new URL(req.url);
    const now = new Date();
    const month =
      url.searchParams.get("month") || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const range = monthRange(month);
    if (!range.ok) return fail("月份格式应为 YYYY-MM");

    const student = get<{
      id: number;
      name: string;
      grade: string | null;
      school: string | null;
      guardian_name: string | null;
      guardian_phone: string | null;
      status: string;
    }>("select id, name, grade, school, guardian_name, guardian_phone, status from student where id = ?", [
      studentId,
    ]);
    if (!student) return fail("学生不存在", 404);

    const lessons = all<LessonLine>(
      `select l.id, l.start_at, l.minutes, l.status, c.name as course_name, l.title,
              a.status as att_status, a.billed_minutes
         from lesson l
         join lesson_student ls on ls.lesson_id = l.id and ls.student_id = ?
         join course c on c.id = l.course_id
         left join attendance a on a.lesson_id = l.id and a.student_id = ?
        where l.status <> 'cancelled' and l.start_at >= ? and l.start_at <= ?
        order by l.start_at asc`,
      [studentId, studentId, range.from, range.to],
    );

    const payments = all<PayLine>(
      `select id, amount, minutes, method, paid_at, remark
         from payment
        where student_id = ? and paid_at >= ? and paid_at <= substr(?, 1, 10)
        order by paid_at asc`,
      [studentId, range.from, range.to.slice(0, 10)],
    );

    const balance = get<{ balance_minutes: number | null }>(
      "select balance_minutes from v_student_balance where student_id = ?",
      [studentId],
    );

    const doneLessons = lessons.filter((l) => l.status === "done");
    const billedMinutes = doneLessons.reduce((n, l) => n + (l.billed_minutes ?? 0), 0);
    const leaveCount = doneLessons.filter((l) => l.att_status === "leave").length;
    const absentCount = doneLessons.filter((l) => l.att_status === "absent").length;
    const makeUpCount = doneLessons.filter((l) => l.att_status === "makeup").length;
    const paidAmount = payments.reduce((n, p) => n + p.amount, 0);
    const paidMinutes = payments.reduce((n, p) => n + p.minutes, 0);

    // 单价：用全部交费记录反推「每小时多少钱」（金额合计 ÷ 小时合计），没有分钟数就算了
    const allPay = get<{ amount: number; minutes: number }>(
      "select coalesce(sum(amount),0) as amount, coalesce(sum(minutes),0) as minutes from payment where student_id = ?",
      [studentId],
    );
    const unitPrice = allPay && allPay.minutes > 0 ? (allPay.amount / allPay.minutes) * 60 : 0;

    return ok({
      month,
      from: range.from.slice(0, 10),
      to: range.to.slice(0, 10),
      student,
      lessons,
      payments,
      summary: {
        lessonCount: doneLessons.length,
        plannedCount: lessons.filter((l) => l.status === "planned").length,
        billedMinutes,
        leaveCount,
        absentCount,
        makeUpCount,
        paidAmount,
        paidMinutes,
        unitPrice,
        balanceMinutes: balance?.balance_minutes ?? 0,
        billedMoney: unitPrice > 0 ? Math.round((billedMinutes / 60) * unitPrice) : 0,
      },
    });
  } catch (e) {
    return fail(e, 500);
  }
}
