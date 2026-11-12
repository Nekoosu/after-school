// ============================================================
// 建表 DDL（幂等：IF NOT EXISTS，首次启动自动执行）
// 改表结构 = 改这一个文件 + 同步改 schema.ts 的类型定义
// 铁律见 AGENTS.md：课时余额永远由 hours_ledger 求和，禁止存余额字段
// ============================================================

export const DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS student (
  id             INTEGER PRIMARY KEY,
  name           TEXT    NOT NULL,
  gender         TEXT,
  grade          TEXT,
  school         TEXT,
  guardian_name  TEXT,
  guardian_phone TEXT,
  guardian_wechat TEXT,
  note           TEXT,
  status         TEXT    NOT NULL DEFAULT 'active',
  joined_at      TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_student_status ON student(status);

-- 老师：一个课后班可能不止一位老师，学生的课要挂到具体老师名下
CREATE TABLE IF NOT EXISTS teacher (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  phone      TEXT,
  subject    TEXT,
  color      TEXT    DEFAULT '#7c5cff',
  note       TEXT,
  status     TEXT    NOT NULL DEFAULT 'active',
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_teacher_status ON teacher(status);

CREATE TABLE IF NOT EXISTS course (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL,
  subject         TEXT,
  default_minutes INTEGER NOT NULL DEFAULT 90,
  price_per_lesson REAL,
  color           TEXT    DEFAULT '#3b82f6',
  teacher_id      INTEGER REFERENCES teacher(id),
  status          TEXT    NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS class_group (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  course_id  INTEGER NOT NULL REFERENCES course(id),
  weekday    INTEGER,
  start_time TEXT,
  minutes    INTEGER,
  room       TEXT,
  status     TEXT    NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS enrollment (
  id         INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES student(id) ON DELETE CASCADE,
  course_id  INTEGER NOT NULL REFERENCES course(id),
  class_id   INTEGER REFERENCES class_group(id) ON DELETE SET NULL,
  status     TEXT    NOT NULL DEFAULT 'active',
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (student_id, course_id, class_id)
);
CREATE INDEX IF NOT EXISTS idx_enroll_student ON enrollment(student_id);

CREATE TABLE IF NOT EXISTS lesson (
  id         INTEGER PRIMARY KEY,
  course_id  INTEGER NOT NULL REFERENCES course(id),
  class_id   INTEGER REFERENCES class_group(id) ON DELETE SET NULL,
  teacher_id INTEGER REFERENCES teacher(id),
  title      TEXT,
  start_at   TEXT    NOT NULL,
  minutes    INTEGER NOT NULL DEFAULT 90,
  room       TEXT,
  status     TEXT    NOT NULL DEFAULT 'planned',
  note       TEXT,
  -- 这节课的课消单价（元/小时）；空就按学生买的那个班型的单价
  price_per_hour REAL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_lesson_start ON lesson(start_at);
CREATE INDEX IF NOT EXISTS idx_lesson_status ON lesson(status);

-- 一次课的直接参与学生（建课/补课时显式选定；选班只是自动填入班成员）
CREATE TABLE IF NOT EXISTS lesson_student (
  id         INTEGER PRIMARY KEY,
  lesson_id  INTEGER NOT NULL REFERENCES lesson(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES student(id) ON DELETE CASCADE,
  UNIQUE (lesson_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_lesson_student_student ON lesson_student(student_id);

CREATE TABLE IF NOT EXISTS attendance (
  id             INTEGER PRIMARY KEY,
  lesson_id      INTEGER NOT NULL REFERENCES lesson(id) ON DELETE CASCADE,
  student_id     INTEGER NOT NULL REFERENCES student(id) ON DELETE CASCADE,
  status         TEXT    NOT NULL DEFAULT 'present',
  billed_minutes INTEGER NOT NULL DEFAULT 0,
  note           TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (lesson_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_att_student ON attendance(student_id);

CREATE TABLE IF NOT EXISTS hours_ledger (
  id            INTEGER PRIMARY KEY,
  student_id    INTEGER NOT NULL REFERENCES student(id) ON DELETE CASCADE,
  course_id     INTEGER REFERENCES course(id),
  delta_minutes INTEGER NOT NULL,
  kind          TEXT    NOT NULL,
  ref_id        INTEGER,
  remark        TEXT,
  -- 钱：purchase 时 amount 是收的钱，consume 时 amount 是这次课消的钱（负数）
  -- unit_price 是当时的元/小时，记下来就不会因为以后调价把老账算错
  unit_price    REAL,
  amount        REAL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_student ON hours_ledger(student_id, created_at);

CREATE TABLE IF NOT EXISTS note (
  id         INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES student(id) ON DELETE CASCADE,
  lesson_id  INTEGER REFERENCES lesson(id) ON DELETE SET NULL,
  kind       TEXT    NOT NULL DEFAULT 'progress',
  topic      TEXT,
  level      INTEGER,
  content    TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_note_student ON note(student_id, created_at);
CREATE INDEX IF NOT EXISTS idx_note_lesson ON note(lesson_id);

CREATE TABLE IF NOT EXISTS feedback (
  id           INTEGER PRIMARY KEY,
  student_id   INTEGER NOT NULL REFERENCES student(id) ON DELETE CASCADE,
  period_start TEXT,
  period_end   TEXT,
  content      TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'draft',
  sent_at      TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_student ON feedback(student_id, created_at);

CREATE TABLE IF NOT EXISTS payment (
  id         INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES student(id),
  amount     REAL    NOT NULL,
  minutes    INTEGER,
  method     TEXT,
  paid_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  remark     TEXT
);

-- 教案库：自己积累的讲义/知识点，排课时可挂到某一节课上
CREATE TABLE IF NOT EXISTS teach_plan (
  id         INTEGER PRIMARY KEY,
  course_id  INTEGER REFERENCES course(id),
  title      TEXT    NOT NULL,
  topic      TEXT,
  content    TEXT    NOT NULL,
  minutes    INTEGER,
  tags       TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_plan_course ON teach_plan(course_id);

CREATE TABLE IF NOT EXISTS setting (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE VIEW IF NOT EXISTS v_student_balance AS
SELECT
  s.id   AS student_id,
  s.name,
  s.status,
  COALESCE(SUM(l.delta_minutes), 0)                  AS balance_minutes,
  ROUND(COALESCE(SUM(l.delta_minutes), 0) / 60.0, 1) AS balance_hours
FROM student s
LEFT JOIN hours_ledger l ON l.student_id = s.id
GROUP BY s.id, s.name, s.status;

CREATE VIEW IF NOT EXISTS v_makeup_pending AS
SELECT
  a.student_id,
  s.name AS student_name,
  l.id   AS lesson_id,
  l.start_at,
  l.course_id
FROM attendance a
JOIN student s ON s.id = a.student_id
JOIN lesson  l ON l.id = a.lesson_id
WHERE a.status = 'leave'
  AND NOT EXISTS (
    SELECT 1 FROM attendance a2
    JOIN lesson l2 ON l2.id = a2.lesson_id
    WHERE a2.student_id = a.student_id
      AND a2.status = 'makeup'
      AND l2.start_at > l.start_at
  );

INSERT OR IGNORE INTO setting (key, value) VALUES
  ('org_name', '我的课后服务中心'),
  ('org_phone', ''),
  ('teacher_name', ''),
  ('org_address', ''),
  ('lesson_default_minutes', '90'),
  ('low_balance_minutes', '450'),
  ('week_start', '1'),
  ('ai_enabled', '0'),
  ('ai_base', 'https://api.deepseek.com/v1'),
  ('ai_model', 'deepseek-chat'),
  ('ai_key', ''),
  ('api_token', ''),
  ('feedback_tone', 'plain'),
  ('update_url', 'https://gitee.com/nekoosuu/after-school-updates/raw/master/update.json');
`;
