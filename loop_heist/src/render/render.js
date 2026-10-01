// Canvas renderer. Reads sim state; never mutates it. Float math is fine here,
// since nothing drawn feeds back into the simulation.
import { SUB } from '../sim/fixed.js';
import { T, tileAt } from '../sim/level.js';
import { opaqueTile } from '../sim/world.js';
import { ROLES, REACH } from '../sim/constants.js';
import { G_RANGE, G_HALF, G_CLOSE, SUS_ALARM } from '../sim/guards.js';
import { CAM_HALF, CAM_ALARM, cameraActive, laserTiles } from '../sim/security.js';
import { gatherTargets } from '../sim/interact.js';

const TAU = Math.PI * 2;
const C = {
  bg: '#07101d', floor: '#0d1a2e', floorAlt: '#0f1d33', grid: 'rgba(120,170,255,0.06)',
  wall: '#1d3557', wallEdge: '#7fb3ff', window: '#3d6fa8', exit: '#12301f', exitStripe: '#2bd97a',
  door: '#9ec5ff', guard: '#ff4d5e', cone: 'rgba(255,214,102,', coneHot: 'rgba(255,77,94,',
  cam: '#c9d6ea', laser: '#ff2e4d', loot: '#ffd166', text: '#dbe7ff', paradox: '#c66bff',
};
const KEY_COLORS = { red: '#ff5d73', blue: '#4da3ff', green: '#4dffa0', yellow: '#ffd84d' };

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.ts = 32;
    this.ox = 0; this.oy = 0;
    this.prev = null;       // positions before the latest sim step, for interpolation
    this.fx = [];           // transient effects (noise rings, bursts)
    this.shake = 0;
    this.time = 0;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.cv.getBoundingClientRect();
    this.cv.width = Math.round(r.width * dpr);
    this.cv.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.vw = r.width; this.vh = r.height;
  }

  // Fit the whole map in the given screen rect (CSS px).
  fit(L, rect) {
    this.ts = Math.max(8, Math.min(48, Math.floor(Math.min(rect.w / L.w, rect.h / L.h))));
    this.ox = Math.round(rect.x + (rect.w - L.w * this.ts) / 2);
    this.oy = Math.round(rect.y + (rect.h - L.h * this.ts) / 2);
  }

  px(v) { return (v / SUB) * this.ts; }
  sx(v) { return this.ox + this.px(v); }
  sy(v) { return this.oy + this.px(v); }

  // Call right before sim.step() so drawing can interpolate between ticks.
  capture(S) {
    this.prev = {
      actors: S.actors.map((a) => [a.x, a.y]),
      guards: S.guards.map((g) => [g.x, g.y, g.facing]),
    };
  }

  // Turn this tick's noises / log entries into effects.
  collectEffects(S, fromLog = 0) {
    for (const n of S.noises) {
      const step = n.kind === 'step';
      this.fx.push({ kind: 'ring', x: n.x, y: n.y, r: n.r, t: 0, life: step ? 0.4 : 0.9, a: step ? 0.22 : 0.7, c: step ? 'rgba(150,190,255,' : 'rgba(255,230,140,' });
    }
    for (let i = fromLog; i < S.log.length; i++) {
      const e = S.log[i];
      if (e.k === 'paradox') {
        const a = S.actors[e.a];
        this.fx.push({ kind: 'burst', x: a.x, y: a.y, t: 0, life: 1.2, c: C.paradox });
        this.shake = 10;
      } else if (e.k === 'alarm') {
        this.shake = 14;
      } else if (e.k === 'escape') {
        const a = S.actors[e.a];
        this.fx.push({ kind: 'burst', x: a.x, y: a.y, t: 0, life: 0.7, c: ROLES[a.role].color });
      }
    }
    return S.log.length;
  }

  draw(sim, opts = {}) {
    const { L, S } = sim;
    const ctx = this.ctx, ts = this.ts;
    const alpha = opts.alpha ?? 1;
    const dt = opts.dt ?? 1 / 60;
    this.time += dt;

    ctx.save();
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, this.vw, this.vh);
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake = Math.max(0, this.shake - dt * 40);
    }

    this.drawTiles(L);
    this.drawExit(L);
    this.drawDevices(L, S);
    this.drawCones(sim, alpha);
    this.drawDoors(L, S);
    this.drawItems(S);
    if (opts.ghosts !== false) this.drawGhostPaths(sim, opts);
    this.drawGuards(sim, alpha);
    this.drawActors(sim, alpha, opts);
    this.drawFx(dt);
    this.drawVignette();
    if (opts.prompt !== false && sim.live >= 0) this.drawPrompt(sim, alpha);
    ctx.restore();
  }

  drawVignette() {
    const ctx = this.ctx, w = this.vw, h = this.vh;
    if (this.vigKey !== `${w}x${h}`) {
      this.vigKey = `${w}x${h}`;
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(3,7,14,0)'); g.addColorStop(1, 'rgba(3,7,14,0.55)');
      this.vig = g;
    }
    ctx.fillStyle = this.vig;
    ctx.fillRect(-20, -20, w + 40, h + 40);
  }

  lerpPos(kind, i, x, y, alpha) {
    const p = this.prev?.[kind]?.[i];
    if (!p || Math.abs(p[0] - x) > SUB || Math.abs(p[1] - y) > SUB) return [x, y];
    return [p[0] + (x - p[0]) * alpha, p[1] + (y - p[1]) * alpha];
  }

  // The static map (floor, shadows, walls, grid) is drawn once into an offscreen
  // canvas and blitted each frame; it only changes with the level or the zoom.
  drawTiles(L) {
    const key = `${L.id}|${this.ts}|${this.ox}|${this.oy}|${this.vw}|${this.vh}|${this.cv.width}`;
    if (this.tileKey !== key || this.tileL !== L) {
      this.tileKey = key; this.tileL = L;
      this.tileCanvas = this.bakeTiles(L);
    }
    const ctx = this.ctx;
    ctx.drawImage(this.tileCanvas, 0, 0, this.vw, this.vh);
  }

  bakeTiles(L) {
    const dpr = window.devicePixelRatio || 1;
    const cv = document.createElement('canvas');
    cv.width = this.cv.width; cv.height = this.cv.height;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ts = this.ts;
    const solid = (x, y) => { const t = tileAt(L, x, y); return t === T.WALL || t === T.VOID; };
    const open = (x, y) => { const t = tileAt(L, x, y); return t === T.FLOOR || t === T.EXIT || t === T.WINDOW; };

    // Floor: checker plus a soft glow per room-ish area, so rooms read as lit spaces.
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      if (!open(x, y)) continue;
      const X = this.ox + x * ts, Y = this.oy + y * ts;
      ctx.fillStyle = (x + y) & 1 ? C.floor : C.floorAlt;
      ctx.fillRect(X, Y, ts, ts);
    }
    // Ambient occlusion: walls cast a short shadow onto the floor below / beside them.
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      if (!open(x, y)) continue;
      const X = this.ox + x * ts, Y = this.oy + y * ts;
      if (solid(x, y - 1)) {
        const g = ctx.createLinearGradient(0, Y, 0, Y + ts * 0.45);
        g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(X, Y, ts, ts * 0.45);
      }
      if (solid(x - 1, y)) {
        const g = ctx.createLinearGradient(X, 0, X + ts * 0.3, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(X, Y, ts * 0.3, ts);
      }
      if (solid(x + 1, y)) {
        const g = ctx.createLinearGradient(X + ts, 0, X + ts * 0.8, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(X + ts * 0.8, Y, ts * 0.2, ts);
      }
    }
    // Windows.
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      if (tileAt(L, x, y) !== T.WINDOW) continue;
      const X = this.ox + x * ts, Y = this.oy + y * ts;
      ctx.fillStyle = 'rgba(120,190,255,0.35)';
      ctx.fillRect(X + ts * 0.3, Y, ts * 0.4, ts);
    }
    // Walls: solid fill with blueprint hatching, only where they border the building.
    const hatch = document.createElement('canvas');
    hatch.width = hatch.height = 8;
    const hc = hatch.getContext('2d');
    hc.fillStyle = C.wall; hc.fillRect(0, 0, 8, 8);
    hc.strokeStyle = 'rgba(127,179,255,0.13)'; hc.lineWidth = 1;
    hc.beginPath(); hc.moveTo(0, 8); hc.lineTo(8, 0); hc.moveTo(-1, 1); hc.lineTo(1, -1); hc.moveTo(7, 9); hc.lineTo(9, 7); hc.stroke();
    ctx.fillStyle = ctx.createPattern(hatch, 'repeat');
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      if (tileAt(L, x, y) !== T.WALL) continue;
      ctx.fillRect(this.ox + x * ts, this.oy + y * ts, ts, ts);
    }
    // Faint blueprint grid over the floor.
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= L.w; x++) { ctx.moveTo(this.ox + x * ts + 0.5, this.oy); ctx.lineTo(this.ox + x * ts + 0.5, this.oy + L.h * ts); }
    for (let y = 0; y <= L.h; y++) { ctx.moveTo(this.ox, this.oy + y * ts + 0.5); ctx.lineTo(this.ox + L.w * ts, this.oy + y * ts + 0.5); }
    ctx.stroke();
    // Wall outlines with a soft glow: edges between wall and walkable space.
    ctx.beginPath();
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      if (!solid(x, y)) continue;
      const X = this.ox + x * ts, Y = this.oy + y * ts;
      if (y > 0 && !solid(x, y - 1)) { ctx.moveTo(X, Y); ctx.lineTo(X + ts, Y); }
      if (y < L.h - 1 && !solid(x, y + 1)) { ctx.moveTo(X, Y + ts); ctx.lineTo(X + ts, Y + ts); }
      if (x > 0 && !solid(x - 1, y)) { ctx.moveTo(X, Y); ctx.lineTo(X, Y + ts); }
      if (x < L.w - 1 && !solid(x + 1, y)) { ctx.moveTo(X + ts, Y); ctx.lineTo(X + ts, Y + ts); }
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(127,179,255,0.18)';
    ctx.lineWidth = Math.max(3, ts / 5);
    ctx.stroke();
    ctx.strokeStyle = C.wallEdge;
    ctx.lineWidth = Math.max(1, ts / 16);
    ctx.stroke();
    return cv;
  }

  drawExit(L) {
    const ctx = this.ctx, ts = this.ts;
    let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1;
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      if (tileAt(L, x, y) !== T.EXIT) continue;
      minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y);
      const X = this.ox + x * ts, Y = this.oy + y * ts;
      ctx.fillStyle = C.exit;
      ctx.fillRect(X, Y, ts, ts);
    }
    if (maxx < 0) return;
    const X = this.ox + minx * ts, Y = this.oy + miny * ts, W = (maxx - minx + 1) * ts, H = (maxy - miny + 1) * ts;
    ctx.save();
    ctx.beginPath(); ctx.rect(X, Y, W, H); ctx.clip();
    ctx.strokeStyle = 'rgba(43,217,122,0.25)';
    ctx.lineWidth = ts / 6;
    for (let k = -H; k < W + H; k += ts / 1.5) { ctx.beginPath(); ctx.moveTo(X + k, Y); ctx.lineTo(X + k - H, Y + H); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = C.exitStripe;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(X + 1, Y + 1, W - 2, H - 2);
    ctx.setLineDash([]);
    ctx.fillStyle = C.exitStripe;
    ctx.font = `bold ${Math.max(9, ts * 0.38)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('VAN', X + W / 2, Y + H / 2);
  }

  drawDevices(L, S) {
    const ctx = this.ctx, ts = this.ts;
    const tc = (t) => (t + 0.5) * ts;
    // Lasers.
    S.lasers.forEach((l, i) => {
      const def = L.lasers[i];
      for (const [tx, ty] of laserTiles(def)) {
        const X = this.ox + tx * ts, Y = this.oy + ty * ts;
        if (l.on) {
          const flick = 0.6 + 0.4 * Math.sin(this.time * 30 + tx + ty);
          ctx.strokeStyle = `rgba(255,46,77,${flick})`;
          ctx.lineWidth = 2;
          ctx.shadowColor = C.laser; ctx.shadowBlur = 8;
          ctx.beginPath();
          if (def.dir === 'v') { ctx.moveTo(X + ts / 2, Y); ctx.lineTo(X + ts / 2, Y + ts); }
          else { ctx.moveTo(X, Y + ts / 2); ctx.lineTo(X + ts, Y + ts / 2); }
          ctx.stroke();
          ctx.shadowBlur = 0;
        } else {
          ctx.strokeStyle = 'rgba(255,46,77,0.15)';
          ctx.setLineDash([3, 5]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          if (def.dir === 'v') { ctx.moveTo(X + ts / 2, Y); ctx.lineTo(X + ts / 2, Y + ts); }
          else { ctx.moveTo(X, Y + ts / 2); ctx.lineTo(X + ts, Y + ts / 2); }
          ctx.stroke(); ctx.setLineDash([]);
        }
      }
    });
    // Power boxes.
    S.powerboxes.forEach((pb, i) => {
      const def = L.powerboxes[i];
      const on = S.circuits[def.circuit];
      const X = this.ox + def.x * ts + ts * 0.18, Y = this.oy + def.y * ts + ts * 0.18, s = ts * 0.64;
      ctx.fillStyle = on ? '#3b3418' : '#1b1b1b';
      ctx.strokeStyle = on ? '#ffd84d' : '#666';
      ctx.lineWidth = 2;
      ctx.fillRect(X, Y, s, s); ctx.strokeRect(X, Y, s, s);
      ctx.fillStyle = on ? '#ffd84d' : '#555';
      ctx.beginPath();
      ctx.moveTo(X + s * 0.55, Y + s * 0.12); ctx.lineTo(X + s * 0.3, Y + s * 0.55); ctx.lineTo(X + s * 0.5, Y + s * 0.55);
      ctx.lineTo(X + s * 0.42, Y + s * 0.88); ctx.lineTo(X + s * 0.72, Y + s * 0.42); ctx.lineTo(X + s * 0.52, Y + s * 0.42);
      ctx.closePath(); ctx.fill();
      this.label(def.circuit, X + s / 2, Y - 4, on ? '#ffd84d' : '#777');
    });
    // Terminals.
    S.terminals.forEach((tm, i) => {
      const def = L.terminals[i];
      const powered = !def.circuit || S.circuits[def.circuit];
      const X = this.ox + def.x * ts + ts * 0.15, Y = this.oy + def.y * ts + ts * 0.2;
      ctx.fillStyle = '#0a1a12';
      ctx.strokeStyle = tm.used ? '#356' : (powered ? '#4dffa0' : '#555');
      ctx.lineWidth = 2;
      ctx.fillRect(X, Y, ts * 0.7, ts * 0.5); ctx.strokeRect(X, Y, ts * 0.7, ts * 0.5);
      if (powered && !tm.used) {
        ctx.fillStyle = '#4dffa0';
        for (let k = 0; k < 3; k++) ctx.fillRect(X + ts * 0.1, Y + ts * (0.1 + k * 0.12), ts * (0.2 + ((k * 7 + Math.floor(this.time * 4)) % 4) * 0.08), ts * 0.05);
      }
      ctx.fillStyle = '#556';
      ctx.fillRect(X + ts * 0.3, Y + ts * 0.5, ts * 0.1, ts * 0.15);
    });
    // Vaults.
    S.vaults.forEach((v, i) => {
      const def = L.vaults[i];
      const X = this.ox + tc(def.x), Y = this.oy + tc(def.y), r = ts * 0.42;
      ctx.fillStyle = v.open ? '#1a2333' : '#3a4a63';
      ctx.strokeStyle = v.open ? '#5b6b86' : '#c7d3e6';
      ctx.lineWidth = 2;
      ctx.fillRect(X - r, Y - r, r * 2, r * 2); ctx.strokeRect(X - r, Y - r, r * 2, r * 2);
      ctx.beginPath(); ctx.arc(X, Y, r * 0.55, 0, TAU); ctx.stroke();
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + (v.open ? 0.8 : 0);
        ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + Math.cos(a) * r * 0.55, Y + Math.sin(a) * r * 0.55); ctx.stroke();
      }
    });
    // Cameras (body; cones are drawn with the guards' cones).
    S.cameras.forEach((c, i) => {
      const X = this.sx(c.x), Y = this.sy(c.y);
      const a = (c.facing / 256) * TAU;
      ctx.save();
      ctx.translate(X, Y); ctx.rotate(a);
      ctx.fillStyle = cameraActive(L, S, i) ? C.cam : '#555';
      ctx.fillRect(-ts * 0.2, -ts * 0.13, ts * 0.42, ts * 0.26);
      ctx.fillStyle = cameraActive(L, S, i) ? (c.seeing >= 0 ? '#ff4d5e' : '#4dffa0') : '#333';
      ctx.beginPath(); ctx.arc(ts * 0.22, 0, ts * 0.07, 0, TAU); ctx.fill();
      ctx.restore();
      if (c.looped > 0) this.label('LOOP', X, Y - ts * 0.4, '#5ab8ff');
    });
  }

  // Visible-area polygon by casting rays and stopping at opaque tiles.
  visionPoly(L, S, x, y, facing, half, range) {
    const pts = [];
    const a0 = ((facing - half) / 256) * TAU, a1 = ((facing + half) / 256) * TAU;
    const rays = Math.max(12, Math.round(half / 1.5));
    for (let k = 0; k <= rays; k++) {
      const a = a0 + (a1 - a0) * (k / rays);
      const ca = Math.cos(a), sa = Math.sin(a);
      let d = 0;
      const step = 24;
      while (d < range) {
        const nx = x + ca * (d + step), ny = y + sa * (d + step);
        if (opaqueTile(L, S, Math.floor(nx / SUB), Math.floor(ny / SUB))) break;
        d += step;
      }
      pts.push([x + ca * d, y + sa * d]);
    }
    return pts;
  }

  fillPoly(origin, pts, fill) {
    const ctx = this.ctx;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(this.sx(origin[0]), this.sy(origin[1]));
    for (const [x, y] of pts) ctx.lineTo(this.sx(x), this.sy(y));
    ctx.closePath();
    ctx.fill();
  }

  drawCones(sim, alpha) {
    const { L, S } = sim;
    S.guards.forEach((g, i) => {
      if (g.state === 'ko') return;
      const [x, y] = this.lerpPos('guards', i, g.x, g.y, alpha);
      const hot = Math.min(1, g.sus / SUS_ALARM);
      const base = hot > 0 ? C.coneHot : C.cone;
      const poly = this.visionPoly(L, S, x, y, g.facing, G_HALF, G_RANGE);
      this.fillPoly([x, y], poly, `${base}${0.10 + hot * 0.25})`);
      this.ctx.strokeStyle = `${base}${0.25 + hot * 0.4})`;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.arc(this.sx(x), this.sy(y), this.px(G_CLOSE), 0, TAU);
      this.ctx.stroke();
    });
    S.cameras.forEach((c, i) => {
      if (!cameraActive(L, S, i)) return;
      const def = L.cameras[i];
      const hot = Math.min(1, c.sus / CAM_ALARM);
      const poly = this.visionPoly(L, S, c.x, c.y, c.facing, def.half ?? CAM_HALF, (def.range ?? 6) * SUB);
      this.fillPoly([c.x, c.y], poly, hot > 0 ? `rgba(255,77,94,${0.12 + hot * 0.3})` : 'rgba(120,200,255,0.10)');
    });
  }

  drawDoors(L, S) {
    const ctx = this.ctx, ts = this.ts;
    S.doors.forEach((d, i) => {
      const def = L.doors[i];
      const X = this.ox + def.x * ts, Y = this.oy + def.y * ts;
      // Orientation: door spans the gap between walls.
      const horiz = tileAt(L, def.x - 1, def.y) === T.WALL || tileAt(L, def.x + 1, def.y) === T.WALL;
      const col = d.locked ? (KEY_COLORS[d.locked] ?? '#ff9f43') : C.door;
      ctx.fillStyle = C.floor;
      ctx.fillRect(X, Y, ts, ts);
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = Math.max(2, ts / 8);
      if (!d.open) {
        if (horiz) ctx.fillRect(X, Y + ts * 0.38, ts, ts * 0.24);
        else ctx.fillRect(X + ts * 0.38, Y, ts * 0.24, ts);
        if (d.locked) {
          ctx.fillStyle = '#07101d';
          ctx.beginPath(); ctx.arc(X + ts / 2, Y + ts / 2, ts * 0.1, 0, TAU); ctx.fill();
        }
      } else {
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        if (horiz) { ctx.moveTo(X, Y + ts / 2); ctx.lineTo(X, Y + ts * 0.5 - ts * 0.9); }
        else { ctx.moveTo(X + ts / 2, Y); ctx.lineTo(X + ts * 0.5 + ts * 0.9, Y); }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    });
  }

  drawItems(S) {
    const ctx = this.ctx, ts = this.ts;
    for (const it of S.items) {
      if (it.carrier >= 0 || it.secured || it.hidden) continue;
      const X = this.sx(it.x), Y = this.sy(it.y);
      const bob = Math.sin(this.time * 3 + it.x) * ts * 0.04;
      if (it.kind === 'key') {
        ctx.fillStyle = KEY_COLORS[it.color] ?? '#fff';
        ctx.fillRect(X - ts * 0.18, Y - ts * 0.12 + bob, ts * 0.36, ts * 0.24);
        ctx.fillStyle = '#07101d';
        ctx.fillRect(X - ts * 0.12, Y - ts * 0.04 + bob, ts * 0.12, ts * 0.06);
      } else {
        ctx.shadowColor = C.loot; ctx.shadowBlur = 12;
        ctx.fillStyle = C.loot;
        ctx.beginPath();
        ctx.moveTo(X, Y - ts * 0.25 + bob); ctx.lineTo(X + ts * 0.22, Y + bob); ctx.lineTo(X, Y + ts * 0.25 + bob); ctx.lineTo(X - ts * 0.22, Y + bob);
        ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        if (it.required) this.label('TARGET', X, Y - ts * 0.45, C.loot);
      }
    }
  }

  drawGhostPaths(sim, opts) {
    const ctx = this.ctx;
    const t = sim.S.tick;
    sim.crew.forEach((c, i) => {
      const rec = i === sim.live ? opts.oldRec : c.rec;
      if (!rec || !rec.trace.length) return;
      const col = ROLES[c.role].color;
      const n = rec.trace.length / 2;
      const isOld = i === sim.live;
      // Future path: dashed and faint. Past: solid but fainter still.
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      for (const [from, to, dash, a] of [[0, Math.min(t, n), [], 0.12], [Math.min(t, n - 1), n, [4, 6], isOld ? 0.25 : 0.45]]) {
        if (to - from < 2) continue;
        ctx.strokeStyle = col;
        ctx.globalAlpha = a;
        ctx.setLineDash(dash);
        ctx.beginPath();
        for (let k = from; k < to; k += 2) {
          const X = this.sx(rec.trace[k * 2]), Y = this.sy(rec.trace[k * 2 + 1]);
          k === from ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // Event markers along the path.
      ctx.globalAlpha = isOld ? 0.35 : 0.8;
      for (const e of rec.events) {
        const k = Math.min(e.t, n - 1);
        const X = this.sx(rec.trace[k * 2]), Y = this.sy(rec.trace[k * 2 + 1]);
        ctx.fillStyle = e.t < t ? '#445' : col;
        ctx.beginPath(); ctx.arc(X, Y, 3.5, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    });
  }

  drawGuards(sim, alpha) {
    const { S } = sim;
    const ctx = this.ctx, ts = this.ts;
    S.guards.forEach((g, i) => {
      const [x, y] = g.state === 'ko' ? [g.x, g.y] : this.lerpPos('guards', i, g.x, g.y, alpha);
      const X = this.sx(x), Y = this.sy(y), r = ts * 0.33;
      if (g.state === 'ko') {
        ctx.fillStyle = '#5a2730';
        ctx.beginPath(); ctx.ellipse(X, Y, r * 1.2, r * 0.7, 0.4, 0, TAU); ctx.fill();
        this.label('zzz', X + r, Y - r, '#ff9aa5');
        return;
      }
      const a = (g.facing / 256) * TAU;
      ctx.fillStyle = C.guard;
      ctx.shadowColor = C.guard; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#2a0a10';
      ctx.beginPath(); ctx.arc(X + Math.cos(a) * r * 0.5, Y + Math.sin(a) * r * 0.5, r * 0.3, 0, TAU); ctx.fill();
      // Suspicion meter.
      if (g.sus > 0 || g.state === 'investigate' || g.state === 'search') {
        const f = Math.min(1, g.sus / SUS_ALARM);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(X, Y - r * 2.1, r * 0.55, 0, TAU); ctx.stroke();
        ctx.strokeStyle = f > 0.6 ? '#ff4d5e' : '#ffd166';
        ctx.beginPath(); ctx.arc(X, Y - r * 2.1, r * 0.55, -Math.PI / 2, -Math.PI / 2 + TAU * f); ctx.stroke();
        this.label(f >= 1 ? '!' : '?', X, Y - r * 2.1, f > 0.6 ? '#ff4d5e' : '#ffd166', 1.4);
      }
      if (g.state === 'restore') this.label('fixing power', X, Y + r * 1.9, '#ffd84d');
      this.label(g.id, X, Y + r * 1.9 + (g.state === 'restore' ? 11 : 0), 'rgba(255,170,180,0.7)');
    });
  }

  drawActors(sim, alpha, opts) {
    const { S } = sim;
    const ctx = this.ctx, ts = this.ts;
    S.actors.forEach((a, i) => {
      if (a.escaped) return;
      const [x, y] = this.lerpPos('actors', i, a.x, a.y, alpha);
      const X = this.sx(x), Y = this.sy(y), r = ts * 0.3;
      const col = ROLES[a.role].color;
      const live = i === sim.live;
      // Paradox: show where the clone was supposed to be.
      if (a.lost) {
        const rec = sim.crew[i].rec;
        const k = Math.min(S.tick, rec.len - 1);
        if (k >= 0) {
          const ex = this.sx(rec.trace[k * 2]), ey = this.sy(rec.trace[k * 2 + 1]);
          ctx.strokeStyle = C.paradox; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(ex, ey, r, 0, TAU); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.globalAlpha = live ? 1 : 0.85;
      if (live) {
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.globalAlpha = 0.4 + 0.3 * Math.sin(this.time * 5);
        ctx.beginPath(); ctx.arc(X, Y, r * 1.6, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const jitter = a.lost ? (Math.random() - 0.5) * 3 : 0;
      ctx.fillStyle = a.lost ? C.paradox : col;
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = live ? 16 : 8;
      ctx.beginPath(); ctx.arc(X + jitter, Y, r, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      const fa = (a.facing / 256) * TAU;
      ctx.fillStyle = '#07101d';
      ctx.beginPath(); ctx.arc(X + Math.cos(fa) * r * 0.45, Y + Math.sin(fa) * r * 0.45, r * 0.22, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      this.label(a.lost ? '?!' : String(i + 1), X, Y - r * 1.75, a.lost ? C.paradox : col, a.lost ? 1.3 : 1);
      if (a.carrying >= 0) {
        ctx.fillStyle = C.loot;
        ctx.beginPath(); ctx.arc(X + r * 0.8, Y + r * 0.6, r * 0.35, 0, TAU); ctx.fill();
      }
      if (a.body >= 0) this.label('carrying', X, Y + r * 2, '#ff9aa5', 0.8);
      if (a.keys.length) a.keys.forEach((k, j) => { ctx.fillStyle = KEY_COLORS[k] ?? '#fff'; ctx.fillRect(X - r + j * 6, Y + r * 1.3, 5, 4); });
      if (a.using) {
        const f = a.using.progress / a.using.need;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(X, Y, r * 1.5, -Math.PI / 2, -Math.PI / 2 + TAU * f); ctx.stroke();
      }
    });
  }

  drawPrompt(sim, alpha) {
    const a = sim.S.actors[sim.live];
    if (!a || a.escaped || a.using) return;
    const tg = gatherTargets(sim, a)[0];
    let text = null;
    if (tg) {
      const { L, S } = sim;
      switch (tg.kind) {
        case 'door': {
          const d = S.doors[tg.idx];
          text = d.open ? 'close door' : tg.pick ? 'hold: pick lock' : d.locked && !a.keys.includes(d.locked) ? `locked (${d.locked} key)` : 'open door';
          break;
        }
        case 'key': text = `take ${S.items[tg.idx].color} keycard`; break;
        case 'loot': text = 'take loot'; break;
        case 'powerbox': text = S.circuits[L.powerboxes[tg.idx].circuit] ? 'hold: cut power' : 'hold: restore power'; break;
        case 'terminal': text = `hold: hack (${L.terminals[tg.idx].label ?? 'terminal'})`; break;
        case 'vault': text = 'hold: crack vault'; break;
        case 'takedown': text = 'take down guard'; break;
        case 'body': text = 'pick up body'; break;
        case 'escape': text = 'ESCAPE'; break;
      }
    } else if (a.carrying >= 0 || a.body >= 0) text = 'drop';
    if (!text) return;
    const [x, y] = this.lerpPos('actors', a.i, a.x, a.y, alpha);
    const X = this.sx(x), Y = this.sy(y) + this.ts * 0.9;
    const ctx = this.ctx;
    ctx.font = '600 12px "JetBrains Mono", monospace';
    const w = ctx.measureText(`E  ${text}`).width + 14;
    ctx.fillStyle = 'rgba(7,16,29,0.85)';
    ctx.strokeStyle = 'rgba(219,231,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(X - w / 2, Y - 10, w, 20, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffd166';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('E', X - w / 2 + 7, Y + 1);
    ctx.fillStyle = C.text;
    ctx.fillText(text, X - w / 2 + 25, Y + 1);
  }

  drawFx(dt) {
    const ctx = this.ctx;
    this.fx = this.fx.filter((f) => (f.t += dt) < f.life);
    for (const f of this.fx) {
      const k = f.t / f.life;
      const X = this.sx(f.x), Y = this.sy(f.y);
      if (f.kind === 'ring') {
        ctx.strokeStyle = `${f.c}${(1 - k) * f.a})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(X, Y, this.px(f.r) * k, 0, TAU); ctx.stroke();
      } else if (f.kind === 'burst') {
        ctx.strokeStyle = f.c;
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = 3;
        for (let j = 0; j < 10; j++) {
          const a = j * TAU / 10 + f.x;
          const r0 = this.ts * (0.3 + k * 1.2), r1 = r0 + this.ts * 0.3;
          ctx.beginPath(); ctx.moveTo(X + Math.cos(a) * r0, Y + Math.sin(a) * r0); ctx.lineTo(X + Math.cos(a) * r1, Y + Math.sin(a) * r1); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  label(text, x, y, color, scale = 1) {
    const ctx = this.ctx;
    ctx.font = `700 ${Math.round(Math.max(9, this.ts * 0.3) * scale)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(7,16,29,0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
}

export { REACH };
