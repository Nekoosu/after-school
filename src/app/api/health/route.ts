import { get } from "@/db";
import { ok } from "@/lib/http";
import { API_VERSION, APP_ID, APP_NAME, APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * 健康检查：不需要令牌，给启动器、监控、别的程序探活用。
 * 返回 200 且 ok:true 就代表服务和数据库都活着。
 */
export function GET() {
  const started = Date.now();
  let db = "ok";
  let students = 0;
  try {
    const row = get<{ n: number }>("select count(*) as n from student");
    students = row?.n ?? 0;
  } catch (e) {
    db = e instanceof Error ? e.message : String(e);
  }
  return ok({
    ok: db === "ok",
    app: APP_ID,
    name: APP_NAME,
    version: APP_VERSION,
    api: API_VERSION,
    db,
    students,
    time: new Date().toISOString(),
    tookMs: Date.now() - started,
  });
}
