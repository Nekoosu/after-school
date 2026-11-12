import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// 数据闸门：/api/* 只允许「桌面程序」访问（壳把 as_gate 塞进 Cookie）。
// 用浏览器直接开 http://127.0.0.1:3210 只能看到页面架子，拿不到任何数据。
// 例外（白名单）：
//   /api/health      启动器探活要用
//   /api/license     激活窗口要靠它；还没激活时本来就锁着
//   /api/update      查新版本（家长页/设置页）
//   /api/share*      家长分享页本来就要给外人看（有 HMAC token 保护）
//   /api/calendar.ics 手机日历订阅（外部程序，没有 Cookie）
// 直接命令行起服务（开发/冒烟）时没有 AS_GATE 环境变量 → 闸门关闭，一切照旧。

export const config = {
  matcher: "/api/:path*",
};

const ALLOW = new Set([
  "/api/health",
  "/api/license",
  "/api/update",
  "/api/share",
  "/api/share/link",
  "/api/calendar.ics",
]);

export function middleware(req: NextRequest) {
  const gate = String(process.env.AS_GATE || "");
  if (!gate) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (ALLOW.has(pathname)) return NextResponse.next();
  const cookie = req.cookies.get("as_gate")?.value || "";
  const header = req.headers.get("x-as-gate") || "";
  if (cookie === gate || header === gate) return NextResponse.next();
  return NextResponse.json(
    { ok: false, error: "请通过桌面程序（AfterSchool.exe）打开课后服务管理；浏览器直连拿不到数据。" },
    { status: 403 }
  );
}
