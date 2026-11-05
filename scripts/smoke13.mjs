/**
 * 冒烟 13：删备份 + 家长页「本月小结」/「下次上课」时区
 * 用法：node scripts\smoke13.mjs http://127.0.0.1:3319
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
const today = new Date();
const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

const tag = `测${Date.now().toString().slice(-6)}`;

console.log("== 删除备份 ==");

const list0 = await req("/api/backup/list");
ok("备份列表 200", list0.res.status === 200, list0.text.slice(0, 160));
const count0 = list0.body?.files?.length ?? -1;
ok("列表里有 files 数组", Array.isArray(list0.body?.files), String(count0));

const made = await post("/api/backup/list", {});
ok("立即备份 200", made.res.status === 200, made.text.slice(0, 160));
const name = made.body?.file?.name ?? "";
ok("备份文件名合规", /^(auto|manual)-\d{4}-\d{2}-\d{2}-\d{4}(\d{2})?(-\d+)?\.db$/.test(name), name);

const count1 = (await req("/api/backup/list")).body?.files?.length ?? -1;
ok("新备份进了列表", count1 === count0 + 1, `${count0} → ${count1}`);

const dl = await fetch(`${BASE}/api/backup?file=${encodeURIComponent(name)}`);
ok("删之前能下载", dl.status === 200, String(dl.status));

const removed = await del(`/api/backup?file=${encodeURIComponent(name)}`);
ok("删除 200", removed.res.status === 200, removed.text.slice(0, 200));
ok("返回删掉的是那一份", removed.body?.removed === name, String(removed.body?.removed));
ok("返回剩余份数", typeof removed.body?.left === "number" && removed.body.left === count0, String(removed.body?.left));
ok("返回省出多少字节", typeof removed.body?.freed === "number" && removed.body.freed > 0, String(removed.body?.freed));

const count2 = (await req("/api/backup/list")).body?.files?.length ?? -1;
ok("列表少了一份", count2 === count0, `${count1} → ${count2}`);

const dl2 = await fetch(`${BASE}/api/backup?file=${encodeURIComponent(name)}`);
ok("删完下载不到了", dl2.status === 404, String(dl2.status));

const again = await del(`/api/backup?file=${encodeURIComponent(name)}`);
ok("重复删同一份 400", again.res.status === 400, String(again.res.status));

const evil = await del("/api/backup?file=..%2Fevil.db");
ok("路径穿越被拒 400", evil.res.status === 400, String(evil.res.status));

const ghost = await del("/api/backup?file=auto-1999-01-01-0000.db");
ok("不存在的备份 400", ghost.res.status === 400, String(ghost.res.status));

const noFile = await del("/api/backup");
ok("不给文件名 400", noFile.res.status === 400, String(noFile.res.status));
ok("错误提示是中文", /指定删哪一份/.test(noFile.body?.error ?? ""), String(noFile.body?.error));

console.log("== 家长页本月小结 / 下次上课 ==");

const stu = await post("/api/students", { name: `${tag}月结生` });
ok("建学生 201", stu.res.status === 201, stu.text.slice(0, 160));
const sid = stu.body?.id;

const course = await post("/api/courses", { name: `${tag}月结课` });
ok("建课程 201", course.res.status === 201, course.text.slice(0, 160));
const cid = course.body?.id;

const hours = await post("/api/hours", { studentId: sid, deltaMinutes: 600, kind: "purchase", amount: 1000 });
ok("充值 2xx", hours.res.status === 200 || hours.res.status === 201, String(hours.res.status));

// 今天早些时候一节（90 分钟），补一节今晚 23:30 的作为「下次上课」
const past = await post("/api/lessons", {
  courseId: cid,
  startAt: `${todayStr} 00:10`,
  minutes: 90,
  studentIds: [sid],
  title: `${tag}小结课`,
});
ok("排今天的课 201", past.res.status === 201, past.text.slice(0, 200));
const lessonId = past.body?.id;

const fin = await post(`/api/lessons/${lessonId}/finish`, { items: [{ studentId: sid, status: "present" }] });
ok("记到课 200", fin.res.status === 200, fin.text.slice(0, 200));

const future = await post("/api/lessons", {
  courseId: cid,
  startAt: `${todayStr} 23:30`,
  minutes: 60,
  studentIds: [sid],
  title: `${tag}下次课`,
});
ok("排今晚的课 201", future.res.status === 201, future.text.slice(0, 200));
const futureId = future.body?.id;

const link = await req(`/api/share/link?id=${sid}`);
const k = String(link.body?.path ?? "").split("k=")[1] ?? "";
ok("拿到分享链接", /^[0-9a-f]{24}$/.test(k), String(link.body?.path));

const data = await req(`/api/share?id=${sid}&k=${k}`);
ok("家长页数据 200", data.res.status === 200, data.text.slice(0, 160));
const month = data.body?.month ?? {};
ok("有本月小结块", typeof month === "object" && month !== null, JSON.stringify(data.body?.month));
ok("本月标签带「月」", /^\d{1,2} 月$/.test(month.label ?? ""), String(month.label));
ok("本月安排 2 节（含今晚那节）", month.lessons === 2, String(month.lessons));
ok("本月到课 1 节", month.attended === 1, String(month.attended));
ok("本月请假 0", month.leave === 0, String(month.leave));
ok("本月缺勤 0", month.absent === 0, String(month.absent));
ok("本月消耗 90 分钟", month.billedMinutes === 90, String(month.billedMinutes));
ok("下次上课能查到（今天晚上的课）", data.body?.next?.id === futureId, JSON.stringify(data.body?.next));

const other = await post("/api/students", { name: `${tag}别人家` });
const otherLink = await req(`/api/share/link?id=${other.body?.id}`);
const kOther = String(otherLink.body?.path ?? "").split("k=")[1] ?? "";
const cross = await req(`/api/share?id=${other.body?.id}&k=${k}`);
ok("拿别人的编号配自己的令牌 403", cross.res.status === 403, String(cross.res.status));

const page = await fetch(`${BASE}/share/${sid}?k=${k}`);
const html = await page.text();
ok("分享页 HTML 200", page.status === 200, String(page.status));
ok("分享页有容器", /share-plain|share-card/.test(html));

// 清理
await del(`/api/lessons/${futureId}`);
await del(`/api/lessons/${lessonId}`);
await del(`/api/courses/${cid}`);
await del(`/api/students/${sid}`);
await del(`/api/students/${other.body?.id}`);
void kOther;

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
