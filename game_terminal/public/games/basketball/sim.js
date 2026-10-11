// Basketball (GamePigeon style) — shared shot physics + run scoring. Loaded by the browser as a
// plain <script> (window.BasketballSim) and by the server with require() (server/games/
// basketball.js), so a shot resolves identically for the shooter's instant local preview, the
// authoritative server result, the spectators' replay and the bots' aiming.
//
// World (metres): x across the court (+x = shooter's right), y up (floor at 0), z away from the
// shooter toward the hoop. The ball leaves the hand at LAUNCH; the rim is a horizontal circle
// (torus of tube radius TUBE) centred at (hoopX, RIM_Y, RIM_Z) in front of a backboard whose face
// is the plane z = BOARD_Z. The whole hoop unit slides side to side once the shooter has made
// enough baskets in the run: its x is a pure function of the run clock and the run's motion
// schedule (`sched`, a list of {t, amp, period} segments), so every client draws it in sync.
//
// A shot input is { aim, power }: aim in [-1, 1] turns the shot left/right, power in [0, 1] sets
// the launch speed (fixed elevation). Inputs are quantized so client and server agree exactly.
// `at` is the release time in ms since the run started (the hoop's position depends on it).

(function (root) {
  'use strict';

  const G = 9.81;
  const DT = 1 / 480; // physics step (s)
  const FRAME_EVERY = 8; // one recorded frame every 8 steps = 60 fps playback
  const FRAME_MS = 1000 / 60;
  const MAX_T = 2.6; // s
  const DRAG = 0.05;

  const BALL_R = 0.12;
  const RIM_R = 0.23;
  const TUBE = 0.012;
  const RIM_Y = 3.05;
  const RIM_Z = 3.6;
  const BOARD_Z = RIM_Z + RIM_R + 0.15; // backboard face
  const BOARD_W = 1.8;
  const BOARD_BOTTOM = 2.9;
  const BOARD_TOP = 3.95;
  const NET_DEPTH = 0.42;
  const LAUNCH = { x: 0, y: 1.1, z: 0 };
  const ELEV = (66 * Math.PI) / 180;
  const V_MIN = 6.8;
  const V_MAX = 9.0;
  const MAX_YAW = 0.3; // radians either side
  const E_RIM = 0.5;
  const E_BOARD = 0.72;
  const E_FLOOR = 0.62;

  // Run rules.
  const RUN_MS = 30000;
  const OT_MS = 15000;
  const COOLDOWN_MS = 450; // next ball rolls into the hand
  const MONEY_EVERY = 5; // every 5th ball of the rack is the money ball (x2)
  const FIRE_AT = 3; // 3 makes in a row -> ON FIRE (x2 until a miss)
  const RAMP_MS = 900; // the hoop eases into a new speed
  // Hoop motion levels, unlocked by makes in the run.
  const LEVELS = [
    { makes: 0, amp: 0, period: 0 },
    { makes: 5, amp: 0.45, period: 3400 },
    { makes: 12, amp: 0.8, period: 2600 },
  ];

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const q = (v, step) => Math.round(v / step) * step;
  const r4 = (v) => Math.round(v * 10000) / 10000;

  function normInput(input) {
    const aim = Number(input && input.aim);
    const power = Number(input && input.power);
    if (!Number.isFinite(aim) || !Number.isFinite(power)) return null;
    return { aim: q(clamp(aim, -1, 1), 0.0005), power: q(clamp(power, 0, 1), 0.0005) };
  }

  // Hoop x at run time t (ms). Phase is continuous across segments and the amplitude ramps in,
  // so the hoop never jumps.
  function hoopX(sched, t) {
    if (!sched || !sched.length || !(t > 0)) return 0;
    let phase = 0;
    let amp = 0;
    for (let i = 0; i < sched.length; i++) {
      const s = sched[i];
      if (t < s.t) break;
      const end = i + 1 < sched.length ? Math.min(t, sched[i + 1].t) : t;
      const dt = Math.max(0, end - s.t);
      const w = s.period ? (2 * Math.PI) / s.period : 0;
      phase += w * dt;
      amp += (s.amp - amp) * Math.min(1, dt / RAMP_MS);
      if (end >= t) break;
    }
    return amp * Math.sin(phase);
  }

  function launchVelocity(input) {
    const v = V_MIN + (V_MAX - V_MIN) * input.power;
    const yaw = input.aim * MAX_YAW;
    const h = v * Math.cos(ELEV);
    return { x: h * Math.sin(yaw), y: v * Math.sin(ELEV), z: h * Math.cos(yaw) };
  }

  // Simulates one shot released at run time `at` against the hoop schedule `sched`. Returns
  // { input, at, made, swish, makeFrame, frames: [[x,y,z]...], events: [{f, type}] } with events
  // 'rim' | 'board' | 'floor' | 'make'; frames are at 60 fps from the release.
  function simulate(sched, rawInput, rawAt) {
    const input = normInput(rawInput);
    const at = Math.round(Number(rawAt));
    if (!input || !Number.isFinite(at)) return null;
    const p = { x: LAUNCH.x, y: LAUNCH.y, z: LAUNCH.z };
    const v = launchVelocity(input);
    const frames = [[r4(p.x), r4(p.y), r4(p.z)]];
    const events = [];
    const lastHit = {};
    const ev = (type, step) => {
      if (lastHit[type] != null && step - lastHit[type] < 24) { lastHit[type] = step; return; }
      lastHit[type] = step;
      events.push({ f: Math.ceil(step / FRAME_EVERY), type });
    };
    let made = false;
    let touched = false;
    let makeFrame = -1;
    let netSteps = 0;
    let floorHits = 0;
    const steps = Math.round(MAX_T / DT);
    for (let s = 1; s <= steps; s++) {
      const t = at + s * DT * 1000;
      const hx = hoopX(sched, t);
      const hvx = (hoopX(sched, t + 1) - hoopX(sched, t - 1)) * 500; // m/s
      const prevY = p.y;
      const prevZ = p.z;
      v.y -= G * DT;
      v.x -= v.x * DRAG * DT;
      v.y -= v.y * DRAG * DT;
      v.z -= v.z * DRAG * DT;

      if (made && netSteps > 0) {
        // through the net: it grabs the ball, slows it and pulls it to the hoop's centre
        netSteps--;
        v.y = Math.max(v.y, -2.6);
        v.x += ((hx - p.x) * 30 + (hvx - v.x) * 6) * DT;
        v.z += ((RIM_Z - p.z) * 30 - v.z * 6) * DT;
      }
      p.x += v.x * DT;
      p.y += v.y * DT;
      p.z += v.z * DT;

      if (!made) {
        // make: the centre drops through the rim plane inside the ring
        const dx = p.x - hx;
        const dz = p.z - RIM_Z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (prevY >= RIM_Y && p.y < RIM_Y && v.y < 0 && d < RIM_R - TUBE - 0.015) {
          made = true;
          makeFrame = Math.ceil(s / FRAME_EVERY);
          events.push({ f: makeFrame, type: 'make' });
          netSteps = Math.round(0.3 / DT);
        } else {
          // rim: closest point on the ring
          if (d > 1e-9 && Math.abs(p.y - RIM_Y) < BALL_R + TUBE + 0.01) {
            const rx = hx + (dx / d) * RIM_R;
            const rz = RIM_Z + (dz / d) * RIM_R;
            const nx = p.x - rx;
            const ny = p.y - RIM_Y;
            const nz = p.z - rz;
            const nd = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (nd < BALL_R + TUBE && nd > 1e-9) {
              const ux = nx / nd; const uy = ny / nd; const uz = nz / nd;
              const rvx = v.x - hvx;
              const vn = rvx * ux + v.y * uy + v.z * uz;
              if (vn < 0) {
                v.x -= (1 + E_RIM) * vn * ux;
                v.y -= (1 + E_RIM) * vn * uy;
                v.z -= (1 + E_RIM) * vn * uz;
                // a little rim friction
                v.x = hvx + (v.x - hvx) * 0.94; v.z *= 0.94;
                ev('rim', s);
                touched = true;
              }
              const push = BALL_R + TUBE - nd;
              p.x += ux * push; p.y += uy * push; p.z += uz * push;
            }
          }
          // backboard face
          if (p.z + BALL_R > BOARD_Z && prevZ + BALL_R <= BOARD_Z + 0.05 && v.z > 0
            && Math.abs(p.x - hx) < BOARD_W / 2 + BALL_R * 0.5
            && p.y > BOARD_BOTTOM - BALL_R * 0.5 && p.y < BOARD_TOP + BALL_R * 0.5) {
            p.z = BOARD_Z - BALL_R;
            v.z = -v.z * E_BOARD;
            v.x = hvx + (v.x - hvx) * 0.85;
            v.y *= 0.9;
            ev('board', s);
            touched = true;
          }
        }
      }

      // floor
      if (p.y < BALL_R && prevY >= BALL_R - 0.001) {
        p.y = BALL_R;
        if (v.y < -0.6) {
          v.y = -v.y * E_FLOOR;
          v.x *= 0.85; v.z *= 0.85;
          ev('floor', s);
          floorHits++;
        } else v.y = 0;
      }

      if (s % FRAME_EVERY === 0) frames.push([r4(p.x), r4(p.y), r4(p.z)]);
      if (floorHits >= 2) break;
      if (Math.abs(p.x) > 6 || p.z > BOARD_Z + 3 || p.z < -3) break;
    }
    frames.push([r4(p.x), r4(p.y), r4(p.z)]);
    return { input, at, made, swish: made && !touched, makeFrame, frames, events };
  }

  // ---- runs & scoring -------------------------------------------------------------------------
  function newRun(lengthMs) {
    return {
      length: lengthMs || RUN_MS,
      score: 0, makes: 0, shots: 0, streak: 0, bestStreak: 0, swishes: 0,
      ballNo: 0, lastAt: -1e9, flightEnd: 0, level: 0,
      sched: [{ t: 0, amp: 0, period: 0 }],
    };
  }

  const isMoneyBall = (ballNo) => ballNo % MONEY_EVERY === MONEY_EVERY - 1;

  // Can a shot be released at run time `at`? Returns null or a reject reason.
  function shotError(run, at) {
    if (!Number.isFinite(at)) return 'invalid';
    if (at < 0) return 'not_started';
    if (at > run.length) return 'time_up';
    if (at < run.lastAt + COOLDOWN_MS) return 'busy';
    return null;
  }

  // Applies a shot to the run (mutates it). Returns the shot record, or { error }.
  function shoot(run, rawInput, rawAt) {
    const at = Math.round(Number(rawAt));
    const err = shotError(run, at);
    if (err) return { error: err };
    const res = simulate(run.sched, rawInput, at);
    if (!res) return { error: 'invalid' };
    const money = isMoneyBall(run.ballNo);
    const fire = run.streak >= FIRE_AT;
    const rec = {
      at, input: res.input, frames: res.frames, events: res.events, made: res.made, swish: res.swish,
      makeFrame: res.makeFrame, ballNo: run.ballNo, money, fire, base: 0, mult: 1, points: 0,
      streak: 0, levelUp: 0, levelAt: 0,
    };
    run.ballNo++;
    run.shots++;
    run.lastAt = at;
    run.flightEnd = Math.max(run.flightEnd, Math.ceil(at + (res.frames.length - 1) * FRAME_MS));
    if (res.made) {
      rec.base = res.swish ? 3 : 2;
      rec.mult = (money ? 2 : 1) * (fire ? 2 : 1);
      rec.points = rec.base * rec.mult;
      run.score += rec.points;
      run.makes++;
      run.streak++;
      if (res.swish) run.swishes++;
      run.bestStreak = Math.max(run.bestStreak, run.streak);
      const next = LEVELS[run.level + 1];
      if (next && run.makes >= next.makes) {
        // the hoop starts moving (faster) once every ball already in the air has landed, so no
        // shot ever resolved against a hoop that later changes under it
        run.level++;
        const start = Math.max(run.flightEnd, Math.ceil(at + res.makeFrame * FRAME_MS + 300));
        run.sched.push({ t: start, amp: next.amp, period: next.period });
        rec.levelUp = run.level;
        rec.levelAt = start;
      }
    } else {
      run.streak = 0;
    }
    rec.streak = run.streak;
    return rec;
  }

  // ---- bots -----------------------------------------------------------------------------------
  // Ballistic crossing of the rim plane on the way down (no collisions): {x, z, t(s)} or null.
  function crossing(input) {
    const v = launchVelocity(input);
    const p = { x: LAUNCH.x, y: LAUNCH.y, z: LAUNCH.z };
    for (let t = 0; t < MAX_T; t += DT) {
      const prevY = p.y;
      v.y -= G * DT;
      v.x -= v.x * DRAG * DT; v.y -= v.y * DRAG * DT; v.z -= v.z * DRAG * DT;
      p.x += v.x * DT; p.y += v.y * DT; p.z += v.z * DT;
      if (prevY >= RIM_Y && p.y < RIM_Y && v.y < 0) return { x: p.x, z: p.z, t: t + DT };
    }
    return null;
  }

  // The (aim, power) that drops the ball through the centre of the hoop. `lead` (0..1) is how far
  // it anticipates a moving hoop: 1 aims where the hoop will be when the ball arrives, 0 where it
  // is now.
  function solveShot(sched, at, lead = 1) {
    lead = lead === true ? 1 : lead === false ? 0 : Number(lead) || 0;
    const now = hoopX(sched, at);
    let aim = 0;
    let power = 0.5;
    let tx = now;
    for (let iter = 0; iter < 4; iter++) {
      let lo = 0; let hi = 1;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        const c = crossing({ aim, power: mid });
        if (!c || c.z < RIM_Z) lo = mid; else hi = mid;
      }
      power = (lo + hi) / 2;
      const c = crossing({ aim, power });
      if (!c) break;
      tx = now + (hoopX(sched, at + c.t * 1000) - now) * lead;
      const want = Math.atan2(tx - LAUNCH.x, RIM_Z - LAUNCH.z);
      const got = Math.atan2(c.x - LAUNCH.x, c.z - LAUNCH.z);
      aim = clamp(aim + (want - got) / MAX_YAW, -1, 1);
    }
    return { aim, power };
  }

  // Noise is a standard deviation in input units; `gap` is the bot's ms between shots and `lead`
  // whether it anticipates a moving hoop. Measured make rates are in test/basketball.test.js.
  const BOT = {
    easy: { aim: 0.125, power: 0.062, gap: [1300, 1900], lead: 0.2 },
    medium: { aim: 0.075, power: 0.037, gap: [1050, 1450], lead: 0.65 },
    hard: { aim: 0.06, power: 0.03, gap: [850, 1150], lead: 0.9 },
    expert: { aim: 0.052, power: 0.026, gap: [700, 1000], lead: 1 },
  };

  function gauss(rand) {
    let u = 0; let w = 0;
    while (u === 0) u = rand();
    while (w === 0) w = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
  }

  function botShot(run, level, at, rand) {
    rand = rand || Math.random;
    const L = BOT[level] || BOT.hard;
    const base = solveShot(run.sched, at, L.lead);
    return normInput({ aim: base.aim + gauss(rand) * L.aim, power: base.power + gauss(rand) * L.power });
  }

  function botGap(level, rand) {
    rand = rand || Math.random;
    const L = BOT[level] || BOT.hard;
    return Math.round(L.gap[0] + rand() * (L.gap[1] - L.gap[0]));
  }

  const api = {
    G, FRAME_MS, BALL_R, RIM_R, TUBE, RIM_Y, RIM_Z, BOARD_Z, BOARD_W, BOARD_BOTTOM, BOARD_TOP, NET_DEPTH,
    LAUNCH, ELEV, V_MIN, V_MAX, MAX_YAW, RUN_MS, OT_MS, COOLDOWN_MS, MONEY_EVERY, FIRE_AT, LEVELS,
    normInput, hoopX, launchVelocity, simulate, newRun, isMoneyBall, shotError, shoot,
    crossing, solveShot, botShot, botGap, BOT, BOT_LEVELS: Object.keys(BOT),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BasketballSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
