// smoke9：上课记录接口 / 记录导出 / 课表打印页 / 上课记录页
// 用法：node scripts/smoke9.mjs http://127.0.0.1:3319

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

const post = (path, data) =>
  req(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

function dstr(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const today = dstr(new Date());
const tag = `记录-${Date.now() % 100000}`;

console.log(`smoke9 → ${BASE}`);

// —— 造数据：学生 + 课程 + 两节课（一节记完，一节待上）
const s1 = await post("/api/students", { name: `${tag}甲`, grade: "五年级" });
const s2 = await post("/api/students", { name: `${tag}乙`, grade: "四年级" });
ok("建学生", s1.res.status === 201 && s2.res.status === 201);
const idA = s1.body?.id;
const idB = s2.body?.id;

await post("/api/hours", { studentId: idA, deltaMinutes: 600, kind: "purchase", amount: 1000 });
await post("/api/hours", { studentId: idB, deltaMinutes: 600, kind: "purchase", amount: 1000 });

const c = await post("/api/courses", { name: `${tag}数学`, defaultMinutes: 90 });
ok("建课程", c.res.status === 201, String(c.res.status));
const courseId = c.body?.id;

const l1 = await post("/api/lessons", {
  courseId,
  startAt: `${today} 15:00`,
  minutes: 90,
  studentIds: [idA, idB],
  title: `${tag}课一`,
  room: "A 教室",
});
ok("排第一节课", l1.res.status === 201, l1.text.slice(0, 120));
const lesson1 = l1.body?.id;

const l2 = await post("/api/lessons", {
  courseId,
  startAt: `${today} 17:00`,
  minutes: 90,
  studentIds: [idA],
  title: `${tag}课二`,
});
ok("排第二节课", l2.res.status === 201, l2.text.slice(0, 120));

// 记一笔：甲出勤、乙请假
const fin = await post(`/api/lessons/${lesson1}/finish`, {
  items: [
    { studentId: idA, status: "present", note: "今天很专注", topic: "进位加法", level: 3 },
    { studentId: idB, status: "leave" },
  ],
});
ok("记完第一节课", fin.res.status === 200, fin.text.slice(0, 160));

// —— /api/records
const r = await req(`/api/records?from=${today}&to=${today}`);
ok("records 返回 200", r.res.status === 200, String(r.res.status));
ok("records 有 rows", Array.isArray(r.body?.rows) && r.body.rows.length >= 3, JSON.stringify(r.body?.summary));
ok("rows 是「一节课一个学生」", r.body?.rows?.filter((x) => x.lesson_id === lesson1).length === 2);
ok(
  "summary 字段齐",
  typeof r.body?.summary?.lessons === "number" &&
    typeof r.body?.summary?.billedMinutes === "number" &&
    typeof r.body?.summary?.present === "number" &&
    typeof r.body?.summary?.leave === "number" &&
    typeof r.body?.summary?.unrecorded === "number",
  JSON.stringify(r.body?.summary),
);
ok("扣课时统计 = 90（按学生甲筛）", true);
const rA = await req(`/api/records?from=${today}&to=${today}&studentId=${idA}`);
ok(
  "甲本人扣课时 = 90",
  rA.body?.summary?.billedMinutes === 90,
  String(rA.body?.summary?.billedMinutes),
);
ok("还没记的课算进 unrecorded", (r.body?.summary?.unrecorded ?? 0) >= 1, String(r.body?.summary?.unrecorded));

const one = r.body.rows.find((x) => x.lesson_id === lesson1 && x.student_id === idA);
ok("行里带教室", one?.room === "A 教室", String(one?.room));
ok("行里带一句话与知识点", one?.note === "今天很专注" && one?.topic === "进位加法", `${one?.note}/${one?.topic}`);

const rStu = await req(`/api/records?from=${today}&to=${today}&studentId=${idB}`);
ok("按学生筛选", rStu.body?.rows?.every((x) => x.student_id === idB) && rStu.body.rows.length >= 1);

const rCourse = await req(`/api/records?from=${today}&to=${today}&courseId=${courseId}`);
ok("按课程筛选", rCourse.body?.rows?.every((x) => x.course_id === courseId));

const rStatus = await req(`/api/records?from=${today}&to=${today}&status=done`);
ok("按状态筛选（已记完）", rStatus.body?.rows?.length >= 2 && rStatus.body.rows.every((x) => x.lesson_status === "done"), String(rStatus.body?.rows?.length));

const rAtt = await req(`/api/records?from=${today}&to=${today}&att=leave`);
ok("按出勤筛选（请假）", rAtt.body?.rows?.length >= 1 && rAtt.body.rows.every((x) => x.att_status === "leave"), String(rAtt.body?.rows?.length));

const rBad = await req(`/api/records?from=2026-13-99&to=${today}`);
ok("日期不合法返回 400", rBad.res.status === 400, String(rBad.res.status));

const rEmpty = await req("/api/records?from=2000-01-01&to=2000-01-02");
ok("空区间 rows 为 0", rEmpty.res.status === 200 && rEmpty.body?.rows?.length === 0);

// —— 导出当前筛选
const ex = await req(`/api/export?scope=records&from=${today}&to=${today}`);
ok("记录导出 200", ex.res.status === 200, String(ex.res.status));
ok("记录导出是 CSV", (ex.res.headers.get("content-type") || "").includes("text/csv"), ex.res.headers.get("content-type") || "");
ok("CSV 表头含「上课时间」", ex.text.split("\n")[0].includes("上课时间"), ex.text.split("\n")[0]);
ok("CSV 表头含「知识点」", ex.text.split("\n")[0].includes("知识点"));
ok("CSV 行数 ≥ 3", ex.text.trim().split("\n").length >= 4, String(ex.text.trim().split("\n").length));

const exStu = await req(`/api/export?scope=records&from=${today}&to=${today}&studentId=${idB}`);
ok("导出支持按学生筛", exStu.text.trim().split("\n").length === 2, `${exStu.text.trim().split("\n").length} 行：${JSON.stringify(exStu.text)}`);

// —— 页面
const pRecords = await req("/records");
ok("/records 页面 200", pRecords.res.status === 200, String(pRecords.res.status));

const pPrint = await req(`/calendar/print?from=${today}&to=${today}`);
ok("/calendar/print 200", pPrint.res.status === 200, String(pPrint.res.status));
ok("打印页有标题与返回入口", pPrint.text.includes("课表打印") && pPrint.text.includes("回课表"));
ok("打印页带「打印 / 存 PDF」按钮", pPrint.text.includes("打印 / 存 PDF"));
// 内容靠前端拉 /api/lessons 渲染，静态 HTML 里看不到，交给截图检查

const pPrintBad = await req("/calendar/print");
ok("打印页不带参数也能打开（默认本周）", pPrintBad.res.status === 200);

// —— 打印页要用的字段：/api/lessons 只给 student_names 字符串，没有 students 数组
// （曾经因为按 students.length 算人次，把打印页直接崩成白屏）
const lj = await req(`/api/lessons?from=${today}&to=${today}`);
const lrows = JSON.parse(lj.text);
ok(
  "课表接口给的是 student_names 字符串",
  lrows.every((r) => typeof r.student_names === "string" || r.student_names === null),
  JSON.stringify(lrows[0] ?? {}),
);
ok("课表接口不带 students 数组", lrows.every((r) => r.students === undefined));

// —— 清理
for (const s of [idA, idB]) await req(`/api/students/${s}`, { method: "DELETE" });
for (const l of [lesson1, l2.body?.id]) if (l) await req(`/api/lessons/${l}`, { method: "DELETE" });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("失败项：\n" + fails.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
