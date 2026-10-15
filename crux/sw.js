// Offline cache: always try the network first (so deploys show up right away), fall back to the cache when offline.
const CACHE = 'crux-v5';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'logic.js', 'icon.svg', 'icon-192.png', 'apple-touch-icon.png', 'manifest.webmanifest'];
// cache: 'reload' skips the browser's HTTP cache (GitHub Pages sends max-age=600), so a new version never caches old files.
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
