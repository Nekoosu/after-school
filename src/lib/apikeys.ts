import { randomBytes } from "node:crypto";
import { run, setting } from "@/db";
import { sameToken, tokenFrom } from "./token";

/**
 * 对接令牌：给「别的程序 / AI 助手」访问 /api/v1/* 用。
 * 存在 setting 表里（api_token），设置页可以生成、重置、复制。
 * 令牌为空 = 没开启对接，所有 /api/v1/* 一律 403。
 * 纯函数部分在 ./token，这里只管存取和守卫。
 */

export const TOKEN_KEY = "api_token";

export function apiToken(): string {
  return setting(TOKEN_KEY, "").trim();
}

export function hasToken(): boolean {
  return apiToken() !== "";
}

/** 生成一个新令牌并落库（旧令牌立即失效） */
export function newToken(): string {
  const token = "as_" + randomBytes(24).toString("hex");
  run(
    "insert into setting (key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
    [TOKEN_KEY, token],
  );
  return token;
}

/** 清掉令牌，等于关掉对接 */
export function clearToken(): void {
  run(
    "insert into setting (key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
    [TOKEN_KEY, ""],
  );
}

/**
 * 守卫：通过返回 null，不通过直接返回一个 Response。
 * 用法：const denied = guard(req); if (denied) return denied;
 */
export function guard(req: Request): Response | null {
  const want = apiToken();
  const headers = { "content-type": "application/json; charset=utf-8" };
  if (!want) {
    return new Response(
      JSON.stringify({ error: "还没开启对接：先到「设置 → 对接与接口」生成一个令牌" }),
      { status: 403, headers },
    );
  }
  if (!sameToken(tokenFrom(req), want)) {
    return new Response(
      JSON.stringify({ error: "令牌不对或没带，格式：Authorization: Bearer <令牌>" }),
      { status: 401, headers },
    );
  }
  return null;
}
