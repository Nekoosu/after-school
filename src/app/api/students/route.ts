import { all, get, run } from "@/db";
import type { StudentRow, StudentWithBalance } from "@/db/types";
import { fail, need, ok } from "@/lib/http";
import { todayStr } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** 学生列表 + 余额，余额少的排前面 */
export async function GET() {
  try {
    const rows = all<StudentWithBalance>(`
      select s.id, s.name, s.gender, s.grade, s.school,
             s.guardian_name, s.guardian_phone, s.guardian_wechat,
             s.note, s.status, s.joined_at, s.created_at, s.updated_at,
             b.balance_minutes, b.balance_hours,
             (select max(created_at) from note n where n.student_id = s.id) as last_note_at
      from student s
      left join v_student_balance b on b.student_id = s.id
      where s.status <> 'left'
      order by coalesce(b.balance_minutes, 0) asc, s.name asc
    `);
    return ok(rows);
  } catch (e) {
    return fail(e, 500);
  }
}

/** 新建学生 */
export async function POST(req: Request) {
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
