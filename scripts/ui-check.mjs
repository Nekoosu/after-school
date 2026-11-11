// 用真实浏览器（Edge headless + CDP）点一遍主要流程，验证「点得动、存得进」。
// 用法：node scripts/ui-check.mjs http://127.0.0.1:3318
// 不做断言库，失败就抛，退出码非 0。

const BASE = process.argv[2] ?? "http://127.0.0.1:3318";
const PORT = 9333;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "E:\\after-school\\.edge-ui";

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

let pass = 0;
let fail = 0;
const errors = [];

function ok(name, cond, extra = "") {
  if (cond) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(path) {
  const r = await fetch(BASE + path);
  return r.json();
}

async function fetchJson(path, init) {
  const r = await fetch(BASE + path, init);
  return r.json();
}

// ---------- 极简 CDP 客户端 ----------
let ws;
let seq = 0;
let currentPath = "";
const waiting = new Map();

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    setTimeout(() => {
      if (waiting.has(id)) {
        waiting.delete(id);
        reject(new Error(`CDP 超时：${method}`));
      }
    }, 30000);
  });
}

async function evalJS(expression) {
  const r = await send("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? "页面脚本报错");
  }
  return r.result?.value;
}

async function goto(path, waitText) {
  currentPath = path;
  await send("Page.navigate", { url: BASE + path });
  await waitFor("document.readyState === 'complete'", 15000);
  if (waitText) await waitFor(`document.body.innerText.includes(${JSON.stringify(waitText)})`, 15000);
  await sleep(400);
}

async function waitFor(expr, timeout = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await evalJS(`return !!(${expr});`)) return true;
    } catch {
      /* 页面还在跳，重试 */
    }
    await sleep(150);
  }
  return false;
}

const typeIn = (selector, text) => `return (() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) throw new Error("找不到 " + ${JSON.stringify(selector)});
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})();`;

const clickText = (text, tag = "button") => `return (() => {
  const el = [...document.querySelectorAll(${JSON.stringify(tag)})]
    .find((b) => (b.textContent || "").trim().includes(${JSON.stringify(text)}));
  if (!el) throw new Error("找不到按钮：" + ${JSON.stringify(text)});
  el.click();
  return true;
})();`;

const bodyText = "return document.body.innerText;";

// 点得到就点，点不到不算失败（有些弹窗可能已经自己关了）
async function clickSoft(text, tag = "button") {
  try {
    await evalJS(clickText(text, tag));
    await sleep(300);
    return true;
  } catch {
    return false;
  }
}

// ---------- 起浏览器 ----------
function startEdge() {
  const dir = fs.existsSync(PROFILE) ? PROFILE : PROFILE;
  const p = spawn(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${dir}`,
      "--window-size=1440,1000",
      "about:blank",
    ],
    { stdio: "ignore", detached: false },
  );
  return p;
}

async function connect() {
  let list;
  for (let i = 0; i < 60; i += 1) {
    try {
      list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (list.some((t) => t.type === "page")) break;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("连不上浏览器调试端口");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
      errors.push(`${currentPath} :: ${msg.params.exceptionDetails.exception?.description ?? "脚本异常"}`);
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      errors.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
  });
  await send("Page.enable");
  await send("Runtime.enable");
}

// ---------- 场景 ----------
async function main() {
  const edge = startEdge();
  try {
    await connect();

    console.log("\n[1] 建学生（点 UI）");
    await goto("/students?new=1", "学生");
    await waitFor("document.querySelector('.modal')");
    await evalJS(typeIn(".modal input.input", "小夏"));
    const gradeBox = await evalJS(`return (() => {
      const inputs = [...document.querySelectorAll(".modal input.input")];
      return inputs.length;
    })();`);
    ok("新建学生弹窗打开且有输入框", gradeBox >= 1, `输入框 ${gradeBox} 个`);
    await evalJS(clickText("保存"));
    await sleep(1200);
    let students = await getJson("/api/students");
    ok("学生已写入", students.some((s) => s.name === "小夏"), JSON.stringify(students.map((s) => s.name)));

    console.log("\n[2] 排课：一门课都没有时直接建课（这次修的 bug）");
    await goto("/calendar", "排课");
    await evalJS(clickText("排课"));
    await waitFor("document.querySelector('.modal')");
    // 没有任何课程时，课程位置应该是输入框
    const hasCourseInput = await evalJS(
      `return !!document.querySelector('.modal input[placeholder^="新课程名字"]');`,
    );
    ok("没有课程时给的是「新课程名字」输入框", hasCourseInput === true);
    await evalJS(typeIn('.modal input[placeholder^="新课程名字"]', "数学思维"));
    // 勾一个学生
    await evalJS(clickText("小夏", ".modal .check-row"));
    await evalJS(clickText("保存"));
    await sleep(1500);
    const courses = await getJson("/api/courses");
    const lessons = await getJson("/api/lessons?from=2000-01-01&to=2100-01-01");
    ok("课程被自动建好", courses.some((c) => c.name === "数学思维"), JSON.stringify(courses.map((c) => c.name)));
    ok("课排上了", lessons.length >= 1, `${lessons.length} 节`);
    ok("弹窗已关闭", (await evalJS("return !document.querySelector('.modal');")) === true);

    console.log("\n[3] 记一笔 → 自动进「跟家长说一句」");
    const lessonId = lessons[0].id;
    await goto(`/lessons/${lessonId}`, "记一笔");
    await evalJS(clickText("出勤", ".att-opt"));
    await evalJS(typeIn(".card input.input.grow", "进位还是容易漏一位"));
    await evalJS(clickText("记完了"));
    const jumped = await waitFor(`location.pathname.endsWith("/wrap")`, 10000);
    ok("记完自动跳到收尾页", jumped === true, await evalJS("return location.pathname;"));
    await waitFor(`document.body.innerText.includes("跟家长说一句")`);

    console.log("\n[4] 收尾页生成草稿");
    const wrapText = await evalJS(bodyText);
    ok("收尾页显示上课内容（来自教案/课程，不用重填）", wrapText.includes("上课内容") || wrapText.includes("数学思维"));
    await evalJS(typeIn("textarea.textarea", "今天进位题目稳了一些"));
    await evalJS(clickText("生成这段"));
    const gotDraft = await waitFor(
      `[...document.querySelectorAll("textarea")].some((t) => t.value.includes("家长您好"))`,
      12000,
    );
    ok("生成出给家长的话", gotDraft === true);
    const draftText = await evalJS(`return [...document.querySelectorAll("textarea")].map(t => t.value).join("\\n");`);
    ok("草稿里带上了老师写的那句话", draftText.includes("进位题目稳了一些"));
    ok("草稿里有课时段", draftText.includes("课时"));
    await evalJS(clickText("存草稿"));
    await sleep(1200);
    const drafts = await getJson("/api/feedback?status=draft");
    ok("草稿存进了草稿箱", drafts.length === 1, `${drafts.length} 条`);

    console.log("\n[5] 全局搜索（Ctrl+K）");
    await goToAndSearch();
    ok("搜索面板能打开并搜到学生", (await evalJS(`return document.body.innerText.includes("小夏");`)) === true);

    console.log("\n[6] 备课：新建教案 + Markdown 预览");
    await goto("/plans", "备课");
    await evalJS(clickText("新教案"));
    await waitFor("document.querySelector('.modal')");
    await evalJS(typeIn(".modal input.input", "进位加法"));
    const ta = await evalJS(`return document.querySelectorAll(".modal textarea.textarea").length;`);
    ok("教案弹窗有正文框", ta >= 1, `textarea ${ta} 个`);
    await evalJS(typeIn(".modal textarea.textarea", "## 竖式对齐\n\n- 个位对齐\n- 满十进一"));
    await evalJS(clickText("保存"));
    await sleep(1500);
    const plans = await getJson("/api/plans");
    ok("教案已保存", plans.some((p) => p.title === "进位加法"), JSON.stringify(plans.map((p) => p.title)));

    console.log("\n[7] 其余页面都能打开且不报错");
    for (const [path, marker] of [
      ["/", "今天"],
      ["/students", "学生"],
      ["/finance", "收款"],
      ["/stats", "热力"],
      ["/classes", "班"],
      ["/feedback", "反馈"],
      ["/settings", "备份"],
      ["/students/1/statement", "对账单"],
    ]) {
      await goto(path, marker);
      const txt = await evalJS(bodyText);
      ok(`${path} 渲染正常`, txt.length > 80);
    }

    console.log("\n[8] 学生详情：更多菜单 / 发给家长");
    const stu = (await getJson("/api/students")).find((s) => s.name === "小夏");
    await goto(`/students/${stu.id}`, "更多");
    await evalJS(clickText("更多"));
    ok("「更多」弹出菜单", (await waitFor(`!!document.querySelector(".menu")`)) === true);
    const menuText = await evalJS(`return (document.querySelector(".menu") || {}).innerText || "";`);
    ok(
      "菜单里收着打印 / 改档案 / 收学费",
      ["打印学情单", "编辑档案", "收学费"].every((t) => menuText.includes(t)),
      menuText.replace(/\n+/g, " / "),
    );
    await evalJS(clickText("编辑档案", ".menu-item"));
    await waitFor("document.querySelector('.modal')");
    ok("从菜单能进编辑档案", (await evalJS("return !!document.querySelector('.modal');")) === true);
    await evalJS(clickText("取消"));
    await sleep(500);
    await evalJS(clickText("发给家长"));
    const toastText = await waitFor(`!!document.querySelector(".toast")`, 8000);
    ok("「发给家长」点了有反馈", toastText === true, await evalJS(`return (document.querySelector(".toast")||{}).innerText || "";`));

    console.log("\n[9] 手机上右下角的 + 能直接开新建");
    await send("Emulation.setDeviceMetricsOverride", { width: 520, height: 900, deviceScaleFactor: 1, mobile: true });
    await goto("/plans", "备课");
    const fabOk = await evalJS(
      `return !!document.querySelector(".fab") && document.querySelector(".fab").getBoundingClientRect().width > 0;`,
    );
    ok("手机宽度下出现浮动按钮", fabOk === true);
    const fabLabel = await evalJS(`return (document.querySelector(".fab")||{}).getAttribute ? document.querySelector(".fab").getAttribute("aria-label") : "";`);
    ok("浮动按钮跟着页面走（这页是「写教案」）", String(fabLabel).includes("教案"), String(fabLabel));
    await evalJS(`return (document.querySelector(".fab").click(), true);`);
    const fabOpened = await waitFor("document.querySelector('.modal')", 12000);
    ok("点浮动按钮直接打开新建", fabOpened === true);
    await clickSoft("取消");
    await send("Emulation.clearDeviceMetricsOverride");
    await sleep(400);

    console.log("\n[10] 设置页：备份 → 恢复确认框");
    const mk = await fetch(`${BASE}/api/backup/list`, { method: "POST" });
    ok("能手动备份一份", mk.ok === true, `HTTP ${mk.status}`);
    await goto("/settings", "备份");
    const hasRestoreBtn = await waitFor(`!!document.querySelector('button[title="恢复到这份备份"]')`, 10000);
    ok("每份备份后面有恢复按钮", hasRestoreBtn === true);
    await evalJS(`return (document.querySelector('button[title="恢复到这份备份"]').click(), true);`);
    ok("点 ↻ 弹出恢复确认框", (await waitFor(`document.body.innerText.includes("恢复这份备份")`)) === true);
    ok("确认框说明会先另存一份", (await evalJS(bodyText)).includes("另存"));
    await evalJS(clickText("取消"));
    await sleep(500);
    ok("取消后不恢复", (await evalJS("return !document.body.innerText.includes('恢复这份备份');")) === true);
    console.log("\n[11] 设置页：多余的备份可以删");
    const beforeDel = ((await getJson("/api/backup/list")).files ?? []).length;
    await goto("/settings", "备份");
    const hasDelBtn = await waitFor(`!!document.querySelector('button[title="删掉这份备份"]')`, 10000);
    ok("每份备份后面有删除按钮", hasDelBtn === true);
    await evalJS(`return (document.querySelector('button[title="删掉这份备份"]').click(), true);`);
    ok("点 🗑 弹出删除确认框", (await waitFor(`document.body.innerText.includes("删掉这份备份")`)) === true);
    ok("确认框说明删了没法撤回", (await evalJS(bodyText)).includes("删了没法撤回"));
    await evalJS(clickText("取消"));
    await sleep(500);
    ok("取消后没删", ((await getJson("/api/backup/list")).files ?? []).length === beforeDel);
    await evalJS(`return (document.querySelector('button[title="删掉这份备份"]').click(), true);`);
    await waitFor(`document.body.innerText.includes("删掉这份备份")`);
    await evalJS(clickText("删掉"));
    await sleep(1000);
    const afterDel = ((await getJson("/api/backup/list")).files ?? []).length;
    ok("确认后真的删掉一份", afterDel === beforeDel - 1, `${beforeDel} → ${afterDel}`);
    ok("删完弹出提示", (await waitFor(`document.body.innerText.includes("已删掉")`, 4000)) === true);

    console.log("\n[12] 家长分享页（只读）");
    const link = await getJson(`/api/share/link?id=${stu.id}`);
    await goto(link.path, "剩余课时");
    const shareTxt = await evalJS(bodyText);
    ok("分享页显示孩子名字", shareTxt.includes("小夏"));
    ok("分享页显示剩余课时", shareTxt.includes("剩余课时"));
    ok("分享页没有手机号", !/1\d{10}/.test(shareTxt), shareTxt.match(/1\d{10}/)?.[0] ?? "");
    ok("分享页没有侧栏导航", (await evalJS("return !document.querySelector('.sidebar') && !document.querySelector('.tabbar');")) === true);
    await goto(link.path.replace(/k=[0-9a-f]+/, "k=deadbeef"), "链接打不开");
    ok("令牌不对就打不开", (await evalJS(bodyText)).includes("链接打不开"));

    console.log("\n[13] 月报页");
    await goto("/monthly", "月报");
    const monthTxt = await evalJS(bodyText);
    ok("月报页有标题和说明", monthTxt.includes("月报") && monthTxt.includes("扣了多少课时"), "");
    ok("有月份选择框", (await evalJS(`return !!document.querySelector('input[type="month"]');`)) === true);
    const m0 = await evalJS(`return document.querySelector('input[type="month"]').value;`);
    ok("月份选择框默认当月", /^\d{4}-\d{2}$/.test(String(m0)), String(m0));
    await evalJS(`return (() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("上月")); if (b) b.click(); return !!b; })();`);
    await sleep(600);
    const m1 = await evalJS(`return document.querySelector('input[type="month"]').value;`);
    ok("点上月会切到上个月", String(m1) !== String(m0) && /^\d{4}-\d{2}$/.test(String(m1)), `${m0} -> ${m1}`);
    ok("导出 CSV 指向接口", (await evalJS(`return !!document.querySelector('a[href*="format=csv"]');`)) === true);
    ok("明细或空态二选一", monthTxt.includes("按孩子看") || monthTxt.includes("这个月还没有数据"), "");

    console.log("\n[14] 使用说明（内置手册）");
    await goto("/manual", "目录");
    const manTxt = await evalJS(bodyText);
    ok("手册页有目录", manTxt.includes("目录"));
    const secCount = await evalJS(`return document.querySelectorAll("[data-sec]").length;`);
    ok("手册至少 15 节", Number(secCount) >= 15, `sections=${secCount}`);
    ok("讲到初始化怎么启动", manTxt.includes("安装与启动"));
    ok("讲到备份怎么恢复", manTxt.includes("备份、恢复与导入导出"));
    ok("有打印按钮", (await evalJS(`return !!([...document.querySelectorAll("button")].find((b) => b.textContent.includes("打印 / 存 PDF")));`)) === true);
    const tocLinks = await evalJS(`return document.querySelectorAll('.manual-toc a[href^="#sec-"]').length;`);
    ok("目录条数和节数对得上", Number(tocLinks) === Number(secCount), `toc=${tocLinks} sec=${secCount}`);
    const beforeY = await evalJS("return window.scrollY;");
    await evalJS(`return (() => {
      const a = [...document.querySelectorAll('.manual-toc a')].find((x) => x.textContent.includes("备份、恢复"));
      if (a) a.click();
      return !!a;
    })();`);
    await sleep(900);
    const afterY = await evalJS("return window.scrollY;");
    ok("点目录会跳到对应那一节", Number(afterY) > Number(beforeY), `${beforeY} -> ${afterY}`);
    ok("当前节在目录里高亮", (await evalJS(`return !!document.querySelector('.manual-toc a.on');`)) === true);
    ok("左栏有「使用说明」入口且高亮", (await evalJS(`return !!document.querySelector('.sidebar .nav-item.active[href="/manual"]');`)) === true);

    console.log("\n[15] 侧边栏收起 / 展开（两个入口各管一个方向）");
    await goto("/", "今天");
    await evalJS(`localStorage.removeItem("as-nav-collapsed"); return true;`);
    await goto("/", "今天");
    ok("展开时顶栏不重复放按钮", (await evalJS(`return !document.querySelector(".topbar-menu");`)) === true);
    ok("展开时有「收起侧边栏」这一行", (await evalJS(`return !!document.querySelector(".sidebar-fold");`)) === true);
    const wOpen = await evalJS(`return Math.round(document.querySelector(".sidebar").getBoundingClientRect().width);`);
    await evalJS(`return (document.querySelector(".sidebar-fold").click(), true);`);
    await sleep(600);
    const wShut = await evalJS(`return Math.round(document.querySelector(".sidebar").getBoundingClientRect().width);`);
    ok("点侧栏底部那行就收窄成图标栏", Number(wShut) < Number(wOpen) && Number(wShut) <= 70, `${wOpen} -> ${wShut}`);
    ok("收起后文字藏起来", (await evalJS(`return getComputedStyle(document.querySelector(".brand-text")).display === "none";`)) === true);
    const mainLeft = await evalJS(`return Math.round(document.querySelector(".main").getBoundingClientRect().left);`);
    ok("内容区跟着左移", Number(mainLeft) === Number(wShut), `main.left=${mainLeft}`);
    ok("收起后只剩「课」方块可以点开", (await evalJS(`return !!document.querySelector(".brand-mark-btn");`)) === true);
    ok("顶栏出现「展开侧边栏」按钮", String(await evalJS(`return document.querySelector(".topbar-menu")?.getAttribute("aria-label");`)) === "展开侧边栏");
    await goto("/", "今天");
    ok("刷新后还记得是收起的", String(await evalJS(`return document.querySelector(".shell").className;`)).includes("nav-collapsed"));
    await evalJS(`return (document.querySelector(".brand-mark-btn").click(), true);`);
    await sleep(600);
    const wBrand = await evalJS(`return Math.round(document.querySelector(".sidebar").getBoundingClientRect().width);`);
    ok("点「课」方块能展开", Number(wBrand) === Number(wOpen), `${wBrand} vs ${wOpen}`);
    ok("状态写回 localStorage", (await evalJS(`return localStorage.getItem("as-nav-collapsed");`)) === "0");
    await evalJS(`return (document.querySelector(".sidebar-fold").click(), true);`);
    await sleep(500);
    await evalJS(`return (document.querySelector(".topbar-menu").click(), true);`);
    await sleep(600);
    const wTop = await evalJS(`return Math.round(document.querySelector(".sidebar").getBoundingClientRect().width);`);
    ok("顶栏那个按钮也能展开", Number(wTop) === Number(wOpen), `${wTop} vs ${wOpen}`);
    await evalJS(`return (() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true }));
      return true;
    })();`);
    await sleep(600);
    const wKey = await evalJS(`return Math.round(document.querySelector(".sidebar").getBoundingClientRect().width);`);
    ok("Ctrl+B 也能收起", Number(wKey) <= 70, `${wKey}`);
    await evalJS(`return (() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true }));
      return true;
    })();`);
    await sleep(600);
    ok("收起状态没被写坏", (await evalJS(`return localStorage.getItem("as-nav-collapsed");`)) === "0");

    console.log("\n[16] 作者署名（写死在代码里：nekoosu）");
    await goto("/manual", "使用说明");
    ok("手册扉页有作者行", (await evalJS(`return document.body.innerText.includes("制作");`)) === true);
    ok("手册里的作者主页指向 Nekoosu", (await evalJS(`return !!document.querySelector('.manual-credit a[href="https://github.com/Nekoosu"]');`)) === true);
    ok("手册尾页也有署名", (await evalJS(`return !!document.querySelector(".manual-sign");`)) === true);
    await goto("/", "今天");
    ok("侧栏底部是「作者：nekoosu」", String(await evalJS(`return document.querySelector(".sidebar-author")?.innerText ?? "";`)) === "作者：nekoosu");
    ok("侧栏作者链接指向 GitHub", (await evalJS(`return !!document.querySelector('.sidebar-author[href="https://github.com/Nekoosu"]');`)) === true);

    console.log("\n[17] 课表「复制到下周」/「导出日历」/ AI「自动获取」");
    await goto("/calendar", "课表");
    ok("周视图有「复制到下周」按钮", (await evalJS(`return !!([...document.querySelectorAll("button")].find((b) => b.textContent.includes("复制到下周")));`)) === true);
    ok("有「导出日历」下载链", (await evalJS(`return !!document.querySelector('a[href*="calendar.ics"]');`)) === true);
    const icsHref = await evalJS(`return document.querySelector('a[href*="calendar.ics"]')?.getAttribute("href") ?? "";`);
    ok("导出链接带上当前范围", /from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/.test(icsHref), icsHref);
    await goto("/settings", "设置");
    ok("AI 卡里有「自动获取」按钮", (await evalJS(`return !!([...document.querySelectorAll("button")].find((b) => b.textContent.includes("自动获取")));`)) === true);
    ok("模型名输入框挂了 datalist", (await evalJS(`return !!document.querySelector('input[list="ai-model-options"]');`)) === true);

    console.log("\n[18] 老师页：登记一位老师，课表能按老师筛");
    await goto("/teachers", "老师");
    ok("侧栏「老师」入口高亮", (await evalJS(`return !!document.querySelector('.sidebar .nav-item.active[href="/teachers"]');`)) === true);
    ok("页头有「添加老师」按钮", (await evalJS(`return !!([...document.querySelectorAll("button")].find((b) => b.textContent.includes("添加老师")));`)) === true);
    await evalJS(clickText("添加老师"));
    ok("点开就是登记表", (await waitFor("document.querySelector('.modal')", 8000)) === true);
    await evalJS(typeIn(".modal input.input", "测试老师"));
    const subj = `return (() => {
      const el = [...document.querySelectorAll('.modal input.input')][2];
      if (!el) throw new Error("没有科目输入框");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "数学");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })();`;
    await evalJS(subj);
    await evalJS(clickText("保存"));
    await sleep(1500);
    const tlist = await getJson("/api/teachers");
    ok("老师存进去了", tlist.some((x) => x.name === "测试老师"), JSON.stringify(tlist.map((x) => x.name)));
    ok("卡片上有本周课量", (await evalJS(bodyText)).includes("本周"), "");
    await goto("/calendar", "课表");
    ok("课表页有老师筛选", (await evalJS(`return document.querySelectorAll(".chip-list .chip").length >= 1;`)) === true);
    await evalJS(`return (() => {
      const c = [...document.querySelectorAll(".chip-list .chip")].find((x) => x.textContent.includes("测试老师"));
      if (!c) throw new Error("筛选条里没有这位老师");
      c.click();
      return true;
    })();`);
    await sleep(600);
    ok("点名字后变成选中态", (await evalJS(`return !!document.querySelector(".chip-list .chip.on");`)) === true);
    await goto(`/students/${stu.id}`, "小夏");
    ok("学生详情多了「课表」页签", (await evalJS(`return !!([...document.querySelectorAll(".tab")].find((x) => x.textContent.includes("课表")));`)) === true);
    await evalJS(clickText("课表", ".tab"));
    await sleep(1200);
    const ttTxt = await evalJS(bodyText);
    ok("课表页签里有内容（余额或空态）", ttTxt.includes("课时") || ttTxt.includes("还没有"), "");
    console.log("\n[19] 首页大卡与本周负载");
    await goto("/", "今天");
    ok("首页有一块问候大卡", (await evalJS(`return !!document.querySelector(".hero-title");`)) === true);
    ok(
      "大卡上有三个快捷动作",
      Number(await evalJS(`return document.querySelectorAll(".hero-actions .btn").length;`)) >= 3,
    );
    ok(
      "本周负载是 7 根柱子（一到周日）",
      Number(await evalJS(`return document.querySelectorAll(".week-bars .wb").length;`)) === 7,
    );
    ok("今天那一根被点亮", (await evalJS(`return !!document.querySelector(".week-bars .wb.on");`)) === true);
    ok(
      "柱子上写着几节课",
      String(await evalJS(`return document.querySelector(".hero-side-head b")?.innerText ?? "";`)).includes("节"),
    );

    console.log("\n[20] 记一笔写一半刷新也不丢（本机草稿）");
    let dash = await getJson("/api/dashboard");
    let todo = (dash.needRecord ?? [])[0] ?? null;
    if (!todo) {
      const cid = (await getJson("/api/courses"))[0]?.id;
      const d = new Date(Date.now() - 26 * 3600 * 1000);
      const pad = (n) => String(n).padStart(2, "0");
      const startAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 10:00`;
      await fetchJson("/api/lessons", {
        method: "POST",
        body: JSON.stringify({ courseId: cid, startAt, minutes: 90, studentIds: [stu.id] }),
      });
      dash = await getJson("/api/dashboard");
      todo = (dash.needRecord ?? [])[0] ?? null;
    }
    if (!todo) {
      ok("有一节待记录的课可以试草稿", false, "建了课也没出现在待记录里");
    } else {
      await goto(`/lessons/${todo.id}`, "");
      const draftText = `草稿恢复测试 ${Date.now() % 10000}`;
      await evalJS(`return (() => {
        const el = document.querySelector(".input.grow");
        if (!el) throw new Error("没有一句话输入框");
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(draftText)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })();`);
      await sleep(700);
      ok(
        "草稿写进了本机存储",
        String(await evalJS(`return localStorage.getItem("as-draft-lesson-${todo.id}") ?? "";`)).includes(draftText),
      );
      await goto(`/lessons/${todo.id}`, "");
      await sleep(1200);
      ok(
        "刷新后自动恢复",
        String(await evalJS(`return document.querySelector(".input.grow")?.value ?? "";`)).includes(draftText),
      );
      await evalJS(`return (() => { localStorage.removeItem("as-draft-lesson-${todo.id}"); return true; })();`);
    }

    console.log("\n[21] 顶栏「新建」菜单与设置页数据体检");
    await goto("/", "");
    await sleep(500);
    ok(
      "顶栏有「新建」按钮",
      Boolean(await evalJS(`return !!document.querySelector(".topbar-new-btn");`)),
    );
    await evalJS(`return (() => { document.querySelector(".topbar-new-btn").click(); return true; })();`);
    await sleep(350);
    const menuTexts = String(
      await evalJS(
        `return Array.from(document.querySelectorAll(".topbar-new .menu .menu-item")).map((e) => e.textContent.trim()).join("|");`,
      ),
    );
    ok("菜单里有四个快捷动作", menuTexts.split("|").filter(Boolean).length >= 4, menuTexts);
    ok(
      "菜单能跳到排课与收款",
      menuTexts.includes("排一节课") && menuTexts.includes("收一笔钱"),
      menuTexts,
    );
    await goto("/settings", "");
    await sleep(1500);
    const diagRows = Number(
      await evalJS(`return document.querySelectorAll(".diag-list .diag-row").length;`),
    );
    ok("设置页有数据体检卡", diagRows === 5, `diag-row = ${diagRows}`);

    console.log("\n[22] 窄窗口适配（375 / 768）");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 375,
      height: 812,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await goto("/calendar", "");
    await sleep(1400);
    const phone = await evalJS(`return (() => {
      const tabbar = document.querySelector(".tabbar");
      const nw = document.querySelector(".topbar-new");
      const grid = document.querySelector(".week-grid");
      const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0;
      return {
        tabbar: tabbar ? getComputedStyle(tabbar).display !== "none" : false,
        newHidden: nw ? getComputedStyle(nw).display === "none" : true,
        cols: cols,
      };
    })();`);
    ok("375 宽时有底部导航", Boolean(phone && phone.tabbar), JSON.stringify(phone));
    ok("375 宽时顶栏「新建」收起来", Boolean(phone && phone.newHidden), JSON.stringify(phone));
    ok("375 宽时课表一列", Boolean(phone && phone.cols === 1), JSON.stringify(phone));

    await send("Emulation.setDeviceMetricsOverride", {
      width: 768,
      height: 1024,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await goto("/calendar", "");
    await sleep(1200);
    const pad = await evalJS(`return (() => {
      const grid = document.querySelector(".week-grid");
      return grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0;
    })();`);
    ok("768 宽时课表两列", Number(pad) === 2, `cols = ${pad}`);

    await goto("/records", "");
    await sleep(1400);
    const wide = await evalJS(`return (() => {
      const t = document.querySelector(".table.wide");
      return t ? Math.round(t.getBoundingClientRect().width) : 0;
    })();`);
    ok("768 宽时上课记录表横向滚动而不是挤成竖排", Number(wide) >= 880, `table width = ${wide}`);

    await send("Emulation.clearDeviceMetricsOverride");
    await sleep(400);

    console.log("\n[23] 控制台错误");
    const real = errors.filter((e) => e && !/favicon|Failed to load resource: the server responded with a status of 404/i.test(e));
    ok("页面没有脚本报错", real.length === 0, real.slice(0, 3).join(" | "));
  } finally {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    edge.kill();
    await sleep(500);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

async function goToAndSearch() {
  await goto("/", "今天");
  await evalJS(`return (() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    return true;
  })();`);
  await waitFor(`!!document.querySelector(".palette")`);
  await evalJS(typeIn(".palette-input", "小夏"));
  await sleep(900);
}

main().catch((e) => {
  console.error("UI 检查中断：", e.message);
  process.exit(1);
});
