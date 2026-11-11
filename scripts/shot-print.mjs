// 看打印样式长什么样：模拟「打印」媒体 + A4 宽度截图
// 用法：node scripts\shot-print.mjs http://127.0.0.1:3319 E:\after-school\.shots\print
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3319";
const OUT = process.argv[3] || "E:\\after-school\\.shots\\print";
const PORT = 9356;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "E:\\after-school\\.edge-print";
const ONLY = (process.env.SHOT_ONLY || "").split(",").filter(Boolean);

mkdirSync(OUT, { recursive: true });

// A4 @96dpi：210×297mm ≈ 794×1123px
const pages = [
  { name: "p1-calendar", path: "/calendar/print", w: 794, h: 1123 },
  { name: "p2-statement", path: "/students/1/statement", w: 794, h: 1123 },
  { name: "p3-calendar", path: "/calendar", w: 794, h: 1123 },
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
  await send("Emulation.setDeviceMetricsOverride", {
    width: p.w,
    height: p.h,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Emulation.setEmulatedMedia", { media: "print" });
  await send("Page.navigate", { url: BASE + p.path });
  await sleep(1800);
  // 深色主题下打印，也应该是浅底黑字（CSS 里打印媒体会换回浅色 token）
  if (process.env.SHOT_DARK === "1") {
    await send("Runtime.evaluate", {
      expression: "localStorage.setItem('as-theme','dark'); location.reload();",
    });
    await sleep(2200);
  } else {
    await send("Runtime.evaluate", {
      expression: "if (localStorage.getItem('as-theme') === 'dark') { localStorage.setItem('as-theme','light'); location.reload(); }",
    });
    await sleep(800);
  }
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const theme = await send("Runtime.evaluate", {
    expression: "document.documentElement.dataset.theme || 'light'",
    returnByValue: true,
  });
  console.log("  theme =", theme.result?.result?.value);
  const data = r.result?.data;
  if (!data) {
    console.log("skip", p.name, JSON.stringify(r).slice(0, 140));
    continue;
  }
  writeFileSync(join(OUT, p.name + ".png"), Buffer.from(data, "base64"));
  console.log(p.name, p.path, p.w + "x" + p.h);
}

ws.close();
child.kill();
