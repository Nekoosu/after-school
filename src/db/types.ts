// 表行类型：手写，跟着 ddl.ts 一起改
// 没有 ORM，SQL 就是唯一真相（见 AGENTS.md）

export interface StudentRow {
  id: number;
  name: string;
  gender: string | null;
  grade: string | null;
  school: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_wechat: string | null;
  note: string | null;
  tags: string | null;
  status: string;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CourseRow {
  id: number;
  name: string;
  subject: string | null;
  default_minutes: number;
  price_per_lesson: number | null;
  color: string | null;
  teacher_id: number | null;
  status: string;
}

/** 老师 */
export interface TeacherRow {
  id: number;
  name: string;
  phone: string | null;
  subject: string | null;
  color: string | null;
  note: string | null;
  status: string;
  created_at: string;
}

/** 老师 + 统计（老师页用） */
export interface TeacherWithStats extends TeacherRow {
  course_names: string | null;
  student_count: number;
  week_lessons: number;
  week_minutes: number;
}

export interface ClassRow {
  id: number;
  name: string;
  course_id: number;
  weekday: number | null;
  start_time: string | null;
  minutes: number | null;
  room: string | null;
  status: string;
}

export interface LessonRow {
  id: number;
  course_id: number;
  class_id: number | null;
  plan_id: number | null;
  teacher_id: number | null;
  title: string | null;
  start_at: string;
  minutes: number;
  room: string | null;
  status: string;
  note: string | null;
  price_per_hour: number | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceRow {
  id: number;
  lesson_id: number;
  student_id: number;
  status: string;
  billed_minutes: number;
  note: string | null;
  created_at: string;
}

export interface LedgerRow {
  id: number;
  student_id: number;
  course_id: number | null;
  delta_minutes: number;
  kind: string;
  ref_id: number | null;
  remark: string | null;
  unit_price: number | null;
  amount: number | null;
  created_at: string;
}

export interface NoteRow {
  id: number;
  student_id: number;
  lesson_id: number | null;
  kind: string;
  topic: string | null;
  level: number | null;
  content: string;
  created_at: string;
}

/** 学生 + 余额（列表用） */
export interface StudentWithBalance extends StudentRow {
  balance_minutes: number | null;
  balance_hours: number | null;
  last_note_at: string | null;
}

/** 课 + 学生（日历用） */
export interface LessonWithStudents extends LessonRow {
  course_name: string;
  course_color: string | null;
  teacher_name: string | null;
  student_names: string | null;
  student_ids: string | null;
}

/** 收款记录 */
export interface PaymentRow {
  id: number;
  student_id: number;
  amount: number;
  minutes: number | null;
  method: string | null;
  paid_at: string;
  remark: string | null;
  created_at: string;
}

/** 学生 + 收款（收支页用） */
export interface PaymentWithStudent extends PaymentRow {
  student_name: string;
}

/** 家长反馈（草稿 / 已发送） */
export interface FeedbackRow {
  id: number;
  student_id: number;
  period_start: string;
  period_end: string;
  content: string;
  status: string;
  sent_at: string | null;
  created_at: string;
}

export interface FeedbackWithStudent extends FeedbackRow {
  student_name: string;
}

/** 教案 */
export interface TeachPlanRow {
  id: number;
  course_id: number | null;
  title: string;
  topic: string | null;
  content: string;
  minutes: number | null;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeachPlanWithCourse extends TeachPlanRow {
  course_name: string | null;
}

/** 班级 + 统计 */
export interface ClassWithStats extends ClassRow {
  course_name: string;
  student_count: number;
}
