/**
 * 课时计算（纯函数，没有数据库、没有 React）
 *
 * 这里是全系统最容易亏钱的地方，改之前先看 tests/hours.test.ts。
 * 铁律：余额永远由 hours_ledger 求和得出，不存在「余额字段」。
 */

export type AttStatus = "present" | "leave" | "absent" | "makeup";

/** 到课、补课才扣课时；请假和缺席不扣（请假的进待补名单） */
export function isBillable(status: string): boolean {
  return status === "present" || status === "makeup";
}

/** 某个学生在这节课实际该扣多少分钟 */
export function billedMinutes(status: string, lessonMinutes: number): number {
  const m = Number.isFinite(lessonMinutes) && lessonMinutes > 0 ? Math.round(lessonMinutes) : 0;
  return isBillable(status) ? m : 0;
}

/** 一节课所有人的扣课合计 */
export function totalBilled(
  items: ReadonlyArray<{ status: string }>,
  lessonMinutes: number,
): number {
  return items.reduce((sum, it) => sum + billedMinutes(it.status, lessonMinutes), 0);
}

/** 余额 = 流水求和。传进来越多越准，空数组就是 0 */
export function balanceOf(deltas: ReadonlyArray<number>): number {
  return deltas.reduce((sum, d) => sum + (Number.isFinite(d) ? d : 0), 0);
}

/** 还差多少分钟才够上这节课（够就返回 0） */
export function shortfall(balanceMinutes: number, lessonMinutes: number): number {
  const b = Number.isFinite(balanceMinutes) ? Math.round(balanceMinutes) : 0;
  const m = Number.isFinite(lessonMinutes) ? Math.round(lessonMinutes) : 0;
  return Math.max(0, m - b);
}

/**
 * 这节课还能不能记（防止重复扣课时）。
 * 返回 false 的两种情况：已经记过（status='done'）、或者这节课已经产生过扣课流水。
 */
export function canBill(lessonStatus: string, billedLessonIds: ReadonlyArray<number>, lessonId: number): boolean {
  if (lessonStatus === "done") return false;
  return !billedLessonIds.includes(lessonId);
}

/** 请假了还没补课的学生：有 leave、且之后没有 makeup 记录 */
export function stillPendingMakeup(
  events: ReadonlyArray<{ studentId: number; status: string; at: string }>,
): number[] {
  const last = new Map<number, string>();
  for (const e of [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))) {
    last.set(e.studentId, e.status);
  }
  return [...last.entries()].filter(([, s]) => s === "leave").map(([id]) => id);
}

/** 1620 → "27 小时"、90 → "1.5 小时"。界面上的课时口径统一走这个 */
export function hoursText(minutes: number): string {
  const h = (Number.isFinite(minutes) ? minutes : 0) / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} 小时`;
}
