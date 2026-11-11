import { get } from "@/db";

/**
 * 课消单价（元 / 小时）与单节课课消金额。
 *
 * 一个学生可能存了好几个班型的钱、单价各不相同，所以「这节课该按哪个价扣」
 * 需要一个明确的先后顺序，算出来的单价还要写进 hours_ledger 当快照 ——
 * 以后调价、退费都不会把老账算错。
 *
 * 顺序：
 *   1) 排课时给这节课指定的单价（lesson.price_per_hour）
 *   2) 这个学生在这门课上最近一次充值的单价（学生自己买的价）
 *   3) 这门课最近一次充值的单价（同班同学买的价，作为参照）
 *   4) 课程表上的 price_per_lesson 换算成每小时
 *   5) 都没有 → null（记课消金额为 0，只扣课时）
 */

export type PriceSource = "lesson" | "student" | "course-purchase" | "course" | "none";

export interface PriceInfo {
  unitPrice: number | null;
  source: PriceSource;
  /** 这个学生这节课的课消金额（元，正数）；不知道单价就是 null */
  amount: number | null;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function perHour(amount: number | null, minutes: number | null): number | null {
  if (!amount || !minutes || minutes <= 0) return null;
  return round2((amount / minutes) * 60);
}

/** 最近一次充值的元/小时（给不给学生就只看 studentId） */
function lastPurchasePrice(studentId: number, courseId: number): number | null {
  const row = get<{ unit_price: number | null; amount: number | null; delta_minutes: number }>(
    `select unit_price, amount, delta_minutes from hours_ledger
      where kind = 'purchase' and course_id = ? and student_id = ?
      order by id desc limit 1`,
    [courseId, studentId],
  );
  if (!row) return null;
  if (row.unit_price && row.unit_price > 0) return round2(row.unit_price);
  return perHour(row.amount, row.delta_minutes);
}

/** 这门课最近一次充值的元/小时（谁买的都算） */
function lastCoursePrice(courseId: number): number | null {
  const row = get<{ unit_price: number | null; amount: number | null; delta_minutes: number }>(
    `select unit_price, amount, delta_minutes from hours_ledger
      where kind = 'purchase' and course_id = ?
      order by id desc limit 1`,
    [courseId],
  );
  if (!row) return null;
  if (row.unit_price && row.unit_price > 0) return round2(row.unit_price);
  return perHour(row.amount, row.delta_minutes);
}

/**
 * 解析某学生这节课的单价与课消金额。
 * @param billedMinutes 实际计时长（请假 0 分钟就不该有钱）
 */
export function resolvePrice(
  studentId: number,
  courseId: number,
  lessonPerHour: number | null,
  billedMinutes: number,
): PriceInfo {
  let unitPrice: number | null = null;
  let source: PriceSource = "none";

  if (lessonPerHour && lessonPerHour > 0) {
    unitPrice = round2(lessonPerHour);
    source = "lesson";
  } else {
    const own = lastPurchasePrice(studentId, courseId);
    if (own) {
      unitPrice = own;
      source = "student";
    } else {
      const course = lastCoursePrice(courseId);
      if (course) {
        unitPrice = course;
        source = "course-purchase";
      } else {
        const c = get<{ price_per_lesson: number | null; default_minutes: number }>(
          "select price_per_lesson, default_minutes from course where id = ?",
          [courseId],
        );
        const derived = perHour(c?.price_per_lesson ?? null, c?.default_minutes ?? 90);
        if (derived) {
          unitPrice = derived;
          source = "course";
        }
      }
    }
  }

  const amount = unitPrice && billedMinutes > 0 ? round2((unitPrice * billedMinutes) / 60) : null;
  return { unitPrice, source, amount };
}

export const PRICE_SOURCE_CN: Record<PriceSource, string> = {
  lesson: "这节课指定",
  student: "学生买的价",
  "course-purchase": "同课程充值价",
  course: "课程标价",
  none: "未定价",
};
