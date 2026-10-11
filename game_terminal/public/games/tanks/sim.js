// Tanks — shared artillery physics. Loaded by the browser as a plain <script> (window.TanksSim) and
// by the server with require() (server/games/tanks.js). The server is authoritative: it generates
// the terrain, simulates every shot and broadcasts the result; the browser uses the same code to
// carve craters in step with the replay, predict its own driving and draw the short aim arc.
//
// World: W x H units, y UP (0 = bottom). The terrain is a heightmap of W integer columns
// (terrain[x] = surface height at column x). An explosion carves a circle out of it; dirt above a
// buried blast collapses down, so the map never has overhangs. A tank sits on terrain[x] at an
// integer column x and is hit as a circle around (x, ground + TANK_CY).
//
// A shot input is { angle, power, weapon }: angle in whole degrees 0..180 (0 = right, 90 = up),
// power a whole number 0..100, weapon a key of WEAPONS. Wind is a whole number -10..10 (+ = right).

(function (root) {
  'use strict';

  const W = 1000;
  const H = 560;
  const FLOOR = 8; // bedrock: terrain never goes below this
  const G = 260; // gravity (units/s^2)
  const V_MAX = 560; // muzzle speed at power 100
  const WIND_K = 4; // wind 10 => 40 units/s^2 sideways
  const SUB = 4; // physics substeps per recorded frame
  const FPS = 60;
  const DT = 1 / (FPS * SUB);
  const MAX_FRAMES = FPS * 14;
  const TANK_CY = 7; // hit-circle centre above the ground
  const TANK_HIT_R = 12;
  const PIVOT_Y = 11; // turret pivot above the ground
  const BARREL = 17;
  const ARM_FRAMES = 4; // a shell can't hit its own tank in its first frames
  const MARGIN = 14; // tanks stay this far from the map edges
  const TANK_GAP = 26; // tanks can't drive closer than this
  const MAX_CLIMB = 3; // a single 1-unit step can rise at most this much
  const FUEL = 80; // per turn
  const MAX_HP = 100;
  const MAX_TURNS = 30; // 15 shots each, then the healthier tank wins

  const WEAPONS = {
    shell: { name: 'Shell', r: 26, dmg: 34, ammo: null, shells: 1 },
    big: { name: 'Big Shot', r: 46, dmg: 46, ammo: 2, shells: 1 },
    triple: { name: 'Triple', r: 20, dmg: 22, ammo: 2, shells: 3, splitDv: 34 }, // flies as one shell, splits at the apex
    bouncer: { name: 'Bouncer', r: 28, dmg: 36, ammo: 2, shells: 1, bounces: 3 },
  };
  const WEAPON_KEYS = Object.keys(WEAPONS);

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const r1 = (v) => Math.round(v * 10) / 10;

  // ---- RNG / terrain generation ----------------------------------------------------------------
  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Rolling hills from a few random sine octaves plus one big feature (a central hill or valley),
  // smoothed, with flat-ish pads where the tanks start. Returns { terrain, xs: { red, blue } }.
  function generate(seed) {
    const rand = mulberry(seed);
    const base = H * (0.26 + rand() * 0.12);
    const waves = [];
    for (let i = 0; i < 4; i++) {
      waves.push({ amp: (70 / (i + 1)) * (0.5 + rand()), freq: (Math.PI * 2 * (0.6 + i * 1.3 + rand())) / W, ph: rand() * Math.PI * 2 });
    }
    const feature = rand();
    const fx = W * (0.4 + rand() * 0.2);
    const fw = W * (0.1 + rand() * 0.08);
    const fh = feature < 0.55 ? 90 + rand() * 120 : feature < 0.8 ? -(40 + rand() * 50) : 0;
    let h = new Array(W);
    for (let x = 0; x < W; x++) {
      let y = base;
      for (const w of waves) y += Math.sin(x * w.freq + w.ph) * w.amp;
      const d = (x - fx) / fw;
      y += fh * Math.exp(-d * d);
      h[x] = y;
    }
    for (let pass = 0; pass < 3; pass++) {
      const s = h.slice();
      for (let x = 0; x < W; x++) {
        let sum = 0; let n = 0;
        for (let k = -4; k <= 4; k++) { const j = x + k; if (j >= 0 && j < W) { sum += h[j]; n++; } }
        s[x] = sum / n;
      }
      h = s;
    }
    const xs = {
      red: Math.round(W * (0.07 + rand() * 0.13)),
      blue: Math.round(W * (0.8 + rand() * 0.13)),
    };
    for (const x of [xs.red, xs.blue]) {
      let avg = 0;
      for (let k = -12; k <= 12; k++) avg += h[x + k];
      avg /= 25;
      for (let k = -24; k <= 24; k++) {
        const j = x + k;
        if (j < 0 || j >= W) continue;
        const t = clamp((24 - Math.abs(k)) / 12, 0, 1); // fully flat within 12, blended to 24
        h[j] = h[j] * (1 - t) + avg * t;
      }
    }
    const terrain = h.map((y) => Math.round(clamp(y, 40, H * 0.74)));
    return { terrain, xs };
  }

  // ---- terrain queries / edits -----------------------------------------------------------------
  function groundAt(terrain, x) {
    if (x <= 0) return terrain[0];
    if (x >= W - 1) return terrain[W - 1];
    const i = Math.floor(x);
    return terrain[i] + (terrain[i + 1] - terrain[i]) * (x - i);
  }

  // Remove a circle of dirt (centre x, y; radius r). Dirt above a buried blast falls into the gap.
  function carve(terrain, x, y, r) {
    const a = Math.max(0, Math.ceil(x - r));
    const b = Math.min(W - 1, Math.floor(x + r));
    for (let c = a; c <= b; c++) {
      const dx = c - x;
      const dy = Math.sqrt(Math.max(0, r * r - dx * dx));
      const bottom = y - dy;
      const h = terrain[c];
      if (h > bottom) {
        const removed = Math.min(h, y + dy) - bottom;
        terrain[c] = Math.max(FLOOR, Math.round(h - removed));
      }
    }
  }

  // One unit of driving. Returns { x, cost } or null when blocked (edge, other tank, steep wall).
  function driveStep(terrain, x, dir, otherX) {
    const nx = x + (dir < 0 ? -1 : 1);
    if (nx < MARGIN || nx > W - 1 - MARGIN) return null;
    if (otherX != null && Math.abs(nx - otherX) < TANK_GAP) return null;
    const rise = terrain[nx] - terrain[x];
    if (rise > MAX_CLIMB) return null;
    return { x: nx, cost: 1 + Math.max(0, rise) };
  }

  // Drive up to `steps` units with `fuel` available. Returns { x, fuel, moved }.
  function drive(terrain, x, dir, steps, fuel, otherX) {
    let moved = 0;
    for (let i = 0; i < steps; i++) {
      const s = driveStep(terrain, x, dir, otherX);
      if (!s || s.cost > fuel) break;
      x = s.x;
      fuel -= s.cost;
      moved++;
    }
    return { x, fuel, moved };
  }

  // Surface tilt (radians) under a tank at column x, for drawing.
  function tiltAt(terrain, x) {
    const a = Math.max(0, x - 9);
    const b = Math.min(W - 1, x + 9);
    return Math.atan2(terrain[b] - terrain[a], b - a);
  }

  // ---- shooting --------------------------------------------------------------------------------
  function normInput(input) {
    if (!input || typeof input !== 'object') return null;
    const angle = Number(input.angle);
    const power = Number(input.power);
    if (!Number.isFinite(angle) || !Number.isFinite(power)) return null;
    const weapon = isWeapon(input.weapon) ? input.weapon : null;
    if (!weapon) return null;
    return { angle: Math.round(clamp(angle, 0, 180)), power: Math.round(clamp(power, 0, 100)), weapon };
  }
  const normWind = (w) => Math.round(clamp(Number(w) || 0, -10, 10));

  function isWeapon(w) {
    return typeof w === 'string' && Object.prototype.hasOwnProperty.call(WEAPONS, w);
  }

  function muzzle(terrain, x, angleDeg) {
    const a = (angleDeg * Math.PI) / 180;
    const gy = terrain[x];
    return { x: x + Math.cos(a) * BARREL, y: gy + PIVOT_Y + Math.sin(a) * BARREL };
  }
  function launch(terrain, x, angleDeg, power) {
    const a = (angleDeg * Math.PI) / 180;
    const v = (V_MAX * power) / 100;
    const m = muzzle(terrain, x, angleDeg);
    return { x: m.x, y: m.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v };
  }

  // Damage a blast (x, y, r, dmg) does to a tank at column tx on `terrain`.
  function blastDamage(terrain, tx, x, y, r, dmg) {
    const cy = terrain[tx] + TANK_CY;
    const d = Math.hypot(tx - x, cy - y);
    const reach = r + 8;
    if (d >= reach) return 0;
    const k = Math.min(1, (reach - d) / (reach - TANK_HIT_R));
    return Math.max(1, Math.round(dmg * k));
  }

  // Simulate a full shot. `tanks` = { red: { x, hp }, blue: { x, hp } }; `by` = shooter seat.
  // Never mutates its arguments. Returns
  //   { input, wind, projectiles: [{ frames: [[x, y]...], bounces: [f...], end: { f, type, x, y } }],
  //     explosions: [{ f, x, y, r, p, dmg: { red, blue } }], falls: { red, blue }, fallDmg: { red, blue },
  //     terrain, hp: { red, blue }, frames }
  function simulate(terrainIn, tanks, by, rawInput, windIn, opts) {
    const input = normInput(rawInput);
    if (!input) return null;
    const lite = !!(opts && opts.lite); // bot search: no frames recorded
    const wind = normWind(windIn);
    const terrain = terrainIn.slice();
    const W0 = WEAPONS[input.weapon];
    const seats = ['red', 'blue'];
    const hp = { red: tanks.red.hp, blue: tanks.blue.hp };
    const startY = { red: terrain[tanks.red.x], blue: terrain[tanks.blue.x] };
    const ax = wind * WIND_K;
    const ps = [];
    for (let i = 0; i < W0.shells; i++) {
      const l = launch(terrain, tanks[by].x, input.angle, input.power);
      ps.push({ ...l, alive: true, bounces: 0, frames: lite ? null : [[r1(l.x), r1(l.y)]], bounceFrames: [], end: null });
    }
    // Multi-shell weapons ride along with the centre shell until the apex, then fan out sideways.
    const lead = (W0.shells - 1) >> 1;
    let split = W0.shells === 1;
    const explosions = [];
    let f = 0;
    const explode = (p, i, x, y, type) => {
      const ex = r1(x);
      const ey = r1(y);
      const dmg = {};
      for (const s of seats) dmg[s] = blastDamage(terrain, tanks[s].x, ex, ey, W0.r, W0.dmg);
      for (const s of seats) hp[s] = Math.max(0, hp[s] - dmg[s]);
      carve(terrain, ex, ey, W0.r);
      explosions.push({ f, x: ex, y: ey, r: W0.r, p: i, dmg });
      p.alive = false;
      p.end = { f, type, x: ex, y: ey };
    };
    while (ps.some((p) => p.alive) && f < MAX_FRAMES) {
      f++;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (!p.alive || (!split && i !== lead)) continue;
        for (let s = 0; s < SUB && p.alive; s++) {
          p.vx += ax * DT;
          p.vy -= G * DT;
          p.x += p.vx * DT;
          p.y += p.vy * DT;
          if (p.x < 0 || p.x > W - 1) {
            p.alive = false;
            p.end = { f, type: 'off', x: r1(clamp(p.x, 0, W - 1)), y: r1(p.y) };
            break;
          }
          // direct hit on a tank
          let hit = null;
          for (const sn of seats) {
            if (sn === by && f <= ARM_FRAMES) continue;
            const tx = tanks[sn].x;
            const ty = terrain[tx] + TANK_CY;
            if ((p.x - tx) * (p.x - tx) + (p.y - ty) * (p.y - ty) < TANK_HIT_R * TANK_HIT_R) { hit = sn; break; }
          }
          if (hit) { explode(p, i, p.x, p.y, 'tank'); break; }
          const gy = groundAt(terrain, p.x);
          if (p.y <= gy) {
            if (W0.bounces && p.bounces < W0.bounces) {
              const xi = clamp(Math.round(p.x), 2, W - 3);
              let nx = -(terrain[xi + 2] - terrain[xi - 2]) / 4;
              let ny = 1;
              const nl = Math.sqrt(nx * nx + ny * ny);
              nx /= nl; ny /= nl;
              const dot = p.vx * nx + p.vy * ny;
              if (dot < 0) {
                p.vx = (p.vx - 2 * dot * nx) * 0.62;
                p.vy = (p.vy - 2 * dot * ny) * 0.62;
              }
              p.y = gy + 0.6;
              p.bounces++;
              p.bounceFrames.push(f);
              if (p.vx * p.vx + p.vy * p.vy < 45 * 45) { explode(p, i, p.x, gy, 'ground'); break; }
            } else {
              explode(p, i, p.x, Math.max(p.y, gy - 2), 'ground');
              break;
            }
          }
        }
        if (!lite && p.frames) p.frames.push([r1(p.x), r1(p.y)]);
        if (!p.alive && !p.end) p.end = { f, type: 'off', x: r1(p.x), y: r1(p.y) };
      }
      if (!split) {
        const L = ps[lead];
        for (let i = 0; i < ps.length; i++) {
          if (i === lead) continue;
          const p = ps[i];
          Object.assign(p, { x: L.x, y: L.y, vx: L.vx, vy: L.vy });
          if (!lite) p.frames.push([r1(p.x), r1(p.y)]);
          // ended before the split: the followers vanish with it (no extra blasts)
          if (!L.alive) { p.alive = false; p.end = { f, type: 'merged', x: L.end.x, y: L.end.y }; } else if (L.vy <= 0) p.vx += (i - lead) * W0.splitDv;
        }
        if (L.alive && L.vy <= 0) split = true;
      }
    }
    for (const p of ps) if (!p.end) { p.alive = false; p.end = { f, type: 'timeout', x: r1(p.x), y: r1(p.y) }; }
    // tanks settle onto the new ground; long drops hurt
    const falls = {};
    const fallDmg = {};
    for (const s of seats) {
      const drop = Math.max(0, startY[s] - terrain[tanks[s].x]);
      falls[s] = drop;
      fallDmg[s] = drop > 22 ? Math.min(25, Math.round((drop - 22) * 0.45)) : 0;
      hp[s] = Math.max(0, hp[s] - fallDmg[s]);
    }
    return {
      input,
      wind,
      projectiles: ps.map((p) => ({ frames: p.frames, bounces: p.bounceFrames, end: p.end })),
      explosions,
      falls,
      fallDmg,
      terrain,
      hp,
      frames: f,
    };
  }

  // Start of the flight arc for the aim preview (no wind, no terrain): `n` points `dt` s apart.
  function previewArc(terrain, x, angle, power, n, dt) {
    const l = launch(terrain, x, angle, power);
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const t = k * dt;
      pts.push([l.x + l.vx * t, l.y + l.vy * t - 0.5 * G * t * t]);
    }
    return pts;
  }

  // ---- bots ------------------------------------------------------------------------------------
  // Wind they account for (fraction), aim noise (degrees / power SD) and weapon sense per level.
  const BOT = {
    easy: { wind: 0, angle: 6, power: 6, weapons: 'random' },
    medium: { wind: 0.5, angle: 3.2, power: 3.4, weapons: 'random' },
    hard: { wind: 1, angle: 1.4, power: 1.6, weapons: 'some' },
    expert: { wind: 1, angle: 0.55, power: 0.6, weapons: 'smart' },
  };

  function gauss(rand) {
    let u = 0; let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Where a single (centre) shell of `weapon` ends: signed distance to the target column along the
  // shooting direction (negative = short) and the absolute miss distance.
  function probe(terrain, tanks, by, angle, power, weapon, wind) {
    const W1 = WEAPONS[weapon];
    const one = W1.shells > 1 ? 'shell' : weapon;
    const res = simulate(terrain, tanks, by, { angle, power, weapon: one }, wind, { lite: true });
    const tgt = by === 'red' ? 'blue' : 'red';
    const tx = tanks[tgt].x;
    const ty = terrain[tx] + TANK_CY;
    const e = res.explosions[0];
    const end = res.projectiles[0].end;
    const dir = tx > tanks[by].x ? 1 : -1;
    const px = e ? e.x : end.x;
    const py = e ? e.y : end.y;
    const off = end.type === 'off' ? ((end.x <= 0 ? -1 : 1) === dir ? 400 : -400) : (px - tx) * dir;
    return { off, miss: e ? Math.hypot(px - tx, py - ty) : 1e4 };
  }

  // Best (angle, power) for `weapon` against the other tank under `wind`.
  function solve(terrain, tanks, by, weapon, wind) {
    const tgt = by === 'red' ? 'blue' : 'red';
    const right = tanks[tgt].x > tanks[by].x;
    let best = null;
    const consider = (angle, power) => {
      const pr = probe(terrain, tanks, by, angle, power, weapon, wind);
      if (!best || pr.miss < best.miss) best = { angle, power, miss: pr.miss };
      return pr;
    };
    for (let a = 22; a <= 82; a += 4) {
      const angle = right ? a : 180 - a;
      let lo = 8; let hi = 100;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (consider(angle, mid).off < 0) lo = mid; else hi = mid;
      }
      consider(angle, lo);
      consider(angle, hi);
    }
    // local refinement around the best
    for (let pass = 0; pass < 2 && best; pass++) {
      const c = { ...best };
      for (let da = -2; da <= 2; da++) {
        for (let dp = -2; dp <= 2; dp++) {
          if (!da && !dp) continue;
          const angle = clamp(c.angle + da, 0, 180);
          const power = clamp(c.power + dp, 0, 100);
          consider(angle, power);
        }
      }
    }
    return best;
  }

  // Damage a shot actually deals: [to opponent, to self] — used to rank weapons.
  function shotValue(terrain, tanks, by, input, wind) {
    const res = simulate(terrain, tanks, by, input, wind, { lite: true });
    const tgt = by === 'red' ? 'blue' : 'red';
    return { opp: tanks[tgt].hp - res.hp[tgt], self: tanks[by].hp - res.hp[by] };
  }

  // Full bot decision for the seat on turn. `st` = { terrain, tanks: {red/blue: {x, hp, ammo}}, wind }.
  // Returns { angle, power, weapon, drive?: { dir, steps } }.
  function botPlan(st, by, level, rand) {
    rand = rand || Math.random;
    const L = BOT[level] || BOT.hard;
    const tgt = by === 'red' ? 'blue' : 'red';
    const me = st.tanks[by];
    const avail = WEAPON_KEYS.filter((k) => WEAPONS[k].ammo == null || (me.ammo && me.ammo[k] > 0));
    const believed = Math.round(st.wind * L.wind);
    let terrain = st.terrain;
    let tanks = st.tanks;
    let driveCmd = null;

    let sol = solve(terrain, tanks, by, 'shell', believed);
    // blocked / no good line: try driving somewhere with a clearer shot (hard / expert only)
    if (sol.miss > 40 && L.wind === 1 && me.fuel > 0) {
      let bestAlt = null;
      for (const dir of [-1, 1]) {
        for (const steps of [20, 40, 70]) {
          const d = drive(terrain, me.x, dir, steps, me.fuel, tanks[tgt].x);
          if (!d.moved) continue;
          const t2 = { ...tanks, [by]: { ...me, x: d.x } };
          const s2 = solve(terrain, t2, by, 'shell', believed);
          if (!bestAlt || s2.miss < bestAlt.sol.miss) bestAlt = { sol: s2, dir, steps: d.moved, tanks: t2 };
        }
      }
      if (bestAlt && bestAlt.sol.miss < sol.miss - 10) {
        sol = bestAlt.sol;
        tanks = bestAlt.tanks;
        driveCmd = { dir: bestAlt.dir, steps: bestAlt.steps };
      }
    }

    let weapon = 'shell';
    let aim = { angle: sol.angle, power: sol.power };
    if (L.weapons === 'random' && avail.length > 1 && rand() < 0.35) {
      weapon = avail[1 + Math.floor(rand() * (avail.length - 1))];
      if (weapon === 'bouncer') {
        const s = solve(terrain, tanks, by, 'bouncer', believed);
        aim = { angle: s.angle, power: s.power };
      }
    } else if (L.weapons === 'some' && avail.length > 1 && rand() < 0.3) {
      weapon = avail.filter((k) => k !== 'bouncer')[Math.floor(rand() * avail.filter((k) => k !== 'bouncer').length)];
    } else if (L.weapons === 'smart') {
      // Expected damage over a few noisy versions of each weapon's best shot; specials are only
      // spent when they add a real edge, and a shell is kept when it already finishes the job.
      const oppHp = tanks[tgt].hp;
      const turnsLeft = Math.max(1, (MAX_TURNS - (st.turnNo || 0)) / 2);
      let bestScore = -Infinity;
      for (const k of avail) {
        const s = k === 'bouncer' ? solve(terrain, tanks, by, 'bouncer', believed) : sol;
        let tot = 0;
        const N = 6;
        const r2 = mulberry(1234 + k.length * 7);
        for (let n = 0; n < N; n++) {
          const inp = { angle: s.angle + Math.round(gauss(r2) * 1.2), power: s.power + Math.round(gauss(r2) * 1.4), weapon: k };
          const v = shotValue(terrain, tanks, by, inp, believed);
          tot += Math.min(v.opp, oppHp) + (v.opp >= oppHp ? 40 : 0) - v.self * 1.5;
        }
        let score = tot / N;
        if (WEAPONS[k].ammo != null) score -= turnsLeft > 3 ? 6 : 1; // value of saving it
        if (score > bestScore) { bestScore = score; weapon = k; aim = { angle: s.angle, power: s.power }; }
      }
    }
    const angle = clamp(Math.round(aim.angle + gauss(rand) * L.angle), 0, 180);
    const power = clamp(Math.round(aim.power + gauss(rand) * L.power), 1, 100);
    return { angle, power, weapon, drive: driveCmd };
  }

  const api = {
    W, H, FLOOR, G, V_MAX, WIND_K, FPS, TANK_CY, TANK_HIT_R, PIVOT_Y, BARREL, MARGIN, TANK_GAP, MAX_CLIMB,
    FUEL, MAX_HP, MAX_TURNS, WEAPONS, WEAPON_KEYS, BOT_LEVELS: Object.keys(BOT),
    mulberry, isWeapon, generate, groundAt, carve, driveStep, drive, tiltAt, normInput, normWind, muzzle, launch,
    blastDamage, simulate, previewArc, solve, botPlan,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TanksSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
