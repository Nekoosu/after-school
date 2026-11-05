import { all } from "@/db";
import { fail } from "@/lib/http";
import { fileResponse, toCsv, stamp } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** 固定白名单，避免表名拼接被注入 */
const TABLES = [
  "student",
  "course",
  "class_group",
  "enrollment",
  "lesson",
  "lesson_student",
  "attendance",
  "hours_ledger",
  "note",
  "feedback",
  "payment",
  "teach_plan",
  "setting",
] as const;

type Scope = "all" | "students" | "plans" | "classes" | "payments" | "records";

/**
 * 导出。三种用法：
 *   /api/export                    → 全量 JSON（搬家/自己留底）
 *   /api/export?scope=plans        → 教案 JSON（能再导回来）
 *   /api/export?scope=students&format=csv → 学生名册 CSV（给人看/给 Excel）
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const scope = (url.searchParams.get("scope") ?? "all") as Scope;
    const format = url.searchParams.get("format") ?? (scope === "plans" || scope === "classes" ? "json" : "csv");

    if (scope === "all") return fullBackup();

    if (scope === "plans") {
      const rows = all<Record<string, unknown>>(
        `select p.title, p.topic, p.content, p.minutes, p.tags, coalesce(c.name,'') as course
           from teach_plan p left join course c on c.id = p.course_id
          order by p.id`,
      );
      if (format === "csv") {
        return fileResponse(
          toCsv(rows, [
            { key: "title", label: "标题" },
            { key: "course", label: "课程" },
            { key: "topic", label: "主题" },
            { key: "minutes", label: "时长(分钟)" },
            { key: "tags", label: "标签" },
            { key: "content", label: "内容" },
          ]),
          `教案-${stamp()}.csv`,
          "text/csv",
        );
      }
      return fileResponse(
        JSON.stringify({ app: "课后服务管理", scope: "plans", exportedAt: new Date().toISOString(), rows }, null, 2),
        `教案-${stamp()}.json`,
        "application/json",
      );
    }

    if (scope === "classes") {
      const rows = all<Record<string, unknown>>(
        `select g.id, g.name, coalesce(c.name,'') as course, g.weekday, g.start_time, g.minutes, g.room
           from class_group g left join course c on c.id = g.course_id
          order by g.id`,
      );
      if (format === "csv") {
        return fileResponse(
          toCsv(rows, [
            { key: "name", label: "班级" },
            { key: "course", label: "课程" },
            { key: "weekday", label: "星期(0=周日)" },
            { key: "start_time", label: "上课时间" },
            { key: "minutes", label: "时长(分钟)" },
            { key: "room", label: "教室" },
          ]),
          `班级-${stamp()}.csv`,
          "text/csv",
        );
      }
      // 带成员名字，方便换个库重建
      const withMembers = rows.map((r) => ({
        name: r.name,
        course: r.course,
        weekday: r.weekday,
        start_time: r.start_time,
        minutes: r.minutes,
        room: r.room,
        members: all<{ name: string }>(
          `select s.name from enrollment e join student s on s.id = e.student_id
            where e.class_id = ? order by s.name`,
          [r.id],
        ).map((x) => x.name),
      }));
      return fileResponse(
        JSON.stringify(
          { app: "课后服务管理", scope: "classes", exportedAt: new Date().toISOString(), rows: withMembers },
          null,
          2,
        ),
        `班级-${stamp()}.json`,
        "application/json",
      );
    }

    if (scope === "payments") {
      const rows = all<Record<string, unknown>>(
        `select pay.paid_at, s.name as student, pay.amount, pay.minutes, pay.method, pay.remark
           from payment pay join student s on s.id = pay.student_id
          order by pay.paid_at desc, pay.id desc`,
      );
      return fileResponse(
        toCsv(rows, [
          { key: "paid_at", label: "日期" },
          { key: "student", label: "学生" },
          { key: "amount", label: "金额" },
          { key: "minutes", label: "充课时(分钟)" },
          { key: "method", label: "方式" },
          { key: "remark", label: "备注" },
        ]),
        `收款记录-${stamp()}.csv`,
        "text/csv",
      );
    }

    if (scope === "records") {
      // 支持跟「上课记录」页一样的筛选：from / to / studentId / courseId
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      const studentId = Number(url.searchParams.get("studentId") ?? 0) || 0;
      const courseId = Number(url.searchParams.get("courseId") ?? 0) || 0;
      const where: string[] = ["1 = 1"];
      const params: unknown[] = [];
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
        where.push("substr(l.start_at, 1, 10) >= ?");
        params.push(from);
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        where.push("substr(l.start_at, 1, 10) <= ?");
        params.push(to);
      }
      if (studentId) {
        where.push("s.id = ?");
        params.push(studentId);
      }
      if (courseId) {
        where.push("l.course_id = ?");
        params.push(courseId);
      }
      const rows = all<Record<string, unknown>>(
        `select l.start_at, coalesce(l.title, c.name) as title, c.name as course, coalesce(l.room,'') as room,
                s.name as student, coalesce(a.status,'') as att, coalesce(a.billed_minutes,0) as billed,
                l.status as lesson_status, coalesce(a.note,'') as note, coalesce(n.topic,'') as topic
           from lesson l
           join course c on c.id = l.course_id
           join lesson_student ls on ls.lesson_id = l.id
           join student s on s.id = ls.student_id
           left join attendance a on a.lesson_id = l.id and a.student_id = s.id
           left join note n on n.id = (
             select n2.id from note n2
              where n2.lesson_id = l.id and n2.student_id = s.id
              order by n2.id desc limit 1
           )
          where ${where.join(" and ")}
          order by l.start_at desc, s.name`,
        params,
      );
      return fileResponse(
        toCsv(rows, [
          { key: "start_at", label: "上课时间" },
          { key: "course", label: "课程" },
          { key: "title", label: "这节课" },
          { key: "room", label: "教室" },
          { key: "student", label: "学生" },
          { key: "att", label: "出勤" },
          { key: "billed", label: "扣课时(分钟)" },
          { key: "lesson_status", label: "状态" },
          { key: "topic", label: "知识点" },
          { key: "note", label: "一句话" },
        ]),
        `上课记录-${stamp()}.csv`,
        "text/csv",
      );
    }

    // students
    const rows = all<Record<string, unknown>>(
      `select s.name, s.grade, s.school, s.guardian_name, s.guardian_phone, s.guardian_wechat, s.status,
              round(coalesce(b.balance_minutes,0) / 60.0, 1) as balance_hours,
              round(coalesce((select sum(amount) from payment p where p.student_id = s.id), 0), 0) as paid_total
         from student s left join v_student_balance b on b.student_id = s.id
        order by s.status, s.name`,
    );
    if (format === "json") {
      const plain = rows.map((r) => ({
        name: r.name,
        grade: r.grade,
        school: r.school,
        guardianName: r.guardian_name,
        guardianPhone: r.guardian_phone,
        guardianWechat: r.guardian_wechat,
        status: r.status,
      }));
      return fileResponse(
        JSON.stringify({ app: "课后服务管理", scope: "students", exportedAt: new Date().toISOString(), rows: plain }, null, 2),
        `学生名册-${stamp()}.json`,
        "application/json",
      );
    }
    return fileResponse(
      toCsv(rows, [
        { key: "name", label: "姓名" },
        { key: "grade", label: "年级" },
        { key: "school", label: "学校" },
        { key: "guardian_name", label: "家长" },
        { key: "guardian_phone", label: "电话" },
        { key: "guardian_wechat", label: "微信" },
        { key: "status", label: "状态" },
        { key: "balance_hours", label: "剩余课时(小时)" },
        { key: "paid_total", label: "累计交费" },
      ]),
      `学生名册-${stamp()}.csv`,
      "text/csv",
    );
  } catch (e) {
    return fail(e, 500);
  }
}

function fullBackup() {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    const rows = all<Record<string, unknown>>(`select * from ${t}`);
    tables[t] = rows;
    counts[t] = rows.length;
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "课后服务管理",
    schema: 1,
    counts,
    tables,
  };
  return fileResponse(JSON.stringify(payload, null, 2), `after-school-${stamp()}.json`, "application/json");
}
