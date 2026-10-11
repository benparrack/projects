// Shuffleboard (table shuffleboard, GamePigeon style) — shared puck physics + scoring + bots.
// Loaded by the browser as a plain <script> (window.ShuffleSim) and by the server with require()
// (server/games/shuffleboard.js), so a shot resolves identically for the shooter's instant local
// preview, the authoritative server result and the bots' shot search.
//
// Frame: top-down table coordinates. x runs across the table (0 = centre line, +x = shooter's
// right), y runs down the table from the shooting end (y = 0) to the far end (y = TABLE_L).
// Every shot starts at y = START_Y. Scoring zones sit at the far end:
//   1 point  — puck fully past the 1-line (y - R >= LINE1)
//   2 points — fully past the 2-line, 3 points — fully past the 3-line (touching a line counts
//   the lower zone), 4 points — a HANGER: part of the puck overhangs the far edge (y + R > L)
//   while its centre is still on the table.
// A puck whose centre passes the far edge or either side edge falls into the gutter (gone).
// After every shot, any puck that came to rest short of the foul line is removed.
//
// The sim uses only + - * / and Math.sqrt (all IEEE-exact), so every JS engine computes the same
// trajectory bit for bit. A shot input is { x, aim, power }: x in [-1, 1] = start position across
// the table, aim in [-1, 1] = sideways slope of the slide, power in [0, 1] = how far an
// unobstructed puck slides (linear in distance). Inputs are quantized so client/server agree.

(function (root) {
  'use strict';

  const TABLE_L = 100;
  const TABLE_W = 16;
  const R = 1.25; // puck radius
  const START_Y = 3;
  const FOUL_Y = 64; // pucks resting short of this line are removed
  const LINE1 = 79;
  const LINE2 = 86;
  const LINE3 = 94;
  const X_MAX = TABLE_W / 2 - R - 0.25; // start-position range
  const MAX_SLOPE = 0.12; // dx/dy at aim = +-1
  const DECEL = 20; // sliding friction, units/s^2 (constant deceleration)
  const D_MIN = 40; // slide distance at power 0
  const D_MAX = 115; // slide distance at power 1 (well off the end)
  const E = 0.9; // puck-puck restitution
  const DT = 1 / 240;
  const FRAME_EVERY = 8; // 30 fps frames; the client interpolates
  const FRAME_MS = 1000 * DT * FRAME_EVERY;
  const MAX_STEPS = 240 * 9;
  const PUCKS_PER_ROUND = 4;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const q = (v, step) => Math.round(v / step) * step;
  const r2 = (v) => Math.round(v * 100) / 100;

  function normInput(input) {
    if (!input || typeof input !== 'object') return null;
    const x = Number(input.x);
    const aim = Number(input.aim);
    const power = Number(input.power);
    if (!Number.isFinite(x) || !Number.isFinite(aim) || !Number.isFinite(power)) return null;
    // r4 after quantizing so 0.1 + float noise can't differ between engines
    const qq = (v) => Math.round(q(v, 0.0005) * 10000) / 10000;
    return { x: qq(clamp(x, -1, 1)), aim: qq(clamp(aim, -1, 1)), power: qq(clamp(power, 0, 1)) };
  }

  function launch(input) {
    const d = D_MIN + (D_MAX - D_MIN) * input.power;
    // discrete stepping slides v^2/2a + v*DT/2, so solve that for v (exact stop distance)
    const v = DECEL * (Math.sqrt(DT * DT / 4 + (2 * d) / DECEL) - DT / 2);
    const s = input.aim * MAX_SLOPE;
    const n = Math.sqrt(1 + s * s);
    return { x: input.x * X_MAX, y: START_Y, vx: (v * s) / n, vy: v / n };
  }

  // Inverse of launch's distance mapping (bots / tests): power that slides `d` units.
  const powerFor = (d) => clamp((d - D_MIN) / (D_MAX - D_MIN), 0, 1);

  // Points a resting puck is worth on its own (before the "furthest puck" rule).
  function zoneValue(p) {
    if (p.y > TABLE_L || Math.abs(p.x) > TABLE_W / 2) return 0;
    if (p.y + R > TABLE_L) return 4;
    const back = p.y - R;
    if (back >= LINE3) return 3;
    if (back >= LINE2) return 2;
    if (back >= LINE1) return 1;
    return 0;
  }

  // Round scoring: only the owner of the furthest puck scores, counting every one of their pucks
  // beyond the opponent's furthest puck. Exactly level furthest pucks -> nobody scores.
  function scoreRound(pucks) {
    const far = { red: -Infinity, blue: -Infinity };
    for (const p of pucks) if (p.y > far[p.owner]) far[p.owner] = p.y;
    if (far.red === -Infinity && far.blue === -Infinity) return { scorer: null, points: 0, counted: [] };
    if (far.red === far.blue) return { scorer: null, points: 0, counted: [] };
    const scorer = far.red > far.blue ? 'red' : 'blue';
    const other = scorer === 'red' ? 'blue' : 'red';
    const counted = [];
    let points = 0;
    for (const p of pucks) {
      if (p.owner !== scorer || p.y <= far[other]) continue;
      const v = zoneValue(p);
      if (v > 0) { counted.push({ id: p.id, value: v }); points += v; }
    }
    return { scorer: points > 0 ? scorer : null, points, counted, leader: scorer };
  }

  // Simulates one shot. `pucks` = resting pucks [{id, owner, x, y}]; the new puck gets `shotId`
  // and `owner`. Returns { input, order: [ids], frames: [[x0,y0,x1,y1,...]...] (30 fps, gone pucks
  // keep their last on-table spot), events: [{f, type:'hit'|'fall'|'short', ...}], after: resting
  // pucks (positions rounded to 0.01), removed: [{id, owner, why}] } or null on a bad input.
  function simulate(pucks, rawInput, owner, shotId) {
    const input = normInput(rawInput);
    if (!input) return null;
    const L0 = launch(input);
    const bodies = (pucks || []).map((p) => ({ id: p.id, owner: p.owner, x: p.x, y: p.y, vx: 0, vy: 0, gone: false }));
    bodies.push({ id: shotId, owner, x: L0.x, y: L0.y, vx: L0.vx, vy: L0.vy, gone: false });
    const n = bodies.length;
    const frames = [];
    const events = [];
    const removed = [];
    const rec = () => {
      const f = new Array(n * 2);
      for (let i = 0; i < n; i++) { f[i * 2] = r2(bodies[i].x); f[i * 2 + 1] = r2(bodies[i].y); }
      frames.push(f);
    };
    rec();
    const dv = DECEL * DT;
    const minD = 2 * R;
    let step = 0;
    for (; step < MAX_STEPS; step++) {
      let moving = false;
      for (let i = 0; i < n; i++) {
        const b = bodies[i];
        if (b.gone || (b.vx === 0 && b.vy === 0)) continue;
        moving = true;
        b.x += b.vx * DT;
        b.y += b.vy * DT;
        const s2 = b.vx * b.vx + b.vy * b.vy;
        const s = Math.sqrt(s2);
        if (s <= dv) { b.vx = 0; b.vy = 0; } else { const k = (s - dv) / s; b.vx *= k; b.vy *= k; }
      }
      if (!moving) break;
      // puck-puck collisions (equal masses)
      for (let i = 0; i < n; i++) {
        const a = bodies[i];
        if (a.gone) continue;
        for (let j = i + 1; j < n; j++) {
          const b = bodies[j];
          if (b.gone) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= minD * minD || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (vn < 0) {
            const jm = (-(1 + E) * vn) / 2;
            a.vx -= jm * nx; a.vy -= jm * ny;
            b.vx += jm * nx; b.vy += jm * ny;
            events.push({ f: Math.ceil((step + 1) / FRAME_EVERY), type: 'hit', a: a.id, b: b.id, s: r2(-vn) });
          }
          const push = (minD - d) / 2;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
        }
      }
      // gutters / off the end
      for (let i = 0; i < n; i++) {
        const b = bodies[i];
        if (b.gone) continue;
        const side = Math.abs(b.x) > TABLE_W / 2;
        if (b.y > TABLE_L || side) {
          b.gone = true;
          events.push({ f: Math.ceil((step + 1) / FRAME_EVERY), type: 'fall', id: b.id, why: side ? 'side' : 'end', vx: r2(b.vx), vy: r2(b.vy) });
          removed.push({ id: b.id, owner: b.owner, why: side ? 'side' : 'end' });
          b.vx = 0; b.vy = 0;
        }
      }
      if ((step + 1) % FRAME_EVERY === 0) rec();
    }
    rec();
    const after = [];
    for (const b of bodies) {
      if (b.gone) continue;
      const p = { id: b.id, owner: b.owner, x: r2(b.x), y: r2(b.y) };
      if (p.y < FOUL_Y) {
        removed.push({ id: b.id, owner: b.owner, why: 'short' });
        events.push({ f: frames.length - 1, type: 'short', id: b.id });
      } else after.push(p);
    }
    return { input, order: bodies.map((b) => b.id), owners: bodies.map((b) => b.owner), frames, events, after, removed, shotId };
  }

  // ---- bots ---------------------------------------------------------------------------------
  // Execution noise (std dev, in input units) per level, plus how hard each level looks for a
  // shot. Measured in test/shuffleboard.test.js: Expert beats Easy nearly every game.
  const BOT = {
    easy: { x: 0.08, aim: 0.09, power: 0.04, search: 'draw', reply: 0, robust: 0 },
    medium: { x: 0.04, aim: 0.045, power: 0.02, search: 'basic', reply: 0, robust: 0 },
    hard: { x: 0.02, aim: 0.022, power: 0.01, search: 'full', reply: 8, robust: 0 },
    expert: { x: 0.01, aim: 0.01, power: 0.0045, search: 'full', reply: 14, robust: 3 },
  };

  function gauss(rand) {
    let u = 0; let w = 0;
    while (u === 0) u = rand();
    while (w === 0) w = rand();
    // bots only run on the server, so Math.log/cos (not bit-exact across engines) are fine here
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
  }

  // Position value for `me` if the round ended now, plus a little credit for pucks in the zones
  // (they may still count) — negative when the opponent is ahead.
  function evaluate(pucks, me) {
    const r = scoreRound(pucks);
    let v = r.scorer === me ? r.points : r.scorer ? -r.points : 0;
    for (const p of pucks) {
      const z = zoneValue(p);
      if (!z) continue;
      v += (p.owner === me ? 0.15 : -0.15) * Math.min(z, 3);
    }
    return v;
  }

  // Input that slides a lone puck from start position xs to rest at (tx, ty).
  function aimAt(xs, tx, ty) {
    const x0 = clamp(xs, -X_MAX, X_MAX);
    const dy = ty - START_Y;
    const s = (tx - x0) / dy;
    if (Math.abs(s) > MAX_SLOPE) return null;
    const d = Math.sqrt(dy * dy + (tx - x0) * (tx - x0));
    return normInput({ x: x0 / X_MAX, aim: s / MAX_SLOPE, power: powerFor(d) });
  }

  // Shot aimed at puck p from start sx, sliding `extra` units further than first contact.
  function hitShot(p, sx, extra) {
    const inp = aimAt(sx, p.x, p.y);
    if (!inp) return null;
    const x0 = inp.x * X_MAX;
    const d = Math.sqrt((p.y - START_Y) * (p.y - START_Y) + (p.x - x0) * (p.x - x0));
    return normInput({ x: inp.x, aim: inp.aim, power: powerFor(d - 2 * R + extra) });
  }

  function candidates(pucks, me, search) {
    const out = [];
    const add = (inp) => { if (inp) out.push(inp); };
    const xs = search === 'draw' ? [-3, 0, 3] : [-4.5, -3, -1.5, 0, 1.5, 3, 4.5];
    const ys = search === 'draw' ? [90, 96] : search === 'basic' ? [90, 96, 97.5] : [90, 96, 97.5, TABLE_L - R * 0.45];
    for (const tx of xs) for (const ty of ys) add(aimAt(tx, tx, ty));
    if (search === 'draw') return out;
    if (search === 'full') {
      // angled draws (sneak round blockers) and guards parked short of the scoring zones
      for (const tx of [-4, -2, 2, 4]) for (const ty of [96, 97.5]) { add(aimAt(0, tx, ty)); add(aimAt(-tx, tx, ty)); }
      for (const p of pucks) if (p.owner === me && zoneValue(p)) for (const gy of [70, 76]) add(aimAt(p.x, p.x, gy));
    }
    // takeouts / taps on every puck: aim straight at it from several starts at several speeds
    for (const p of pucks) {
      const mine = p.owner === me;
      if (search === 'basic' && mine) continue;
      const starts = search === 'basic' ? [p.x] : [p.x, p.x - 2.5, p.x + 2.5, 0];
      const extras = mine ? [1.5, 3, 4.5, 6] : search === 'basic' ? [25] : [5, 12, 30];
      for (const sx of starts) for (const ex of extras) add(hitShot(p, sx, ex));
    }
    return out;
  }

  // A small set of strong replies for `opp`: firm takeouts of the scoring opponent pucks plus a
  // few draws. Returns the value (from `me`'s view) of the position after opp's best reply.
  function worstAfterReply(pucks, me, opp, shotId) {
    const replies = [];
    for (const p of pucks) {
      if (p.owner !== me || p.y < LINE1 - 4) continue;
      replies.push(hitShot(p, p.x, 30), hitShot(p, p.x, 8));
    }
    for (const tx of [-3, 0, 3]) replies.push(aimAt(tx, tx, 96.5));
    let worst = Infinity;
    for (const inp of replies) {
      if (!inp) continue;
      const r = simulate(pucks, inp, opp, shotId + 1);
      const v = evaluate(r.after, me);
      if (v < worst) worst = v;
    }
    return worst === Infinity ? evaluate(pucks, me) : worst;
  }

  function noisy(inp, L, rand) {
    return normInput({ x: inp.x + gauss(rand) * L.x, aim: inp.aim + gauss(rand) * L.aim, power: inp.power + gauss(rand) * L.power });
  }

  // Chooses a shot for `me` (red/blue) against the resting `pucks` and returns the noisy input
  // actually played. opts: { rand, left: { red, blue } shots still to play (including this one),
  // plan: out-param receiving the intended input }.
  function botShot(pucks, me, level, opts) {
    opts = opts || {};
    const rand = opts.rand || Math.random;
    const L = BOT[level] || BOT.hard;
    const opp = me === 'red' ? 'blue' : 'red';
    const oppLeft = opts.left ? opts.left[opp] : 0;
    const shotId = 1e6;
    let scored = [];
    for (const inp of candidates(pucks, me, L.search)) {
      const res = simulate(pucks, inp, me, shotId);
      if (!res) continue;
      scored.push({ inp, after: res.after, v: evaluate(res.after, me) + rand() * 0.01 });
    }
    scored.sort((a, b) => b.v - a.v);
    if (L.reply && oppLeft > 0) {
      // look one shot ahead: how well does the position survive the opponent's best answer?
      scored = scored.slice(0, L.reply);
      for (const c of scored) c.v = 0.3 * c.v + 0.7 * worstAfterReply(c.after, me, opp, shotId);
      scored.sort((a, b) => b.v - a.v);
    }
    if (L.robust && scored.length) {
      // re-rank the best few by their average outcome under this bot's own execution noise
      scored = scored.slice(0, 5);
      for (const c of scored) {
        let sum = 0;
        for (let k = 0; k < L.robust; k++) {
          const r = simulate(pucks, noisy(c.inp, L, rand), me, shotId);
          sum += oppLeft > 0 && L.reply ? 0.3 * evaluate(r.after, me) + 0.7 * worstAfterReply(r.after, me, opp, shotId) : evaluate(r.after, me);
        }
        c.v = (c.v + sum) / (L.robust + 1);
      }
      scored.sort((a, b) => b.v - a.v);
    }
    const chosen = scored.length ? scored[0].inp : normInput({ x: 0, aim: 0, power: powerFor(93) });
    if (opts.plan) opts.plan.input = chosen;
    return noisy(chosen, L, rand);
  }

  const api = {
    TABLE_L, TABLE_W, R, START_Y, FOUL_Y, LINE1, LINE2, LINE3, X_MAX, MAX_SLOPE, DECEL, D_MIN, D_MAX,
    FRAME_MS, PUCKS_PER_ROUND,
    normInput, launch, powerFor, zoneValue, scoreRound, simulate, evaluate, aimAt, botShot,
    BOT_LEVELS: Object.keys(BOT),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShuffleSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
