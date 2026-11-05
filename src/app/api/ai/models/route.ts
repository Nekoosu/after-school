import { setting } from "@/db";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/models —— 拉一次 /models，让设置页可以「自动获取模型名」，不用手打。
 * 传了 base/key 就用传的（还没保存也能试），没传就用已经存下的。
 * 一律回 ok({ok:false,error})，不抛 500：拉不到模型名不是致命错误，手填就行。
 */
export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    const base = String(b.base || setting("ai_base", "") || "https://api.deepseek.com/v1").replace(/\/+$/, "");
    const key = String(b.key || setting("ai_key", "") || "");
    if (!base) return ok({ ok: false, error: "先填接口地址，一般以 /v1 结尾" });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${base}/models`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        return ok({
          ok: false,
          error:
            res.status === 404
              ? "这个地址没有 /models 接口（有些服务不支持），模型名手填一下"
              : `接口返回 ${res.status}：${text.slice(0, 160)}`,
        });
      }
      let json: { data?: Array<{ id?: string }> };
      try {
        json = JSON.parse(text);
      } catch {
        return ok({ ok: false, error: "返回的不是 JSON，地址一般要以 /v1 结尾" });
      }
      const models = (json.data ?? [])
        .map((m) => String(m.id ?? "").trim())
        .filter(Boolean)
        .sort((a, c) => a.localeCompare(c));
      if (models.length === 0) return ok({ ok: false, error: "这个接口没回任何模型名，手填吧" });
      return ok({ ok: true, models, base });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return ok({ ok: false, error: "超时 15 秒没响应" });
    return ok({ ok: false, error: `连不上：${(e as Error).message}` });
  }
}
