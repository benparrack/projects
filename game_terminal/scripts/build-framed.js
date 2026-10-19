// One-off: builds server/games/data/framed.json (the Framed movie list) from TMDB.
// Run: TMDB_KEY=<v3 api key or v4 read token> node scripts/build-framed.js
// Picks the most-voted movies released 2000 or later, and for each keeps six text-free stills
// (no title or language on them), least-voted first so frame 1 is the hardest.
// Only image paths are stored; the site loads them from TMDB's CDN (image.tmdb.org).
'use strict';

const fs = require('fs');
const path = require('path');

const KEY = process.env.TMDB_KEY;
const PAGES = Number(process.env.PAGES || 20); // 20 movies a page
const FRAMES = 6;
if (!KEY) { console.error('Set TMDB_KEY'); process.exit(1); }

const bearer = KEY.length > 40; // v4 read tokens are long JWTs; v3 keys are 32 hex chars
async function api(p, params = {}) {
  const u = new URL(`https://api.themoviedb.org/3${p}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (!bearer) u.searchParams.set('api_key', KEY);
  const res = await fetch(u, { headers: bearer ? { Authorization: `Bearer ${KEY}` } : {} });
  if (!res.ok) throw new Error(`${res.status} ${p}`);
  return res.json();
}

(async () => {
  const movies = [];
  const seen = new Set();
  for (let page = 1; page <= PAGES; page++) {
    const d = await api('/discover/movie', {
      'primary_release_date.gte': '2000-01-01', sort_by: 'vote_count.desc', include_adult: 'false', page,
    });
    for (const m of d.results) {
      const year = Number((m.release_date || '').slice(0, 4));
      if (year < 2000) continue;
      const imgs = await api(`/movie/${m.id}/images`, { include_image_language: 'null' });
      const stills = imgs.backdrops.filter((b) => !b.iso_639_1 && b.aspect_ratio > 1.6);
      if (stills.length < FRAMES) { console.log(`skip ${m.title}: ${stills.length} stills`); continue; }
      const frames = stills.sort((a, b) => b.vote_count - a.vote_count).slice(0, FRAMES).reverse().map((b) => b.file_path);
      const title = seen.has(m.title) ? `${m.title} (${year})` : m.title; // remakes share a title
      seen.add(m.title);
      movies.push({ title, year, frames });
    }
    console.log(`page ${page}: ${movies.length} movies`);
  }
  const out = path.join(__dirname, '..', 'server', 'games', 'data', 'framed.json');
  fs.writeFileSync(out, JSON.stringify(movies) + '\n');
  console.log(`wrote ${movies.length} movies to ${out}`);
})().catch((err) => { console.error(err); process.exit(1); });
