/**
 * 冒烟 11：家长分享链接 + 反馈语气
 * 用法：node scripts\smoke11.mjs http://127.0.0.1:3319
 */
const BASE = process.argv[2] || "http://127.0.0.1:3319";

let passed = 0;
let failed = 0;

function ok(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log("  ✔ " + name);
  } else {
    failed++;
    console.log("  ✘ " + name + (extra ? " → " + extra : ""));
  }
}

async function req(path, init) {
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { res, body, text };
}

const post = (path, body) =>
  req(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const patch = (path, body) =>
  req(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const del = (path) => req(path, { method: "DELETE" });

const tag = `测${Date.now().toString().slice(-6)}`;

console.log("== 分享链接 ==");

const stu = await post("/api/students", { name: `${tag}分享生` });
ok("建学生 201", stu.res.status === 201, stu.text.slice(0, 160));
const sid = stu.body?.id;

const bad1 = await req("/api/share/link?id=0");
ok("学生编号 0 被拒", bad1.res.status === 400, String(bad1.res.status));

const miss = await req("/api/share/link?id=99999999");
ok("不存在的学生 404", miss.res.status === 404, String(miss.res.status));

const link = await req(`/api/share/link?id=${sid}`);
ok("拿到分享链接", link.res.status === 200, link.text.slice(0, 160));
const path = link.body?.path ?? "";
ok("链接形状对", /^\/share\/\d+\?k=[0-9a-f]{24}$/.test(path), path);

const k = path.split("k=")[1] ?? "";

const data = await req(`/api/share?id=${sid}&k=${k}`);
ok("家长页数据 200", data.res.status === 200, data.text.slice(0, 160));
ok("带学生姓名", data.body?.student?.name === `${tag}分享生`, JSON.stringify(data.body?.student));
ok("带剩余课时（数字）", typeof data.body?.balanceMinutes === "number", String(data.body?.balanceMinutes));
ok("带最近上课数组", Array.isArray(data.body?.lessons), JSON.stringify(data.body?.lessons)?.slice(0, 80));
ok("不给联系方式", !("guardian_phone" in (data.body?.student ?? {})) && !("guardianPhone" in (data.body?.student ?? {})));

const wrong = await req(`/api/share?id=${sid}&k=0000`);
ok("密钥不对 403", wrong.res.status === 403, String(wrong.res.status));

const nobody = await req(`/api/share?id=99999999&k=${k}`);
ok("别人的 id 拿同一个 key 也进不去", nobody.res.status === 403, String(nobody.res.status));

const page = await req(`/share/${sid}?k=${k}`);
ok("分享页 HTML 200", page.res.status === 200, String(page.res.status));
ok("分享页走无导航的独立布局", page.text.includes("share-plain") || page.text.includes("share-card"), page.text.slice(0, 300));

console.log("== 反馈语气 ==");

const defTone = await req("/api/settings");
ok("默认语气是常规", (defTone.body?.feedback_tone ?? "plain") === "plain", String(defTone.body?.feedback_tone));

const saved = await patch("/api/settings", { feedback_tone: "warm" });
ok("改成亲切 200", saved.res.status === 200, saved.text.slice(0, 120));
const after = await req("/api/settings");
ok("语气已存", after.body?.feedback_tone === "warm", String(after.body?.feedback_tone));

// 排一节课，然后批量生成反馈，看开场是不是亲切版
const course = await post("/api/courses", { name: `${tag}课` });
const cid = course.body?.id;
ok("建课程", course.res.status === 201, course.text.slice(0, 120));

const day = "2026-03-02";
const lesson = await post("/api/lessons", {
  courseId: cid,
  startAt: `${day} 18:00`,
  minutes: 90,
  studentIds: [sid],
});
ok("排一节课", lesson.res.status === 201 || lesson.res.status === 200, lesson.text.slice(0, 160));

const gen = await post("/api/feedback/batch", { from: day, to: day });
ok("批量生成草稿", gen.res.status === 200, gen.text.slice(0, 160));

const drafts = await req(`/api/feedback?studentId=${sid}`);
const draft = drafts.body?.[0];
ok("草稿生成成功", !!draft?.content, JSON.stringify(drafts.body)?.slice(0, 160));
ok("亲切版开场", String(draft?.content ?? "").includes("孩子最近挺用心"), String(draft?.content ?? "").slice(0, 120));
ok("亲切版收尾", String(draft?.content ?? "").includes("孩子在进步"), String(draft?.content ?? "").slice(-80));

await patch("/api/settings", { feedback_tone: "plain" });

console.log("== 清理 ==");
if (draft?.id) await del(`/api/feedback/${draft.id}`);
if (lesson.body?.id) await del(`/api/lessons/${lesson.body.id}`);
if (sid) await del(`/api/students/${sid}`);
ok("收尾没抛错", true);

console.log("");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
