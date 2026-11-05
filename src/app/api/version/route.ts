import { ok } from "@/lib/http";
import { API_VERSION, APP_ID, APP_NAME, APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

/** 版本号：升级检查、对接方判兼容用 */
export function GET() {
  return ok({
    ok: true,
    app: APP_ID,
    name: APP_NAME,
    version: APP_VERSION,
    api: API_VERSION,
    node: process.version,
  });
}
