/** 浏览器端调用 API 的小封装：非 2xx 直接抛错，页面用 try/catch 显示 message */

// 在飞的请求数：顶栏那条小进度条靠它亮起来（AppShell 监听 as-busy 事件）
let busyCount = 0;
function bumpBusy(delta: number) {
  busyCount = Math.max(0, busyCount + delta);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("as-busy", { detail: busyCount }));
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  bumpBusy(1);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new Error((data as { error?: string }).error ?? `请求失败（${res.status}）`);
    }
    return data as T;
  } finally {
    bumpBusy(-1);
  }
}

export const post = <T>(url: string, body: unknown) =>
  api<T>(url, { method: "POST", body: JSON.stringify(body) });

export const patch = <T>(url: string, body: unknown) =>
  api<T>(url, { method: "PATCH", body: JSON.stringify(body) });

export const del = <T>(url: string) => api<T>(url, { method: "DELETE" });

/**
 * 下载一个「返回附件」的接口（备份 .db、导出 .csv、月报、.ics 都走它）。
 *
 * **为什么不用 `<a href>` / `window.open`**：在 WebView2 里「导航到一个附件」会让这次
 * 导航以 `ConnectionAborted` 收尾，桌面壳的 NavigationCompleted 把它当成「服务挂了」，
 * 于是当场 `NavigateToString(ErrorPage)` —— 用户看到的就是「下载完页面崩了一下」
 * （1.0.0 修）。改成先 fetch 成 blob、再用 `blob:` + `<a download>` 落地：整个过程
 * 发生在当前页里，不产生导航，壳那边的判断也就不会被误触发。
 *
 * 返回实际保存的文件名（取响应头里的，退回到 fallbackName）。
 */
export async function downloadFile(url: string, fallbackName = "下载"): Promise<string> {
  bumpBusy(1);
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      let msg = `下载失败（${res.status}）`;
      try {
        const data = JSON.parse(await res.text()) as { error?: string };
        if (data?.error) msg = data.error;
      } catch {
        /* 响应不是 JSON 就保持默认文案 */
      }
      throw new Error(msg);
    }
    const cd = res.headers.get("Content-Disposition") ?? "";
    const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const plain = /filename="?([^";]+)"?/i.exec(cd);
    let name = fallbackName;
    try {
      if (star?.[1]) name = decodeURIComponent(star[1]);
      else if (plain?.[1]) name = plain[1];
    } catch {
      /* 文件名解不出来就用兜底的 */
    }
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 5000);
    return name;
  } finally {
    bumpBusy(-1);
  }
}

/**
 * 复制文本，兼容局域网 http（clipboard API 只在 https 或 localhost 下可用）：
 * 手机上老师用 192.168.x.x 访问时也能复制分享链接。
 */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* 走下面的兜底 */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const oked = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!oked) throw new Error("复制失败，请长按链接手动复制");
}
