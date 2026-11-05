// 临时脚本：用 CDP 打开一个页面，抓控制台报错。用完删。
import { spawn } from "node:child_process";

const URL_ = process.argv[2] || "http://127.0.0.1:3319/calendar/print";
const PORT = 9344;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "E:\\after-school\\.edge-err";

const child = spawn(
  EDGE,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "about:blank",
  ],
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
    return;
  }
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    console.log("[exception]", d.text, d.exception?.description?.slice(0, 600));
  }
  if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
    console.log(`[console.${msg.params.type}]`, msg.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 600));
  }
};

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id;
    waiting.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url: URL_ });
await sleep(6000);

const r = await send("Runtime.evaluate", {
  expression: "document.body.innerText.slice(0, 400)",
  returnByValue: true,
});
console.log("[text]", JSON.stringify(r.result?.result?.value));

ws.close();
child.kill();
