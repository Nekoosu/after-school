// 第六批冒烟：重复排课 / 月度对账单 / 全量 JSON 导出 / 首页收款趋势
// 用法：node scripts/smoke6.mjs http://127.0.0.1:3317
const BASE = process.argv[2] || "http://127.0.0.1:3000";
let pass = 0;
let fail = 0;

function chk(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✔ ${name}`);
  } else {
    fail++;
    console.log(`  ✘ ${name} ${extra}`);
  }
}

async function j(path, init) {
  const r = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const t = await r.text();
  let d = null;
  try {
    d = JSON.parse(t);
  } catch {
    d = t;
  }
  return { status: r.status, d, headers: r.headers };
}

const post = (p, b) => j(p, { method: "POST", body: JSON.stringify(b) });
const del = (p) => j(p, { method: "DELETE" });

const pad = (n) => String(n).padStart(2, "0");
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const todayStr = dstr(today);
const monthStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
const tag = `重复课-${Date.now() % 100000}`;

function plusDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return dstr(d);
}

(async () => {
  console.log("\n== 准备数据 ==");
  const stu = await post("/api/students", { name: "冒烟六号", grade: "三年级" });
  const sid = stu.d?.id;
  chk("建学生", stu.status === 201 && !!sid, JSON.stringify(stu.d).slice(0, 120));

  const co = await post("/api/courses", { name: "冒烟六课程", defaultMinutes: 90 });
  const cid = co.d?.id;
  chk("建课程", co.status === 201 && !!cid, JSON.stringify(co.d).slice(0, 120));

  console.log("\n== 重复排课 ==");
  const startAt = `${plusDays(today, 1)} 09:00`;
  const ls = await post("/api/lessons", {
    courseId: cid,
    startAt,
    minutes: 90,
    studentIds: [sid],
    title: tag,
    repeatWeeks: 4,
  });
  chk("重复排课 201", ls.status === 201, `${ls.status} ${JSON.stringify(ls.d).slice(0, 160)}`);
  chk("一共 4 节", ls.d?.count === 4 && Array.isArray(ls.d?.ids) && ls.d.ids.length === 4, JSON.stringify(ls.d?.ids));
  const list = await j(`/api/lessons?from=${plusDays(today, 1)}&to=${plusDays(today, 30)}`);
  const mine = (list.d ?? []).filter((l) => l.title === tag);
  chk("列表里 4 条", mine.length === 4, String(mine.length));
  const dates = mine.map((l) => l.start_at.slice(0, 10)).sort();
  chk(
    "每周同日同时间",
    dates.length === 4 &&
      dates.every((d, i) => d === plusDays(new Date(startAt.slice(0, 10) + "T00:00:00"), i * 7)) &&
      mine.every((l) => l.start_at.slice(11) === "09:00"),
    dates.join(","),
  );

  console.log("\n== 重复排课的冲突检测 ==");
  const clash = await post("/api/lessons", {
    courseId: cid,
    startAt: `${plusDays(today, 8)} 09:00`,
    minutes: 90,
    studentIds: [sid],
    repeatWeeks: 2,
  });
  chk("撞上已排的课 → 409", clash.status === 409, String(clash.status));
  chk("冲突信息带日期", /时间冲突/.test(String(clash.d?.error ?? "")), String(clash.d?.error ?? "").slice(0, 120));
  const forced = await post("/api/lessons", {
    courseId: cid,
    startAt: `${plusDays(today, 8)} 09:00`,
    minutes: 90,
    studentIds: [sid],
    repeatWeeks: 2,
    force: true,
  });
  chk("force 后能排上", forced.status === 201 && forced.d?.count === 2, `${forced.status} ${forced.d?.count}`);

  console.log("\n== 收钱 + 记一笔 ==");
  const pay = await post("/api/payments", {
    studentId: sid,
    amount: 900,
    minutes: 540,
    method: "wechat",
    paidAt: todayStr,
    remark: "冒烟测试",
  });
  chk("收款成功", pay.status === 201 || pay.status === 200, JSON.stringify(pay.d).slice(0, 140));

  const firstLessonId = ls.d?.ids?.[0];
  const fin = await post(`/api/lessons/${firstLessonId}/finish`, {
    items: [{ studentId: sid, status: "present", note: "讲得不错", topic: "两位数进位", level: 4 }],
  });
  chk("记一笔成功", fin.status === 200, JSON.stringify(fin.d).slice(0, 140));

  console.log("\n== 月度对账单 ==");
  const st = await j(`/api/students/${sid}/statement?month=${monthStr}`);
  chk("对账单 200", st.status === 200, String(st.status));
  const sum = st.d?.summary ?? {};
  chk("算上这一节", sum.lessonCount >= 1, String(sum.lessonCount));
  chk("扣课时 90", sum.billedMinutes === 90, String(sum.billedMinutes));
  chk("交费 900", sum.paidAmount === 900, String(sum.paidAmount));
  chk("剩余 450", sum.balanceMinutes === 450, String(sum.balanceMinutes));
  chk("单价反推 ≈100/小时", Math.round(sum.unitPrice) === 100, String(sum.unitPrice));
  chk("月度明细里有出勤", (st.d?.lessons ?? []).some((l) => l.att_status === "present"));
  const st2 = await j(`/api/students/${sid}/statement?month=2020-01`);
  chk("空月份不报错", st2.status === 200 && (st2.d?.lessons ?? []).length === 0, JSON.stringify(st2.d).slice(0, 120));
  const stBad = await j(`/api/students/${sid}/statement?month=xx`);
  chk("月份格式错误 → 400", stBad.status === 400, String(stBad.status));

  console.log("\n== 全量 JSON 导出 ==");
  const ex = await j("/api/export");
  chk("导出 200", ex.status === 200, String(ex.status));
  chk("带附件名", /attachment; filename="after-school-.*\.json"/.test(ex.headers.get("content-disposition") ?? ""), String(ex.headers.get("content-disposition")));
  chk("13 张表都在", Object.keys(ex.d?.tables ?? {}).length === 13, String(Object.keys(ex.d?.tables ?? {}).length));
  chk("学生数据在里面", (ex.d?.tables?.student ?? []).some((s) => s.id === sid));
  chk("有 counts 汇总", ex.d?.counts?.student >= 1, JSON.stringify(ex.d?.counts).slice(0, 160));

  console.log("\n== 首页收款趋势 ==");
  const db = await j("/api/dashboard");
  chk("dashboard 200", db.status === 200, String(db.status));
  chk("趋势 14 个点", (db.d?.revenueTrend ?? []).length === 14, String((db.d?.revenueTrend ?? []).length));
  chk("最后一点是今天", db.d?.revenueTrend?.slice(-1)[0]?.d === todayStr, JSON.stringify(db.d?.revenueTrend?.slice(-1)));
  chk("今天有收款", (db.d?.revenueTrend?.slice(-1)[0]?.amount ?? 0) >= 900, String(db.d?.revenueTrend?.slice(-1)[0]?.amount));

  console.log("\n== 清理 ==");
  for (const id of ls.d?.ids ?? []) await del(`/api/lessons/${id}`);
  for (const id of forced.d?.ids ?? []) await del(`/api/lessons/${id}`);
  if (pay.d?.id) await del(`/api/payments?id=${pay.d.id}`);
  await del(`/api/students/${sid}`);
  const gone = await j(`/api/lessons?from=${plusDays(today, 1)}&to=${plusDays(today, 30)}`);
  chk(
    "没上的重复课已删掉（已记完的按设计保留）",
    (gone.d ?? []).filter((l) => l.title === tag && l.status !== "done").length === 0,
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
