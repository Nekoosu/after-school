import { get, setting } from "@/db";
import { planPoints } from "@/lib/markdown";
import { buildLessonReport } from "@/lib/report";
import { feedbackTone } from "@/lib/tone";

/**
 * 一节下课之后的家长反馈：把「上课内容」（来自备课）+ 老师那一句 + 出勤/课时，拼成一段话。
 * 老师不用再重复说讲的是什么 —— 这正是这个功能存在的理由。
 */

export interface LessonDraft {
  content: string;
  lesson: {
    id: number;
    start_at: string;
    minutes: number;
    title: string | null;
    course_name: string;
    plan_title: string | null;
    plan_points: string[];
  };
}

export function draftForStudent(lessonId: number, studentId: number, brief: string): LessonDraft | null {
  const lesson = get<{
    id: number;
    start_at: string;
    minutes: number;
    title: string | null;
    status: string;
    plan_id: number | null;
    course_name: string;
  }>(
    `select l.id, l.start_at, l.minutes, l.title, l.status, l.plan_id, c.name as course_name
     from lesson l join course c on c.id = l.course_id where l.id = ?`,
    [lessonId],
  );
  if (!lesson) return null;

  const stu = get<{ id: number; name: string }>("select id, name from student where id = ?", [studentId]);
  if (!stu) return null;

  const plan = lesson.plan_id
    ? get<{ title: string | null; content: string }>(
        "select title, content from teach_plan where id = ?",
        [lesson.plan_id],
      )
    : undefined;

  const att = get<{ status: string; billed_minutes: number | null; note: string | null }>(
    "select status, billed_minutes, note from attendance where lesson_id = ? and student_id = ?",
    [lessonId, studentId],
  );

  const note = get<{ topic: string | null; level: number | null }>(
    "select topic, level from note where lesson_id = ? and student_id = ? order by id desc limit 1",
    [lessonId, studentId],
  );

  const bal = get<{ v: number }>(
    "select coalesce(balance_minutes, 0) as v from v_student_balance where student_id = ?",
    [studentId],
  );

  const points = plan ? planPoints(plan.content) : [];

  const content = buildLessonReport({
    studentName: stu.name,
    orgName: setting("org_name", "课后服务中心"),
    teacherName: setting("teacher_name", ""),
    dateStr: lesson.start_at.slice(0, 10),
    courseName: lesson.course_name,
    lessonTitle: lesson.title,
    planTitle: plan?.title ?? null,
    planPoints: points,
    attStatus: att?.status ?? null,
    brief,
    billedMinutes: att?.billed_minutes ?? 0,
    balanceMinutes: bal?.v ?? 0,
    lessonMinutes: lesson.minutes,
    topic: note?.topic ?? null,
    level: note?.level ?? null,
    tone: feedbackTone(),
  });

  return {
    content,
    lesson: {
      id: lesson.id,
      start_at: lesson.start_at,
      minutes: lesson.minutes,
      title: lesson.title,
      course_name: lesson.course_name,
      plan_title: plan?.title ?? null,
      plan_points: points,
    },
  };
}
