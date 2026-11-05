import { NextRequest } from "next/server";
import { all, get, run } from "@/db";
import { fail, ok } from "@/lib/http";
import type { FeedbackWithStudent } from "@/db/types";

export const dynamic = "force-dynamic";

/** 反馈列表：?studentId= &status=draft|sent */
export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const studentId = sp.get("studentId");
  const status = sp.get("status");

  const where: string[] = [];
  const params: unknown[] = [];
  if (studentId) {
    where.push("f.student_id = ?");
    params.push(Number(studentId));
  }
  if (status) {
    where.push("f.status = ?");
    params.push(status);
  }
  const rows = all<FeedbackWithStudent>(
    `select f.*, s.name as student_name
     from feedback f join student s on s.id = f.student_id
     ${where.length ? "where " + where.join(" and ") : ""}
     order by f.created_at desc, f.id desc
     limit 200`,
    params,
  );
  return ok(rows);
}

/** 保存一份草稿（同一学生同一周期只留一条，重复保存就覆盖） */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("请求内容不是有效 JSON");
  const studentId = Number(body.studentId);
  if (!studentId) return fail("请选择学生");
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return fail("内容不能为空");
  const periodStart = String(body.periodStart ?? "").slice(0, 10);
  const periodEnd = String(body.periodEnd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    return fail("周期日期格式不对");
  }

  // 同一学生同一周期如果已经有草稿，就覆盖内容 —— 否则反复生成会把草稿箱塞满
  const existed = get<{ id: number }>(
    "select id from feedback where student_id = ? and period_start = ? and period_end = ? and status = 'draft' order by id desc limit 1",
    [studentId, periodStart, periodEnd],
  );
  if (existed) {
    run("update feedback set content = ?, created_at = datetime('now','localtime') where id = ?", [
      content,
      existed.id,
    ]);
    return ok({ ok: true, id: existed.id, updated: true });
  }

  const r = run(
    `insert into feedback (student_id, period_start, period_end, content, status)
     values (?, ?, ?, ?, 'draft')`,
    [studentId, periodStart, periodEnd, content],
  );
  return ok({ ok: true, id: Number(r.lastInsertRowid) });
}
