import { NextRequest } from "next/server";
import { all, get, run, tx } from "@/db";
import { fail, ok } from "@/lib/http";
import type { PaymentWithStudent } from "@/db/types";

export const dynamic = "force-dynamic";

/** 收款记录：?month=YYYY-MM 或 ?studentId=N 或 ?limit=N */
export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const month = sp.get("month");
  const studentId = sp.get("studentId");
  const limit = Math.min(Number(sp.get("limit") ?? 200) || 200, 500);

  const where: string[] = [];
  const params: unknown[] = [];
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    where.push("substr(p.paid_at, 1, 7) = ?");
    params.push(month);
  }
  if (studentId) {
    where.push("p.student_id = ?");
    params.push(Number(studentId));
  }
  const sql = `
    select p.*, s.name as student_name
    from payment p join student s on s.id = p.student_id
    ${where.length ? "where " + where.join(" and ") : ""}
    order by p.paid_at desc, p.id desc
    limit ${limit}`;
  const rows = all<PaymentWithStudent>(sql, params);
  const total = rows.reduce((n, r) => n + (r.amount || 0), 0);
  const totalMinutes = rows.reduce((n, r) => n + (r.minutes || 0), 0);
  return ok({ rows, total, totalMinutes, count: rows.length });
}

/** 记一笔收款：写 payment，同时按分钟数充值课时 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("请求内容不是有效 JSON");

  const studentId = Number(body.studentId);
  if (!studentId) return fail("请选择学生");
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return fail("金额要大于 0");
  const minutes = Math.round(Number(body.minutes ?? 0));
  if (minutes < 0) return fail("课时分钟数不能是负数");
  const method = typeof body.method === "string" && body.method ? body.method : "wechat";
  const paidAt = typeof body.paidAt === "string" && body.paidAt ? body.paidAt : new Date().toISOString().slice(0, 10);
  const remark = typeof body.remark === "string" ? body.remark.trim() || null : null;

  const stu = get<{ id: number; name: string }>("select id, name from student where id = ?", [studentId]);
  if (!stu) return fail("学生不存在", 404);

  const result = tx(() => {
    const r = run(
      "insert into payment (student_id, amount, minutes, method, paid_at, remark) values (?, ?, ?, ?, ?, ?)",
      [studentId, amount, minutes, method, paidAt, remark],
    );
    const paymentId = Number(r.lastInsertRowid);
    if (minutes > 0) {
      run(
        "insert into hours_ledger (student_id, delta_minutes, kind, ref_id, remark) values (?, ?, 'purchase', ?, ?)",
        [studentId, minutes, paymentId, remark ?? "收款充值"],
      );
    }
    const bal = get<{ v: number }>(
      "select coalesce(sum(delta_minutes), 0) as v from hours_ledger where student_id = ?",
      [studentId],
    );
    return { paymentId, balance_minutes: bal?.v ?? 0 };
  });

  return ok({ ok: true, ...result, student: stu.name });
}

/** 撤销一笔收款（同时撤掉它带来的课时，防止课时凭空多出来） */
export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return fail("缺少 id");
  const p = get<{ id: number; student_id: number }>("select id, student_id from payment where id = ?", [id]);
  if (!p) return fail("这笔收款不存在", 404);

  tx(() => {
    run("delete from hours_ledger where kind = 'purchase' and ref_id = ?", [id]);
    run("delete from payment where id = ?", [id]);
  });
  return ok({ ok: true, deleted: id });
}
