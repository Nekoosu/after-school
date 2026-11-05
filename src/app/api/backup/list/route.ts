import { ok, fail } from "@/lib/http";
import { ensureDailyBackup, listBackups, makeBackup, backupDir } from "@/lib/backup";

export const dynamic = "force-dynamic";

/** GET /api/backup/list —— 备份列表（顺手保证今天有一份） */
export async function GET() {
  try {
    await ensureDailyBackup();
    const files = listBackups();
    return ok({
      dir: backupDir(),
      files,
      total: files.reduce((n, f) => n + f.size, 0),
      today: files.find((f) => f.kind === "auto" && f.name.startsWith("auto-" + todayStr())) ?? null,
    });
  } catch (e) {
    return fail(e);
  }
}

/** POST /api/backup/list —— 立即备份一份 */
export async function POST() {
  try {
    const file = await makeBackup("manual");
    return ok({ file, files: listBackups() });
  } catch (e) {
    return fail(e);
  }
}

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
