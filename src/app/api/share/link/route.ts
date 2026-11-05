import { sharePath } from "@/lib/share";
import { fail, ok } from "@/lib/http";
import { get } from "@/db";

export const dynamic = "force-dynamic";

/** 老师要「发给家长」的只读链接；令牌由本机密钥算出，换密钥即全部失效 */
export async function GET(req: Request) {
  try {
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) return fail(new Error("学生编号不对"), 400);
    const row = get<{ id: number }>("select id from student where id = ?", [id]);
    if (!row) return fail(new Error("找不到这个学生"), 404);
    return ok({ path: sharePath(id) });
  } catch (e) {
    return fail(e, 500);
  }
}
