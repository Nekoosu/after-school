import { all } from "@/db";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/topics —— 记过的知识点（按出现次数排），用于输入时的候选 */
export async function GET() {
  try {
    return ok(
      all<{ topic: string; count: number }>(
        `select topic, count(*) as count
         from note
         where topic is not null and trim(topic) <> ''
         group by topic
         order by count desc, max(created_at) desc
         limit 60`,
      ),
    );
  } catch (e) {
    return fail(e);
  }
}
