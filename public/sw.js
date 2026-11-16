// App-shell cache so the app opens instantly and still loads with a weak or missing signal.
// Network first (short timeout), cached copy as the fallback. API and MCP requests are never cached here.
const CACHE = 'gym-shell-v1';
const SHELL = ['/', '/icon.svg', '/manifest.json'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/mcp')) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(url.pathname);
      const network = fetch(e.request).then((res) => {
        if (res.ok) cache.put(url.pathname, res.clone());
        return res;
      });
      if (!cached) return network;
      const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), 2500));
      return Promise.race([network.catch(() => cached), timeout]);
    })()
  );
});
