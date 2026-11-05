import { NextRequest } from "next/server";
import { get, run } from "@/db";
import { fail, ok } from "@/lib/http";
import type { TeachPlanRow } from "@/db/types";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const row = get<TeachPlanRow>("select * from teach_plan where id = ?", [Number(id)]);
  if (!row) return fail("教案不存在", 404);
  return ok(row);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const planId = Number(id);
  const old = get<TeachPlanRow>("select * from teach_plan where id = ?", [planId]);
  if (!old) return fail("教案不存在", 404);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("请求内容不是有效 JSON");

  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : old.title;
  const content = typeof body.content === "string" && body.content.trim() ? body.content.trim() : old.content;
  const courseId =
    body.courseId === null || body.courseId === "" ? null : body.courseId !== undefined ? Number(body.courseId) : old.course_id;
  const topic = body.topic !== undefined ? (String(body.topic).trim() || null) : old.topic;
  const minutes = body.minutes !== undefined ? (body.minutes ? Math.round(Number(body.minutes)) : null) : old.minutes;
  const tags = body.tags !== undefined ? (String(body.tags).trim() || null) : old.tags;

  run(
    `update teach_plan
     set title = ?, course_id = ?, topic = ?, content = ?, minutes = ?, tags = ?,
         updated_at = datetime('now','localtime')
     where id = ?`,
    [title, courseId, topic, content, minutes, tags, planId],
  );
  return ok({ ok: true, id: planId });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const planId = Number(id);
  const old = get<{ id: number }>("select id from teach_plan where id = ?", [planId]);
  if (!old) return fail("教案不存在", 404);
  run("update lesson set plan_id = null where plan_id = ?", [planId]);
  run("delete from teach_plan where id = ?", [planId]);
  return ok({ ok: true, deleted: planId });
}
