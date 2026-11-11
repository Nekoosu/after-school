import { sqlite } from "@/db";
import { makeBackup } from "@/lib/backup";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * 优雅关机：只有桌面启动器（设置了 AS_LAUNCHED=1）会来调。
 * 桌面窗口关闭 → 启动器 POST 这里 → 先存一份退出快照 → WAL 收进主库文件 → node 自己退出。
 * 直接在浏览器里手动调是不行的，避免网页开着开着服务就没了。
 */
export async function POST() {
  if (process.env.AS_LAUNCHED !== "1") {
    return fail(new Error("只有桌面版启动器才会用到这个接口"), 403);
  }
  let snapshot = "";
  try {
    // 关窗口前留一份 auto 备份：真出事了也能从「备份」里找回来
    snapshot = (await makeBackup("auto")).name;
  } catch {
    // 备份失败不能挡住退出——数据本身在 SQLite 里，checkpoint 才是关键
  }
  try {
    sqlite().pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    // 就算 checkpoint 失败，也照常退出——WAL 里的数据 SQLite 自己会恢复
  }
  setTimeout(() => process.exit(0), 200);
  return ok({ ok: true, bye: true, snapshot });
}
