// Cup Pong client. Three.js scene of the table (three.min.js shared with Slope) + the shared throw
// physics (sim.js). The camera always stands behind whoever is throwing and swings around the
// table when the turn passes. On your turn, pull down from anywhere on the table view and let go
// (slingshot): pulling left aims right and vice versa, distance pulled = power. Your own throw starts flying instantly from a local
// run of the same sim; the server's authoritative trajectory (identical in practice) takes over
// when it arrives. Everyone else replays the server's frames.

import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect } from '../botLevel.js';
import { createResults, duelResults } from '../resultsPanel.js';
import { makeServerClock } from '../serverClock.js';
import { loadScript } from '../loadScript.js';

const FRAME_MS = 1000 / 60;
const HOLD_FRAMES = 18; // ball rests in the cup / on the floor this long before the anim ends
const COLORS = ['red', 'blue'];
const CUP_COLOR = { red: 0xe0283c, blue: 0x2a6cf0 };
const TEXT_COLOR = { red: '#ff5a6a', blue: '#5aa0ff' };

const REJECT_MESSAGES = {
  not_your_turn: "It's not your turn.",
  busy: 'Wait for the ball to land.',
  not_playing: 'The game is not running.',
  invalid: 'Invalid throw.',
};

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CSS = `
.cp-root { display: flex; flex-direction: column; align-items: center; gap: 8px; font-family: monospace; color: #b8ffb0; width: 100%; }
.cp-status { font-size: 15px; font-weight: bold; letter-spacing: 1px; text-align: center; min-height: 20px; }
.cp-status.mine { color: #39ff14; text-shadow: 0 0 8px #39ff14; }
.cp-err { color: #ff5a5a; font-size: 12px; min-height: 14px; }
.cp-seats { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; }
.cp-seat { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid #1d5c1d; border-radius: 6px; background: #071107; font-size: 13px; }
.cp-seat.turn { border-color: #39ff14; box-shadow: 0 0 10px -2px #39ff14; }
.cp-seat button, .cp-row button { font: inherit; font-size: 12px; }
.cp-chip { width: 12px; height: 14px; border-radius: 2px 2px 5px 5px; display: inline-block; clip-path: polygon(0 0, 100% 0, 82% 100%, 18% 100%); }
.cp-chip.red { background: #e0283c; } .cp-chip.blue { background: #2a6cf0; }
.cp-stage { position: relative; width: min(100%, 560px); aspect-ratio: 5 / 6; max-height: 72vh; border: 1px solid #1d5c1d; border-radius: 10px; overflow: hidden;
  background: radial-gradient(circle at 50% 30%, #10261a, #020604 75%); touch-action: none; user-select: none; -webkit-user-select: none; }
.cp-stage canvas { display: block; width: 100%; height: 100%; }
.cp-stage.can-throw { cursor: grab; } .cp-stage.dragging { cursor: grabbing; }
.cp-hud { position: absolute; left: 0; right: 0; top: 0; display: flex; justify-content: space-between; padding: 8px 10px; pointer-events: none; font-size: 13px; text-shadow: 0 1px 2px #000; }
.cp-count { display: flex; align-items: center; gap: 6px; font-weight: bold; }
.cp-balls { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); display: flex; gap: 6px; pointer-events: none; }
.cp-ball { width: 12px; height: 12px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff, #f4e6c8 55%, #b9a77f); box-shadow: 0 0 6px rgba(255,255,255,.4); }
.cp-ball.used { opacity: .18; box-shadow: none; }
.cp-hint { position: absolute; left: 0; right: 0; bottom: 30px; text-align: center; font-size: 12px; color: #9fdc98; pointer-events: none; text-shadow: 0 1px 2px #000; animation: cp-hint 1.6s ease-in-out infinite alternate; }
@keyframes cp-hint { from { opacity: .45; } to { opacity: 1; } }
.cp-power { position: absolute; right: 12px; top: 50%; width: 12px; height: 46%; transform: translateY(-50%); border: 1px solid #39ff14; border-radius: 6px; background: rgba(0,0,0,.45); overflow: hidden; pointer-events: none; opacity: 0; transition: opacity .15s; }
.cp-power.on { opacity: 1; }
.cp-power > div { position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(0deg, #39ff14, #ffe14d 60%, #ff4d4d); }
.cp-callout { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%); font-size: 30px; font-weight: bold; letter-spacing: 3px; white-space: nowrap; pointer-events: none;
  text-shadow: 0 0 14px currentColor, 0 2px 3px #000; animation: cp-call 1.4s cubic-bezier(.2,1.4,.4,1) forwards; }
.cp-callout.small { font-size: 18px; top: 46%; }
@keyframes cp-call { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.4); } 15% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); }
  25% { transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -70%) scale(1); } }
.cp-row { display: flex; gap: 8px; align-items: center; justify-content: center; flex-wrap: wrap; font-size: 12px; }
.cp-row label { display: flex; gap: 5px; align-items: center; cursor: pointer; }
.cp-help { font-size: 11px; opacity: .7; text-align: center; max-width: 520px; }
.cp-fail { padding: 30px; text-align: center; color: #ff8080; }
`;
let styled = false;
function ensureStyles() {
  if (styled) return;
  styled = true;
  const tag = document.createElement('style');
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

// ---- textures --------------------------------------------------------------------------------
function tableTexture(THREE, S) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round(512 * (S.TABLE_L / S.TABLE_W));
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, '#0a1a12');
  grad.addColorStop(0.5, '#0e2418');
  grad.addColorStop(1, '#0a1a12');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  // faint grid
  g.strokeStyle = 'rgba(57,255,20,0.06)';
  g.lineWidth = 2;
  for (let y = 0; y < c.height; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
  for (let x = 0; x < c.width; x += 48) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, c.height); g.stroke(); }
  // neon border + centre line
  g.strokeStyle = '#39ff14';
  g.shadowColor = '#39ff14';
  g.shadowBlur = 16;
  g.lineWidth = 10;
  g.strokeRect(10, 10, c.width - 20, c.height - 20);
  g.lineWidth = 5;
  g.beginPath(); g.moveTo(c.width / 2, 10); g.lineTo(c.width / 2, c.height - 10); g.stroke();
  g.beginPath(); g.moveTo(10, c.height / 2); g.lineTo(c.width - 10, c.height / 2); g.stroke();
  // centre logo
  g.shadowBlur = 10;
  g.fillStyle = 'rgba(57,255,20,0.55)';
  g.font = 'bold 44px monospace';
  g.textAlign = 'center';
  g.save();
  g.translate(c.width / 2, c.height / 2);
  g.rotate(-Math.PI / 2);
  g.fillText('CUP PONG', 0, -24);
  g.rotate(Math.PI);
  g.fillText('CUP PONG', 0, -24);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function cupTexture(THREE, color) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 64, 128);
  // lathe v runs base (bottom of canvas) -> rim (top); two embossed rings near the rim
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(0, 18, 64, 3);
  g.fillRect(0, 30, 64, 3);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(0, 21, 64, 2);
  g.fillRect(0, 33, 64, 2);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 118, 64, 10);
  const t = new THREE.CanvasTexture(c);
  return t;
}

function glowTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(0,0,0,0.55)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// ---- the 3D scene ----------------------------------------------------------------------------
function createScene(THREE, S, canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if ('outputEncoding' in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x020604, 4, 9);
  const camera = new THREE.PerspectiveCamera(46, 1, 0.02, 30);

  scene.add(new THREE.HemisphereLight(0xcff6ff, 0x0b140b, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(0.6, 3, S.TABLE_L / 2 - 0.4);
  sun.target.position.set(0, 0, S.TABLE_L / 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -1, right: 1, top: 1.6, bottom: -1.6, near: 0.5, far: 6 });
  scene.add(sun, sun.target);
  const rimLight = new THREE.PointLight(0x39ff14, 0.35, 4);
  rimLight.position.set(0, 0.6, S.TABLE_L / 2);
  scene.add(rimLight);

  // table slab + glowing underside
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(S.TABLE_W, 0.05, S.TABLE_L),
    [
      new THREE.MeshStandardMaterial({ color: 0x0d2a16, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0x0d2a16, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ map: tableTexture(THREE, S), roughness: 0.32, metalness: 0.15 }),
      new THREE.MeshStandardMaterial({ color: 0x050a06 }),
      new THREE.MeshStandardMaterial({ color: 0x0d2a16, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0x0d2a16, roughness: 0.6 }),
    ],
  );
  top.position.set(0, -0.025, S.TABLE_L / 2);
  top.receiveShadow = true;
  scene.add(top);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x111a14, roughness: 0.7 });
  for (const [x, z] of [[-1, 0.15], [1, 0.15], [-1, S.TABLE_L - 0.15], [1, S.TABLE_L - 0.15]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.72, 0.04), legMat);
    leg.position.set(x * (S.TABLE_W / 2 - 0.05), -0.41, z);
    scene.add(leg);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ color: 0x030805, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.77, S.TABLE_L / 2);
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(14, 56, 0x0f3a14, 0x0a2410);
  grid.position.set(0, -0.765, S.TABLE_L / 2);
  scene.add(grid);

  // cup geometry: open truncated cone with a closed base, lathe-turned
  const prof = [new THREE.Vector2(0.0001, 0), new THREE.Vector2(S.CUP_RB, 0), new THREE.Vector2(S.CUP_R, S.CUP_H)];
  const cupGeo = new THREE.LatheGeometry(prof, 40);
  const innerGeo = new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p.x * 0.95, p.y + 0.002)), 40);
  const rimGeo = new THREE.TorusGeometry(S.CUP_R, 0.0032, 8, 40);
  rimGeo.rotateX(Math.PI / 2);
  const fillY = S.CUP_H * 0.55;
  const liquidGeo = new THREE.CircleGeometry((S.CUP_RB + (S.CUP_R - S.CUP_RB) * (fillY / S.CUP_H)) * 0.94, 32);
  liquidGeo.rotateX(-Math.PI / 2);
  const mats = {};
  for (const side of COLORS) {
    mats[side] = new THREE.MeshStandardMaterial({ map: cupTexture(THREE, `#${CUP_COLOR[side].toString(16).padStart(6, '0')}`), roughness: 0.38, metalness: 0.05 });
  }
  const innerMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.6, side: THREE.BackSide });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const liquidMat = new THREE.MeshStandardMaterial({ color: 0xffb21e, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85, emissive: 0x4a2a00 });

  function makeCup(side) {
    const g = new THREE.Group();
    const outer = new THREE.Mesh(cupGeo, mats[side].clone());
    outer.castShadow = true;
    const inner = new THREE.Mesh(innerGeo, innerMat);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.y = S.CUP_H;
    const liquid = new THREE.Mesh(liquidGeo, liquidMat);
    liquid.position.y = fillY;
    g.add(outer, inner, rim, liquid);
    g.userData.outer = outer;
    return g;
  }

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(S.BALL_R, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 0.35, emissive: 0x222018 }),
  );
  ball.castShadow = true;
  scene.add(ball);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(S.BALL_R * 5, S.BALL_R * 5),
    new THREE.MeshBasicMaterial({ map: glowTexture(THREE), transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  scene.add(blob);

  // aim preview: dotted start of the arc
  const dots = [];
  const dotMat = new THREE.MeshBasicMaterial({ color: 0x39ff14, transparent: true, opacity: 0.8 });
  const dotGeo = new THREE.SphereGeometry(0.0045, 8, 6);
  for (let i = 0; i < 9; i++) {
    const d = new THREE.Mesh(dotGeo, dotMat.clone());
    d.visible = false;
    scene.add(d);
    dots.push(d);
  }

  // splash droplets
  const drops = [];
  const dropGeo = new THREE.SphereGeometry(0.006, 6, 4);
  for (let i = 0; i < 18; i++) {
    const d = new THREE.Mesh(dropGeo, new THREE.MeshBasicMaterial({ color: 0xffc94a, transparent: true }));
    d.visible = false;
    d.userData.v = new THREE.Vector3();
    scene.add(d);
    drops.push(d);
  }

  return { renderer, scene, camera, makeCup, ball, blob, dots, drops, THREE };
}

// thrower frame -> world: red throws from z = 0, blue from z = TABLE_L (rotated half a turn)
function toWorld(S, by, x, y, z) {
  return by === 'blue' ? [-x, y, S.TABLE_L - z] : [x, y, z];
}

export function mount(container, api) {
  ensureStyles();
  let view = null;
  let roster = [];
  let flashError = null;
  let flashTimer = null;
  let destroyed = false;
  let S = null;
  let G = null; // scene bundle once Three.js loads
  let raf = 0;
  const clock = makeServerClock();

  const root = document.createElement('div');
  root.className = 'cp-root';
  container.appendChild(root);
  const results = createResults(container);

  const status = document.createElement('div');
  status.className = 'cp-status';
  const err = document.createElement('div');
  err.className = 'cp-err';
  const seats = document.createElement('div');
  seats.className = 'cp-seats';
  const stage = document.createElement('div');
  stage.className = 'cp-stage';
  const canvas = document.createElement('canvas');
  const hud = document.createElement('div');
  hud.className = 'cp-hud';
  const balls = document.createElement('div');
  balls.className = 'cp-balls';
  const hint = document.createElement('div');
  hint.className = 'cp-hint';
  const power = document.createElement('div');
  power.className = 'cp-power';
  const powerFill = document.createElement('div');
  power.appendChild(powerFill);
  stage.append(canvas, hud, balls, hint, power);
  const options = document.createElement('div');
  options.className = 'cp-row';
  const help = document.createElement('div');
  help.className = 'cp-help';
  help.textContent = 'Pull down from anywhere on the table and let go, like a slingshot. Pull left to aim right and vice versa, a longer pull throws harder. Two throws a turn; sink both for BALLS BACK. Clear all their cups to win.';
  root.append(status, err, seats, stage, options, help);

  // ---- game-state helpers ----
  function nicknameFor(id) {
    if (!id) return null;
    if (id === 'BOT') {
      return '(bot)';
    }
    const e = roster.find((r) => r.clientId === id);
    return e ? e.nickname : 'someone';
  }
  function mySeat() {
    if (!view) return null;
    const me = api.getClientId();
    return view.players.red === me ? 'red' : view.players.blue === me ? 'blue' : null;
  }

  // ---- animation state ----
  const shown = { red: new Map(), blue: new Map() }; // id -> { mesh, x, z, tx, tz, fade }
  const queue = []; // throw records waiting to play
  let anim = null; // { rec, start, firedEvents:Set, sunk:boolean, local:boolean }
  let localPending = null; // { input, start } — our throw predicted before the server answers
  let lastSeqSeen = 0;
  let camAngle = 0; // 0 = behind red, PI = behind blue
  let camTarget = 0;
  let drag = null; // { x0, y0, aim, power }
  let holdBob = 0;

  function sideCupsFromView(side) {
    return view ? view.cups[side] : [];
  }

  // Place / tween cup meshes for a side toward `list` (positions in the opposing thrower's frame).
  function syncCups(side, list, { instant = false } = {}) {
    if (!G) return;
    const map = shown[side];
    const keep = new Set(list.map((c) => c.id));
    for (const [id, e] of map) {
      if (!keep.has(id) && !e.fading) {
        if (instant) { G.scene.remove(e.mesh); map.delete(id); } else e.fading = 1;
      }
    }
    const by = side === 'red' ? 'blue' : 'red'; // red's cups are thrown at by blue
    for (const c of list) {
      const [wx, , wz] = toWorld(S, by, c.x, 0, c.z);
      let e = map.get(c.id);
      if (!e) {
        const mesh = G.makeCup(side);
        mesh.position.set(wx, 0, wz);
        G.scene.add(mesh);
        e = { mesh, x: wx, z: wz, tx: wx, tz: wz, fading: 0 };
        map.set(c.id, e);
      }
      e.fading = 0;
      e.mesh.visible = true;
      e.mesh.position.y = 0;
      e.mesh.scale.set(1, 1, 1);
      e.tx = wx;
      e.tz = wz;
      if (instant) { e.x = wx; e.z = wz; e.mesh.position.set(wx, 0, wz); }
    }
  }

  function syncAllFromView(instant) {
    if (!view) return;
    for (const side of COLORS) {
      // while a throw at this side is still flying, keep showing its pre-throw cups
      if (anim && anim.rec.target === side) continue;
      syncCups(side, sideCupsFromView(side), { instant });
    }
  }

  function callout(text, color, small) {
    if (reduced() && small) return;
    const el = document.createElement('div');
    el.className = `cp-callout${small ? ' small' : ''}`;
    el.style.color = color || '#39ff14';
    el.textContent = text;
    stage.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  function splash(x, z) {
    if (!G || reduced()) return;
    for (const d of G.drops) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.25 + Math.random() * 0.45;
      d.position.set(x, S.CUP_H * 0.75, z);
      d.userData.v.set(Math.cos(a) * s * 0.5, 0.6 + Math.random() * 0.7, Math.sin(a) * s * 0.5);
      d.userData.life = 1;
      d.visible = true;
    }
  }

  function startAnim(rec, start, local) {
    anim = { rec, start, fired: new Set(), local };
    // show the cups as they were before this throw
    syncCups(rec.target, rec.before, { instant: false });
    camTarget = rec.by === 'blue' ? Math.PI : 0;
    if (!local) sfx.play('whoosh', { vol: 0.6 });
  }

  function finishAnim() {
    const rec = anim.rec;
    anim = null;
    // bring the cups up to date (handles re-racks with a tween)
    const nextAtSide = queue.find((q) => q.target === rec.target);
    const latest = nextAtSide ? nextAtSide.before : view.cups[rec.target];
    syncCups(rec.target, latest);
    if (rec.rerack) {
      callout('RE-RACK', '#ffe14d', true);
      sfx.play('swap');
    }
    if (rec.ballsBack) {
      callout('BALLS BACK', '#39ff14');
      sfx.play('kill');
    } else if (rec.turnOver && view.phase === 'playing' && !queue.length) {
      const seat = mySeat();
      if (seat && view.turn === seat) setTimeout(() => sfx.play('turn'), 200);
    }
    if (queue.length) {
      const next = queue.shift();
      startAnim(next, performance.now(), false);
    } else {
      syncAllFromView(false);
      if (view.phase === 'playing') camTarget = view.turn === 'blue' ? Math.PI : 0;
      renderDom();
    }
  }

  function onNewThrow(rec) {
    if (rec.seq <= lastSeqSeen) return;
    lastSeqSeen = rec.seq;
    // our own throw already flying from the local prediction: swap in the server frames
    if (anim && anim.local && localPending && rec.by === mySeat()) {
      anim.rec = rec;
      anim.local = false;
      localPending = null;
      return;
    }
    localPending = null;
    if (anim) queue.push(rec);
    else startAnim(rec, performance.now(), false);
  }

  // ---- input ----
  function canThrow() {
    const seat = mySeat();
    return !!(G && view && seat && view.phase === 'playing' && view.turn === seat && !anim && !queue.length
      && !localPending && clock.now() >= view.busyUntil - 150);
  }

  function inputFromDrag(dx, dy) {
    const r = stage.getBoundingClientRect();
    return { aim: Math.max(-1, Math.min(1, dx / (r.width * 0.42))), power: Math.max(0, Math.min(1, dy / (r.height * 0.62))) };
  }

  stage.addEventListener('pointerdown', (e) => {
    if (!canThrow()) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, aim: 0, power: 0 };
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    // slingshot: pull down to throw, pulling left aims right (the camera faces the throw, so screen-right is the thrower's right)
    const inp = inputFromDrag(drag.x0 - e.clientX, e.clientY - drag.y0);
    drag.aim = inp.aim;
    drag.power = inp.power;
    power.classList.add('on');
    powerFill.style.height = `${Math.round(inp.power * 100)}%`;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    stage.classList.remove('dragging');
    power.classList.remove('on');
    if (e.type === 'pointercancel' || d.power < 0.04) return; // a tap / tiny drag isn't a throw
    if (!canThrow()) return;
    const input = S.normInput({ aim: d.aim, power: d.power });
    const seat = mySeat();
    const target = seat === 'red' ? 'blue' : 'red';
    const res = S.simulate(view.cups[target], input);
    if (!res) return;
    localPending = { input, start: performance.now() };
    const rec = { seq: -1, by: seat, target, input, frames: res.frames, events: res.events, sinkFrame: res.sinkFrame,
      outcome: res.outcome, cupId: res.cupId, before: view.cups[target], ballsBack: false, rerack: false, turnOver: false };
    startAnim(rec, performance.now(), true);
    sfx.play('whoosh', { vol: 0.6 });
    api.sendAction({ kind: 'throw', aim: input.aim, power: input.power });
    renderDom();
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // ---- per-frame update ----
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!G) return;
    const { THREE, camera, renderer, ball, blob } = G;

    // camera swing
    const diff = camTarget - camAngle;
    camAngle += diff * (reduced() ? 1 : Math.min(1, 0.06));
    if (Math.abs(diff) < 0.001) camAngle = camTarget;
    const cx = 0;
    const cz = S.TABLE_L / 2;
    const back = S.TABLE_L / 2 + 0.66;
    camera.position.set(cx - Math.sin(camAngle) * back * 0, 0.64, cz - Math.cos(camAngle) * back);
    camera.position.x = cx + Math.sin(camAngle) * 0.0;
    // look past the centre toward the target rack
    const look = S.TABLE_L / 2 - 0.55;
    camera.lookAt(cx, 0.0, cz + Math.cos(camAngle) * look);

    // ball
    let bx; let by; let bz;
    let showBall = false;
    if (anim) {
      const rec = anim.rec;
      // rAF's timestamp can be a hair earlier than the performance.now() a local throw started at
      const f = Math.max(0, (now - anim.start) / FRAME_MS);
      const n = rec.frames.length;
      const i = Math.min(n - 1, Math.floor(f));
      const t = Math.min(1, f - i);
      const a = rec.frames[i];
      const b = rec.frames[Math.min(n - 1, i + 1)];
      [bx, by, bz] = toWorld(S, rec.by, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
      showBall = !(rec.outcome === 'sink' && f > rec.sinkFrame + 4);
      for (const ev of rec.events) {
        const key = `${ev.f}:${ev.type}`;
        if (f >= ev.f && !anim.fired.has(key)) {
          anim.fired.add(key);
          if (ev.type === 'rim') { sfx.play('blip'); sfx.play('tick'); }
          else if (ev.type === 'table' || ev.type === 'wall') sfx.play('tick');
          else if (ev.type === 'sink') {
            sfx.play('pop');
            setTimeout(() => sfx.play('chime'), 90);
            const e = shown[rec.target].get(rec.cupId);
            if (e) { splash(e.mesh.position.x, e.mesh.position.z); e.fading = 1; }
            const mine = rec.by === mySeat();
            callout(mine ? 'SPLASH' : 'SUNK', TEXT_COLOR[rec.by], false);
          }
        }
      }
      if (rec.outcome === 'miss' && f >= n - 1 && !anim.fired.has('miss')) {
        anim.fired.add('miss');
        callout(rec.events.some((e) => e.type === 'rim') ? 'RIMMED OUT' : 'MISS', '#9fb39c', true);
      }
      if (f > n + HOLD_FRAMES && !anim.rec.local) finishAnim();
      else if (f > n + 240 && anim.rec.local) { // server never answered; give up on the preview
        anim = null;
        localPending = null;
        syncAllFromView(false);
        renderDom();
      }
    } else if (canThrow() || drag) {
      // ball in hand, nudged by the drag
      holdBob += 0.05;
      const seat = mySeat();
      const p = drag ? drag.power : 0;
      const aimX = drag ? drag.aim * 0.05 : 0;
      [bx, by, bz] = toWorld(S, seat, S.LAUNCH.x + aimX, S.LAUNCH.y - p * 0.05 + Math.sin(holdBob) * 0.004, S.LAUNCH.z - p * 0.06);
      showBall = true;
    }
    ball.visible = showBall;
    blob.visible = showBall && by > -0.01;
    if (showBall) {
      ball.position.set(bx, by, bz);
      const onTable = Math.abs(bx) <= S.TABLE_W / 2 && bz >= 0 && bz <= S.TABLE_L;
      blob.visible = onTable && by > 0;
      blob.position.set(bx, 0.001, bz);
      const s = Math.max(0.3, 1 - by * 1.6);
      blob.scale.set(s, s, s);
      blob.material.opacity = Math.max(0.15, 1 - by * 1.5);
    }

    // aim preview
    const preview = drag && drag.power >= 0.04;
    if (preview) {
      const seat = mySeat();
      const v = S.launchVelocity(S.normInput({ aim: drag.aim, power: drag.power }));
      for (let k = 0; k < G.dots.length; k++) {
        const t = 0.035 * (k + 1);
        const x = S.LAUNCH.x + v.x * t;
        const y = S.LAUNCH.y + v.y * t - 4.9 * t * t;
        const z = S.LAUNCH.z + v.z * t;
        const [wx, wy, wz] = toWorld(S, seat, x, y, z);
        G.dots[k].position.set(wx, wy, wz);
        G.dots[k].material.opacity = 0.85 * (1 - k / G.dots.length);
        G.dots[k].visible = true;
      }
    } else for (const d of G.dots) d.visible = false;

    // cups: re-rack tween + sink/remove fade
    for (const side of COLORS) {
      for (const [id, e] of shown[side]) {
        e.x += (e.tx - e.x) * 0.12;
        e.z += (e.tz - e.z) * 0.12;
        e.mesh.position.x = e.x;
        e.mesh.position.z = e.z;
        if (e.fading) {
          e.fading -= 0.025;
          e.mesh.position.y = -(1 - e.fading) * 0.03;
          const sc = 0.4 + 0.6 * Math.max(0, e.fading);
          e.mesh.scale.set(sc, sc, sc);
          if (e.fading <= 0) {
            G.scene.remove(e.mesh);
            shown[side].delete(id);
          }
        }
      }
    }

    // splash droplets
    for (const d of G.drops) {
      if (!d.visible) continue;
      d.userData.v.y -= 9.8 / 60;
      d.position.addScaledVector(d.userData.v, 1 / 60);
      d.userData.life -= 1 / 40;
      d.material.opacity = Math.max(0, d.userData.life);
      if (d.userData.life <= 0 || d.position.y < 0) d.visible = false;
    }

    // keep the canvas sized to its box
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const size = renderer.getSize(new THREE.Vector2());
    if (w && h && (size.x !== w || size.y !== h)) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 0.9 ? 50 : 46;
      camera.updateProjectionMatrix();
    }
    renderer.render(G.scene, camera);
    if (!anim && stage.classList.contains('can-throw') !== canThrow()) renderDom();
  }

  // ---- DOM ----
  function seatBox(color) {
    const box = document.createElement('div');
    box.className = `cp-seat${view.phase === 'playing' && view.turn === color ? ' turn' : ''}`;
    const chip = document.createElement('span');
    chip.className = `cp-chip ${color}`;
    const name = document.createElement('span');
    const occ = view.players[color];
    name.textContent = `${color.toUpperCase()}: ${nicknameFor(occ) || '(empty)'}${occ && occ === api.getClientId() ? ' (you)' : ''}`;
    name.style.color = TEXT_COLOR[color];
    box.append(chip, name);
    const seat = mySeat();
    if (!occ) {
      if (!seat) {
        const btn = document.createElement('button');
        btn.textContent = `PLAY ${color.toUpperCase()}`;
        btn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: color }));
        box.appendChild(btn);
      }
      const bot = document.createElement('button');
      bot.textContent = 'PLAY VS BOT';
      bot.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: color, bot: true, level: preferredLevel() }));
      box.append(bot, levelSelect(preferredLevel()));
    } else if (occ === 'BOT') {
      box.appendChild(levelSelect((view.botLevels || {})[color], (level) => api.sendAction({ kind: 'setBotLevel', seat: color, level })));
      const rm = document.createElement('button');
      rm.textContent = 'REMOVE BOT';
      rm.addEventListener('click', () => api.sendAction({ kind: 'removeBot', seat: color }));
      box.appendChild(rm);
    }
    return box;
  }

  function renderDom() {
    if (destroyed) return;
    const seat = mySeat();
    const over = view && view.phase === 'game_over' && !anim && !queue.length;
    results.update(over ? duelResults({
      winner: view.winner, colors: COLORS, players: view.players, me: seat, nameFor: nicknameFor,
      subtitle: COLORS.map((c) => `${c.toUpperCase()} ${view.stats[c].made}/${view.stats[c].throws}`).join(' · ') + ' made',
      onRematch: () => api.sendAction({ kind: 'resetGame' }),
    }) : null);
    if (!view) {
      status.textContent = 'Loading...';
      return;
    }
    // what the table currently shows (the state can be ahead of a ball still in the air)
    const showTurn = anim ? anim.rec.by : view.turn;
    status.className = 'cp-status';
    status.style.color = '';
    if (view.phase === 'waiting') {
      status.textContent = 'Waiting for both seats to be filled.';
    } else if (over) {
      status.textContent = `${view.winner.toUpperCase()} WINS`;
      status.style.color = '#ffb000';
    } else if (seat && showTurn === seat) {
      status.textContent = '▶ YOUR THROW';
      status.classList.add('mine');
    } else {
      status.textContent = `${showTurn.toUpperCase()} THROWING. ${nicknameFor(view.players[showTurn])}`;
      status.style.color = TEXT_COLOR[showTurn];
    }
    err.textContent = flashError ? REJECT_MESSAGES[flashError] || 'Throw rejected' : '';

    seats.innerHTML = '';
    seats.append(seatBox('red'), seatBox('blue'));
    if (seat) {
      const leave = document.createElement('button');
      leave.textContent = 'LEAVE SEAT';
      leave.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seats.appendChild(leave);
    }

    // HUD: cups left per side (as shown on the table)
    hud.innerHTML = '';
    for (const c of COLORS) {
      const n = shown[c].size ? [...shown[c].values()].filter((e) => !e.fading).length : view.cups[c].length;
      const el = document.createElement('div');
      el.className = 'cp-count';
      el.style.color = TEXT_COLOR[c];
      const chip = document.createElement('span');
      chip.className = `cp-chip ${c}`;
      el.append(chip, document.createTextNode(`${nicknameFor(view.players[c]) || c.toUpperCase()} · ${n} CUP${n === 1 ? '' : 'S'}`));
      hud.appendChild(el);
    }
    balls.innerHTML = '';
    if (view.phase === 'playing') {
      const left = anim ? null : view.throwsLeft;
      for (let i = 0; i < 2; i++) {
        const b = document.createElement('div');
        b.className = `cp-ball${left != null && i >= left ? ' used' : ''}`;
        balls.appendChild(b);
      }
    }
    const ct = canThrow();
    stage.classList.toggle('can-throw', ct);
    hint.textContent = ct ? (view.throwsLeft === 2 && view.madeThisTurn === 0 ? 'PULL DOWN & RELEASE TO THROW' : 'ONE MORE THROW') : '';

    options.innerHTML = '';
    if (view.phase !== 'playing') {
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!view.rerackOn;
      cb.addEventListener('change', () => api.sendAction({ kind: 'setRerack', on: cb.checked }));
      lab.append(cb, document.createTextNode('Auto re-rack at 6 / 3 / 2 / 1 cups'));
      options.appendChild(lab);
    } else {
      options.textContent = view.rerackOn ? 'Auto re-rack ON' : '';
    }
    if (view.phase === 'game_over' && seat && over) {
      const again = document.createElement('button');
      again.textContent = 'REMATCH (SWAP SIDES)';
      again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
      options.appendChild(again);
    }
  }

  // ---- boot ----
  Promise.all([loadScript('games/slope/three.min.js', 'THREE'), loadScript('games/cuppong/sim.js', 'CupPongSim')])
    .then(([THREE, Sim]) => {
      if (destroyed) return;
      S = Sim;
      try {
        G = createScene(THREE, S, canvas);
      } catch (e) {
        stage.innerHTML = '<div class="cp-fail">3D graphics (WebGL) are not available in this browser.</div>';
        return;
      }
      syncAllFromView(true);
      if (view) camAngle = camTarget = (view.phase === 'playing' ? view.turn : mySeat() || 'red') === 'blue' ? Math.PI : 0;
      raf = requestAnimationFrame(frame);
      renderDom();
    })
    .catch(() => {
      stage.innerHTML = '<div class="cp-fail">Could not load the 3D engine.</div>';
    });

  renderDom();

  function applyState(data, fromSnapshot) {
    const prev = view;
    view = data;
    clock.sync(data.serverNow);
    if (fromSnapshot || !prev || prev.gameId !== data.gameId) {
      // fresh game / join: no replay, just show it
      anim = null;
      queue.length = 0;
      localPending = null;
      lastSeqSeen = data.lastThrow ? data.lastThrow.seq : 0;
      syncAllFromView(true);
      camTarget = (data.phase === 'playing' ? data.turn : mySeat() || 'red') === 'blue' ? Math.PI : 0;
      if (fromSnapshot || !prev) camAngle = camTarget;
      if (prev && prev.phase !== 'playing' && data.phase === 'playing') sfx.play('go');
    } else if (data.lastThrow && data.lastThrow.seq > lastSeqSeen) {
      onNewThrow(data.lastThrow);
    } else if (!anim && !queue.length) {
      syncAllFromView(false);
      if (data.phase === 'playing') camTarget = data.turn === 'blue' ? Math.PI : 0;
    }
    if (prev && !prev.winner && data.winner) {
      // let the winning ball land first
      const seat = mySeat();
      const delay = anim ? Math.max(0, (anim.rec.frames.length + HOLD_FRAMES) * FRAME_MS - (performance.now() - anim.start)) : 0;
      setTimeout(() => sfx.play(!seat ? 'point' : data.winner === seat ? 'win' : 'lose'), delay);
    }
    flashError = null;
    renderDom();
  }

  return {
    applySnapshot(snapshot) {
      applyState(snapshot, true);
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') applyState(data, false);
      else if (data.kind === 'moveRejected') {
        // a rejected throw: drop the local preview
        if (anim && anim.local) {
          anim = null;
          localPending = null;
          syncAllFromView(false);
        }
        flashError = data.reason || 'invalid';
        sfx.play('error');
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { flashError = null; renderDom(); }, 2000);
        renderDom();
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      renderDom();
    },
    unmount() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(flashTimer);
      results.destroy();
      if (G) {
        G.renderer.dispose();
        G.scene.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
        });
      }
      container.innerHTML = '';
    },
  };
}
