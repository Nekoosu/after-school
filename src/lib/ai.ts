import { setting } from "@/db";

/**
 * AI 只做「把话说明白」这一件事：把你自己记的学情整理成一段能发给家长的话。
 * 事实全部来自本地记录，模型不许添加新事实；调用失败就回退本地规则草稿。
 * 支持两种：DeepSeek 等 OpenAI 兼容接口（https 结尾 /v1），或本机 Ollama。
 */

export interface AiConf {
  enabled: boolean;
  base: string;
  model: string;
  key: string;
}

export function aiConf(): AiConf {
  const enabled = (setting("ai_enabled", "0") || "0") === "1";
  const base = (setting("ai_base", "") || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const model = setting("ai_model", "") || "deepseek-chat";
  const key = setting("ai_key", "");
  return { enabled, base, model, key };
}

interface Msg {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 调一次 Chat Completions（OpenAI 兼容），超时 25 秒 */
export async function chat(messages: Msg[], timeoutMs = 25000, maxTokens = 800): Promise<string> {
  const conf = aiConf();
  if (!conf.enabled) throw new Error("没有开启 AI 润色（设置页里打开）");
  if (!conf.base) throw new Error("没有填接口地址");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${conf.base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(conf.key ? { Authorization: `Bearer ${conf.key}` } : {}),
      },
      body: JSON.stringify({
        model: conf.model,
        messages,
        temperature: 0.4,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`接口返回 ${res.status}：${text.slice(0, 200)}`);
    }
    let json: { choices?: Array<{ message?: { content?: string } }> };
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("接口返回的不是 JSON，检查地址是否正确（一般以 /v1 结尾）");
    }
    const out = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!out) throw new Error("接口没有返回内容");
    return out;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("接口超时，先按本地草稿发吧");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM = `你是课后托管班的老师，正在给家长发一条微信。
要求：
1. 只能使用我给你的记录里出现过的事实、数字、表现；不许编造，不许添加记录里没有的评价。
2. 用平实的口语，像一个负责任的老师跟家长说话，不要夸张、不要营销腔、不要用「赋能」「闭环」这类词。
3. 总长度 180~260 字，分成 2~3 个自然段，不加标题、不加 emoji、不用 markdown 符号。
4. 保留具体数字（上了几次课、剩多少课时）。
5. 结尾落款用「老师」，不要写机构名。
只输出这段话本身，不要解释你在做什么。`;

/** 把本地规则草稿润色成能给家长发的话；失败返回 null（调用方回退原草稿） */
export async function polishFeedback(
  draft: string,
  studentName: string,
): Promise<{ text: string; model: string } | null> {
  const conf = aiConf();
  if (!conf.enabled) return null;
  try {
    const text = await chat([
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `学生：${studentName}\n下面是这段时间的记录和整理好的草稿，请改写成给家长的话：\n\n${draft}`,
      },
    ]);
    return { text, model: conf.model };
  } catch {
    return null;
  }
}
