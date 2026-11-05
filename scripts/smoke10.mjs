// smoke10：对接接口（health/version/token/v1）+ 从备份恢复
// 用法：node scripts/smoke10.mjs http://127.0.0.1:3319

const BASE = process.argv[2] || "http://127.0.0.1:3319";

let pass = 0;
let fail = 0;
const fails = [];

function ok(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    fails.push(name + (extra ? ` — ${extra}` : ""));
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function req(path, init) {
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { res, text, body };
}

const post = (path, data, headers = {}) =>
  req(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(data),
  });

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const tag = `对接-${Date.now() % 100000}`;

console.log(`smoke10 → ${BASE}`);

// —— 健康检查 / 版本
const h = await req("/api/health");
ok("/api/health 200", h.res.status === 200, String(h.res.status));
ok("health.ok 为 true", h.body?.ok === true, JSON.stringify(h.body));
ok("health.db 为 ok", h.body?.db === "ok", String(h.body?.db));
ok("health 带版本号", typeof h.body?.version === "string" && h.body.version.length > 0);

const v = await req("/api/version");
ok("/api/version 200 且 api=1", v.res.status === 200 && v.body?.api === 1, JSON.stringify(v.body));

// —— 没开对接时一律 403
await post("/api/token", { action: "clear" });
const denied = await req("/api/v1/summary");
ok("没开对接调 v1 返回 403", denied.res.status === 403, String(denied.res.status));

// —— 生成令牌
const gen = await post("/api/token", { action: "new" });
const token = gen.body?.token;
ok("生成令牌", gen.res.status === 200 && typeof token === "string" && token.startsWith("as_"), String(token));
ok("GET /api/token 能读到令牌", (await req("/api/token")).body?.token === token);

// —— 带令牌可以读
const sum = await req("/api/v1/summary", { headers: bearer(token) });
ok("v1/summary 200", sum.res.status === 200, String(sum.res.status));
ok(
  "summary 字段齐",
  typeof sum.body?.students === "number" &&
    typeof sum.body?.lessonsToday === "number" &&
    typeof sum.body?.revenueMonth === "number" &&
    typeof sum.body?.makeupPending === "number" &&
    typeof sum.body?.lowBalance === "number",
  JSON.stringify(sum.body),
);

const wrong = await req("/api/v1/summary", { headers: bearer("as_0000") });
ok("令牌不对返回 401", wrong.res.status === 401, String(wrong.res.status));

const qToken = await req(`/api/v1/summary?token=${token}`);
ok("?token= 也能用", qToken.res.status === 200, String(qToken.res.status));

// —— 学生
const list = await req("/api/v1/students", { headers: bearer(token) });
ok("v1/students 200", list.res.status === 200 && Array.isArray(list.body?.students), String(list.res.status));
ok("学生里带余额字段", list.body.students.every((s) => "balance_minutes" in s));

const created = await post("/api/v1/students", { name: `${tag}学生`, grade: "三年级" }, bearer(token));
ok("v1 新建学生 201", created.res.status === 201, created.text.slice(0, 120));
const sid = created.body?.id;

const one = await req(`/api/v1/students/${sid}`, { headers: bearer(token) });
ok("v1 学生详情 200", one.res.status === 200, String(one.res.status));
ok("详情带余额与最近学情", typeof one.body?.balanceMinutes === "number" && Array.isArray(one.body?.recentNotes));
ok("详情带接下来的课（数组）", Array.isArray(one.body?.upcomingLessons));

const missing = await req("/api/v1/students/999999", { headers: bearer(token) });
ok("不存在的学生 404", missing.res.status === 404, String(missing.res.status));

// —— 学情
const note = await post(
  "/api/v1/notes",
  { studentId: sid, content: `${tag}：分数乘法学得不错`, topic: "分数乘法", level: 4 },
  bearer(token),
);
ok("v1 写学情 201", note.res.status === 201, note.text.slice(0, 160));
ok("学情存了 topic/level", note.body?.topic === "分数乘法" && note.body?.level === 4, JSON.stringify(note.body));

const notes = await req(`/api/v1/notes?studentId=${sid}`, { headers: bearer(token) });
ok("v1 读学情", notes.body?.count >= 1 && notes.body.notes[0].topic === "分数乘法", JSON.stringify(notes.body?.count));

const badLevel = await post("/api/v1/notes", { studentId: sid, content: "x", level: 99 }, bearer(token));
ok("level 超范围当没打分", badLevel.res.status === 201 && badLevel.body?.level === null, JSON.stringify(badLevel.body));

const noContent = await post("/api/v1/notes", { studentId: sid }, bearer(token));
ok("学情没内容返回 400", noContent.res.status === 400, String(noContent.res.status));

// —— 课表
const today = new Date();
const p = (n) => String(n).padStart(2, "0");
const day = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
const lessons = await req(`/api/v1/lessons?from=${day}&to=${day}`, { headers: bearer(token) });
ok("v1/lessons 200", lessons.res.status === 200 && Array.isArray(lessons.body?.lessons));
ok("课表行里有学生名串", lessons.body.lessons.every((l) => typeof l.student_names === "string" || l.student_names === null));

// —— 从备份恢复
const bk = await post("/api/backup/list", {});
ok("先做一份手动备份", bk.res.status === 200 && Array.isArray(bk.body?.files), String(bk.res.status));
const manual = bk.body.files.find((f) => f.kind === "manual");
ok("备份列表里有手动备份", !!manual, JSON.stringify(bk.body.files?.slice(0, 2)));

const marker = await post("/api/students", { name: `${tag}恢复标记` });
ok("恢复前加一个标记学生", marker.res.status === 201, String(marker.res.status));
const markerId = marker.body?.id;

// 用 /api/health 的数（含已离开的学生）做基准，/api/students 只返回在读的
const beforeCount = (await req("/api/health")).body?.students ?? 0;

const restored = await post("/api/restore", { file: manual.name });
ok("恢复接口 200", restored.res.status === 200, restored.text.slice(0, 200));
ok("恢复结果带安全备份名", typeof restored.body?.safetyBackup === "string", JSON.stringify(restored.body));
ok("安全备份不是被恢复的那一份（同秒也不覆盖）", restored.body?.safetyBackup !== manual.name, `${restored.body?.safetyBackup} vs ${manual.name}`);
ok("恢复的就是点的那份", restored.body?.restoredFrom === manual.name, String(restored.body?.restoredFrom));
ok("恢复后学生数回到备份时", restored.body?.students === beforeCount - 1, `${restored.body?.students} vs ${beforeCount}`);

const after = await req("/api/students");
ok("标记学生已经不在（恢复生效）", !after.body?.some((s) => s.id === markerId), JSON.stringify(after.body?.map((s) => s.name)));
ok("恢复后服务还活着", (await req("/api/health")).body?.ok === true);

const badFile = await post("/api/restore", { file: "../../package.json" });
ok("越界文件名被拒", badFile.res.status === 400, String(badFile.res.status));

const noFile = await post("/api/restore", { file: "auto-1999-01-01-0000.db" });
ok("不存在的备份被拒", noFile.res.status === 400, String(noFile.res.status));

// —— 页面
const pDocs = await req("/docs");
ok("/docs 200", pDocs.res.status === 200, String(pDocs.res.status));
ok("文档页有接口一览", pDocs.text.includes("接口一览"));
ok("文档页有令牌说明", pDocs.text.includes("Authorization: Bearer"));

const pSettings = await req("/settings");
ok("/settings 200", pSettings.res.status === 200, String(pSettings.res.status));

// —— 收尾：关掉对接，别把令牌留在别人机器上
await post("/api/token", { action: "clear" });
ok("关闭对接后又变 403", (await req("/api/v1/summary")).res.status === 403);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("失败项：\n" + fails.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
