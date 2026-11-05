import { NextRequest } from "next/server";
import { get, run, tx } from "@/db";
import { fail, ok } from "@/lib/http";
import type { ClassRow } from "@/db/types";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const row = get<ClassRow>("select * from class_group where id = ?", [Number(id)]);
  if (!row) return fail("班级不存在", 404);
  return ok(row);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const cid = Number(id);
  const old = get<ClassRow>("select * from class_group where id = ?", [cid]);
  if (!old) return fail("班级不存在", 404);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("请求内容不是有效 JSON");

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : old.name;
  const courseId = body.courseId ? Number(body.courseId) : old.course_id;
  const weekday = body.weekday !== undefined ? (body.weekday === null || body.weekday === "" ? null : Number(body.weekday)) : old.weekday;
  const startTime =
    body.startTime !== undefined ? (String(body.startTime).trim() || null) : old.start_time;
  const minutes = body.minutes !== undefined ? (body.minutes ? Math.round(Number(body.minutes)) : null) : old.minutes;
  const room = body.room !== undefined ? (String(body.room).trim() || null) : old.room;

  run("update class_group set name = ?, course_id = ?, weekday = ?, start_time = ?, minutes = ?, room = ? where id = ?", [
    name,
    courseId,
    weekday,
    startTime,
    minutes,
    room,
    cid,
  ]);

  // 传了 studentIds 就整份替换成员
  if (Array.isArray(body.studentIds)) {
    const ids = (body.studentIds as unknown[]).map(Number).filter(Boolean);
    tx(() => {
      run("delete from enrollment where class_id = ?", [cid]);
      for (const sid of ids) {
        run("insert or ignore into enrollment (student_id, course_id, class_id) values (?, ?, ?)", [
          sid,
          courseId,
          cid,
        ]);
      }
    });
  }

  return ok({ ok: true, id: cid });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const cid = Number(id);
  const old = get<{ id: number }>("select id from class_group where id = ?", [cid]);
  if (!old) return fail("班级不存在", 404);
  run("update lesson set class_id = null where class_id = ?", [cid]);
  run("delete from enrollment where class_id = ?", [cid]);
  run("delete from class_group where id = ?", [cid]);
  return ok({ ok: true, deleted: cid });
}
