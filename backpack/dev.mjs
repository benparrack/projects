// Local dev server: same /feed handler as the Worker, plus static files from public/.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { feed } from './worker.js';

const root = new URL('./public/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ics': 'text/calendar', '.webmanifest': 'application/manifest+json' };
const port = process.env.PORT || 5195;

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  let r;
  if (u.pathname === '/feed') r = await feed(u.searchParams.get('url'));
  else {
    const path = join(root, normalize(u.pathname === '/' ? '/index.html' : u.pathname));
    try { r = new Response(await readFile(path), { headers: { 'content-type': types[extname(path)] || 'application/octet-stream' } }); }
    catch { r = new Response('Not found', { status: 404 }); }
  }
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log(`Backpack on http://localhost:${port}`));
