import { activateWith, licenseState } from "@/lib/license";
import { ok, fail } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * GET  → 当前授权状态（试用还剩几天 / 已激活 / 已锁）
 * POST → 用激活码激活，body: { cdk: "AS1...." }
 * 白名单接口：middleware 放行它，锁住时壳的激活窗口也靠它。
 */
export async function GET() {
  try {
    return ok(licenseState());
  } catch (e) {
    return fail(e, 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { cdk?: string };
    const cdk = String(body?.cdk || "").trim();
    if (!cdk) return ok({ ok: false, error: "把激活码粘进来再点激活。" });
    const res = activateWith(cdk);
    return ok(res);
  } catch (e) {
    return fail(e, 400);
  }
}
