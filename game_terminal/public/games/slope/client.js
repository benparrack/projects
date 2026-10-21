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

const NAMES_KEY = 'game_terminal.slope.showNames';
function readShowNames() {
  try { return localStorage.getItem(NAMES_KEY) !== '0'; } catch { return true; }
}
function writeShowNames(v) {
  try { localStorage.setItem(NAMES_KEY, v ? '1' : '0'); } catch { /* private mode */ }
}
// Tag opacity by camera distance: faded right next to the camera (a racer level with you would
// otherwise park its tag over your own ball), fully readable a little ahead, gone by ~70 units.
const NAME_FADE_NEAR = 14;
const NAME_FADE_FAR = 70;
const NAME_HIDE_CLOSE = 5;
const NAME_MAX_PX = 150;
const NAME_SHOW_CLOSE = 11;
function nameOpacity(dist, alive) {
  const t = Math.min(1, Math.max(0, (dist - NAME_FADE_NEAR) / (NAME_FADE_FAR - NAME_FADE_NEAR)));
  const near = Math.min(1, Math.max(0, (dist - NAME_HIDE_CLOSE) / (NAME_SHOW_CLOSE - NAME_HIDE_CLOSE)));
  return (1 - t * t) * (0.25 + 0.75 * near) * (alive ? 0.95 : 0.4);
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

// Ball skin: a glossy green marble with one bright band. The sphere is turned so the band runs
// along the rolling direction (it stays put while the ball spins); a few faint low-contrast dots
// are the only hint of the spin, so fast rolling doesn't strobe.
// Ball skins: dark/mid body colours, the band/pattern colour, the glow, and a pattern.
// Picked with the SKIN button (saved per browser); others see your ghost in the mid colour.
const SKINS = [
  { id: 'lime', name: 'LIME', dark: '#0c2a0c', mid: '#1f6b18', hi: '#b6ff9c', glow: '#39ff14', pat: 'dots' },
  { id: 'ice', name: 'ICE', dark: '#062433', mid: '#1b7fa8', hi: '#d8f6ff', glow: '#00eaff', pat: 'stripes' },
  { id: 'magma', name: 'MAGMA', dark: '#2a0700', mid: '#a32a00', hi: '#ffcf40', glow: '#ff6a00', pat: 'cracks' },
  { id: 'grape', name: 'GRAPE', dark: '#1a0633', mid: '#5b1fa8', hi: '#e2b8ff', glow: '#8c52ff', pat: 'dots' },
  { id: 'gold', name: 'GOLD', dark: '#3a2a00', mid: '#b88a00', hi: '#fff3b0', glow: '#ffd000', pat: 'stripes' },
  { id: 'candy', name: 'CANDY', dark: '#ffffff', mid: '#ff2f6b', hi: '#ffffff', glow: '#ff2fb0', pat: 'swirl' },
  { id: 'checker', name: 'CHECKER', dark: '#111111', mid: '#eeeeee', hi: '#ff2fb0', glow: '#ffffff', pat: 'checker' },
  { id: 'void', name: 'VOID', dark: '#000000', mid: '#14002a', hi: '#ff2fb0', glow: '#ff2fb0', pat: 'stars' },
];
const SKIN_KEY = 'gt.slope.skin';
const skinById = (id) => SKINS.find((k) => k.id === id) || SKINS[0];
function readSkin() {
  try { return skinById(localStorage.getItem(SKIN_KEY)).id; } catch { return SKINS[0].id; }
}

function ballTexture(THREE, skin = SKINS[0]) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, skin.dark);
  grad.addColorStop(0.5, skin.mid);
  grad.addColorStop(1, skin.dark);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = skin.hi;
  g.strokeStyle = skin.hi;
  if (skin.pat === 'dots') {
    g.globalAlpha = 0.35;
    for (let i = 0; i < 10; i++) {
      g.beginPath();
      g.arc((i * 83) % 256, 20 + ((i * 37) % 30) + (i % 2) * 60, 6, 0, Math.PI * 2);
      g.fill();
    }
  } else if (skin.pat === 'stripes') {
    g.globalAlpha = 0.5;
    for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 8, 128);
  } else if (skin.pat === 'cracks') {
    g.globalAlpha = 0.8; g.lineWidth = 3;
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      let x = (i * 53) % 256; let y = (i * 29) % 128;
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += 10 + ((i + k) % 3) * 6; y += ((i * k) % 5) * 6 - 12; g.lineTo(x, y); }
      g.stroke();
    }
  } else if (skin.pat === 'swirl') {
    g.fillStyle = skin.mid;
    for (let x = -128; x < 256; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 16, 0); g.lineTo(x + 144, 128); g.lineTo(x + 128, 128); g.fill(); }
  } else if (skin.pat === 'checker') {
    g.fillStyle = skin.dark;
    for (let y = 0; y < 128; y += 32) for (let x = (y / 32) % 2 ? 32 : 0; x < 256; x += 64) g.fillRect(x, y, 32, 32);
  } else if (skin.pat === 'stars') {
    for (let i = 0; i < 40; i++) { g.globalAlpha = 0.4 + (i % 3) * 0.2; g.fillRect((i * 97) % 256, (i * 41) % 128, 2, 2); }
  }
  g.globalAlpha = 1;
  g.fillStyle = skin.hi;
  g.fillRect(0, 59, 256, 10);
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

// Floating name tag: a rounded dark pill with a colour dot, drawn at 2x for crispness. The
// sprite keeps a constant world size (so far racers' tags shrink naturally) and drawGhosts fades
// it out with distance so a crowded run doesn't turn into a wall of labels. The world size is
// capped on screen by NAME_MAX_PX in drawGhosts so a racer right beside you doesn't get a
// billboard-sized tag.
function nameSprite(THREE, text, color) {
  const name = String(text || '?').slice(0, 16);
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.font = 'bold 44px monospace';
  const tw = Math.min(440, g.measureText(name).width);
  const w = tw + 84; const x0 = (512 - w) / 2; const y0 = 14; const h = 68; const r = 34;
  g.beginPath();
  g.moveTo(x0 + r, y0); g.arcTo(x0 + w, y0, x0 + w, y0 + h, r); g.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
  g.arcTo(x0, y0 + h, x0, y0, r); g.arcTo(x0, y0, x0 + w, y0, r); g.closePath();
  g.fillStyle = 'rgba(6,2,18,0.72)'; g.fill();
  g.lineWidth = 4; g.strokeStyle = color; g.globalAlpha = 0.85; g.stroke(); g.globalAlpha = 1;
  g.fillStyle = color;
  g.beginPath(); g.arc(x0 + 34, y0 + h / 2, 11, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff';
  g.textBaseline = 'middle';
  g.fillText(name, x0 + 58, y0 + h / 2 + 2, 440);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(2.9, 0.545, 1);
  sp.renderOrder = 10;
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
  // Skin picker (cycles) and the site-wide board under the room board.
  let skin = readSkin();
  const skinBtn = document.createElement('button');
  skinBtn.style.cssText = 'position:absolute;bottom:64px;left:12px;font:bold 12px monospace;padding:5px 9px;background:rgba(6,2,18,0.75);color:#fff;border:1px solid #555;border-radius:4px;cursor:pointer;z-index:2';
  root.appendChild(skinBtn);
  let globalRows = null; let globalRound = -1;
  function loadGlobal() {
    fetch('/api/leaderboard/slope?by=best', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && !destroyed) globalRows = d.rows || []; }).catch(() => {});
  }
  loadGlobal();
  hintEl.textContent = '← → / A D to steer · tap left/right side on touch · N names';
  hintEl.style.maxWidth = 'calc(100% - 20px)'; hintEl.style.overflow = 'hidden'; hintEl.style.textOverflow = 'ellipsis';
  const botBar = createBotBar(api);
  botBar.el.style.cssText += ';position:absolute;bottom:30px;left:10px;margin:0;pointer-events:auto;font-family:monospace;font-size:12px;max-width:calc(100% - 190px);display:flex;flex-wrap:wrap;gap:4px;align-items:center';
  root.appendChild(botBar.el);
  const leaveBtn = document.createElement('button');
  leaveBtn.textContent = 'LEAVE';
  leaveBtn.addEventListener('click', () => api.leaveRoom());
  const btnBar = document.createElement('div');
  btnBar.style.cssText = 'position:absolute;bottom:30px;right:10px;display:flex;gap:6px;align-items:center;pointer-events:auto';
  root.appendChild(btnBar);
  let showNames = readShowNames();
  const namesBtn = document.createElement('button');
  namesBtn.title = 'Show/hide racer name tags (N)';
  for (const b of [namesBtn, leaveBtn]) b.style.cssText = 'font-size:12px;padding:4px 10px';
  const renderNamesBtn = () => {
    namesBtn.textContent = showNames ? 'NAMES: ON' : 'NAMES: OFF';
    namesBtn.setAttribute('aria-pressed', String(showNames));
    namesBtn.style.opacity = showNames ? '1' : '0.7';
  };
  const toggleNames = () => {
    showNames = !showNames;
    writeShowNames(showNames);
    renderNamesBtn();
    sfx.play('click');
  };
  renderNamesBtn();
  namesBtn.addEventListener('click', (e) => { toggleNames(); namesBtn.blur(); e.stopPropagation(); });
  btnBar.append(namesBtn, leaveBtn);

  // --- Input ---
  const keys = { left: false, right: false };
  const touch = { left: false, right: false };
  function onKey(e, down) {
    const k = e.key.toLowerCase();
    if (k === 'n') {
      if (!down || e.repeat || (e.target && /input|textarea|select/i.test(e.target.tagName))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      toggleNames();
      return;
    }
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
  let camPos = null; let shake = 0; let deathAt = 0; let deathS = 0; let watching = null;
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
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1)); // 2x+ costs far more than it shows at speed
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

    ballMesh = new THREE.Mesh(new THREE.SphereGeometry(Sim.R, 32, 18).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ emissive: '#ffffff', metalness: 0.3, roughness: 0.35 }));
    scene.add(ballMesh);
    glow = new THREE.PointLight('#39ff14', 1.2, 9);
    scene.add(glow);
    applySkin();

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
    return [Sim.centerAt(p, s) + xr * Math.cos(Sim.bankAt(p, s)), Sim.heightAt(p, s, xr), -s];
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

  // Builds what's coming into view a little at a time (a couple of pieces and at most one terrain
  // chunk per frame) well before the fog reveals it, so there are no hitches from building a
  // whole stretch of track in one frame. `all` builds everything at once (new round).
  let scanFrom = 0;
  function syncWorld(s, all) {
    Sim.ensure(track, s + 480);
    const ps = track.pieces;
    let budget = all ? Infinity : 2;
    while (scanFrom < ps.length && ps[scanFrom].s1 < s - 40) {
      if (built.has(scanFrom)) { disposeGroup(built.get(scanFrom).group); built.delete(scanFrom); }
      scanFrom++;
    }
    for (let i = scanFrom; i < ps.length && ps[i].s0 < s + 460 && budget > 0; i++) {
      if (!built.has(i)) { buildPiece(i); budget--; }
    }
    const c0 = Math.floor((s - 60) / CHUNK); const c1 = Math.floor((s + 480) / CHUNK);
    let tBudget = all ? Infinity : 1;
    for (let c = Math.max(0, c0); c <= c1 && tBudget > 0; c++) if (!terrain.has(c)) { buildTerrain(c); tBudget--; }
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
    scanFrom = 0;
    syncWorld(ball.s, true);
  }

  // --- Ghosts ---
  function syncGhosts() {
    const me = api.getClientId();
    const seen = new Set();
    for (const p of view.players) {
      if (p.clientId === me || !p.inRound) continue;
      seen.add(p.clientId);
      let g = ghosts.get(p.clientId);
      if (g && g.mesh.userData.skin !== (p.skin || null)) { dropGhost(g); ghosts.delete(p.clientId); g = null; } // they changed skin
      if (!g) {
        const sk = p.skin ? skinById(p.skin) : null;
        const gt = sk ? ballTexture(THREE, sk) : null;
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(Sim.R, 20, 12), new THREE.MeshStandardMaterial({ color: gt ? '#ffffff' : p.color, map: gt, emissive: gt ? '#ffffff' : p.color, emissiveMap: gt, emissiveIntensity: 0.6, transparent: true, opacity: 0.75 }));
        mesh.userData.skin = p.skin || null;
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
      g.name = p.nickname;
      g.mesh.material.opacity = p.alive ? 0.75 : 0.25;
    }
    for (const [id, g] of ghosts) {
      if (seen.has(id)) continue;
      dropGhost(g);
      ghosts.delete(id);
    }
  }
  function dropGhost(g) {
    scene.remove(g.mesh); scene.remove(g.label);
    if (g.mesh.material.map) g.mesh.material.map.dispose();
    g.mesh.geometry.dispose(); g.mesh.material.dispose(); g.label.material.map.dispose(); g.label.material.dispose();
  }
  function applySkin() {
    const sk = skinById(skin);
    skinBtn.textContent = `SKIN: ${sk.name} ▸`;
    if (ballMesh) {
      if (ballMesh.material.map) ballMesh.material.map.dispose();
      const t = ballTexture(THREE, sk);
      ballMesh.material.map = t; ballMesh.material.emissiveMap = t;
      ballMesh.material.emissive.set(sk.mid);
      ballMesh.material.needsUpdate = true;
      glow.color.set(sk.glow);
    }
  }
  skinBtn.textContent = `SKIN: ${skinById(skin).name} ▸`;
  skinBtn.addEventListener('click', () => {
    skin = SKINS[(SKINS.findIndex((k) => k.id === skin) + 1) % SKINS.length].id;
    try { localStorage.setItem(SKIN_KEY, skin); } catch { /* private mode */ }
    if (THREE) applySkin();
    api.sendAction({ kind: 'skin', id: skin });
    skinBtn.blur(); // keep arrow keys steering, not re-pressing the button
  });
  let skinSentAt = 0;
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
      const op = showNames && camera ? nameOpacity(camera.position.distanceTo(g.label.position), g.alive) : 0;
      g.label.visible = op > 0.02;
      if (camera && g.label.visible) {
        // World-size tag (2.9 wide) until it would exceed NAME_MAX_PX on screen, then clamp.
        const d = Math.max(0.1, camera.position.distanceTo(g.label.position));
        const pxPerUnit = renderer.domElement.clientHeight / (2 * d * Math.tan((camera.fov * Math.PI) / 360));
        const k = Math.min(1, NAME_MAX_PX / (2.9 * pxPerUnit));
        g.label.scale.set(2.9 * k, 0.545 * k, 1);
      }
      g.label.material.opacity = op;
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
          if (impact > 11) { shake = Math.max(shake, Math.min(0.28, impact / 90)); sfx.play('pop', { vol: Math.min(1, impact / 25) }); }
        }
        if (wasAlive && !ball.alive) {
          alive = false;
          deathAt = performance.now();
          deathS = Math.floor(ball.s);
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

    // Who does the camera follow? Us, or while spectating (not in this run, or 1.5s after we
    // crashed), the leading rider still alive.
    let focus = ball ? { s: drawn.s, x: drawn.x, y: drawn.y, vs: ball.vs, mine: true } : null;
    watching = null;
    const spectating = !meInRound() || (ball && !ball.alive && performance.now() - deathAt > 1500);
    if (spectating && view.phase === 'racing') {
      const gs = [...ghosts.values()].sort((a, b) => (b.alive - a.alive) || (b.cur.s - a.cur.s));
      const lead = gs[0];
      if (lead && (lead.alive || !meInRound())) {
        watching = lead;
        focus = { s: lead.cur.s, x: lead.cur.x, y: lead.cur.y, vs: lead.vs || 25, alive: true };
      }
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
        // A quick damped wobble rather than random jitter: punchy but easy on the eyes.
        const ph = ts / 1000;
        camera.position.x += Math.sin(ph * 47) * shake * 0.5;
        camera.position.y += Math.sin(ph * 61 + 1.3) * shake;
        shake = Math.max(0, shake - dt * 1.4);
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
  // The HUD runs every frame; only touch the DOM when something actually changed, or the
  // browser re-lays-out the page 60+ times a second.
  const domCache = new WeakMap();
  function setDom(el, prop, v) {
    const c = domCache.get(el) || {};
    if (c[prop] === v) return;
    c[prop] = v;
    domCache.set(el, c);
    if (prop === 'fontSize') el.style.fontSize = v; else el[prop] = v;
  }
  function renderHud() {
    const phase = view.phase;
    const me = view.players.find((p) => p.clientId === api.getClientId());
    const inRound = me && me.inRound;
    // A crashed ball keeps falling (and drifting forward) for the camera: freeze the score.
    const myScore = () => (ball ? (ball.alive ? Math.floor(ball.s) : deathS) : 0);
    const score = inRound ? myScore() : 0;
    setDom(scoreEl, 'textContent', inRound && !watching ? String(score) : 'SPECTATING');
    const kmh = ball ? Math.round(ball.vs * 3.6) : 0;
    setDom(subEl, 'textContent', watching ? `watching ${watching.name || '?'}${inRound ? ` · you: ${score}` : ''}`
      : inRound ? `${kmh} km/h · BEST ${best}` : 'You\'ll join the next run');

    let msg = '';
    if (phase === 'countdown') {
      const left = Math.ceil((view.raceStartAt - clock.now()) / 1000);
      msg = left > 0 ? String(left) : 'GO';
      if (msg !== lastCountdown) { sfx.play(left > 0 ? 'beep' : 'go'); lastCountdown = msg; }
    } else if (phase === 'racing') {
      if (lastCountdown !== 'GO' && lastCountdown !== null) { sfx.play('go'); }
      lastCountdown = null;
      if (inRound && ball && !ball.alive) {
        const why = ball.cause === 'block' ? 'SMASHED' : ball.cause === 'wall' ? 'CRASHED' : 'FELL OFF';
        if (!watching) msg = `${why}\n${deathS}${newBestThisRun ? '\nNEW BEST' : ''}`;
      }
    } else if (phase === 'results') {
      const left = Math.max(0, Math.ceil((view.phaseEndsAt - clock.now()) / 1000));
      const top = (view.results || []).slice(0, 5).map((r, i) => `${i + 1}. ${r.nickname}  ${r.score}`).join('\n');
      msg = `RESULTS\n${top}\nnext run in ${left}`;
    }
    setDom(centerEl, 'fontSize', phase === 'results' ? '20px' : '44px');
    setDom(centerEl, 'textContent', msg);

    const live = view.players.filter((p) => p.inRound).map((p) => ({
      name: p.nickname, you: p.clientId === api.getClientId(), alive: p.clientId === api.getClientId() ? !!(ball && ball.alive) : p.alive,
      s: p.clientId === api.getClientId() && ball ? myScore() : p.score,
    })).sort((a, b) => b.s - a.s);
    setDom(liveEl, 'innerHTML', live.length > 1 || phase !== 'racing'
      ? `<b>THIS RUN</b><br>${live.map((r) => `<span style="opacity:${r.alive ? 1 : 0.45}">${r.you ? '▶ ' : ''}${esc(r.name)} ${r.s}${r.alive ? '' : ' ✕'}</span>`).join('<br>')}`
      : '');
    // Once per round, after the server has had a moment to save the results.
    if (phase === 'results' && view.roundId !== globalRound) { globalRound = view.roundId; setTimeout(loadGlobal, 1500); }
    const room = view.best && view.best.length
      ? `<b>ROOM BEST</b><br>${view.best.map((b, i) => `${i + 1}. ${esc(b.nickname)} ${b.score}`).join('<br>')}`
      : '';
    const site = globalRows
      ? `<div style="color:#ffb000;margin-top:8px"><b>ALL-TIME (SITE)</b><br>${globalRows.length
        ? globalRows.slice(0, 8).map((r) => `${r.rank}. ${esc(r.username)} ${r.value}`).join('<br>')
        : '<span style="opacity:.7">no scores yet</span>'}<br><span style="opacity:.6;font-size:10.5px">sign in to get on it</span></div>`
      : '';
    setDom(boardEl, 'innerHTML', room + site);
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function applyView(v) {
    if (!v || v.kind !== 'state') return;
    view = v;
    clock.sync(v.serverNow);
    botBar.update(v.players);
    // Tell the server our skin once it knows us (and again if it ever forgets, e.g. a rejoin).
    const meP = v.players.find((p) => p.clientId === api.getClientId());
    if (meP && meP.skin !== skin && Date.now() - skinSentAt > 2000) { skinSentAt = Date.now(); api.sendAction({ kind: 'skin', id: skin }); }
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
