// 带 .ts 后缀是为了让 node --test 能直接跑（Node 只做类型剥离，不做扩展名补全）
import { parseLocal } from "./dates.ts";

/** 两个时间段是否重叠。字符串格式 'YYYY-MM-DD HH:mm' */
export function overlaps(
  aStart: string,
  aMinutes: number,
  bStart: string,
  bMinutes: number,
): boolean {
  const a1 = parseLocal(aStart).getTime();
  const a2 = a1 + aMinutes * 60_000;
  const b1 = parseLocal(bStart).getTime();
  const b2 = b1 + bMinutes * 60_000;
  return a1 < b2 && b1 < a2;
}
