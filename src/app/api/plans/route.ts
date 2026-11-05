import { NextRequest } from "next/server";
import { all, run } from "@/db";
import { fail, need, ok } from "@/lib/http";
import type { TeachPlanWithCourse } from "@/db/types";

export const dynamic = "force-dynamic";

/** 教案列表：?courseId=1 &q=关键词 */
export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const courseId = sp.get("courseId");
  const q = (sp.get("q") ?? "").trim();

  const where: string[] = [];
  const params: unknown[] = [];
  if (courseId) {
    where.push("p.course_id = ?");
    params.push(Number(courseId));
  }
  if (q) {
    where.push("(p.title like ? or p.topic like ? or p.tags like ? or p.content like ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const rows = all<TeachPlanWithCourse>(
    `select p.*, c.name as course_name
     from teach_plan p left join course c on c.id = p.course_id
     ${where.length ? "where " + where.join(" and ") : ""}
     order by p.updated_at desc, p.id desc
     limit 200`,
    params,
  );
  return ok(rows);
}

/** 新增教案 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("请求内容不是有效 JSON");
  let title: string;
  let content: string;
  try {
    title = need(body.title, "标题");
    content = need(body.content, "正文");
  } catch (e) {
    return fail(e);
  }
  const courseId = body.courseId ? Number(body.courseId) : null;
  const topic = typeof body.topic === "string" ? body.topic.trim() || null : null;
  const minutes = body.minutes ? Math.round(Number(body.minutes)) : null;
  const tags = typeof body.tags === "string" ? body.tags.trim() || null : null;

  const r = run(
    "insert into teach_plan (course_id, title, topic, content, minutes, tags) values (?, ?, ?, ?, ?, ?)",
    [courseId, title, topic, content, minutes, tags],
  );
  return ok({ ok: true, id: Number(r.lastInsertRowid) });
}
