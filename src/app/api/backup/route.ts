import { NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sqlite } from "@/db";
import { backupPath, makeBackup, removeBackup } from "@/lib/backup";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/backup —— 现在立刻存一份快照到 backups 目录（桌面壳的托盘菜单用它）
 * 和 GET 现场下载的区别：这个只落在本机，返回文件名，方便在备份列表里看到。
 */
export async function POST() {
  try {
    const file = await makeBackup("manual");
    return ok({ ok: true, name: file.name, size: file.size });
  } catch (e) {
    return fail(e, 500);
  }
}

/**
 * DELETE /api/backup?file=xxx.db —— 删掉一份没用的备份（手动清理）
 * 只认 backups 目录里、名字合规的那份，别的路径一律拒绝。
 */
export async function DELETE(req: Request) {
  try {
    const file = new URL(req.url).searchParams.get("file") ?? "";
    if (!file) return fail(new Error("要指定删哪一份，例如 ?file=auto-2026-11-05-101500.db"));
    return ok(removeBackup(file));
  } catch (e) {
    return fail(e, 400);
  }
}

/**
 * GET /api/backup             —— 现场生成一份快照并下载（服务在跑也安全）
 * GET /api/backup?file=xxx.db —— 下载 backups 目录里已有的那一份（自动备份）
 */
export async function GET(req: Request) {
  const file = new URL(req.url).searchParams.get("file");

  // 下载已备份过的文件；文件名做了白名单校验，挡路径穿越
  if (file) {
    const full = backupPath(file);
    if (!full) return NextResponse.json({ error: "找不到这份备份" }, { status: 404 });
    const buf = fs.readFileSync(full);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/x-sqlite3",
        "Content-Disposition": `attachment; filename="${path.basename(full)}"`,
        "Content-Length": String(buf.length),
        "Cache-Control": "no-store",
      },
    });
  }

  const now = new Date();
  const stamp =
    `${now.getFullYear()}-` +
    `${String(now.getMonth() + 1).padStart(2, "0")}-` +
    `${String(now.getDate()).padStart(2, "0")}-` +
    `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;

  const tmp = path.join(os.tmpdir(), `after-school-backup-${Date.now()}.db`);

  try {
    await sqlite().backup(tmp);
    const buf = fs.readFileSync(tmp);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/x-sqlite3",
        "Content-Disposition": `attachment; filename="backup-${stamp}.db"`,
        "Content-Length": String(buf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: `备份失败：${(e as Error).message}` }, { status: 500 });
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 临时文件清理失败不影响主流程 */
    }
  }
}
