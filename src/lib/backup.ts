import fs from "node:fs";
import path from "node:path";
import { sqlite } from "@/db";

/**
 * 自动备份
 * - 每天第一次打开系统时自动存一份到 <项目根>/backups
 * - 只保留最近 30 份自动备份，手动的永远不删
 * - 用 SQLite 官方 backup 接口，服务在跑的时候也安全
 */

const KEEP_AUTO = 30;

export interface BackupFile {
  name: string;
  size: number;
  mtime: string;
  kind: "auto" | "manual";
}

export function backupDir(): string {
  const dir = path.join(process.cwd(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 只允许备份目录里的 .db 文件名，挡住 ../ 之类；兼容旧的 4 位时分与新的 6 位时分秒 */
export function backupPath(name: string): string | null {
  const safe = path.basename(name);
  if (!/^(auto|manual)-\d{4}-\d{2}-\d{2}-\d{4}(\d{2})?(-\d+)?\.db$/.test(safe)) return null;
  const full = path.join(backupDir(), safe);
  return fs.existsSync(full) ? full : null;
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(
    d.getSeconds(),
  )}`;
}

/**
 * 同一秒内连点两次也不覆盖前一份（恢复前快照就靠这个，
 * 不然它会把要恢复的那份盖掉，结果「恢复成功但什么都没变」）。
 */
function freshName(dir: string, kind: "auto" | "manual"): string {
  const base = `${kind}-${stamp()}`;
  let name = `${base}.db`;
  let i = 2;
  while (fs.existsSync(path.join(dir, name))) {
    name = `${base}-${i}.db`;
    i++;
  }
  return name;
}

function todayStr(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function listBackups(): BackupFile[] {
  const dir = backupDir();
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".db"))
    .map((n) => {
      const st = fs.statSync(path.join(dir, n));
      return {
        name: n,
        size: st.size,
        mtime: new Date(st.mtimeMs).toISOString(),
        kind: n.startsWith("auto-") ? ("auto" as const) : ("manual" as const),
      };
    })
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
}

/** 立即备份一份，返回文件名 */
export async function makeBackup(kind: "auto" | "manual" = "manual"): Promise<BackupFile> {
  const dir = backupDir();
  const name = freshName(dir, kind);
  const target = path.join(dir, name);
  await sqlite().backup(target);
  prune();
  const st = fs.statSync(target);
  return { name, size: st.size, mtime: new Date(st.mtimeMs).toISOString(), kind };
}

/** 自动备份只留最近 30 份 */
export function prune(keep = KEEP_AUTO): number {
  const autos = listBackups().filter((b) => b.kind === "auto");
  let removed = 0;
  for (const b of autos.slice(keep)) {
    try {
      fs.unlinkSync(path.join(backupDir(), b.name));
      removed++;
    } catch {
      /* 删不掉就算了，下次再说 */
    }
  }
  return removed;
}

/**
 * 删掉一份备份（手动清理用）。
 * 只接受 backups 目录里、名字合规的 .db；顺带把它的 -wal / -shm 残留一起清掉，
 * 否则下次恢复会拿到一个「数据库没关干净」的文件。
 */
export function removeBackup(name: string): { removed: string; left: number; freed: number } {
  const full = backupPath(name);
  if (!full) throw new Error("找不到这份备份，或者文件名不对");
  const freed = fs.statSync(full).size;
  fs.rmSync(full, { force: true });
  for (const ext of ["-wal", "-shm"]) {
    try {
      fs.rmSync(full + ext, { force: true });
    } catch {
      /* 残留删不掉不影响主流程 */
    }
  }
  return { removed: path.basename(full), left: listBackups().length, freed };
}

let lastCheck = "";

/**
 * 惰性触发：每次 API 调用顺手看一眼今天有没有备份过。
 * 同一进程内 10 分钟最多查一次目录，不会拖慢接口。
 */
export async function ensureDailyBackup(): Promise<void> {
  const now = Date.now();
  if (lastCheck && now - Number(lastCheck) < 10 * 60 * 1000) return;
  lastCheck = String(now);
  const today = todayStr();
  if (listBackups().some((b) => b.kind === "auto" && b.name.startsWith(`auto-${today}`))) return;
  try {
    await makeBackup("auto");
  } catch {
    /* 备份失败不能影响正常使用 */
  }
}
