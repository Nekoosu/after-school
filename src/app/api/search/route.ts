import { NextRequest } from "next/server";
import { all } from "@/db";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 全局搜索：学生 / 课程 / 教案 / 课程记录，各取前 6 条 */
export function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!q) return ok({ students: [], courses: [], plans: [], lessons: [] });
  const like = `%${q}%`;

  const students = all<{ id: number; name: string; grade: string | null; guardian_phone: string | null }>(
    `select id, name, grade, guardian_phone from student
     where status = 'active' and (name like ? or grade like ? or guardian_name like ? or guardian_phone like ?)
     order by name limit 6`,
    [like, like, like, like],
  );
  const courses = all<{ id: number; name: string; subject: string | null }>(
    "select id, name, subject from course where name like ? order by name limit 6",
    [like],
  );
  const plans = all<{ id: number; title: string; topic: string | null }>(
    "select id, title, topic from teach_plan where title like ? or topic like ? or tags like ? order by updated_at desc limit 6",
    [like, like, like],
  );
  const lessons = all<{ id: number; title: string | null; start_at: string; course_name: string }>(
    `select l.id, coalesce(l.title, c.name) as title, l.start_at, c.name as course_name
     from lesson l join course c on c.id = l.course_id
     where l.status <> 'cancelled' and (l.title like ? or c.name like ? or l.start_at like ?)
     order by l.start_at desc limit 6`,
    [like, like, like],
  );

  return ok({ students, courses, plans, lessons });
}
