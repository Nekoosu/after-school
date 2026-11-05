import { chat } from "@/lib/ai";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

const SYSTEM = `你是一位有十年经验的小学、初中课后托管老师，正在写自己的教案。
要求：
1. 用 Markdown 输出，第一行是一个一级标题（这节课的名字，不超过 20 字）。
2. 正文固定分四节，标题用二级标题，顺序是：这节课要解决什么 / 例题 /
   易错点 / 课后练习。例题给 2~3 道，课后练习给 3 道，都是能当场讲、当场练的。
3. 只写我给你的学科、年级、主题范围内的内容。不许编造教材版本、页码、考试真题出处。
4. 语言平实，像写给自己的备忘，不要客套话，不要 emoji。
5. 全文 300~500 字。只输出教案本身，不要解释你在做什么。`;

/**
 * AI 起一份教案初稿。
 * 只是初稿：老师拿去改，改完再存。AI 没开 / 没网 / 没 key 都只返回 {ok:false}，不抛 500。
 */
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as {
      topic?: string;
      subject?: string;
      grade?: string;
      minutes?: number;
      notes?: string;
    };
    const topic = (b.topic ?? "").trim();
    if (!topic) return fail("先说说这节课要讲什么", 400);
    if (topic.length > 120) return fail("主题太长了，简单写一句就行", 400);

    const lines = [
      `主题：${topic}`,
      b.subject ? `学科：${b.subject}` : "",
      b.grade ? `年级：${b.grade}` : "",
      b.minutes ? `课时长度：${b.minutes} 分钟` : "",
      b.notes ? `我自己的要求：${b.notes.trim().slice(0, 300)}` : "",
    ].filter(Boolean);

    try {
      const content = await chat(
        [
          { role: "system", content: SYSTEM },
          { role: "user", content: lines.join("\n") },
        ],
        40000,
        1200,
      );
      return ok({ ok: true, content });
    } catch (e) {
      return ok({ ok: false, error: (e as Error).message });
    }
  } catch (e) {
    return fail(e, 500);
  }
}
