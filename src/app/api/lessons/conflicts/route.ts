import { findConflicts } from "@/lib/conflicts";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/lessons/conflicts?startAt=2026-11-04 16:30&minutes=90&studentIds=1,2&exclude=3
 *  排课弹窗里边填边查，不用等提交才知道撞了 */
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

    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(startAt) || studentIds.length === 0) {
      return ok({ conflicts: [] });
    }
    return ok({ conflicts: findConflicts(studentIds, startAt, minutes, exclude) });
  } catch (e) {
    return fail(e);
  }
}
