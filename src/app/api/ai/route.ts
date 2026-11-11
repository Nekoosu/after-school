import { setting } from "@/db";
import { aiConf } from "@/lib/ai";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/ai —— 当前 AI 配置（不返回 key 明文，只说有没有填） */
export async function GET() {
  const c = aiConf();
  return ok({ enabled: c.enabled, base: c.base, model: c.model, hasKey: !!c.key });
}

/** POST /api/ai —— 用给定（或已存的）配置试一次，验证地址/模型/key 能用 */
export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    const base = String(b.base || setting("ai_base", "") || "https://api.deepseek.com/v1").replace(/\/+$/, "");
    const model = String(b.model || setting("ai_model", "") || "deepseek-chat");
    const key = String(b.key || setting("ai_key", "") || "");
    if (!base) return fail("先填接口地址");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "只回复两个字：可用" }],
          // 推理型模型会先花 token 思考，给 16 个会出现「接口 200 但正文为空」
          max_tokens: 300,
          stream: false,
        }),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        return ok({ ok: false, error: `接口返回 ${res.status}：${text.slice(0, 200)}` });
      }
      let reply = "";
      let finish = "";
      try {
        const j = JSON.parse(text);
        reply = j.choices?.[0]?.message?.content?.trim() ?? "";
        finish = String(j.choices?.[0]?.finish_reason ?? "");
      } catch {
        return ok({ ok: false, error: "返回的不是 JSON，地址一般要以 /v1 结尾" });
      }
      if (!reply) {
        return ok({
          ok: finish === "length",
          reply: "",
          model,
          error:
            finish === "length"
              ? "连上了，但模型把字数全用在思考上（换个不推理的型号，或把字数上限调大）"
              : "连上了，但模型没给正文",
        });
      }
      return ok({ ok: true, reply, model });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return ok({ ok: false, error: "超时 20 秒没响应" });
    return ok({ ok: false, error: `连不上：${(e as Error).message}` });
  }
}
