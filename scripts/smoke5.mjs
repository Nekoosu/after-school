// 第五批冒烟：自动备份 / 知识点 / 冲突预检 / AI 回退
// 用法：node scripts/smoke5.mjs http://127.0.0.1:3315
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
const patch = (p, b) => j(p, { method: "PATCH", body: JSON.stringify(b) });

const today = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

(async () => {
  console.log(`\n== 备份 ==`);
  const bl = await j("/api/backup/list");
  chk("GET /api/backup/list 200", bl.status === 200);
  chk("有备份目录", typeof bl.d?.dir === "string" && bl.d.dir.length > 0, JSON.stringify(bl.d).slice(0, 120));
  chk("今天已自动备份", (bl.d?.files ?? []).some((f) => f.name.startsWith(`auto-${today}`)), JSON.stringify(bl.d?.files?.[0]));

  const mb = await post("/api/backup/list", {});
  chk("POST 立即备份 200", mb.status === 200 && !!mb.d?.file?.name, JSON.stringify(mb.d).slice(0, 120));
  const fname = mb.d?.file?.name ?? "";
  chk("手动备份文件名合法", /^manual-\d{4}-\d{2}-\d{2}-\d{4}(\d{2})?(-\d+)?\.db$/.test(fname), fname);
  if (fname) {
    const dl = await fetch(`${BASE}/api/backup?file=${encodeURIComponent(fname)}`);
    const buf = new Uint8Array(await dl.arrayBuffer());
    const head = String.fromCharCode(...buf.slice(0, 15));
    chk("能下载到这份备份且是 SQLite", dl.status === 200 && head === "SQLite format 3", `${dl.status} ${head}`);
  }
  const bad = await fetch(`${BASE}/api/backup?file=../../etc/passwd`);
  chk("非法文件名被拒", bad.status === 404 || bad.status === 400, String(bad.status));

  console.log(`\n== 知识点 ==`);
  const s1 = await post("/api/students", { name: "冒烟知识点甲", grade: "三年级" });
  const s2 = await post("/api/students", { name: "冒烟知识点乙", grade: "三年级" });
  const id1 = s1.d?.id;
  const id2 = s2.d?.id;
  chk("建了两个学生", !!id1 && !!id2);
  const c = await post("/api/courses", { name: "冒烟知识点课", defaultMinutes: 90 });
  const cid = c.d?.id;
  const les = await post("/api/lessons", {
    courseId: cid,
    startAt: `${today} 18:30`,
    minutes: 90,
    studentIds: [id1, id2],
  });
  const lid = les.d?.id;
  chk("排了一节课", !!lid, JSON.stringify(les.d).slice(0, 120));

  const fin = await post(`/api/lessons/${lid}/finish`, {
    items: [
      { studentId: id1, status: "present", note: "两位数进位会漏一位", topic: "两位数进位", level: 2 },
      { studentId: id2, status: "present", note: "口算很快", topic: "两位数进位", level: 4 },
    ],
  });
  chk("记完扣了 180 分钟", fin.d?.billedTotal === 180, JSON.stringify(fin.d).slice(0, 120));
  chk("写入 2 条学情", fin.d?.noteCount === 2);

  const tp = await j("/api/topics");
  chk("GET /api/topics 200", tp.status === 200);
  chk("候选里有刚记的知识点", Array.isArray(tp.d) && tp.d.some((x) => x.topic === "两位数进位"), JSON.stringify(tp.d).slice(0, 120));

  const sd = await j(`/api/students/${id1}`);
  const t0 = (sd.d?.topics ?? [])[0];
  chk("学生详情有知识点聚合", !!t0, JSON.stringify(sd.d?.topics ?? []).slice(0, 120));
  chk("知识点名字对", t0?.topic === "两位数进位", JSON.stringify(t0));
  chk("甲的最近等级是 2", t0?.last_level === 2, String(t0?.last_level));
  const sd2 = await j(`/api/students/${id2}`);
  const t1 = (sd2.d?.topics ?? [])[0];
  chk("乙的最近等级是 4", t1?.last_level === 4, String(t1?.last_level));
  chk("两人各记 1 次", t0?.count === 1 && t1?.count === 1, `${t0?.count}/${t1?.count}`);
  chk("平均分等于等级（只有一条）", Math.abs((t1?.avg_level ?? 0) - 4) < 0.01, String(t1?.avg_level));

  console.log(`\n== 冲突预检 ==`);
  const ok0 = await j(`/api/lessons/conflicts?startAt=${encodeURIComponent(`${today} 20:00`)}&minutes=90&studentIds=${id1}`);
  chk("空时段没冲突", ok0.status === 200 && ok0.d?.conflicts?.length === 0, JSON.stringify(ok0.d));

  const bad1 = await j(
    `/api/lessons/conflicts?startAt=${encodeURIComponent(`${today} 18:45`)}&minutes=90&studentIds=${id1},${id2}`,
  );
  chk("18:45 与 18:30 的课冲突 2 条", bad1.d?.conflicts?.length === 2, JSON.stringify(bad1.d));
  chk("冲突带学生名", bad1.d?.conflicts?.every((x) => !!x.student_name), JSON.stringify(bad1.d?.conflicts?.[0]));

  const self = await j(
    `/api/lessons/conflicts?startAt=${encodeURIComponent(`${today} 18:30`)}&minutes=90&studentIds=${id1}&exclude=${lid}`,
  );
  chk("排除自己后不算冲突", self.d?.conflicts?.length === 0, JSON.stringify(self.d));

  const badargs = await j(`/api/lessons/conflicts?startAt=xx&minutes=90&studentIds=`);
  chk("参数不合法时返回空", badargs.status === 200 && badargs.d?.conflicts?.length === 0);

  console.log(`\n== AI ==`);
  const ai = await j("/api/ai");
  chk("GET /api/ai 200", ai.status === 200);
  chk("默认没开", ai.d?.enabled === false, JSON.stringify(ai.d));
  chk("不回传 key", !JSON.stringify(ai.d).includes("sk-"), JSON.stringify(ai.d));

  const g0 = await post("/api/feedback/generate", { studentId: id1, from: today, to: today });
  chk("本地草稿能生成", g0.status === 200 && (g0.d?.content ?? "").length > 30, JSON.stringify(g0.d).slice(0, 100));
  const g1 = await post("/api/feedback/generate", {
    studentId: id1,
    from: today,
    to: today,
    useAi: true,
  });
  chk("要求 AI 但没开时回退本地", g1.status === 200 && g1.d?.ai?.used === false, JSON.stringify(g1.d?.ai));
  chk("回退时给出原因", typeof g1.d?.ai?.reason === "string" && g1.d.ai.reason.length > 0, JSON.stringify(g1.d?.ai));
  chk("回退的内容和本地草稿一致", g1.d?.content === g0.d?.content);

  const aiTest = await post("/api/ai", { base: "http://127.0.0.1:1/v1", model: "x", key: "" });
  chk("测试连接失败时不抛 500", aiTest.status === 200 && aiTest.d?.ok === false, JSON.stringify(aiTest.d).slice(0, 120));

  console.log(`\n== 设置项 ==`);
  const st = await j("/api/settings");
  chk("设置里有 ai_base", !!st.d?.ai_base, JSON.stringify(st.d).slice(0, 200));
  chk("ai_enabled 默认 0", String(st.d?.ai_enabled) === "0", String(st.d?.ai_enabled));

  console.log(`\n== 清理 ==`);
  await j(`/api/lessons/${lid}`, { method: "DELETE" });
  await j(`/api/students/${id1}`, { method: "DELETE" });
  await j(`/api/students/${id2}`, { method: "DELETE" });
  await j(`/api/courses/${cid}`, { method: "DELETE" }).catch(() => {});

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("冒烟脚本自身出错：", e);
  process.exit(2);
});
