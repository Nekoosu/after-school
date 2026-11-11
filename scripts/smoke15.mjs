/**
 * 冒烟 15：老师 / 老师冲突 / 课消单价 / 学生多科课表 / 关机守卫
 * 用法：node scripts\smoke15.mjs http://127.0.0.1:3319
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

const pad = (n) => String(n).padStart(2, "0");
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const tag = `测${Date.now().toString().slice(-6)}`;

// 挑一个离现在很远的日子，别跟别的冒烟撞时间
const day = new Date();
day.setDate(day.getDate() + 32);
const DAY = dstr(day);

console.log("== 老师档案 ==");

const t1 = await post("/api/teachers", { name: `${tag}数学老师`, subject: "数学", phone: "13800000001", color: "#2563eb" });
ok("建老师 201", t1.res.status === 201, t1.text.slice(0, 160));
const tid1 = t1.body?.id || t1.body?.teacher?.id;

const t2 = await post("/api/teachers", { name: `${tag}语文老师`, subject: "语文" });
ok("再建一位老师", t2.res.status === 201, t2.text.slice(0, 160));
const tid2 = t2.body?.id || t2.body?.teacher?.id;

const bad = await post("/api/teachers", { subject: "英语" });
ok("没名字 → 400", bad.res.status === 400, bad.text.slice(0, 120));

const list = await req("/api/teachers");
const listArr = Array.isArray(list.body) ? list.body : (list.body?.teachers ?? []);
const mine = listArr.find((x) => x.id === tid1);
ok("列表里能找到她", !!mine, list.text.slice(0, 160));
ok("列表带本周统计字段", mine && "week_lessons" in mine && "student_count" in mine, JSON.stringify(mine || {}));
ok("列表带科目", mine?.subject === "数学", String(mine?.subject));

const detail = await req(`/api/teachers/${tid1}`);
ok("老师详情 200", detail.res.status === 200, detail.text.slice(0, 120));
ok("详情带课程数组", Array.isArray(detail.body?.courses), typeof detail.body?.courses);

const renamed = await patch(`/api/teachers/${tid1}`, { phone: "13800000002" });
ok("改老师资料 200", renamed.res.status === 200, renamed.text.slice(0, 120));
const re2 = await req(`/api/teachers/${tid1}`);
ok("改动生效", re2.body?.teacher?.phone === "13800000002" || re2.body?.phone === "13800000002", re2.text.slice(0, 160));

console.log("== 课程挂在老师名下 ==");

const c1 = await post("/api/courses", { name: `${tag}数学班`, teacherId: tid1, defaultMinutes: 90, pricePerLesson: 150 });
ok("建课（带老师）201", c1.res.status === 201, c1.text.slice(0, 160));
const cid1 = c1.body?.id || c1.body?.course?.id;

const c2 = await post("/api/courses", { name: `${tag}语文班`, teacherId: tid2, defaultMinutes: 90 });
const cid2 = c2.body?.id || c2.body?.course?.id;

const courses = await req("/api/courses");
const cl = Array.isArray(courses.body) ? courses.body : (courses.body?.courses ?? []);
const myCourse = cl.find((x) => x.id === cid1);
ok("课程列表带 teacher_name", myCourse?.teacher_name === `${tag}数学老师`, JSON.stringify(myCourse || {}));
ok("课程列表带 teacher_id", myCourse?.teacher_id === tid1, String(myCourse?.teacher_id));

const tc = await req(`/api/teachers/${tid1}`);
ok("老师详情里含这门课", (tc.body?.courses ?? []).some((x) => x.id === cid1), tc.text.slice(0, 200));

console.log("== 排课带上老师 ==");

const s1 = await post("/api/students", { name: `${tag}甲`, grade: "三年级" });
const s2 = await post("/api/students", { name: `${tag}乙`, grade: "三年级" });
const sid1 = s1.body?.id;
const sid2 = s2.body?.id;
ok("建两个学生", !!sid1 && !!sid2, `${sid1},${sid2}`);

// 甲、乙两个学生都要上数学和语文：多科
await post("/api/hours", { studentId: sid1, deltaMinutes: 600, kind: "purchase", amount: 900, courseId: cid1 });
await post("/api/hours", { studentId: sid2, deltaMinutes: 600, kind: "purchase", amount: 750, courseId: cid2 });

const L1 = await post("/api/lessons", {
  courseId: cid1,
  startAt: `${DAY} 15:00`,
  minutes: 90,
  studentIds: [sid1],
});
ok("排一节数学（老师从课程带出）201", L1.res.status === 201, L1.text.slice(0, 200));
const lid1 = L1.body?.id || L1.body?.lesson?.id;
const l1get = await req(`/api/lessons/${lid1}`);
ok("课详情带 teacher_name", l1get.body?.lesson?.teacher_name === `${tag}数学老师`, l1get.text.slice(0, 200));

console.log("== 冲突：老师不能同时上两节课 ==");

const sameTeacher = await post("/api/lessons", {
  courseId: cid1,
  startAt: `${DAY} 15:00`,
  minutes: 90,
  studentIds: [sid2],
});
ok("同一老师同一时间（另一个学生）→ 409", sameTeacher.res.status === 409, sameTeacher.text.slice(0, 200));

const otherTeacher = await post("/api/lessons", {
  courseId: cid2,
  startAt: `${DAY} 15:00`,
  minutes: 90,
  studentIds: [sid2],
});
ok("同一时间换语文老师 → 能排", otherTeacher.res.status === 201, otherTeacher.text.slice(0, 200));
const lid2 = otherTeacher.body?.id || otherTeacher.body?.lesson?.id;

const sameStudent = await post("/api/lessons", {
  courseId: cid2,
  startAt: `${DAY} 15:00`,
  minutes: 90,
  studentIds: [sid1],
});
ok("同一个学生同一时间被排进两节课 → 409", sameStudent.res.status === 409, sameStudent.text.slice(0, 200));

const confApi = await req(
  `/api/lessons/conflicts?teacherId=${tid1}&startAt=${encodeURIComponent(`${DAY} 15:00`)}&minutes=90`,
);
const confArr = Array.isArray(confApi.body) ? confApi.body : (confApi.body?.conflicts ?? []);
ok("预检接口能查出老师冲突", confArr.some((c) => c.kind === "teacher"), confApi.text.slice(0, 240));

console.log("== 课消单价 ==");

// 甲充值 600 分钟 / 900 元 → 90 元一小时
const hours = await post("/api/hours", { studentId: sid1, deltaMinutes: 300, kind: "purchase", amount: 450, courseId: cid1 });
ok("充值记下单价 90", hours.body?.unitPrice === 90, hours.text.slice(0, 160));

const before = await req(`/api/students/${sid1}`);
const balBefore = before.body?.balance?.balance_minutes ?? before.body?.balance_minutes;

const ld = await req(`/api/lessons/${lid1}`);
const stu1 = (ld.body?.students ?? [])[0];
ok("课详情给出预估课消", stu1?.charge_amount === 135 && stu1?.charge_estimate === true, JSON.stringify(stu1 || {}));
ok("课详情给出单价", stu1?.unit_price === 90, String(stu1?.unit_price));

// 单节课单独定价 120 元/小时，应该盖过充值单价
const L3 = await post("/api/lessons", {
  courseId: cid1,
  startAt: `${DAY} 17:00`,
  minutes: 60,
  studentIds: [sid1],
  pricePerHour: 120,
});
const lid3 = L3.body?.id || L3.body?.lesson?.id;
const ld3 = await req(`/api/lessons/${lid3}`);
const stu3 = (ld3.body?.students ?? [])[0];
ok("单节课价 120 优先于充值单价", stu3?.unit_price === 120 && stu3?.charge_amount === 120 && stu3?.charge_estimate === true, JSON.stringify(stu3 || {}));

console.log("== 记完一笔，课消落地 ==");

const fin = await post(`/api/lessons/${lid1}/finish`, { items: [{ studentId: sid1, status: "present", note: "" }] });
ok("结课 200", fin.res.status === 200, fin.text.slice(0, 240));
ok("返回这次总共扣了多少钱", fin.body?.chargeTotal === 135, JSON.stringify(fin.body?.chargeTotal));

const after = await req(`/api/students/${sid1}`);
const balAfter = after.body?.balance?.balance_minutes ?? after.body?.balance_minutes;
ok("余额少了 90 分钟", balBefore - balAfter === 90, `${balBefore} → ${balAfter}`);

const led = (after.body?.ledger ?? []).find((x) => x.kind === "consume");
ok("流水里有课消一行", !!led, JSON.stringify(after.body?.ledger ?? []).slice(0, 240));
ok("课消行带单价", led?.unit_price === 90, String(led?.unit_price));
ok("课消行带金额", led?.amount === 135, String(led?.amount));

const ledBuy = (after.body?.ledger ?? []).find((x) => x.kind === "purchase" && x.amount === 450);
ok("充值行也带金额", !!ledBuy, JSON.stringify(ledBuy || {}));

console.log("== 学生多科课表 ==");

const tt = await req(`/api/students/${sid1}/timetable`);
ok("课表接口 200", tt.res.status === 200, tt.text.slice(0, 160));
ok("课表返回课程数组", Array.isArray(tt.body?.lessons), typeof tt.body?.lessons);
ok("课表按课程聚合", Array.isArray(tt.body?.byCourse) && tt.body.byCourse.length >= 1, JSON.stringify(tt.body?.byCourse ?? {}).slice(0, 240));
const row = (tt.body?.byCourse ?? []).find((x) => x.course_id === cid1);
ok("聚合里有数学班的余额", row && row.balance_minutes > 0, JSON.stringify(row || {}));
ok("课表里的课带老师名", (tt.body?.lessons ?? []).some((x) => x.teacher_name === `${tag}数学老师`), JSON.stringify(tt.body?.lessons ?? {}).slice(0, 240));

console.log("== 删老师：有课就软停用 ==");

const d1 = await del(`/api/teachers/${tid1}`);
ok("删有课的老师 200", d1.res.status === 200, d1.text.slice(0, 160));
const t1after = await req(`/api/teachers/${tid1}`);
ok("老师还在，只是停用", t1after.res.status === 200 && (t1after.body?.teacher?.status ?? t1after.body?.status) === "inactive", t1after.text.slice(0, 200));

const t3 = await post("/api/teachers", { name: `${tag}没课老师`, subject: "美术" });
const tid3 = t3.body?.id || t3.body?.teacher?.id;
ok("再建一位没课的老师", !!tid3, t3.text.slice(0, 160));

const d2 = await del(`/api/teachers/${tid2}`);
ok("有课的老师也走软停用", d2.res.status === 200 && d2.body?.soft === true, d2.text.slice(0, 160));
const t2after = await req(`/api/teachers/${tid2}`);
ok("软停用后还能查到", t2after.res.status === 200, t2after.text.slice(0, 120));

const d3 = await del(`/api/teachers/${tid3}`);
ok("没课的老师真删（soft:false）", d3.res.status === 200 && d3.body?.soft === false, d3.text.slice(0, 160));
const t3after = await req(`/api/teachers/${tid3}`);
ok("真删后 404", t3after.res.status === 404, t3after.text.slice(0, 120));

console.log("== 关机口子只给桌面版 ==");

const bye = await req("/api/shutdown", { method: "POST" });
ok("浏览器里调 /api/shutdown → 403", bye.res.status === 403, bye.text.slice(0, 120));

// 收尾：清掉这节课，别污染后面的冒烟
await del(`/api/lessons/${lid1}`);
await del(`/api/lessons/${lid3}`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
