// Archery — shared target geometry, scoring, bow sway, wind drift and bot shooting. Loaded by the
// browser as a plain <script> (window.ArcherySim) and by the server with require()
// (server/games/archery.js), so the sight a player watches sway and the point the server scores
// come from the very same functions.
//
// Units are centimetres on a 122 cm World Archery target face, origin at the centre, +x right,
// +y DOWN (screen space). Ten 6.1 cm rings (10 at the middle, 1 at the edge) plus the inner X
// ring (3.05 cm, scores 10 and counts as an X). An arrow touching a line takes the higher score.
//
// A shot lands at   aim + sway(seed, holdMs) + jitter(seed) + windDrift(wind) * gust(seed)
// `seed` is a fresh per-arrow number the server hands out (with that arrow's wind), `holdMs` is
// how long the archer held at full draw. The sway starts wide, is steadiest around 1.3-2.6 s,
// then grows again as the arm tires — so timing the release matters as well as aiming off for
// the wind. Every mph of wind pushes the arrow half a ring (3.05 cm) downwind.

(function (root) {
  'use strict';

  const FACE_R = 61;
  const RING_W = 6.1;
  const X_R = 3.05;
  const ARROW_R = 0.35; // shaft radius: touching a line counts as the higher ring
  const DIST_M = 70;
  const ENDS = 5;
  const ARROWS_PER_END = 3;
  const CM_PER_MPH = 3.05;
  const MAX_WIND = 10;
  const MAX_AIM = 150; // the sight can't leave the boss area by more than this (cm)
  const MAX_HOLD_MS = 8000; // the arm gives out: the shot goes anyway
  const STEADY_FROM = 1.3;
  const FATIGUE_FROM = 2.6;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gauss(rand) {
    const u = Math.max(1e-9, rand());
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const r2 = (v) => Math.round(v * 100) / 100;

  // Score of a point: { pts 0..10, x (bool), label 'X'|'10'..'1'|'M', ring 11=X, 10..1, 0=miss }.
  function scoreAt(x, y) {
    const d = Math.max(0, Math.hypot(x, y) - ARROW_R);
    if (d <= X_R + 1e-9) return { pts: 10, x: true, label: 'X', ring: 11 };
    for (let k = 1; k <= 10; k++) {
      if (d <= k * RING_W + 1e-9) {
        const pts = 11 - k;
        return { pts, x: false, label: String(pts), ring: pts };
      }
    }
    return { pts: 0, x: false, label: 'M', ring: 0 };
  }

  // Wind blows TOWARD `angle` (degrees clockwise from straight up on the target face) at `speed` mph.
  function windDrift(wind) {
    if (!wind) return { dx: 0, dy: 0 };
    const a = (Number(wind.angle) * Math.PI) / 180;
    const s = clamp(Number(wind.speed) || 0, 0, MAX_WIND) * CM_PER_MPH;
    return { dx: s * Math.sin(a), dy: -s * Math.cos(a) };
  }

  function randomWind(rand) {
    // Mostly a light-to-fresh breeze; the odd calm shot and the odd near-gale.
    const speed = Math.round(Math.pow(rand(), 1.15) * MAX_WIND * 10) / 10;
    return { angle: Math.floor(rand() * 360), speed };
  }

  // --- bow sway -----------------------------------------------------------------------------
  function swayAmp(s) {
    const settle = 5 + 24 * Math.exp(-s / 0.45);
    const fatigue = Math.min(34, Math.max(0, s - FATIGUE_FROM) * 10);
    return settle + fatigue;
  }

  const oscCache = new Map();
  function oscillators(seed) {
    let o = oscCache.get(seed);
    if (o) return o;
    const rand = mulberry32((seed ^ 0x2545f491) >>> 0);
    const mk = (lo, hi, w) => ({ f: lo + rand() * (hi - lo), p: rand() * Math.PI * 2, w });
    o = {
      x: [mk(0.38, 0.7, 0.6), mk(0.95, 1.45, 0.3), mk(2.0, 2.8, 0.1)],
      y: [mk(0.32, 0.62, 0.6), mk(1.0, 1.5, 0.3), mk(1.9, 2.6, 0.1)],
    };
    if (oscCache.size > 64) oscCache.clear();
    oscCache.set(seed, o);
    return o;
  }

  function sway(seed, tMs) {
    const s = clamp(Number(tMs) || 0, 0, MAX_HOLD_MS) / 1000;
    const o = oscillators(seed >>> 0);
    const amp = swayAmp(s);
    const sum = (list) => list.reduce((acc, k) => acc + k.w * Math.sin(2 * Math.PI * k.f * s + k.p), 0);
    return { dx: amp * sum(o.x), dy: amp * sum(o.y), amp };
  }

  // What the thrower can't see coming: a hair of release jitter and how hard the gust really blew.
  function release(seed) {
    const rand = mulberry32((seed ^ 0x7a3c19) >>> 0);
    return { jx: gauss(rand) * 1.1, jy: gauss(rand) * 1.1, gust: clamp(1 + gauss(rand) * 0.07, 0.8, 1.2) };
  }

  // Where a human shot lands.
  function shoot(aimX, aimY, seed, tMs, wind) {
    const ax = clamp(aimX, -MAX_AIM, MAX_AIM);
    const ay = clamp(aimY, -MAX_AIM, MAX_AIM);
    const w = sway(seed, tMs);
    const r = release(seed);
    const d = windDrift(wind);
    return { x: r2(ax + w.dx + r.jx + d.dx * r.gust), y: r2(ay + w.dy + r.jy + d.dy * r.gust) };
  }

  // --- bots -----------------------------------------------------------------------------------
  // comp: fraction of the wind drift aimed off (mean, sd); sigma: per-axis scatter (cm).
  const BOT = {
    easy: { comp: 0.3, compSd: 0.35, sigma: 12.5 },
    medium: { comp: 0.62, compSd: 0.25, sigma: 8.5 },
    hard: { comp: 0.86, compSd: 0.12, sigma: 5.8 },
    expert: { comp: 0.98, compSd: 0.05, sigma: 3.6 },
  };

  function botShot(wind, level, seed, rand) {
    const p = BOT[level] || BOT.hard;
    const d = windDrift(wind);
    const comp = p.comp + gauss(rand) * p.compSd;
    const aimX = clamp(-d.dx * comp, -MAX_AIM, MAX_AIM);
    const aimY = clamp(-d.dy * comp, -MAX_AIM, MAX_AIM);
    const r = release(seed);
    return {
      aimX: r2(aimX),
      aimY: r2(aimY),
      x: r2(aimX + d.dx * r.gust + gauss(rand) * p.sigma),
      y: r2(aimY + d.dy * r.gust + gauss(rand) * p.sigma),
    };
  }

  const api = {
    FACE_R, RING_W, X_R, ARROW_R, DIST_M, ENDS, ARROWS_PER_END, CM_PER_MPH, MAX_WIND, MAX_AIM,
    MAX_HOLD_MS, STEADY_FROM, FATIGUE_FROM, BOT,
    mulberry32, gauss, scoreAt, windDrift, randomWind, swayAmp, sway, release, shoot, botShot,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArcherySim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
