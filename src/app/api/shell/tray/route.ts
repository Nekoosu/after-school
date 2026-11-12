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

  // 今天第一节课几点开始（只在托盘那句小账里用，省得老师为了看时间再点开窗口）
  const first =
    get<{ t: string }>(
      "select substr(start_at, 12, 5) as t from lesson where status <> 'cancelled' and substr(start_at, 1, 10) = ? order by start_at limit 1",
      [today],
    )?.t ?? "";

  // 最早一节「该记还没记」的课：托盘里给个直达入口，点一下就进那一节的记一笔页面
  const pending =
    get<{ id: number; title: string | null; course: string | null; start_at: string }>(
      `select l.id, l.title, c.name as course, l.start_at
       from lesson l left join course c on c.id = l.course_id
       where l.status = 'planned' and l.start_at < datetime('now', 'localtime')
       order by l.start_at limit 1`,
    ) ?? null;

  const parts: string[] = [
    todayLessons > 0 ? `今天 ${todayLessons} 节课` + (first ? `（第一节 ${first}）` : "") : "今天没课",
  ];
  if (lowBalance > 0) parts.push(`${lowBalance} 人课时不够`);
  if (needRecord > 0) parts.push(`${needRecord} 节该记还没记`);

  // 「今天 15:30 数学」这种短标签，托盘菜单里放一条
  const pendingText = pending
    ? [pending.course || pending.title || "一节课", String(pending.start_at).slice(5, 16)].join(" · ")
    : "";

  return ok({
    today,
    todayLessons,
    first,
    lowBalance,
    lowThreshold: threshold,
    needRecord,
    pendingId: pending?.id ?? 0,
    pendingText,
    text: parts.join(" · "),
  });
}
