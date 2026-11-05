/**
 * 极简 CSV：导出用（Excel 能直接打开，带 BOM 才不乱码）。
 * 导入统一走 JSON —— CSV 的逗号、换行、引号在中文表格里太容易踩坑，
 * 与其写一个能扛住所有情况的解析器，不如让「导出 CSV 给人看，导入 JSON 给程序用」分工清楚。
 */

export interface Col {
  key: string;
  label: string;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 行数组 → CSV 文本（含 BOM，Windows Excel 直接双击不乱码） */
export function toCsv(rows: Record<string, unknown>[], cols: Col[]): string {
  const head = cols.map((c) => cell(c.label)).join(",");
  const body = rows.map((r) => cols.map((c) => cell(r[c.key])).join(",")).join("\r\n");
  return `\ufeff${head}\r\n${body}\r\n`;
}

/**
 * 统一给下载用的响应头。
 * HTTP 头只能放 ASCII，中文文件名必须走 RFC 5987 的 filename*，
 * 否则 Response 构造时直接抛「Cannot convert argument to a ByteString」。
 */
export function fileResponse(
  body: string,
  filename: string,
  type: string,
): Response {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(body, {
    headers: {
      "Content-Type": `${type}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}

/** 文件名里的时间戳：2026-11-05-1023 */
export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
