import { all, get, run } from "@/db";
import type { NoteRow } from "@/db/types";
import { fail, need, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 某学生的学情记录列表 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const id = Number((await ctx.params).id);
    const rows = all<NoteRow>(
      "select * from note where student_id = ? order by id desc limit 100",
      [id],
    );
    return ok(rows);
  } catch (e) {
    return fail(e, 500);
  }
}

/** 快速记一笔学情（不挂课的日常记录） */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const id = Number((await ctx.params).id);
    const student = get<{ id: number }>("select id from student where id = ?", [id]);
    if (!student) return fail("学生不存在", 404);

    const b = await req.json();
    const content = need(b.content, "内容");
    run(
      "insert into note (student_id, kind, topic, level, content) values (?, ?, ?, ?, ?)",
      [id, b.kind ?? "progress", b.topic ?? null, b.level ?? null, content],
    );
    return ok({ ok: true }, 201);
  } catch (e) {
    return fail(e);
  }
}
