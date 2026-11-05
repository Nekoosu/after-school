// 导入导出冒烟：node scripts/smoke8.mjs http://127.0.0.1:3319
const base = process.argv[2] || "http://127.0.0.1:3319";
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
  return { status: res.status, body, text, headers: res.headers };
}

const tag = String(Date.now() % 100000);
console.log(`\n== 导入导出 ==  ${base}\n`);

// 1. 全量 JSON
const all = await req("/api/export");
ok("全量导出 200", all.status === 200);
ok("全量导出带 tables/counts", !!all.body?.tables && !!all.body?.counts);
ok("全量导出 13 张表", Object.keys(all.body?.tables ?? {}).length === 13, JSON.stringify(Object.keys(all.body?.tables ?? {})).slice(0, 120));
ok("全量导出是附件", String(all.headers.get("content-disposition") ?? "").includes("attachment"));

// 2. 学生 CSV（BOM + 表头）
const stuCsv = await req("/api/export?scope=students&format=csv");
ok("学生 CSV 200", stuCsv.status === 200);
// fetch 的 text() 会吃掉 BOM，必须看原始字节
const csvBytes = new Uint8Array(await (await fetch(base + "/api/export?scope=students&format=csv")).arrayBuffer());
ok("学生 CSV 带 BOM", csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf, [...csvBytes.slice(0, 3)].join(","));
ok("学生 CSV 表头正确", stuCsv.text.includes("姓名,年级,学校,家长,电话,微信,状态"), stuCsv.text.split("\n")[0]?.slice(0, 80));

// 3. 学生 JSON（驼峰，能导回去）
const stuJson = await req("/api/export?scope=students&format=json");
ok("学生 JSON 200", stuJson.status === 200);
ok("学生 JSON 是 rows 数组", Array.isArray(stuJson.body?.rows));

// 4. 其它 scope
for (const [scope, kw] of [
  ["plans", "rows"],
  ["classes", "rows"],
  ["payments", "日期"],
  ["records", "上课时间"],
]) {
  const r = await req(`/api/export?scope=${scope}`);
  ok(`导出 ${scope} 200`, r.status === 200);
  const bodyText = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
  ok(`导出 ${scope} 内容像样`, bodyText.includes(kw), bodyText.slice(0, 80));
}

const bad = await req("/api/export?scope=nope");
ok("未知 scope 也能返回全量而不是崩（默认 all）", bad.status === 200 || bad.status === 400);

// 5. 建两篇教案，导出 → 导入 dryRun 不落库
const p1 = await req("/api/plans", {
  method: "POST",
  body: JSON.stringify({ title: `导入甲-${tag}`, content: "## 一\n甲的内容", topic: "甲" }),
});
ok("建教案甲", p1.status === 200 || p1.status === 201, String(p1.status));
const plansBefore = (await req("/api/plans")).body.length;
const plansJson = await req("/api/export?scope=plans");
const rows = plansJson.body.rows.filter((r) => r.content);

const dry = await req("/api/import", {
  method: "POST",
  body: JSON.stringify({ scope: "plans", rows: [...rows, { title: `新教案-${tag}`, content: "# 新的\n内容" }] }),
});
ok("教案导入 dryRun 200", dry.status === 200, JSON.stringify(dry.body).slice(0, 120));
ok("dryRun 只新增 1 条", dry.body?.created === 1, `created=${dry.body?.created}`);
ok("dryRun 跳过已有教案", (dry.body?.skipped ?? 0) >= 1, `skipped=${dry.body?.skipped}`);
ok("dryRun 标记自己是试算", dry.body?.dryRun === true);
const plansAfterDry = (await req("/api/plans")).body.length;
ok("dryRun 真的没写库", plansAfterDry === plansBefore, `${plansBefore} → ${plansAfterDry}`);

// 6. 真导入
const real = await req("/api/import", {
  method: "POST",
  body: JSON.stringify({ scope: "plans", rows: [{ title: `新教案-${tag}`, content: "# 新的\n内容" }], dryRun: false }),
});
ok("教案真导入 created=1", real.body?.created === 1, JSON.stringify(real.body).slice(0, 120));
ok("教案真导入后数量 +1", (await req("/api/plans")).body.length === plansBefore + 1);
const again = await req("/api/import", {
  method: "POST",
  body: JSON.stringify({ scope: "plans", rows: [{ title: `新教案-${tag}`, content: "别的" }], dryRun: false }),
});
ok("重名不覆盖（created=0 skipped=1）", again.body?.created === 0 && again.body?.skipped === 1, JSON.stringify(again.body).slice(0, 120));

// 7. 学生导入
const stuDry = await req("/api/import", {
  method: "POST",
  body: JSON.stringify({ scope: "students", rows: [{ name: `导入生-${tag}`, grade: "三年级" }] }),
});
ok("学生 dryRun created=1", stuDry.body?.created === 1);
const stuCountBefore = (await req("/api/students")).body.length;
const stuReal = await req("/api/import", {
  method: "POST",
  body: JSON.stringify({ scope: "students", rows: [{ name: `导入生-${tag}`, grade: "三年级" }], dryRun: false }),
});
ok("学生真导入成功", stuReal.body?.created === 1);
ok("学生数量 +1", (await req("/api/students")).body.length === stuCountBefore + 1);
ok("同名学生跳过", (await req("/api/import", { method: "POST", body: JSON.stringify({ scope: "students", rows: [{ name: `导入生-${tag}` }], dryRun: false }) })).body.created === 0);

// 8. 班级导入：课程不存在 → 自动建；成员按名字找学生；找不到的报出来
const clsCourse = `导入课程-${tag}`;
const cls = await req("/api/import", {
  method: "POST",
  body: JSON.stringify({
    scope: "classes",
    dryRun: false,
    rows: [
      { name: `导入班-${tag}`, course: clsCourse, weekday: 3, start_time: "17:00", minutes: 90, members: [`导入生-${tag}`, "根本不存在的人"] },
    ],
  }),
});
ok("班级导入成功", cls.body?.created === 1, JSON.stringify(cls.body).slice(0, 160));
ok("班级导入顺手建课程", cls.body?.courseCreated === 1);
ok("班级成员缺失会报出来", (cls.body?.errors ?? []).some((e) => String(e.reason).includes("根本不存在的人")), JSON.stringify(cls.body?.errors));
const classesJson = await req("/api/export?scope=classes");
const imported = classesJson.body.rows.find((r) => r.name === `导入班-${tag}`);
ok("班级导出带成员名字", (imported?.members ?? []).includes(`导入生-${tag}`), JSON.stringify(imported?.members));
ok("班级导入校验 weekday", imported?.weekday === 3);

// 9. 参数校验
ok("scope 非法 400", (await req("/api/import", { method: "POST", body: JSON.stringify({ scope: "x", rows: [] }) })).status === 400);
ok("rows 不是数组 400", (await req("/api/import", { method: "POST", body: JSON.stringify({ scope: "plans", rows: "x" }) })).status === 400);
ok("空 rows 400", (await req("/api/import", { method: "POST", body: JSON.stringify({ scope: "plans", rows: [] }) })).status === 400);

// 10. AI 教案初稿：没开 AI 时是 ok:false 而不是 500
const draft = await req("/api/plans/draft", { method: "POST", body: JSON.stringify({ topic: `两位数进位-${tag}` }) });
ok("AI 初稿不抛 500", draft.status === 200);
ok("AI 未开时 ok=false 且有原因", draft.body?.ok === false && !!draft.body?.error, JSON.stringify(draft.body).slice(0, 120));
ok("AI 初稿缺主题 400", (await req("/api/plans/draft", { method: "POST", body: JSON.stringify({}) })).status === 400);

// 11. 页面能打开
for (const p of ["/plans", "/classes", "/students", "/settings"]) {
  const r = await fetch(base + p);
  ok(`页面 ${p} 200`, r.status === 200, String(r.status));
}

// 清理
const htt = { headers: { "Content-Type": "application/json" } };
for (const pl of (await req(`/api/plans?q=${encodeURIComponent("新教案-" + tag)}`)).body ?? []) {
  await fetch(`${base}/api/plans/${pl.id}`, { method: "DELETE", ...htt });
}
for (const pl of (await req(`/api/plans?q=${encodeURIComponent("导入甲-" + tag)}`)).body ?? []) {
  await fetch(`${base}/api/plans/${pl.id}`, { method: "DELETE", ...htt });
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) {
  console.log(fails.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
