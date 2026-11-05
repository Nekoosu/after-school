import { all } from "@/db";
import { isDayStr } from "@/lib/dates";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";

function icsEsc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** "2026-11-05 16:30" → "20261105T163000"（浮动本地时间，不写 Z，导入手机日历就按当地时间） */
function icsStamp(dt: string): string {
  const d = dt.replace(/[-:]/g, "").replace(" ", "T");
  return d.length === 13 ? `${d}00` : d;
}

/**
 * GET /api/calendar.ics?from=YYYY-MM-DD&to=YYYY-MM-DD
 * 把这段时间的课导出成 .ics：手机上双击/导入就能进系统日历，当提醒用。
 * 只导 planned / done / makeup，停课的不导。
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const from = (url.searchParams.get("from") || "").trim();
    const to = (url.searchParams.get("to") || "").trim();
    if (!isDayStr(from) || !isDayStr(to)) return fail("日期格式应为 YYYY-MM-DD，且要是真实存在的日期");
    if (from > to) return fail("from 不能晚于 to");

    const rows = all<{
      id: number;
      title: string | null;
      start_at: string;
      minutes: number;
      room: string | null;
      status: string;
      course_name: string;
      student_names: string | null;
    }>(
      `select l.id, l.title, l.start_at, l.minutes, l.room, l.status,
              c.name as course_name,
              (select group_concat(s.name, '、') from lesson_student ls join student s on s.id = ls.student_id
                where ls.lesson_id = l.id) as student_names
       from lesson l join course c on c.id = l.course_id
       where substr(l.start_at, 1, 10) between ? and ? and l.status <> 'cancelled'
       order by l.start_at asc`,
      [from, to],
    );

    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//after-school//CALENDAR//CN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:课后服务课表",
      "X-WR-TIMEZONE:Asia/Shanghai",
    ];
    for (const r of rows) {
      const summary = r.title ? `${r.course_name}·${r.title}` : r.course_name;
      const desc = [r.student_names ? `学生：${r.student_names}` : "", r.status === "done" ? "已上" : ""]
        .filter(Boolean)
        .join("\\n");
      lines.push(
        "BEGIN:VEVENT",
        `UID:lesson-${r.id}@after-school`,
        `DTSTAMP:${icsStamp(r.start_at)}`,
        `DTSTART:${icsStamp(r.start_at)}`,
        `DURATION:PT${Math.max(1, Math.round(r.minutes))}M`,
        `SUMMARY:${icsEsc(summary)}`,
        ...(r.room ? [`LOCATION:${icsEsc(r.room)}`] : []),
        ...(desc ? [`DESCRIPTION:${desc}`] : []),
        "END:VEVENT",
      );
    }
    lines.push("END:VCALENDAR");

    const name = `课表-${from}-${to}.ics`;
    const body = lines.join("\r\n") + "\r\n";
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `attachment; filename="calendar-${from}-${to}.ics"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return fail(e, 500);
  }
}
