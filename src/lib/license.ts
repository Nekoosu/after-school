// 授权（CDK）与试用：全部离线完成，不需要任何服务器。
//
// 约定（和 scripts/make-cdk.mjs、launcher/Launcher.cs 三方一致）：
//   * 机器码 = 桌面启动器算好，通过环境变量 AS_MACHINE 传进来（16 位十六进制）。
//     没有这个环境变量（比如有人用浏览器直连服务），一律按「未授权」处理。
//   * CDK 形如  AS1.<payload>.<sig>，payload = "v1|机器码1[,机器码2]|有效天数(0=永久)|签发日(YYYY-MM-DD)"，
//     sig = RSA-SHA256(payload) 的 base64url。私钥只在你电脑的 .keys/ 里，绝不能进安装包。
//   * data/license.json：激活成功后写入 { cdk, machine, machines, exp, issuedAt, sig }，sig 同上。
//   * data/trial.json：首次使用时写入 { start, seen, sig }，sig = HMAC(密钥+机器码)，
//     防止把它拷到别的机器或手改时间；seen 每小时最多推进一次，发现系统时间倒退就按 seen 算。
//
// 失败永远返回结构化结果，不抛异常（照 src/lib/http.ts 的老规矩）。

import { createHmac, verify as cryptoVerify, constants } from "crypto";
import fs from "fs";
import path from "path";

// 公钥：只用来「验签」，泄漏也造不出新码；私钥在 .keys/cdk-private.pem（不进仓库）
const PUBLIC_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtlUdYmskk2rQq9wOozX5
qrHydpCP7y4nCUFBj+welP0YQ4ZSLGb7s2kjq1xBKhp8jP4QSoSZe0r8amGxZnjk
D1HL8u5/jBZJqxzwFtjXh1ExLwxa1m9XrRsPcD8NzfH1cbuCxpqOZsdT5GBj8Uoc
eiB8HtZ9+pacBDyzyMRJQef8HZGiKMwpvC4MX8oZ1yHYNcZT/MY57NR2y/lGQ01c
Av8YOITl6d/l+sWftJL9nWwsyaHwWQjnAVO6XeYelfbppCAr3ecjm2lUdOLwDBD0
FLxJ27wDQDBSlpti2Mt4bqEuJM5qTIoQmJMYHy9puFbF+tb40Fhuzhlfh9YzLtCr
IQIDAQAB
-----END PUBLIC KEY-----`;

export const TRIAL_DAYS = 7;
const DATA_DIR = path.join(process.cwd(), "data");
const LICENSE_FILE = path.join(DATA_DIR, "license.json");
const TRIAL_FILE = path.join(DATA_DIR, "trial.json");
// HMAC 密钥：混淆用，不是安全边界（安全边界是机器码绑定 + RSA 验签）
const TRIAL_SECRET = "after-school-trial-v1";

export type LicenseMode = "licensed" | "trial" | "locked";

export interface LicenseState {
  mode: LicenseMode;
  /** trial 模式下还剩几天（向上取整，最小 0）；licensed = null；locked = 0 */
  daysLeft: number | null;
  /** 机器码（壳里算的，给人看/发给作者用的那 16 位） */
  machine: string;
  /** 已激活时的到期日（YYYY-MM-DD），永久 = null */
  exp: string | null;
  /** 激活过的机器数上限（CDK 里带的，一般 2） */
  seats: number | null;
}

function machineOf(): string {
  const m = String(process.env.AS_MACHINE || "").trim().toLowerCase();
  return /^[0-9a-f]{16}$/.test(m) ? m : "";
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function hmacOf(text: string, machine: string): string {
  return b64url(createHmac("sha256", TRIAL_SECRET + "|" + machine).update(text).digest());
}

/** 验一段 CDK：返回 { machines, expDays, issuedAt } 或 null（格式/签名/机器码不对） */
export function verifyCdk(
  cdk: string,
  machine: string
): { machines: string[]; expDays: number; issuedAt: string } | null {
  const m = machine || machineOf();
  if (!m) return null;
  const parts = String(cdk || "").trim().split(".");
  if (parts.length !== 3 || parts[0] !== "AS1") return null;
  let payload: string;
  try {
    payload = fromB64url(parts[1]).toString("utf8");
  } catch {
    return null;
  }
  const seg = payload.split("|");
  if (seg.length !== 4 || seg[0] !== "v1") return null;
  const ok = cryptoVerify(
    "RSA-SHA256",
    Buffer.from(payload, "utf8"),
    { key: PUBLIC_PEM, padding: constants.RSA_PKCS1_PADDING },
    fromB64url(parts[2])
  );
  if (!ok) return null;
  const machines = seg[1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const expDays = Number(seg[2]);
  if (!machines.includes(m) || !Number.isFinite(expDays) || expDays < 0) return null;
  return { machines, expDays, issuedAt: seg[3] };
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  return d;
}
function dayStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface TrialRec {
  start: string;
  seen: string;
  sig: string;
}

/** 读/推进试用期记录；seen 每小时最多推进一次，时间倒退按 seen 算。文件坏了当从头开始。 */
function touchTrial(machine: string): { start: number; seen: number } {
  const now = Date.now();
  let rec: TrialRec | null = null;
  try {
    const raw = JSON.parse(fs.readFileSync(TRIAL_FILE, "utf8")) as TrialRec;
    if (raw && typeof raw.start === "string" && raw.sig === hmacOf(raw.start + "|" + raw.seen, machine)) {
      rec = raw;
    }
  } catch {
    /* 没有或坏了：从头开始 */
  }
  const startMs = rec ? Date.parse(rec.start) : now;
  let seenMs = rec ? Date.parse(rec.seen) : now;
  if (!Number.isFinite(startMs) || !Number.isFinite(seenMs)) {
    // 记录损坏：重置（试用重新计 7 天，仅当文件本来就坏时才可能发生）
    fs.writeFileSync(
      TRIAL_FILE,
      JSON.stringify({ start: new Date(now).toISOString(), seen: new Date(now).toISOString(), sig: hmacOf(new Date(now).toISOString() + "|" + new Date(now).toISOString(), machine) } satisfies TrialRec),
      "utf8"
    );
    return { start: now, seen: now };
  }
  if (now < seenMs - 30 * 60 * 1000) {
    // 系统时间被往回调了：不奖励，按 seen 继续
    seenMs = now > seenMs ? seenMs : seenMs;
  } else if (now - seenMs > 60 * 60 * 1000) {
    seenMs = now;
  }
  const next: TrialRec = { start: new Date(startMs).toISOString(), seen: new Date(seenMs).toISOString(), sig: "" };
  next.sig = hmacOf(next.start + "|" + next.seen, machine);
  try {
    fs.writeFileSync(TRIAL_FILE, JSON.stringify(next), "utf8");
  } catch {
    /* 只读盘等：下次再写 */
  }
  return { start: startMs, seen: seenMs };
}

function readLicense(machine: string): { exp: string | null; seats: number; issuedAt: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(LICENSE_FILE, "utf8")) as { cdk: string };
    const v = verifyCdk(raw.cdk, machine);
    if (!v) return null;
    const exp = v.expDays > 0 ? dayStr(addDays(new Date(Date.parse(v.issuedAt + "T00:00:00")), v.expDays)) : null;
    if (exp && Date.parse(exp + "T23:59:59") < Date.now()) return null; // 过期 → 当未激活
    return { exp, seats: v.machines.length, issuedAt: v.issuedAt };
  } catch {
    return null;
  }
}

/** 授权状态。没有机器码（浏览器直连）= locked，不会碰任何文件。 */
export function licenseState(): LicenseState {
  const machine = machineOf();
  if (!machine) return { mode: "locked", daysLeft: 0, machine: "", exp: null, seats: null };
  const lic = readLicense(machine);
  if (lic) return { mode: "licensed", daysLeft: null, machine, exp: lic.exp, seats: lic.seats };
  const t = touchTrial(machine);
  const usedDays = Math.floor((t.seen - t.start) / 86400000);
  const daysLeft = Math.max(0, TRIAL_DAYS - usedDays);
  return { mode: daysLeft > 0 ? "trial" : "locked", daysLeft, machine, exp: null, seats: null };
}

/** 激活：验 CDK → 写 license.json。返回 { ok, state?, error? }，不抛异常。 */
export function activateWith(cdk: string): { ok: boolean; state?: LicenseState; error?: string } {
  const machine = machineOf();
  if (!machine) return { ok: false, error: "拿不到机器码（请用桌面程序里的「激活」窗口，别用浏览器）" };
  const v = verifyCdk(cdk, machine);
  if (!v) return { ok: false, error: "激活码不对：格式、签名或机器码对不上。复制时别带空格和换行。" };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LICENSE_FILE, JSON.stringify({ cdk: String(cdk).trim(), machine }), "utf8");
  } catch (e) {
    return { ok: false, error: "写不进激活文件（data 目录被占用或只读）：" + String((e as Error)?.message || e) };
  }
  return { ok: true, state: licenseState() };
}
