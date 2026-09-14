const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4757;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const RECORDINGS_DIR = path.join(DATA_DIR, 'recordings');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webm': 'audio/webm'
};

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function isValidDateKey(key) {
  return /^\d{4}-\d{2}-\d{2}$/.test(key);
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(ROOT, decodeURIComponent(rel));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean); // e.g. ['api','topic','2026-09-14']

  if (url.pathname === '/api/history' && req.method === 'GET') {
    sendJSON(res, 200, loadHistory());
    return;
  }

  if (parts[0] === 'api' && parts[1] === 'topic' && parts[2] && req.method === 'POST') {
    const date = parts[2];
    if (!isValidDateKey(date)) { sendJSON(res, 400, { error: 'bad date' }); return; }
    let topic;
    try {
      topic = JSON.parse((await readBody(req)).toString('utf8'));
    } catch (e) {
      sendJSON(res, 400, { error: 'bad json' });
      return;
    }
    const history = loadHistory();
    history[date] = Object.assign({}, history[date], { topic });
    saveHistory(history);
    sendJSON(res, 200, { ok: true });
    return;
  }

  if (parts[0] === 'api' && parts[1] === 'recording' && parts[2] && req.method === 'POST') {
    const date = parts[2];
    if (!isValidDateKey(date)) { sendJSON(res, 400, { error: 'bad date' }); return; }
    const body = await readBody(req);
    if (!body.length) { sendJSON(res, 400, { error: 'empty recording' }); return; }
    const filename = `${date}.webm`;
    fs.writeFileSync(path.join(RECORDINGS_DIR, filename), body);
    const recording = { filename, recordedAt: new Date().toISOString(), bytes: body.length };
    const history = loadHistory();
    history[date] = Object.assign({}, history[date], { recording });
    saveHistory(history);
    sendJSON(res, 200, { ok: true, recording });
    return;
  }

  if (parts[0] === 'api' && parts[1] === 'recording' && parts[2] && req.method === 'GET') {
    const date = parts[2];
    const history = loadHistory();
    const recording = history[date] && history[date].recording;
    if (!recording) { res.writeHead(404); res.end('Not found'); return; }
    fs.readFile(path.join(RECORDINGS_DIR, recording.filename), (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'audio/webm' });
      res.end(data);
    });
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    sendJSON(res, 404, { error: 'no such endpoint' });
    return;
  }

  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Daily Learning running at http://localhost:${PORT}`);
});
