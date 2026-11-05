// 下课反馈向导的冒烟测试：node scripts/smoke7.mjs http://127.0.0.1:3318
const base = process.argv[2] || "http://127.0.0.1:3318";
let pass = 0;
let fail = 0;
const fails = [];

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    fails.push(name + (extra ? ` — ${extra}` : ""));
    console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`);
  }
}

async function req(path, init) {
  const res = await fetch(base + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
}

const today = new Date();
const pad = (n) => String(n).padStart(2, "0");
const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

console.log(`\n== 下课反馈向导 ==  ${base}\n`);

// 1. 造两个学生
const tag = String(Date.now() % 100000);
const a = await req("/api/students", { method: "POST", body: JSON.stringify({ name: `向导甲${tag}`, grade: "五年级" }) });
const b = await req("/api/students", { method: "POST", body: JSON.stringify({ name: `向导乙${tag}`, grade: "四年级" }) });
ok("建学生 A", a.status === 201 || a.status === 200, a.text);
ok("建学生 B", b.status === 201 || b.status === 200, b.text);
const sidA = a.body.id ?? a.body.student?.id;
const sidB = b.body.id ?? b.body.student?.id;

// 2. 充课时
await req("/api/hours", { method: "POST", body: JSON.stringify({ studentId: sidA, deltaMinutes: 540, kind: "purchase" }) });
await req("/api/hours", { method: "POST", body: JSON.stringify({ studentId: sidB, deltaMinutes: 540, kind: "purchase" }) });

// 3. 课程 + 教案（带小标题和列表项，验证「上课内容不用重复说」）
const c = await req("/api/courses", { method: "POST", body: JSON.stringify({ name: `向导数学${tag}`, subject: "数学" }) });
const courseId = c.body.id ?? c.body.course?.id;
const planContent = [
  "## 相遇问题",
  "- 会画线段图",
  "## 追及问题",
  "- 速度差是关键",
  "## 课堂练习",
  "- 三道应用题",
].join("\n");
const p = await req("/api/plans", {
  method: "POST",
  body: JSON.stringify({ title: `行程问题${tag}`, content: planContent, courseId, topic: "行程问题", minutes: 90 }),
});
ok("建教案", p.status === 200 || p.status === 201, p.text);
const planId = p.body.id ?? p.body.plan?.id;

// 4. 带教案排课，两个人一起
const startAt = `${todayStr} 16:30`;
const l = await req("/api/lessons", {
  method: "POST",
  body: JSON.stringify({ courseId, startAt, minutes: 90, studentIds: [sidA, sidB], planId, title: `向导课${tag}` }),
});
ok("排课（挂教案）", l.status === 200 || l.status === 201, l.text);
const lessonId = l.body.id;

// 5. 记一笔：甲出勤+一句话+知识点，乙请假
const fin = await req(`/api/lessons/${lessonId}/finish`, {
  method: "POST",
  body: JSON.stringify({
    items: [
      { studentId: sidA, status: "present", note: "线段图会画了，追及还混", topic: "行程问题", level: 2 },
      { studentId: sidB, status: "leave" },
    ],
  }),
});
ok("记完一笔", fin.status === 200, fin.text);

// 6. 收尾页数据
const wrap = await req(`/api/lessons/${lessonId}/feedback`);
ok("GET 收尾数据 200", wrap.status === 200, wrap.text);
ok("带出教案要点", Array.isArray(wrap.body.plan?.points) && wrap.body.plan.points.length >= 2, JSON.stringify(wrap.body.plan));
ok("要点是干净的标题", (wrap.body.plan?.points ?? []).every((x) => !x.includes("#") && !x.startsWith("-")), JSON.stringify(wrap.body.plan?.points));
ok("两个学生都在", (wrap.body.students ?? []).length === 2);
const stuA = (wrap.body.students ?? []).find((s) => s.student_id === sidA);
ok("预填了记一笔时写的那句话", (stuA?.note ?? "").includes("线段图"), JSON.stringify(stuA?.note));
ok("知识点带出来了", stuA?.topic === "行程问题", String(stuA?.topic));

// 7. 生成甲的反馈
const g1 = await req(`/api/lessons/${lessonId}/feedback`, {
  method: "POST",
  body: JSON.stringify({ studentId: sidA, brief: "线段图会画了，追及还是有点混" }),
});
ok("生成甲 200", g1.status === 200, g1.text);
const c1 = g1.body.content ?? "";
ok("反馈里带上了教案内容（相遇问题）", c1.includes("相遇问题"), c1.slice(0, 120));
ok("反馈里没让学生重复说上课内容", !c1.includes("我们讲的是向导数学" + tag), c1.slice(0, 120));
ok("反馈里有老师那句话", c1.includes("线段图会画了"), c1.slice(0, 160));
ok("反馈里有课时段", c1.includes("课时") && c1.includes("还剩"), c1.slice(-160));
ok("反馈里有等级说明", c1.includes("行程问题"), c1.slice(0, 200));
ok("AI 未开时回退本地", g1.body.ai?.used === false && c1 === g1.body.local_content, JSON.stringify(g1.body.ai));

// 8. 生成乙（请假）的反馈
const g2 = await req(`/api/lessons/${lessonId}/feedback`, {
  method: "POST",
  body: JSON.stringify({ studentId: sidB, brief: "" }),
});
ok("生成乙 200", g2.status === 200, g2.text);
ok("请假的学生有请假说法", (g2.body.content ?? "").includes("请假"), (g2.body.content ?? "").slice(0, 120));
ok("请假不扣课时", (g2.body.content ?? "").includes("这次没有扣课时"), (g2.body.content ?? "").slice(-200));

// 9. 草稿覆盖而不是堆两条
const d1 = await req("/api/feedback", {
  method: "POST",
  body: JSON.stringify({ studentId: sidA, periodStart: todayStr, periodEnd: todayStr, content: c1 }),
});
const d2 = await req("/api/feedback", {
  method: "POST",
  body: JSON.stringify({ studentId: sidA, periodStart: todayStr, periodEnd: todayStr, content: c1 + "\n（改了一版）" }),
});
ok("存草稿 200", d1.status === 200, d1.text);
ok("第二次是覆盖不是新增", d2.body?.updated === true && d2.body?.id === d1.body?.id, JSON.stringify(d2.body));
const list = await req(`/api/feedback?studentId=${sidA}`);
const samePeriod = (list.body ?? []).filter((f) => f.period_start === todayStr && f.period_end === todayStr);
ok("同一周期只有一条", samePeriod.length === 1, `got ${samePeriod.length}`);
ok("草稿内容是最新那版", (samePeriod[0]?.content ?? "").includes("改了一版"));

// 10. 标记已发
const sent = await req(`/api/feedback/${d1.body.id}`, { method: "PATCH", body: JSON.stringify({ status: "sent" }) });
ok("标记已发 200", sent.status === 200, sent.text);

// 11. 没挂教案的课退回课程名
const l2 = await req("/api/lessons", {
  method: "POST",
  body: JSON.stringify({ courseId, startAt: `${todayStr} 19:00`, minutes: 90, studentIds: [sidA], title: `没教案${tag}` }),
});
const lesson2 = l2.body.id;
await req(`/api/lessons/${lesson2}/finish`, {
  method: "POST",
  body: JSON.stringify({ items: [{ studentId: sidA, status: "present" }] }),
});
const g3 = await req(`/api/lessons/${lesson2}/feedback`, {
  method: "POST",
  body: JSON.stringify({ studentId: sidA, brief: "今天做了一套卷子" }),
});
ok("没教案也能生成", g3.status === 200, g3.text);
ok("没教案时用这节课的标题", (g3.body.content ?? "").includes(`没教案${tag}`), (g3.body.content ?? "").slice(0, 120));
const wrap2 = await req(`/api/lessons/${lesson2}/feedback`);
ok("没教案时 plan 为 null", wrap2.body.plan === null, JSON.stringify(wrap2.body.plan));

// 12. 页面能打开
const page = await req(`/lessons/${lesson2}/wrap`);
ok("收尾页 200", page.status === 200, String(page.status));

// 13. 清理
await req(`/api/students/${sidA}`, { method: "DELETE" });
await req(`/api/students/${sidB}`, { method: "DELETE" });
for (const f of samePeriod) await req(`/api/feedback/${f.id}`, { method: "DELETE" });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log("\n失败项：");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
