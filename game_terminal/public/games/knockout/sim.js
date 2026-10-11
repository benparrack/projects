// Knockout (GamePigeon style) — shared ice physics + bot brain. Loaded by the browser as a plain
// <script> (window.KnockoutSim) and by the server with require() (server/games/knockout.js).
//
// World: a square ice floe centred on the origin, half-size `H` (it shrinks as the game goes on).
// Red's penguins start at +y (the bottom of red's screen), blue's at -y. A penguin is a disc of
// radius R; it falls in once its centre leaves the ice (|x| > H or |y| > H) and stops colliding.
//
// A round: every alive penguin gets a move { a, p } — direction a (radians, world frame) and power
// p in [0, 1] (0 = stay put). All moves launch at once; the sim slides everything with ice
// friction and equal-mass elastic-ish collisions until the floe is still, recording frames for
// playback. Moves are quantized so client previews and the server agree.

(function (root) {
  'use strict';

  const H0 = 10; // starting half-size of the floe
  const H_MIN = 4.5;
  const SHRINK_STEP = 1.25;
  const SHRINK_EVERY = 2; // rounds
  const R = 0.8; // penguin radius
  const VMAX = 16; // launch speed at full power (units / s)
  const MU = 9; // ice friction deceleration (units / s^2)
  const DAMP = 0.25; // light linear drag (1 / s)
  const WATER = 5; // drag once a penguin is in the water
  const E = 0.9; // restitution penguin-penguin
  const DT = 1 / 60;
  const FRAME_EVERY = 2; // record at 30 fps
  const FRAME_DT = DT * FRAME_EVERY;
  const MAX_T = 7;
  const MAX_ARROW = 6; // world length of a full-power arrow in the UI
  const COLORS = ['red', 'blue'];

  const q = (v, k) => Math.round(v * k) / k;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function normAngle(a) {
    let r = a % (Math.PI * 2);
    if (r > Math.PI) r -= Math.PI * 2;
    if (r <= -Math.PI) r += Math.PI * 2;
    return r;
  }

  // Validates + quantizes one move. Returns null for garbage.
  function normMove(m) {
    if (!m || typeof m !== 'object') return null;
    const a = Number(m.a);
    const p = Number(m.p);
    if (!Number.isFinite(a) || !Number.isFinite(p)) return null;
    if (Math.abs(a) > 1000) return null;
    return { a: q(normAngle(a), 1000), p: q(clamp(p, 0, 1), 100) };
  }

  function startPositions(count) {
    const n = count === 5 ? 5 : 4;
    const gap = n === 5 ? 3 : 3;
    const out = [];
    for (const side of COLORS) {
      const y = side === 'red' ? 6 : -6;
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * gap;
        out.push({ id: `${side[0]}${i}`, side, x, y, face: side === 'red' ? -Math.PI / 2 : Math.PI / 2 });
      }
    }
    return out;
  }

  const onIce = (x, y, H) => Math.abs(x) <= H && Math.abs(y) <= H;

  // Runs one round. `penguins` = alive penguins [{id, side, x, y, face}], `moves` = {id: {a, p}}.
  // Returns { ids, frames, events, outs, end } — frames[k] is a flat [x0, y0, x1, y1, ...] in `ids`
  // order; events = [{f, type:'hit', a, b, s}] ; outs = [{f, id}] ; end = [{id, x, y, face, out}].
  function simulate(penguins, moves, H, opts) {
    const record = !(opts && opts.noFrames);
    const bodies = penguins.map((p) => {
      const m = moves && moves[p.id] ? normMove(moves[p.id]) : null;
      const v = m ? m.p * VMAX : 0;
      return {
        id: p.id, side: p.side, x: p.x, y: p.y,
        vx: m ? Math.cos(m.a) * v : 0, vy: m ? Math.sin(m.a) * v : 0,
        face: m && m.p > 0 ? m.a : (typeof p.face === 'number' ? p.face : 0),
        out: false, outF: -1,
      };
    });
    const n = bodies.length;
    const frames = [];
    const events = [];
    const outs = [];
    const lastHit = new Map();
    const snap = () => {
      const f = new Array(n * 2);
      for (let i = 0; i < n; i++) { f[i * 2] = q(bodies[i].x, 100); f[i * 2 + 1] = q(bodies[i].y, 100); }
      frames.push(f);
    };
    if (record) snap();
    const maxSteps = Math.round(MAX_T / DT);
    let step = 0;
    let lastOutStep = -1;
    for (; step < maxSteps; step++) {
      let moving = false;
      for (let i = 0; i < n; i++) {
        const b = bodies[i];
        const s = Math.hypot(b.vx, b.vy);
        if (s === 0) continue;
        let ns;
        if (b.out) ns = s * (1 - WATER * DT);
        else ns = Math.max(0, s - MU * DT) * (1 - DAMP * DT);
        if (ns < 0.03) ns = 0;
        const k = ns / s;
        b.vx *= k;
        b.vy *= k;
        b.x += b.vx * DT;
        b.y += b.vy * DT;
        if (ns > 0) {
          if (!b.out) moving = true;
          b.face = Math.atan2(b.vy, b.vx);
        }
      }
      // collisions (two passes, fixed pair order = deterministic)
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < n; i++) {
          const A = bodies[i];
          if (A.out) continue;
          for (let j = i + 1; j < n; j++) {
            const B = bodies[j];
            if (B.out) continue;
            let dx = B.x - A.x;
            let dy = B.y - A.y;
            const d2 = dx * dx + dy * dy;
            if (d2 >= 4 * R * R) continue;
            let d = Math.sqrt(d2);
            if (d < 1e-9) { dx = 1; dy = 0; d = 1; } else { dx /= d; dy /= d; }
            const overlap = 2 * R - (d2 < 1e-18 ? 0 : d);
            A.x -= dx * overlap / 2; A.y -= dy * overlap / 2;
            B.x += dx * overlap / 2; B.y += dy * overlap / 2;
            const vrel = (A.vx - B.vx) * dx + (A.vy - B.vy) * dy;
            if (vrel > 0) {
              const imp = (1 + E) / 2 * vrel;
              A.vx -= imp * dx; A.vy -= imp * dy;
              B.vx += imp * dx; B.vy += imp * dy;
              moving = true;
              const key = i * 64 + j;
              const f = Math.floor((step + 1) / FRAME_EVERY);
              if (vrel > 1.2 && (!lastHit.has(key) || f - lastHit.get(key) > 6)) {
                lastHit.set(key, f);
                events.push({ f, type: 'hit', a: A.id, b: B.id, s: q(vrel, 10) });
              }
            }
          }
        }
      }
      for (let i = 0; i < n; i++) {
        const b = bodies[i];
        if (!b.out && !onIce(b.x, b.y, H)) {
          b.out = true;
          b.outF = Math.floor((step + 1) / FRAME_EVERY);
          lastOutStep = step;
          outs.push({ f: b.outF, id: b.id });
        }
      }
      if (record && (step + 1) % FRAME_EVERY === 0) snap();
      // stop once the ice is still (and anything that fell has had a moment to splash down)
      if (!moving && step - lastOutStep > 20) { step++; break; }
    }
    if (record && step % FRAME_EVERY !== 0) snap();
    return {
      ids: bodies.map((b) => b.id),
      frames,
      events,
      outs,
      end: bodies.map((b) => ({ id: b.id, side: b.side, x: q(b.x, 100), y: q(b.y, 100), face: q(b.face, 1000), out: b.out })),
    };
  }

  // Half-size after round `round` (1-based) has been played, given the size during it.
  function nextH(H, round) {
    return round % SHRINK_EVERY === 0 ? Math.max(H_MIN, H - SHRINK_STEP) : H;
  }

  // ---- bots --------------------------------------------------------------------------------------
  const BOT = {
    easy:   { cand: 5,  aNoise: 0.38, pNoise: 0.28, opp: 0, randomP: 0.45, mix: 0 },
    medium: { cand: 14, aNoise: 0.16, pNoise: 0.14, opp: 0, randomP: 0.2,  mix: 0 },
    hard:   { cand: 32, aNoise: 0.05, pNoise: 0.05, opp: 2, randomP: 0.08, mix: 0.2 },
    expert: { cand: 56, aNoise: 0.012, pNoise: 0.015, opp: 5, randomP: 0.05, mix: 0.5 },
  };

  function gauss(rand) {
    const u = Math.max(1e-9, rand());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  }

  // Position value for `side` after a round: penguin count dominates, then safety from the edge
  // of the (possibly shrinking) floe.
  function evaluate(end, side, H) {
    let s = 0;
    for (const b of end) {
      if (b.out || !onIce(b.x, b.y, H)) continue;
      const edge = H - Math.max(Math.abs(b.x), Math.abs(b.y));
      const safe = Math.min(edge, 3.5) * 0.9 - (edge < 1.2 ? (1.2 - edge) * 2.5 : 0);
      s += (b.side === side ? 1 : -1) * (12 + safe);
    }
    return s;
  }

  // One heuristic move for penguin `me` of `side`.
  function heuristicMove(me, pens, H, rand, randomP) {
    const foes = pens.filter((p) => p.side !== me.side);
    const r = rand();
    if (r < randomP) return { a: (rand() * 2 - 1) * Math.PI, p: rand() * 0.8 };
    if (r < randomP + 0.12) return { a: 0, p: 0 }; // stay
    const edge = H - Math.max(Math.abs(me.x), Math.abs(me.y));
    if (edge < 3 && rand() < 0.6) { // get back toward the middle
      const d = Math.hypot(me.x, me.y);
      return { a: Math.atan2(-me.y, -me.x) + gauss(rand) * 0.25, p: clamp(Math.sqrt(2 * MU * d * 0.5) / VMAX, 0.15, 0.7) };
    }
    if (foes.length && rand() < 0.85) {
      // ram a foe, preferring ones near the edge and close by
      let best = null;
      let bs = -Infinity;
      for (const f of foes) {
        const fe = H - Math.max(Math.abs(f.x), Math.abs(f.y));
        const sc = -fe * 0.8 - Math.hypot(f.x - me.x, f.y - me.y) * 0.25 + rand() * 2.5;
        if (sc > bs) { bs = sc; best = f; }
      }
      const ang = Math.atan2(best.y - me.y, best.x - me.x) + gauss(rand) * 0.12;
      return { a: ang, p: 0.65 + rand() * 0.35 };
    }
    return { a: (rand() * 2 - 1) * Math.PI, p: 0.15 + rand() * 0.45 };
  }

  function sampleSet(pens, side, H, rand, randomP) {
    const set = {};
    for (const p of pens) if (p.side === side) set[p.id] = normMove(heuristicMove(p, pens, H, rand, randomP));
    return set;
  }

  const merge = (a, b) => Object.assign({}, a, b);

  // Pick moves for `side`. pens = alive penguins, H = current half-size, round = current round.
  function botMoves(pens, side, H, round, level, rand) {
    rand = rand || Math.random;
    const L = BOT[level] || BOT.hard;
    const foe = side === 'red' ? 'blue' : 'red';
    const Hn = nextH(H, round);
    const mine = pens.filter((p) => p.side === side);
    if (!mine.length) return {};

    // the opponent's likely replies: standing still + the most dangerous heuristic sets
    const replies = [{}];
    if (L.opp > 0) {
      const pool = [];
      for (let i = 0; i < L.opp * 3; i++) {
        const set = sampleSet(pens, foe, H, rand, 0.05);
        const res = simulate(pens, set, H, { noFrames: true });
        pool.push({ set, v: evaluate(res.end, foe, Hn) });
      }
      pool.sort((x, y) => y.v - x.v);
      for (let i = 0; i < L.opp && i < pool.length; i++) replies.push(pool[i].set);
    }

    const cands = [{}];
    for (const p of mine) cands[0][p.id] = { a: p.face || 0, p: 0 };
    for (let i = 1; i < L.cand; i++) cands.push(sampleSet(pens, side, H, rand, L.randomP));

    const score = (set) => {
      let sum = 0;
      let min = Infinity;
      for (const rep of replies) {
        const res = simulate(pens, merge(rep, set), H, { noFrames: true });
        const v = evaluate(res.end, side, Hn);
        sum += v;
        if (v < min) min = v;
      }
      return (1 - L.mix) * (sum / replies.length) + L.mix * min;
    };
    let best = cands[0];
    let bv = -Infinity;
    for (const c of cands) {
      const v = score(c);
      if (v > bv) { bv = v; best = c; }
    }
    // expert/hard: a short hill-climb on the best set, one penguin at a time
    if (L.opp >= 2) {
      const tries = L.opp >= 5 ? 14 : 6;
      for (let t = 0; t < tries; t++) {
        const p = mine[Math.floor(rand() * mine.length)];
        const cur = best[p.id];
        const tweak = merge(best, { [p.id]: normMove({ a: cur.a + gauss(rand) * 0.15, p: clamp(cur.p + gauss(rand) * 0.12, 0, 1) }) });
        const v = score(tweak);
        if (v > bv) { bv = v; best = tweak; }
      }
    }
    // execution error
    const out = {};
    for (const p of mine) {
      const m = best[p.id] || { a: 0, p: 0 };
      if (m.p <= 0) { out[p.id] = { a: m.a, p: 0 }; continue; }
      out[p.id] = normMove({ a: m.a + gauss(rand) * L.aNoise, p: clamp(m.p + gauss(rand) * L.pNoise, 0.05, 1) });
    }
    return out;
  }

  const api = {
    H0, H_MIN, SHRINK_STEP, SHRINK_EVERY, R, VMAX, MU, DT, FRAME_DT, MAX_ARROW, COLORS,
    normMove, normAngle, startPositions, simulate, nextH, onIce, evaluate, botMoves, BOT_LEVELS: Object.keys(BOT),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KnockoutSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
