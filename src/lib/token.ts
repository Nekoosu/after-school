/**
 * 令牌相关的纯函数（不碰数据库，方便单测）。
 */

/** 从请求里取令牌：优先 Authorization: Bearer，其次 ?token= */
export function tokenFrom(req: Request): string {
  const auth = (req.headers.get("authorization") || "").trim();
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  try {
    return (new URL(req.url).searchParams.get("token") || "").trim();
  } catch {
    return "";
  }
}

/** 等长逐字节比较，避免 === 泄露长度信息（这里只是习惯，本地应用没对手） */
export function sameToken(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
