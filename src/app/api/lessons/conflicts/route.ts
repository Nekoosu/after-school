import { findConflicts } from "@/lib/conflicts";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/lessons/conflicts?startAt=2026-11-04 16:30&minutes=90&studentIds=1,2&teacherId=3&exclude=4
 *  排课弹窗里边填边查，不用等提交才知道撞了。
 *  学生撞课、老师撞课都会出现在 conflicts 里，用 kind 区分。 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const startAt = (url.searchParams.get("startAt") ?? "").trim();
    const minutes = Number(url.searchParams.get("minutes")) || 90;
    const studentIds = (url.searchParams.get("studentIds") ?? "")
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((x) => x > 0);
    const exclude = Number(url.searchParams.get("exclude")) || 0;
    const teacherId = Number(url.searchParams.get("teacherId")) || null;

    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(startAt)) {
      return ok({ conflicts: [] });
    }
    if (studentIds.length === 0 && !teacherId) {
      return ok({ conflicts: [] });
    }
    return ok({ conflicts: findConflicts(studentIds, startAt, minutes, exclude, teacherId) });
  } catch (e) {
    return fail(e);
  }
}
