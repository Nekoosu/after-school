import { all, get, run } from "@/db";
import type { NoteRow } from "@/db/types";
import { guard } from "@/lib/apikeys";
import { fail, need, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 某个学生的学情记录。需要令牌。 */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const url = new URL(req.url);
    const studentId = Number(url.searchParams.get("studentId"));
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 20));
    if (!studentId) return fail("要带 studentId");
    const rows = all<NoteRow>(
      "select * from note where student_id = ? order by created_at desc limit ?",
      [studentId, limit],
    );
    return ok({ count: rows.length, notes: rows });
  } catch (e) {
    return fail(e, 500);
  }
}

/**
 * 追加一条学情（AI 助手或别的工具写完发过来）。
 * body: { studentId, content, topic?, level?, kind? }
 */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const b = await req.json();
    const studentId = Number(b.studentId);
    if (!studentId) return fail("要带 studentId");
    const student = get<{ id: number }>("select id from student where id = ?", [studentId]);
    if (!student) return fail("学生不存在", 404);
    const content = need(b.content, "内容");
    let level: number | null = null;
    if (b.level != null && b.level !== "") {
      const n = Math.round(Number(b.level));
      if (Number.isFinite(n) && n >= 1 && n <= 5) level = n;
    }
    const r = run(
      "insert into note (student_id, lesson_id, kind, topic, level, content) values (?, ?, ?, ?, ?, ?)",
      [studentId, b.lessonId ?? null, b.kind ?? "progress", b.topic ?? null, level, content],
    );
    const row = get<NoteRow>("select * from note where id = ?", [r.lastInsertRowid]);
    return ok(row, 201);
  } catch (e) {
    return fail(e);
  }
}
