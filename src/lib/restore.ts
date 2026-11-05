import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { get, reopenDb } from "@/db";
import { backupPath, makeBackup } from "./backup";

/**
 * 从备份文件恢复数据。
 * 步骤：
 * 1. 校验文件名（backupPath 只放行 backups 目录里的 auto-… 和 manual-… 两种）；
 * 2. 先用只读连接探一下这份文件像不像本系统的库（挡住选错文件）；
 * 3. 把当前库再备份一份（恢复前快照，恢复错了还能回来）；
 * 4. 关掉连接 → 复制备份文件盖掉 data/app.db → 清掉残留 wal/shm → 重开连接。
 */

export interface RestoreResult {
  ok: true;
  restoredFrom: string;
  safetyBackup: string;
  students: number;
}

export async function restoreFromBackup(name: string): Promise<RestoreResult> {
  const src = backupPath(name);
  if (!src) {
    throw new Error("找不到这份备份（只能恢复 backups 目录里的 auto-*.db / manual-*.db）");
  }

  const probe = new Database(src, { readonly: true, fileMustExist: true });
  let tables = 0;
  try {
    const row = probe.prepare("select count(*) as n from sqlite_master where type='table'").get() as {
      n: number;
    };
    tables = row?.n ?? 0;
    if (tables < 10) {
      throw new Error(`这份文件不像本系统的数据库（只有 ${tables} 张表），没有做任何改动`);
    }
  } finally {
    probe.close();
  }

  // 恢复前快照：把「现在」先存起来
  const safety = await makeBackup("manual");

  const dataDir = path.join(process.cwd(), "data");
  const dbFile = path.join(dataDir, "app.db");
  fs.mkdirSync(dataDir, { recursive: true });

  reopenDb(); // 关连接（顺手 checkpoint），Windows 才允许覆盖
  try {
    fs.copyFileSync(src, dbFile);
  } catch (e) {
    // 覆盖失败也要把连接重新打开，别把服务留在断连状态
    reopenDb();
    throw e instanceof Error ? e : new Error(String(e));
  }
  for (const ext of ["-wal", "-shm"]) {
    try {
      fs.unlinkSync(dbFile + ext);
    } catch {
      /* 没有残留就算了 */
    }
  }
  reopenDb(); // 重开并跑一遍 DDL/补列（旧版本备份也能升上来）

  const students = get<{ n: number }>("select count(*) as n from student")?.n ?? 0;
  return { ok: true, restoredFrom: src.split(path.sep).pop() || name, safetyBackup: safety.name, students };
}
