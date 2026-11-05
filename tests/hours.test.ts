import test from "node:test";
import assert from "node:assert/strict";
import {
  balanceOf,
  billedMinutes,
  canBill,
  hoursText,
  isBillable,
  shortfall,
  stillPendingMakeup,
  totalBilled,
} from "../src/lib/hours.ts";

test("只有到课和补课扣课时", () => {
  assert.equal(isBillable("present"), true);
  assert.equal(isBillable("makeup"), true);
  assert.equal(isBillable("leave"), false);
  assert.equal(isBillable("absent"), false);
  assert.equal(isBillable("随便写的"), false);
});

test("扣课分钟数按出勤状态走", () => {
  assert.equal(billedMinutes("present", 90), 90);
  assert.equal(billedMinutes("makeup", 45), 45);
  assert.equal(billedMinutes("leave", 90), 0);
  assert.equal(billedMinutes("absent", 90), 0);
});

test("课时长度不合法时不扣钱", () => {
  assert.equal(billedMinutes("present", Number.NaN), 0);
  assert.equal(billedMinutes("present", -30), 0);
  assert.equal(billedMinutes("present", 0), 0);
});

test("一节课的扣课合计", () => {
  const items = [{ status: "present" }, { status: "leave" }, { status: "makeup" }, { status: "absent" }];
  assert.equal(totalBilled(items, 90), 180);
  assert.equal(totalBilled([], 90), 0);
});

test("余额永远是流水求和（1800 - 90 - 90 = 1620）", () => {
  assert.equal(balanceOf([1800, -90, -90]), 1620);
  assert.equal(balanceOf([]), 0);
  assert.equal(balanceOf([-90, 540]), 450);
  // 脏数据不能把余额搞崩
  assert.equal(balanceOf([100, Number.NaN, -50]), 50);
});

test("课时不够时算出还差多少", () => {
  assert.equal(shortfall(450, 90), 0);
  assert.equal(shortfall(90, 90), 0);
  assert.equal(shortfall(0, 90), 90);
  assert.equal(shortfall(-90, 90), 180);
  assert.equal(shortfall(Number.NaN, 90), 90);
});

test("同一节课不能扣两次课时", () => {
  assert.equal(canBill("planned", [], 12), true);
  assert.equal(canBill("planned", [3, 12], 12), false);
  assert.equal(canBill("done", [], 12), false);
  assert.equal(canBill("cancelled", [], 12), true);
});

test("请假之后补过课就不再算待补", () => {
  const pending = stillPendingMakeup([
    { studentId: 1, status: "leave", at: "2026-11-02 16:30" },
    { studentId: 2, status: "present", at: "2026-11-02 16:30" },
    { studentId: 3, status: "leave", at: "2026-11-02 16:30" },
    { studentId: 3, status: "makeup", at: "2026-11-04 18:00" },
  ]);
  assert.deepEqual(pending, [1]);
});

test("待补名单按最新一次出勤算，乱序也正确", () => {
  const pending = stillPendingMakeup([
    { studentId: 7, status: "makeup", at: "2026-11-05 10:00" },
    { studentId: 7, status: "leave", at: "2026-11-03 10:00" },
    { studentId: 8, status: "leave", at: "2026-11-03 10:00" },
  ]);
  assert.deepEqual(pending, [8]);
});

test("小时文本", () => {
  assert.equal(hoursText(1620), "27 小时");
  assert.equal(hoursText(90), "1.5 小时");
  assert.equal(hoursText(0), "0 小时");
  assert.equal(hoursText(30), "0.5 小时");
  assert.equal(hoursText(Number.NaN), "0 小时");
});
