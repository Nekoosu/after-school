/* 冒烟测试：跑一遍新增的页面和 API。用法：node scripts/smoke2.mjs http://127.0.0.1:3311 */
const base = process.argv[2] ?? "http://127.0.0.1:3311";
let pass = 0;
let failCount = 0;

function ok(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`PASS ${name}${extra ? " | " + extra : ""}`);
  } else {
    failCount++;
    console.log(`FAIL ${name}${extra ? " | " + extra : ""}`);
  }
}

async function j(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, data };
}

async function main() {
  // 页面
  for (const p of ["/", "/students", "/calendar", "/feedback", "/plans", "/finance", "/stats", "/classes", "/settings", "/manifest.json"]) {
    const res = await fetch(base + p);
    ok(`page ${p}`, res.status === 200, `status=${res.status}`);
  }

  // 建学生
  const stu = await j("POST", "/api/students", { name: "测试生", grade: "五年级" });
  ok("create student", stu.status === 200 || stu.status === 201, JSON.stringify(stu.data).slice(0, 80));
  const sid = stu.data?.student?.id ?? stu.data?.id;
  ok("student id", !!sid, `sid=${sid}`);

  // 设置读写
  const set0 = await j("GET", "/api/settings");
  ok("settings GET", set0.status === 200 && typeof set0.data.org_name === "string", `org_name=${set0.data?.org_name}`);
  const set1 = await j("PATCH", "/api/settings", { org_name: "测试中心", low_balance_minutes: "450" });
  ok("settings PATCH", set1.status === 200 && set1.data?.saved >= 2, JSON.stringify(set1.data).slice(0, 80));

  // 收款（自动充课时）
  const pay = await j("POST", "/api/payments", { studentId: sid, amount: 1200, minutes: 540, method: "wechat", remark: "秋季班" });
  ok("payment POST", pay.status === 200 && pay.data?.balance_minutes === 540, JSON.stringify(pay.data).slice(0, 120));
  const payList = await j("GET", `/api/payments?month=${new Date().toISOString().slice(0, 7)}`);
  ok("payment GET", payList.status === 200 && payList.data?.total === 1200 && payList.data?.count === 1, `total=${payList.data?.total}`);

  // 课程 + 班级
  const course = await j("POST", "/api/courses", { name: "冒烟课程", defaultMinutes: 90 });
  ok("course create", course.status === 200 || course.status === 201);
  const courses = await j("GET", "/api/courses");
  const cid = (courses.data ?? []).find((c) => c.name === "冒烟课程")?.id;
  ok("course id", !!cid, `cid=${cid}`);
  const cls = await j("POST", "/api/classes", { name: "冒烟A班", courseId: cid, studentIds: [sid], weekday: 3, startTime: "16:30", minutes: 90 });
  ok("class create", cls.status === 200 || cls.status === 201, JSON.stringify(cls.data).slice(0, 100));
  const classes = await j("GET", "/api/classes");
  const klass = (classes.data ?? []).find((c) => c.name === "冒烟A班");
  ok("class members", klass?.member_count === 1 && (klass?.member_ids ?? "").includes(String(sid)), JSON.stringify(klass ?? {}).slice(0, 120));

  // 教案
  const plan = await j("POST", "/api/plans", { title: "冒烟教案", content: "1. 复习\n2. 例题", topic: "冒烟", tags: "测试" });
  ok("plan create", plan.status === 200 || plan.status === 201, JSON.stringify(plan.data).slice(0, 80));
  const planId = plan.data?.plan?.id ?? plan.data?.id;
  const planSearch = await j("GET", "/api/plans?q=冒烟");
  ok("plan search", (planSearch.data ?? []).length >= 1);
  const planPatch = await j("PATCH", `/api/plans/${planId}`, { title: "冒烟教案改" });
  ok("plan patch", planPatch.status === 200);

  // 排课（挂教案） + 记一笔
  const today = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const dstr = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`;
  const lesson = await j("POST", "/api/lessons", { courseId: cid, startAt: `${dstr} 09:00`, minutes: 90, studentIds: [sid], planId });
  ok("lesson create", lesson.status === 200 || lesson.status === 201, JSON.stringify(lesson.data).slice(0, 120));
  const lid = lesson.data?.lesson?.id ?? lesson.data?.id;
  const fin = await j("POST", `/api/lessons/${lid}/finish`, { items: [{ studentId: sid, status: "present", note: "状态不错", topic: "冒烟", level: 4 }] });
  ok("lesson finish", fin.status === 200 && fin.data?.billedTotal === 90, JSON.stringify(fin.data).slice(0, 120));

  // 余额核对
  const detail = await j("GET", `/api/students/${sid}`);
  ok("balance after lesson", detail.data?.balance_minutes === 450, `balance=${detail.data?.balance_minutes}`);

  // 反馈生成（本地规则）
  const gen = await j("POST", "/api/feedback/generate", { studentId: sid, from: dstr, to: dstr });
  ok("feedback generate", gen.status === 200 && typeof gen.data?.content === "string" && gen.data.content.length > 20, `len=${gen.data?.content?.length}`);
  const fb = await j("POST", "/api/feedback", { studentId: sid, periodStart: dstr, periodEnd: dstr, content: gen.data?.content ?? "测试" });
  const fbid = fb.data?.id ?? fb.data?.feedback?.id;
  ok("feedback save", fb.status === 200 || fb.status === 201, `fbid=${fbid}`);
  const fbsend = await j("PATCH", `/api/feedback/${fbid}`, { status: "sent" });
  ok("feedback sent", fbsend.status === 200);
  const fbList = await j("GET", "/api/feedback?status=sent");
  ok("feedback list sent", (fbList.data ?? []).some((f) => f.id === fbid));

  // 统计
  const stats = await j("GET", "/api/stats?months=6");
  ok(
    "stats",
    stats.status === 200 && stats.data?.revenue === 1200 && stats.data?.soldMinutes === 540 && stats.data?.usedMinutes === 90,
    JSON.stringify({ revenue: stats.data?.revenue, sold: stats.data?.soldMinutes, used: stats.data?.usedMinutes }),
  );

  // 全局搜索
  const search = await j("GET", "/api/search?q=测试");
  ok("search", search.status === 200 && (search.data?.students ?? []).length >= 1, JSON.stringify(search.data ?? {}).slice(0, 100));

  // 清理：删教案/班级/学生（feedback 留一条无妨，最后会重置库）
  await j("DELETE", `/api/plans/${planId}`);
  await j("DELETE", `/api/classes/${klass?.id}`);
  await j("DELETE", `/api/students/${sid}`);
  const afterDel = await j("GET", "/api/students");
  ok("cleanup", !(afterDel.data ?? []).some((s) => s.name === "测试生"), `left=${afterDel.data?.length}`);

  console.log(`\n${pass} passed, ${failCount} failed`);
  process.exit(failCount ? 1 : 0);
}

main().catch((e) => {
  console.error("smoke crashed:", e);
  process.exit(1);
});
