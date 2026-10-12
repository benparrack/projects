// Makes Game Terminal installable. Network only on purpose: every game needs the live server,
// and caching app files would serve stale code after a deploy. Offline, pages get a short notice.
'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Game Terminal</title>'
    + '<body style="background:#05080a;color:#39ff14;font:20px monospace;display:grid;place-items:center;height:100vh;margin:0;text-align:center">'
    + '<div>&gt;_ GAME TERMINAL<br><br>You are offline. Games need a connection.<br><br><button onclick="location.reload()" style="font:inherit;background:none;color:#ffb000;border:1px solid #ffb000;padding:6px 16px;cursor:pointer">RETRY</button></div>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
