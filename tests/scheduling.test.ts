import test from "node:test";
import assert from "node:assert/strict";
import { overlaps } from "../src/lib/scheduling.ts";

test("同一时间同一天算冲突", () => {
  assert.equal(overlaps("2026-11-04 16:30", 90, "2026-11-04 16:30", 90), true);
});

test("首尾相接不算冲突（16:30-18:00 和 18:00-19:30）", () => {
  assert.equal(overlaps("2026-11-04 16:30", 90, "2026-11-04 18:00", 90), false);
  assert.equal(overlaps("2026-11-04 18:00", 90, "2026-11-04 16:30", 90), false);
});

test("部分重叠算冲突", () => {
  assert.equal(overlaps("2026-11-04 16:30", 90, "2026-11-04 17:00", 30), true);
  assert.equal(overlaps("2026-11-04 17:30", 90, "2026-11-04 16:30", 90), true);
});

test("完全包含算冲突", () => {
  assert.equal(overlaps("2026-11-04 16:00", 120, "2026-11-04 16:30", 30), true);
  assert.equal(overlaps("2026-11-04 16:30", 30, "2026-11-04 16:00", 120), true);
});

test("不同天不冲突", () => {
  assert.equal(overlaps("2026-11-04 16:30", 90, "2026-11-05 16:30", 90), false);
  assert.equal(overlaps("2026-11-04 23:00", 60, "2026-11-05 00:00", 60), false);
});

test("跨小时的课也算得对", () => {
  assert.equal(overlaps("2026-11-04 09:00", 180, "2026-11-04 11:59", 10), true);
  assert.equal(overlaps("2026-11-04 09:00", 180, "2026-11-04 12:00", 10), false);
});
