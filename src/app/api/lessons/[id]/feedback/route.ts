import { all, get } from "@/db";
import type { LessonRow } from "@/db/types";
import { fail, ok } from "@/lib/http";
import { draftForStudent } from "@/lib/lessonFeedback";
import { aiConf, polishFeedback } from "@/lib/ai";
import { planPoints } from "@/lib/markdown";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 下课收尾页要的全部东西：这节课上了什么（来自备课）+ 每个学生今天的情况。
 * 上课内容不用老师再说一遍，就是为了这个接口。
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const id = Number((await ctx.params).id);
    const lesson = get<LessonRow & { course_name: string }>(
      `select l.*, c.name as course_name from lesson l join course c on c.id = l.course_id where l.id = ?`,
      [id],
    );
    if (!lesson) return fail("这节课不存在", 404);

    const plan = lesson.plan_id
      ? get<{ id: number; title: string | null; content: string }>(
          "select id, title, content from teach_plan where id = ?",
          [lesson.plan_id],
        )
      : undefined;

    const dateStr = lesson.start_at.slice(0, 10);

    const students = all<{
      student_id: number;
      name: string;
      grade: string | null;
      balance_minutes: number | null;
      att_status: string | null;
      billed_minutes: number | null;
      att_note: string | null;
      note: string | null;
      topic: string | null;
      level: number | null;
      draft: string | null;
      draft_id: number | null;
    }>(
      `select ls.student_id, s.name, s.grade, b.balance_minutes,
              a.status as att_status, a.billed_minutes, a.note as att_note,
              (select content from note n where n.lesson_id = ls.lesson_id and n.student_id = ls.student_id order by n.id desc limit 1) as note,
              (select topic from note n where n.lesson_id = ls.lesson_id and n.student_id = ls.student_id order by n.id desc limit 1) as topic,
              (select level from note n where n.lesson_id = ls.lesson_id and n.student_id = ls.student_id order by n.id desc limit 1) as level,
              (select f.content from feedback f where f.student_id = ls.student_id and f.period_start = ? and f.period_end = ? order by f.id desc limit 1) as draft,
              (select f.id from feedback f where f.student_id = ls.student_id and f.period_start = ? and f.period_end = ? order by f.id desc limit 1) as draft_id
       from lesson_student ls
       join student s on s.id = ls.student_id
       left join v_student_balance b on b.student_id = s.id
       left join attendance a on a.lesson_id = ls.lesson_id and a.student_id = ls.student_id
       where ls.lesson_id = ?
       order by s.name`,
      [dateStr, dateStr, dateStr, dateStr, id],
    );

    return ok({
      lesson,
      plan: plan ? { id: plan.id, title: plan.title, points: planPoints(plan.content) } : null,
      students,
    });
  } catch (e) {
    return fail(e, 500);
  }
}

/**
 * 生成某个学生的这一段反馈（不落库，页面里改完再存草稿）。
 * body: { studentId, brief, useAi }
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const id = Number((await ctx.params).id);
    const b = await req.json();
    const studentId = Number(b.studentId);
    if (!studentId) return fail("缺少 studentId");

    const draft = draftForStudent(id, studentId, String(b.brief ?? ""));
    if (!draft) return fail("这节课或这个学生不存在", 404);

    const conf = aiConf();
    let content = draft.content;
    const ai = { used: false, model: conf.model, reason: "" as string };

    if (b.useAi) {
      if (!conf.enabled || !conf.key) {
        ai.reason = "没开 AI 润色，用的本地草稿";
      } else {
        const stu = get<{ name: string }>("select name from student where id = ?", [studentId]);
        const polished = await polishFeedback(draft.content, stu?.name ?? "");
        if (polished) {
          content = polished.text;
          ai.used = true;
          ai.model = polished.model;
        } else {
          ai.reason = "AI 没连上，用的本地草稿";
        }
      }
    }

    return ok({ content, local_content: draft.content, ai, lesson: draft.lesson });
  } catch (e) {
    return fail(e);
  }
}
