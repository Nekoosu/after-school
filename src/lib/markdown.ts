/**
 * 极简 Markdown 渲染（不引任何依赖，够教案用）。
 *
 * 支持：# 标题（1~4 级）、**加粗**、*斜体*、`行内代码`、```代码块```、
 * - / * 无序列表、1. 有序列表、> 引用、--- 分隔线、[文字](链接)、换行。
 *
 * 安全：先整体转义 HTML，再按规则包标签，所以内容里写 <script> 只会显示成文字。
 */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 行内语法（入参必须已经转义过） */
function inline(s: string): string {
  let out = s;
  // 行内代码优先，避免里面的星号被当成加粗
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  // 只放行 http/https 链接，其它原样留文字
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text: string, url: string) => {
    return `<a href="${url}" target="_blank" rel="noreferrer">${text}</a>`;
  });
  return out;
}

export function renderMarkdown(src: string): string {
  const lines = esc((src ?? "").replace(/\r\n?/g, "\n")).split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.join("<br>")}</p>`);
      para = [];
    }
  };
  const flushAll = () => {
    flushPara();
    closeList();
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");

    if (line.trim().startsWith("```")) {
      if (inCode) {
        out.push(`<pre><code>${codeBuf.join("\n")}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushAll();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(raw);
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushAll();
      out.push("<hr>");
      continue;
    }

    const quote = /^&gt;\s?(.*)$/.exec(line.trim());
    if (quote) {
      flushPara();
      closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }

    const ul = /^[-*+]\s+(.*)$/.exec(line.trim());
    if (ul) {
      flushPara();
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }

    const ol = /^\d+[.、)]\s+(.*)$/.exec(line.trim());
    if (ol) {
      flushPara();
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    if (list) {
      closeList();
    }
    para.push(inline(line));
  }

  if (inCode && codeBuf.length) {
    out.push(`<pre><code>${codeBuf.join("\n")}</code></pre>`);
  }
  flushAll();
  return out.join("\n");
}

/** 给「预览/原文」切换用：这段文字里有没有 Markdown 记号 */
export function looksLikeMarkdown(src: string): boolean {
  return /(^|\n)\s{0,3}(#{1,4}\s|[-*+]\s|\d+[.、)]\s|&gt;\s|```)|(\*\*[^*]+\*\*)/.test(src ?? "");
}

/** 列表卡片上的一行摘要：把 Markdown 记号去掉，只留文字 */
export function plainText(src: string, max = 90): string {
  const s = (src ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/^&gt;\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+[.、)]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/**
 * 从教案正文里挑出「今天讲了什么」的要点，给家长反馈用。
 * 优先取小标题（# 后面那串），没有小标题就取列表项；去掉记号，每条压到 len 字以内。
 * 目的只有一个：老师不用再把上课内容重复说一遍。
 */
export function planPoints(src: string, max = 3, len = 18): string[] {
  const lines = (src ?? "").split(/\r?\n/);
  const subHeads: string[] = [];
  const topHeads: string[] = [];
  const items: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("```")) continue;
    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      // 一级标题通常就是教案标题本身，放进要点会跟标题重复
      if (h[1].length === 1) topHeads.push(h[2].trim());
      else subHeads.push(h[2].trim());
      continue;
    }
    const li = line.match(/^[-*+]\s+(.+)$/) || line.match(/^\d+[.、)]\s+(.+)$/);
    if (li) items.push(li[1].trim());
  }
  // 有小标题用小标题；没小标题但有列表就用列表项；实在都没有才用大标题
  const pick = (subHeads.length ? subHeads : items.length ? items : topHeads)
    .map((t) => plainText(t, len))
    .map((t) => t.replace(/[：:。，,；;]+$/, ""))
    .filter((t) => t.length >= 2)
    .filter((t, i, arr) => arr.indexOf(t) === i);
  return pick.slice(0, max);
}
