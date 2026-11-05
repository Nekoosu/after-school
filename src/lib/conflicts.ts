import { all } from "@/db";
import { addDays, parseLocal, toDateTimeStr } from "@/lib/dates";
import { overlaps } from "@/lib/scheduling";

export interface ConflictRow {
  lesson_id: number;
  student_id: number;
  student_name: string;
  start_at: string;
  minutes: number;
  title: string;
}

/** 找这个学生集合在目标时段的冲突课（不含自己） */
export function findConflicts(
  studentIds: number[],
  startAt: string,
  minutes: number,
  excludeLessonId = 0,
): ConflictRow[] {
  if (studentIds.length === 0) return [];
  const base = parseLocal(startAt);
  const from = toDateTimeStr(addDays(base, -1));
  const to = toDateTimeStr(addDays(base, 1));
  const placeholders = studentIds.map(() => "?").join(",");
  const rows = all<ConflictRow>(
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
  return rows.filter((r) => overlaps(startAt, minutes, r.start_at, r.minutes));
}
