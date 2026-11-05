import { all, setting } from "@/db";
import type { LessonWithStudents } from "@/db/types";
import { fail, ok } from "@/lib/http";
import { addDays, parseLocal, toDateStr, todayStr } from "@/lib/dates";
import { ensureDailyBackup } from "@/lib/backup";

export const dynamic = "force-dynamic";

/** 首页看板：今日的课、待补课、课时不足 */
export async function GET() {
  try {
    // 打开系统就顺手检查今天的自动备份（同一进程 10 分钟内不会重复查）
    await ensureDailyBackup();
    const today = todayStr();
    const tomorrow = toDateStr(addDays(parseLocal(today), 1));
    const lowBalance = Number(setting("low_balance_minutes", "450"));

    const todayLessons = all<LessonWithStudents>(
      `select l.*, c.name as course_name,
        (select group_concat(s.name, '、') from lesson_student ls join student s on s.id = ls.student_id
          where ls.lesson_id = l.id) as student_names,
        (select group_concat(ls.student_id, ',') from lesson_student ls
          where ls.lesson_id = l.id) as student_ids
       from lesson l join course c on c.id = l.course_id
       where l.start_at >= ? and l.start_at < ? and l.status <> 'cancelled'
       order by l.start_at asc`,
      [today, tomorrow],
    );

    const makeup = all<{
      student_id: number;
      student_name: string;
      lesson_id: number;
      start_at: string;
      course_id: number;
      course_name: string;
    }>(
      `select v.student_id, v.student_name, v.lesson_id, v.start_at, v.course_id, c.name as course_name
       from v_makeup_pending v left join course c on c.id = v.course_id
       order by v.start_at asc limit 30`,
    );

    const lowHours = all<{
      student_id: number;
      name: string;
      balance_minutes: number;
      balance_hours: number;
    }>(
      `select student_id, name, balance_minutes, balance_hours
       from v_student_balance
       where status = 'active' and balance_minutes < ?
       order by balance_minutes asc`,
      [lowBalance],
    );

    const stats = all<{ total: number }>(
      "select count(*) as total from student where status = 'active'",
    )[0];

    const planned = all<{ total: number }>(
      "select count(*) as total from lesson where status = 'planned' and start_at >= ?",
      [today],
    )[0];

    // 最近记的学情（跨学生），首页给一条时间线
    const recentNotes = all<{
      id: number;
      student_id: number;
      student_name: string;
      kind: string;
      topic: string | null;
      level: number | null;
      content: string;
      created_at: string;
    }>(
      `select n.id, n.student_id, s.name as student_name, n.kind, n.topic, n.level, n.content, n.created_at
       from note n join student s on s.id = n.student_id
       order by n.created_at desc, n.id desc
       limit 8`,
    );

    const month = today.slice(0, 7);
    const monthRevenue =
      all<{ v: number }>("select coalesce(sum(amount), 0) as v from payment where substr(paid_at,1,7) = ?", [month])[0]?.v ?? 0;
    const monthUsed =
      all<{ v: number }>(
        "select coalesce(sum(-delta_minutes), 0) as v from hours_ledger where delta_minutes < 0 and substr(created_at,1,7) = ?",
        [month],
      )[0]?.v ?? 0;

    // 近 14 天收款，首页画一条小趋势（缺的日子补 0，图才连得上）
    const sinceDate = addDays(parseLocal(today), -13);
    const since = toDateStr(sinceDate);
    const paidByDay = new Map(
      all<{ d: string; amount: number }>(
        "select substr(paid_at,1,10) as d, coalesce(sum(amount),0) as amount from payment where substr(paid_at,1,10) >= ? group by d",
        [since],
      ).map((r) => [r.d, r.amount]),
    );
    const revenueTrend: Array<{ d: string; amount: number }> = [];
    for (let i = 0; i < 14; i++) {
      const d = toDateStr(addDays(sinceDate, i));
      revenueTrend.push({ d, amount: paidByDay.get(d) ?? 0 });
    }

    // 已经开始但还没记完的课 —— 提醒处理
    const nowStr = `${today} ${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;
    const needRecord = all<{ id: number; start_at: string; course_name: string }>(
      `select l.id, l.start_at, c.name as course_name
       from lesson l join course c on c.id = l.course_id
       where l.status = 'planned' and l.start_at < ?
       order by l.start_at desc limit 5`,
      [nowStr],
    );

    // 半个月没跟家长说过话的学生（还在读，说明该发条反馈了）
    const staleStudents = all<{
      id: number;
      name: string;
      balance_minutes: number;
      last_note_at: string | null;
      last_lesson_at: string | null;
    }>(
      `select s.id, s.name,
              coalesce(b.balance_minutes, 0) as balance_minutes,
              (select max(n.created_at) from note n where n.student_id = s.id) as last_note_at,
              (select max(l.start_at) from lesson l join lesson_student ls on ls.lesson_id = l.id
                 where ls.student_id = s.id and l.status = 'done') as last_lesson_at
       from student s left join v_student_balance b on b.student_id = s.id
       where s.status = 'active'
         and coalesce((select max(n.created_at) from note n where n.student_id = s.id), '') < datetime('now','localtime','-14 days')
       order by last_note_at asc
       limit 6`,
    );

    return ok({
      date: today,
      todayLessons,
      makeupPending: makeup,
      lowBalanceStudents: lowHours,
      lowBalanceThreshold: lowBalance,
      studentCount: stats?.total ?? 0,
      upcomingLessons: planned?.total ?? 0,
      recentNotes,
      monthRevenue,
      monthUsed,
      revenueTrend,
      needRecord,
      staleStudents,
    });
  } catch (e) {
    return fail(e, 500);
  }
}
