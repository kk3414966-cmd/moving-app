// 離線用：App 本身的檔案先存起來，沒網路也能打開記帳。
const CACHE = 'moving-app-v29';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'calendar.js', 'parser.js', 'store.js', 'ledger.js', 'ai.js', 'files.js', 'gmail.js', 'config.js', 'availability.js', 'sitecms.js', 'quotes.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // 只快取自己的檔案和 CDN 函式庫；Firebase、Gmail、Claude 的連線不快取
  const ours = url.origin === location.origin;
  const lib = /cdnjs\.cloudflare\.com|www\.gstatic\.com\/firebasejs/.test(url.href);
  if (!ours && !lib) return;
  // 自己的檔案：有網路就拿最新版，沒網路才用存起來的；函式庫：用存起來的就好
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request);
    if (lib && hit) return hit;
    return fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
  }));
});
