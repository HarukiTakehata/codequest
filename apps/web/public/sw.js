/* CodeQuest Service Worker：运行时资产预缓存（设计书 §5.2 / §9）。
   课程包严禁进 SW 缓存——只缓存公开的 wasm 运行时与非课程内容资源。 */
const CACHE = "codequest-runtime-v1";
const CORE = ["/", "/index.html", "/shell-applets.txt", "/java/manifest.json", "/clang/asset-receipts.json"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const urls = [...CORE];
    try {
      const [clangRes, javaRes] = await Promise.all([
        fetch("/clang/asset-receipts.json"), fetch("/java/manifest.json"),
      ]);
      if (clangRes.ok) {
        const receipts = await clangRes.json();
        for (const name of Object.keys(receipts)) urls.push(`/clang/${name}`);
      }
      if (javaRes.ok) {
        const files = await javaRes.json();
        for (const name of files) urls.push(`/java/${name}`);
      }
    } catch { /* 离线时退回核心资源 */ }
    await Promise.allSettled(urls.map(async (url) => {
      const response = await fetch(url, { cache: "reload" });
      if (response.ok) await cache.put(url, response.clone());
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  if (!/^\/(clang|java)\//.test(url.pathname) && url.pathname !== "/shell-applets.txt") return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  })());
});
