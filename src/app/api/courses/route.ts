import { all, get, run } from "@/db";
import type { CourseRow } from "@/db/types";
import { fail, need, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok(
      all<CourseRow & { teacher_name: string | null }>(
        `select c.*, t.name as teacher_name from course c
          left join teacher t on t.id = c.teacher_id
          where c.status = 'active' order by c.id`,
      ),
    );
  } catch (e) {
    return fail(e, 500);
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const name = need(b.name, "课程名称");
    const r = run(
      `insert into course (name, subject, default_minutes, price_per_lesson, color, teacher_id) values (?, ?, ?, ?, ?, ?)`,
      [
        name,
        b.subject ?? null,
        Number(b.defaultMinutes) || 90,
        b.pricePerLesson ? Number(b.pricePerLesson) : null,
        b.color ?? "#3b82f6",
        b.teacherId ? Number(b.teacherId) : null,
      ],
    );
    return ok(get<CourseRow>("select * from course where id = ?", [r.lastInsertRowid]), 201);
  } catch (e) {
    return fail(e);
  }
}
