// 给几个页面拍照：node scripts\shot.mjs http://127.0.0.1:3210 输出目录
// 用 Edge 无头 + CDP（Windows 上 --screenshot 参数常静默失败，这个稳）
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3319";
const OUT = process.argv[3] || "E:\\after-school\\.shots\\pack";
const PORT = 9355;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "E:\\after-school\\.edge-shot";

mkdirSync(OUT, { recursive: true });

// 想只拍某几张：SHOT_ONLY=01-today,07-mobile
// 想拍深色主题：SHOT_DARK=1
const ONLY = (process.env.SHOT_ONLY || "").split(",").filter(Boolean);
const DARK = process.env.SHOT_DARK === "1";
// SHOT_W=375 把所有页强行换成这个宽度（检查窄窗口适配用），SHOT_H 同理
const FORCE_W = Number(process.env.SHOT_W || 0);
const FORCE_H = Number(process.env.SHOT_H || 0);
const pages = [
  { name: "01-today", path: "/", w: 1440, h: 1000 },
  { name: "02-calendar", path: "/calendar", w: 1440, h: 1000 },
  { name: "03-student", path: "/students/1", w: 1440, h: 1100 },
  { name: "04-records", path: "/records", w: 1440, h: 1000 },
  { name: "05-settings", path: "/settings", w: 1440, h: 1200 },
  { name: "06-share", path: process.env.SHOT_SHARE || "/share/1", w: 520, h: 900 },
  { name: "07-mobile", path: "/", w: 520, h: 900 },
  { name: "08-monthly", path: "/monthly", w: 1440, h: 1000 },
  { name: "09-backups", path: "/settings", w: 1280, h: 760, scroll: 1120 },
  { name: "10-manual", path: "/manual", w: 1440, h: 1000 },
  { name: "11-teachers", path: "/teachers", w: 1440, h: 1000 },
  { name: "11-manual-mobile", path: "/manual", w: 520, h: 900 },
  // 侧边栏收起的样子：先写 localStorage 再重载，拍出来才是「记忆过的」状态
  { name: "12-collapsed", path: "/calendar", w: 1440, h: 900, collapse: true },
  // 快捷键说明面板（点顶栏的 ⓘ）
  { name: "13-shortcuts", path: "/", w: 1440, h: 1000, act: 'document.querySelector(\'button[aria-label="快捷键说明"]\').click()' },
];

const child = spawn(
  EDGE,
  ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "about:blank"],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(300);
  }
  throw new Error("CDP 起不来");
}

const ws = new WebSocket(await wsUrl());
await new Promise((r) => (ws.onopen = r));

let id = 0;
const waiting = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg);
    waiting.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id;
    waiting.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

await send("Page.enable");

for (const p of pages.filter((x) => ONLY.length === 0 || ONLY.includes(x.name))) {
  const w = FORCE_W || p.w;
  const h = FORCE_H || p.h;
  const name = FORCE_W ? `${p.name}-${w}` : p.name;
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
  // SHOT_SHARE 可以给完整 URL（演示数据打印出来的就是完整链接），也可以只给路径
  await send("Page.navigate", { url: /^https?:\/\//.test(p.path) ? p.path : BASE + p.path });
  await sleep(2200);
  // 想拍深色主题就切过去再重载（主题存在 localStorage 里）
  if (DARK || p.dark) {
    await send("Runtime.evaluate", {
      expression: "localStorage.setItem('as-theme','dark'); location.reload();",
    });
    await sleep(2400);
  } else {
    await send("Runtime.evaluate", {
      expression: "if (localStorage.getItem('as-theme') === 'dark') { localStorage.setItem('as-theme','light'); location.reload(); }",
    });
    await sleep(600);
  }
  // 想拍「侧边栏收起」：先写本地记忆，再整页重载，才是真实效果
  if (p.collapse) {
    await send("Runtime.evaluate", {
      expression: "localStorage.setItem('as-nav-collapsed','1'); location.reload();",
    });
    await sleep(2600);
  }
  // act: 截图前先跑一段 JS（点开某个面板、切到某个 Tab），方便拍「打开状态」
  if (p.act) {
    await send("Runtime.evaluate", { expression: p.act });
    await sleep(900);
  }
  // 想拍页面下半截就加 scroll: 像素数（截图前先滚下去）
  if (p.scroll) {
    await send("Runtime.evaluate", { expression: "window.scrollTo(0, " + Number(p.scroll) + ")" });
    await sleep(600);
  }
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const data = r.result?.data;
  if (!data) {
    console.log("skip", p.name, JSON.stringify(r).slice(0, 120));
    continue;
  }
  const file = join(OUT, name + ".png");
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log(name, p.path, w + "x" + h);
}

ws.close();
child.kill();
