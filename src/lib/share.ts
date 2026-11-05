import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { get, run } from "@/db";

/**
 * 家长分享链接：不需要登录、但也不是谁拿到网址都能看。
 * 令牌 = HMAC-SHA256(本机密钥, 学生 id)，密钥只存在这台机器的库里；
 * 所以链接可复制、可转发给家长，别人猜学生 id 也进不来。
 */
const SECRET_KEY = "share_secret";

function secret(): string {
  const now = get<{ value: string }>("select value from setting where key = ?", [SECRET_KEY])?.value ?? "";
  if (now) return now;
  const fresh = randomBytes(24).toString("hex");
  run("insert into setting (key, value) values (?, ?) on conflict(key) do update set value = excluded.value", [
    SECRET_KEY,
    fresh,
  ]);
  return fresh;
}

export function shareToken(studentId: number, key = secret()): string {
  return createHmac("sha256", key).update(`student:${studentId}`).digest("hex").slice(0, 24);
}

export function sameShareToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** 校验请求里的 id + k 是否配对 */
export function checkShare(studentId: number, token: string): boolean {
  if (!Number.isInteger(studentId) || studentId <= 0 || !token) return false;
  return sameShareToken(shareToken(studentId), token);
}

/** 换一份新密钥，之前发出去的链接全部失效 */
export function rotateSecret(): string {
  const fresh = randomBytes(24).toString("hex");
  run("insert into setting (key, value) values (?, ?) on conflict(key) do update set value = excluded.value", [
    SECRET_KEY,
    fresh,
  ]);
  return fresh;
}

export function sharePath(studentId: number): string {
  return `/share/${studentId}?k=${shareToken(studentId)}`;
}

/** 给设置页展示用：有没有配过密钥 */
export function hasSecret(): boolean {
  return Boolean(get<{ value: string }>("select value from setting where key = ?", [SECRET_KEY])?.value);
}
