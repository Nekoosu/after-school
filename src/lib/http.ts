/** Route Handler 共用的小工具 */

export const dynamic = "force-dynamic";

/**
 * 显式带 charset=utf-8：浏览器无所谓，但 PowerShell 的 Invoke-RestMethod、部分脚本和
 * 老客户端在没有 charset 时会按 Latin-1 解码，中文就变成「è¯¾å」这种乱码。
 */
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export function fail(e: unknown, status = 400): Response {
  const message = e instanceof Error ? e.message : String(e);
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

export function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data) ?? "", { status, headers: JSON_HEADERS });
}

/** 必填字符串校验 */
export function need(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} 不能为空`);
  }
  return value.trim();
}
