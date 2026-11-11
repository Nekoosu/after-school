import { all } from "@/db";
import { addDays, parseLocal, toDateTimeStr } from "@/lib/dates";
import { overlaps } from "@/lib/scheduling";

export interface ConflictRow {
  /** student = 学生撞课；teacher = 老师同一时段被排到两个地方 */
  kind: "student" | "teacher";
  lesson_id: number;
  student_id: number | null;
  /** 学生冲突时是学生名，老师冲突时是空串 */
  student_name: string;
  teacher_name: string | null;
  /** 直接能显示的那一方：「小明」或「张老师」 */
  who: string;
  start_at: string;
  minutes: number;
  title: string;
}

function near(startAt: string): { from: string; to: string } {
  const base = parseLocal(startAt);
  return { from: toDateTimeStr(addDays(base, -1)), to: toDateTimeStr(addDays(base, 1)) };
}

/** 找这个学生集合在目标时段的冲突课（不含自己） */
export function findStudentConflicts(
  studentIds: number[],
  startAt: string,
  minutes: number,
  excludeLessonId = 0,
): ConflictRow[] {
  if (studentIds.length === 0) return [];
  const { from, to } = near(startAt);
  const placeholders = studentIds.map(() => "?").join(",");
  const rows = all<{
    lesson_id: number;
    student_id: number;
    student_name: string;
    start_at: string;
    minutes: number;
    title: string;
  }>(
    `select l.id as lesson_id, ls.student_id, s.name as student_name, l.start_at, l.minutes,
            coalesce(l.title, c.name) as title
     from lesson l
     join course c on c.id = l.course_id
     join lesson_student ls on ls.lesson_id = l.id
     join student s on s.id = ls.student_id
     where l.status <> 'cancelled'
       and l.id <> ?
       and l.start_at >= ? and l.start_at <= ?
       and ls.student_id in (${placeholders})`,
    [excludeLessonId, from, to, ...studentIds],
  );
  return rows
    .filter((r) => overlaps(startAt, minutes, r.start_at, r.minutes))
    .map((r) => ({
      kind: "student" as const,
      lesson_id: r.lesson_id,
      student_id: r.student_id,
      student_name: r.student_name,
      teacher_name: null,
      who: r.student_name,
      start_at: r.start_at,
      minutes: r.minutes,
      title: r.title,
    }));
}

/** 找这位老师在这个时段的其它课（老师不能同时出现在两个教室） */
export function findTeacherConflicts(
  teacherId: number | null,
  startAt: string,
  minutes: number,
  excludeLessonId = 0,
): ConflictRow[] {
  if (!teacherId) return [];
  const { from, to } = near(startAt);
  const rows = all<{
    lesson_id: number;
    teacher_id: number;
    teacher_name: string;
    start_at: string;
    minutes: number;
    title: string;
  }>(
    `select l.id as lesson_id, l.teacher_id, t.name as teacher_name, l.start_at, l.minutes,
            coalesce(l.title, c.name) as title
     from lesson l
     join course c on c.id = l.course_id
     join teacher t on t.id = l.teacher_id
     where l.status <> 'cancelled'
       and l.id <> ?
       and l.teacher_id = ?
       and l.start_at >= ? and l.start_at <= ?`,
    [excludeLessonId, teacherId, from, to],
  );
  return rows
    .filter((r) => overlaps(startAt, minutes, r.start_at, r.minutes))
    .map((r) => ({
      kind: "teacher" as const,
      lesson_id: r.lesson_id,
      student_id: null,
      student_name: "",
      teacher_name: r.teacher_name,
      who: r.teacher_name,
      start_at: r.start_at,
      minutes: r.minutes,
      title: r.title,
    }));
}

/**
 * 学生冲突 + 老师冲突一起查。
 * 排课页保存前、拖课、边填边查都走这里，只有一份真相。
 */
export function findConflicts(
  studentIds: number[],
  startAt: string,
  minutes: number,
  excludeLessonId = 0,
  teacherId: number | null = null,
): ConflictRow[] {
  return [
    ...findStudentConflicts(studentIds, startAt, minutes, excludeLessonId),
    ...findTeacherConflicts(teacherId, startAt, minutes, excludeLessonId),
  ];
}
