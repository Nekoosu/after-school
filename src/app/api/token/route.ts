import { apiToken, clearToken, hasToken, newToken } from "@/lib/apikeys";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * 令牌管理（只在设置页里用，本机单用户应用，不走令牌校验）。
 * GET    → 有没有令牌 + 令牌本身（设置页要展示）
 * POST   → {action:"new"} 生成/重置；{action:"clear"} 清掉关闭对接
 */
export function GET() {
  return ok({ has: hasToken(), token: apiToken() });
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  if (b.action === "clear") {
    clearToken();
    return ok({ has: false, token: "" });
  }
  const token = newToken();
  return ok({ has: true, token });
}
