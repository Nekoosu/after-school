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
