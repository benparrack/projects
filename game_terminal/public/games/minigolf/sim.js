// Mini Golf — shared course data + putt physics + bot search. Loaded by the browser as a plain
// <script> (window.MiniGolfSim) and by the server with require() (server/games/minigolf.js), so a
// putt resolves identically for the putter's instant local preview, the authoritative server result
// and the bots' planning.
//
// World: a top-down 360 x 560 course, +x right, +y DOWN (screen convention). A putt input is
// { angle, power }: angle in radians (direction (cos, sin)), power in [0, 1] -> launch speed.
// Moving obstacles (spinners, sliders) are pure functions of time T (seconds); a putt starts at
// T0 = phaseMs / 1000 where phaseMs = (shot wall-clock ms) mod 60000 — every mover period divides
// 60 s, so the course loops seamlessly.
//
// Determinism: the integrator only uses + - * / and Math.sqrt / round / floor (all exactly
// specified by IEEE-754), and trig goes through dsin/dcos below (polynomials), so V8 and
// SpiderMonkey produce bit-identical trajectories.

(function (root) {
  'use strict';

  const W = 360;
  const H = 560;
  const BALL_R = 5.5;
  const CUP_R = 9;
  const WALL_R = 3; // half-thickness of rails
  const V_MAX = 820; // launch speed at full power (units/s)
  const MIN_POWER = 0.02;
  const DT = 1 / 240;
  const FRAME_EVERY = 4; // 60 fps playback
  const MAX_STEPS = 240 * 14;
  const ROLL = 120; // constant rolling deceleration
  const DRAG = 0.9; // linear drag (1/s)
  const SAND_ROLL = 560;
  const SAND_DRAG = 3.2;
  const V_STOP = 5;
  const STATIC = 70; // slope accel below this can't start a resting ball
  const V_CAP = 210; // max speed that still drops into the cup
  const CUP_PULL = 1500;
  const KICK = 260; // pop-bumper minimum outgoing speed
  const MAX_STROKES = 6; // miss the 6th and you're picked up with a 7
  const PICKUP_SCORE = 7;
  const SPINNER_ARM_R = 4;
  const SLIDER_R = 7;

  const TAU = 6.283185307179586;
  const HALF_PI = 1.5707963267948966;

  // ---- deterministic trig ----
  function dsin(x) {
    const k = Math.round(x / HALF_PI);
    const y = x - k * HALF_PI;
    const q = ((k % 4) + 4) % 4;
    const y2 = y * y;
    const s = y * (1 + y2 * (-1 / 6 + y2 * (1 / 120 + y2 * (-1 / 5040 + y2 * (1 / 362880 + y2 * (-1 / 39916800 + y2 / 6227020800))))));
    const c = 1 + y2 * (-0.5 + y2 * (1 / 24 + y2 * (-1 / 720 + y2 * (1 / 40320 + y2 * (-1 / 3628800 + y2 / 479001600)))));
    return q === 0 ? s : q === 1 ? c : q === 2 ? -s : -c;
  }
  const dcos = (x) => dsin(x + HALF_PI);

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const q = (v, step) => Math.round(v / step) * step;
  const r2 = (v) => Math.round(v * 100) / 100;

  // ---- courses ----
  // fairway: closed outline (rails along every edge; `banks` = indexes of edges that are springy
  // angled bumpers). walls / bankWalls: extra rails [x1,y1,x2,y2]. posts: [cx,cy,r]. bumpers: pop
  // bumpers [cx,cy,r]. sand / water: shapes {rect:[x,y,w,h]} | {circle:[cx,cy,r]}. slopes:
  // {rect, ax, ay} constant push. funnels: [cx,cy,r,strength] pull toward the centre. movers:
  // spinner {cx,cy,len,arms,period,phase} | slider {cx,cy,dx,dy,amp,half,period,phase} (the bar
  // lies along (dx,dy) and slides along it).
  const rect = (x, y, w, h) => ({ rect: [x, y, w, h] });
  const circ = (x, y, r) => ({ circle: [x, y, r] });
  const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

  const HOLES = [
    {
      name: 'Warm Up', par: 2, tee: [180, 455], cup: [180, 112],
      fairway: [[110, 505], [250, 505], [250, 95], [215, 60], [145, 60], [110, 95]], banks: [2, 4],
      posts: [[180, 285, 13]],
    },
    {
      name: 'Dogleg', par: 3, tee: [115, 460], cup: [262, 142],
      fairway: [[60, 505], [170, 505], [170, 210], [305, 210], [305, 75], [135, 75], [60, 150]], banks: [5],
      sand: [circ(212, 186, 17)],
      posts: [[226, 128, 8]],
    },
    {
      name: 'Windmill', par: 3, tee: [180, 462], cup: [180, 110],
      fairway: box(90, 55, 270, 505),
      walls: [[90, 292, 124, 292], [236, 292, 270, 292]],
      posts: [[180, 292, 10]],
      movers: [{ kind: 'spinner', cx: 180, cy: 292, len: 58, arms: 4, period: 4, phase: 0 }],
      sand: [circ(126, 136, 18)],
    },
    {
      name: 'Bunkers', par: 3, tee: [145, 460], cup: [232, 115],
      fairway: [[80, 505], [210, 505], [210, 400], [290, 340], [290, 60], [80, 60]], banks: [2],
      sand: [rect(80, 238, 150, 56), circ(162, 120, 26), circ(258, 196, 15)],
      posts: [[206, 178, 11]],
    },
    {
      name: 'Lagoon', par: 3, tee: [150, 462], cup: [140, 115],
      fairway: [[70, 505], [290, 505], [290, 92], [253, 55], [70, 55]], banks: [2],
      water: [rect(70, 214, 156, 92), circ(214, 405, 20)],
      posts: [[110, 160, 9]],
    },
    {
      name: 'The Hill', par: 3, tee: [180, 462], cup: [180, 110],
      fairway: box(85, 55, 275, 505),
      slopes: [{ rect: [85, 186, 190, 128], ax: 0, ay: 260 }, { rect: [85, 336, 190, 80], ax: -170, ay: 0 }],
      funnels: [[180, 110, 38, 130]],
      posts: [[128, 150, 9], [232, 150, 9], [180, 172, 11]],
    },
    {
      name: 'Pinball', par: 3, tee: [180, 465], cup: [180, 105],
      fairway: [[110, 510], [250, 510], [300, 460], [300, 105], [250, 55], [110, 55], [60, 105], [60, 460]], banks: [1, 3, 5, 7],
      bumpers: [[180, 232, 16], [116, 322, 14], [244, 322, 14], [122, 160, 12], [238, 160, 12]],
    },
    {
      name: 'Sliders', par: 3, tee: [180, 465], cup: [180, 108],
      fairway: box(80, 55, 280, 510),
      movers: [
        { kind: 'slider', cx: 180, cy: 345, dx: 1, dy: 0, amp: 48, half: 45, period: 3, phase: 0 },
        { kind: 'slider', cx: 180, cy: 215, dx: 1, dy: 0, amp: 48, half: 45, period: 5, phase: Math.PI },
      ],
      posts: [[122, 425, 9], [238, 425, 9]],
      water: [circ(80 + 18, 55 + 18, 22), circ(280 - 18, 55 + 18, 22)],
    },
    {
      name: 'Grand Finale', par: 4, tee: [95, 462], cup: [258, 112],
      fairway: [[50, 510], [310, 510], [310, 50], [95, 50], [50, 95]], banks: [3],
      walls: [[50, 375, 230, 375], [150, 220, 310, 220]],
      bankWalls: [[268, 224, 306, 262]],
      posts: [[100, 220, 8]],
      movers: [{ kind: 'spinner', cx: 100, cy: 220, len: 42, arms: 2, period: 3, phase: 0 }],
      water: [circ(190, 298, 22)],
      slopes: [{ rect: [53, 53, 150, 165], ax: 150, ay: 0 }],
      sand: [circ(258, 172, 17)],
    },
  ];
  const TOTAL_PAR = HOLES.reduce((s, h) => s + h.par, 0);

  // ---- geometry helpers ----
  function inShape(s, x, y) {
    if (s.rect) {
      const [rx, ry, rw, rh] = s.rect;
      return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
    }
    if (s.circle) {
      const [cx, cy, r] = s.circle;
      const dx = x - cx;
      const dy = y - cy;
      return dx * dx + dy * dy <= r * r;
    }
    return false;
  }
  function inPoly(poly, x, y) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  const capsule = (ax, ay, bx, by, r, e, kind, id) => {
    const dx = bx - ax;
    const dy = by - ay;
    return { ax, ay, bx, by, r, e, kind, id, dx, dy, len2: dx * dx + dy * dy };
  };

  // Static colliders of a hole (cached).
  const staticCache = [];
  function statics(hi) {
    if (staticCache[hi]) return staticCache[hi];
    const h = HOLES[hi];
    const out = [];
    const f = h.fairway;
    for (let i = 0; i < f.length; i++) {
      const a = f[i];
      const b = f[(i + 1) % f.length];
      const bank = (h.banks || []).includes(i);
      out.push(capsule(a[0], a[1], b[0], b[1], WALL_R, bank ? 0.92 : 0.68, bank ? 'bank' : 'wall', `f${i}`));
    }
    (h.walls || []).forEach((w, i) => out.push(capsule(w[0], w[1], w[2], w[3], WALL_R, 0.68, 'wall', `w${i}`)));
    (h.bankWalls || []).forEach((w, i) => out.push(capsule(w[0], w[1], w[2], w[3], WALL_R, 0.92, 'bank', `k${i}`)));
    (h.posts || []).forEach((p, i) => out.push(capsule(p[0], p[1], p[0], p[1], p[2], 0.72, 'post', `p${i}`)));
    (h.bumpers || []).forEach((p, i) => out.push(capsule(p[0], p[1], p[0], p[1], p[2], 1.0, 'bumper', `b${i}`)));
    staticCache[hi] = out;
    return out;
  }

  // Moving colliders at time T: [{ capsule..., ux, uy (surface velocity fn) }].
  function moverShapes(hi, T) {
    const h = HOLES[hi];
    const out = [];
    (h.movers || []).forEach((m, mi) => {
      const w = TAU / m.period;
      if (m.kind === 'spinner') {
        const th = m.phase + w * T;
        for (let k = 0; k < m.arms; k++) {
          const a = th + (TAU * k) / m.arms;
          const c = capsule(m.cx, m.cy, m.cx + m.len * dcos(a), m.cy + m.len * dsin(a), SPINNER_ARM_R, 0.6, 'mover', `m${mi}`);
          c.spin = { cx: m.cx, cy: m.cy, w };
          out.push(c);
        }
      } else if (m.kind === 'slider') {
        const ph = m.phase + w * T;
        const s = m.amp * dsin(ph);
        const sv = m.amp * w * dcos(ph);
        const cx = m.cx + m.dx * s;
        const cy = m.cy + m.dy * s;
        const c = capsule(cx - m.dx * m.half, cy - m.dy * m.half, cx + m.dx * m.half, cy + m.dy * m.half, SLIDER_R, 0.6, 'mover', `m${mi}`);
        c.slide = { ux: m.dx * sv, uy: m.dy * sv };
        out.push(c);
      }
    });
    return out;
  }

  function slopeAccel(h, x, y) {
    let ax = 0;
    let ay = 0;
    for (const s of h.slopes || []) {
      if (inShape(s, x, y)) { ax += s.ax; ay += s.ay; }
    }
    for (const f of h.funnels || []) {
      const dx = f[0] - x;
      const dy = f[1] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < f[2] * f[2] && d2 > 1e-9) {
        const d = Math.sqrt(d2);
        // strongest mid-way, fading to 0 at the rim and the centre
        const k = (f[3] * (d / f[2]) * (1 - d / f[2]) * 4) / d;
        ax += dx * k;
        ay += dy * k;
      }
    }
    return [ax, ay];
  }

  function inSand(h, x, y) {
    for (const s of h.sand || []) if (inShape(s, x, y)) return true;
    return false;
  }
  function inWater(h, x, y) {
    for (const s of h.water || []) if (inShape(s, x, y)) return true;
    return false;
  }

  // ---- input ----
  function normInput(input) {
    const angle = Number(input && input.angle);
    const power = Number(input && input.power);
    if (!Number.isFinite(angle) || !Number.isFinite(power)) return null;
    let a = angle % TAU;
    if (a > Math.PI) a -= TAU;
    if (a <= -Math.PI) a += TAU;
    return { angle: q(a, 0.0001), power: q(clamp(power, 0, 1), 0.0001) };
  }

  // ---- the integrator ----
  // Returns { input, frames: [[x,y],...] (60 fps), events: [{f, type, id?}], outcome:
  // 'rest'|'sink'|'water', end: {x,y} (where the ball sits for the next putt) } or null.
  function simulate(hi, from, rawInput, phaseMs) {
    const h = HOLES[hi];
    const input = normInput(rawInput);
    if (!h || !input || !from || !Number.isFinite(from.x) || !Number.isFinite(from.y)) return null;
    const ph = Number.isFinite(phaseMs) ? ((Math.round(phaseMs) % 60000) + 60000) % 60000 : 0;
    const T0 = ph / 1000;
    const st = statics(hi);
    const hasMovers = !!(h.movers && h.movers.length);
    let x = from.x;
    let y = from.y;
    const sp = input.power * V_MAX;
    let vx = sp * dcos(input.angle);
    let vy = sp * dsin(input.angle);
    const frames = [[r2(x), r2(y)]];
    const events = [];
    const lastHit = Object.create(null);
    let outcome = 'rest';
    let wasSand = inSand(h, x, y);
    let overCup = false;
    let slow = 0;
    const cx = h.cup[0];
    const cy = h.cup[1];
    const RR = BALL_R;
    let step = 0;
    const collide = (c, f) => {
      let px = x - c.ax;
      let py = y - c.ay;
      let t = c.len2 > 0 ? (px * c.dx + py * c.dy) / c.len2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const qx = c.ax + c.dx * t;
      const qy = c.ay + c.dy * t;
      px = x - qx;
      py = y - qy;
      const lim = RR + c.r;
      const d2 = px * px + py * py;
      if (d2 >= lim * lim) return;
      let nx;
      let ny;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        nx = px / d;
        ny = py / d;
      } else {
        const s = Math.sqrt(vx * vx + vy * vy) || 1;
        nx = -vx / s;
        ny = -vy / s;
      }
      x = qx + nx * lim;
      y = qy + ny * lim;
      let ux = 0;
      let uy = 0;
      if (c.spin) {
        ux = -c.spin.w * (qy - c.spin.cy);
        uy = c.spin.w * (qx - c.spin.cx);
      } else if (c.slide) {
        ux = c.slide.ux;
        uy = c.slide.uy;
      }
      const rvx = vx - ux;
      const rvy = vy - uy;
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        vx = rvx - (1 + c.e) * vn * nx + ux;
        vy = rvy - (1 + c.e) * vn * ny + uy;
        if (c.kind === 'bumper') {
          const out = vx * nx + vy * ny;
          if (out < KICK) { vx += (KICK - out) * nx; vy += (KICK - out) * ny; }
        }
        if (-vn > 30 && (lastHit[c.id] === undefined || step - lastHit[c.id] > 12)) {
          events.push({ f, type: c.kind, id: c.id, v: Math.round(-vn) });
        }
        lastHit[c.id] = step;
      }
    };

    for (step = 1; step <= MAX_STEPS; step++) {
      const f = Math.ceil(step / FRAME_EVERY);
      const sand = inSand(h, x, y);
      if (sand && !wasSand) events.push({ f, type: 'sand' });
      wasSand = sand;
      // forces
      const [sax, say] = slopeAccel(h, x, y);
      let ax = sax;
      let ay = say;
      const dcx = cx - x;
      const dcy = cy - y;
      const dc2 = dcx * dcx + dcy * dcy;
      if (dc2 < CUP_R * CUP_R && dc2 > 1e-12) {
        const dc = Math.sqrt(dc2);
        ax += (dcx / dc) * CUP_PULL;
        ay += (dcy / dc) * CUP_PULL;
      }
      vx += ax * DT;
      vy += ay * DT;
      // rolling resistance
      let s2 = vx * vx + vy * vy;
      if (s2 > 0) {
        const s = Math.sqrt(s2);
        const dec = (sand ? SAND_ROLL : ROLL) * DT + s * (sand ? SAND_DRAG : DRAG) * DT;
        if (dec >= s) { vx = 0; vy = 0; } else { const k = (s - dec) / s; vx *= k; vy *= k; }
      }
      x += vx * DT;
      y += vy * DT;
      for (let i = 0; i < st.length; i++) collide(st[i], f);
      if (hasMovers) {
        const ms = moverShapes(hi, T0 + step * DT);
        for (let i = 0; i < ms.length; i++) collide(ms[i], f);
      }
      if (step % FRAME_EVERY === 0) frames.push([r2(x), r2(y)]);
      // hazards
      if (inWater(h, x, y)) {
        if (step % FRAME_EVERY !== 0) frames.push([r2(x), r2(y)]);
        events.push({ f: frames.length - 1, type: 'water' });
        outcome = 'water';
        break;
      }
      const ex = cx - x;
      const ey = cy - y;
      const e2 = ex * ex + ey * ey;
      s2 = vx * vx + vy * vy;
      if (e2 < CUP_R * CUP_R) {
        if (e2 < (CUP_R - 2.5) * (CUP_R - 2.5) && s2 < V_CAP * V_CAP) {
          frames.push([cx, cy]);
          events.push({ f: frames.length - 1, type: 'sink' });
          outcome = 'sink';
          break;
        }
        if (!overCup) events.push({ f, type: 'lip' });
        overCup = true;
      } else overCup = false;
      // coming to rest
      if (s2 < V_STOP * V_STOP) {
        const [gx, gy] = slopeAccel(h, x, y);
        slow++;
        if (gx * gx + gy * gy < STATIC * STATIC || slow > 40) break;
      } else slow = 0;
    }
    if (outcome !== 'sink' && outcome !== 'water' && frames.length) {
      const last = frames[frames.length - 1];
      if (last[0] !== r2(x) || last[1] !== r2(y)) frames.push([r2(x), r2(y)]);
    }
    let end;
    if (outcome === 'sink') end = { x: cx, y: cy };
    else if (outcome === 'water') end = { x: from.x, y: from.y };
    else end = { x: r2(x), y: r2(y) };
    return { input, frames, events, outcome, end };
  }

  // ---- bot: path-distance field + search over putts ----
  const GRID = 5;
  const fieldCache = [];
  function distField(hi) {
    if (fieldCache[hi]) return fieldCache[hi];
    const h = HOLES[hi];
    const gw = Math.ceil(W / GRID);
    const gh = Math.ceil(H / GRID);
    const n = gw * gh;
    const cost = new Float64Array(n);
    const st = statics(hi);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const x = i * GRID + GRID / 2;
        const y = j * GRID + GRID / 2;
        let c = 1;
        if (!inPoly(h.fairway, x, y) || inWater(h, x, y)) c = Infinity;
        else {
          for (const k of st) {
            let t = k.len2 > 0 ? ((x - k.ax) * k.dx + (y - k.ay) * k.dy) / k.len2 : 0;
            t = clamp(t, 0, 1);
            const dx = x - (k.ax + k.dx * t);
            const dy = y - (k.ay + k.dy * t);
            if (dx * dx + dy * dy < (BALL_R + k.r - 0.5) * (BALL_R + k.r - 0.5)) { c = Infinity; break; }
          }
          if (c !== Infinity && inSand(h, x, y)) c = 3;
        }
        cost[j * gw + i] = c;
      }
    }
    const dist = new Float64Array(n).fill(Infinity);
    const ci = clamp(Math.floor(h.cup[0] / GRID), 0, gw - 1);
    const cj = clamp(Math.floor(h.cup[1] / GRID), 0, gh - 1);
    // Dijkstra with a simple binary heap
    const heap = [];
    const push = (d, k) => {
      heap.push([d, k]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    const start = cj * gw + ci;
    dist[start] = 0;
    push(0, start);
    const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    while (heap.length) {
      const [d, k] = pop();
      if (d > dist[k]) continue;
      const i = k % gw;
      const j = (k - i) / gw;
      for (const [di, dj, w] of nb) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
        const nk = nj * gw + ni;
        const c = cost[nk];
        if (c === Infinity) continue;
        const nd = d + w * GRID * (c + cost[k]) / 2;
        if (nd < dist[nk]) { dist[nk] = nd; push(nd, nk); }
      }
    }
    fieldCache[hi] = { gw, gh, dist };
    return fieldCache[hi];
  }

  // Path distance from (x, y) to the cup (straight-line when the cup is in plain view nearby).
  function pathDist(hi, x, y) {
    const h = HOLES[hi];
    const F = distField(hi);
    const ci = Math.floor(x / GRID);
    const cj = Math.floor(y / GRID);
    let best = Infinity;
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= F.gw || j >= F.gh) continue;
        const d = F.dist[j * F.gw + i];
        if (d === Infinity) continue;
        const ox = i * GRID + GRID / 2 - x;
        const oy = j * GRID + GRID / 2 - y;
        const v = d + Math.sqrt(ox * ox + oy * oy);
        if (v < best) best = v;
      }
    }
    const ex = h.cup[0] - x;
    const ey = h.cup[1] - y;
    const e = Math.sqrt(ex * ex + ey * ey);
    return Math.max(e, Math.min(best, e * 3 + 200));
  }

  // Expected strokes still needed after a putt with this result (lower is better).
  function evalResult(hi, from, res) {
    if (res.outcome === 'sink') return 0;
    if (res.outcome === 'water') return 1 + leaveCost(hi, from.x, from.y) + 0.25;
    return leaveCost(hi, res.end.x, res.end.y);
  }
  function leaveCost(hi, x, y) {
    const d = pathDist(hi, x, y);
    const h = HOLES[hi];
    let c = 1 + Math.min(3, Math.max(0, d - 18) / 230);
    if (inSand(h, x, y)) c += 0.35;
    const [gx, gy] = slopeAccel(h, x, y);
    if (gx * gx + gy * gy > STATIC * STATIC) c += 0.2;
    return c;
  }

  const BOT = {
    easy: { angles: 16, powers: 5, refine: 0, aimSd: 0.11, powSd: 0.2, pickTop: 5, robust: 0 },
    medium: { angles: 32, powers: 7, refine: 3, aimSd: 0.055, powSd: 0.11, pickTop: 2, robust: 0 },
    hard: { angles: 48, powers: 9, refine: 5, aimSd: 0.03, powSd: 0.06, pickTop: 1, robust: 4 },
    expert: { angles: 64, powers: 10, refine: 6, aimSd: 0.016, powSd: 0.032, pickTop: 1, robust: 6 },
  };

  function gauss(rand) {
    let u = 0;
    let w = 0;
    while (u === 0) u = rand();
    while (w === 0) w = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
  }

  function noisy(inp, L, rand) {
    const p = inp.power * (1 + gauss(rand) * L.powSd) + gauss(rand) * L.powSd * 0.05;
    return normInput({ angle: inp.angle + gauss(rand) * L.aimSd, power: clamp(p, MIN_POWER, 1) });
  }

  // Plans a putt from `from` on hole `hi` taken at phaseMs. Returns { angle, power } (with the
  // level's execution noise already applied). `rand` defaults to Math.random.
  function botPutt(hi, from, phaseMs, level, rand) {
    rand = rand || Math.random;
    const L = BOT[level] || BOT.hard;
    const h = HOLES[hi];
    const cands = [];
    const tryShot = (angle, power) => {
      const inp = normInput({ angle, power: clamp(power, MIN_POWER, 1) });
      const res = simulate(hi, from, inp, phaseMs);
      if (!res) return null;
      const c = { inp: res.input, score: evalResult(hi, from, res) };
      cands.push(c);
      return c;
    };
    const off = rand() * (TAU / L.angles);
    for (let a = 0; a < L.angles; a++) {
      const ang = off + (TAU * a) / L.angles;
      for (let p = 1; p <= L.powers; p++) tryShot(ang, (p / L.powers) ** 1.4);
    }
    // straight at the cup, finely graded
    const dx = h.cup[0] - from.x;
    const dy = h.cup[1] - from.y;
    const direct = Math.atan2(dy, dx);
    const dd = Math.sqrt(dx * dx + dy * dy);
    const base = Math.sqrt(2 * ROLL * dd) / V_MAX; // rough speed to just reach the cup on flat
    for (const da of [-0.03, 0, 0.03]) {
      for (const m of [0.9, 1.05, 1.2, 1.4, 1.7]) tryShot(direct + da, base * m + 0.02);
    }
    // local refinement around the best few
    for (let r = 0; r < L.refine; r++) {
      cands.sort((a, b) => a.score - b.score);
      const top = cands.slice(0, 3);
      const sa = 0.05 / (r + 1);
      const sp = 0.06 / (r + 1);
      for (const c of top) {
        if (c.score === 0 && r > 1) continue;
        for (let k = 0; k < 4; k++) tryShot(c.inp.angle + (rand() * 2 - 1) * sa, c.inp.power + (rand() * 2 - 1) * sp);
      }
    }
    cands.sort((a, b) => a.score - b.score);
    let pick;
    if (L.robust) {
      // expected value under our own execution noise, over the best few distinct shots
      const pool = cands.slice(0, L.robust);
      let bestV = Infinity;
      for (const c of pool) {
        let tot = c.score;
        const N = 5;
        for (let k = 0; k < N; k++) {
          const res = simulate(hi, from, noisy(c.inp, L, rand), phaseMs);
          tot += res ? evalResult(hi, from, res) : 3;
        }
        const v = tot / (N + 1);
        if (v < bestV) { bestV = v; pick = c; }
      }
    } else {
      pick = cands[Math.floor(rand() * Math.min(L.pickTop, cands.length))];
    }
    return noisy(pick.inp, L, rand);
  }

  // Display helpers
  function scoreName(strokes, par) {
    if (strokes === 1) return 'HOLE IN ONE!';
    const d = strokes - par;
    if (d <= -3) return 'ALBATROSS!';
    if (d === -2) return 'EAGLE!';
    if (d === -1) return 'BIRDIE!';
    if (d === 0) return 'PAR';
    if (d === 1) return 'BOGEY';
    if (d === 2) return 'DOUBLE BOGEY';
    return `+${d}`;
  }

  const api = {
    W, H, BALL_R, CUP_R, WALL_R, V_MAX, MIN_POWER, MAX_STROKES, PICKUP_SCORE, FRAME_EVERY, SPINNER_ARM_R, SLIDER_R,
    HOLES, TOTAL_PAR, dsin, dcos, normInput, simulate, statics, moverShapes, inShape, inPoly, slopeAccel,
    distField, pathDist, botPutt, scoreName, BOT_LEVELS: Object.keys(BOT),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MiniGolfSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
