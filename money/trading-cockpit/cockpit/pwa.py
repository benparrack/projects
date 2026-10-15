"""Phone app bits: web manifest, service worker, icons, and a PIN gate for anything not coming from this machine."""
from __future__ import annotations

import hashlib
import hmac
import struct
import zlib

from flask import Response, jsonify, redirect, request

from . import db

COOKIE = "cockpit_auth"
OPEN_PATHS = ("/login", "/manifest.json", "/icon-")

MANIFEST = {
    "name": "Trading Cockpit", "short_name": "Cockpit", "start_url": "/#today", "scope": "/",
    "display": "standalone", "background_color": "#0f1419", "theme_color": "#0f1419",
    "icons": [{"src": f"/icon-{n}.png", "sizes": f"{n}x{n}", "type": "image/png", "purpose": "any maskable"}
              for n in (192, 512)],
}

SW = """// Cache the app shell; always go to the network for data so numbers are never stale.
const V = 'cockpit-v3';
const SHELL = ['/', '/static/style.css', '/static/app.js', '/static/alerts.js', '/static/lab.js', '/static/evolve.js',
               '/static/more.js', '/static/ui.js', '/static/chart.umd.min.js', '/icon-192.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks =>
  Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/reports/') || u.pathname === '/login') return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
"""

LOGIN = """<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Cockpit login</title><style>body{font:16px system-ui;background:#0f1419;color:#e6e6e6;display:grid;place-items:center;height:100vh;margin:0}
form{background:#182029;padding:24px;border-radius:12px;display:grid;gap:12px;width:min(300px,85vw)}
input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #2a323c;background:#0f1419;color:inherit}
button{background:#2f81f7;border:0;color:#fff}.err{color:#ff7b72}</style></head><body>
<form method=post><b>Trading Cockpit</b><input name=pin type=password inputmode=numeric autocomplete=current-password placeholder="Access PIN" autofocus>
<button>Unlock</button>%s</form></body></html>"""


def _png(size: int) -> bytes:
    """A candlestick logo drawn pixel by pixel (no image libraries needed)."""
    bg, up, dn = (15, 20, 25), (63, 185, 80), (248, 81, 73)
    px = [[bg] * size for _ in range(size)]

    def rect(x0, y0, x1, y1, c):
        for y in range(int(y0 * size), int(y1 * size)):
            for x in range(int(x0 * size), int(x1 * size)):
                px[y][x] = c
    for x, (lo, o, c, hi), col in [(0.22, (0.62, 0.55, 0.40, 0.33), up), (0.42, (0.55, 0.45, 0.52, 0.66), dn),
                                     (0.62, (0.50, 0.43, 0.28, 0.20), up)]:
        rect(x + 0.065, hi, x + 0.095, lo + 0.08, col)
        rect(x, min(o, c), x + 0.16, max(o, c) + 0.12, col)
    raw = b"".join(b"\x00" + bytes(v for p in row for v in p) for row in px)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


_icons: dict = {}


def _token(pin: str) -> str:
    return hmac.new(pin.encode(), b"cockpit-session", hashlib.sha256).hexdigest()


def is_local() -> bool:
    # A reverse proxy (tailscale serve, nginx) connects from 127.0.0.1 but is NOT local; it adds these headers.
    if request.headers.get("X-Forwarded-For") or request.headers.get("Tailscale-User-Login"):
        return False
    return request.remote_addr in ("127.0.0.1", "::1")


def register(app) -> None:
    @app.before_request
    def _gate():
        if is_local() or request.path.startswith(OPEN_PATHS):
            return None
        pin = db.settings().get("access_pin") or ""
        if not pin:
            return Response("Remote access is off: set an access PIN in Settings on the computer first.", 403)
        if hmac.compare_digest(request.cookies.get(COOKIE, ""), _token(pin)):
            return None
        if request.path.startswith("/api/"):
            return jsonify({"error": "Locked: log in again"}), 401
        return redirect("/login")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        pin = db.settings().get("access_pin") or ""
        if request.method == "POST":
            if pin and hmac.compare_digest(request.form.get("pin", ""), pin):
                r = redirect("/")
                r.set_cookie(COOKIE, _token(pin), max_age=90 * 86400, httponly=True, samesite="Strict",
                             secure=request.is_secure or request.headers.get("X-Forwarded-Proto") == "https")
                return r
            return Response(LOGIN % "<span class=err>Wrong PIN</span>", 401, mimetype="text/html")
        return Response(LOGIN % "", mimetype="text/html")

    @app.get("/manifest.json")
    def manifest():
        return jsonify(MANIFEST)

    @app.get("/sw.js")
    def sw():
        return Response(SW, mimetype="text/javascript", headers={"Cache-Control": "no-cache"})

    @app.get("/icon-<int:n>.png")
    def icon(n):
        if n not in (192, 512):
            n = 192
        if n not in _icons:
            _icons[n] = _png(n)
        return Response(_icons[n], mimetype="image/png", headers={"Cache-Control": "max-age=86400"})
