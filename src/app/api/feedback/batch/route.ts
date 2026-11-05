import { NextRequest } from "next/server";
import { all, get, run } from "@/db";
import { fail, ok } from "@/lib/http";
import { generateDraft } from "@/lib/feedbackGen";

export const dynamic = "force-dynamic";

/**
 * 批量生成：这段时间有课的学生，一人一份草稿。
 * 同一学生同一周期已经有草稿的跳过，免得点两次出来两份。
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail("请求内容不是有效 JSON");

    const from = String(body.from ?? "").slice(0, 10);
    const to = String(body.to ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return fail("请选择正确的起止日期");
    }
    if (from > to) return fail("开始日期不能晚于结束日期");

    const rows = all<{ student_id: number; name: string }>(
      `select distinct ls.student_id, s.name
       from lesson l
       join lesson_student ls on ls.lesson_id = l.id
       join student s on s.id = ls.student_id
       where l.start_at >= ? and l.start_at <= ? and l.status <> 'cancelled' and s.status = 'active'
       order by s.name`,
      [from, to + " 23:59"],
    );

    const created: string[] = [];
    const skipped: string[] = [];
    for (const r of rows) {
      const dup = get<{ id: number }>(
        "select id from feedback where student_id = ? and period_start = ? and period_end = ? and status = 'draft' limit 1",
        [r.student_id, from, to],
      );
      if (dup) {
        skipped.push(r.name);
        continue;
      }
      const draft = generateDraft(r.student_id, from, to);
      if (!draft) continue;
      run(
        "insert into feedback (student_id, period_start, period_end, content, status) values (?, ?, ?, ?, 'draft')",
        [r.student_id, from, to, draft.content],
      );
      created.push(r.name);
    }

    return ok({ created: created.length, skipped: skipped.length, createdNames: created, skippedNames: skipped });
  } catch (e) {
    return fail(e);
  }
}
