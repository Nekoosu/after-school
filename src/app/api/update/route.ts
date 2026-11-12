import { setting } from "@/db";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

const RELEASES = "https://api.github.com/repos/Nekoosu/after-school/releases/latest";
const RELEASE_PAGE = "https://github.com/Nekoosu/after-school/releases";

type Manifest = {
  version?: string;
  tag_name?: string;
  latest?: string;
  url?: string;
  download?: string;
  notes?: string;
  publishedAt?: string;
  published_at?: string;
};

type Upd = {
  ok: boolean;
  source?: string;
  current: string;
  latest?: string | null;
  hasUpdate?: boolean;
  url?: string | null;
  notes?: string | null;
  publishedAt?: string | null;
  error?: string;
  /** 清单读不到时，退到 GitHub 再问一次；这里是两边的说法（都失败时给排错用） */
  fallbackError?: string;
};

/**
 * 查新版本，两个来源按顺序挑：
 * 1. 设置里的「检查地址」——一个公开的 JSON 清单（默认是 Gitee 的 raw 链接），
 *    不依赖 GitHub、国内能直接打开、仓库私有也能用。
 * 2. 清单没填、或者填了但读不到，就退回 GitHub 的 releases/latest
 *    （仓库改成公开之后这条路自然就通了，用户不用再改任何设置）。
 *
 * 只读、可失败：没网、清单写错、接口限流都返回 ok:false 并说明原因，
 * 绝不能让「检查更新」这种小事把设置页搞白。
 */
export async function GET() {
  const custom = String(setting("update_url", "") || "").trim();

  if (!custom) return back(await fromGithub());

  const first = await fromManifest(custom);
  if (first.ok) return back(first);

  // 清单这条路挂了：再问一次 GitHub。仓库以后改成公开，这一步就能兜住。
  const second = await fromGithub();
  if (second.ok) {
    return back({
      ...second,
      notes: null,
      fallbackError: `清单没读到（${first.error || "原因不明"}），已改用 GitHub`,
    });
  }
  return back({ ...first, fallbackError: second.error || "GitHub 也查不到" });
}

function back(o: Upd) {
  return Response.json(o, { status: 200 });
}

/** 读设置里那个清单地址。格式见仓库根目录的 update.json。 */
async function fromManifest(url: string): Promise<Upd> {
  if (!/^https?:\/\//i.test(url)) {
    return {
      ok: false,
      current: APP_VERSION,
      error: `检查地址要以 http:// 或 https:// 开头（现在是「${url}」）`,
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  let text = "";
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "after-school", Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, current: APP_VERSION, error: `检查地址返回 ${res.status}（清单可能还没传上去）` };
    }
    text = await res.text();
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "连不上（6 秒超时）" : e.message) : "连不上";
    return { ok: false, current: APP_VERSION, error: `检查地址打不开：${msg}` };
  } finally {
    clearTimeout(timer);
  }

  let data: Manifest;
  try {
    data = JSON.parse(text) as Manifest;
  } catch {
    // 地址填错时最常见的两种情况：拿到的是 HTML 页面（仓库网页），或者干脆是 404 页
    return { ok: false, current: APP_VERSION, error: "检查地址给的不是 JSON（要 raw 链接，不是网页地址）" };
  }

  const latest = String(data.version || data.tag_name || data.latest || "").replace(/^v/, "");
  if (!latest) return { ok: false, current: APP_VERSION, error: "清单里没有 version 字段" };

  const notes = typeof data.notes === "string" ? data.notes : "";
  return {
    ok: true,
    source: "清单",
    current: APP_VERSION,
    latest,
    hasUpdate: compare(latest, APP_VERSION) > 0,
    url: data.url || data.download || null,
    notes: notes || null,
    publishedAt: data.publishedAt || data.published_at || null,
  };
}

/** GitHub 的 releases/latest。仓库私有、或还没发过 release，都会是 404。 */
async function fromGithub(): Promise<Upd> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(RELEASES, {
      signal: ctrl.signal,
      headers: { Accept: "application/vnd.github+json", "User-Agent": "after-school" },
      cache: "no-store",
    });
    if (res.status === 404) {
      // 私有仓库匿名查不到，或仓库里还没发过任何 release：两种都按「查不到」处理，
      // 但把原因说清楚，别让用户以为自己断网了。
      return { ok: false, current: APP_VERSION, error: "仓库还没公开或还没发过版本（GitHub 返回 404）" };
    }
    if (!res.ok) return { ok: false, current: APP_VERSION, error: `GitHub 返回 ${res.status}` };

    const data = (await res.json()) as Manifest;
    const latest = String(data.tag_name || "").replace(/^v/, "");
    return {
      ok: true,
      source: "github",
      current: APP_VERSION,
      latest: latest || null,
      hasUpdate: Boolean(latest) && compare(latest, APP_VERSION) > 0,
      url: data.url || RELEASE_PAGE,
      notes: null,
      publishedAt: data.published_at || null,
    };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "查找超时（5 秒）" : e.message) : "查找失败";
    return { ok: false, current: APP_VERSION, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** 1.7.10 > 1.7.9，逐段比数字 */
function compare(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number(n) || 0);
  const pb = b.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
