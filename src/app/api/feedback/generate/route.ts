import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { generateDraft } from "@/lib/feedbackGen";
import { get } from "@/db";
import { aiConf, polishFeedback } from "@/lib/ai";

export const dynamic = "force-dynamic";

/** 给一个学生生成反馈草稿；useAi=true 时再用 AI 润色一遍（失败就返回本地草稿） */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("请求内容不是有效 JSON");
  const studentId = Number(body.studentId);
  if (!studentId) return fail("请选择学生");

  const from = String(body.from ?? "").slice(0, 10);
  const to = String(body.to ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return fail("请选择正确的起止日期");
  }
  if (from > to) return fail("开始日期不能晚于结束日期");

  const draft = generateDraft(studentId, from, to);
  if (!draft) return fail("学生不存在", 404);

  const wantAi = body.useAi === true;
  if (!wantAi) return ok({ ...draft, ai: { used: false } });

  const conf = aiConf();
  if (!conf.enabled) {
    return ok({ ...draft, ai: { used: false, reason: "设置页里还没打开 AI 润色" } });
  }

  const stu = get<{ name: string }>("select name from student where id = ?", [studentId]);
  const polished = await polishFeedback(draft.content, stu?.name ?? "孩子");
  if (!polished) {
    return ok({ ...draft, ai: { used: false, reason: "AI 没连上，已按本地草稿给你" } });
  }
  return ok({
    ...draft,
    local_content: draft.content,
    content: polished.text,
    ai: { used: true, model: polished.model },
  });
}
