import test from "node:test";
import assert from "node:assert/strict";

import { planPoints } from "../src/lib/markdown.ts";
import { buildLessonReport, buildReport } from "../src/lib/report.ts";

const PLAN = [
  "# 行程问题：相遇与追及",
  "",
  "## 相遇问题",
  "- 画线段图",
  "## 追及问题",
  "- 速度差是关键",
  "## 课堂练习",
  "- 三道应用题",
].join("\n");

test("planPoints 跳过大标题，优先小标题", () => {
  const pts = planPoints(PLAN);
  assert.deepEqual(pts, ["相遇问题", "追及问题", "课堂练习"]);
});

test("planPoints 没有小标题时退回列表项", () => {
  const pts = planPoints("# 只有大标题\n- 第一项\n- 第二项");
  assert.deepEqual(pts, ["第一项", "第二项"]);
});

test("planPoints 既没小标题也没列表才用大标题", () => {
  assert.deepEqual(planPoints("# 只有标题一行"), ["只有标题一行"]);
});

test("planPoints 去重、去尾标点、限长", () => {
  const pts = planPoints("## 相遇问题：\n## 相遇问题：\n## 追及问题", 5, 18);
  assert.deepEqual(pts, ["相遇问题", "追及问题"]);
});

test("planPoints 空内容返回空数组", () => {
  assert.deepEqual(planPoints(""), []);
});

const base = {
  studentName: "王浩然",
  orgName: "星星课后服务中心",
  teacherName: "李老师",
  dateStr: "2026-11-04",
  courseName: "数学思维",
  lessonTitle: "第三讲",
  planTitle: "行程问题：相遇与追及",
  planPoints: ["相遇问题", "追及问题"],
  attStatus: "present",
  brief: "线段图会画了",
  billedMinutes: 90,
  balanceMinutes: 1350,
  lessonMinutes: 90,
};

test("单节课反馈带上课内容，不用老师重复", () => {
  const t = buildLessonReport(base);
  assert.match(t, /11月4日 这节课我们讲的是「行程问题：相遇与追及」——相遇问题、追及问题。/);
  assert.match(t, /线段图会画了/);
  assert.match(t, /这次扣 1.5 小时，目前还剩 22.5 小时（约 15 次课）/);
  assert.match(t, /星星课后服务中心　李老师/);
});

test("请假：有请假说法，且不扣课时", () => {
  const t = buildLessonReport({ ...base, attStatus: "leave", brief: "", billedMinutes: 0 });
  assert.match(t, /孩子今天请假了/);
  assert.match(t, /这次没有扣课时/);
  assert.match(t, /补课时间我排好之后跟您说/);
});

test("课时快用完会提醒", () => {
  const t = buildLessonReport({ ...base, balanceMinutes: 90 });
  assert.match(t, /课时不多了/);
});

test("课时为 0 提醒续费", () => {
  const t = buildLessonReport({ ...base, balanceMinutes: 0, billedMinutes: 90 });
  assert.match(t, /课时已经用完啦/);
});

test("没教案时退回这节课的标题", () => {
  const t = buildLessonReport({ ...base, planTitle: null, planPoints: [] });
  assert.match(t, /我们讲的是第三讲。/);
});

test("知识点按等级给下一步", () => {
  const weak = buildLessonReport({ ...base, topic: "行程问题", level: 2 });
  assert.match(weak, /今天重点练的是「行程问题」，我按「一般」记的/);
  assert.match(weak, /这块下次课我再带着过一遍/);

  const good = buildLessonReport({ ...base, topic: "行程问题", level: 4 });
  assert.match(good, /掌握得不错，下次会往上加一点难度/);
});

test("补课会说明是补之前的", () => {
  const t = buildLessonReport({ ...base, attStatus: "makeup", brief: "把上次落下的追及补上了" });
  assert.match(t, /今天补的是之前落下的内容，把上次落下的追及补上了/);
});

/* ---------------- 反馈语气 ---------------- */

function toneInput(tone: "plain" | "warm" | "brief") {
  return {
    studentName: "小明",
    orgName: "天凉课后服务",
    teacherName: "张老师",
    periodStart: "2026-02-01",
    periodEnd: "2026-02-28",
    tone,
    lessons: [
      { start_at: "2026-02-03T18:00:00", status: "done", att_status: "present" },
      { start_at: "2026-02-10T18:00:00", status: "done", att_status: "present" },
    ],
    notes: [
      { created_at: "2026-02-03T19:50:00", kind: "progress", topic: "分数应用题", level: 4, content: "方法掌握得不错" },
    ],
    usedMinutes: 180,
    balanceMinutes: 1440,
    lessonMinutes: 90,
  };
}

test("语气：常规版开头与结尾照旧", () => {
  const r = buildReport(toneInput("plain"));
  assert.ok(r.startsWith("小明 家长您好："), r.slice(0, 20));
  assert.ok(r.includes("有什么想法随时联系我"), r.slice(-60));
});

test("语气：亲切版多一句人情味", () => {
  const r = buildReport(toneInput("warm"));
  assert.ok(r.includes("孩子最近挺用心"), r.slice(0, 120));
  assert.ok(r.includes("孩子在进步，咱们保持联系"), r.slice(-80));
});

test("语气：简短版开头更短、下一步只留一条", () => {
  const r = buildReport(toneInput("brief"));
  assert.ok(r.startsWith("小明 家长："), r.slice(0, 20));
  assert.ok(!r.includes("有什么想法随时联系我"), "不该出现常规版收尾");
  const next = r.split("【下一步】")[1]?.split("\n").filter((l) => l.startsWith("· ")) ?? [];
  assert.equal(next.length, 1, r);
});

test("语气：单节课版开头跟着变", () => {
  assert.ok(buildLessonReport({ ...base, tone: "brief" }).startsWith("王浩然 家长："));
  assert.ok(buildLessonReport({ ...base, tone: "warm" }).includes("辛苦您在家也多鼓励"));
  assert.ok(buildLessonReport(base).startsWith("王浩然 家长您好："));
});

test("落款：没填老师就只写机构", () => {
  const r = buildReport({ ...toneInput("plain"), teacherName: "" });
  assert.ok(r.trim().endsWith("天凉课后服务"), r.slice(-40));
  assert.ok(!r.includes("天凉课后服务　老师"), "不该出现「机构　老师」");
});

test("落款：只填老师就只写老师", () => {
  const r = buildReport({ ...toneInput("plain"), orgName: "" });
  assert.ok(r.trim().endsWith("张老师"), r.slice(-40));
});

test("落款：单节课版同样不写空老师", () => {
  const r = buildLessonReport({ ...base, teacherName: "" });
  assert.ok(!r.includes("老师老师"), r.slice(-60));
  assert.ok(r.trim().endsWith("星星课后服务中心"), r.slice(-40));
});
