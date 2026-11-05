/* 课后服务管理 —— 最小 Service Worker
   只为让浏览器认为「可安装成 App」，不做任何缓存：数据永远从本机服务实时取，
   避免手机上看到旧数据。离线时请直接用局域网地址访问。 */
const VERSION = "after-school-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", () => {
  /* 全部走网络：不加 respondWith，交给浏览器正常请求 */
});
