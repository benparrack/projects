// Skee-Ball client. Three.js arcade lane (three.min.js shared with Slope) + the shared roll physics
// (sim.js). Drag up from anywhere on the lane view and let go: sideways = aim, distance dragged =
// power. Your own roll starts instantly from a local run of the same sim; the server's
// authoritative trajectory (identical in practice) takes over when it arrives. Everyone else
// replays the server's frames. Sim x is mirrored into world x so the thrower's right is screen right.

import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect } from '../botLevel.js';
import { createResults, duelResults } from '../resultsPanel.js';
import { makeServerClock } from '../serverClock.js';
import { loadScript } from '../loadScript.js';

const FRAME_MS = 1000 / 60;
const HOLD_FRAMES = 20; // pause after the last frame before the anim ends
const COLORS = ['red', 'blue'];
const BALL_COLOR = { red: 0xe0283c, blue: 0x2a6cf0 };
const TEXT_COLOR = { red: '#ff5a6a', blue: '#5aa0ff' };
const PTS_COLOR = { 0: '#8a9a88', 10: '#7dd3fc', 20: '#4ade80', 30: '#facc15', 40: '#fb923c', 50: '#f43f5e', 100: '#e879f9' };

const REJECT_MESSAGES = {
  not_your_turn: "It's not your turn.",
  busy: 'Wait for the ball to drop.',
  not_playing: 'The game is not running.',
  invalid: 'Invalid roll.',
};

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CSS = `
.sk-root { display: flex; flex-direction: column; align-items: center; gap: 8px; font-family: monospace; color: #b8ffb0; width: 100%; }
.sk-status { font-size: 15px; font-weight: bold; letter-spacing: 1px; text-align: center; min-height: 20px; }
.sk-status.mine { color: #39ff14; text-shadow: 0 0 8px #39ff14; }
.sk-err { color: #ff5a5a; font-size: 12px; min-height: 14px; }
.sk-seats { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; }
.sk-seat { display: flex; flex-wrap: wrap; justify-content: center; max-width: 100%; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid #1d5c1d; border-radius: 6px; background: #071107; font-size: 13px; }
.sk-seat.turn { border-color: #39ff14; box-shadow: 0 0 10px -2px #39ff14; }
.sk-seat button { font: inherit; font-size: 12px; }
.sk-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
.sk-dot.red { background: radial-gradient(circle at 35% 30%, #ff9aa5, #e0283c 60%, #7a0c18); }
.sk-dot.blue { background: radial-gradient(circle at 35% 30%, #a8c8ff, #2a6cf0 60%, #0c2a6e); }
.sk-stage { position: relative; width: min(100%, 520px); aspect-ratio: 3 / 4; max-height: 72vh; border: 1px solid #1d5c1d; border-radius: 10px; overflow: hidden;
  background: radial-gradient(circle at 50% 25%, #1a1030, #04020a 75%); touch-action: none; user-select: none; -webkit-user-select: none; }
.sk-stage canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
.sk-stage canvas.sk-fx { pointer-events: none; }
.sk-stage.can-roll { cursor: grab; } .sk-stage.dragging { cursor: grabbing; }
.sk-board { position: absolute; left: 8px; right: 8px; top: 8px; display: flex; justify-content: space-between; gap: 8px; pointer-events: none; }
.sk-led { background: rgba(0,0,0,.72); border: 1px solid #333; border-radius: 6px; padding: 3px 8px 4px; min-width: 96px; text-align: center; box-shadow: inset 0 0 8px #000; transition: border-color .2s, box-shadow .2s; }
.sk-led.turn { border-color: currentColor; box-shadow: inset 0 0 8px #000, 0 0 10px -2px currentColor; }
.sk-led .nm { font-size: 10px; letter-spacing: 1px; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }
.sk-led .sc { font-size: 26px; font-weight: bold; letter-spacing: 3px; line-height: 1; text-shadow: 0 0 8px currentColor; font-variant-numeric: tabular-nums; }
.sk-led .sc .dim { opacity: .18; text-shadow: none; }
.sk-led.flash .sc { animation: sk-flash .9s steps(2, jump-none) 3; }
@keyframes sk-flash { 0% { color: #fff; text-shadow: 0 0 16px #fff; } 100% { color: inherit; } }
.sk-mid { align-self: center; text-align: center; font-size: 11px; color: #ffe14d; text-shadow: 0 1px 2px #000; letter-spacing: 1px; }
.sk-hint { position: absolute; left: 0; right: 0; bottom: 14px; text-align: center; font-size: 12px; color: #9fdc98; pointer-events: none; text-shadow: 0 1px 2px #000; animation: sk-hint 1.6s ease-in-out infinite alternate; }
@keyframes sk-hint { from { opacity: .45; } to { opacity: 1; } }
.sk-power { position: absolute; right: 12px; top: 50%; width: 12px; height: 46%; transform: translateY(-50%); border: 1px solid #39ff14; border-radius: 6px; background: rgba(0,0,0,.45); overflow: hidden; pointer-events: none; opacity: 0; transition: opacity .15s; }
.sk-power.on { opacity: 1; }
.sk-power > div { position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(0deg, #39ff14, #ffe14d 60%, #ff4d4d); }
.sk-callout { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); font-size: 46px; font-weight: bold; letter-spacing: 3px; white-space: nowrap; pointer-events: none;
  text-shadow: 0 0 16px currentColor, 0 2px 3px #000; animation: sk-call 1.6s cubic-bezier(.2,1.4,.4,1) forwards; }
.sk-callout.blink { animation: sk-call 1.6s cubic-bezier(.2,1.4,.4,1) forwards, sk-blink .16s steps(2, jump-none) 6; }
.sk-callout.small { font-size: 20px; top: 48%; }
@keyframes sk-call { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.4); } 15% { opacity: 1; transform: translate(-50%, -50%) scale(1.12); }
  25% { transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -75%) scale(1); } }
@keyframes sk-blink { 0% { filter: brightness(2.2); } 100% { filter: none; } }
.sk-cards { display: flex; flex-direction: column; gap: 4px; align-items: safe center; font-size: 12px; max-width: 100%; overflow-x: auto; }
.sk-card { display: flex; gap: 3px; align-items: center; }
.sk-card .who { width: 52px; text-align: right; padding-right: 4px; font-weight: bold; }
.sk-cell { width: 28px; height: 20px; line-height: 20px; text-align: center; border: 1px solid #1d3a1d; border-radius: 3px; background: #050c05; font-size: 11px; }
.sk-cell.gap { margin-left: 6px; }
.sk-cell.next { border-color: #39ff14; box-shadow: 0 0 6px -1px #39ff14; }
.sk-cell.sd { border-style: dashed; }
.sk-cell.tot { width: 44px; font-weight: bold; margin-left: 6px; border-color: #2f5a2f; }
.sk-help { font-size: 11px; opacity: .7; text-align: center; max-width: 520px; }
.sk-fail { padding: 30px; text-align: center; color: #ff8080; }
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
function laneTexture(THREE, S) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 1024;
  const g = c.getContext('2d');
  // maple planks
  for (let i = 0; i < 8; i++) {
    const x = i * 32;
    const l = 34 + ((i * 37) % 9);
    g.fillStyle = `hsl(32, 48%, ${l}%)`;
    g.fillRect(x, 0, 32, c.height);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(x, 0, 1.5, c.height);
    for (let k = 0; k < 14; k++) {
      g.fillStyle = `rgba(80,40,10,${0.05 + ((i * 7 + k * 3) % 5) * 0.015})`;
      g.fillRect(x + ((k * 11 + i * 5) % 28), (k * 97 + i * 211) % c.height, 2, 60 + ((k * 13) % 50));
    }
  }
  // chevron arrows (canvas top = far end of the lane)
  g.fillStyle = 'rgba(255,240,180,0.55)';
  for (let k = 0; k < 3; k++) {
    const y = 380 + k * 70;
    g.beginPath();
    g.moveTo(128, y - 30); g.lineTo(158, y + 4); g.lineTo(146, y + 4); g.lineTo(128, y - 16); g.lineTo(110, y + 4); g.lineTo(98, y + 4);
    g.closePath();
    g.fill();
  }
  // foul line
  g.fillStyle = '#ffe14d';
  g.fillRect(0, c.height - 14, c.width, 6);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function boardTexture(THREE, S) {
  const PX = 1000; // pixels per metre
  const c = document.createElement('canvas');
  c.width = Math.round(S.BOARD_W * PX);
  c.height = Math.round(S.BOARD_H * PX);
  const g = c.getContext('2d');
  const X = (u) => (u + S.BOARD_W / 2) * PX;
  const Y = (w) => (S.BOARD_H - w) * PX;
  const bg = g.createLinearGradient(0, 0, 0, c.height);
  bg.addColorStop(0, '#1b0f33');
  bg.addColorStop(1, '#0c0618');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  // channels, outermost first
  const fills = ['#0e7490', '#15803d', '#a16207', '#c2410c', '#9f1239'];
  for (let k = S.RINGS.length - 1; k >= 0; k--) {
    g.beginPath();
    g.arc(X(0), Y(S.WC), S.RINGS[k] * PX, 0, Math.PI * 2);
    g.fillStyle = fills[k];
    g.fill();
  }
  // channel holes + labels
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const h of S.holeSpots()) {
    const grad = g.createRadialGradient(X(h.u), Y(h.w), 0, X(h.u), Y(h.w), (h.r + 0.008) * PX);
    grad.addColorStop(0, '#000');
    grad.addColorStop(0.75, '#05020a');
    grad.addColorStop(1, 'rgba(0,0,0,0.2)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(X(h.u), Y(h.w), (h.r + 0.008) * PX, 0, Math.PI * 2);
    g.fill();
  }
  g.shadowBlur = 12;
  for (let k = 1; k < S.RINGS.length; k++) {
    const mid = (S.RINGS[k - 1] + S.RINGS[k]) / 2;
    g.fillStyle = '#fff7d6';
    g.shadowColor = '#fff7d6';
    g.font = 'bold 34px monospace';
    g.fillText(String(S.RING_POINTS[k]), X(0), Y(S.WC + mid));
  }
  g.fillStyle = '#ffe14d';
  g.shadowColor = '#ffe14d';
  g.font = 'bold 30px monospace';
  g.fillText('50', X(0), Y(S.WC));
  for (const p of S.POCKETS) {
    g.fillStyle = '#f0abfc';
    g.shadowColor = '#e879f9';
    g.font = 'bold 34px monospace';
    g.fillText('100', X(p.u), Y(p.w - S.POCKET_R - 0.03));
  }
  g.shadowBlur = 0;
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function marqueeTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#12051f';
  g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 26; i++) {
    g.fillStyle = i % 2 ? '#ffe14d' : '#ff5ad1';
    g.beginPath(); g.arc(10 + i * 19.6, 8, 4, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(10 + i * 19.6, 120, 4, 0, Math.PI * 2); g.fill();
  }
  g.font = 'bold 66px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#39ff14';
  g.shadowBlur = 18;
  g.fillStyle = '#b8ffb0';
  g.fillText('ALLEY BALL', 256, 66);
  return new THREE.CanvasTexture(c);
}

function glowTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(0,0,0,0.6)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// sim -> world: mirror x so +aim (a rightward drag) is screen right for a camera looking +z
const toWorld = (x, y, z) => [-x, y, z];

// ---- the 3D scene ----------------------------------------------------------------------------
function createScene(THREE, S, canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  if ('outputEncoding' in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x04020a, 4, 9);
  const camera = new THREE.PerspectiveCamera(50, 0.75, 0.02, 30);

  scene.add(new THREE.HemisphereLight(0xfff1dd, 0x120a20, 0.8));
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(0.4, 2.5, 0.6);
  scene.add(key);
  const boardLight = new THREE.PointLight(0xffe7c0, 0.9, 3);
  boardLight.position.set(0, 1.3, S.ORIGIN.z - 0.2);
  scene.add(boardLight);

  const halfW = S.LANE_W / 2;
  // lane surface incl. the hump, as one strip whose height follows the sim's profile
  const laneLen = S.RAMP_Z;
  const laneGeo = new THREE.PlaneGeometry(S.LANE_W, laneLen, 1, 80);
  laneGeo.rotateX(-Math.PI / 2); // plane +y (texture top) -> -z, so flip below
  const pos = laneGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = -pos.getZ(i) + laneLen / 2; // 0 at the foul line .. laneLen at the hump
    const t = (z - (S.RAMP_Z - S.RAMP_LEN)) / S.RAMP_LEN;
    pos.setZ(i, z);
    pos.setY(i, t <= 0 ? 0 : S.RAMP_H * Math.min(1, t) * Math.min(1, t));
  }
  laneGeo.computeVertexNormals();
  const lane = new THREE.Mesh(laneGeo, new THREE.MeshStandardMaterial({ map: laneTexture(THREE, S), roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide }));
  scene.add(lane);
  // hump face (front of the ramp's drop-off)
  const lip = new THREE.Mesh(new THREE.BoxGeometry(S.LANE_W, S.RAMP_H + 0.3, 0.02), new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.6 }));
  lip.position.set(0, S.RAMP_H - (S.RAMP_H + 0.3) / 2, S.RAMP_Z + 0.01);
  scene.add(lip);

  // neon side rails running the whole cabinet
  const railMat = new THREE.MeshStandardMaterial({ color: 0x1a0b2e, emissive: 0x39ff14, emissiveIntensity: 0.25, roughness: 0.5 });
  const railLen = S.ORIGIN.z + S.BOARD_H * Math.cos(S.THETA) + 0.05;
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, S.RAMP_Z), railMat);
    rail.position.set(sx * (halfW + 0.015), 0.04, S.RAMP_Z / 2);
    scene.add(rail);
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, S.RAMP_Z), new THREE.MeshBasicMaterial({ color: 0x39ff14 }));
    tube.position.set(sx * (halfW + 0.015), 0.094, S.RAMP_Z / 2);
    scene.add(tube);
    // cabinet walls around the target
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.9, railLen - S.RAMP_Z + 0.1),
      new THREE.MeshStandardMaterial({ color: 0x160a26, roughness: 0.7 }));
    wall.position.set(sx * (S.BOARD_W / 2 + 0.015), 0.3, (S.RAMP_Z + railLen) / 2);
    scene.add(wall);
    const neon = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, railLen - S.RAMP_Z + 0.1), new THREE.MeshBasicMaterial({ color: 0xff5ad1 }));
    neon.position.set(sx * (S.BOARD_W / 2 + 0.015), 0.755, (S.RAMP_Z + railLen) / 2);
    scene.add(neon);
  }
  // the pit under the jump
  const pit = new THREE.Mesh(new THREE.PlaneGeometry(S.BOARD_W, S.ORIGIN.z - S.RAMP_Z + 0.3),
    new THREE.MeshStandardMaterial({ color: 0x07030c, roughness: 1 }));
  pit.rotation.x = -Math.PI / 2;
  pit.position.set(0, -0.28, (S.RAMP_Z + S.ORIGIN.z) / 2 + 0.1);
  scene.add(pit);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: 0x05030a, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.3, 1.5);
  scene.add(floor);

  // target board group: local x = world x (= -u), local y = board normal h, local z = up-slope w
  const board = new THREE.Group();
  board.position.set(0, S.ORIGIN.y, S.ORIGIN.z);
  board.rotation.x = -S.THETA;
  scene.add(board);
  const faceGeo = new THREE.PlaneGeometry(S.BOARD_W, S.BOARD_H);
  faceGeo.rotateY(Math.PI);
  faceGeo.rotateX(Math.PI / 2);
  const face = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({ map: boardTexture(THREE, S), roughness: 0.55 }));
  face.position.set(0, 0, S.BOARD_H / 2);
  board.add(face);
  const under = new THREE.Mesh(new THREE.BoxGeometry(S.BOARD_W, 0.02, S.BOARD_H), new THREE.MeshStandardMaterial({ color: 0x0b0614 }));
  under.position.set(0, -0.012, S.BOARD_H / 2);
  board.add(under);
  const lipMat = new THREE.MeshStandardMaterial({ color: 0xd9d9e6, roughness: 0.3, metalness: 0.6, side: THREE.DoubleSide });
  const rimGlow = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
  const rings = [];
  for (const R of S.RINGS) {
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(R, R, S.LIP_H, 72, 1, true), lipMat);
    cyl.position.set(0, S.LIP_H / 2, S.WC);
    const top = new THREE.Mesh(new THREE.TorusGeometry(R, 0.004, 6, 72), rimGlow.clone());
    top.rotation.x = Math.PI / 2;
    top.position.set(0, S.LIP_H, S.WC);
    board.add(cyl, top);
    rings.push(top);
  }
  const pockets = {};
  for (const p of S.POCKETS) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(S.POCKET_R + 0.006, 0.006, 8, 40), new THREE.MeshBasicMaterial({ color: 0xe879f9 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(-p.u, 0.004, p.w);
    board.add(ring);
    pockets[p.id] = ring;
  }
  // back wall + marquee
  const back = new THREE.Mesh(new THREE.BoxGeometry(S.BOARD_W, 0.4, 0.03), new THREE.MeshStandardMaterial({ color: 0x160a26, roughness: 0.7 }));
  const [, by, bz] = S.boardToWorld(0, S.BOARD_H, 0);
  back.position.set(0, by + 0.2 - 0.02, bz + 0.015);
  scene.add(back);
  const marquee = new THREE.Mesh(new THREE.PlaneGeometry(S.BOARD_W, S.BOARD_W / 4),
    new THREE.MeshBasicMaterial({ map: marqueeTexture(THREE) }));
  marquee.rotation.y = Math.PI; // face the player (camera looks +z)
  marquee.position.set(0, by + 0.42 + S.BOARD_W / 8, bz);
  scene.add(marquee);

  const ballMats = {};
  for (const c of COLORS) ballMats[c] = new THREE.MeshStandardMaterial({ color: BALL_COLOR[c], roughness: 0.3, metalness: 0.1, emissive: BALL_COLOR[c], emissiveIntensity: 0.12 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(S.BALL_R, 28, 18), ballMats.red);
  scene.add(ball);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(S.BALL_R * 4, S.BALL_R * 4),
    new THREE.MeshBasicMaterial({ map: glowTexture(THREE), transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  scene.add(blob);

  // aim preview: dots along the lane
  const dots = [];
  const dotGeo = new THREE.SphereGeometry(0.006, 8, 6);
  for (let i = 0; i < 16; i++) {
    const d = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0x39ff14, transparent: true, opacity: 0.8 }));
    d.visible = false;
    scene.add(d);
    dots.push(d);
  }

  // sparks when a ball drops
  const sparks = [];
  const sparkGeo = new THREE.SphereGeometry(0.008, 6, 4);
  for (let i = 0; i < 24; i++) {
    const d = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true }));
    d.visible = false;
    d.userData.v = new THREE.Vector3();
    scene.add(d);
    sparks.push(d);
  }

  return { renderer, scene, camera, ball, ballMats, blob, dots, sparks, rings, pockets, THREE };
}

export function mount(container, api) {
  ensureStyles();
  let view = null;
  let roster = [];
  let flashError = null;
  let flashTimer = null;
  let destroyed = false;
  let S = null;
  let G = null;
  let raf = 0;
  const clock = makeServerClock();

  const root = document.createElement('div');
  root.className = 'sk-root';
  container.appendChild(root);
  const results = createResults(container);

  const status = document.createElement('div');
  status.className = 'sk-status';
  const err = document.createElement('div');
  err.className = 'sk-err';
  const seats = document.createElement('div');
  seats.className = 'sk-seats';
  const stage = document.createElement('div');
  stage.className = 'sk-stage';
  const canvas = document.createElement('canvas');
  const fx = document.createElement('canvas');
  fx.className = 'sk-fx';
  const fxg = fx.getContext('2d');
  const board = document.createElement('div');
  board.className = 'sk-board';
  const leds = {};
  const mid = document.createElement('div');
  mid.className = 'sk-mid';
  for (const c of COLORS) {
    const el = document.createElement('div');
    el.className = 'sk-led';
    el.style.color = TEXT_COLOR[c];
    const nm = document.createElement('div');
    nm.className = 'nm';
    const sc = document.createElement('div');
    sc.className = 'sc';
    el.append(nm, sc);
    leds[c] = { el, nm, sc, shown: -1 };
  }
  board.append(leds.red.el, mid, leds.blue.el);
  const hint = document.createElement('div');
  hint.className = 'sk-hint';
  const power = document.createElement('div');
  power.className = 'sk-power';
  const powerFill = document.createElement('div');
  power.appendChild(powerFill);
  stage.append(canvas, fx, board, hint, power);
  const cards = document.createElement('div');
  cards.className = 'sk-cards';
  const help = document.createElement('div');
  help.className = 'sk-help';
  help.textContent = 'Drag up from anywhere on the lane and let go. Sideways aims, a longer drag rolls harder. 9 balls each, three at a time. Rings score 10–50, the corner pockets 100. Highest score wins.';
  root.append(status, err, seats, stage, cards, help);

  function nicknameFor(id) {
    if (!id) return null;
    if (id === 'BOT') return '(bot)';
    const e = roster.find((r) => r.clientId === id);
    return e ? e.nickname : 'someone';
  }
  function mySeat() {
    if (!view) return null;
    const me = api.getClientId();
    return view.players.red === me ? 'red' : view.players.blue === me ? 'blue' : null;
  }

  // ---- animation state ----
  const queue = []; // roll records waiting to play
  let anim = null; // { rec, start, fired:Set, local }
  let localPending = null;
  let lastSeqSeen = 0;
  const revealed = { red: 0, blue: 0 }; // balls per side whose score is on the scoreboard
  let drag = null;
  let holdBob = 0;
  let cam = { z: -0.55, y: 0.66 };
  const tickets = []; // 2D ticket particles
  let lastFrameT = 0;

  function revealAll() {
    if (!view) return;
    revealed.red = view.balls.red.length;
    revealed.blue = view.balls.blue.length;
  }

  function callout(text, color, { small = false, blink = false } = {}) {
    if (reduced() && small) return;
    const el = document.createElement('div');
    el.className = `sk-callout${small ? ' small' : ''}${blink && !reduced() ? ' blink' : ''}`;
    el.style.color = color;
    el.textContent = text;
    stage.appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }

  function burstTickets(points) {
    if (reduced() || !points) return;
    const n = points >= 100 ? 26 : Math.round(points / 5);
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    for (let i = 0; i < n; i++) {
      tickets.push({
        x: w / 2 + (Math.random() - 0.5) * 40, y: h * 0.9,
        vx: (Math.random() - 0.5) * 420, vy: -380 - Math.random() * 420,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10, life: 1.6 + Math.random() * 0.8,
        hue: points >= 100 ? 300 : 38 + Math.random() * 14,
      });
    }
    for (let k = 0; k < Math.min(5, Math.ceil(n / 5)); k++) setTimeout(() => sfx.play('chips'), k * 90);
  }

  function sparkAt(wx, wy, wz, color) {
    if (!G || reduced()) return;
    for (const d of G.sparks) {
      const a = Math.random() * Math.PI * 2;
      d.position.set(wx, wy, wz);
      d.userData.v.set(Math.cos(a) * (0.3 + Math.random() * 0.5), 0.7 + Math.random() * 0.9, -0.3 - Math.random() * 0.4 + Math.sin(a) * 0.2);
      d.userData.life = 1;
      d.material.color.set(color);
      d.visible = true;
    }
  }

  function startAnim(rec, start, local) {
    anim = { rec, start, fired: new Set(), local };
    if (G) G.ball.material = G.ballMats[rec.by];
    if (!local) sfx.play('slide', { vol: 0.8 });
  }

  function revealRoll(rec) {
    revealed[rec.by] = Math.max(revealed[rec.by], rec.ball);
    const p = rec.points;
    if (rec.outcome === 'score') {
      const big = p >= 50;
      callout(`+${p}`, PTS_COLOR[p], { blink: true });
      if (p >= 100) { sfx.play('kill'); setTimeout(() => sfx.play('chime'), 160); callout('JACKPOT', '#e879f9', { small: true }); }
      else if (big) { sfx.play('chime'); setTimeout(() => sfx.play('point'), 120); }
      else sfx.play('point');
      burstTickets(p);
    } else {
      callout(rec.reason === 'pit' ? 'SHORT. GUTTER' : 'GUTTER', PTS_COLOR[0], { small: true });
      sfx.play('beep', { vol: 0.7 });
    }
    renderDom();
  }

  function finishAnim() {
    const rec = anim.rec;
    anim = null;
    if (rec.ball > revealed[rec.by]) revealRoll(rec);
    if (queue.length) {
      startAnim(queue.shift(), performance.now(), false);
    } else {
      revealAll();
      if (rec.turnOver && view.phase === 'playing') {
        const seat = mySeat();
        if (seat && view.turn === seat) setTimeout(() => sfx.play('turn'), 200);
        if (view.sudden && view.rollNo % 2 === 0 && view.rollNo >= view.perGame * 2) callout('SUDDEN DEATH', '#ffe14d', { small: true });
      }
      renderDom();
    }
  }

  function onNewRoll(rec) {
    if (rec.seq <= lastSeqSeen) return;
    lastSeqSeen = rec.seq;
    if (anim && anim.local && localPending && rec.by === mySeat()) {
      anim.rec = rec; // swap in the authoritative frames (same sim, so the same path)
      anim.local = false;
      localPending = null;
      return;
    }
    localPending = null;
    if (anim) queue.push(rec);
    else startAnim(rec, performance.now(), false);
  }

  // ---- input ----
  function canRoll() {
    const seat = mySeat();
    return !!(G && view && seat && view.phase === 'playing' && view.turn === seat && !anim && !queue.length
      && !localPending && clock.now() >= view.busyUntil - 150);
  }

  function inputFromDrag(dx, dy) {
    const r = stage.getBoundingClientRect();
    return { aim: Math.max(-1, Math.min(1, dx / (r.width * 0.45))), power: Math.max(0, Math.min(1, dy / (r.height * 0.55))) };
  }

  stage.addEventListener('pointerdown', (e) => {
    if (!canRoll()) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, aim: 0, power: 0 };
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const inp = inputFromDrag(e.clientX - drag.x0, drag.y0 - e.clientY);
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
    if (e.type === 'pointercancel' || d.power < 0.04) return; // a tap / tiny drag isn't a roll
    if (!canRoll()) return;
    const input = S.normInput({ aim: d.aim, power: d.power });
    const res = S.simulate(input);
    if (!res) return;
    const seat = mySeat();
    localPending = { input };
    const rec = { seq: -1, by: seat, ball: view.balls[seat].length + 1, input, frames: res.frames, events: res.events,
      dropFrame: res.dropFrame, outcome: res.outcome, points: res.points, hole: res.hole, reason: res.reason, turnOver: false };
    startAnim(rec, performance.now(), true);
    sfx.play('slide', { vol: 0.8 });
    api.sendAction({ kind: 'roll', aim: input.aim, power: input.power });
    renderDom();
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // ---- per-frame update ----
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!G) return;
    const dt = Math.min(0.05, lastFrameT ? (now - lastFrameT) / 1000 : 0.016);
    lastFrameT = now;
    const { THREE, camera, renderer, ball, blob } = G;

    let bx; let by; let bz;
    let showBall = false;
    if (anim) {
      const rec = anim.rec;
      const f = Math.max(0, (now - anim.start) / FRAME_MS); // rAF time can precede performance.now()
      const n = rec.frames.length;
      const i = Math.min(n - 1, Math.floor(f));
      const t = Math.min(1, f - i);
      const a = rec.frames[i];
      const b = rec.frames[Math.min(n - 1, i + 1)];
      [bx, by, bz] = toWorld(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
      showBall = f < n + 2;
      for (const ev of rec.events) {
        const key = `${ev.f}:${ev.type}`;
        if (f >= ev.f && !anim.fired.has(key)) {
          anim.fired.add(key);
          if (ev.type === 'ramp') sfx.play('jump');
          else if (ev.type === 'wall') sfx.play('tick');
          else if (ev.type === 'board') sfx.play('move', { vol: 0.7 });
          else if (ev.type === 'back') sfx.play('capture', { vol: 0.5 });
          else if (ev.type === 'rim') { sfx.play('blip'); sfx.play('tick'); }
          else if (ev.type === 'drop' && !anim.local) {
            sparkAt(bx, by, bz, PTS_COLOR[rec.points]);
            const ring = typeof rec.hole === 'string' ? G.pockets[rec.hole] : G.rings[S.RING_POINTS.indexOf(rec.points)];
            if (ring) ring.userData.flash = 1;
            revealRoll(rec);
          }
        }
      }
      if (rec.outcome === 'gutter' && f >= n - 1 && !anim.fired.has('gutter') && !anim.local) {
        anim.fired.add('gutter');
        revealRoll(rec);
      }
      if (f > n + HOLD_FRAMES && !anim.local) finishAnim();
      else if (f > n + 240 && anim && anim.local) { // the server never answered: drop the preview
        anim = null;
        localPending = null;
        renderDom();
      }
    } else if (canRoll() || drag) {
      holdBob += 0.05;
      const p = drag ? drag.power : 0;
      [bx, by, bz] = toWorld(drag ? drag.aim * 0.06 : 0, S.BALL_R + Math.abs(Math.sin(holdBob)) * 0.004, -0.02 - p * 0.08);
      ball.material = G.ballMats[mySeat()];
      showBall = true;
    }
    ball.visible = showBall;
    if (showBall) {
      ball.position.set(bx, by, bz);
      ball.rotation.x += anim ? 0.25 : 0;
      const onLane = bz < S.RAMP_Z && by < 0.2;
      blob.visible = onLane;
      blob.position.set(bx, 0.002 + (bz > S.RAMP_Z - S.RAMP_LEN ? S.RAMP_H * Math.min(1, (bz - (S.RAMP_Z - S.RAMP_LEN)) / S.RAMP_LEN) ** 2 : 0), bz);
    } else blob.visible = false;

    // camera: behind the foul line, gliding up the lane after the ball
    let tz = -0.55;
    let ty = 0.66;
    if (anim && showBall) {
      tz = Math.min(0.6, Math.max(-0.55, bz - 1.1));
      ty = 0.66 + Math.max(0, tz + 0.55) * 0.12;
    }
    const k = reduced() ? 1 : 1 - Math.pow(0.04, dt);
    cam.z += (tz - cam.z) * k;
    cam.y += (ty - cam.y) * k;
    camera.position.set(0, cam.y, cam.z);
    camera.lookAt(0, 0.3, S.ORIGIN.z + 0.1);

    // aim preview dots along the lane
    if (drag && drag.power >= 0.04) {
      const inp = S.normInput({ aim: drag.aim, power: drag.power });
      const len = S.RAMP_Z * (0.25 + 0.75 * inp.power);
      for (let i = 0; i < G.dots.length; i++) {
        const z = ((i + 1) / G.dots.length) * len;
        const [wx, , wz] = toWorld(Math.max(-S.LANE_W / 2, Math.min(S.LANE_W / 2, inp.aim * S.MAX_SLOPE * z)), 0, z);
        G.dots[i].position.set(wx, 0.008, wz);
        G.dots[i].material.opacity = 0.9 * (1 - i / G.dots.length);
        G.dots[i].material.color.setHSL(0.33 - inp.power * 0.33, 1, 0.55);
        G.dots[i].visible = true;
      }
    } else for (const d of G.dots) d.visible = false;

    // ring / pocket flash after a drop
    for (const r of [...G.rings, ...Object.values(G.pockets)]) {
      if (!r.userData.flash) continue;
      r.userData.flash = Math.max(0, r.userData.flash - dt * 0.7);
      const on = Math.floor(r.userData.flash * 12) % 2 === 0 && r.userData.flash > 0;
      r.material.color.set(on ? 0xffffff : r.userData.base || (r.userData.base = r.material.color.getHex()));
      r.scale.setScalar(1 + (on ? 0.06 : 0));
    }

    for (const d of G.sparks) {
      if (!d.visible) continue;
      d.userData.v.y -= 9.8 * dt * 0.6;
      d.position.addScaledVector(d.userData.v, dt);
      d.userData.life -= dt * 1.4;
      d.material.opacity = Math.max(0, d.userData.life);
      if (d.userData.life <= 0) d.visible = false;
    }

    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const size = renderer.getSize(new THREE.Vector2());
    if (w && h && (size.x !== w || size.y !== h)) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 0.7 ? 56 : 50;
      camera.updateProjectionMatrix();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      fx.width = Math.round(w * dpr);
      fx.height = Math.round(h * dpr);
      fxg.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    renderer.render(G.scene, camera);

    // tickets
    fxg.clearRect(0, 0, w, h);
    for (let i = tickets.length - 1; i >= 0; i--) {
      const t = tickets[i];
      t.vy += 900 * dt;
      t.vx *= 1 - 1.2 * dt;
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      t.rot += t.vr * dt;
      t.life -= dt;
      if (t.life <= 0 || t.y > h + 30) { tickets.splice(i, 1); continue; }
      fxg.save();
      fxg.globalAlpha = Math.min(1, t.life * 2);
      fxg.translate(t.x, t.y);
      fxg.rotate(t.rot);
      fxg.scale(1, Math.abs(Math.cos(t.rot * 1.7)) * 0.8 + 0.2); // flutter
      fxg.fillStyle = `hsl(${t.hue}, 95%, 60%)`;
      fxg.fillRect(-13, -7, 26, 14);
      fxg.fillStyle = `hsl(${t.hue}, 90%, 30%)`;
      fxg.font = 'bold 7px monospace';
      fxg.textAlign = 'center';
      fxg.fillText('TICKET', 0, 3);
      fxg.restore();
    }

    if (!anim && stage.classList.contains('can-roll') !== canRoll()) renderDom();
  }

  // ---- DOM ----
  const shownTotal = (c) => view.balls[c].slice(0, revealed[c]).reduce((a, b) => a + b, 0);

  function seatBox(color) {
    const box = document.createElement('div');
    box.className = `sk-seat${view.phase === 'playing' && view.turn === color ? ' turn' : ''}`;
    const dot = document.createElement('span');
    dot.className = `sk-dot ${color}`;
    const name = document.createElement('span');
    const occ = view.players[color];
    name.textContent = `${color.toUpperCase()}: ${nicknameFor(occ) || '(empty)'}${occ && occ === api.getClientId() ? ' (you)' : ''}`;
    name.style.color = TEXT_COLOR[color];
    box.append(dot, name);
    const seat = mySeat();
    if (!occ && view.solo && view.phase !== 'waiting') {
      name.textContent = `${color.toUpperCase()}: (solo run)`;
    } else if (!occ) {
      if (seat && view.phase !== 'playing') {
        const solo = document.createElement('button');
        solo.textContent = 'ROLL SOLO';
        solo.title = 'Nine balls on your own: chase your high score';
        solo.addEventListener('click', () => api.sendAction({ kind: 'startSolo' }));
        box.appendChild(solo);
      }
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

  let seatSig = '';
  function renderSeats() {
    // rebuild only when something shown changed, so buttons aren't replaced under the pointer
    const sig = JSON.stringify([view.phase, view.solo, view.turn, view.players, view.botLevels, mySeat(), roster.map((r) => [r.clientId, r.nickname])]);
    if (sig === seatSig) return;
    seatSig = sig;
    seats.innerHTML = '';
    seats.append(seatBox('red'), seatBox('blue'));
    if (mySeat()) {
      const leave = document.createElement('button');
      leave.textContent = 'LEAVE SEAT';
      leave.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seats.appendChild(leave);
    }
  }

  function renderLed(c, active) {
    const L = leds[c];
    const nm = `${c.toUpperCase()} · ${nicknameFor(view.players[c]) || '—'}`;
    if (L.nm.textContent !== nm) L.nm.textContent = nm;
    const v = shownTotal(c);
    if (v !== L.shown) {
      const s = String(v).padStart(4, '0');
      const lead = s.length - String(v).length;
      L.sc.innerHTML = `<span class="dim">${s.slice(0, lead)}</span>${s.slice(lead)}`;
      if (L.shown >= 0 && v > L.shown && !reduced()) {
        L.el.classList.remove('flash');
        void L.el.offsetWidth; // restart the animation
        L.el.classList.add('flash');
      }
      L.shown = v;
    }
    L.el.classList.toggle('turn', active === c);
    L.el.style.visibility = view.solo && !view.players[c] ? 'hidden' : '';
  }

  function renderCards(active) {
    cards.innerHTML = '';
    const extra = Math.max(view.balls.red.length, view.balls.blue.length) - view.perGame;
    for (const c of COLORS) {
      if (view.solo && !view.players[c]) continue; // a solo run has one card
      const row = document.createElement('div');
      row.className = 'sk-card';
      const who = document.createElement('span');
      who.className = 'who';
      who.style.color = TEXT_COLOR[c];
      who.textContent = c.toUpperCase();
      row.appendChild(who);
      const slots = view.perGame + Math.max(0, extra);
      for (let i = 0; i < slots; i++) {
        const cell = document.createElement('span');
        cell.className = `sk-cell${i % view.perTurn === 0 && i > 0 && i <= view.perGame ? ' gap' : ''}${i >= view.perGame ? ' sd' : ''}`;
        if (i < revealed[c]) {
          const p = view.balls[c][i];
          cell.textContent = p ? String(p) : '–';
          cell.style.color = PTS_COLOR[p];
        } else if (active === c && i === revealed[c] && view.phase === 'playing') cell.classList.add('next');
        row.appendChild(cell);
      }
      const tot = document.createElement('span');
      tot.className = 'sk-cell tot';
      tot.style.color = TEXT_COLOR[c];
      tot.textContent = String(shownTotal(c));
      row.appendChild(tot);
      cards.appendChild(row);
    }
  }

  function renderDom() {
    if (destroyed) return;
    const seat = mySeat();
    const over = view && view.phase === 'game_over' && !anim && !queue.length;
    results.update(over && view.solo ? {
      title: `${view.totals[view.winner]} POINTS`,
      subtitle: `SOLO · 100s: ${view.balls[view.winner].filter((p) => p === 100).length}`,
      outcome: 'win',
      rows: [{ name: nicknameFor(view.players[view.winner]), value: `${view.totals[view.winner]}`, win: true, you: view.winner === seat }],
      rematch: seat ? { label: 'ROLL AGAIN', onClick: () => api.sendAction({ kind: 'resetGame' }) } : null,
    } : over ? duelResults({
      winner: view.winner, colors: COLORS, players: view.players, me: seat, nameFor: nicknameFor,
      subtitle: COLORS.map((c) => `${c.toUpperCase()} ${view.totals[c]}`).join(' · ')
        + ` · 100s: ${COLORS.map((c) => view.balls[c].filter((p) => p === 100).length).join('/')}`,
      onRematch: () => api.sendAction({ kind: 'resetGame' }),
    }) : null);
    if (!view) {
      status.textContent = 'Loading...';
      return;
    }
    const active = anim ? anim.rec.by : view.phase === 'playing' ? view.turn : null;
    status.className = 'sk-status';
    status.style.color = '';
    const ballNo = active ? (anim ? anim.rec.ball : view.balls[active].length + 1) : 0;
    const sd = ballNo > view.perGame;
    const ballTxt = sd ? 'SUDDEN DEATH' : `ball ${ballNo} of ${view.perGame}`;
    if (view.phase === 'waiting') {
      status.textContent = seat ? 'ROLL SOLO for a high score, or wait for an opponent / play a bot.' : 'Waiting for both seats to be filled.';
    } else if (over && view.solo) {
      status.textContent = `GAME OVER: ${view.totals[view.winner]} POINTS`;
      status.style.color = '#ffb000';
    } else if (over) {
      status.textContent = view.winner === 'draw' ? `DRAW. ${view.totals.red} all` : `${view.winner.toUpperCase()} WINS ${view.totals[view.winner]} – ${view.totals[view.winner === 'red' ? 'blue' : 'red']}!`;
      status.style.color = '#ffb000';
    } else if (seat && active === seat) {
      status.textContent = `▶ YOUR ROLL. ${ballTxt}`;
      status.classList.add('mine');
    } else if (active) {
      status.textContent = `${active.toUpperCase()} ROLLING. ${nicknameFor(view.players[active])} · ${ballTxt}`;
      status.style.color = TEXT_COLOR[active];
    }
    err.textContent = flashError ? REJECT_MESSAGES[flashError] || 'Roll rejected' : '';
    renderSeats();
    for (const c of COLORS) renderLed(c, active);
    const midTxt = view.phase === 'playing' && active
      ? (sd ? 'SUDDEN\nDEATH' : `ROUND ${Math.min(3, Math.floor((ballNo - 1) / view.perTurn) + 1)}/3\nBALL ${((ballNo - 1) % view.perTurn) + 1}/${view.perTurn}`)
      : '';
    if (mid.textContent !== midTxt) { mid.textContent = midTxt; mid.style.whiteSpace = 'pre'; }
    renderCards(active);
    const cr = canRoll();
    stage.classList.toggle('can-roll', cr);
    const h = cr ? 'DRAG UP & RELEASE TO ROLL' : '';
    if (hint.textContent !== h) hint.textContent = h;
  }

  // ---- boot ----
  Promise.all([loadScript('games/slope/three.min.js', 'THREE'), loadScript('games/skeeball/sim.js', 'SkeeBallSim')])
    .then(([THREE, Sim]) => {
      if (destroyed) return;
      S = Sim;
      try {
        G = createScene(THREE, S, canvas);
      } catch (e) {
        stage.innerHTML = '<div class="sk-fail">3D graphics (WebGL) are not available in this browser.</div>';
        return;
      }
      raf = requestAnimationFrame(frame);
      renderDom();
    })
    .catch(() => {
      stage.innerHTML = '<div class="sk-fail">Could not load the 3D engine.</div>';
    });

  renderDom();

  function applyState(data, fromSnapshot) {
    const prev = view;
    view = data;
    clock.sync(data.serverNow);
    if (fromSnapshot || !prev || prev.gameId !== data.gameId) {
      anim = null;
      queue.length = 0;
      localPending = null;
      lastSeqSeen = data.lastRoll ? data.lastRoll.seq : 0;
      revealAll();
      if (prev && prev.phase !== 'playing' && data.phase === 'playing') sfx.play('go');
    } else if (data.lastRoll && data.lastRoll.seq > lastSeqSeen) {
      onNewRoll(data.lastRoll);
    } else if (!anim && !queue.length) {
      revealAll();
    }
    if (prev && !prev.winner && data.winner) {
      const seat = mySeat();
      const left = anim ? Math.max(0, (anim.rec.frames.length + HOLD_FRAMES) * FRAME_MS - (performance.now() - anim.start)) : 0;
      setTimeout(() => sfx.play(!seat || data.winner === 'draw' ? 'point' : data.winner === seat ? 'win' : 'lose'), left + 400);
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
        if (anim && anim.local) {
          anim = null;
          localPending = null;
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
