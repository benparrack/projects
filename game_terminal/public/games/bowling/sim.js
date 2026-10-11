// Bowling — shared roll physics + scoring. Loaded by the browser as a plain <script>
// (window.BowlingSim) and by the server with require() (server/games/bowling.js), so a roll
// resolves the same way for the bowler's instant local preview, the authoritative server result
// and the bots' line-finding.
//
// Top-down 2D physics with a pseudo-3D twist (pins fall once knocked past a threshold): x across
// the lane (+x = bowler's right, 0 = centre), z down the lane (0 = foul line, head pin at PIN_Z0).
// The ball is a heavy disc that skids straight through the oiled front of the lane, then hooks by
// `spin` once it reaches the dry back end. Pins are light discs; a pin that takes a hard enough
// knock (or gets shoved far enough) falls and keeps sliding as a "down" pin that can take out
// others (pin action). Pins that slide off the deck drop into the gutter / pit.
//
// Only + - * / and Math.sqrt are used inside the simulation (all exactly rounded in IEEE-754), so
// every JS engine produces bit-identical results for the same input.
//
// A roll input is { x, aim, power, spin }: x in [-1, 1] = start position along the foul line,
// aim in [-1, 1] = launch direction, power in [0, 1] = ball speed, spin in [-1, 1] = hook (+ curves
// right). Inputs are quantized so client and server agree exactly.

(function (root) {
  'use strict';

  const LANE_HALF = 0.527; // 41.5 in wide
  const GUTTER_W = 0.235;
  const KICK_X = LANE_HALF + GUTTER_W; // kickback walls beside the pin deck
  const PIN_Z0 = 18.29; // foul line -> head pin (60 ft)
  const PIN_SP = 0.3048; // 12 in between pin centres
  const ROW_DZ = PIN_SP * Math.sqrt(3) / 2;
  const DECK_END = PIN_Z0 + 3 * ROW_DZ + 0.32;
  const PIT_Z = DECK_END + 0.25;
  const BALL_R = 0.108;
  const PIN_R = 0.06; // belly radius, standing
  const PIN_R_DOWN = 0.075; // a lying pin sweeps a wider footprint
  const PIN_H = 0.381;
  const M_BALL = 7;
  const M_PIN = 1.5;
  const E_BALL_PIN = 0.62;
  const E_PIN_PIN = 0.72;
  const E_KICK = 0.55;
  const FALL_DV = 0.55; // a knock this hard (m/s) topples a standing pin
  const SHOVE_DIST = 0.07; // ...as does being pushed this far off its spot
  const V_MIN = 6.6;
  const V_MAX = 9.4;
  const MAX_SLOPE = 0.042; // launch direction dx/dz at aim = +-1
  const HOOK_A = 0.65; // lateral accel (m/s^2) at spin = +-1 on the dry back end
  const HOOK_START = 7.5;
  const HOOK_FULL = 13;
  const ROLL_DECEL = 0.22;
  const START_MAX = LANE_HALF - BALL_R - 0.02;
  const DT = 1 / 480;
  const FRAME_EVERY = 16; // one recorded frame every 16 steps = 30 fps playback
  const FPS = 30;
  const MAX_T = 7;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const q = (v, step) => Math.round(v / step) * step;
  const r3 = (v) => Math.round(v * 1000) / 1000;

  function normInput(input) {
    if (!input || typeof input !== 'object') return null;
    const vals = ['x', 'aim', 'power', 'spin'].map((k) => Number(input[k]));
    if (!vals.every(Number.isFinite)) return null;
    const [x, aim, power, spin] = vals;
    return {
      x: q(clamp(x, -1, 1), 0.001),
      aim: q(clamp(aim, -1, 1), 0.0005),
      power: q(clamp(power, 0, 1), 0.001),
      spin: q(clamp(spin, -1, 1), 0.001),
    };
  }

  // Standard numbering from the bowler's view: 1 at the front, 2/3, 4/5/6, 7/8/9/10 (7 back-left).
  const SPOTS = (() => {
    const out = {};
    let id = 1;
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k <= r; k++) out[id++] = { x: (k - r / 2) * PIN_SP, z: PIN_Z0 + r * ROW_DZ };
    }
    return out;
  })();
  const rack = () => Object.keys(SPOTS).map((id) => ({ id: Number(id), x: r3(SPOTS[id].x), z: r3(SPOTS[id].z) }));

  function launch(input) {
    const speed = V_MIN + (V_MAX - V_MIN) * input.power;
    const slope = input.aim * MAX_SLOPE;
    const n = Math.sqrt(1 + slope * slope);
    return { x: input.x * START_MAX, z: 0, vx: (speed * slope) / n, vz: speed / n };
  }

  function smooth(a, b, v) {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // Advances the ball one step (no pins). Returns true once it drops into a gutter this step.
  function stepBall(b, spin) {
    if (b.gutter) {
      const cx = b.gutter * (LANE_HALF + GUTTER_W / 2);
      b.x += (cx - b.x) * 0.08;
      b.vx = 0;
    } else {
      b.vx += spin * HOOK_A * smooth(HOOK_START, HOOK_FULL, b.z) * DT;
    }
    const sp = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
    if (sp > 0.5) {
      const k = 1 - (ROLL_DECEL * DT) / sp;
      b.vx *= k; b.vz *= k;
    }
    b.x += b.vx * DT;
    b.z += b.vz * DT;
    if (!b.gutter && (b.x > LANE_HALF || b.x < -LANE_HALF)) {
      b.gutter = b.x > 0 ? 1 : -1;
      return true;
    }
    return false;
  }

  // Ball-only path (no pins) — for the aiming guide and the bots. Returns [[x, z], ...] every
  // `every` steps until z >= zEnd or the ball drops into a gutter (then a final point).
  function ballPath(rawInput, zEnd, every) {
    const input = normInput(rawInput);
    if (!input) return [];
    const b = launch(input);
    const out = [[b.x, b.z]];
    every = every || 24;
    for (let s = 1; s < MAX_T / DT && b.z < zEnd; s++) {
      if (stepBall(b, input.spin)) { out.push([b.x, b.z]); return out; }
      if (s % every === 0) out.push([b.x, b.z]);
    }
    out.push([b.x, b.z]);
    return out;
  }

  // Where (x) the ball crosses z, or null if it gutters first.
  function crossX(rawInput, z) {
    const input = normInput(rawInput);
    if (!input) return null;
    const b = launch(input);
    for (let s = 1; s < MAX_T / DT; s++) {
      const pz = b.z; const px = b.x;
      if (stepBall(b, input.spin)) return null;
      if (b.z >= z) return px + ((b.x - px) * (z - pz)) / (b.z - pz);
    }
    return null;
  }

  // Simulates one roll at the standing `pins` ([{id, x, z}]). Returns
  // { input, frames, pins: [{id, fallF, fx, fz, outF, wobF}], knocked: [ids], standing: [{id,x,z}],
  //   gutter, events: [{f, type: 'gutter'|'hit'|'clatter'|'pit'}] }.
  // frames[k] = [ballX, ballZ, pinX..., pinZ...] in the order of the input pins, 30 fps.
  function simulate(pinsIn, rawInput) {
    const input = normInput(rawInput);
    if (!input || !Array.isArray(pinsIn)) return null;
    const b = launch(input);
    b.gutter = 0;
    let ballGone = false;
    let gutterZ = Infinity;
    const P = pinsIn.map((p) => ({
      id: p.id, x: p.x, z: p.z, x0: p.x, z0: p.z, vx: 0, vz: 0, down: false, out: false,
      fallF: -1, fx: 0, fz: 1, outF: -1, wobF: -1,
    }));
    const events = [];
    const frames = [];
    let lastClatter = -99;
    let firstHit = true;
    const rec = () => {
      const fr = [r3(b.x), r3(b.z)];
      for (const p of P) fr.push(r3(p.x), r3(p.z));
      frames.push(fr);
    };
    const curF = (s) => Math.ceil(s / FRAME_EVERY);
    const topple = (p, s) => {
      if (p.down) return;
      p.down = true;
      p.fallF = curF(s);
      const sp = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
      if (sp > 1e-6) { p.fx = r3(p.vx / sp); p.fz = r3(p.vz / sp); }
    };
    const knock = (p, dv, s) => {
      if (p.down) return;
      if (dv > FALL_DV) topple(p, s);
      else if (dv > 0.05 && p.wobF < 0) p.wobF = curF(s);
    };
    rec();
    const steps = Math.round(MAX_T / DT);
    let calm = 0;
    let active = false;
    for (let s = 1; s <= steps; s++) {
      // ball
      if (!ballGone) {
        if (stepBall(b, input.spin)) {
          gutterZ = b.z;
          if (b.z < PIN_Z0 - 0.15) events.push({ f: curF(s), type: 'gutter' });
        }
        if (b.z > PIT_Z) { ballGone = true; events.push({ f: curF(s), type: 'pit' }); }
      }
      // pins (nothing on the deck moves until the ball gets there)
      if (!active && b.z < PIN_Z0 - 0.6) {
        if (s % FRAME_EVERY === 0) rec();
        continue;
      }
      active = true;
      for (const p of P) {
        if (p.out) continue;
        let sp = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
        if (sp > 0) {
          const dec = (p.down ? 1.6 + 1.1 * sp : 7) * DT;
          const k = sp > dec ? 1 - dec / sp : 0;
          p.vx *= k; p.vz *= k;
          p.x += p.vx * DT; p.z += p.vz * DT;
          sp *= k;
        }
        if (!p.down) {
          const dx = p.x - p.x0; const dz = p.z - p.z0;
          if (dx * dx + dz * dz > SHOVE_DIST * SHOVE_DIST) topple(p, s);
        }
        // kickbacks beside the deck
        if (p.x > KICK_X - PIN_R_DOWN && p.vx > 0) { p.x = KICK_X - PIN_R_DOWN; p.vx = -p.vx * E_KICK; }
        if (p.x < -KICK_X + PIN_R_DOWN && p.vx < 0) { p.x = -KICK_X + PIN_R_DOWN; p.vx = -p.vx * E_KICK; }
        const overGutter = p.x > LANE_HALF + 0.03 || p.x < -LANE_HALF - 0.03;
        if (overGutter && !p.down) topple(p, s);
        if ((overGutter && sp < 1.2) || p.z > PIT_Z || p.z < PIN_Z0 - 1.2) {
          p.out = true;
          p.outF = curF(s);
          p.vx = 0; p.vz = 0;
        }
      }
      // ball vs pins
      if (!ballGone && !b.gutter && b.z > PIN_Z0 - 0.5) {
        for (const p of P) {
          if (p.out) continue;
          const rr = BALL_R + (p.down ? PIN_R_DOWN : PIN_R);
          const dx = p.x - b.x; const dz = p.z - b.z;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr || d2 < 1e-12) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d; const nz = dz / d;
          const pen = rr - d;
          const wb = M_PIN / (M_BALL + M_PIN);
          b.x -= nx * pen * wb; b.z -= nz * pen * wb;
          p.x += nx * pen * (1 - wb); p.z += nz * pen * (1 - wb);
          const vn = (p.vx - b.vx) * nx + (p.vz - b.vz) * nz;
          if (vn < 0) {
            const j = (-(1 + E_BALL_PIN) * vn) / (1 / M_BALL + 1 / M_PIN);
            b.vx -= (j / M_BALL) * nx; b.vz -= (j / M_BALL) * nz;
            p.vx += (j / M_PIN) * nx; p.vz += (j / M_PIN) * nz;
            knock(p, j / M_PIN, s);
            if (firstHit) { firstHit = false; events.push({ f: curF(s), type: 'hit' }); }
          }
        }
      }
      // pin vs pin
      for (let i = 0; i < P.length; i++) {
        const a = P[i];
        if (a.out) continue;
        for (let k = i + 1; k < P.length; k++) {
          const c = P[k];
          if (c.out) continue;
          if (!a.down && !c.down && a.vx === 0 && a.vz === 0 && c.vx === 0 && c.vz === 0) continue;
          const rr = (a.down ? PIN_R_DOWN : PIN_R) + (c.down ? PIN_R_DOWN : PIN_R);
          const dx = c.x - a.x; const dz = c.z - a.z;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr || d2 < 1e-12) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d; const nz = dz / d;
          const pen = (rr - d) / 2;
          a.x -= nx * pen; a.z -= nz * pen;
          c.x += nx * pen; c.z += nz * pen;
          const vn = (c.vx - a.vx) * nx + (c.vz - a.vz) * nz;
          if (vn < 0) {
            const j = (-(1 + E_PIN_PIN) * vn) / (2 / M_PIN);
            a.vx -= (j / M_PIN) * nx; a.vz -= (j / M_PIN) * nz;
            c.vx += (j / M_PIN) * nx; c.vz += (j / M_PIN) * nz;
            knock(a, j / M_PIN, s);
            knock(c, j / M_PIN, s);
            if (j / M_PIN > 0.4 && s - lastClatter > 30) {
              lastClatter = s;
              events.push({ f: curF(s), type: 'clatter' });
            }
          }
        }
      }
      if (s % FRAME_EVERY === 0) rec();
      // done once the ball is gone (or past the pins in a gutter) and the deck is still
      const ballDone = ballGone || (b.gutter && b.z > DECK_END);
      let moving = false;
      for (const p of P) if (!p.out && (p.vx * p.vx + p.vz * p.vz) > 0.0004) { moving = true; break; }
      calm = ballDone && !moving ? calm + 1 : 0;
      if (calm > 60) break;
    }
    rec();
    const knocked = P.filter((p) => p.down || p.out).map((p) => p.id);
    const standing = P.filter((p) => !p.down && !p.out).map((p) => ({ id: p.id, x: r3(p.x), z: r3(p.z) }));
    return {
      input,
      frames,
      pins: P.map((p) => ({ id: p.id, fallF: p.fallF, fx: p.fx, fz: p.fz, outF: p.outF, wobF: p.wobF })),
      knocked,
      standing,
      gutter: gutterZ < PIN_Z0 - 0.15, // went in before reaching the pins
      events,
    };
  }

  // ---- splits ---------------------------------------------------------------------------------
  // After a first ball: head pin down and the standing pins fall into 2+ groups that don't touch
  // (neighbouring spots are one pin-spacing apart).
  function isSplit(standingIds) {
    if (standingIds.includes(1) || standingIds.length < 2) return false;
    const ids = standingIds.slice();
    const seen = new Set([ids[0]]);
    const stack = [ids[0]];
    while (stack.length) {
      const a = SPOTS[stack.pop()];
      for (const id of ids) {
        if (seen.has(id)) continue;
        const c = SPOTS[id];
        if (Math.hypot(a.x - c.x, a.z - c.z) < PIN_SP * 1.05) { seen.add(id); stack.push(id); }
      }
    }
    return seen.size < ids.length;
  }

  // ---- scoring --------------------------------------------------------------------------------
  // `frames` is an array (up to 10) of roll arrays (pins knocked by each ball). Returns the
  // running total per frame, or null where it can't be known yet (strike / spare bonus pending,
  // frame unfinished).
  function frameDone(frames, f) {
    const r = frames[f];
    if (!r || !r.length) return false;
    if (f < 9) return r[0] === 10 || r.length === 2;
    if (r.length === 3) return true;
    return r.length === 2 && r[0] + r[1] < 10;
  }

  function scoreFrames(frames) {
    const flat = [];
    for (const r of frames) for (const v of (r || [])) flat.push(v);
    const out = [];
    let idx = 0;
    let total = 0;
    let broken = false;
    for (let f = 0; f < 10; f++) {
      const r = frames[f];
      if (broken || !frameDone(frames, f)) { broken = true; out.push(null); continue; }
      let add;
      if (f === 9) add = r.reduce((a, v) => a + v, 0);
      else if (r[0] === 10) {
        add = flat[idx + 1] != null && flat[idx + 2] != null ? 10 + flat[idx + 1] + flat[idx + 2] : null;
        idx += 1;
      } else if (r[0] + r[1] === 10) {
        add = flat[idx + 2] != null ? 10 + flat[idx + 2] : null;
        idx += 2;
      } else {
        add = r[0] + r[1];
        idx += 2;
      }
      if (add == null) { broken = true; out.push(null); continue; }
      total += add;
      out.push(total);
    }
    return out;
  }

  // Best-case total so far (for the scoreboard while frames are pending): counts what's known.
  function knownTotal(frames) {
    const s = scoreFrames(frames);
    let t = 0;
    for (const v of s) if (v != null) t = v;
    return t;
  }

  // Scorecard marks for one frame: e.g. ['', 'X'], ['7', '/'], ['-', '3'], ['X', 'X', 'X'].
  function frameMarks(r, f) {
    if (!r || !r.length) return [];
    const out = [];
    if (f < 9) {
      if (r[0] === 10) return ['', 'X'];
      out.push(r[0] === 0 ? '-' : String(r[0]));
      if (r.length > 1) out.push(r[0] + r[1] === 10 ? '/' : r[1] === 0 ? '-' : String(r[1]));
      return out;
    }
    // 10th: fresh racks after a strike or a spare
    let fresh = true;
    let prev = 0;
    for (let i = 0; i < r.length; i++) {
      const v = r[i];
      if (fresh && v === 10) { out.push('X'); fresh = true; prev = 0; continue; }
      if (!fresh && prev + v === 10) { out.push('/'); fresh = true; prev = 0; continue; }
      out.push(v === 0 ? '-' : String(v));
      if (fresh) { fresh = false; prev = v; } else { fresh = true; prev = 0; }
    }
    return out;
  }

  // Does the next ball of frame `f` (with rolls `r` so far) get a fresh rack?
  function nextIsFresh(r, f) {
    if (!r.length) return true;
    if (f < 9) return false;
    if (r.length === 1) return r[0] === 10;
    // third ball of the 10th
    if (r[0] === 10) return r[1] === 10;
    return r[0] + r[1] === 10;
  }

  // ---- bots -------------------------------------------------------------------------------------
  // Level noise (std-devs in input units) and the line they play. Measured in test/bowling.test.js.
  const BOT = {
    easy: { x: 0.15, aim: 0.3, power: 0.2, spin: 0.35, gutter: 0.1, hook: 0.25 },
    medium: { x: 0.07, aim: 0.11, power: 0.1, spin: 0.14, gutter: 0.02, hook: 0.4 },
    hard: { x: 0.04, aim: 0.055, power: 0.06, spin: 0.08, gutter: 0, hook: 0.55 },
    expert: { x: 0.02, aim: 0.026, power: 0.035, spin: 0.04, gutter: 0, hook: 0.65 },
  };

  function gauss(rand) {
    let u = 0; let w = 0;
    while (u === 0) u = rand();
    while (w === 0) w = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
  }

  // The aim that makes a ball with the given start/power/spin cross z = PIN_Z0 at `targetX`.
  function solveAim(x, power, spin, targetX) {
    if (!spin) return clamp((targetX - x * START_MAX) / PIN_Z0 / MAX_SLOPE, -1, 1);
    let lo = -1; let hi = 1;
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2;
      const cx = crossX({ x, aim: mid, power, spin }, PIN_Z0);
      // a gutter means we went too far one way; figure out which from the start of the path
      const v = cx == null ? (crossX({ x, aim: mid, power, spin }, 3) > x * START_MAX ? 9 : -9) : cx;
      if (v < targetX) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  const lineCache = new Map();
  const pinsKey = (pins) => pins.map((p) => `${p.id}:${Math.round(p.x * 100)}:${Math.round(p.z * 100)}`).join(',');

  // Closest the ball gets to either gutter before the pins (m), or -1 if it drops in.
  function edgeMargin(input) {
    const b = launch(input);
    let m = LANE_HALF;
    for (let s = 1; s < MAX_T / DT && b.z < PIN_Z0; s++) {
      if (stepBall(b, input.spin)) return -1;
      const e = LANE_HALF - (b.x < 0 ? -b.x : b.x);
      if (e < m) m = e;
    }
    return m;
  }

  // Best line at these pins: sweeps where the ball crosses the head-pin row, sims each candidate,
  // and smooths the pin counts over neighbouring candidates (+ a penalty for skirting the gutter)
  // so the pick sits in the middle of a forgiving window rather than on a knife edge.
  function bestLine(pins, hook) {
    const key = `${hook}|${pinsKey(pins)}`;
    if (lineCache.has(key)) return lineCache.get(key);
    const full = pins.length === 10;
    const xs = pins.map((p) => p.x);
    // a full rack is played into the 1-3 pocket (right of the head pin, where the hook comes from)
    const lo = full ? -0.02 : Math.max(-LANE_HALF + 0.03, Math.min(...xs) - 0.2);
    const hi = full ? 0.18 : Math.min(LANE_HALF - 0.03, Math.max(...xs) + 0.2);
    // A full rack: right-hander's hook into the 1-3 pocket. Spares: straight, cross-lane.
    const spin = full ? -hook : 0;
    const mid = (lo + hi) / 2;
    const startX = full ? 0.45 : clamp((-mid / LANE_HALF) * 0.9, -0.8, 0.8);
    const power = full ? 0.6 : 0.8;
    const N = full ? 50 : 40;
    const step = (hi - lo) / N;
    const cands = [];
    for (let i = 0; i <= N; i++) {
      const tx = lo + step * i;
      const inp = normInput({ x: startX, aim: solveAim(startX, power, spin, tx), power, spin });
      const res = simulate(pins, inp);
      const margin = edgeMargin(inp);
      cands.push({ inp, n: res && margin >= 0 ? res.knocked.length : 0, margin });
    }
    const K = Math.max(2, Math.round(0.05 / step));
    const scores = cands.map((c, i) => {
      let s = 0; let w = 0;
      for (let k = -K; k <= K; k++) {
        const o = cands[i + k];
        const wt = K + 1 - Math.abs(k);
        s += (o ? o.n : 0) * wt; w += wt;
      }
      return s / w - (c.margin < 0.12 ? (0.12 - c.margin) * 25 : 0);
    });
    // the middle of the longest run of top-scoring candidates
    const top = Math.max(...scores);
    let run = null;
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] < top - 1e-9) continue;
      let k = i;
      while (k + 1 < scores.length && scores[k + 1] > top - 1e-9) k++;
      if (!run || k - i > run[1] - run[0]) run = [i, k];
      i = k;
    }
    const best = cands[Math.round((run[0] + run[1]) / 2)].inp;
    if (lineCache.size > 400) lineCache.clear();
    lineCache.set(key, best);
    return best;
  }

  // A noisy roll for a bot at these standing pins. `rand` defaults to Math.random.
  function botRoll(pins, level, rand) {
    rand = rand || Math.random;
    const L = BOT[level] || BOT.hard;
    if (L.gutter && rand() < L.gutter) {
      const side = rand() < 0.5 ? -1 : 1;
      return normInput({ x: side * (0.4 + rand() * 0.5), aim: side * (0.6 + rand() * 0.4), power: rand(), spin: side * rand() * 0.5 });
    }
    const base = bestLine(pins, L.hook);
    return normInput({
      x: base.x + gauss(rand) * L.x,
      aim: base.aim + gauss(rand) * L.aim,
      power: base.power + gauss(rand) * L.power,
      spin: base.spin + gauss(rand) * L.spin,
    });
  }

  const api = {
    LANE_HALF, GUTTER_W, KICK_X, PIN_Z0, PIN_SP, ROW_DZ, DECK_END, PIT_Z, BALL_R, PIN_R, PIN_H,
    START_MAX, MAX_SLOPE, FPS, SPOTS, HOOK_START,
    normInput, rack, launch, ballPath, crossX, simulate, isSplit,
    frameDone, scoreFrames, knownTotal, frameMarks, nextIsFresh,
    solveAim, bestLine, botRoll, BOT_LEVELS: Object.keys(BOT),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BowlingSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
