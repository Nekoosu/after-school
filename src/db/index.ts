import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DDL } from "./ddl";

/**
 * 数据库连接（单例，热重载安全）
 * 数据文件：<项目根>/data/app.db —— 备份就复制这个目录
 */

const globalForDb = globalThis as unknown as { __asSqlite?: Database.Database };

/** 进程退出钩子只挂一次（热重载/重开连接时不要重复挂） */
let trapped = false;

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
  // WAL 下 synchronous 显式给 FULL：断电/强制结束时也不丢已提交的数据（慢一点点，这个规模感知不到）
  db.pragma("synchronous = FULL");
  db.pragma("foreign_keys = ON");
  db.exec(DDL);

  // 结构性小增量（新库建表已含，旧库靠这里补）
  ensureColumn(db, "lesson", "plan_id", "INTEGER REFERENCES teach_plan(id)");
  ensureColumn(db, "student", "tags", "TEXT");
  ensureColumn(db, "course", "teacher_id", "INTEGER REFERENCES teacher(id)");
  ensureColumn(db, "lesson", "teacher_id", "INTEGER REFERENCES teacher(id)");
  ensureColumn(db, "lesson", "price_per_hour", "REAL");
  ensureColumn(db, "hours_ledger", "unit_price", "REAL");
  ensureColumn(db, "hours_ledger", "amount", "REAL");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_note_student_time  ON note(student_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lesson_start       ON lesson(start_at);
    CREATE INDEX IF NOT EXISTS idx_lesson_status      ON lesson(status, start_at);
    CREATE INDEX IF NOT EXISTS idx_lesson_teacher     ON lesson(teacher_id, start_at);
    CREATE INDEX IF NOT EXISTS idx_ledger_student     ON hours_ledger(student_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_payment_paid       ON payment(paid_at);
    CREATE INDEX IF NOT EXISTS idx_att_student        ON attendance(student_id, status);
  `);

  // 桌面版兜底：正常关窗口走 /api/shutdown；这一层管「被强杀、注销、收到信号」的情况，
  // 退出前尽量把 WAL 收进主库文件，下次打开不丢东西。
  if (process.env.AS_LAUNCHED === "1" && !trapped) {
    trapped = true;
    const flush = () => {
      try {
        db.pragma("wal_checkpoint(TRUNCATE)");
      } catch {
        // 已经关了就算了
      }
    };
    process.on("exit", flush);
    (["SIGINT", "SIGTERM", "SIGHUP"] as const).forEach((sig) => {
      process.on(sig, () => {
        flush();
        process.exit(0);
      });
    });
  }
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
