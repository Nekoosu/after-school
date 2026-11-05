/** 时间工具：全部用本地时间，格式 'YYYY-MM-DD' / 'YYYY-MM-DD HH:mm' */

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function toDateTimeStr(d: Date): string {
  return `${toDateStr(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 解析 'YYYY-MM-DD HH:mm' 或 'YYYY-MM-DD'，按本地时区 */
export function parseLocal(s: string): Date {
  const [datePart, timePart = "00:00"] = s.trim().split(" ");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

/** "YYYY-MM-DD" 且是真实存在的日期（2026-13-99 这种要被拦下） */
export function isDayStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** 所在周的周一 00:00 */
export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const weekday = x.getDay() || 7; // 周日=7
  x.setDate(x.getDate() - weekday + 1);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function todayStr(): string {
  return toDateStr(new Date());
}

/** 分钟 → '1.5 小时' / '90 分' */
export function minutesToText(m: number | null | undefined): string {
  const v = m ?? 0;
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  const h = Math.floor(a / 60);
  const min = a % 60;
  if (h === 0) return `${sign}${min} 分`;
  if (min === 0) return `${sign}${h} 小时`;
  return `${sign}${h} 小时 ${min} 分`;
}

export function weekdayCN(d: Date | string): string {
  const date = typeof d === "string" ? parseLocal(d) : d;
  return ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
}

/** 'HH:mm' 显示，去掉日期 */
export function timeOnly(s: string): string {
  return s.includes(" ") ? s.split(" ")[1] : s;
}
