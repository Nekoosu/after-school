import { all, get, run } from "@/db";
import type { StudentRow, StudentWithBalance } from "@/db/types";
import { guard } from "@/lib/apikeys";
import { todayStr } from "@/lib/dates";
import { fail, need, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 学生列表（带课时余额）。需要令牌。 */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const rows = all<StudentWithBalance>(`
      select s.id, s.name, s.gender, s.grade, s.school,
             s.guardian_name, s.guardian_phone, s.guardian_wechat,
             s.note, s.status, s.joined_at, s.created_at, s.updated_at,
             b.balance_minutes, b.balance_hours
      from student s
      left join v_student_balance b on b.student_id = s.id
      where s.status <> 'left'
      order by s.name asc
    `);
    return ok({ count: rows.length, students: rows });
  } catch (e) {
    return fail(e, 500);
  }
}

/** 新建学生（外部程序 / AI 助手录入）。需要令牌。 */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const b = await req.json();
    const name = need(b.name, "姓名");
    const r = run(
      `insert into student (name, gender, grade, school, guardian_name, guardian_phone, guardian_wechat, note, joined_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        b.gender ?? null,
        b.grade ?? null,
        b.school ?? null,
        b.guardianName ?? null,
        b.guardianPhone ?? null,
        b.guardianWechat ?? null,
        b.note ?? null,
        b.joinedAt ?? todayStr(),
      ],
    );
    const row = get<StudentRow>("select * from student where id = ?", [r.lastInsertRowid]);
    return ok(row, 201);
  } catch (e) {
    return fail(e);
  }
}
