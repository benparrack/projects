// Slope — shared track generator + ball physics. Loaded by the browser as a plain <script>
// (window.SlopeSim) and by the server with require() (server/games/slope.js runs the bots with
// it), so humans and bots ride exactly the same track under exactly the same rules.
//
// World: the ball rolls forward along +s (drawn as -Z), x is lateral, y is height. The track is a
// chain of pieces generated lazily from a seed. Each piece is a sloped strip with a centre line
// that may shift sideways (cx0 -> cx1), an optional bank (tilt), holes, and blocks (some moving).
// A 'gap' piece has no ground at all. Difficulty d in [0,1] ramps with distance and shapes widths,
// obstacle density, jump sizes and speed; the ball always speeds up a little more after that.

(function (root) {
  'use strict';

  const G = 34; // gravity
  const R = 0.5; // ball radius
  const DT = 1 / 60; // fixed physics step
  const STEER_ACCEL = 62;
  const AIR_STEER = 0.55;
  const GROUND_FRICTION = 6.5;
  const AIR_FRICTION = 0.8;
  const MAX_VX = 13;
  const FALL_DEATH = 38; // this far below the last ground touched = gone

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (u) => u * u * (3 - 2 * u);

  // 0 at the start, ~0.6 after 1000 units, 1 by ~2600 (about a minute and a half of riding).
  function difficulty(s) {
    return clamp(Math.pow(Math.max(0, s - 60) / 2600, 0.8), 0, 1);
  }
  function targetSpeed(s) {
    return 17 + 19 * difficulty(s) + Math.min(9, Math.max(0, s - 2600) / 900);
  }

  // --- Track -------------------------------------------------------------------------------

  function makeTrack(seed) {
    const T = { seed, rnd: mulberry32(seed), pieces: [], end: 0, y: 0, cx: 0, since: 0 };
    add(T, { kind: 'start', len: 100, slope: -0.1, w: 10 });
    return T;
  }

  function add(T, o) {
    // A centre-line shift has to be followable: its peak sideways rate (1.5x the average, from
    // the smoothstep) must stay well under what the ball can do at the speed it'll be going.
    if (o.cx1 != null) {
      const maxShift = (o.len / (targetSpeed(T.end) * 1.2)) * 5.5 / 1.5;
      o.cx1 = T.cx + clamp(o.cx1 - T.cx, -maxShift, maxShift);
    }
    const p = {
      kind: o.kind,
      s0: T.end,
      len: o.len,
      s1: T.end + o.len,
      y0: T.y - (o.drop || 0),
      slope: o.slope || 0,
      w: o.w || 0,
      cx0: T.cx,
      cx1: o.cx1 != null ? clamp(o.cx1, -28, 28) : T.cx,
      bank: o.bank || 0,
      obs: [],
      holes: [],
      gap: o.kind === 'gap',
    };
    T.pieces.push(p);
    T.end = p.s1;
    T.y = p.y0 + p.slope * p.len;
    T.cx = p.cx1;
    return p;
  }

  function ensure(T, s) {
    while (T.end < s + 420) genNext(T);
  }

  function genNext(T) {
    const r = T.rnd;
    const s = T.end;
    const d = difficulty(s);
    const between = (a, b) => a + r() * (b - a);
    const width = () => clamp(between(8.5, 10) - 4.6 * d, 4.2, 10);
    const downhill = () => -between(0.12, 0.2 + 0.14 * d);
    const shiftTo = (amt) => T.cx + (r() < 0.5 ? -1 : 1) * between(amt * 0.4, amt);

    // After anything scary, a short calm run-out so a landing is never straight into trouble.
    if (T.since > 0) {
      T.since = 0;
      add(T, { kind: 'plain', len: between(22, 30), slope: downhill(), w: width() + 1 });
      return;
    }

    const table = [
      ['plain', 2.5],
      ['shift', 1.2 + d],
      ['blocks', s > 140 ? 2 + 3.5 * d : 0],
      ['jump', s > 220 ? 1.3 + 1.7 * d : 0],
      ['drop', s > 170 ? 1 + d : 0],
      ['bank', s > 380 ? 0.6 + 1.6 * d : 0],
      ['holes', s > 480 ? 0.5 + 2 * d : 0],
      ['narrow', s > 700 ? 1.6 * d : 0],
      ['steps', s > 300 ? 0.8 + 0.8 * d : 0],
    ];
    let tot = 0;
    for (const [, w] of table) tot += w;
    let pick = r() * tot;
    let kind = 'plain';
    for (const [k, w] of table) { pick -= w; if (pick <= 0) { kind = k; break; } }

    if (kind === 'plain') {
      add(T, { kind, len: between(30, 55), slope: downhill(), w: width() });
    } else if (kind === 'shift') {
      add(T, { kind, len: between(30, 50), slope: downhill(), w: width(), cx1: shiftTo(5 + 7 * d) });
    } else if (kind === 'blocks') {
      const w = width() + 0.8;
      const p = add(T, { kind, len: between(40, 70), slope: downhill(), w, cx1: r() < 0.3 ? shiftTo(4) : null });
      const gapRows = clamp(15 - 5 * d, 9, 15);
      const v = targetSpeed(s) * 1.15;
      let prevC = 0; // the last opening's position — the next must be reachable from it in time
      for (let z = p.s0 + 10; z < p.s1 - 6; z += gapRows * between(0.9, 1.25)) {
        const reach = (gapRows * 0.9 / v) * 5; // lateral units a ball can cover between rows
        const lane = clamp(3.3 - 0.9 * d, 2.4, 3.3); // guaranteed free lane width
        const half = w / 2;
        if (r() < 0.45) {
          // One block somewhere — a lane is always left beside it.
          const hw = between(0.6, 1.1 + 0.8 * d);
          let xr = between(-half + hw, half - hw);
          // Never put a single block on the line through the last opening; slide it aside.
          if (Math.abs(xr - prevC) < hw + 1.5) {
            const side = prevC > 0 ? -1 : 1;
            xr = clamp(prevC + side * (hw + 1.6), -half + hw, half - hw);
            if (Math.abs(xr - prevC) < hw + 1.5) continue;
          }
          const moving = d > 0.25 && r() < 0.25 + 0.4 * d;
          p.obs.push({ s: z, xr, hw, hl: between(0.5, 0.9), h: between(1.2, 2.4), amp: moving ? Math.min(half - hw, between(1.5, 3.5)) : 0, freq: between(1.4, 2.4 + d), ph: r() * 6.28 });
        } else {
          // A wall with a single opening.
          const c = clamp(prevC + between(-reach, reach), -half + lane / 2, half - lane / 2);
          prevC = c;
          const lw = c - lane / 2 + half; // left block width
          const rw = half - (c + lane / 2); // right block width
          const hl = between(0.5, 0.9); const h = between(1.4, 2.6);
          if (lw > 0.3) p.obs.push({ s: z, xr: -half + lw / 2, hw: lw / 2, hl, h, amp: 0, freq: 0, ph: 0 });
          if (rw > 0.3) p.obs.push({ s: z, xr: half - rw / 2, hw: rw / 2, hl, h, amp: 0, freq: 0, ph: 0 });
        }
      }
    } else if (kind === 'jump') {
      // Ramp up, fly a gap, land lower. The gap is sized from the slowest plausible speed so
      // it's always makeable, and the landing strip is long enough for the fastest overshoot.
      const rampSlope = between(0.28, 0.4);
      const rampLen = between(9, 13);
      add(T, { kind: 'ramp', len: rampLen, slope: rampSlope, w: width() });
      const v = targetSpeed(s) * 0.85;
      const drop = between(3, 7 + 9 * d);
      const vy = rampSlope * v;
      const tAir = (vy + Math.sqrt(vy * vy + 2 * G * drop)) / G;
      const reach = v * tAir;
      const gapLen = clamp(between(0.45, 0.75) * reach, 6, reach * 0.8);
      add(T, { kind: 'gap', len: gapLen, slope: 0 });
      const vMax = targetSpeed(s) * 1.2;
      const vyM = rampSlope * vMax;
      const reachMax = vMax * (vyM + Math.sqrt(vyM * vyM + 2 * G * drop)) / G;
      T.y = T.pieces[T.pieces.length - 2].y0 + rampSlope * rampLen; // gap keeps launch height
      add(T, { kind: 'land', len: Math.max(30, reachMax - gapLen + 14), slope: downhill() * 0.7, w: width() + 1.5, drop, cx1: d > 0.35 && r() < 0.5 ? shiftTo(3) : null });
      T.since = 1;
    } else if (kind === 'drop') {
      add(T, { kind: 'plain', len: between(12, 20), slope: downhill(), w: width() });
      add(T, { kind: 'land', len: between(34, 50), slope: downhill(), w: width() + 1, drop: between(5, 10 + 8 * d), cx1: r() < 0.4 ? shiftTo(4) : null });
      T.since = 1;
    } else if (kind === 'bank') {
      const bank = (r() < 0.5 ? -1 : 1) * between(0.18, 0.26 + 0.24 * d);
      add(T, { kind, len: between(35, 55), slope: downhill(), w: width() + 1, bank, cx1: T.cx - Math.sign(bank) * between(2, 6) });
    } else if (kind === 'holes') {
      const w = width() + 1.5;
      const p = add(T, { kind, len: between(40, 60), slope: downhill(), w });
      const half = w / 2;
      for (let z = p.s0 + 8; z < p.s1 - 8; z += between(7, 11)) {
        const hl = between(2.5, 3.5 + 2 * d);
        const hw = between(w * 0.3, w * 0.6);
        const left = r() < 0.5;
        const x0 = left ? -half : half - hw;
        p.holes.push({ s0: z, s1: z + hl, xr0: x0, xr1: x0 + hw });
      }
    } else if (kind === 'narrow') {
      add(T, { kind, len: between(24, 40 + 20 * d), slope: downhill() * 0.8, w: between(2.8, 3.6), cx1: r() < 0.5 ? shiftTo(3) : null });
      T.since = 1;
    } else if (kind === 'steps') {
      const n = 3 + Math.floor(r() * 3);
      const w = width();
      for (let i = 0; i < n; i++) add(T, { kind: 'plain', len: between(9, 14), slope: -0.06, w, drop: i ? between(1.5, 3) : 0 });
      T.since = 1;
    }
  }

  function pieceAt(T, s) {
    const ps = T.pieces;
    let lo = 0; let hi = ps.length - 1;
    if (s < 0) return ps[0];
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ps[mid].s0 <= s) lo = mid; else hi = mid - 1;
    }
    return ps[lo];
  }

  function centerAt(p, s) {
    return p.cx0 + (p.cx1 - p.cx0) * smooth(clamp((s - p.s0) / p.len, 0, 1));
  }
  function heightAt(p, s, xr) {
    return p.y0 + p.slope * (s - p.s0) + xr * Math.sin(p.bank);
  }
  // Moving blocks swing on the race clock t (seconds), shared by everyone in the round.
  function obstacleX(p, o, t) {
    return centerAt(p, o.s) + o.xr + (o.amp ? Math.sin(t * o.freq + o.ph) * o.amp : 0);
  }

  // Ground under (s, x): { y, p } or null (gap, hole, or off the edge).
  function supportAt(T, s, x) {
    const p = pieceAt(T, s);
    if (!p || p.gap || s > p.s1) return null;
    const xr = (x - centerAt(p, s)) / Math.cos(p.bank);
    if (Math.abs(xr) > p.w / 2 + R * 0.35) return null;
    for (const h of p.holes) if (s >= h.s0 && s <= h.s1 && xr >= h.xr0 + R * 0.3 && xr <= h.xr1 - R * 0.3) return null;
    return { y: heightAt(p, s, clamp(xr, -p.w / 2, p.w / 2)), p };
  }

  // --- Ball ---------------------------------------------------------------------------------

  function newBall(T) {
    const p = T.pieces[0];
    return { s: 4, x: 0, y: heightAt(p, 4, 0) + R, vs: targetSpeed(0) * 0.6, vx: 0, vy: 0, grounded: true, alive: true, cause: null, lastGroundY: p.y0, air: 0, roll: 0 };
  }

  // Advances one fixed step. steer in [-1, 1]. Returns an event string or null
  // ('land:<impact>', 'launch', 'dead').
  function step(T, b, steer, t) {
    if (!b.alive) {
      b.vy -= G * DT; b.y += b.vy * DT; b.s += b.vs * DT * 0.98; b.x += b.vx * DT;
      return null;
    }
    ensure(T, b.s);
    let ev = null;
    const p0 = pieceAt(T, b.s);
    // Forward speed: pulled toward the target speed; downhill adds a little, uphill costs a little.
    if (b.grounded) {
      b.vs += (targetSpeed(b.s) - b.vs) * 0.9 * DT - p0.slope * G * 0.18 * DT;
      b.vx += steer * STEER_ACCEL * DT + G * Math.sin(p0.bank) * -0.55 * DT;
      b.vx *= Math.exp(-GROUND_FRICTION * DT);
    } else {
      b.vx += steer * STEER_ACCEL * AIR_STEER * DT;
      b.vx *= Math.exp(-AIR_FRICTION * DT);
    }
    b.vx = clamp(b.vx, -MAX_VX, MAX_VX);
    const prevY = b.y;
    b.s += b.vs * DT;
    b.x += b.vx * DT;
    b.roll += (b.vs * DT) / R;

    const sup = supportAt(T, b.s, b.x);
    if (b.grounded) {
      if (sup && sup.y + R >= b.y - 0.35) {
        if (sup.y + R > b.y + 0.7) { b.alive = false; b.cause = 'wall'; return 'dead'; }
        b.y = sup.y + R;
        b.vy = sup.p.slope * b.vs;
        b.lastGroundY = sup.y;
      } else {
        b.grounded = false; // off an edge, a ramp lip, or into a hole: keep the velocity we had
        b.air = 0;
        ev = 'launch';
      }
    }
    if (!b.grounded) {
      b.vy -= G * DT;
      b.y += b.vy * DT;
      b.air += DT;
      if (sup) {
        if (b.y - R <= sup.y && prevY - R >= sup.y - 0.75) {
          const impact = -b.vy;
          b.y = sup.y + R;
          b.grounded = true;
          b.vy = sup.p.slope * b.vs;
          b.lastGroundY = sup.y;
          ev = `land:${impact.toFixed(1)}`;
        } else if (b.y - R < sup.y - 0.75) {
          b.alive = false; b.cause = 'wall'; return 'dead';
        }
      }
      if (b.y < b.lastGroundY - FALL_DEATH) { b.alive = false; b.cause = 'fall'; return 'dead'; }
    }
    // Blocks on this piece and the next.
    const i0 = T.pieces.indexOf(p0);
    for (let k = i0; k <= i0 + 1 && k < T.pieces.length; k++) {
      const p = T.pieces[k];
      for (const o of p.obs) {
        if (Math.abs(b.s - o.s) > o.hl + R) continue;
        const ox = obstacleX(p, o, t);
        if (Math.abs(b.x - ox) > o.hw + R * 0.85) continue;
        const base = heightAt(p, o.s, o.xr);
        if (b.y - R < base + o.h && b.y + R > base) { b.alive = false; b.cause = 'block'; return 'dead'; }
      }
    }
    return ev;
  }

  // --- Bot steering -------------------------------------------------------------------------
  // Looks `horizon` seconds ahead, tries a fan of lateral targets and picks the nearest one whose
  // straight-line path stays on ground (or in the air over a gap) and clear of blocks.
  const BOT = {
    easy: { horizon: 0.34, lanes: 7, noise: 0.45, lag: 0.35, gain: 0.8 },
    medium: { horizon: 0.45, lanes: 9, noise: 0.28, lag: 0.18, gain: 1.0 },
    hard: { horizon: 0.58, lanes: 11, noise: 0.12, lag: 0.06, gain: 1.15 },
    expert: { horizon: 0.7, lanes: 13, noise: 0, lag: 0, gain: 1.2 },
  };

  function safeSpot(T, s, x, t) {
    const p = pieceAt(T, s);
    if (p.gap) return 1; // airborne there; judged by where we land
    const sup = supportAt(T, s, x);
    if (!sup) return 0;
    const xr = x - centerAt(p, s);
    if (Math.abs(xr) > p.w / 2 - 0.55) return 0.3;
    for (const q of [p, T.pieces[T.pieces.indexOf(p) + 1]]) {
      if (!q) continue;
      for (const o of q.obs) {
        if (Math.abs(s - o.s) > o.hl + 1.2) continue;
        if (Math.abs(x - obstacleX(q, o, t)) < o.hw + 0.9) return 0;
      }
    }
    return 1;
  }

  function botSteer(T, b, t, level, mem) {
    const L = BOT[level] || BOT.hard;
    if (mem.hold > 0) { mem.hold -= DT; return mem.steer; }
    if (L.lag && Math.random() < L.lag * 0.2) { mem.hold = 0.12; return mem.steer; }
    const H = L.horizon;
    const sH = b.s + b.vs * H;
    const pH = pieceAt(T, sH);
    const cH = pH.gap ? centerAt(pieceAt(T, pH.s1 + 1), pH.s1 + 1) : centerAt(pH, sH);
    const wH = pH.gap ? pieceAt(T, pH.s1 + 1).w : pH.w;
    let best = null;
    for (let i = 0; i < L.lanes; i++) {
      const xr = -wH / 2 + 0.7 + (i / (L.lanes - 1)) * (wH - 1.4);
      const tx = cH + xr;
      // How far along this line do we get before trouble? Later trouble beats earlier trouble,
      // so with two rows in view the bot still clears the nearer one first.
      let clear = 1; let soft = 0;
      const n = Math.ceil((b.vs * H) / 1.1); // sample every ~1 unit so no block slips between
      for (let k = 1; k <= n; k++) {
        const f = k / n;
        const ss = b.s + b.vs * H * f;
        const reachX = 8.5 * H * f; // roughly how far sideways the ball can get by then
        const xx = b.x + clamp(tx - b.x, -reachX, reachX);
        const v = safeSpot(T, ss, xx, t + H * f);
        if (v === 0) { clear = f - 1 / n; break; }
        if (v < 1) soft += 1 / n;
      }
      const cost = (1 - clear) * 100 + soft * 8 + Math.abs(tx - b.x) * 0.25 + Math.abs(xr) * 0.12;
      if (!best || cost < best.cost) best = { tx, cost };
    }
    const err = best.tx + (L.noise ? (Math.random() * 2 - 1) * L.noise * 3 : 0) - b.x;
    const steer = clamp(err * L.gain - b.vx * 0.12, -1, 1);
    mem.steer = steer;
    return steer;
  }

  const api = { G, R, DT, difficulty, targetSpeed, makeTrack, ensure, pieceAt, centerAt, heightAt, obstacleX, supportAt, newBall, step, botSteer, BOT_LEVELS: Object.keys(BOT) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SlopeSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
