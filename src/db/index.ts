import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DDL } from "./ddl";

/**
 * 数据库连接（单例，热重载安全）
 * 数据文件：<项目根>/data/app.db —— 备份就复制这个目录
 */

const globalForDb = globalThis as unknown as { __asSqlite?: Database.Database };

/** 增量加列：SQLite 的 ALTER TABLE 没有 IF NOT EXISTS，用 PRAGMA 先探一下 */
function ensureColumn(db: Database.Database, table: string, column: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

function create(): Database.Database {
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, "app.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(DDL);

  // 结构性小增量（新库建表已含，旧库靠这里补）
  ensureColumn(db, "lesson", "plan_id", "INTEGER REFERENCES teach_plan(id)");
  ensureColumn(db, "student", "tags", "TEXT");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_note_student_time  ON note(student_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lesson_start       ON lesson(start_at);
    CREATE INDEX IF NOT EXISTS idx_lesson_status      ON lesson(status, start_at);
    CREATE INDEX IF NOT EXISTS idx_ledger_student     ON hours_ledger(student_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_payment_paid       ON payment(paid_at);
    CREATE INDEX IF NOT EXISTS idx_att_student        ON attendance(student_id, status);
  `);
  return db;
}

export function sqlite(): Database.Database {
  if (!globalForDb.__asSqlite) globalForDb.__asSqlite = create();
  return globalForDb.__asSqlite;
}

/**
 * 关掉并重建连接。恢复备份后必须用它：
 * Windows 上文件被 SQLite 打开着就覆盖不了，要先 close 再复制再重开。
 */
export function reopenDb(): void {
  try {
    const db = globalForDb.__asSqlite;
    if (db) {
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();
    }
  } catch {
    /* 已经关了或关不上都无所谓，下面会重新开 */
  }
  globalForDb.__asSqlite = undefined;
  sqlite();
}

/** 查询多行 */
export function all<T>(sql: string, params: unknown[] = []): T[] {
  return sqlite().prepare(sql).all(...params) as T[];
}

/** 查询单行（没有返回 undefined） */
export function get<T>(sql: string, params: unknown[] = []): T | undefined {
  return sqlite().prepare(sql).get(...params) as T | undefined;
}

/** 写操作，返回 changes / lastInsertRowid */
export function run(sql: string, params: unknown[] = []): Database.RunResult {
  return sqlite().prepare(sql).run(...params);
}

/** 事务：回调里抛错则整体回滚。注意这里是同步函数 */
export function tx<T>(fn: () => T): T {
  return sqlite().transaction(fn)();
}

/** 读设置项 */
export function setting(key: string, fallback = ""): string {
  const row = get<{ value: string }>("select value from setting where key = ?", [key]);
  return row?.value ?? fallback;
}
