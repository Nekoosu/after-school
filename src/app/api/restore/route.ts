import { restoreFromBackup } from "@/lib/restore";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 恢复备份：body {file: "auto-2026-11-05-0142.db"} */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const file = String(b?.file ?? "").trim();
    if (!file) throw new Error("要指定要恢复的备份文件名");
    return ok(await restoreFromBackup(file));
  } catch (e) {
    return fail(e, 400);
  }
}
