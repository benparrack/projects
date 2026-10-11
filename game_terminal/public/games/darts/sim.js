// Darts — shared board geometry, scoring, the flick-throw model and checkout planner. Loaded by
// the browser as a plain <script> (window.DartsSim) and by the server with require()
// (server/games/darts.js), so the client and the authoritative server land a flick with the very
// same function.
//
// Units are millimetres on a regulation board, origin at the bullseye, +x right, +y DOWN (screen
// space), 20 at the top. A throw is a flick (see flickLanding): where you let go sets left/right,
// the flick's lean and curve push it wide, and its SPEED sets the height (too slow drops low, too
// fast flies high) — so a treble needs a consistent, practised flick.

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

  // --- the flick -----------------------------------------------------------------------------
  // A throw is a flick up at the board: { x, angle, speed, curve }.
  //   x     — board mm (left/right) where the hand let go; the canvas maps 1:1 onto the board.
  //   angle — degrees the flick leaned off straight up (+ = right): a lean sends the dart wide.
  //   speed — release speed in canvas-widths per second (screen-size independent). It sets the
  //           height: gravity drops a slow dart low, a fast one flies high (log-shaped, like a real
  //           arc: drop ~ 1/v^2).
  //   curve — signed bow of the flick's path (sagitta / chord, + = bowed right): adds side drift.
  const SPEED_BULL = 2.0; // canvas-widths/s that lands level with the bull
  const DROP_K = 260; // mm of height per e-fold of speed
  const REACH = 250; // mm of sideways error per unit tan(angle)
  const CURVE_MM = 200; // mm of drift per unit curve
  const LIMITS = { x: 300, angle: 45, speedMin: 0.2, speedMax: 8, curve: 1 };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Clamps a flick to the legal ranges (server-side trust boundary; client uses it too).
  function clampFlick(f) {
    return {
      x: clamp(f.x, -LIMITS.x, LIMITS.x),
      angle: clamp(f.angle, -LIMITS.angle, LIMITS.angle),
      speed: clamp(f.speed, LIMITS.speedMin, LIMITS.speedMax),
      curve: clamp(f.curve, -LIMITS.curve, LIMITS.curve),
    };
  }

  // Small release jitter (the only part of a throw the thrower can't control).
  function jitter(seed) {
    const rand = mulberry32(seed ^ 0x51f15e);
    return { dx: gauss(rand) * 2.5, dy: gauss(rand) * 2.5 };
  }

  // Where a flick lands (board mm). Deterministic for (flick, seed).
  function flickLanding(flick, seed) {
    const f = clampFlick(flick);
    const j = jitter(seed);
    return {
      x: f.x + Math.tan((f.angle * Math.PI) / 180) * REACH + f.curve * CURVE_MM + j.dx,
      y: -DROP_K * Math.log(f.speed / SPEED_BULL) + j.dy,
    };
  }

  // The perfect flick for a board point (bots, tests).
  const idealFlick = (x, y) => ({ x, angle: 0, speed: SPEED_BULL * Math.exp(-y / DROP_K), curve: 0 });

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

  // Bot flick error by difficulty: relative speed sigma, angle sigma (deg), curve sigma.
  const BOT_SKILL = {
    easy: { speed: 0.2, angle: 7, curve: 0.05 },
    medium: { speed: 0.1, angle: 3.4, curve: 0.03 },
    hard: { speed: 0.055, angle: 1.9, curve: 0.016 },
    expert: { speed: 0.032, angle: 1.1, curve: 0.01 },
  };

  // A bot's throw at a named target: an imperfect flick through the same landing model as a human.
  function botThrow(label, level, rand) {
    const p = targetPoint(label);
    const k = BOT_SKILL[level] || BOT_SKILL.hard;
    const ideal = idealFlick(p.x, p.y);
    const flick = {
      x: ideal.x,
      angle: gauss(rand) * k.angle,
      speed: ideal.speed * Math.exp(gauss(rand) * k.speed),
      curve: gauss(rand) * k.curve,
    };
    return { ...flickLanding(flick, (rand() * 0x100000000) >>> 0), flick };
  }

  const api = {
    R, ORDER, SEG_DEG, CRICKET_NUMS, SPEED_BULL, DROP_K, REACH, CURVE_MM, LIMITS, BOT_SKILL,
    mulberry32, angleOf, scoreAt, targetPoint, clampFlick, jitter, flickLanding, idealFlick,
    planCheckout, chooseTarget01, chooseTargetCricket, leaveScore, botThrow,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DartsSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
