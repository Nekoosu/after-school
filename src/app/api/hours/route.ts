import { get, run, tx } from "@/db";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * 课时流水：充值 / 赠送 / 手动调整 / 退款
 * 铁律：只插流水，绝不改余额字段。余额 = SUM(delta_minutes)
 */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const studentId = Number(b.studentId);
    const deltaMinutes = Number(b.deltaMinutes);
    const kind: string = b.kind ?? "purchase";

    if (!studentId) return fail("缺少 studentId");
    if (!Number.isFinite(deltaMinutes) || deltaMinutes === 0) return fail("分钟数必须是非零数字");
    if (!["purchase", "gift", "adjust", "refund"].includes(kind)) return fail("不支持的类别");

    const student = get<{ id: number }>("select id from student where id = ?", [studentId]);
    if (!student) return fail("学生不存在", 404);

    tx(() => {
      run(
        `insert into hours_ledger (student_id, course_id, delta_minutes, kind, remark)
         values (?, ?, ?, ?, ?)`,
        [studentId, b.courseId ?? null, deltaMinutes, kind, b.remark ?? null],
      );
      // 有金额就顺带记一笔收款
      if (b.amount !== undefined && b.amount !== null && Number(b.amount) > 0) {
        run(
          `insert into payment (student_id, amount, minutes, method, remark) values (?, ?, ?, ?, ?)`,
          [studentId, Number(b.amount), deltaMinutes, b.method ?? null, b.remark ?? null],
        );
      }
    });

    const balance = get<{ balance_minutes: number; balance_hours: number }>(
      "select balance_minutes, balance_hours from v_student_balance where student_id = ?",
      [studentId],
    );
    return ok({ ok: true, ...balance }, 201);
  } catch (e) {
    return fail(e);
  }
}
