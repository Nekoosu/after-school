import { NextRequest } from "next/server";
import { get, run } from "@/db";
import { fail, ok } from "@/lib/http";
import type { FeedbackRow } from "@/db/types";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const row = get<FeedbackRow>("select * from feedback where id = ?", [Number(id)]);
  if (!row) return fail("反馈不存在", 404);
  return ok(row);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const fid = Number(id);
  const old = get<FeedbackRow>("select * from feedback where id = ?", [fid]);
  if (!old) return fail("反馈不存在", 404);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("请求内容不是有效 JSON");

  const content = typeof body.content === "string" && body.content.trim() ? body.content.trim() : old.content;
  const status = typeof body.status === "string" && body.status ? body.status : old.status;
  if (!["draft", "sent"].includes(status)) return fail("状态只能是 draft 或 sent");
  const sentAt = status === "sent" ? old.sent_at ?? new Date().toISOString().slice(0, 19).replace("T", " ") : null;

  run("update feedback set content = ?, status = ?, sent_at = ? where id = ?", [content, status, sentAt, fid]);
  return ok({ ok: true, id: fid, status });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const fid = Number(id);
  const old = get<{ id: number }>("select id from feedback where id = ?", [fid]);
  if (!old) return fail("反馈不存在", 404);
  run("delete from feedback where id = ?", [fid]);
  return ok({ ok: true, deleted: fid });
}
