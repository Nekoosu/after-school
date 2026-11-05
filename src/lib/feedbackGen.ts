import { all, get, setting } from "@/db";
import { buildReport, type ReportLesson, type ReportNote } from "@/lib/report";
import { feedbackTone } from "@/lib/tone";

/**
 * 家长反馈草稿：查这段时间的出勤/学情/课时，按固定结构拼成一段话。
 * 不用任何在线模型 —— 生成的是草稿，发之前一定自己读一遍改成自己的语气。
 * 单个生成和批量生成都走这里，避免两处规则走偏。
 */

export interface DraftSummary {
  lessons: number;
  notes: number;
  usedMinutes: number;
  balanceMinutes: number;
}

export interface Draft {
  content: string;
  summary: DraftSummary;
}

export function generateDraft(studentId: number, from: string, to: string): Draft | null {
  const stu = get<{ id: number; name: string }>("select id, name from student where id = ?", [studentId]);
  if (!stu) return null;

  const lessons = all<ReportLesson>(
    `select l.start_at, l.status, a.status as att_status
     from lesson l
     join lesson_student ls on ls.lesson_id = l.id
     left join attendance a on a.lesson_id = l.id and a.student_id = ls.student_id
     where ls.student_id = ? and l.start_at >= ? and l.start_at <= ?
     order by l.start_at`,
    [studentId, from, to + " 23:59"],
  );

  const notes = all<ReportNote>(
    `select created_at, kind, topic, level, content
     from note
     where student_id = ? and created_at >= ? and created_at <= ?
     order by created_at`,
    [studentId, from, to + " 23:59"],
  );

  const used = get<{ v: number }>(
    `select coalesce(sum(-delta_minutes), 0) as v from hours_ledger
     where student_id = ? and delta_minutes < 0 and created_at >= ? and created_at <= ?`,
    [studentId, from, to + " 23:59"],
  );
  const bal = get<{ v: number }>(
    "select coalesce(sum(delta_minutes), 0) as v from hours_ledger where student_id = ?",
    [studentId],
  );

  const defMinutes = Number(setting("lesson_default_minutes", "90")) || 90;
  const lastLesson = get<{ minutes: number }>(
    `select l.minutes from lesson l join lesson_student ls on ls.lesson_id = l.id
     where ls.student_id = ? order by l.start_at desc limit 1`,
    [studentId],
  );

  const content = buildReport({
    studentName: stu.name,
    orgName: setting("org_name", "课后服务中心"),
    teacherName: setting("teacher_name", ""),
    periodStart: from,
    periodEnd: to,
    lessons,
    notes,
    usedMinutes: used?.v ?? 0,
    balanceMinutes: bal?.v ?? 0,
    lessonMinutes: lastLesson?.minutes ?? defMinutes,
    tone: feedbackTone(),
  });

  return {
    content,
    summary: {
      lessons: lessons.filter((l) => l.status === "done").length,
      notes: notes.length,
      usedMinutes: used?.v ?? 0,
      balanceMinutes: bal?.v ?? 0,
    },
  };
}
