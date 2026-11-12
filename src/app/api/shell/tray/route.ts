import { get, setting } from "@/db";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * 托盘菜单顶上那一句、以及托盘图标的悬停提示。
 * 桌面壳（launcher/Launcher.cs）只认这里的 text 字段，别改字段名。
 */
export async function GET() {
  const today = get<{ d: string }>("select date('now','localtime') as d")?.d ?? "";

  const todayLessons =
    get<{ n: number }>(
      "select count(*) as n from lesson where status <> 'cancelled' and substr(start_at, 1, 10) = ?",
      [today],
    )?.n ?? 0;

  const threshold = Number(setting("low_balance_minutes", "450")) || 450;
  const lowBalance =
    get<{ n: number }>(
      "select count(*) as n from v_student_balance where balance_minutes < ?",
      [threshold],
    )?.n ?? 0;

  const needRecord =
    get<{ n: number }>(
      "select count(*) as n from lesson where status = 'planned' and start_at < datetime('now', 'localtime')",
    )?.n ?? 0;

  const parts: string[] = [todayLessons > 0 ? `今天 ${todayLessons} 节课` : "今天没课"];
  if (lowBalance > 0) parts.push(`${lowBalance} 人课时不够`);
  if (needRecord > 0) parts.push(`${needRecord} 节该记还没记`);

  return ok({
    today,
    todayLessons,
    lowBalance,
    lowThreshold: threshold,
    needRecord,
    text: parts.join(" · "),
  });
}
