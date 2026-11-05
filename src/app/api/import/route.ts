import { get, run, tx } from "@/db";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

type Scope = "plans" | "classes" | "students";

interface Report {
  ok: true;
  scope: Scope;
  dryRun: boolean;
  created: number;
  skipped: number;
  errors: { index: number; name: string; reason: string }[];
  courseCreated: number;
}

/** 兼容驼峰/下划线两种写法——导出文件里两种都有 */
function pick(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function num(v: string, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function courseIdOf(name: string, create: boolean, rep: Report): number | null {
  if (!name) return null;
  const hit = get<{ id: number }>(`select id from course where name = ? collate nocase limit 1`, [name]);
  if (hit) return hit.id;
  if (!create) return null;
  const r = run(`insert into course (name) values (?)`, [name]);
  rep.courseCreated += 1;
  return Number(r.lastInsertRowid);
}

/**
 * 导入。只接受 JSON 数组（导出文件里的 rows 直接粘进来就行）。
 * 一律「先检查再写入」：dryRun=true 时只报账，不落库。
 * 名字重复的一律跳过而不是覆盖——覆盖会悄悄改掉已有数据，比报错可怕。
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      scope?: Scope;
      rows?: unknown;
      dryRun?: boolean;
      createCourses?: boolean;
    };
    const scope = body.scope;
    if (scope !== "plans" && scope !== "classes" && scope !== "students") {
      return fail("scope 只能是 plans / classes / students", 400);
    }
    const rows = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : null;
    if (!rows) return fail("rows 必须是一个数组，把导出的 JSON 里的 rows 整段贴进来", 400);
    if (rows.length === 0) return fail("rows 是空的", 400);
    if (rows.length > 2000) return fail("一次最多导入 2000 条", 400);

    const dryRun = body.dryRun !== false;
    const createCourses = body.createCourses !== false;
    const rep: Report = { ok: true, scope, dryRun, created: 0, skipped: 0, errors: [], courseCreated: 0 };

    const work = () => {
      rows.forEach((raw, i) => {
        const name = pick(raw, ["title", "name", "姓名", "标题"]);
        try {
          if (scope === "plans") importPlan(raw, rep);
          else if (scope === "students") importStudent(raw, rep);
          else importClass(raw, rep, createCourses);
        } catch (e) {
          rep.errors.push({ index: i, name: name || `第 ${i + 1} 条`, reason: (e as Error).message });
        }
      });
      if (dryRun) throw new DryRunRollback();
    };

    try {
      tx(work);
    } catch (e) {
      if (!(e instanceof DryRunRollback)) throw e;
    }

    return ok(rep);
  } catch (e) {
    return fail(e, 500);
  }
}

/** dryRun 时用它把事务整体回滚，省得写一堆分支 */
class DryRunRollback extends Error {
  constructor() {
    super("dry-run");
  }
}

function importPlan(raw: Record<string, unknown>, rep: Report) {
  const title = pick(raw, ["title", "标题"]);
  const content = pick(raw, ["content", "内容", "正文"]);
  if (!title) throw new Error("缺标题");
  if (!content) throw new Error("缺内容");

  const dup = get<{ id: number }>(`select id from teach_plan where title = ? collate nocase limit 1`, [title]);
  if (dup) {
    rep.skipped += 1;
    return;
  }

  const courseName = pick(raw, ["course", "课程"]);
  const courseId = courseIdOf(courseName, true, rep);
  run(
    `insert into teach_plan (course_id, title, topic, content, minutes, tags) values (?,?,?,?,?,?)`,
    [
      courseId,
      title,
      pick(raw, ["topic", "主题"]) || null,
      content,
      num(pick(raw, ["minutes", "时长"])) || null,
      pick(raw, ["tags", "标签"]) || null,
    ],
  );
  rep.created += 1;
}

function importStudent(raw: Record<string, unknown>, rep: Report) {
  const name = pick(raw, ["name", "姓名"]);
  if (!name) throw new Error("缺姓名");

  const dup = get<{ id: number }>(`select id from student where name = ? collate nocase limit 1`, [name]);
  if (dup) {
    rep.skipped += 1;
    return;
  }
  run(
    `insert into student (name, gender, grade, school, guardian_name, guardian_phone, guardian_wechat, note, joined_at)
     values (?,?,?,?,?,?,?,?,?)`,
    [
      name,
      pick(raw, ["gender", "性别"]) || null,
      pick(raw, ["grade", "年级"]) || null,
      pick(raw, ["school", "学校"]) || null,
      pick(raw, ["guardianName", "guardian_name", "家长"]) || null,
      pick(raw, ["guardianPhone", "guardian_phone", "电话"]) || null,
      pick(raw, ["guardianWechat", "guardian_wechat", "微信"]) || null,
      pick(raw, ["note", "备注"]) || null,
      new Date().toISOString().slice(0, 10),
    ],
  );
  rep.created += 1;
}

function importClass(raw: Record<string, unknown>, rep: Report, createCourses: boolean) {
  const name = pick(raw, ["name", "班级", "name_zh"]);
  if (!name) throw new Error("缺班级名");

  const courseName = pick(raw, ["course", "课程"]);
  if (!courseName) throw new Error("缺课程名（班级必须挂在课程下）");
  const courseId = courseIdOf(courseName, createCourses, rep);
  if (!courseId) throw new Error(`课程「${courseName}」还不存在，先建课程或勾选「课程不存在就新建」`);

  const weekdayRaw = pick(raw, ["weekday", "星期"]);
  const weekday = weekdayRaw === "" ? null : Math.max(0, Math.min(6, num(weekdayRaw)));
  const startTime = pick(raw, ["start_time", "startTime", "上课时间"]) || null;
  const minutes = num(pick(raw, ["minutes", "时长"])) || null;
  const room = pick(raw, ["room", "教室"]) || null;

  const dup = get<{ id: number }>(
    `select id from class_group where name = ? collate nocase and ifnull(weekday,-1) = ifnull(?,-1)
        and ifnull(start_time,'') = ifnull(?,'') limit 1`,
    [name, weekday, startTime],
  );
  if (dup) {
    rep.skipped += 1;
    return;
  }

  const classId = Number(
    run(`insert into class_group (name, course_id, weekday, start_time, minutes, room) values (?,?,?,?,?,?)`, [
      name,
      courseId,
      weekday,
      startTime,
      minutes,
      room,
    ]).lastInsertRowid,
  );
  rep.created += 1;

  const members = Array.isArray(raw.members) ? (raw.members as unknown[]) : [];
  const missing: string[] = [];
  for (const m of members) {
    const n = String(m ?? "").trim();
    if (!n) continue;
    const hit = get<{ id: number }>(`select id from student where name = ? collate nocase and status = 'active' limit 1`, [n]);
    if (!hit) {
      missing.push(n);
      continue;
    }
    run(
      `insert or ignore into enrollment (student_id, course_id, class_id) values (?,?,?)`,
      [hit.id, courseId, classId],
    );
  }
  if (missing.length > 0) {
    rep.errors.push({ index: -1, name, reason: `班级建好了，但这些学生没找到：${missing.join("、")}` });
  }
}
