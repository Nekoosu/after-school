/**
 * 冒烟 14：课表「复制到下周」+ 课表导出 .ics
 * 用法：node scripts\smoke14.mjs http://127.0.0.1:3319
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
const del = (path) => req(path, { method: "DELETE" });

const pad = (n) => String(n).padStart(2, "0");
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const tag = `测${Date.now().toString().slice(-6)}`;

// 下周一，保证「复制到下周」不会撞上别的冒烟留下的课
const now = new Date();
const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
while (mon.getDay() !== 1) mon.setDate(mon.getDate() + 1);
const weekFrom = dstr(mon);
const weekTo = dstr(addDays(mon, 6));
const nextFrom = dstr(addDays(mon, 7));
const nextTo = dstr(addDays(mon, 13));

console.log("== 复制到下周 ==");

const course = await post("/api/courses", { name: `${tag}复制课` });
const cid = course.body?.id;
ok("建课程 201", course.res.status === 201, course.text.slice(0, 160));

const s1 = await post("/api/students", { name: `${tag}甲`, grade: "三年级" });
const s2 = await post("/api/students", { name: `${tag}乙`, grade: "三年级" });
const sid1 = s1.body?.id;
const sid2 = s2.body?.id;
ok("建两个学生", !!sid1 && !!sid2, `${sid1},${sid2}`);

await post("/api/hours", { studentId: sid1, deltaMinutes: 600, kind: "purchase", amount: 800, method: "cash" });
await post("/api/hours", { studentId: sid2, deltaMinutes: 600, kind: "purchase", amount: 800, method: "cash" });

const mk = await post("/api/lessons", {
  courseId: cid,
  startAt: `${weekFrom} 16:00`,
  minutes: 90,
  studentIds: [sid1, sid2],
  title: `${tag}周一的课`,
  room: "302",
});
ok("排周一 16:00 的课 201", mk.res.status === 201, mk.text.slice(0, 200));
const l1 = mk.body?.id;

const cp1 = await post("/api/lessons/copy-week", { from: weekFrom, to: weekTo });
ok("复制 200", cp1.res.status === 200, cp1.text.slice(0, 200));
ok("复制了 1 节", cp1.body?.copied === 1, JSON.stringify(cp1.body));
ok("没有跳过", cp1.body?.skipped === 0, JSON.stringify(cp1.body));

const nextWeek = await req(`/api/lessons?from=${nextFrom} 00:00&to=${nextTo} 23:59`);
const copied = (nextWeek.body ?? []).find((l) => l.title === `${tag}周一的课`);
ok("下周里有这节课", !!copied, nextWeek.text.slice(0, 200));
ok("时间还是 16:00", (copied?.start_at ?? "").slice(11) === "16:00", String(copied?.start_at));
ok("学生跟着一起搬过来", copied?.student_names === `${tag}甲、${tag}乙`, String(copied?.student_names));
ok("教室也搬过来了", copied?.room === "302", String(copied?.room));

const cp2 = await post("/api/lessons/copy-week", { from: weekFrom, to: weekTo });
ok("再复制一次：全部跳过（不重复排）", cp2.body?.copied === 0 && cp2.body?.skipped === 1, JSON.stringify(cp2.body));
ok("跳过原因里带时间", /冲突/.test(String(cp2.body?.skippedTitles?.[0] ?? "")), JSON.stringify(cp2.body?.skippedTitles));

const cp3 = await post("/api/lessons/copy-week", { from: "2026-11-31", to: weekTo });
ok("日期不合法 400", cp3.res.status === 400, String(cp3.res.status));
const cp4 = await post("/api/lessons/copy-week", { from: weekTo, to: weekFrom });
ok("from 晚于 to 400", cp4.res.status === 400, String(cp4.res.status));
const cp5 = await post("/api/lessons/copy-week", { from: weekFrom, to: dstr(addDays(mon, 40)) });
ok("跨度太大 400", cp5.res.status === 400, String(cp5.res.status));

console.log("== 导出课表 .ics ==");

const ics = await req(`/api/calendar.ics?from=${weekFrom}&to=${nextTo}`);
ok("ics 200", ics.res.status === 200, String(ics.res.status));
ok("content-type 是 text/calendar", /text\/calendar/.test(ics.res.headers.get("content-type") ?? ""), String(ics.res.headers.get("content-type")));
ok("是下载附件", /attachment/.test(ics.res.headers.get("content-disposition") ?? ""));
ok("有 VCALENDAR 头尾", /BEGIN:VCALENDAR/.test(ics.text) && /END:VCALENDAR\s*$/.test(ics.text));
const events = (ics.text.match(/BEGIN:VEVENT/g) ?? []).length;
ok("两节课都在（本周 + 下周）", events === 2, String(events));
ok("SUMMARY 带课程名", /SUMMARY:.*复制课/.test(ics.text), ics.text.slice(0, 300));
ok("DESCRIPTION 带学生名", /DESCRIPTION:.*甲/.test(ics.text), ics.text.slice(0, 300));
ok("LOCATION 带教室", /LOCATION:302/.test(ics.text));
ok("DTSTART 是 8 位日期 T 格式", /DTSTART:\d{8}T\d{6}/.test(ics.text), (ics.text.match(/DTSTART:[^\r\n]+/) ?? [""])[0]);
ok("行尾是 CRLF", ics.text.includes("\r\n"), "");

const icsBad = await req(`/api/calendar.ics?from=2026-13-01&to=2026-13-07`);
ok("ics 日期不合法 400", icsBad.res.status === 400, String(icsBad.res.status));

// 停课的课不该出现在 ics 里
const patchRes = await req(`/api/lessons/${l1}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ status: "cancelled" }),
});
ok("把本周那节改成停课", patchRes.res.status === 200, patchRes.text.slice(0, 160));
const ics2 = await req(`/api/calendar.ics?from=${weekFrom}&to=${nextTo}`);
const events2 = (ics2.text.match(/BEGIN:VEVENT/g) ?? []).length;
ok("停课的节不导出", events2 === 1, String(events2));

// 查新版本：没网也要 200 + ok:false，不许 500
const upd = await req("/api/update");
ok("/api/update 永远 200", upd.res.status === 200, String(upd.res.status));
let updJson = {};
try {
  updJson = JSON.parse(upd.text);
} catch {
  updJson = {};
}
ok("/api/update 给出 ok 字段", typeof updJson.ok === "boolean", upd.text.slice(0, 160));

// update_url 走清单：起一个本地假清单服务来当 Gitee raw，验证 /api/update 真的会按设置走
const http = await import("node:http");
const manifest = { version: "99.0.0", url: "https://example.com/get", notes: "冒烟清单" };
const fake = http.createServer((rq, rs) => {
  rs.setHeader("Content-Type", "application/json; charset=utf-8");
  rs.end(JSON.stringify(manifest));
});
await new Promise((res) => fake.listen(0, "127.0.0.1", res));
const fakeUrl = `http://127.0.0.1:${fake.address().port}/update.json`;
await req("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ update_url: fakeUrl }) });
const upd2 = await req("/api/update");
ok("update_url 配了就走清单", upd2.body?.ok === true && upd2.body?.latest === "99.0.0", upd2.text.slice(0, 160));
ok("清单的 notes 带回来", upd2.body?.notes === "冒烟清单", String(upd2.body?.notes));
ok("有 99.0.0 就算有新版", upd2.body?.hasUpdate === true, String(upd2.body?.hasUpdate));
// 清单地址写错（不是 JSON）要按「查不到」处理，不许 500
await req("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ update_url: "http://127.0.0.1:1/no.json" }) });
const upd3 = await req("/api/update");
ok("清单打不开也是 200 + ok:false", upd3.res.status === 200 && upd3.body?.ok === false, upd3.text.slice(0, 160));
// 清单这条路挂了会自动再问一次 GitHub（仓库公开后就能兜住），排错信息里要有这一句
ok("清单挂了会退到 GitHub 再问一次", typeof upd3.body?.fallbackError === "string", String(upd3.body?.fallbackError));
// 收尾：清掉测试地址，恢复走 GitHub 的默认行为
await req("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ update_url: "" }) });
fake.close();

// 托盘小账：桌面壳托盘菜单第一行就吃这个接口的 text 字段
const tray = await req("/api/shell/tray");
ok("/api/shell/tray 永远 200", tray.res.status === 200, String(tray.res.status));
let trayJson = {};
try {
  trayJson = JSON.parse(tray.text);
} catch {
  trayJson = {};
}
ok("/api/shell/tray 给出 text 一句话", typeof trayJson.text === "string" && trayJson.text.length > 0, tray.text.slice(0, 160));
ok("/api/shell/tray 的数字字段都在", typeof trayJson.todayLessons === "number" && typeof trayJson.lowBalance === "number" && typeof trayJson.needRecord === "number", tray.text.slice(0, 160));
// 1.8.12：托盘那句小账带上第一节时间，菜单里多一条「去记这一节」
ok("/api/shell/tray 给出第一节时间", typeof trayJson.first === "string" && (trayJson.first === "" || /^\d\d:\d\d$/.test(trayJson.first)), String(trayJson.first));
ok("/api/shell/tray 给出待记那一节", typeof trayJson.pendingId === "number" && typeof trayJson.pendingText === "string" && (trayJson.pendingId === 0 || trayJson.pendingText.length > 0), trayJson.pendingId + " / " + String(trayJson.pendingText));

// 清理
await del(`/api/lessons/${copied?.id}`);
await del(`/api/lessons/${l1}`);
await del(`/api/courses/${cid}`);
await del(`/api/students/${sid1}`);
await del(`/api/students/${sid2}`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
