// Skee-Ball — shared roll physics. Loaded by the browser as a plain <script> (window.SkeeBallSim)
// and by the server with require() (server/games/skeeball.js), so a roll resolves identically for
// the roller's instant local preview, the authoritative server result and the bots' aiming.
//
// World frame (metres): the lane runs along +z from the foul line (z = 0) to the ramp, x across
// the lane, y up. The ball rolls up the lane (decelerating: the lane is inclined and has rolling
// friction), rides the hump at RAMP_Z and is launched into the air over the pit toward the target
// board — an inclined plane (angle THETA) rising away from the player.
//
// Board frame: u = x (across), w = distance up the slope from the board's bottom edge, h = height
// above the board surface along its normal. On the board are concentric circular lips (raised
// rings) around a centre at (0, WC). The ball is trapped by the lips while on the surface, so it
// rolls down to the bottom of whatever ring channel it landed in and drops into that ring's hole
// (10/20/30/40); inside the centre lip it drops straight into the 50 cup. The two 100 pockets sit
// in the top corners outside the rings. Anything landing outside the rings (or short, in the pit)
// rolls into the gutter for 0. The back wall stops long rolls, dropping them back onto the top of
// the board — where the 100 pockets are.
//
// A roll input is { aim, power }: aim in [-1, 1] steers left/right, power in [0, 1] sets the
// release speed. Inputs are quantized so client and server agree exactly.

(function (root) {
  'use strict';

  const G = 9.81;
  const BALL_R = 0.03;
  const LANE_W = 0.6; // |x| <= LANE_W / 2
  const RAMP_Z = 2.3; // top of the hump
  const RAMP_LEN = 0.22;
  const RAMP_H = 0.07;
  const LAUNCH_ANG = (32 * Math.PI) / 180;
  const LANE_DECEL = 0.75; // m/s² while rolling up the lane (incline + friction)
  const V_MIN = 2.4;
  const V_MAX = 5.1;
  const MAX_SLOPE = 0.13; // |vx / vz| at full aim

  // Target board.
  const THETA = (38 * Math.PI) / 180;
  const ORIGIN = { y: 0.12, z: 2.62 }; // world position of the board's bottom edge (u = 0, w = 0)
  const BOARD_W = 0.9; // |u| <= BOARD_W / 2
  const BOARD_H = 0.98; // back wall at w = BOARD_H
  const WC = 0.46; // ring centre (w)
  const LIP_H = 0.03;
  // Lip radii, innermost first: the 50 cup rim, then the outer edges of the 40/30/20/10 channels.
  const RINGS = [0.06, 0.13, 0.2, 0.27, 0.34];
  const RING_POINTS = [50, 40, 30, 20, 10];
  const HOLE_R = 0.03; // capture radius of a channel hole (bottom of the channel)
  const POCKETS = [{ id: 'L', u: -0.3, w: 0.87 }, { id: 'R', u: 0.3, w: 0.87 }];
  const POCKET_R = 0.036;
  const POCKET_V = 0.3; // max surface speed (m/s) at which a 100 pocket still catches the ball

  const E_LANE_WALL = 0.55;
  const E_BOARD = 0.32;
  const E_LIP = 0.45;
  const E_BACK = 0.4;
  const E_SIDE = 0.5;
  const HOP_V = 0.7; // normal speed (m/s) above which a rolling ball hops a lip instead of bouncing
  const HOP_KICK = 0.55;
  const HOP_KEEP = 0.9;
  const NUDGE = 0.9; // min tangential accel (m/s²) along a lip, so a ball never balances on one

  const DT = 1 / 480;
  const FRAME_EVERY = 8; // 60 fps playback
  const MAX_T = 7;

  const sinT = Math.sin(THETA);
  const cosT = Math.cos(THETA);

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const q = (v, step) => Math.round(v / step) * step;
  const r4 = (v) => Math.round(v * 10000) / 10000;

  function normInput(input) {
    const aim = input && input.aim;
    const power = input && input.power;
    if (!Number.isFinite(aim) || !Number.isFinite(power)) return null; // numbers only: no '', null, [1] coercion
    return { aim: q(clamp(aim, -1, 1), 0.0005), power: q(clamp(power, 0, 1), 0.0005) };
  }

  // board (u, w, h) -> world [x, y, z]
  function boardToWorld(u, w, h) {
    return [u, ORIGIN.y + w * sinT + h * cosT, ORIGIN.z + w * cosT - h * sinT];
  }
  function worldToBoard(x, y, z) {
    const dy = y - ORIGIN.y;
    const dz = z - ORIGIN.z;
    return { u: x, w: dy * sinT + dz * cosT, h: dy * cosT - dz * sinT };
  }

  // Centre of the hole at the bottom of each channel, and of the 50 cup.
  function holeSpots() {
    const out = [{ points: 50, u: 0, w: WC, r: RINGS[0] }];
    for (let k = 1; k < RINGS.length; k++) {
      out.push({ points: RING_POINTS[k], u: 0, w: WC - (RINGS[k - 1] + RINGS[k]) / 2, r: HOLE_R });
    }
    for (const p of POCKETS) out.push({ points: 100, u: p.u, w: p.w, r: POCKET_R, pocket: p.id });
    return out;
  }

  // Simulates one roll. Returns { outcome: 'score'|'gutter', points, hole (e.g. 50, 'L', 'R'),
  // reason ('short'|'pit'|'off'|null), frames: [[x,y,z]...] world at 60 fps, events: [{ f, type }]
  // with type 'roll'|'wall'|'ramp'|'board'|'rim'|'back'|'drop'|'gutter', dropFrame }.
  function simulate(rawInput) {
    const input = normInput(rawInput);
    if (!input) return null;
    const frames = [];
    const events = [];
    const lastHit = {};
    let step = 0;
    const fr = () => Math.ceil(step / FRAME_EVERY);
    const ev = (type, key) => {
      if (key) {
        if (lastHit[key] != null && step - lastHit[key] < 24) { lastHit[key] = step; return; }
        lastHit[key] = step;
      }
      events.push({ f: fr(), type });
    };
    const push = (p) => frames.push([r4(p[0]), r4(p[1]), r4(p[2])]);
    const done = (outcome, points, hole, reason) => ({
      outcome, points, hole, reason, frames, events, dropFrame: outcome === 'score' ? dropFrame : -1, input,
    });
    let dropFrame = -1;

    // ---- lane ----
    const speed0 = V_MIN + (V_MAX - V_MIN) * input.power;
    let vz = speed0 / Math.sqrt(1 + (input.aim * MAX_SLOPE) ** 2);
    let vx = vz * input.aim * MAX_SLOPE;
    let x = 0;
    let z = 0;
    const laneY = () => {
      const t = (z - (RAMP_Z - RAMP_LEN)) / RAMP_LEN;
      return BALL_R + (t <= 0 ? 0 : RAMP_H * Math.min(1, t) * Math.min(1, t));
    };
    push([x, laneY(), z]);
    ev('roll');
    const XMAX = LANE_W / 2 - BALL_R;
    let back = false;
    while (z < RAMP_Z) {
      step++;
      const sp = Math.hypot(vx, vz);
      if (!back) {
        // decelerate along the direction of travel
        const nsp = sp - LANE_DECEL * DT;
        if (vz <= 0.02 || nsp <= 0) { back = true; vx *= 0.3; vz = 0; } else { vx *= nsp / sp; vz *= nsp / sp; }
      } else {
        vz -= 0.45 * DT; // rolls back down the lane
      }
      x += vx * DT;
      z += vz * DT;
      if (Math.abs(x) > XMAX) {
        x = Math.sign(x) * XMAX;
        vx = -vx * E_LANE_WALL;
        ev('wall', 'lanewall');
      }
      if (step % FRAME_EVERY === 0) push([x, laneY(), z]);
      if (back && (z < RAMP_Z - 1.0 || step * DT > 4)) {
        push([x, laneY(), z]);
        return done('gutter', 0, null, 'short');
      }
    }

    // ---- launch off the hump ----
    ev('ramp');
    const wy = vz * Math.sin(LAUNCH_ANG);
    const vzW = vz * Math.cos(LAUNCH_ANG);
    // into board coordinates
    const p = worldToBoard(x, BALL_R + RAMP_H, z);
    let u = p.u;
    let w = p.w;
    let h = p.h;
    let vu = vx;
    let vw = wy * sinT + vzW * cosT;
    let vh = wy * cosT - vzW * sinT;
    const gw = -G * sinT;
    const gh = -G * cosT;
    const UMAX = BOARD_W / 2 - BALL_R;
    const holes = holeSpots();
    const limit = Math.round(MAX_T / DT);
    let onBoard = false;
    let hopping = -1; // lip the ball is currently hopping over

    while (step < limit) {
      step++;
      vw += gw * DT;
      vh += gh * DT;
      u += vu * DT;
      w += vw * DT;
      h += vh * DT;

      if (w < -BALL_R * 0.5) {
        // over the pit (fell short, or rolled off the bottom edge): drop out of sight
        if (h < BALL_R || onBoard) {
          const reason = onBoard ? 'off' : 'pit';
          ev('gutter');
          let [wx, wyy, wz] = boardToWorld(u, w, h);
          let fy = 0;
          let fz = (vw * cosT - vh * sinT) * 0.5;
          for (let k = 0; k < 24; k++) {
            fy -= G / 60;
            wyy += fy / 60;
            wz += fz / 60;
            wx += vu / 60;
            frames.push([r4(wx), r4(wyy), r4(wz)]);
          }
          return done('gutter', 0, null, reason);
        }
      } else {
        // side + back walls (the cabinet)
        if (Math.abs(u) > UMAX) {
          u = Math.sign(u) * UMAX;
          vu = -vu * E_SIDE;
          ev('back', 'side');
        }
        if (w > BOARD_H - BALL_R) {
          w = BOARD_H - BALL_R;
          if (vw > 0) vw = -vw * E_BACK;
          ev('back', 'back');
        }
        // lips (only reachable when low enough to touch them)
        if (h < BALL_R + LIP_H) {
          const du = u;
          const dw = w - WC;
          const d = Math.hypot(du, dw);
          for (let k = 0; k < RINGS.length; k++) {
            const R = RINGS[k];
            const gap = d - R;
            if (Math.abs(gap) >= BALL_R) { if (hopping === k) hopping = -1; continue; }
            if (hopping === k || d < 1e-9) continue;
            {
              const s = gap >= 0 ? 1 : -1;
              const nu = (du / d) * s;
              const nw = (dw / d) * s;
              const vn = vu * nu + vw * nw;
              if (vn < -HOP_V && vw > 0.15) {
                // fast enough to ride up over the lip: it kicks the ball into a little hop
                hopping = k;
                vh = Math.max(vh, -vn * HOP_KICK);
                vu *= HOP_KEEP; vw *= HOP_KEEP;
                ev('rim', `r${k}`);
                break;
              }
              if (vn < 0) {
                vu -= (1 + E_LIP) * vn * nu;
                vw -= (1 + E_LIP) * vn * nw;
                vu *= 0.97; vw *= 0.97;
                if (vn < -0.25) ev('rim', `r${k}`);
              }
              if (h < BALL_R + 0.002) {
                // rolling along the lip: gravity's component along it, but never ~0 (top of a ring)
                let tu = -nw; let tw = nu;
                let gt = tw * gw;
                if (gt < 0 || (gt === 0 && tu * (u || 1) < 0)) { tu = -tu; tw = -tw; gt = -gt; }
                if (gt < NUDGE) { vu += tu * (NUDGE - gt) * DT; vw += tw * (NUDGE - gt) * DT; }
              }
              const target = R + s * BALL_R;
              u = (du / d) * target;
              w = WC + (dw / d) * target;
              break;
            }
          }
        }
        // surface contact
        let landed = false;
        if (h < BALL_R) {
          h = BALL_R;
          if (vh < -0.35) {
            landed = true;
            vh = -vh * E_BOARD;
            vu *= 0.88; vw *= 0.88;
            ev('board', 'board');
          } else {
            vh = 0;
            const k = 1 - 0.9 * DT;
            vu *= k; vw *= k;
          }
          onBoard = true;
        }
        // holes (ball sitting low on the surface)
        if (h < BALL_R + 0.006) {
          for (const hole of holes) {
            const dist = Math.hypot(u - hole.u, w - hole.w);
            let capture = hole.points === 50 ? dist < hole.r - BALL_R * 0.35 : dist < hole.r;
            // a 100 pocket catches a ball dropping into it; a rolling one skips over unless it's slow
            if (capture && hole.pocket && !landed && Math.hypot(vu, vw) > POCKET_V) capture = false;
            if (capture) {
              push(boardToWorld(u, w, h));
              dropFrame = frames.length - 1;
              events.push({ f: dropFrame, type: 'drop' });
              // sink into the hole: slide to its centre and drop below the surface
              for (let k = 1; k <= 14; k++) {
                const t = k / 14;
                push(boardToWorld(u + (hole.u - u) * t, w + (hole.w - w) * t, BALL_R - t * 0.12));
              }
              return done('score', hole.points, hole.pocket || hole.points, null);
            }
          }
        }
      }
      if (step % FRAME_EVERY === 0) push(boardToWorld(u, w, h));
    }
    push(boardToWorld(u, w, h));
    return done('gutter', 0, null, 'off');
  }

  // ---- Bots ---------------------------------------------------------------------------------
  // The board never changes, so the aim for each target is found once by scanning the sim: for a
  // given aim, the widest run of powers that scores the target; the bot rolls at its middle.
  const TARGETS = { 50: { aim: 0, pts: 50 }, L: { aim: -0.72, pts: 100, pocket: 'L' }, R: { aim: 0.72, pts: 100, pocket: 'R' } };
  const solved = {};
  function hits(res, t) {
    if (!res || res.outcome !== 'score') return false;
    return t.pocket ? res.hole === t.pocket : res.points === t.pts;
  }
  function solve(key) {
    if (solved[key]) return solved[key];
    const t = TARGETS[key];
    let best = null;
    const aims = [];
    for (let a = -0.25; a <= 0.25001; a += 0.025) aims.push(t.aim + a);
    for (const aim of aims) {
      if (aim < -1 || aim > 1) continue;
      let run = 0;
      let start = 0;
      for (let i = 0; i <= 400; i++) {
        const power = i / 400;
        const ok = hits(simulate({ aim, power }), t);
        if (ok) { if (!run) start = power; run++; }
        if ((!ok || i === 400) && run) {
          const width = run / 400;
          // prefer wide power windows, then aims near the centre of the good aim band
          if (!best || width > best.width) best = { aim, power: start + (run - 1) / 800, width };
          run = 0;
        }
      }
    }
    // refine: centre the aim within the band that scores at that power
    if (best) {
      let lo = best.aim; let hi = best.aim;
      while (lo > -1 && hits(simulate({ aim: lo - 0.01, power: best.power }), t)) lo -= 0.01;
      while (hi < 1 && hits(simulate({ aim: hi + 0.01, power: best.power }), t)) hi += 0.01;
      best.aim = (lo + hi) / 2;
    }
    solved[key] = best ? normInput(best) : normInput({ aim: t.aim, power: 0.5 });
    return solved[key];
  }
  // solve() costs ~1.5 s per target, too slow to run on a live server: these are its results
  // (test/skeeball.test.js re-solves and checks they still match).
  const AIMS = { 50: { aim: 0, power: 0.4515 }, L: { aim: -0.535, power: 0.7635 }, R: { aim: 0.525, power: 0.7565 } };
  const aimFor = (key) => AIMS[key];

  // Noise is a standard deviation in input units. Expert goes for the 100 pockets. Measured
  // (test/skeeball.test.js) per 9 balls: easy ~150, medium ~280, hard ~390, expert ~610 (68% 100s).
  const BOT = {
    easy: { aim: 0.45, power: 0.22, target: () => '50' },
    medium: { aim: 0.22, power: 0.1, target: () => '50' },
    hard: { aim: 0.1, power: 0.045, target: () => '50' },
    expert: { aim: 0.06, power: 0.024, target: (rand) => (rand() < 0.5 ? 'L' : 'R') },
  };

  function gauss(rand) {
    let a = 0; let b = 0;
    while (a === 0) a = rand();
    while (b === 0) b = rand();
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
  }

  // Returns a noisy roll input for the level. `rand` defaults to Math.random.
  function botRoll(level, rand) {
    rand = rand || Math.random;
    const L = BOT[level] || BOT.hard;
    const base = aimFor(L.target(rand));
    return normInput({ aim: base.aim + gauss(rand) * L.aim, power: base.power + gauss(rand) * L.power });
  }

  const api = {
    BALL_R, LANE_W, RAMP_Z, RAMP_LEN, RAMP_H, THETA, ORIGIN, BOARD_W, BOARD_H, WC, LIP_H, RINGS, RING_POINTS,
    HOLE_R, POCKETS, POCKET_R, V_MIN, V_MAX, MAX_SLOPE,
    normInput, simulate, boardToWorld, worldToBoard, holeSpots, aimFor, solve, botRoll, BOT_LEVELS: Object.keys(BOT),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SkeeBallSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
