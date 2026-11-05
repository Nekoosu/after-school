import { all, get, run } from "@/db";
import type { CourseRow } from "@/db/types";
import { fail, need, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok(all<CourseRow>("select * from course where status = 'active' order by id"));
  } catch (e) {
    return fail(e, 500);
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const name = need(b.name, "课程名称");
    const r = run(
      `insert into course (name, subject, default_minutes, price_per_lesson, color) values (?, ?, ?, ?, ?)`,
      [
        name,
        b.subject ?? null,
        Number(b.defaultMinutes) || 90,
        b.pricePerLesson ? Number(b.pricePerLesson) : null,
        b.color ?? "#3b82f6",
      ],
    );
    return ok(get<CourseRow>("select * from course where id = ?", [r.lastInsertRowid]), 201);
  } catch (e) {
    return fail(e);
  }
}
