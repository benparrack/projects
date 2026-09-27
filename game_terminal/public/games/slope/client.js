// Slope client. The ball's physics run right here at 60fps on the shared track (sim.js, also run
// by the server for bots), so gravity, jumps and landings respond instantly; our position goes
// to the server at 10Hz and everyone else's comes back as ghosts. Rendering: neon tile track
// that shifts colour as it gets harder, a synthwave valley of wireframe mountains that falls away
// with the track, a striped sun on the horizon, stars, and a chase camera that widens with speed
// and shakes on hard landings.

import { makeServerClock } from '../serverClock.js';
import { sfx } from '../sfx.js';
import { createBotBar } from '../tickBots.js';

const BEST_KEY = 'gt-slope-best';

function loadScript(src, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve(window[global]);
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

function readBest() {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
}
function writeBest(v) {
  try { localStorage.setItem(BEST_KEY, String(v)); } catch { /* private mode */ }
}

// Tile: dark glassy fill, bright border, faint inner cross — tinted per piece by material colour.
function tileTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 128, 128);
  grad.addColorStop(0, '#1d1d1d');
  grad.addColorStop(1, '#0c0c0c');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
  g.shadowColor = '#fff';
  g.shadowBlur = 10;
  g.strokeStyle = '#fff';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 122, 122);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function ballTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0a1a0a';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#39ff14';
  g.lineWidth = 7;
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(i * 64 + 8, 0); g.lineTo(i * 64 + 40, 128); g.stroke(); }
  g.fillStyle = '#b6ff9c';
  g.fillRect(0, 58, 256, 12);
  return new THREE.CanvasTexture(c);
}

// Boost pad: bright chevrons pointing down the track.
function boostTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#00c8ff';
  g.fillRect(0, 0, 128, 256);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 16;
  g.lineJoin = 'miter';
  for (let i = 0; i < 3; i++) {
    const y = 40 + i * 78;
    g.beginPath(); g.moveTo(14, y + 44); g.lineTo(64, y); g.lineTo(114, y + 44); g.stroke();
  }
  g.strokeStyle = '#003a55';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 122, 250);
  return new THREE.CanvasTexture(c);
}

function sunTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#ffe66b');
  grad.addColorStop(0.5, '#ff5fa2');
  grad.addColorStop(1, '#8a2be2');
  g.fillStyle = grad;
  g.beginPath(); g.arc(128, 128, 120, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 7; i++) g.fillRect(0, 140 + i * 16, 256, 3 + i * 1.6);
  return new THREE.CanvasTexture(c);
}

function nameSprite(THREE, text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 48;
  const g = c.getContext('2d');
  g.font = 'bold 26px monospace';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(0, 6, 256, 36);
  g.fillStyle = color;
  g.fillText(text.slice(0, 16), 128, 34);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  sp.scale.set(3.2, 0.6, 1);
  return sp;
}

// Cheap deterministic value noise for the mountains.
function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise2(x, z) {
  const xi = Math.floor(x); const zi = Math.floor(z);
  const xf = x - xi; const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf); const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi); const b = hash2(xi + 1, zi); const c = hash2(xi, zi + 1); const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function mount(container, api) {
  const clock = makeServerClock();
  let view = null;
  let destroyed = false;
  let THREE = null; let Sim = null;
  let best = readBest();

  // --- DOM ---
  const root = document.createElement('div');
  root.style.cssText = 'position:relative;width:100%;height:min(72vh,640px);min-height:420px;background:#05010f;overflow:hidden;border-radius:6px;touch-action:none;user-select:none';
  container.appendChild(root);
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;inset:0';
  root.appendChild(host);
  const mk = (css) => { const d = document.createElement('div'); d.style.cssText = `position:absolute;pointer-events:none;font-family:monospace;${css}`; root.appendChild(d); return d; };
  const scoreEl = mk('top:10px;left:50%;transform:translateX(-50%);font-size:34px;font-weight:bold;color:#fff;text-shadow:0 0 12px #39ff14,0 0 2px #000;text-align:center');
  const subEl = mk('top:52px;left:50%;transform:translateX(-50%);font-size:13px;color:#b8ffb0;text-shadow:0 0 4px #000;white-space:nowrap');
  const boardEl = mk('top:10px;right:12px;font-size:12.5px;color:#ffd166;text-align:right;text-shadow:0 0 4px #000;line-height:1.45');
  const liveEl = mk('top:10px;left:12px;font-size:12.5px;color:#9ef;text-shadow:0 0 4px #000;line-height:1.45');
  const centerEl = mk('top:42%;left:50%;transform:translate(-50%,-50%);font-size:44px;font-weight:bold;color:#fff;text-align:center;white-space:pre-line;text-shadow:0 0 18px #ff2fb0,0 0 3px #000');
  const hintEl = mk('bottom:10px;left:50%;transform:translateX(-50%);font-size:12px;color:#aaa;text-shadow:0 0 3px #000;white-space:nowrap');
  hintEl.textContent = '← → / A D to steer · tap left/right side on touch';
  const botBar = createBotBar(api);
  botBar.el.style.cssText += ';position:absolute;bottom:30px;left:10px;margin:0;pointer-events:auto;font-family:monospace;font-size:12px';
  root.appendChild(botBar.el);
  const leaveBtn = document.createElement('button');
  leaveBtn.textContent = 'LEAVE';
  leaveBtn.style.cssText = 'position:absolute;bottom:8px;right:10px';
  leaveBtn.addEventListener('click', () => api.leaveRoom());
  root.appendChild(leaveBtn);

  // --- Input ---
  const keys = { left: false, right: false };
  const touch = { left: false, right: false };
  function onKey(e, down) {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') keys.left = down;
    else if (k === 'arrowright' || k === 'd') keys.right = down;
    else return;
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    e.preventDefault();
  }
  const kd = (e) => onKey(e, true);
  const ku = (e) => onKey(e, false);
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  function onPointer(e, down) {
    if (e.target !== renderer?.domElement) return;
    const r = root.getBoundingClientRect();
    const left = e.clientX - r.left < r.width / 2;
    if (down) { touch.left = left; touch.right = !left; } else { touch.left = touch.right = false; }
  }
  const pd = (e) => onPointer(e, true);
  const pu = (e) => onPointer(e, false);
  root.addEventListener('pointerdown', pd);
  window.addEventListener('pointerup', pu);
  window.addEventListener('pointercancel', pu);
  const steerInput = () => ((keys.right || touch.right) ? 1 : 0) - ((keys.left || touch.left) ? 1 : 0);

  // --- Scene state ---
  let renderer; let scene; let camera; let rafId = 0;
  let tileMat; let ballMesh; let sun; let stars; let glow;
  let track = null; let trackSeed = null; let roundId = null;
  const built = new Map(); // piece index -> { group, obs: [{ mesh, p, o }] }
  const terrain = new Map(); // chunk index -> group
  const ghosts = new Map(); // clientId -> { mesh, label, cur, tgt }
  let ball = null; let alive = false;
  let acc = 0; let lastFrame = 0; let lastSend = 0;
  let camPos = null; let shake = 0; let deathAt = 0;
  let zoomV = 17; let boostFlash = 0;
  const prev = { s: 0, x: 0, y: 0, roll: 0 }; // ball state one physics step back, for interpolation
  const drawn = { s: 0, x: 0, y: 0, roll: 0 }; // what we actually render this frame
  let lastCountdown = null; let newBestThisRun = false;
  const obsMat = {};
  const autoMem = { steer: 0, hold: 0 };

  const pieceColor = (p) => {
    const d = Sim.difficulty(p.s0);
    const c = new THREE.Color();
    c.setHSL((0.33 - d * 0.55 + 1) % 1, 1, 0.55); // green -> cyan -> blue -> magenta -> red
    return c;
  };

  function initScene() {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#07021a');
    scene.fog = new THREE.Fog('#1a0433', 70, 430);
    camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1500);
    scene.add(new THREE.HemisphereLight('#b7a4ff', '#200030', 0.9));
    const dir = new THREE.DirectionalLight('#ffffff', 0.8);
    dir.position.set(-3, 10, 4);
    scene.add(dir);
    tileMat = tileTexture(THREE);
    obsMat.body = new THREE.MeshBasicMaterial({ color: '#ff1e3c' });
    obsMat.edge = new THREE.LineBasicMaterial({ color: '#ffd0d6' });
    obsMat.warn = new THREE.MeshBasicMaterial({ color: '#ff1e3c', transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    obsMat.pad = new THREE.MeshBasicMaterial({ map: boostTexture(THREE), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

    const bt = ballTexture(THREE);
    ballMesh = new THREE.Mesh(new THREE.SphereGeometry(Sim.R, 32, 18), new THREE.MeshStandardMaterial({ map: bt, emissive: '#1b5e12', emissiveMap: bt, metalness: 0.3, roughness: 0.35 }));
    scene.add(ballMesh);
    glow = new THREE.PointLight('#39ff14', 1.2, 9);
    scene.add(glow);

    sun = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshBasicMaterial({ map: sunTexture(THREE), transparent: true, fog: false, depthWrite: false }));
    scene.add(sun);
    const starGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 900; i++) {
      const th = Math.random() * Math.PI * 2; const ph = Math.random() * Math.PI * 0.45;
      const r = 900;
      pts.push(Math.cos(th) * Math.cos(ph) * r, Math.sin(ph) * r + 40, Math.sin(th) * Math.cos(ph) * r);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, fog: false }));
    scene.add(stars);
    resize();
  }

  function resize() {
    if (!renderer) return;
    const w = root.clientWidth; const h = root.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(root);

  // --- Track meshes ---
  function surf(p, s, xr) {
    return [Sim.centerAt(p, s) + xr * Math.cos(p.bank), Sim.heightAt(p, s, xr), -s];
  }
  function buildPiece(i) {
    const p = track.pieces[i];
    const group = new THREE.Group();
    const entry = { group, obs: [] };
    if (!p.gap) {
      const nS = Math.max(1, Math.round(p.len / 2.6));
      const nX = Math.max(1, Math.round(p.w / 2.6));
      const pos = []; const uv = []; const idx = [];
      let v = 0;
      for (let a = 0; a < nS; a++) {
        for (let b = 0; b < nX; b++) {
          const s0 = p.s0 + (a / nS) * p.len; const s1 = p.s0 + ((a + 1) / nS) * p.len;
          const x0 = -p.w / 2 + (b / nX) * p.w; const x1 = -p.w / 2 + ((b + 1) / nX) * p.w;
          const sm = (s0 + s1) / 2; const xm = (x0 + x1) / 2;
          if (p.holes.some((h) => sm >= h.s0 && sm <= h.s1 && xm >= h.xr0 && xm <= h.xr1)) continue;
          pos.push(...surf(p, s0, x0), ...surf(p, s0, x1), ...surf(p, s1, x1), ...surf(p, s1, x0));
          uv.push(0, 0, 1, 0, 1, 1, 0, 1);
          idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
          v += 4;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const col = pieceColor(p);
      const top = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tileMat, color: col, side: THREE.DoubleSide }));
      group.add(top);
      // Glowing rails along both edges, and solid walls from every edge (sides, front, back) all
      // the way down to the valley floor, so platforms read as towers rather than floating tiles.
      const rail = [];
      const skirt = [];
      const cols = [];
      const topC = col.clone().multiplyScalar(0.32);
      const botC = new THREE.Color('#07021a');
      const floorY = (s) => Sim.heightAt(p, s, 0) - 36;
      const wall = (a, b, sa, sb) => {
        // a, b: [x, y, z] top corners; sa, sb: their s (for the floor height below them).
        const ya = floorY(sa); const yb = floorY(sb);
        skirt.push(...a, ...b, b[0], yb, b[2], ...a, b[0], yb, b[2], a[0], ya, a[2]);
        for (const c of [topC, topC, botC, topC, botC, botC]) cols.push(c.r, c.g, c.b);
      };
      const n = Math.max(2, Math.round(p.len / 3));
      for (const side of [-1, 1]) {
        const line = [];
        for (let k = 0; k <= n; k++) {
          const s = p.s0 + (k / n) * p.len;
          const [x, y, z] = surf(p, s, (side * p.w) / 2);
          line.push(new THREE.Vector3(x, y + 0.02, z));
          if (k < n) {
            const s2 = p.s0 + ((k + 1) / n) * p.len;
            wall([x, y, z], surf(p, s2, (side * p.w) / 2), s, s2);
          }
        }
        rail.push(line);
      }
      const railMat = new THREE.LineBasicMaterial({ color: col.clone().lerp(new THREE.Color('#ffffff'), 0.45) });
      for (const line of rail) group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(line), railMat));
      for (const e of [p.s0, p.s1]) {
        const nx = Math.max(1, Math.round(p.w / 2.6));
        for (let k = 0; k < nx; k++) wall(surf(p, e, -p.w / 2 + (k / nx) * p.w), surf(p, e, -p.w / 2 + ((k + 1) / nx) * p.w), e, e);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(skirt, 3));
      sg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      group.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
      // Bright edge lines down the corners so the tower shape reads at a glance.
      const corner = [];
      for (const e of [p.s0, p.s1]) {
        for (const side of [-1, 1]) {
          const [x, y, z] = surf(p, e, (side * p.w) / 2);
          corner.push(new THREE.Vector3(x, y, z), new THREE.Vector3(x, floorY(e), z));
        }
      }
      group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(corner), railMat));
      for (const o of p.obs) {
        const geo = new THREE.BoxGeometry(o.hw * 2, o.h, o.hl * 2);
        const mesh = new THREE.Mesh(geo, obsMat.body);
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), obsMat.edge));
        group.add(mesh);
        entry.obs.push({ mesh, p, o });
        if (o.lift) {
          // A red hatch on the floor marks where a piston comes up.
          const warn = new THREE.Mesh(new THREE.PlaneGeometry(o.hw * 2 + 0.3, o.hl * 2 + 0.3), obsMat.warn);
          const [x, y, z] = surf(p, o.s, o.xr);
          warn.position.set(x, y + 0.03, z);
          warn.rotation.x = -Math.PI / 2 + Math.atan(p.slope);
          group.add(warn);
        }
      }
      for (const pad of p.pads) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(pad.hw * 2, pad.hl * 2), obsMat.pad);
        const [x, y, z] = surf(p, pad.s, pad.xr);
        m.position.set(x, y + 0.04, z);
        m.rotation.x = -Math.PI / 2 + Math.atan(p.slope);
        group.add(m);
      }
    }
    scene.add(group);
    built.set(i, entry);
  }
  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !Object.values(obsMat).includes(o.material)) o.material.dispose();
    });
    scene.remove(g);
  }

  // Mountains: chunks along the track, a valley around it, falling away with the track height.
  const CHUNK = 120;
  function buildTerrain(ci) {
    const s0 = ci * CHUNK;
    const nx = 48; const nz = 12;
    const W = 700;
    const pos = [];
    const idx = [];
    for (let j = 0; j <= nz; j++) {
      const s = s0 + (j / nz) * CHUNK;
      Sim.ensure(track, s);
      const p = Sim.pieceAt(track, s);
      const base = Sim.heightAt(p, Math.min(s, p.s1), 0) - 34;
      const cx = Sim.centerAt(p, Math.min(s, p.s1));
      for (let i = 0; i <= nx; i++) {
        const x = cx - W / 2 + (i / nx) * W;
        const off = Math.abs(x - cx);
        const valley = Math.max(0, (off - 55) / 120);
        const h = valley * valley * 70 * (0.45 + noise2(x * 0.02, s * 0.02) * 0.9) + noise2(x * 0.08, s * 0.08) * 6 * valley;
        pos.push(x, base + h, -s);
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i; const b = a + 1; const c = a + nx + 1; const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#12032b' })));
    group.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#ff2fd0', wireframe: true, transparent: true, opacity: 0.55 })));
    scene.add(group);
    terrain.set(ci, group);
  }

  function syncWorld(s) {
    Sim.ensure(track, s + 420);
    const ps = track.pieces;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const want = p.s1 > s - 40 && p.s0 < s + 420;
      if (want && !built.has(i)) buildPiece(i);
      else if (!want && built.has(i)) { disposeGroup(built.get(i).group); built.delete(i); }
    }
    const c0 = Math.floor((s - 60) / CHUNK); const c1 = Math.floor((s + 460) / CHUNK);
    for (let c = c0; c <= c1; c++) if (!terrain.has(c) && c >= 0) buildTerrain(c);
    for (const [c, g] of terrain) if (c < c0 || c > c1) { disposeGroup(g); terrain.delete(c); }
  }

  function resetWorld(seed) {
    for (const e of built.values()) disposeGroup(e.group);
    built.clear();
    for (const g of terrain.values()) disposeGroup(g);
    terrain.clear();
    track = Sim.makeTrack(seed);
    trackSeed = seed;
    ball = Sim.newBall(track);
    alive = true;
    acc = 0;
    camPos = null;
    zoomV = Sim.targetSpeed(0);
    Object.assign(prev, { s: ball.s, x: ball.x, y: ball.y, roll: ball.roll });
    newBestThisRun = false;
    syncWorld(ball.s);
  }

  // --- Ghosts ---
  function syncGhosts() {
    const me = api.getClientId();
    const seen = new Set();
    for (const p of view.players) {
      if (p.clientId === me || !p.inRound) continue;
      seen.add(p.clientId);
      let g = ghosts.get(p.clientId);
      if (!g) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(Sim.R, 20, 12), new THREE.MeshStandardMaterial({ color: p.color, emissive: p.color, emissiveIntensity: 0.6, transparent: true, opacity: 0.75 }));
        const label = nameSprite(THREE, p.nickname, p.color);
        scene.add(mesh); scene.add(label);
        g = { mesh, label, cur: { s: p.s, x: p.x, y: p.y }, tgt: { s: p.s, x: p.x, y: p.y }, vs: 0, at: performance.now() };
        ghosts.set(p.clientId, g);
      }
      const now = performance.now();
      const dtS = (now - g.at) / 1000;
      if (dtS > 0.02 && p.s > g.tgt.s) g.vs = (p.s - g.tgt.s) / dtS;
      g.tgt = { s: p.s, x: p.x, y: p.y };
      g.at = now;
      g.alive = p.alive;
      g.mesh.material.opacity = p.alive ? 0.75 : 0.25;
    }
    for (const [id, g] of ghosts) {
      if (seen.has(id)) continue;
      scene.remove(g.mesh); scene.remove(g.label);
      g.mesh.geometry.dispose(); g.mesh.material.dispose(); g.label.material.map.dispose(); g.label.material.dispose();
      ghosts.delete(id);
    }
  }
  function drawGhosts(dt) {
    for (const g of ghosts.values()) {
      // Extrapolate along the run a little so 10Hz updates still look smooth.
      const lead = g.alive ? Math.min(0.15, (performance.now() - g.at) / 1000) * g.vs : 0;
      const k = 1 - Math.exp(-dt * 12);
      g.cur.s += (g.tgt.s + lead - g.cur.s) * k;
      g.cur.x += (g.tgt.x - g.cur.x) * k;
      g.cur.y += (g.tgt.y - g.cur.y) * k;
      g.mesh.position.set(g.cur.x, g.cur.y, -g.cur.s);
      g.label.position.set(g.cur.x, g.cur.y + 1.3, -g.cur.s);
    }
  }

  // --- Frame ---
  function raceTime() {
    return view && view.raceStartAt ? (clock.now() - view.raceStartAt) / 1000 : 0;
  }
  function meInRound() {
    const me = view && view.players.find((p) => p.clientId === api.getClientId());
    return !!(me && me.inRound);
  }

  function frame(ts) {
    if (destroyed) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.05, lastFrame ? (ts - lastFrame) / 1000 : 0.016);
    lastFrame = ts;
    if (!view || !track) { renderer.render(scene, camera); return; }

    const racing = view.phase === 'racing' && meInRound();
    if (racing && ball) {
      acc += dt;
      // window.__slopeAutopilot = 'expert' lets a bot drive (handy for screenshots/tests).
      const steer = window.__slopeAutopilot ? Sim.botSteer(track, ball, raceTime(), window.__slopeAutopilot, autoMem) : steerInput();
      let t = raceTime() - acc;
      while (acc >= Sim.DT) {
        const wasAlive = ball.alive;
        prev.s = ball.s; prev.x = ball.x; prev.y = ball.y; prev.roll = ball.roll;
        const ev = Sim.step(track, ball, steer, t);
        t += Sim.DT;
        acc -= Sim.DT;
        if (ev === 'launch') { if (ball.vy > 4) sfx.play('whoosh', { vol: 0.5 }); }
        else if (ev === 'boost') { sfx.play('whoosh', { vol: 0.9 }); boostFlash = 1; }
        else if (ev && ev.startsWith('land:')) {
          const impact = Number(ev.slice(5));
          if (impact > 9) { shake = Math.min(0.6, impact / 40); sfx.play('pop', { vol: Math.min(1, impact / 25) }); }
        }
        if (wasAlive && !ball.alive) {
          alive = false;
          deathAt = performance.now();
          sfx.play('crash');
          api.sendAction({ kind: 'died', s: ball.s, x: ball.x, y: ball.y, cause: ball.cause });
          const score = Math.floor(ball.s);
          if (score > best) { best = score; writeBest(best); newBestThisRun = true; sfx.play('chime'); }
        }
      }
      if (ball.alive && ts - lastSend > 100) {
        lastSend = ts;
        api.sendAction({ kind: 'pos', s: ball.s, x: ball.x, y: ball.y });
      }
    } else if (ball && !ball.alive) {
      prev.s = ball.s; prev.x = ball.x; prev.y = ball.y; prev.roll = ball.roll;
      Sim.step(track, ball, 0, raceTime()); // keep falling for the camera
      acc = Sim.DT;
    }
    // Render between the last two physics steps so motion is smooth at any refresh rate.
    if (ball) {
      const a = Math.min(1, Math.max(0, acc / Sim.DT));
      drawn.s = prev.s + (ball.s - prev.s) * a;
      drawn.x = prev.x + (ball.x - prev.x) * a;
      drawn.y = prev.y + (ball.y - prev.y) * a;
      drawn.roll = prev.roll + (ball.roll - prev.roll) * a;
    }

    // Who does the camera follow? Us, or while spectating, the leader.
    let focus = ball ? { s: drawn.s, x: drawn.x, y: drawn.y, vs: ball.vs, mine: true } : null;
    if (!meInRound() && view.players.length) {
      const lead = [...ghosts.values()].sort((a, b) => b.cur.s - a.cur.s)[0];
      if (lead) focus = { s: lead.cur.s, x: lead.cur.x, y: lead.cur.y, vs: 25, alive: true };
    }
    if (focus) syncWorld(focus.s);

    // Moving blocks.
    const t = raceTime();
    for (const e of built.values()) {
      for (const { mesh, p, o } of e.obs) {
        const tt = view.phase === 'racing' ? t : 0;
        mesh.position.set(Sim.obstacleX(p, o, tt), Sim.heightAt(p, o.s, o.xr) + Sim.obstacleLift(o, tt) + o.h / 2, -o.s);
      }
    }
    drawGhosts(dt);

    if (ball) {
      ballMesh.visible = meInRound();
      ballMesh.position.set(drawn.x, drawn.y, -drawn.s);
      ballMesh.rotation.set(-drawn.roll, 0, -ball.vx * 0.03);
      glow.position.copy(ballMesh.position).add(new THREE.Vector3(0, 1, 0));
    }

    if (focus) {
      // Chase cam locked straight behind the ball: tight at the start, easing back a little
      // (and widening a touch) as the run speeds up or a boost kicks in.
      zoomV += ((focus.vs || 20) - zoomV) * (1 - Math.exp(-dt * 2.5));
      const fast = Math.min(1, Math.max(0, (zoomV - 17) / 26));
      const deadFor = focus.mine && !ball.alive ? (performance.now() - deathAt) / 1000 : 0;
      const back = 4.8 + fast * 1.8;
      const up = 2.7 + fast * 0.8;
      if (deadFor <= 0 || !camPos) {
        if (!camPos) camPos = new THREE.Vector3();
        camPos.set(focus.x, focus.y + up, -(focus.s - back));
      }
      camera.position.copy(camPos);
      if (window.__slopeCamOffset) camera.position.add(window.__slopeCamOffset); // debug: {x,y,z}
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake;
        shake = Math.max(0, shake - dt * 1.8);
      }
      if (deadFor > 0) camera.lookAt(focus.x, focus.y, -focus.s);
      else camera.lookAt(focus.x, focus.y - 0.3, -(focus.s + 9));
      boostFlash = Math.max(0, boostFlash - dt * 1.5);
      const fov = 60 + fast * 12 + boostFlash * 6;
      if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
      sun.position.set(camera.position.x, camera.position.y + 45, camera.position.z - 1100);
      sun.lookAt(camera.position);
      stars.position.copy(camera.position);
    }

    renderHud();
    renderer.render(scene, camera);
  }

  // --- HUD ---
  function renderHud() {
    const phase = view.phase;
    const me = view.players.find((p) => p.clientId === api.getClientId());
    const inRound = me && me.inRound;
    const score = ball && inRound ? Math.floor(ball.s) : 0;
    scoreEl.textContent = inRound ? String(score) : 'SPECTATING';
    const kmh = ball ? Math.round(ball.vs * 3.6) : 0;
    subEl.textContent = inRound ? `${kmh} km/h · BEST ${best}` : 'You\'ll join the next run';

    let msg = '';
    if (phase === 'countdown') {
      const left = Math.ceil((view.raceStartAt - clock.now()) / 1000);
      msg = left > 0 ? String(left) : 'GO!';
      if (msg !== lastCountdown) { sfx.play(left > 0 ? 'beep' : 'go'); lastCountdown = msg; }
    } else if (phase === 'racing') {
      if (lastCountdown !== 'GO!' && lastCountdown !== null) { sfx.play('go'); }
      lastCountdown = null;
      if (inRound && ball && !ball.alive) {
        const why = ball.cause === 'block' ? 'SMASHED' : ball.cause === 'wall' ? 'CRASHED' : 'FELL OFF';
        msg = `${why}\n${Math.floor(ball.s)}${newBestThisRun ? '\nNEW BEST!' : ''}`;
      }
    } else if (phase === 'results') {
      const left = Math.max(0, Math.ceil((view.phaseEndsAt - clock.now()) / 1000));
      const top = (view.results || []).slice(0, 5).map((r, i) => `${i + 1}. ${r.nickname}  ${r.score}`).join('\n');
      msg = `RESULTS\n${top}\nnext run in ${left}`;
    }
    centerEl.style.fontSize = phase === 'results' ? '20px' : '44px';
    centerEl.textContent = msg;

    const live = view.players.filter((p) => p.inRound).map((p) => ({
      name: p.nickname, you: p.clientId === api.getClientId(), alive: p.clientId === api.getClientId() ? !!(ball && ball.alive) : p.alive,
      s: p.clientId === api.getClientId() && ball ? Math.floor(ball.s) : p.score,
    })).sort((a, b) => b.s - a.s);
    liveEl.innerHTML = live.length > 1 || phase !== 'racing'
      ? `<b>THIS RUN</b><br>${live.map((r) => `<span style="opacity:${r.alive ? 1 : 0.45}">${r.you ? '▶ ' : ''}${esc(r.name)} ${r.s}${r.alive ? '' : ' ✕'}</span>`).join('<br>')}`
      : '';
    boardEl.innerHTML = view.best && view.best.length
      ? `<b>ROOM BEST</b><br>${view.best.map((b, i) => `${i + 1}. ${esc(b.nickname)} ${b.score}`).join('<br>')}`
      : '';
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function applyView(v) {
    if (!v || v.kind !== 'state') return;
    view = v;
    clock.sync(v.serverNow);
    botBar.update(v.players);
    if (!THREE || !Sim) return;
    if (v.seed != null && (v.seed !== trackSeed || v.roundId !== roundId)) {
      roundId = v.roundId;
      resetWorld(v.seed);
    }
    syncGhosts();
  }

  Promise.all([loadScript('games/slope/three.min.js', 'THREE'), loadScript('games/slope/sim.js', 'SlopeSim')])
    .then(([T, S]) => {
      if (destroyed) return;
      THREE = T; Sim = S;
      initScene();
      if (view) applyView(view);
      rafId = requestAnimationFrame(frame);
    })
    .catch((err) => {
      console.error('Slope: failed to load', err);
      centerEl.style.fontSize = '18px';
      centerEl.textContent = 'Failed to load the 3D renderer.';
    });

  return {
    applySnapshot: applyView,
    applyEvent: applyView,
    unmount() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('pointerup', pu);
      window.removeEventListener('pointercancel', pu);
      if (ro) ro.disconnect();
      if (renderer) renderer.dispose();
      root.remove();
    },
  };
}
