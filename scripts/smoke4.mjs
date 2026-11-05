// 新功能冒烟：批量反馈、拖拽改期（PATCH startAt）、该联系家长提醒
const base = process.argv[2] || "http://127.0.0.1:3314";
let pass = 0;
let fail = 0;
function ok(name, extra = "") {
  pass++;
  console.log(`PASS ${name}${extra ? " | " + extra : ""}`);
}
function bad(name, msg) {
  fail++;
  console.log(`FAIL ${name} | ${msg}`);
}
async function j(url, init) {
  const res = await fetch(base + url, init);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
const post = (u, b) => j(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
const patch = (u, b) => j(u, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

function dstr(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const today = dstr(new Date());
const tomorrow = dstr(new Date(Date.now() + 86400000));

// 1. 建两个学生：一个有课+有笔记，一个只有课没笔记（应该出现在「该联系家长」）
const a = await post("/api/students", { name: "批量甲", grade: "三年级" });
const b2 = await post("/api/students", { name: "批量乙", grade: "四年级" });
if (a.body?.id && b2.body?.id) ok("create students", `ids=${a.body.id},${b2.body.id}`);
else bad("create students", JSON.stringify(a.body));

const course = await post("/api/courses", { name: "批量课程", defaultMinutes: 90 });
const cid = course.body?.id;
if (cid) ok("create course", `cid=${cid}`);
else bad("create course", JSON.stringify(course.body));

const lesson = await post("/api/lessons", {
  courseId: cid,
  startAt: `${today} 15:00`,
  minutes: 90,
  studentIds: [a.body.id, b2.body.id],
});
if (lesson.body?.id) ok("create lesson", `id=${lesson.body.id}`);
else bad("create lesson", JSON.stringify(lesson.body));

// 2. 批量生成反馈
const batch = await post("/api/feedback/batch", { from: today, to: today });
if (batch.status === 200 && batch.body?.created === 2) ok("batch generate", `created=${batch.body.created}`);
else bad("batch generate", JSON.stringify(batch.body));

const again = await post("/api/feedback/batch", { from: today, to: today });
if (again.status === 200 && again.body?.created === 0 && again.body?.skipped === 2)
  ok("batch dedupe", `skipped=${again.body.skipped}`);
else bad("batch dedupe", JSON.stringify(again.body));

const list = await j("/api/feedback?status=draft");
if (Array.isArray(list.body) && list.body.length >= 2) ok("drafts listed", `n=${list.body.length}`);
else bad("drafts listed", JSON.stringify(list.body).slice(0, 120));

// 3. 拖拽改期：把课挪到明天，时间不变
const moved = await patch(`/api/lessons/${lesson.body.id}`, { startAt: `${tomorrow} 15:00` });
if (moved.status === 200 && moved.body?.start_at === `${tomorrow} 15:00`)
  ok("drag reschedule", moved.body.start_at);
else bad("drag reschedule", JSON.stringify(moved.body).slice(0, 140));

// 4. 该联系家长：两个学生都没笔记，应该出现在 staleStudents 里
const dash = await j("/api/dashboard");
const stale = dash.body?.staleStudents;
if (Array.isArray(stale) && stale.some((s) => s.id === a.body.id))
  ok("stale students", `n=${stale.length}`);
else bad("stale students", JSON.stringify(stale).slice(0, 140));

// 5. 清理
for (const id of [lesson.body.id]) await fetch(`${base}/api/lessons/${id}`, { method: "DELETE" });
for (const f of list.body ?? []) await fetch(`${base}/api/feedback/${f.id}`, { method: "DELETE" });
for (const id of [a.body.id, b2.body.id]) await fetch(`${base}/api/students/${id}`, { method: "DELETE" });
ok("cleanup");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
