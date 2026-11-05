/**
 * 冒烟 12：月报 /api/reports/monthly（按月聚合 + CSV + 页面）
 * 用法：node scripts\smoke12.mjs http://127.0.0.1:3319
 * 断言口径：所有绝对数都落在「本月新建的这位学生」自己的行上，不受其他 smoke 留下的数据影响；
 * 聚合月的课都排在上个月的固定日子（05/07/10/12），那个月一定已经过完。
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
const now = new Date();
const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const target = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`;
const cur = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
const d = (dayInTarget, time) => `${target}-${pad(dayInTarget)} ${time}`;
const dCur = (offset, time) => {
  const x = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())} ${time}`;
};

const tag = `测${Date.now().toString().slice(-6)}`;

console.log("== 参数校验 ==");

const bad1 = await req("/api/reports/monthly?month=2026-13");
ok("月份 13 被拒", bad1.res.status === 400, bad1.text.slice(0, 120));
const bad2 = await req("/api/reports/monthly?month=abc");
ok("月份 abc 被拒", bad2.res.status === 400, bad2.text.slice(0, 120));
const noMonth = await req("/api/reports/monthly");
ok("不传月份默认当月", noMonth.res.status === 200 && noMonth.body?.month === cur, JSON.stringify(noMonth.body?.month));

console.log("== 准备数据 ==");

const course = await post("/api/courses", { name: `${tag}月报课` });
ok("建课程 201", course.res.status === 201, course.text.slice(0, 160));
const courseId = course.body?.id;

const stu = await post("/api/students", { name: `${tag}月报生`, grade: "三年级" });
ok("建学生 201", stu.res.status === 201, stu.text.slice(0, 160));
const sid = stu.body?.id;

const hours = await post("/api/hours", { studentId: sid, deltaMinutes: 1800, kind: "purchase", amount: 2400, method: "微信", remark: "月报测试充值" });
ok("充值成功", hours.res.status === 200 || hours.res.status === 201, hours.text.slice(0, 160));

// 上个月的四节课：05 出勤 / 07 缺勤 / 10 到了没记 / 12 已取消
const l1 = await post("/api/lessons", { courseId, startAt: d(5, "16:00"), minutes: 90, studentIds: [sid], title: "月报出勤课" });
const l2 = await post("/api/lessons", { courseId, startAt: d(7, "16:00"), minutes: 90, studentIds: [sid], title: "月报缺勤课" });
const l3 = await post("/api/lessons", { courseId, startAt: d(10, "16:00"), minutes: 90, studentIds: [sid], title: "月报没记课" });
const l4 = await post("/api/lessons", { courseId, startAt: d(12, "16:00"), minutes: 90, studentIds: [sid], title: "月报取消课" });
if (l4.body?.id) {
  const can = await req(`/api/lessons/${l4.body.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "cancelled" }),
  });
  ok("取消一节课成功", can.res.status === 200, can.text.slice(0, 160));
}
const l5 = await post("/api/lessons", { courseId, startAt: dCur(0, "23:00"), minutes: 90, studentIds: [sid], title: "本月课" });
const madeOk = [l1, l2, l3, l4, l5].every((r) => r.res.status === 200 || r.res.status === 201);
ok("排五节课成功", madeOk, JSON.stringify([l1.status, l2.status, l3.status, l4.status, l5.status]));

// finish 的请求体是 { items: [...] }，不是 attendance
const fin1 = await post(`/api/lessons/${l1.body?.id}/finish`, { items: [{ studentId: sid, status: "present", note: "讲得不错" }] });
ok("记出勤成功", fin1.res.status === 200, fin1.text.slice(0, 160));
const fin2 = await post(`/api/lessons/${l2.body?.id}/finish`, { items: [{ studentId: sid, status: "absent" }] });
ok("记缺勤成功", fin2.res.status === 200, fin2.text.slice(0, 160));

console.log("== 上个月的月报 ==");

const r1 = await req(`/api/reports/monthly?month=${target}`);
ok("上月月报 200", r1.res.status === 200, r1.text.slice(0, 160));
const row = (r1.body?.rows ?? []).find((x) => x.studentId === sid);
ok("能看到这个孩子", !!row, JSON.stringify(r1.body?.rows?.slice(0, 1)));
ok("上课 3 节（取消的不算）", row?.lessons === 3, String(row?.lessons));
ok("出勤 1", row?.attended === 1, String(row?.attended));
ok("缺勤 1", row?.absent === 1, String(row?.absent));
ok("请假 0", row?.leave === 0, String(row?.leave));
ok("待记录 1（时间过了还是 planned）", row?.unrecorded === 1, String(row?.unrecorded));
ok("扣课时 90 分钟", row?.billedMinutes === 90, String(row?.billedMinutes));
ok("出勤率 50%", row?.rate === 50, String(row?.rate));
ok("消耗 1.5 小时", row?.billedHours === 1.5, String(row?.billedHours));
ok("剩余 28.5 小时", row?.balanceHours === 28.5, String(row?.balanceHours));
ok("上月收款 0", row?.paid === 0, String(row?.paid));
ok("汇总节数不少于这个孩子的", (r1.body?.summary?.lessons ?? 0) >= 3, JSON.stringify(r1.body?.summary));
ok("汇总扣课时不小于 90", (r1.body?.summary?.billedMinutes ?? 0) >= 90, JSON.stringify(r1.body?.summary));
ok("汇总出勤率在 0~100", (r1.body?.summary?.rate ?? -1) >= 0 && (r1.body?.summary?.rate ?? 101) <= 100, String(r1.body?.summary?.rate));

console.log("== 本月的月报 ==");

const r2 = await req(`/api/reports/monthly?month=${cur}`);
const row2 = (r2.body?.rows ?? []).find((x) => x.studentId === sid);
ok("本月能看到收款 2400", row2?.paid === 2400, String(row2?.paid));
ok("本月至少有今天这节课", (row2?.lessons ?? 0) >= 1, String(row2?.lessons));
ok("本月扣课时不含上月的课", (row2?.billedMinutes ?? 0) === 0, String(row2?.billedMinutes));

console.log("== CSV 与页面 ==");

const csv = await fetch(`${BASE}/api/reports/monthly?month=${target}&format=csv`);
const buf = new Uint8Array(await csv.arrayBuffer());
const csvText = new TextDecoder("utf-8").decode(buf);
ok("CSV 200 且类型对", csv.status === 200 && String(csv.headers.get("content-type")).includes("text/csv"), String(csv.headers.get("content-type")));
ok("CSV 带 BOM", buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, String(buf[0]));
ok("CSV 有表头和孩子", csvText.includes("学生") && csvText.includes("消耗课时") && csvText.includes(`${tag}月报生`), csvText.slice(0, 120));

const page = await req("/monthly");
ok("/monthly 渲染 200", page.res.status === 200, String(page.res.status));
ok("页面带月报标题", page.text.includes("月报"), "");

console.log("== 清理 ==");

for (const l of [l1, l2, l3, l4, l5]) {
  if (l.body?.id) await del(`/api/lessons/${l.body.id}`);
}
await del(`/api/courses/${courseId}`);
if (sid) await del(`/api/students/${sid}`);
ok("收尾没抛错", true);

console.log("");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
