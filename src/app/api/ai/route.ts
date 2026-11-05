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
    const timer = setTimeout(() => controller.abort(), 20000);
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
          max_tokens: 16,
          stream: false,
        }),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        return ok({ ok: false, error: `接口返回 ${res.status}：${text.slice(0, 200)}` });
      }
      let reply = "";
      try {
        reply = JSON.parse(text).choices?.[0]?.message?.content?.trim() ?? "";
      } catch {
        return ok({ ok: false, error: "返回的不是 JSON，地址一般要以 /v1 结尾" });
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
