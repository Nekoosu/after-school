import { get } from "@/db";
import { ok } from "@/lib/http";
import { API_VERSION, APP_ID, APP_NAME, APP_VERSION } from "@/lib/version";
import { licenseState } from "@/lib/license";

export const dynamic = "force-dynamic";

/**
 * 健康检查：不需要令牌，给启动器、监控、别的程序探活用。
 * 返回 200 且 ok:true 就代表服务和数据库都活着。
 * 1.8.13 起附带授权摘要：licensed（已激活？）/ trialDays（试用还剩几天，licensed 时为 null）。
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
  let licensed = "0";
  let daysLeft: number | null = 0;
  try {
    const st = licenseState();
    licensed = st.mode === "licensed" ? "1" : "0";
    daysLeft = st.daysLeft;
  } catch {
    daysLeft = 0;
  }
  return ok({
    ok: db === "ok",
    app: APP_ID,
    name: APP_NAME,
    version: APP_VERSION,
    api: API_VERSION,
    db,
    students,
    licensed,
    trialDays: daysLeft,
    time: new Date().toISOString(),
    tookMs: Date.now() - started,
  });
}
