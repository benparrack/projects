// One-off: builds Framed's movie list (server/games/data/framed.json) and its frames
// (public/games/framed/frames/<dir>/1-6.webp).
// Run: TMDB_KEY=<key> [YTDLP=/path/to/yt-dlp] node scripts/build-framed.js
// Needs ffmpeg and a current yt-dlp. Re-runs skip movies that already have frames.
//
// Movies: TMDB's most-voted films released 2000 or later. Frames: real footage, taken from each
// movie's official YouTube trailer — the trailer is sampled every second, black frames, title
// cards and fades are thrown out (too dark / too flat / mostly black), near-duplicate shots are
// dropped, and six frames are picked at random from six spread-out stretches of the trailer.
// Letterboxing is cropped off. Trailers are deleted once their frames are saved.
'use strict';

const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const KEY = process.env.TMDB_KEY;
const YTDLP = process.env.YTDLP || 'yt-dlp';
const PAGES = Number(process.env.PAGES || 20); // 20 movies a page
const FRAMES = 6;
const WORKERS = Number(process.env.WORKERS || 6); // trailers processed at once
const W = 960; // saved frame width
const ROOT = path.join(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'server', 'games', 'data', 'framed.json');
const FRAME_DIR = path.join(ROOT, 'public', 'games', 'framed', 'frames');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'framed-'));
if (!KEY) { console.error('Set TMDB_KEY'); process.exit(1); }

// Frame folders are named by a hash, so a frame URL doesn't give the movie away (the TMDB id would).
const dirOf = (id) => crypto.createHash('sha256').update(`framed:${id}`).digest('hex').slice(0, 12);

const bearer = KEY.length > 40; // v4 read tokens are long JWTs; v3 keys are 32 hex chars
async function api(p, params = {}) {
  const u = new URL(`https://api.themoviedb.org/3${p}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (!bearer) u.searchParams.set('api_key', KEY);
  const res = await fetch(u, { headers: bearer ? { Authorization: `Bearer ${KEY}` } : {} });
  if (!res.ok) throw new Error(`${res.status} ${p}`);
  return res.json();
}

// Best trailer: official English YouTube trailers first, then any YouTube trailer, then teasers.
function pickTrailers(videos) {
  const yt = videos.filter((v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
  const score = (v) => (v.type === 'Trailer' ? 4 : 0) + (v.official ? 2 : 0) + (v.iso_639_1 === 'en' ? 1 : 0);
  return yt.sort((a, b) => score(b) - score(a)).map((v) => v.key);
}

const exec = promisify(execFile);
const run = async (cmd, args, opts = {}) => (await exec(cmd, args, { encoding: 'buffer', maxBuffer: 1 << 28, ...opts })).stdout;

async function download(id, key) {
  const file = path.join(TMP, `${id}-${key}.mp4`); // two movies can share a trailer
  await run(YTDLP, ['-q', '--no-warnings', '--no-playlist', '-f', 'bv*[height<=720][height>=360][ext=mp4]/bv*[height<=720][height>=360]',
    '--remux-video', 'mp4', '-o', file, `https://www.youtube.com/watch?v=${key}`], { timeout: 180000 });
  return file;
}

const TW = 64;
const TH = 36;
// One 64x36 greyscale thumbnail per second of the trailer, with simple stats for filtering.
async function sampleFrames(file, crop) {
  const raw = await run('ffmpeg', ['-v', 'error', '-i', file, '-vf', `${crop ? `${crop},` : ''}fps=1,scale=${TW}:${TH},format=gray`, '-f', 'rawvideo', '-']);
  const n = Math.floor(raw.length / (TW * TH));
  const out = [];
  for (let i = 0; i < n; i++) {
    const px = raw.subarray(i * TW * TH, (i + 1) * TW * TH);
    out.push({ t: i, px, ...statsOf(px) });
  }
  return out;
}
function statsOf(px) {
  let sum = 0, sq = 0, dark = 0;
  for (const v of px) { sum += v; sq += v * v; if (v < 28) dark++; }
  const mean = sum / px.length;
  return { mean, sd: Math.sqrt(sq / px.length - mean * mean), dark: dark / px.length };
}
// Too dark, too flat (fades, text on a plain card) or mostly black (text on black) = not a scene.
const isScene = (s) => s.mean > 45 && s.sd > 28 && s.dark < 0.35;
const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length; };

function pickTimes(samples) {
  const lo = samples.length * 0.06; // skip studio logos at the start
  const hi = samples.length * 0.88; // and the title / release-date cards at the end
  const good = samples.filter((s, i) => i >= lo && i <= hi && isScene(s));
  if (good.length < FRAMES * 2) return null;
  const chosen = [];
  for (let b = 0; b < FRAMES; b++) {
    const bucket = good.slice(Math.floor((b * good.length) / FRAMES), Math.floor(((b + 1) * good.length) / FRAMES));
    const fresh = bucket.filter((s) => chosen.every((c) => diff(c.px, s.px) > 18));
    if (!fresh.length) return null;
    chosen.push(fresh[Math.floor(Math.random() * fresh.length)]);
  }
  return chosen.map((c) => c.t);
}

async function framesFor(id, keys) {
  for (const key of keys.slice(0, 5)) {
    let file;
    try {
      file = await download(id, key);
      const dur = Number(String(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])));
      const crop = await letterbox(file, dur);
      const samples = await sampleFrames(file, crop);
      const dir = path.join(FRAME_DIR, dirOf(id));
      fs.mkdirSync(dir, { recursive: true });
      // The saved frame can still land on a cut or fade the 1fps sample missed: check it, re-pick if so.
      for (let attempt = 0; attempt < 3; attempt++) {
        const times = pickTimes(samples);
        if (!times) break;
        let ok = true;
        for (const [i, t] of times.entries()) {
          const out = path.join(dir, `${i + 1}.webp`);
          await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', file, '-frames:v', '1',
            '-vf', `${crop ? `${crop},` : ''}scale=${W}:-2`, '-c:v', 'libwebp', '-quality', '72', out]);
          if (!isScene(statsOf(await run('ffmpeg', ['-v', 'error', '-i', out, '-vf', `scale=${TW}:${TH},format=gray`, '-f', 'rawvideo', '-'])))) { ok = false; break; }
        }
        if (ok) return true;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.log(`  trailer ${key}: ${String(err.message).split('\n')[0].slice(0, 120)}`);
    } finally {
      if (file) fs.rmSync(file, { force: true });
    }
  }
  return false;
}

// Letterbox bars, measured over the middle of the trailer (cropdetect logs to stderr).
async function letterbox(file, dur) {
  const r = await exec('ffmpeg', ['-hide_banner', '-ss', String(Math.floor(dur * 0.3)), '-i', file, '-vf', 'cropdetect=24:2:0', '-frames:v', '240', '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  const all = [...String(r.stderr).matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  if (!all.length) return null;
  const [, w, h, x, y] = all[all.length - 1];
  return `crop=${w}:${h}:${x}:${y}`;
}

(async () => {
  const list = [];
  for (let page = 1; page <= PAGES; page++) {
    const d = await api('/discover/movie', {
      'primary_release_date.gte': '2000-01-01', sort_by: 'vote_count.desc', include_adult: 'false', page,
    });
    list.push(...d.results.filter((m) => Number((m.release_date || '').slice(0, 4)) >= 2000));
  }
  const ok = new Array(list.length).fill(false);
  let next = 0;
  let doneCount = 0;
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (next < list.length) {
      const i = next++;
      const m = list[i];
      if (fs.existsSync(path.join(FRAME_DIR, dirOf(m.id), `${FRAMES}.webp`))) { ok[i] = true; continue; }
      try {
        const keys = pickTrailers((await api(`/movie/${m.id}/videos`)).results);
        ok[i] = keys.length > 0 && await framesFor(m.id, keys);
      } catch (err) { console.log(`  ${m.title}: ${err.message}`); }
      console.log(`${++doneCount}/${list.length} ${ok[i] ? 'ok  ' : 'SKIP'} ${m.title}`);
    }
  }));
  const movies = [];
  const seen = new Set();
  list.forEach((m, i) => {
    if (!ok[i]) return;
    const year = Number(m.release_date.slice(0, 4));
    const title = seen.has(m.title) ? `${m.title} (${year})` : m.title; // remakes share a title
    seen.add(m.title);
    movies.push({ id: m.id, dir: dirOf(m.id), title, year });
  });
  fs.writeFileSync(OUT_JSON, JSON.stringify(movies) + '\n');
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`wrote ${movies.length} movies to ${OUT_JSON}`);
})().catch((err) => { console.error(err); process.exit(1); });
