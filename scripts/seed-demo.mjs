// 往一个空库里塞一点演示数据，用来看界面 / 试功能。
// 用法：node scripts\seed-demo.mjs http://127.0.0.1:3210
// 注意：它会建学生和课，别往装真数据的库上跑。
const BASE = process.argv[2] || "http://127.0.0.1:3319";

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) throw new Error(method + " " + path + " => " + res.status + " " + text.slice(0, 200));
  return data;
}

const pad = (n) => String(n).padStart(2, "0");
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
};

await call("PATCH", "/api/settings", {
  org_name: "星光课后服务中心",
  teacher_name: "李老师",
  org_phone: "13800001234",
  org_address: "文化路 12 号 3 楼",
});

const math = await call("POST", "/api/courses", { name: "小学数学", subject: "数学", defaultMinutes: 90 });
const chinese = await call("POST", "/api/courses", { name: "语文阅读", subject: "语文", defaultMinutes: 90 });

const mk = (name, grade, guardianName, guardianPhone) =>
  call("POST", "/api/students", { name, grade, school: "实验小学", guardianName, guardianPhone });

const wang = await mk("王小明", "三年级", "王女士", "13800001111");
const li = await mk("李思远", "四年级", "李先生", "13800002222");
const zhang = await mk("张欣怡", "三年级", "张女士", "13800003333");

await call("POST", "/api/hours", { studentId: wang.id, deltaMinutes: 1800, kind: "purchase", amount: 2400, method: "微信", remark: "秋季班 20 次课" });
await call("POST", "/api/hours", { studentId: li.id, deltaMinutes: 1800, kind: "purchase", amount: 2400, method: "微信", remark: "秋季班 20 次课" });
await call("POST", "/api/hours", { studentId: zhang.id, deltaMinutes: 540, kind: "purchase", amount: 720, method: "支付宝", remark: "6 次体验课" });

const lesson = (offset, time, courseId, studentIds, title) =>
  call("POST", "/api/lessons", { courseId, startAt: day(offset) + " " + time, minutes: 90, title, studentIds });

const today = await lesson(0, "16:30", math.id, [wang.id, zhang.id], "两位数进位加法");
await lesson(1, "16:30", chinese.id, [li.id], "课外阅读：猜猜我有多爱你");
await lesson(2, "10:00", math.id, [wang.id, li.id], "应用题读题训练");
await lesson(-2, "16:30", math.id, [wang.id, zhang.id], "乘法口诀复习");
await lesson(-5, "16:30", chinese.id, [li.id], "看图写话");
await lesson(-7, "10:00", math.id, [wang.id], "认识钟表");

const note = (id, content, topic) =>
  call("POST", "/api/students/" + id + "/notes", { content, topic, level: 3 });
await note(wang.id, "今天讲两位数进位加法，口算速度有提升，进位偶尔漏 1，回家练 5 道题巩固。", "进位加法");
await note(wang.id, "应用题读题训练：圈关键词做得好，单位换算还会错，下周继续。", "应用题");
await note(zhang.id, "乘法口诀背到 6，剩 7-9 再熟一熟。", "乘法口诀");
await note(li.id, "看图写话能写满三句，标点还是全用逗号，下节课重点讲句号。", "写话");

// 今天这节课上完，记出勤，让「今日」「统计」有东西看
// 注意 finish 的请求体是 { items: [...] }
await call("POST", "/api/lessons/" + today.id + "/finish", {
  items: [
    { studentId: wang.id, status: "present", note: "进位加法讲通了，作业正确率 8/10。" },
    { studentId: zhang.id, status: "present", note: "口诀还差 7-9，课上多带两遍。" },
  ],
});

const share = await call("GET", "/api/share/link?id=" + wang.id);
console.log("演示数据已就绪：3 个学生、2 门课、6 节课、4 条学情、1 节课已记完");
console.log("家长分享页：" + BASE + share.path);
