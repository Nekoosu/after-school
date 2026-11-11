import { all, get, run } from "@/db";
import type { NoteRow, StudentRow } from "@/db/types";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export interface LedgerWithName {
  id: number;
  delta_minutes: number;
  kind: string;
  ref_id: number | null;
  remark: string | null;
  created_at: string;
  course_name: string | null;
  /** 这笔的单价（元/小时）；充值记的是「买进来」的单价，课消记的是「扣出去」的 */
  unit_price: number | null;
  /** 金额：充值=收的钱，课消=这一节扣的钱 */
  amount: number | null;
}

/** 单个学生：档案 + 余额 + 课时流水 + 学情时间线 + 上课记录 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const id = Number((await ctx.params).id);
    const student = get<StudentRow>("select * from student where id = ?", [id]);
    if (!student) return fail("学生不存在", 404);

    const balance = get<{ balance_minutes: number; balance_hours: number }>(
      "select balance_minutes, balance_hours from v_student_balance where student_id = ?",
      [id],
    );

    const ledger = all<LedgerWithName>(
      `select l.id, l.delta_minutes, l.kind, l.ref_id, l.remark, l.created_at,
              l.unit_price, l.amount, c.name as course_name
       from hours_ledger l left join course c on c.id = l.course_id
       where l.student_id = ?
       order by l.id desc limit 100`,
      [id],
    );

    const notes = all<NoteRow & { lesson_start: string | null; course_name: string | null }>(
      `select n.*, l.start_at as lesson_start, c.name as course_name
       from note n
       left join lesson l on l.id = n.lesson_id
       left join course c on c.id = l.course_id
       where n.student_id = ?
       order by n.id desc limit 100`,
      [id],
    );

    const lessons = all<{
      lesson_id: number;
      start_at: string;
      minutes: number;
      course_name: string;
      title: string | null;
      att_status: string | null;
      billed_minutes: number | null;
      status: string;
    }>(
      `select l.id as lesson_id, l.start_at, l.minutes, c.name as course_name, l.title,
              a.status as att_status, a.billed_minutes, l.status as status
       from lesson_student ls
       join lesson l on l.id = ls.lesson_id
       join course c on c.id = l.course_id
       left join attendance a on a.lesson_id = l.id and a.student_id = ls.student_id
       where ls.student_id = ?
       order by l.start_at desc limit 50`,
      [id],
    );

    const payments = all<{
      id: number;
      amount: number;
      minutes: number | null;
      method: string | null;
      paid_at: string;
      remark: string | null;
    }>("select id, amount, minutes, method, paid_at, remark from payment where student_id = ? order by paid_at desc, id desc limit 50", [id]);
    const paidTotal = payments.reduce((n, p) => n + (p.amount || 0), 0);

    // 知识点掌握度：按 note.topic 聚合，不做 BKT，只给可解释的「记过几次 / 最近怎么样」
    const topics = all<{
      topic: string;
      count: number;
      avg_level: number | null;
      last_level: number | null;
      last_at: string;
      recent_levels: string | null;
    }>(
      `select n.topic as topic,
              count(*) as count,
              avg(n.level) as avg_level,
              (select n2.level from note n2
                where n2.student_id = n.student_id and n2.topic = n.topic and n2.level is not null
                order by n2.id desc limit 1) as last_level,
              max(n.created_at) as last_at,
              (select group_concat(x.level, ',') from (
                  select n3.level from note n3
                  where n3.student_id = n.student_id and n3.topic = n.topic and n3.level is not null
                  order by n3.id desc limit 6
               ) x) as recent_levels
       from note n
       where n.student_id = ? and n.topic is not null and trim(n.topic) <> ''
       group by n.topic
       order by count desc, last_at desc`,
      [id],
    );

    return ok({
      student,
      balance_minutes: balance?.balance_minutes ?? 0,
      balance_hours: balance?.balance_hours ?? 0,
      ledger,
      notes,
      lessons,
      payments,
      paidTotal,
      topics,
    });
  } catch (e) {
    return fail(e, 500);
  }
}

/** 改档案 */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const id = Number((await ctx.params).id);
    const exists = get<{ id: number }>("select id from student where id = ?", [id]);
    if (!exists) return fail("学生不存在", 404);

    const b = await req.json();
    const fields: string[] = [];
    const params: unknown[] = [];
    const map: Record<string, string> = {
      name: "name",
      gender: "gender",
      grade: "grade",
      school: "school",
      guardianName: "guardian_name",
      guardianPhone: "guardian_phone",
      guardianWechat: "guardian_wechat",
      note: "note",
      status: "status",
      joinedAt: "joined_at",
    };
    for (const [key, col] of Object.entries(map)) {
      if (b[key] !== undefined) {
        fields.push(`${col} = ?`);
        params.push(b[key] === "" ? null : b[key]);
      }
    }
    if (fields.length === 0) return fail("没有要修改的字段");
    fields.push("updated_at = datetime('now','localtime')");
    params.push(id);
    run(`update student set ${fields.join(", ")} where id = ?`, params);
    return ok(get<StudentRow>("select * from student where id = ?", [id]));
  } catch (e) {
    return fail(e);
  }
}

/** 软删除：状态改为 left（保留历史账目） */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const id = Number((await ctx.params).id);
    run("update student set status = 'left', updated_at = datetime('now','localtime') where id = ?", [id]);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
