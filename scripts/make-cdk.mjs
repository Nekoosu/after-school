// 生成激活码（CDK）：在你自己电脑上跑，产出的码发给买家。
//
// 用法（在 E:\after-school 下）：
//   & "C:\Program Files\nodejs\node.exe" scripts\make-cdk.mjs <机器码1> [机器码2]
// 例（一个码绑一台电脑）：
//   & "C:\Program Files\nodejs\node.exe" scripts\make-cdk.mjs 9c4e1a7b33d0f215
// 例（一个码绑两台电脑：空格或逗号都行）：
//   & "C:\Program Files\nodejs\node.exe" scripts\make-cdk.mjs 9c4e1a7b33d0f215 a1b2c3d4e5f60718
//   & "C:\Program Files\nodejs\node.exe" scripts\make-cdk.mjs 9c4e1a7b33d0f215,a1b2c3d4e5f60718
//
// 机器码从哪来：买家第一次打开软件，激活窗口上有一行「机器码」+ 复制按钮，让他发给你。
// 可选环境变量：
//   CDK_DAYS  有效天数，0 = 永久（默认 0，现在卖断制；以后做续费就给 365）
//
// 码的样子：AS1.<payload>.<sig>，payload = "v1|机器码1[,机器码2]|天数|签发日"，
// sig = RSA-SHA256(payload) base64url。私钥永远不离开 .keys/。
//
// 注意：本脚本只能由作者运行；它在 .gitignore 保护之外被引用的私钥不会进仓库/安装包。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const KEY = path.join(__dirname, "..", ".keys", "cdk-private.pem");
if (!fs.existsSync(KEY)) {
  console.error("找不到 .keys\\cdk-private.pem —— 这是签发激活码的私钥，只该在作者电脑上。");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 1 || !args.join("").trim()) {
  console.error('用法：node scripts\\make-cdk.mjs <机器码1> [机器码2]   （机器码 = 16 位十六进制，最多两个）');
  process.exit(1);
}
// 空格、逗号、分号、顿号都当分隔符——买家发来的两个码常是换行或空格隔开的
const raw = args.join(" ").split(/[\s,;，、]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
const bad = raw.filter((s) => !/^[0-9a-f]{16}$/.test(s));
if (bad.length > 0) {
  console.error("这些不像机器码（要 16 位十六进制，比如 9c4e1a7b33d0f215）：" + bad.join(" "));
  console.error("机器码在软件里的「激活」窗口上，旁边有「复制」按钮。");
  process.exit(1);
}
// 去重：同一个码写两遍，别当成两台设备
const machines = raw.filter((s, i) => raw.indexOf(s) === i);
if (machines.length > 2) {
  console.error("一个激活码最多绑两台设备，你给了 " + machines.length + " 个：" + machines.join(" "));
  console.error("要发给三个人的话，分开签三个码。");
  process.exit(1);
}

const days = Math.max(0, Number(process.env.CDK_DAYS || 0) || 0);
const issuedAt = new Date().toISOString().slice(0, 10);
const payload = "v1|" + machines.join(",") + "|" + days + "|" + issuedAt;

const signer = crypto.createSign("RSA-SHA256");
signer.update(payload, "utf8");
const sig = signer.sign(fs.readFileSync(KEY, "utf8"));
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const cdk = "AS1." + b64url(Buffer.from(payload, "utf8")) + "." + b64url(sig);

console.log("");
console.log("激活码（整行发给买家）：");
console.log("");
console.log(cdk);
console.log("");
console.log("绑定设备：" + machines.length + " 台");
for (let i = 0; i < machines.length; i++) {
  console.log("  " + (i + 1) + ". " + machines[i]);
}
console.log("有效期：" + (days > 0 ? days + " 天（自 " + issuedAt + " 起）" : "永久（买断）"));
console.log("签发日：" + issuedAt);
if (machines.length < 2) {
  console.log("");
  console.log("（想一码绑两台，就把第二个机器码也带上：node scripts\\make-cdk.mjs 码1 码2）");
}
