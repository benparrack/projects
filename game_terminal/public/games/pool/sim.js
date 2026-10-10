// Pool — shared table geometry + ball physics. Loaded by the browser as a plain <script>
// (window.PoolSim) and by the server with require() (server/games/pool.js), so a shot replays to
// the exact same result everywhere: the server simulates it authoritatively, sends the shot input,
// and every client re-runs it step by step to animate it.
//
// Determinism: the sim uses only + - * / and Math.sqrt (correctly rounded by IEEE 754, so
// bit-identical across JS engines) on a fixed 1/480 s step — no trig, no Math.hypot, no
// randomness. Shot directions arrive as a vector and are normalised here with sqrt.
//
// Units are centimetres on a 9-foot table: the playing surface is 254 x 127 with x along the
// length (head string on the left, foot spot on the right) and y across it.

(function (root) {
  'use strict';

  const L = 254;
  const W = 127;
  const R = 2.86; // ball radius
  const DT = 1 / 480;
  const MAX_SPEED = 760; // cm/s at full power
  const MIN_POWER = 0.03;
  const ROLL_DECEL = 30; // constant rolling resistance, cm/s^2
  const DRAG = 0.22; // plus a speed-proportional part, 1/s
  const STOP_SPEED = 1.2;
  const BALL_E = 0.96; // ball-ball restitution
  const CONTACT_PASSES = 6;
  const CONTACT_SLOP = 0.05; // balls this close count as touching (lets a hit run through the rack)
  const RAIL_E = 0.74; // cushion restitution (normal)
  const RAIL_T = 0.96; // cushion tangential keep
  const FOLLOW = 0.6; // how much top/back spin adds after the first contact
  const SIDE = 0.32; // side spin kick per cushion
  const MAX_STEPS = 480 * 25;

  // Pocket mouths: each corner leaves CORNER cm of rail open on both sides; side pockets leave
  // SIDE_HALF either side of the middle. A ball whose centre crosses a rail line (only possible
  // through a mouth, because the cushions block everywhere else) drops into the nearest pocket.
  const CORNER = 9.5;
  const SIDE_HALF = 7.2;
  const HEAD_X = L / 4; // head string — the break is played from behind it
  const FOOT = { x: L * 0.75, y: W / 2 };

  // Cushion segments (ball centre collides with the segment inflated by R; ends act as jaws).
  const RAILS = [
    [CORNER, 0, L / 2 - SIDE_HALF, 0],
    [L / 2 + SIDE_HALF, 0, L - CORNER, 0],
    [CORNER, W, L / 2 - SIDE_HALF, W],
    [L / 2 + SIDE_HALF, W, L - CORNER, W],
    [0, CORNER, 0, W - CORNER],
    [L, CORNER, L, W - CORNER],
  ].map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2 }));

  // Pocket centres (drawing + the drop animation) and the points bots aim object balls at.
  const POCKETS = [
    { x: -2.2, y: -2.2, aimX: 0.6, aimY: 0.6, r: 7.4 },
    { x: L / 2, y: -4.2, aimX: L / 2, aimY: -1, r: 7.0 },
    { x: L + 2.2, y: -2.2, aimX: L - 0.6, aimY: 0.6, r: 7.4 },
    { x: -2.2, y: W + 2.2, aimX: 0.6, aimY: W - 0.6, r: 7.4 },
    { x: L / 2, y: W + 4.2, aimX: L / 2, aimY: W + 1, r: 7.0 },
    { x: L + 2.2, y: W + 2.2, aimX: L - 0.6, aimY: W - 0.6, r: 7.4 },
  ];

  function nearestPocket(x, y) {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < POCKETS.length; i++) {
      const dx = POCKETS[i].x - x;
      const dy = POCKETS[i].y - y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // Sanitises a shot from the network: unit direction, power, spin inside the unit circle.
  function normShot(shot) {
    if (!shot || typeof shot !== 'object') return null;
    const dx = Number(shot.dx);
    const dy = Number(shot.dy);
    const m = Math.sqrt(dx * dx + dy * dy);
    if (!Number.isFinite(m) || m < 1e-6) return null;
    const power = Number(shot.power);
    if (!Number.isFinite(power)) return null;
    let s = Number(shot.spinY) || 0;
    let e = Number(shot.spinX) || 0;
    s = clamp(s, -1, 1);
    e = clamp(e, -1, 1);
    const sm = Math.sqrt(s * s + e * e);
    if (sm > 1) { s /= sm; e /= sm; }
    return { dx: dx / m, dy: dy / m, power: clamp(power, MIN_POWER, 1), spinY: s, spinX: e };
  }

  // balls: [{ n, x, y }] (n 0 = cue ball). Returns a stepper; step() advances DT and returns the
  // events of that step: { t: 'ball', a, b, v } | { t: 'rail', n, v } | { t: 'pot', n, pocket }.
  function createShot(balls, rawShot) {
    const shot = normShot(rawShot);
    const bs = balls.map((b) => ({ n: b.n, x: b.x, y: b.y, vx: 0, vy: 0, on: true }));
    const cue = bs.find((b) => b.n === 0);
    let spinY = 0;
    let spinX = 0;
    if (shot && cue) {
      const v = MAX_SPEED * shot.power;
      cue.vx = shot.dx * v;
      cue.vy = shot.dy * v;
      spinY = shot.spinY;
      spinX = shot.spinX;
    }
    const sum = { firstHit: null, railAfterContact: false, cueRails: 0, pots: [], steps: 0, contacts: 0 };
    let done = !shot || !cue;

    function step() {
      if (done) return [];
      const ev = [];
      const n = bs.length;
      // friction + move
      let moving = false;
      for (let i = 0; i < n; i++) {
        const b = bs[i];
        if (!b.on || (b.vx === 0 && b.vy === 0)) continue;
        const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        const dec = (ROLL_DECEL + DRAG * sp) * DT;
        if (sp - dec <= STOP_SPEED) { b.vx = 0; b.vy = 0; continue; }
        const k = (sp - dec) / sp;
        b.vx *= k;
        b.vy *= k;
        b.x += b.vx * DT;
        b.y += b.vy * DT;
        moving = true;
      }
      // cushions
      for (let i = 0; i < n; i++) {
        const b = bs[i];
        if (!b.on || (b.vx === 0 && b.vy === 0)) continue;
        for (let r = 0; r < RAILS.length; r++) {
          const s = RAILS[r];
          const sx = s.x2 - s.x1;
          const sy = s.y2 - s.y1;
          let u = ((b.x - s.x1) * sx + (b.y - s.y1) * sy) / (sx * sx + sy * sy);
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const px = s.x1 + sx * u;
          const py = s.y1 + sy * u;
          const ox = b.x - px;
          const oy = b.y - py;
          const d2 = ox * ox + oy * oy;
          if (d2 >= R * R || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const nx = ox / d;
          const ny = oy / d;
          const vn = b.vx * nx + b.vy * ny;
          // push out regardless, bounce only if moving into the cushion
          b.x = px + nx * R;
          b.y = py + ny * R;
          if (vn >= 0) continue;
          const tx = -ny;
          const ty = nx;
          let vt = (b.vx * tx + b.vy * ty) * RAIL_T;
          if (b.n === 0 && spinX !== 0) {
            vt += spinX * -vn * SIDE;
            spinX *= 0.5;
          }
          const vn2 = -vn * RAIL_E;
          b.vx = nx * vn2 + tx * vt;
          b.vy = ny * vn2 + ty * vt;
          if (sum.firstHit !== null) sum.railAfterContact = true;
          if (b.n === 0) sum.cueRails++;
          ev.push({ t: 'rail', n: b.n, v: -vn });
        }
      }
      // ball-ball. Contacts are solved simultaneously (impulses from one pass are all computed
      // from the same velocities, then applied together), over a few passes — so a break shares
      // its energy across the rack instead of firing it down one line like a Newton's cradle.
      const D2 = (2 * R + CONTACT_SLOP) * (2 * R + CONTACT_SLOP);
      const contacts = [];
      for (let i = 0; i < n; i++) {
        const a = bs[i];
        if (!a.on) continue;
        for (let j = i + 1; j < n; j++) {
          const b = bs[j];
          if (!b.on) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= D2 || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const overlap = 2 * R - d;
          if (overlap > 0) {
            a.x -= nx * overlap / 2;
            a.y -= ny * overlap / 2;
            b.x += nx * overlap / 2;
            b.y += ny * overlap / 2;
          }
          contacts.push({ a, b, nx, ny, imp: 0, hit: false });
        }
      }
      let cueBefore = null;
      for (let it = 0; it < CONTACT_PASSES && contacts.length; it++) {
        let any = false;
        for (const c of contacts) {
          const rel = (c.a.vx - c.b.vx) * c.nx + (c.a.vy - c.b.vy) * c.ny;
          c.imp = rel > 0 ? rel * (1 + BALL_E) / 2 : 0;
          if (c.imp > 0) any = true;
        }
        if (!any) break;
        for (const c of contacts) {
          if (c.imp === 0) continue;
          if (!c.hit) {
            c.hit = true;
            const cueBall = c.a.n === 0 ? c.a : c.b.n === 0 ? c.b : null;
            if (cueBall && sum.firstHit === null) {
              sum.firstHit = cueBall === c.a ? c.b.n : c.a.n;
              cueBefore = { vx: cueBall.vx, vy: cueBall.vy };
            }
            sum.contacts++;
            ev.push({ t: 'ball', a: c.a.n, b: c.b.n, v: c.imp });
          }
          c.a.vx -= c.imp * c.nx;
          c.a.vy -= c.imp * c.ny;
          c.b.vx += c.imp * c.nx;
          c.b.vy += c.imp * c.ny;
        }
      }
      if (cueBefore && spinY !== 0) {
        // follow (top) / draw (back): the cue ball picks up its old line again after the hit
        cue.vx += cueBefore.vx * spinY * FOLLOW;
        cue.vy += cueBefore.vy * spinY * FOLLOW;
        spinY = 0;
      }
      // pockets
      for (let i = 0; i < n; i++) {
        const b = bs[i];
        if (!b.on) continue;
        if (b.x < 0 || b.x > L || b.y < 0 || b.y > W) {
          b.on = false;
          b.vx = 0;
          b.vy = 0;
          const pocket = nearestPocket(b.x, b.y);
          sum.pots.push({ n: b.n, pocket });
          ev.push({ t: 'pot', n: b.n, pocket });
        }
      }
      sum.steps++;
      if (!moving || sum.steps >= MAX_STEPS) {
        // anything still rolling at the cap just stops where it is
        for (const b of bs) { b.vx = 0; b.vy = 0; }
        done = true;
      }
      return ev;
    }

    return {
      balls: bs,
      summary: sum,
      step,
      get done() { return done; },
    };
  }

  // Runs a shot to rest. Returns { balls: [{n,x,y}] still on the table, summary }.
  function simulate(balls, shot) {
    const s = createShot(balls, shot);
    while (!s.done) s.step();
    return { balls: s.balls.filter((b) => b.on).map((b) => ({ n: b.n, x: b.x, y: b.y })), summary: s.summary };
  }

  // A legal cue-ball spot: on the cloth, not touching another ball (or behind the head string).
  function validCueSpot(balls, x, y, kitchen) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (x < R || x > L - R || y < R || y > W - R) return false;
    if (kitchen && x > HEAD_X) return false;
    for (const b of balls) {
      if (b.n === 0) continue;
      const dx = b.x - x;
      const dy = b.y - y;
      if (dx * dx + dy * dy < 4 * R * R + 0.01) return false;
    }
    return true;
  }

  // Racks. `order` is the ball numbers in rack-position order (apex first, row by row).
  const SQRT3 = Math.sqrt(3);
  function rackPositions(rows) {
    const gap = 0.03;
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < rows[i]; j++) {
        out.push({ x: FOOT.x + i * (R + gap) * SQRT3, y: FOOT.y + (j - (rows[i] - 1) / 2) * (2 * R + gap) });
      }
    }
    return out;
  }
  const RACK8 = rackPositions([1, 2, 3, 4, 5]);
  const RACK9 = rackPositions([1, 2, 3, 2, 1]);

  function rack(order, positions) {
    const balls = [{ n: 0, x: HEAD_X - 20, y: W / 2 }];
    order.forEach((n, i) => balls.push({ n, x: positions[i].x, y: positions[i].y }));
    return balls;
  }

  // Spot a ball (re-spotted 8/9): the foot spot, else slide toward the foot rail until free.
  function spotBall(balls, n) {
    let x = FOOT.x;
    for (; x < L - R; x += 0.5) {
      if (balls.every((b) => { const dx = b.x - x; const dy = b.y - FOOT.y; return dx * dx + dy * dy >= 4 * R * R + 0.01; })) break;
    }
    balls.push({ n, x, y: FOOT.y });
  }

  const api = {
    L, W, R, DT, MAX_SPEED, MIN_POWER, HEAD_X, FOOT, RAILS, POCKETS, CORNER, SIDE_HALF,
    normShot, createShot, simulate, validCueSpot, rack, spotBall, RACK8, RACK9, nearestPocket,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PoolSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
