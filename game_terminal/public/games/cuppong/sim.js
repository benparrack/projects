// Cup Pong — shared throw physics. Loaded by the browser as a plain <script> (window.CupPongSim)
// and by the server with require() (server/games/cuppong.js), so a throw resolves the same way for
// the thrower's instant local preview, the authoritative server result and the bots' aiming.
//
// Frame: every throw is simulated in the THROWER's frame — table surface at y = 0, the thrower's
// edge at z = 0, the far edge at z = TABLE_L, x across the table (+x = thrower's right). The ball
// leaves the hand above the near edge; the target cups stand in a triangle at the far end. A cup
// is a truncated cone (open top, rim radius CUP_R at height CUP_H). The ball is sunk once its
// centre drops through the rim plane inside the opening; it can rattle off the rim, bounce off the
// table, glance off cup walls, or roll/fly off the end.
//
// A throw input is { aim, power }: aim in [-1, 1] turns the throw left/right, power in [0, 1]
// sets launch speed (fixed elevation). Inputs are quantized so client and server agree exactly.

(function (root) {
  'use strict';

  const TABLE_L = 2.44; // 8 ft table
  const TABLE_W = 0.7;
  const CUP_R = 0.05; // rim radius
  const CUP_RB = 0.033; // base radius
  const CUP_H = 0.12;
  const BALL_R = 0.017;
  const G = 9.81;
  const DRAG = 0.12; // light linear air drag (1/s)
  const DT = 1 / 480; // physics step
  const FRAME_EVERY = 8; // record a frame every 8 steps = 60 fps playback
  const MAX_T = 3.2; // seconds
  const LAUNCH = { x: 0, y: 0.42, z: -0.12 };
  const ELEV = (52 * Math.PI) / 180;
  const V_MIN = 4.45;
  const V_MAX = 5.25;
  const MAX_YAW = 0.15; // radians either side
  const E_TABLE = 0.62;
  const E_RIM = 0.45;
  const E_WALL = 0.35;
  const SPACING = CUP_R * 2 + 0.004;
  const ROW_DZ = SPACING * Math.sqrt(3) / 2;
  const BACK_Z = TABLE_L - CUP_R - 0.03;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const q = (v, step) => Math.round(v / step) * step;

  function normInput(input) {
    const aim = Number(input && input.aim);
    const power = Number(input && input.power);
    if (!Number.isFinite(aim) || !Number.isFinite(power)) return null;
    return { aim: q(clamp(aim, -1, 1), 0.0005), power: q(clamp(power, 0, 1), 0.0005) };
  }

  // Triangle rack with the apex toward the thrower: rows of 4,3,2,1 from the back (10 cups), or
  // any smaller triangle. Returns [{id, x, z}] in the thrower's frame.
  function triangle(rows, startId) {
    const out = [];
    let id = startId || 0;
    for (let r = 0; r < rows; r++) {
      const n = rows - r;
      for (let k = 0; k < n; k++) {
        out.push({ id: id++, x: (k - (n - 1) / 2) * SPACING, z: BACK_Z - r * ROW_DZ });
      }
    }
    return out;
  }
  const fullRack = () => triangle(4, 0);

  // Re-rack the remaining cups into a tight formation (keeps their ids): 6 -> triangle of 3 rows,
  // 3 -> triangle of 2 rows, 2 -> a centred line ("zipper"), 1 -> centred at the back.
  function rerack(cups) {
    const n = cups.length;
    let spots;
    if (n === 6) spots = triangle(3);
    else if (n === 3) spots = triangle(2);
    else if (n === 2) spots = [{ x: 0, z: BACK_Z }, { x: 0, z: BACK_Z - SPACING }];
    else if (n === 1) spots = [{ x: 0, z: BACK_Z }];
    else return cups;
    const sorted = cups.slice().sort((a, b) => a.id - b.id);
    return sorted.map((c, i) => ({ id: c.id, x: spots[i].x, z: spots[i].z }));
  }

  function launchVelocity(input) {
    const v = V_MIN + (V_MAX - V_MIN) * input.power;
    const yaw = input.aim * MAX_YAW;
    const h = v * Math.cos(ELEV);
    return { x: h * Math.sin(yaw), y: v * Math.sin(ELEV), z: h * Math.cos(yaw) };
  }

  const r4 = (v) => Math.round(v * 10000) / 10000;

  // Simulates one throw at `cups`. Returns { outcome: 'sink'|'miss', cupId, frames: [[x,y,z]...],
  // events: [{ f, type: 'rim'|'table'|'wall'|'sink' }], sinkFrame } — frames at 60 fps.
  function simulate(cups, rawInput) {
    const input = normInput(rawInput);
    if (!input) return null;
    const p = { x: LAUNCH.x, y: LAUNCH.y, z: LAUNCH.z };
    const v = launchVelocity(input);
    const frames = [[r4(p.x), r4(p.y), r4(p.z)]];
    const events = [];
    const lastHit = {};
    const ev = (type, key, step) => {
      // one event per contact, not per step while touching
      if (lastHit[key] != null && step - lastHit[key] < 20) { lastHit[key] = step; return; }
      lastHit[key] = step;
      events.push({ f: Math.ceil(step / FRAME_EVERY), type });
    };
    const steps = Math.round(MAX_T / DT);
    let rolling = 0;
    for (let s = 1; s <= steps; s++) {
      const prevY = p.y;
      v.y -= G * DT;
      v.x -= v.x * DRAG * DT;
      v.y -= v.y * DRAG * DT;
      v.z -= v.z * DRAG * DT;
      p.x += v.x * DT;
      p.y += v.y * DT;
      p.z += v.z * DT;

      for (const c of cups) {
        const dx = p.x - c.x;
        const dz = p.z - c.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > CUP_R + BALL_R * 2) continue;
        // Sink: centre crosses the rim plane downward inside the opening.
        if (prevY >= CUP_H && p.y < CUP_H && d < CUP_R - BALL_R * 0.6 && v.y < 0) {
          frames.push([r4(c.x + dx * 0.5), r4(CUP_H - 0.03), r4(c.z + dz * 0.5)]);
          const f = frames.length - 1;
          events.push({ f, type: 'sink' });
          return { outcome: 'sink', cupId: c.id, frames, events, sinkFrame: f, input };
        }
        // Rim: closest point on the rim circle.
        if (d > 1e-9) {
          const rx = c.x + (dx / d) * CUP_R;
          const rz = c.z + (dz / d) * CUP_R;
          const nx = p.x - rx;
          const ny = p.y - CUP_H;
          const nz = p.z - rz;
          const nd = Math.sqrt(nx * nx + ny * ny + nz * nz);
          if (nd < BALL_R && nd > 1e-9) {
            const ux = nx / nd; const uy = ny / nd; const uz = nz / nd;
            const vn = v.x * ux + v.y * uy + v.z * uz;
            if (vn < 0) {
              v.x -= (1 + E_RIM) * vn * ux;
              v.y -= (1 + E_RIM) * vn * uy;
              v.z -= (1 + E_RIM) * vn * uz;
              ev('rim', `r${c.id}`, s);
            }
            const push = BALL_R - nd;
            p.x += ux * push; p.y += uy * push; p.z += uz * push;
            continue;
          }
        }
        // Outer wall (cone), below the rim.
        if (p.y < CUP_H && p.y > 0 && d > 1e-9) {
          const wr = CUP_RB + (CUP_R - CUP_RB) * (p.y / CUP_H);
          if (d < wr + BALL_R && d > wr - BALL_R) {
            const ux = dx / d; const uz = dz / d;
            const vn = v.x * ux + v.z * uz;
            if (vn < 0) {
              v.x -= (1 + E_WALL) * vn * ux;
              v.z -= (1 + E_WALL) * vn * uz;
              ev('wall', `w${c.id}`, s);
            }
            const push = wr + BALL_R - d;
            p.x += ux * push; p.z += uz * push;
          }
        }
      }

      // Table.
      const onTable = Math.abs(p.x) <= TABLE_W / 2 && p.z >= 0 && p.z <= TABLE_L;
      if (onTable && p.y < BALL_R && prevY >= BALL_R - 0.002) {
        p.y = BALL_R;
        if (v.y < -0.35) {
          v.y = -v.y * E_TABLE;
          v.x *= 0.92; v.z *= 0.92;
          ev('table', 'table', s);
        } else {
          v.y = 0;
          v.x *= 1 - 1.8 * DT; v.z *= 1 - 1.8 * DT;
          rolling++;
        }
      }

      if (s % FRAME_EVERY === 0) frames.push([r4(p.x), r4(p.y), r4(p.z)]);
      if (p.y < -0.6) break; // off the table and gone
      if (rolling > 0 && Math.hypot(v.x, v.z) < 0.08) break; // dead on the table
    }
    frames.push([r4(p.x), r4(p.y), r4(p.z)]);
    return { outcome: 'miss', cupId: null, frames, events, sinkFrame: -1, input };
  }

  // ---- Bots ---------------------------------------------------------------------------------
  // Aim solver: the (aim, power) whose ballistic path (no collisions) passes through the rim
  // plane at the cup centre. Yaw first (straight line), then bisect power on downrange distance.
  function crossing(input) {
    const v = launchVelocity(input);
    const p = { x: LAUNCH.x, y: LAUNCH.y, z: LAUNCH.z };
    for (let t = 0; t < MAX_T; t += DT) {
      const prevY = p.y;
      v.y -= G * DT;
      v.x -= v.x * DRAG * DT; v.y -= v.y * DRAG * DT; v.z -= v.z * DRAG * DT;
      p.x += v.x * DT; p.y += v.y * DT; p.z += v.z * DT;
      if (prevY >= CUP_H && p.y < CUP_H && v.y < 0) return { x: p.x, z: p.z };
    }
    return null;
  }

  function solveAim(cup) {
    let aim = clamp(Math.atan2(cup.x - LAUNCH.x, cup.z - LAUNCH.z) / MAX_YAW, -1, 1);
    let power = 0.5;
    for (let iter = 0; iter < 3; iter++) {
      let lo = 0; let hi = 1;
      for (let k = 0; k < 22; k++) {
        const mid = (lo + hi) / 2;
        const c = crossing({ aim, power: mid });
        const dist = c ? Math.hypot(c.x - LAUNCH.x, c.z - LAUNCH.z) : 0;
        if (dist < Math.hypot(cup.x - LAUNCH.x, cup.z - LAUNCH.z)) lo = mid; else hi = mid;
      }
      power = (lo + hi) / 2;
      const c = crossing({ aim, power });
      if (!c) break;
      // correct yaw for the small drag/curvature error
      const errYaw = Math.atan2(cup.x - LAUNCH.x, cup.z - LAUNCH.z) - Math.atan2(c.x - LAUNCH.x, c.z - LAUNCH.z);
      aim = clamp(aim + errYaw / MAX_YAW, -1, 1);
    }
    return { aim, power };
  }

  // Level noise is a standard deviation in input units (aim, power). Measured make rates
  // (test/cuppong.test.js): roughly easy 17%, medium 32%, hard 50%, expert 70%.
  const BOT = {
    easy: { aim: 0.5, power: 0.25, pick: 'random' },
    medium: { aim: 0.24, power: 0.12, pick: 'random' },
    hard: { aim: 0.11, power: 0.055, pick: 'cluster' },
    expert: { aim: 0.065, power: 0.0325, pick: 'cluster' },
  };

  function gauss(rand) {
    let u = 0; let w = 0;
    while (u === 0) u = rand();
    while (w === 0) w = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
  }

  // Picks a target cup and returns a noisy throw input. `rand` defaults to Math.random.
  function botThrow(cups, level, rand) {
    rand = rand || Math.random;
    const L = BOT[level] || BOT.hard;
    let target;
    if (L.pick === 'cluster') {
      // the cup with the most neighbours: a near miss still tends to drop into another cup
      let best = -1;
      for (const c of cups) {
        const n = cups.filter((o) => o !== c && Math.hypot(o.x - c.x, o.z - c.z) < SPACING * 1.2).length;
        const score = n * 10 - Math.abs(c.x) * 5 + rand();
        if (score > best) { best = score; target = c; }
      }
    } else {
      target = cups[Math.floor(rand() * cups.length)];
    }
    const base = solveAim(target);
    return normInput({ aim: base.aim + gauss(rand) * L.aim, power: base.power + gauss(rand) * L.power });
  }

  const api = {
    TABLE_L, TABLE_W, CUP_R, CUP_RB, CUP_H, BALL_R, LAUNCH, MAX_YAW, ELEV, V_MIN, V_MAX,
    normInput, fullRack, rerack, launchVelocity, simulate, solveAim, botThrow, BOT_LEVELS: Object.keys(BOT),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CupPongSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
