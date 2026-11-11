import { all, get } from "@/db";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 数据体检：出问题的地方各自数一遍，页面按条给出「去哪儿修」。 */
export type Issue = {
  key: string;
  label: string;
  hint: string;
  href: string;
  count: number;
  samples: string[];
};

export async function GET() {
  const nowSql = get<{ n: string }>("select datetime('now', 'localtime') as n")?.n ?? "";

  const negative = all<{ name: string; balance: number }>(
    `select s.name, v.balance_minutes as balance
       from v_student_balance v join student s on s.id = v.student_id
      where v.balance_minutes < 0
      order by v.balance_minutes asc limit 5`,
  );
  const negativeAll = get<{ n: number }>(
    "select count(*) as n from v_student_balance where balance_minutes < 0",
  );

  const noTeacher = all<{ id: number; title: string; start_at: string }>(
    `select l.id, l.title, l.start_at
       from lesson l join course c on c.id = l.course_id
      where coalesce(l.teacher_id, c.teacher_id) is null
        and l.status <> 'cancelled' and l.start_at >= ?
      order by l.start_at asc limit 5`,
    [nowSql],
  );
  const noTeacherAll = get<{ n: number }>(
    `select count(*) as n from lesson l join course c on c.id = l.course_id
      where coalesce(l.teacher_id, c.teacher_id) is null
        and l.status <> 'cancelled' and l.start_at >= ?`,
    [nowSql],
  );

  const dupNames = all<{ name: string; n: number }>(
    `select name, count(*) as n from student where status = 'active'
      group by name having count(*) > 1 order by n desc limit 5`,
  );
  const dupAll = get<{ n: number }>(
    `select count(*) as n from (select name from student where status = 'active'
      group by name having count(*) > 1)`,
  );

  const zeroMinutes = all<{ id: number; title: string; start_at: string }>(
    `select id, title, start_at from lesson where minutes <= 0
      order by start_at desc limit 5`,
  );
  const zeroAll = get<{ n: number }>("select count(*) as n from lesson where minutes <= 0");

  const noStudent = all<{ id: number; title: string; start_at: string }>(
    `select l.id, l.title, l.start_at from lesson l
      where l.status <> 'cancelled' and l.start_at >= ?
        and not exists (select 1 from lesson_student ls where ls.lesson_id = l.id)
      order by l.start_at asc limit 5`,
    [nowSql],
  );
  const noStudentAll = get<{ n: number }>(
    `select count(*) as n from lesson l
      where l.status <> 'cancelled' and l.start_at >= ?
        and not exists (select 1 from lesson_student ls where ls.lesson_id = l.id)`,
    [nowSql],
  );

  const issues: Issue[] = [
    {
      key: "negative",
      label: "课时是负数的学生",
      hint: "先核一下最近的流水，多半是漏充或补课没记",
      href: "/students?filter=active&sort=balance",
      count: negativeAll?.n ?? 0,
      samples: negative.map((r) => `${r.name}（${r.balance} 分钟）`),
    },
    {
      key: "no-teacher",
      label: "还没挂老师的课",
      hint: "老师页把课程挂到老师名下，课表就能按老师看了",
      href: "/teachers",
      count: noTeacherAll?.n ?? 0,
      samples: noTeacher.map((r) => `${r.start_at.slice(5, 16)} ${r.title}`),
    },
    {
      key: "dup-name",
      label: "同名的学生",
      hint: "同名容易在名单里点错人，建议在名字后面加个备注区分",
      href: "/students",
      count: dupAll?.n ?? 0,
      samples: dupNames.map((r) => `${r.name} × ${r.n}`),
    },
    {
      key: "zero-minutes",
      label: "时长写错的课",
      hint: "0 分钟或负数的课不会扣课时，多半是手滑",
      href: "/calendar",
      count: zeroAll?.n ?? 0,
      samples: zeroMinutes.map((r) => `${r.start_at.slice(5, 16)} ${r.title}`),
    },
    {
      key: "no-student",
      label: "没有学生的课",
      hint: "空课不会出现在点名与反馈里，补上学生或取消掉",
      href: "/calendar",
      count: noStudentAll?.n ?? 0,
      samples: noStudent.map((r) => `${r.start_at.slice(5, 16)} ${r.title}`),
    },
  ];

  return ok({
    checkedAt: nowSql,
    total: issues.reduce((s, i) => s + i.count, 0),
    issues,
  });
}
