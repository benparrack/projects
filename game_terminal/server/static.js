const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.gb': 'application/octet-stream',
  '.gbc': 'application/octet-stream',
  '.wasm': 'application/wasm',
};

// Firebase Auth's sign-in popup and token refresh need Google origins; the Game Boy emulator
// spins up blob: workers/audio worklets. Everything else is same-origin.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.gstatic.com https://apis.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.googleusercontent.com",
  "connect-src 'self' ws: wss: blob: data: https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com",
  "frame-src https://*.firebaseapp.com https://accounts.google.com https://apis.google.com",
  "worker-src 'self' blob:",
  "media-src 'self' blob: data:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  // Required by Firebase's signInWithPopup to talk back to the opener window.
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  ...(process.env.NODE_ENV === 'production' || process.env.RENDER ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
};

// Extensionless paths are app routes (/u/name, /leaderboards, /terms, ...) handled client-side by
// public/hub.js; they all get index.html, and the app renders its own 404 for unknown routes.
const isAppRoute = (pathname) => !path.extname(pathname);

function handleStaticRequest(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400, SECURITY_HEADERS);
    res.end('Bad request');
    return;
  }
  if (pathname === '/' || isAppRoute(pathname)) pathname = '/index.html';

  const resolved = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, SECURITY_HEADERS);
    res.end('Forbidden');
    return;
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(resolved);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      // Always revalidate: the app has no build step / hashed filenames, and a deploy must reach
      // everyone immediately so client and server protocol stay in sync.
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

module.exports = { handleStaticRequest, SECURITY_HEADERS };
