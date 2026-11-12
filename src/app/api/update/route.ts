import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

const RELEASES = "https://api.github.com/repos/Nekoosu/after-school/releases/latest";

/**
 * 看看 GitHub 上有没有新版本。
 * 只读、可失败：没网、代理不通、接口限流都返回 ok:false，页面显示「—」就好，
 * 绝不能让「检查更新」这种小事把设置页搞白。
 */
export async function GET() {
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
      return Response.json(
        { ok: false, error: "仓库还没公开或还没发过版本（GitHub 返回 404）" },
        { status: 200 },
      );
    }
    if (!res.ok) {
      return Response.json({ ok: false, error: `GitHub 返回 ${res.status}` }, { status: 200 });
    }
    const data = (await res.json()) as { tag_name?: string; html_url?: string; published_at?: string };
    const latest = String(data.tag_name || "").replace(/^v/, "");
    return Response.json({
      ok: true,
      current: APP_VERSION,
      latest: latest || null,
      hasUpdate: Boolean(latest) && compare(latest, APP_VERSION) > 0,
      url: data.html_url || "https://github.com/Nekoosu/after-school/releases",
      publishedAt: data.published_at || null,
    });
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "查找超时（5 秒）" : e.message) : "查找失败";
    return Response.json({ ok: false, error: msg }, { status: 200 });
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
