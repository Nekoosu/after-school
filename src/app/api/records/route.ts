import { ok, fail } from "@/lib/http";
import { all, get } from "@/db";

export const dynamic = "force-dynamic";

interface Row {
  lesson_id: number;
  student_id: number;
  student_name: string;
  grade: string | null;
  course_id: number;
  course_name: string;
  title: string | null;
  start_at: string;
  minutes: number;
  room: string | null;
  lesson_status: string;
  att_status: string | null;
  billed_minutes: number | null;
  note: string | null;
  topic: string | null;
}

/**
 * 上课记录：一节课一个学生一行（含未记的课）。
 * 参数都在这里收敛，别让页面自己拼 SQL。
 */
function isDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const studentId = Number(url.searchParams.get("studentId") ?? 0) || 0;
  const courseId = Number(url.searchParams.get("courseId") ?? 0) || 0;
  const lessonStatus = url.searchParams.get("status") ?? "";
  const attStatus = url.searchParams.get("att") ?? "";

  if (from && !isDate(from)) return fail(new Error("起始日期不对，应该像 2026-11-01"));
  if (to && !isDate(to)) return fail(new Error("结束日期不对，应该像 2026-11-30"));

  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  if (from) {
    where.push("substr(l.start_at, 1, 10) >= ?");
    params.push(from);
  }
  if (to) {
    where.push("substr(l.start_at, 1, 10) <= ?");
    params.push(to);
  }
  if (studentId) {
    where.push("ls.student_id = ?");
    params.push(studentId);
  }
  if (courseId) {
    where.push("l.course_id = ?");
    params.push(courseId);
  }
  if (lessonStatus) {
    where.push("l.status = ?");
    params.push(lessonStatus);
  }
  if (attStatus) {
    where.push("coalesce(a.status, '') = ?");
    params.push(attStatus);
  }

  const rows = all<Row>(
    `select l.id as lesson_id,
            ls.student_id,
            s.name as student_name,
            s.grade,
            l.course_id,
            c.name as course_name,
            l.title,
            l.start_at,
            l.minutes,
            l.room,
            l.status as lesson_status,
            a.status as att_status,
            a.billed_minutes,
            a.note,
            n.topic
       from lesson_student ls
       join lesson l on l.id = ls.lesson_id
       join course c on c.id = l.course_id
       join student s on s.id = ls.student_id
       left join attendance a on a.lesson_id = l.id and a.student_id = ls.student_id
       left join note n on n.id = (
         select n2.id from note n2
          where n2.lesson_id = l.id and n2.student_id = ls.student_id
          order by n2.id desc limit 1
       )
      where ${where.join(" and ")}
      order by l.start_at desc, s.name asc
      limit 500`,
    params,
  );

  const lessonCount = get<{ n: number }>(
    `select count(distinct l.id) as n
       from lesson_student ls
       join lesson l on l.id = ls.lesson_id
       left join attendance a on a.lesson_id = l.id and a.student_id = ls.student_id
      where ${where.join(" and ")}`,
    params,
  )?.n ?? 0;

  const summary = {
    rows: rows.length,
    lessons: lessonCount,
    billedMinutes: rows.reduce((sum, r) => sum + (r.billed_minutes ?? 0), 0),
    present: rows.filter((r) => r.att_status === "present").length,
    makeup: rows.filter((r) => r.att_status === "makeup").length,
    leave: rows.filter((r) => r.att_status === "leave").length,
    absent: rows.filter((r) => r.att_status === "absent").length,
    unrecorded: rows.filter((r) => r.lesson_status === "planned").length,
    cancelled: rows.filter((r) => r.lesson_status === "cancelled").length,
  };

  return ok({ from, to, rows, summary });
}
