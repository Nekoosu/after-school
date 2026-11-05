// 在无头 Edge 里跑一段 JS，看看真实的 DOM/样式（排查“看着不对但代码找不到”的问题）
// 用法：node scripts\evaljs.mjs http://127.0.0.1:3210 /calendar "表达式"
// 表达式里有引号时，别从命令行传（PowerShell 会把引号吃掉），写成文件：node scripts\evaljs.mjs <base> <path> @probe.js
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:3319";
const PATH = process.argv[3] || "/";
const RAW = process.argv[4] || "document.title";
const EXPR = RAW.startsWith("@") ? readFileSync(RAW.slice(1), "utf8") : RAW;
const PORT = 9356;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "E:\\after-school\\.edge-eval";

const child = spawn(
  EDGE,
  ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "--window-size=1440,1000", "about:blank"],
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
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: BASE + PATH });
await sleep(2400);

const r = await send("Runtime.evaluate", { expression: EXPR, returnByValue: true, awaitPromise: true });
if (r.result?.exceptionDetails) console.log("EXCEPTION", JSON.stringify(r.result.exceptionDetails).slice(0, 400));
else console.log(JSON.stringify(r.result?.result?.value, null, 2));

ws.close();
child.kill();
