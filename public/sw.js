/* The Beautiful Game service worker: app-shell caching for offline PWA launch.
   Game outcomes always come from the server (network-only for /api). */
const VERSION = 'tbg-v2';
const BASE = new URL(self.registration.scope).pathname; // '/' or '/<repo>/' on GitHub Pages
const SHELL = ['', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'].map((p) => BASE + p);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return; // never cache outcomes

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(BASE + 'index.html', copy)); return res; }).catch(() => caches.match(BASE + 'index.html')));
    return;
  }
  // Hashed build assets: cache-first. Everything else: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; }).catch(() => cached);
      return cached || network;
    })
  );
});
