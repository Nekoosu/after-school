// 纯格式化函数（服务端/客户端都能用，不含任何副作用）

/** 拼接 className，忽略假值 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** 金额：1280 → ¥1,280；空值 → — */
export function money(n: number | null | undefined, withSymbol = true): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  const s = v % 1 === 0 ? v.toLocaleString("zh-CN") : v.toFixed(2);
  return `${sign}${withSymbol ? "¥" : ""}${s}`;
}

/** 大额缩写：12800 → 1.28 万 */
export function moneyShort(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const v = Math.abs(n);
  if (v >= 10000) return `¥${(n / 10000).toFixed(v >= 100000 ? 1 : 2)}万`;
  return money(n);
}

/** 分钟 → 「1 小时 30 分」/「45 分钟」/「2 小时」 */
export function durationText(minutes: number | null | undefined): string {
  if (!minutes) return "0 分钟";
  const neg = minutes < 0;
  const m = Math.abs(minutes);
  const h = Math.floor(m / 60);
  const rest = m % 60;
  let s = "";
  if (h) s += `${h} 小时`;
  if (rest) s += `${h ? " " : ""}${rest} 分`;
  return (neg ? "-" : "") + (s || "0 分钟");
}

/** 分钟 → 小时数（保留一位）：540 → 9.0 */
export function toHours(minutes: number | null | undefined): number {
  return Math.round(((minutes ?? 0) / 60) * 10) / 10;
}

/** 相对时间：2026-11-04 15:30 → 今天 15:30 / 昨天 / 3 天前 */
export function relTime(dt: string | null | undefined): string {
  if (!dt) return "—";
  const d = new Date(dt.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return dt;
  const now = new Date();
  const dayMs = 86400000;
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / dayMs);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (diffDays === 0) return `今天 ${hm}`;
  if (diffDays === 1) return `昨天 ${hm}`;
  if (diffDays === 2) return `前天 ${hm}`;
  if (diffDays > 2 && diffDays < 30) return `${diffDays} 天前`;
  if (diffDays < 0) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 只取日期部分 */
export function dateOnly(dt: string | null | undefined): string {
  if (!dt) return "";
  return dt.slice(0, 10);
}

/** 只取时间部分 */
export function timeOf(dt: string | null | undefined): string {
  if (!dt) return "";
  return dt.slice(11, 16);
}

/** 「11月4日」 */
export function mdText(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

/** 头像首字：名字第一个字；英文取首字母大写 */
export function initial(name: string | null | undefined): string {
  if (!name) return "?";
  const t = name.trim();
  if (!t) return "?";
  if (/^[a-zA-Z]/.test(t)) return t[0].toUpperCase();
  return t[0];
}

const AVATAR_COLORS = [
  "#2563eb",
  "#7c5cff",
  "#0f9d63",
  "#c2751a",
  "#dc3d43",
  "#0aa2c0",
  "#db2777",
  "#4f46e5",
  "#059669",
  "#ea580c",
];

/** 按名字稳定取色 */
export function avatarColor(name: string | null | undefined): string {
  if (!name) return AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** 出勤状态中文 */
export const ATT_CN: Record<string, string> = {
  present: "出勤",
  leave: "请假",
  absent: "缺席",
  makeup: "补课",
};

/** 课次状态中文 */
export const LESSON_STATUS_CN: Record<string, string> = {
  planned: "待上课",
  done: "已记完",
  cancelled: "已取消",
  makeup: "补课",
};

/** 课时流水类型中文 */
export const LEDGER_KIND_CN: Record<string, string> = {
  purchase: "充值",
  gift: "赠送",
  adjust: "手动调整",
  refund: "退费",
  consume: "上课扣课",
  lesson: "上课扣课",
  makeup: "补课扣课",
};

/** 学情类型中文 */
export const NOTE_KIND_CN: Record<string, string> = {
  progress: "学习进展",
  behavior: "课堂表现",
  homework: "作业情况",
  parent: "家长沟通",
  other: "其他",
};

/** 学情类型配色 */
export const NOTE_KIND_COLOR: Record<string, string> = {
  progress: "badge-brand",
  behavior: "badge-violet",
  homework: "badge-cyan",
  parent: "badge-ok",
  other: "badge-outline",
};

/** 收款方式 */
export const PAY_METHOD_CN: Record<string, string> = {
  wechat: "微信",
  alipay: "支付宝",
  cash: "现金",
  bank: "转账",
  other: "其他",
};

/** 学情等级：1 需加强 / 2 一般 / 3 良好 / 4 优秀 */
export const LEVEL_CN: Record<number, string> = {
  1: "需加强",
  2: "一般",
  3: "良好",
  4: "优秀",
};

/** 常用评价标签（记一笔时一点就有） */
export const QUICK_TAGS = [
  "专注",
  "粗心",
  "进步明显",
  "情绪低落",
  "主动提问",
  "作业认真",
  "坐不住",
  "基础薄弱",
  "计算提速",
  "阅读流畅",
];

/** 今天的日期串（本地） */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** 月份键：2026-11 */
export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** 星期几的完整叫法：0 是周日 */
export const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function weekdayLabel(n: number | null | undefined): string {
  return n === null || n === undefined ? "未定" : WEEKDAYS[n] ?? "未定";
}
