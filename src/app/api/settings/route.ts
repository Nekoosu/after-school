import { NextRequest } from "next/server";
import { all, run, setting } from "@/db";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 全部设置项，返回扁平对象 */
export function GET() {
  const rows = all<{ key: string; value: string }>("select key, value from setting");
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return ok(map);
}

/** 批量更新：body 里出现哪个 key 就更新哪个 */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return fail("请求内容不是有效对象");
  const entries = Object.entries(body).filter(([, v]) => typeof v === "string" || typeof v === "number");
  if (!entries.length) return fail("没有要保存的设置项");
  for (const [k, v] of entries) {
    run(
      "insert into setting (key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
      [k, String(v)],
    );
  }
  return ok({ saved: entries.length, org_name: setting("org_name") });
}
