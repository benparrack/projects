// Darts — shared board geometry, scoring, aim wobble and checkout planner. Loaded by the browser
// as a plain <script> (window.DartsSim) and by the server with require() (server/games/darts.js),
// so the reticle a player watches wobble and the point the server scores are computed by the
// very same function.
//
// Units are millimetres on a regulation board, origin at the bullseye, +x right, +y DOWN (screen
// space), 20 at the top. A throw lands at aim + wobble(seed, t) + jitter(seed): `seed` is a fresh
// per-dart number the server hands out, `t` is how long (ms) the thrower held before releasing.
// The wobble starts wide, settles to its steadiest around 1.2-2.2s, then grows again (arm fatigue)
// — so timing the release is the skill, not just pointing.

(function (root) {
  'use strict';

  // Regulation dimensions (mm, radii).
  const R = {
    innerBull: 6.35,
    outerBull: 15.9,
    trebleIn: 99,
    trebleOut: 107,
    doubleIn: 162,
    doubleOut: 170,
    frame: 225, // outer edge of the number ring / surround
  };
  // Segment numbers clockwise from the top.
  const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const SEG_DEG = 18;

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

  // Clockwise angle from straight up, in degrees [0, 360).
  function angleOf(x, y) {
    const a = (Math.atan2(x, -y) * 180) / Math.PI;
    return (a + 360) % 360;
  }

  const segIndexAt = (x, y) => Math.floor(((angleOf(x, y) + SEG_DEG / 2) % 360) / SEG_DEG);

  // Score of a point: { ring, num, mult, value, label }. ring: 'DB','SB','T','D','S','MISS'.
  function scoreAt(x, y) {
    const r = Math.hypot(x, y);
    if (r <= R.innerBull) return { ring: 'DB', num: 25, mult: 2, value: 50, label: 'BULL' };
    if (r <= R.outerBull) return { ring: 'SB', num: 25, mult: 1, value: 25, label: '25' };
    if (r > R.doubleOut) return { ring: 'MISS', num: 0, mult: 0, value: 0, label: 'MISS' };
    const num = ORDER[segIndexAt(x, y)];
    if (r >= R.doubleIn) return { ring: 'D', num, mult: 2, value: num * 2, label: `D${num}` };
    if (r >= R.trebleIn && r <= R.trebleOut) return { ring: 'T', num, mult: 3, value: num * 3, label: `T${num}` };
    return { ring: 'S', num, mult: 1, value: num, label: `${num}` };
  }

  // Centre of a named target, for bots and hints: 'T20', 'D16', 'S5' (big outer single), 'SB', 'DB'.
  function targetPoint(label) {
    if (label === 'DB' || label === 'BULL') return { x: 0, y: 0 };
    if (label === 'SB' || label === '25') return { x: 0, y: -11 };
    const ring = label[0];
    const num = Number(label.slice(1));
    const idx = ORDER.indexOf(num);
    const rad = ring === 'T' ? (R.trebleIn + R.trebleOut) / 2 : ring === 'D' ? (R.doubleIn + R.doubleOut) / 2 : 135;
    const a = (idx * SEG_DEG * Math.PI) / 180;
    return { x: rad * Math.sin(a), y: -rad * Math.cos(a) };
  }

  // --- aim wobble ----------------------------------------------------------------------------
  const STEADY_FROM = 1.2; // s — roughly where the wobble is at its smallest...
  const FATIGUE_FROM = 2.2; // ...until here, after which it grows again
  const MAX_HOLD_MS = 8000; // the arm gives out: holding longer throws anyway

  // Wobble radius scale (mm) after holding for s seconds.
  function wobbleAmp(s) {
    const settle = 6 + 26 * Math.exp(-s / 0.42);
    const fatigue = Math.min(36, Math.max(0, s - FATIGUE_FROM) * 10);
    return settle + fatigue;
  }

  // Per-dart oscillator set, cached by seed (the client asks every frame).
  const oscCache = new Map();
  function oscillators(seed) {
    let o = oscCache.get(seed);
    if (o) return o;
    const rand = mulberry32(seed ^ 0x9e3779b9);
    const mk = (lo, hi, w) => ({ f: lo + rand() * (hi - lo), p: rand() * Math.PI * 2, w });
    o = {
      x: [mk(0.5, 0.85, 0.62), mk(1.1, 1.6, 0.28), mk(2.3, 3.1, 0.1)],
      y: [mk(0.45, 0.8, 0.62), mk(1.2, 1.7, 0.28), mk(2.1, 2.9, 0.1)],
    };
    if (oscCache.size > 64) oscCache.clear();
    oscCache.set(seed, o);
    return o;
  }

  function wobble(seed, tMs) {
    const s = Math.max(0, Math.min(MAX_HOLD_MS, tMs)) / 1000;
    const o = oscillators(seed);
    const amp = wobbleAmp(s);
    const sum = (list) => list.reduce((acc, k) => acc + k.w * Math.sin(2 * Math.PI * k.f * s + k.p), 0);
    return { dx: amp * sum(o.x), dy: amp * sum(o.y), amp };
  }

  // Small release jitter (the only part of a throw the thrower can't see coming).
  function jitter(seed) {
    const rand = mulberry32(seed ^ 0x51f15e);
    return { dx: gauss(rand) * 2.2, dy: gauss(rand) * 2.2 };
  }

  // Where a human throw lands.
  function landing(aimX, aimY, seed, tMs) {
    const w = wobble(seed, tMs);
    const j = jitter(seed);
    return { x: aimX + w.dx + j.dx, y: aimY + w.dy + j.dy };
  }

  // --- checkout planning -------------------------------------------------------------------
  const TARGETS = [];
  for (let n = 20; n >= 1; n--) TARGETS.push({ label: `T${n}`, value: n * 3, dbl: false });
  for (let n = 20; n >= 1; n--) TARGETS.push({ label: `S${n}`, value: n, dbl: false });
  for (let n = 20; n >= 1; n--) TARGETS.push({ label: `D${n}`, value: n * 2, dbl: true });
  TARGETS.push({ label: 'SB', value: 25, dbl: false }, { label: 'DB', value: 50, dbl: true });
  // Doubles players like to finish on (halve cleanly on a miss into the single).
  const FAV = ['D20', 'D16', 'D8', 'D18', 'D12', 'D10', 'D4', 'D6', 'D14', 'D2', 'D19', 'D17', 'D15', 'D13', 'D11', 'D9', 'D7', 'D5', 'D3', 'D1', 'DB'];
  const favRank = (label) => { const i = FAV.indexOf(label); return i < 0 ? FAV.length : i; };
  const setupCost = (t) => (t.label[0] === 'T' ? 0 : t.label === 'SB' ? 6 : t.label === 'DB' ? 8 : t.label[0] === 'D' ? 4 : 2);

  const planCache = new Map();
  // Fewest-dart finish for `rem` with at most `darts` darts: array of target labels, or null.
  function planCheckout(rem, darts, doubleOut = true) {
    const key = `${rem}|${darts}|${doubleOut ? 1 : 0}`;
    if (planCache.has(key)) return planCache.get(key);
    let best = null;
    let bestCost = Infinity;
    const finishOk = (t) => !doubleOut || t.dbl;
    // 1 dart
    for (const t of TARGETS) {
      if (t.value === rem && finishOk(t)) {
        const cost = favRank(t.label) + (t.label[0] === 'T' ? 1 : 0);
        if (cost < bestCost) { bestCost = cost; best = [t.label]; }
      }
    }
    if (!best && darts >= 2) {
      for (const a of TARGETS) {
        const left = rem - a.value;
        if (left < (doubleOut ? 2 : 1)) continue;
        const rest = planCheckout(left, darts - 1, doubleOut);
        if (!rest) continue;
        const cost = rest.length * 1000 + favRank(rest[rest.length - 1]) * 3 + setupCost(a) + rest.slice(0, -1).reduce((c, l) => c + setupCost(TARGETS.find((t) => t.label === l)), 0);
        if (cost < bestCost) { bestCost = cost; best = [a.label, ...rest]; }
      }
    }
    planCache.set(key, best);
    return best;
  }

  // How good a remaining score is to be left on (higher is better), for set-up shots.
  function leaveScore(left, doubleOut = true) {
    if (left === 0) return doubleOut ? -1e6 : 1e6; // a finish that isn't a double is a bust
    if (left < (doubleOut ? 2 : 1)) return -1e6;
    const p1 = planCheckout(left, 1, doubleOut);
    if (p1) return 300 - favRank(p1[0]) * 4;
    if (planCheckout(left, 2, doubleOut)) return 120;
    if (planCheckout(left, 3, doubleOut)) return 40;
    return 0;
  }

  // The target a sensible player aims at with `dartsLeft` darts this turn.
  function chooseTarget01(rem, dartsLeft, doubleOut = true) {
    const plan = planCheckout(rem, dartsLeft, doubleOut);
    if (plan) return plan[0];
    if (rem > 230) return 'T20';
    let best = 'T20';
    let bestScore = -Infinity;
    for (const t of TARGETS) {
      if (t.label[0] === 'D' && t.label !== 'DB') continue;
      const left = rem - t.value;
      if (left < 0) continue;
      const s = leaveScore(left, doubleOut) * 1000 + t.value;
      if (s > bestScore) { bestScore = s; best = t.label; }
    }
    return best;
  }

  // Cricket: numbers 15-20 and bull, three marks to close.
  const CRICKET_NUMS = [20, 19, 18, 17, 16, 15, 25];

  function chooseTargetCricket(me, opp, careful) {
    // me/opp: { marks: {20:n,...,25:n}, points }
    const closed = (p, n) => p.marks[n] >= 3;
    const mine = CRICKET_NUMS.filter((n) => !closed(me, n));
    const scoreable = CRICKET_NUMS.filter((n) => closed(me, n) && !closed(opp, n));
    if (careful && scoreable.length && me.points <= opp.points && mine.length) {
      // Behind (or level): pile points on a number they can't score on yet.
      const n = scoreable[0];
      return n === 25 ? 'DB' : `T${n}`;
    }
    // Otherwise close: prefer numbers the opponent can already score on, then the highest.
    const urgent = careful ? mine.filter((n) => closed(opp, n)) : [];
    const n = (urgent.length ? urgent : mine)[0];
    if (n == null) return scoreable.length ? (scoreable[0] === 25 ? 'DB' : `T${scoreable[0]}`) : 'T20';
    return n === 25 ? 'DB' : `T${n}`;
  }

  // Bot scatter (mm, per-axis sigma) by difficulty.
  const BOT_SIGMA = { easy: 30, medium: 18, hard: 11.5, expert: 7.2 }; // ~30 / 45 / 68 / 97 three-dart avg

  function botThrow(label, level, rand) {
    const p = targetPoint(label);
    const sigma = BOT_SIGMA[level] || BOT_SIGMA.hard;
    return { x: p.x + gauss(rand) * sigma, y: p.y + gauss(rand) * sigma };
  }

  const api = {
    R, ORDER, SEG_DEG, CRICKET_NUMS, STEADY_FROM, FATIGUE_FROM, MAX_HOLD_MS, BOT_SIGMA,
    mulberry32, angleOf, scoreAt, targetPoint, wobbleAmp, wobble, jitter, landing,
    planCheckout, chooseTarget01, chooseTargetCricket, leaveScore, botThrow,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DartsSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
