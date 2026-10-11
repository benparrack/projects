// Bowling client. Three.js lane (three.min.js shared with Slope) + the shared roll physics
// (sim.js). The camera stands behind the bowler, rides down the lane with the ball and holds on
// the pin deck while the pins fly, then swings back for the next ball.
//
// On your turn: drag sideways to slide the ball along the foul line, then swipe up and let go to
// roll it — the swipe's direction aims, its speed sets the ball speed and the bend of the swipe
// puts hook on it (curve the swipe the way you want the ball to break). Your own roll starts at
// once from a local run of the same sim; the server's authoritative frames (identical in
// practice) take over when they arrive. Everyone else replays the server's frames.

import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect, levelLabel } from '../botLevel.js';
import { createResults } from '../resultsPanel.js';
import { makeServerClock } from '../serverClock.js';

const SEATS = ['p1', 'p2'];
const SEAT_COLOR = { p1: '#3ad7ff', p2: '#ff5ad1' };
const BALL_COLORS = { p1: ['#0b3d91', '#3ad7ff', '#0a1f4d'], p2: ['#7a0b5a', '#ff5ad1', '#3d0630'] };
const HOLD_FRAMES = 20; // result on show after the pins settle
const SWEEP_FRAMES = 16; // sweep / re-rack animation
const REJECT_MESSAGES = {
  not_your_turn: "It's not your turn.",
  busy: 'Wait for the pins to be reset.',
  not_playing: 'The game is not running.',
  invalid: 'Invalid roll.',
};

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

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

const CSS = `
.bw-root { display: flex; flex-direction: column; align-items: center; gap: 8px; font-family: monospace; color: #b8ffb0; width: 100%; }
.bw-status { font-size: 15px; font-weight: bold; letter-spacing: 1px; text-align: center; min-height: 20px; }
.bw-status.mine { color: #39ff14 !important; text-shadow: 0 0 8px #39ff14; }
.bw-err { color: #ff5a5a; font-size: 12px; min-height: 14px; }
.bw-seats { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; }
.bw-seat { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid #1d5c1d; border-radius: 6px; background: #071107; font-size: 13px; }
.bw-seat.turn { border-color: #39ff14; box-shadow: 0 0 10px -2px #39ff14; }
.bw-seat button, .bw-row button { font: inherit; font-size: 12px; }
.bw-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; box-shadow: 0 0 6px currentColor; }
.bw-stage { position: relative; width: min(100%, 560px); aspect-ratio: 5 / 6; max-height: 70vh; border: 1px solid #1d5c1d; border-radius: 10px; overflow: hidden;
  background: radial-gradient(circle at 50% 30%, #101a26, #020406 75%); touch-action: none; user-select: none; -webkit-user-select: none; }
.bw-stage canvas { display: block; width: 100%; height: 100%; }
.bw-stage.can-roll { cursor: grab; } .bw-stage.dragging { cursor: grabbing; }
.bw-stage.flash::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(circle at 50% 40%, rgba(255,255,255,.35), rgba(57,255,20,.08) 60%, transparent);
  animation: bw-flash .6s ease-out forwards; }
@keyframes bw-flash { from { opacity: 1; } to { opacity: 0; } }
.bw-hud { position: absolute; left: 0; right: 0; top: 0; display: flex; justify-content: space-between; align-items: flex-start; padding: 8px 10px; pointer-events: none; font-size: 13px; text-shadow: 0 1px 2px #000; }
.bw-frameinfo { font-weight: bold; line-height: 1.35; }
.bw-frameinfo .big { font-size: 15px; letter-spacing: 1px; }
.bw-rack { position: relative; width: 74px; height: 62px; }
.bw-rack span { position: absolute; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px; border-radius: 50%; background: #f4f8f4; box-shadow: 0 0 6px rgba(255,255,255,.7); transition: background .25s, box-shadow .25s, transform .25s; }
.bw-rack span.down { background: #1d2a1d; box-shadow: inset 0 0 0 1px #3a5a3a; transform: scale(.8); }
.bw-power { position: absolute; right: 12px; top: 50%; width: 12px; height: 42%; transform: translateY(-50%); border: 1px solid #39ff14; border-radius: 6px; background: rgba(0,0,0,.45); overflow: hidden; pointer-events: none; opacity: 0; transition: opacity .15s; }
.bw-power.on { opacity: 1; }
.bw-power > div { position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(0deg, #39ff14, #ffe14d 60%, #ff4d4d); }
.bw-spin { position: absolute; left: 12px; bottom: 54px; font-size: 12px; font-weight: bold; color: #ffe14d; pointer-events: none; opacity: 0; transition: opacity .15s; text-shadow: 0 0 6px #000; }
.bw-spin.on { opacity: 1; }
.bw-hint { position: absolute; left: 0; right: 0; bottom: 14px; text-align: center; font-size: 12px; color: #9fdc98; pointer-events: none; text-shadow: 0 1px 2px #000; animation: bw-hint 1.6s ease-in-out infinite alternate; }
@keyframes bw-hint { from { opacity: .45; } to { opacity: 1; } }
.bw-callout { position: absolute; left: 50%; top: 34%; transform: translate(-50%, -50%); font-size: 34px; font-weight: bold; letter-spacing: 3px; white-space: nowrap; pointer-events: none;
  text-shadow: 0 0 14px currentColor, 0 2px 3px #000; animation: bw-call 1.6s cubic-bezier(.2,1.4,.4,1) forwards; }
.bw-callout.small { font-size: 20px; top: 42%; }
.bw-callout.sub { font-size: 14px; top: 44%; letter-spacing: 2px; animation-delay: .12s; animation-fill-mode: both; }
@keyframes bw-call { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.4); } 15% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
  25% { transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -75%) scale(1); } }
.bw-card { width: min(100%, 560px); overflow-x: auto; }
.bw-card table { border-collapse: collapse; width: 100%; min-width: 470px; font-size: 12px; table-layout: fixed; }
.bw-card th, .bw-card td { border: 1px solid #1d5c1d; text-align: center; padding: 0; }
.bw-card th { font-weight: normal; color: #6fa86a; font-size: 10px; padding: 2px 0; }
.bw-card th.name, .bw-card td.name { width: 76px; text-align: left; padding: 0 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bw-card th.tot, .bw-card td.tot { width: 44px; }
.bw-card col.f10 { width: 13%; }
.bw-card td.fr { vertical-align: top; height: 36px; background: #050c05; }
.bw-card td.fr.cur { background: #0b1f0b; box-shadow: inset 0 0 0 1px #39ff14; }
.bw-card .marks { display: flex; justify-content: flex-end; height: 16px; }
.bw-card .marks span { width: 15px; height: 15px; line-height: 15px; border-left: 1px solid #1d5c1d; border-bottom: 1px solid #1d5c1d; font-weight: bold; }
.bw-card .marks span.x { color: #ffe14d; text-shadow: 0 0 6px #ffb000; }
.bw-card .marks span.s { color: #39ff14; }
.bw-card .cum { height: 18px; line-height: 18px; font-weight: bold; color: #d8ffd0; }
.bw-card td.tot { font-size: 15px; font-weight: bold; }
.bw-card tr.turn td.name { box-shadow: inset 3px 0 0 #39ff14; }
.bw-row { display: flex; gap: 8px; align-items: center; justify-content: center; flex-wrap: wrap; font-size: 12px; }
.bw-help { font-size: 11px; opacity: .7; text-align: center; max-width: 520px; }
.bw-fail { padding: 30px; text-align: center; color: #ff8080; }
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
// Lane boards from the foul line (canvas bottom) to the end of the pin deck (canvas top).
function laneTexture(THREE, S, len) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 4096;
  const g = c.getContext('2d');
  const W = c.width;
  const H = c.height;
  const zy = (z) => H * (1 - z / len);
  const xp = (x) => ((x + S.LANE_HALF) / (2 * S.LANE_HALF)) * W;
  const boards = 39;
  const bw = W / boards;
  for (let i = 0; i < boards; i++) {
    const t = (i * 7919) % 13;
    g.fillStyle = `hsl(${28 + (t % 5)}, ${38 + (t % 4) * 3}%, ${30 + (t % 6) * 1.6}%)`;
    g.fillRect(i * bw, 0, bw + 0.5, H);
  }
  // pine back end is a touch lighter; the pin deck lighter still
  g.fillStyle = 'rgba(255,220,170,0.06)';
  g.fillRect(0, 0, W, zy(S.PIN_Z0 - 4));
  g.fillStyle = 'rgba(255,230,190,0.16)';
  g.fillRect(0, 0, W, zy(S.PIN_Z0 - 0.35));
  // grain
  for (let k = 0; k < 900; k++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? '40,20,5' : '255,230,190'},${0.05 + Math.random() * 0.08})`;
    g.lineWidth = 0.6 + Math.random();
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + Math.random() * 2 - 1, y + 40, x + Math.random() * 2 - 1, y + 90, x + Math.random() * 3 - 1.5, y + 140 + Math.random() * 120);
    g.stroke();
  }
  // board seams
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let i = 1; i < boards; i++) g.fillRect(i * bw - 0.5, 0, 1, H);
  // oil sheen on the front half
  const oil = g.createLinearGradient(0, zy(0), 0, zy(12));
  oil.addColorStop(0, 'rgba(255,255,255,0.10)');
  oil.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = oil;
  g.fillRect(xp(-0.4), zy(12), xp(0.4) - xp(-0.4), zy(0) - zy(12));
  // neon guides: dots at 7 ft, arrows in a V around 15 ft
  g.shadowColor = '#39ff14';
  g.shadowBlur = 10;
  g.fillStyle = '#39ff14';
  for (const b of [3, 5, 8, 11, 14]) {
    for (const s of [-1, 1]) {
      const x = W / 2 + s * (19.5 - b) * bw;
      g.beginPath();
      g.arc(x, zy(2.13), 2.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (const b of [5, 10, 15, 20]) {
    for (const s of b === 20 ? [0] : [-1, 1]) {
      const x = W / 2 + s * (20 - b) * bw;
      const z = 3.66 + (b / 20) * 1.22; // the centre arrow sits furthest down the lane
      const y = zy(z);
      g.beginPath();
      g.moveTo(x, y - 46);
      g.lineTo(x + bw * 0.9, y);
      g.lineTo(x - bw * 0.9, y);
      g.closePath();
      g.fill();
    }
  }
  // pin spots
  g.shadowBlur = 0;
  for (const id of Object.keys(S.SPOTS)) {
    const p = S.SPOTS[id];
    g.strokeStyle = 'rgba(40,20,0,0.5)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(xp(p.x), zy(p.z), 9, 0, Math.PI * 2);
    g.stroke();
  }
  // foul line
  g.shadowColor = '#ff3b3b';
  g.shadowBlur = 12;
  g.fillStyle = '#ff4d4d';
  g.fillRect(0, H - 12, W, 7);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

function approachTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < 20; i++) {
    g.fillStyle = `hsl(28, 30%, ${20 + (i % 3) * 2}%)`;
    g.fillRect(i * 6.4, 0, 7, 256);
  }
  g.fillStyle = '#39ff14';
  g.shadowColor = '#39ff14';
  g.shadowBlur = 6;
  for (const row of [60, 150]) for (const x of [20, 42, 64, 86, 108]) { g.beginPath(); g.arc(x, row, 2.4, 0, Math.PI * 2); g.fill(); }
  return new THREE.CanvasTexture(c);
}

function pinTexture(THREE, vNeckLo, vNeckHi) {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(1, '#e8e6df');
  g.fillStyle = gr;
  g.fillRect(0, 0, 16, 256);
  const y = (v) => 256 * (1 - v);
  g.fillStyle = '#d4162c';
  const h = y(vNeckLo) - y(vNeckHi);
  g.fillRect(0, y(vNeckHi), 16, h * 0.32);
  g.fillRect(0, y(vNeckHi) + h * 0.62, 16, h * 0.32);
  return new THREE.CanvasTexture(c);
}

function ballTexture(THREE, [dark, light, deep]) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = dark;
  g.fillRect(0, 0, 256, 128);
  // marbled swirls
  for (let k = 0; k < 26; k++) {
    g.strokeStyle = k % 3 === 0 ? light : deep;
    g.globalAlpha = 0.25 + Math.random() * 0.35;
    g.lineWidth = 2 + Math.random() * 7;
    g.beginPath();
    let x = Math.random() * 256;
    let yy = Math.random() * 128;
    g.moveTo(x, yy);
    for (let s = 0; s < 4; s++) {
      const nx = x + (Math.random() - 0.3) * 90;
      const ny = yy + (Math.random() - 0.5) * 50;
      g.quadraticCurveTo((x + nx) / 2 + (Math.random() - 0.5) * 50, (yy + ny) / 2 + (Math.random() - 0.5) * 40, nx, ny);
      x = nx; yy = ny;
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  // finger holes
  g.fillStyle = '#050505';
  for (const [hx, hy, r] of [[60, 38, 6], [76, 38, 6], [68, 58, 7.5]]) { g.beginPath(); g.ellipse(hx, hy, r, r * 1.6, 0, 0, Math.PI * 2); g.fill(); }
  return new THREE.CanvasTexture(c);
}

function maskTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#04110a');
  gr.addColorStop(1, '#0a2414');
  g.fillStyle = gr;
  g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = '#39ff14';
  g.shadowColor = '#39ff14';
  g.shadowBlur = 18;
  g.lineWidth = 6;
  g.strokeRect(10, 10, 1004, 236);
  g.fillStyle = '#39ff14';
  g.font = 'bold 92px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('GAME TERMINAL', 512, 112);
  g.font = 'bold 40px monospace';
  g.fillStyle = '#3ad7ff';
  g.shadowColor = '#3ad7ff';
  g.fillText('· LANE 1 ·', 512, 196);
  return new THREE.CanvasTexture(c);
}

function blobTexture(THREE) {
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

// ---- the 3D scene ----------------------------------------------------------------------------
// World = sim with z flipped: (x, y, -z), so the lane runs away from the camera along -z and
// screen-right is the bowler's right.
function createScene(THREE, S, canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if ('outputEncoding' in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x03060a, 14, 34);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);

  const LEN = S.DECK_END;
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x1a120a, 0.7));
  const key = new THREE.DirectionalLight(0xfff2dd, 0.55);
  key.position.set(1.5, 6, 2);
  key.target.position.set(0, 0, -10);
  scene.add(key, key.target);
  const spot = new THREE.SpotLight(0xffffff, 1.4, 9, 0.75, 0.5, 1);
  spot.position.set(0, 3.6, -(S.PIN_Z0 - 1.2));
  spot.target.position.set(0, 0, -(S.PIN_Z0 + 0.45));
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.camera.near = 1;
  spot.shadow.camera.far = 7;
  scene.add(spot, spot.target);
  const neon = new THREE.PointLight(0x39ff14, 0.5, 5);
  neon.position.set(0, 1.0, -(S.PIN_Z0 - 0.8));
  scene.add(neon);

  // lane + approach + neighbouring lanes
  const laneTex = laneTexture(THREE, S, LEN);
  const laneMat = new THREE.MeshStandardMaterial({ map: laneTex, roughness: 0.28, metalness: 0.08 });
  const laneGeo = new THREE.PlaneGeometry(S.LANE_HALF * 2, LEN);
  const mkLane = (x, mat) => {
    const m = new THREE.Mesh(laneGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0, -LEN / 2);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  mkLane(0, laneMat);
  const pitch = S.LANE_HALF * 2 + S.GUTTER_W * 2 + 0.16;
  const dimLane = new THREE.MeshStandardMaterial({ map: laneTex, roughness: 0.4, color: 0x6a6a6a });
  mkLane(-pitch, dimLane);
  mkLane(pitch, dimLane);
  const appr = new THREE.Mesh(new THREE.PlaneGeometry(pitch * 3, 5), new THREE.MeshStandardMaterial({ map: approachTexture(THREE), roughness: 0.5 }));
  appr.rotation.x = -Math.PI / 2;
  appr.position.set(0, -0.001, 2.5);
  scene.add(appr);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 60), new THREE.MeshStandardMaterial({ color: 0x05080c, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.12, -20);
  scene.add(floor);

  // gutters (half pipes) and the capping between lanes
  const gutterGeo = new THREE.CylinderGeometry(S.GUTTER_W / 2, S.GUTTER_W / 2, LEN + 0.4, 18, 1, true, -Math.PI / 2, Math.PI);
  gutterGeo.rotateX(Math.PI / 2);
  const gutterMat = new THREE.MeshStandardMaterial({ color: 0x1b2128, roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x0b0f14, roughness: 0.6 });
  const stripMat = new THREE.MeshBasicMaterial({ color: 0x39ff14 });
  for (const lane of [-pitch, 0, pitch]) {
    for (const s of [-1, 1]) {
      const gm = new THREE.Mesh(gutterGeo, gutterMat);
      gm.position.set(lane + s * (S.LANE_HALF + S.GUTTER_W / 2), 0.0, -(LEN + 0.4) / 2);
      scene.add(gm);
    }
  }
  for (const s of [-1, 1]) {
    const x = s * (S.LANE_HALF + S.GUTTER_W + 0.08);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, LEN + 3), capMat);
    cap.position.set(x, 0.0, -(LEN + 3) / 2 + 2.5);
    scene.add(cap);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, LEN + 3), stripMat);
    strip.position.set(x, 0.03, -(LEN + 3) / 2 + 2.5);
    scene.add(strip);
    // kickbacks beside the deck
    const kick = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, S.PIT_Z - S.PIN_Z0 + 1.4), new THREE.MeshStandardMaterial({ color: 0x10161d, roughness: 0.5, metalness: 0.3 }));
    kick.position.set(s * (S.KICK_X + 0.025), 0.27, -((S.PIN_Z0 - 1 + S.PIT_Z + 0.4) / 2));
    kick.receiveShadow = true;
    scene.add(kick);
    const kstrip = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, S.PIT_Z - S.PIN_Z0 + 1.4), new THREE.MeshBasicMaterial({ color: 0x3ad7ff }));
    kstrip.position.set(s * (S.KICK_X + 0.0), 0.54, kick.position.z);
    scene.add(kstrip);
  }
  // pit + back curtain + masking unit
  const pit = new THREE.Mesh(new THREE.BoxGeometry(S.KICK_X * 2, 0.3, 1.2), new THREE.MeshBasicMaterial({ color: 0x010203 }));
  pit.position.set(0, -0.16, -(S.PIT_Z + 0.55));
  scene.add(pit);
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(S.KICK_X * 2 + 0.2, 1.3), new THREE.MeshStandardMaterial({ color: 0x06090d, roughness: 1 }));
  curtain.position.set(0, 0.5, -(S.PIT_Z + 1.1));
  scene.add(curtain);
  const mask = new THREE.Mesh(new THREE.PlaneGeometry(S.KICK_X * 2 + 0.3, 0.5), new THREE.MeshBasicMaterial({ map: maskTexture(THREE) }));
  mask.position.set(0, 1.32, -(S.PIN_Z0 - 0.7));
  scene.add(mask);

  // pins: lathe-turned, with the classic red neck stripes
  const prof = [[0.0001, 0], [0.026, 0], [0.036, 0.02], [0.052, 0.07], [0.0605, 0.115], [0.057, 0.155], [0.045, 0.2],
    [0.031, 0.235], [0.0235, 0.258], [0.0225, 0.272], [0.0245, 0.29], [0.0285, 0.325], [0.028, 0.35], [0.021, 0.371], [0.009, 0.38], [0.0001, 0.381]];
  const pinGeo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 24);
  const vOf = (i) => i / (prof.length - 1);
  const pinMat = new THREE.MeshStandardMaterial({ map: pinTexture(THREE, vOf(7), vOf(10)), roughness: 0.25, metalness: 0.05 });
  function makePin() {
    const m = new THREE.Mesh(pinGeo, pinMat.clone());
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  const ballMats = {};
  for (const s of SEATS) ballMats[s] = new THREE.MeshStandardMaterial({ map: ballTexture(THREE, BALL_COLORS[s]), roughness: 0.18, metalness: 0.25 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(S.BALL_R, 32, 20), ballMats.p1);
  ball.castShadow = true;
  scene.add(ball);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(S.BALL_R * 3.2, S.BALL_R * 3.2),
    new THREE.MeshBasicMaterial({ map: blobTexture(THREE), transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  scene.add(blob);

  // aim guide: glowing dots along the launch line
  const dots = [];
  const dotGeo = new THREE.CircleGeometry(0.02, 12);
  dotGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < 14; i++) {
    const d = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0x39ff14, transparent: true, opacity: 0.8, depthWrite: false }));
    d.visible = false;
    scene.add(d);
    dots.push(d);
  }
  // sparks for strikes
  const sparks = [];
  const sparkGeo = new THREE.SphereGeometry(0.012, 6, 4);
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: i % 3 ? 0x39ff14 : 0xffe14d, transparent: true }));
    m.visible = false;
    m.userData.v = new THREE.Vector3();
    scene.add(m);
    sparks.push(m);
  }

  return { renderer, scene, camera, makePin, ball, ballMats, blob, dots, sparks, THREE };
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
  root.className = 'bw-root';
  container.appendChild(root);
  const results = createResults(container);

  const status = document.createElement('div');
  status.className = 'bw-status';
  const err = document.createElement('div');
  err.className = 'bw-err';
  const seats = document.createElement('div');
  seats.className = 'bw-seats';
  const stage = document.createElement('div');
  stage.className = 'bw-stage';
  const canvas = document.createElement('canvas');
  const hud = document.createElement('div');
  hud.className = 'bw-hud';
  const frameInfo = document.createElement('div');
  frameInfo.className = 'bw-frameinfo';
  const rackEl = document.createElement('div');
  rackEl.className = 'bw-rack';
  const rackDots = {};
  hud.append(frameInfo, rackEl);
  const power = document.createElement('div');
  power.className = 'bw-power';
  const powerFill = document.createElement('div');
  power.appendChild(powerFill);
  const spinEl = document.createElement('div');
  spinEl.className = 'bw-spin';
  const hint = document.createElement('div');
  hint.className = 'bw-hint';
  stage.append(canvas, hud, power, spinEl, hint);
  const cardEl = document.createElement('div');
  cardEl.className = 'bw-card';
  const options = document.createElement('div');
  options.className = 'bw-row';
  const help = document.createElement('div');
  help.className = 'bw-help';
  help.textContent = 'Drag sideways to line up on the foul line, then swipe up and let go — direction aims, swipe speed sets ball speed, and curving the swipe puts hook on the ball. Ten frames; strikes and spares score bonus balls.';
  root.append(status, err, seats, stage, cardEl, options, help);

  // ---- helpers ----
  function nicknameFor(id, seat) {
    if (!id) return null;
    if (id === 'BOT') return `BOT (${levelLabel(((view && view.botLevels) || {})[seat])})`;
    const e = roster.find((r) => r.clientId === id);
    return e ? e.nickname : 'someone';
  }
  const seatName = (seat) => (view && nicknameFor(view.players[seat], seat)) || seat.toUpperCase();
  function mySeat() {
    if (!view) return null;
    const me = api.getClientId();
    return view.players.p1 === me ? 'p1' : view.players.p2 === me ? 'p2' : null;
  }

  // ---- animation state ----
  const pinMeshes = new Map(); // id -> { mesh, x, z, fade }
  const queue = []; // throw records waiting to play
  let anim = null; // { rec, start, fired:Set, local, ended }
  let localPending = null;
  let lastSeqSeen = 0;
  let shown = null; // { rolls, turn, frame, ball, pins } — what the scoreboard / HUD shows
  let aimX = 0; // ball position on the foul line, [-1, 1]
  let drag = null;
  let lastRumble = 0;
  const cam = { x: 0, y: 1.3, z: 2.0, lx: 0, ly: 0.05, lz: -14, init: false };
  const ballSpin = { q: null, px: 0, pz: 0 };

  function shownFromView() {
    if (!view) return null;
    return { rolls: view.rolls, turn: view.turn, frame: view.frame, ball: view.ball, pins: view.pins, totals: view.totals, phase: view.phase };
  }

  // Place pin meshes for a standing set (instant), dropping any others.
  function setPins(list) {
    if (!G) return;
    const keep = new Set(list.map((p) => p.id));
    for (const [id, e] of pinMeshes) {
      if (!keep.has(id)) { G.scene.remove(e.mesh); pinMeshes.delete(id); }
    }
    for (const p of list) {
      let e = pinMeshes.get(p.id);
      if (!e) {
        const mesh = G.makePin();
        G.scene.add(mesh);
        e = { mesh };
        pinMeshes.set(p.id, e);
      }
      e.mesh.visible = true;
      e.mesh.position.set(p.x, 0, -p.z);
      e.mesh.quaternion.identity();
      e.mesh.scale.set(1, 1, 1);
      e.mesh.material.opacity = 1;
      if (e.mesh.material.transparent) { e.mesh.material.transparent = false; e.mesh.material.needsUpdate = true; }
      e.base = { x: p.x, z: p.z };
    }
  }

  function rackHud(standingIds) {
    if (!S) return;
    if (!rackEl.childElementCount) {
      for (const id of Object.keys(S.SPOTS)) {
        const p = S.SPOTS[id];
        const d = document.createElement('span');
        d.style.left = `${37 + (p.x / S.PIN_SP) * 18}px`;
        d.style.top = `${54 - ((p.z - S.PIN_Z0) / S.ROW_DZ) * 16}px`;
        rackEl.appendChild(d);
        rackDots[id] = d;
      }
    }
    const up = new Set(standingIds);
    for (const id of Object.keys(rackDots)) rackDots[id].classList.toggle('down', !up.has(Number(id)));
  }

  function callout(text, color, cls) {
    if (reduced() && cls === 'sub') return;
    const el = document.createElement('div');
    el.className = `bw-callout${cls ? ` ${cls}` : ''}`;
    el.style.color = color || '#39ff14';
    el.textContent = text;
    stage.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  function burst() {
    if (!G || reduced()) return;
    stage.classList.remove('flash');
    void stage.offsetWidth; // restart the flash animation
    stage.classList.add('flash');
    for (const s of G.sparks) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 1.6;
      s.position.set((Math.random() - 0.5) * 0.6, 0.2 + Math.random() * 0.3, -(S.PIN_Z0 + 0.4 + (Math.random() - 0.5) * 0.4));
      s.userData.v.set(Math.cos(a) * sp, 1.2 + Math.random() * 2.2, Math.sin(a) * sp * 0.6);
      s.userData.life = 1;
      s.visible = true;
    }
  }

  function startAnim(rec, start, local) {
    anim = { rec, start, fired: new Set(), local, ended: false };
    setPins(rec.before);
    G.ball.material = G.ballMats[rec.by] || G.ballMats.p1;
    if (!local) sfx.play('whoosh', { vol: 0.5 });
  }

  function resultCallout(rec) {
    const mine = rec.by === mySeat();
    const col = SEAT_COLOR[rec.by];
    if (rec.mark === 'strike') {
      callout('STRIKE!', '#ffe14d');
      burst();
      sfx.play('kill');
      setTimeout(() => sfx.play('chime'), 180);
    } else if (rec.mark === 'spare') {
      callout('SPARE!', '#39ff14');
      sfx.play('chime');
      setTimeout(() => sfx.play('point'), 120);
    } else if (rec.mark === 'gutter') {
      callout('GUTTER BALL', '#9fb39c', 'small');
      sfx.play('beep');
    } else if (rec.count === 0) {
      callout('MISS', '#9fb39c', 'small');
    } else {
      callout(`${rec.count} PIN${rec.count === 1 ? '' : 'S'}`, mine ? '#39ff14' : col, 'small');
      if (rec.split) setTimeout(() => callout('SPLIT!', '#ff7a3a', 'sub'), 150);
    }
  }

  function finishAnim() {
    const rec = anim.rec;
    anim = null;
    shown = {
      rolls: rec.rollsAfter,
      totals: null,
      turn: null,
      frame: null,
      ball: null,
      pins: rec.pinsAfter,
      phase: null,
    };
    if (queue.length) {
      const next = queue.shift();
      startAnim(next, performance.now(), false);
    } else {
      shown = shownFromView();
      setPins(view.pins);
      const seat = mySeat();
      if (rec.turnOver && view.phase === 'playing' && seat && view.turn === seat) setTimeout(() => sfx.play('turn'), 150);
    }
    renderDom();
  }

  function onNewThrow(rec) {
    if (rec.seq <= lastSeqSeen) return;
    lastSeqSeen = rec.seq;
    if (anim && anim.local && localPending && rec.by === mySeat()) {
      // our own roll is already on the lane from the local prediction: swap in the server's
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
  function canRoll() {
    const seat = mySeat();
    return !!(G && view && seat && view.phase === 'playing' && view.turn === seat && !anim && !queue.length
      && !localPending && clock.now() >= view.busyUntil - 150);
  }

  // Swipe -> roll input. pts: [{x, y, t}] from where the swipe began.
  function swipeInput(pts) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    const cx = b.x - a.x;
    const cy = a.y - b.y; // up = positive
    const len = Math.hypot(cx, cy);
    if (len < 1) return null;
    const ang = Math.atan2(cx, cy);
    // bend: biggest sideways bulge of the path off the straight chord (+ = right of it)
    const ux = cx / len;
    const uy = -cy / len; // chord direction in screen space (y down)
    let bulge = 0;
    for (const p of pts) {
      const off = (p.x - a.x) * -uy + (p.y - a.y) * ux;
      if (Math.abs(off) > Math.abs(bulge)) bulge = off;
    }
    const bend = bulge / len;
    // a swipe that bows out left and comes back right is curving right: hook right
    let spin = Math.abs(bend) < 0.03 ? 0 : clamp(-bend / 0.22, -1, 1);
    spin = Math.round(spin * 100) / 100;
    // speed over the last ~110 ms
    const h = stage.clientHeight || 500;
    let k = pts.length - 1;
    while (k > 0 && b.t - pts[k - 1].t < 110) k--;
    const p0 = pts[Math.max(0, k - 1)];
    const dt = Math.max(16, b.t - p0.t);
    const v = (Math.hypot(b.x - p0.x, b.y - p0.y) / dt) * 1000 / h; // stage-heights per second
    const pw = clamp((v - 0.7) / 3.3, 0, 1);
    return { x: aimX, aim: clamp(ang / 0.6, -1, 1), power: pw, spin, len };
  }

  stage.addEventListener('pointerdown', (e) => {
    if (!canRoll() || drag) return;
    e.preventDefault();
    try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), mode: 'pos', pos0: aimX, lastX: e.clientX, lastY: e.clientY, pts: [], input: null };
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const now = performance.now();
    if (drag.mode === 'pos') {
      const up = drag.lastY - e.clientY;
      const side = Math.abs(e.clientX - drag.lastX);
      if (up > 26 && up > side * 0.9) {
        drag.mode = 'swipe';
        if (now - drag.t0 < 200) aimX = drag.pos0; // a quick flick, not a reposition
        drag.pts.push({ x: drag.lastX, y: drag.lastY, t: now - 16 });
      } else {
        const w = stage.clientWidth || 500;
        aimX = clamp(drag.pos0 + (e.clientX - drag.x0) / (w * 0.42), -1, 1);
        if (up < 0 || side > 4) { drag.lastX = e.clientX; drag.lastY = Math.max(drag.lastY, e.clientY); }
        return;
      }
    }
    drag.pts.push({ x: e.clientX, y: e.clientY, t: now });
    const inp = swipeInput(drag.pts);
    if (inp) {
      drag.input = inp;
      power.classList.add('on');
      powerFill.style.height = `${Math.round(inp.power * 100)}%`;
      spinEl.classList.toggle('on', inp.spin !== 0);
      spinEl.textContent = inp.spin === 0 ? '' : `${inp.spin < 0 ? '↶ HOOK LEFT' : 'HOOK RIGHT ↷'} ${Math.round(Math.abs(inp.spin) * 100)}%`;
    }
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    stage.classList.remove('dragging');
    power.classList.remove('on');
    spinEl.classList.remove('on');
    if (e.type === 'pointercancel' || d.mode !== 'swipe') { renderDom(); return; }
    d.pts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    const inp = swipeInput(d.pts);
    if (!inp || inp.len < 45 || !canRoll()) { renderDom(); return; }
    const input = S.normInput(inp);
    const seat = mySeat();
    const res = S.simulate(view.pins, input);
    if (!res) return;
    localPending = { input, start: performance.now() };
    const rec = {
      seq: -1, by: seat, frame: view.frame, ball: view.ball, input, before: view.pins, frames: res.frames, pinFx: res.pins,
      events: res.events, knocked: res.knocked, count: res.knocked.length, gutter: res.gutter, mark: null, split: false,
      turnOver: false, freshNext: false, pinsAfter: res.standing, rollsAfter: view.rolls, local: true,
    };
    startAnim(rec, performance.now(), true);
    sfx.play('whoosh', { vol: 0.6 });
    api.sendAction({ kind: 'roll', x: input.x, aim: input.aim, power: input.power, spin: input.spin });
    renderDom();
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // ---- per-frame update ----
  function updateCamera(tx, ty, tz, lx, ly, lz, k) {
    if (!cam.init || reduced()) {
      Object.assign(cam, { x: tx, y: ty, z: tz, lx, ly, lz, init: true });
    } else {
      cam.x = lerp(cam.x, tx, k); cam.y = lerp(cam.y, ty, k); cam.z = lerp(cam.z, tz, k);
      cam.lx = lerp(cam.lx, lx, k); cam.ly = lerp(cam.ly, ly, k); cam.lz = lerp(cam.lz, lz, k);
    }
    G.camera.position.set(cam.x, cam.y, cam.z);
    G.camera.lookAt(cam.lx, cam.ly, cam.lz);
  }

  function rollBall(x, z) {
    // spin the ball about the axis perpendicular to its travel
    const { THREE, ball } = G;
    const dx = x - ballSpin.px;
    const dz = z - ballSpin.pz;
    const d = Math.hypot(dx, dz);
    if (d > 1e-5 && d < 1) {
      const axis = new THREE.Vector3(-dz, 0, -dx).normalize(); // world: travel is (dx, 0, -dz)
      const q = new THREE.Quaternion().setFromAxisAngle(axis, d / S.BALL_R);
      ball.quaternion.premultiply(q);
    }
    ballSpin.px = x;
    ballSpin.pz = z;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!G) return;
    const { THREE, camera, renderer, ball, blob } = G;
    const FRAME_MS = 1000 / S.FPS;
    let bx = aimX * S.START_MAX;
    let bz = -0.45;
    let by = S.BALL_R;
    let showBall = false;

    if (anim) {
      const rec = anim.rec;
      const f = Math.max(0, (now - anim.start) / FRAME_MS); // rAF's timestamp can predate anim.start
      const n = rec.frames.length;
      const i = Math.min(n - 1, Math.floor(f));
      const t = Math.min(1, Math.max(0, f - i));
      const a = rec.frames[i];
      const b = rec.frames[Math.min(n - 1, i + 1)];
      bx = a[0] + (b[0] - a[0]) * t;
      bz = a[1] + (b[1] - a[1]) * t;
      showBall = bz < S.PIT_Z + 0.3;
      if (Math.abs(bx) > S.LANE_HALF) by = S.BALL_R - 0.06; // down in the gutter
      if (bz > S.PIT_Z) by -= Math.min(0.3, (bz - S.PIT_Z) * 1.5);
      if (f < 1) { ballSpin.px = bx; ballSpin.pz = bz; }
      rollBall(bx, bz);
      if (showBall && now - lastRumble > 260 && bz < S.PIN_Z0) {
        lastRumble = now;
        sfx.play('slide', { vol: 0.28 });
      }

      // pins: positions from the frames, fall/out/wobble from the per-pin effects
      rec.before.forEach((p, k) => {
        const e = pinMeshes.get(p.id);
        if (!e) return;
        const px = a[2 + 2 * k] + (b[2 + 2 * k] - a[2 + 2 * k]) * t;
        const pz = a[3 + 2 * k] + (b[3 + 2 * k] - a[3 + 2 * k]) * t;
        const fx = rec.pinFx[k];
        let y = 0;
        e.mesh.quaternion.identity();
        if (fx.fallF >= 0 && f >= fx.fallF) {
          const ang = Math.min(Math.PI / 2, ((f - fx.fallF) / 6) * (Math.PI / 2));
          const axis = Math.hypot(fx.fx, fx.fz) > 1e-6 ? new THREE.Vector3(-fx.fz, 0, -fx.fx).normalize() : new THREE.Vector3(0, 0, -1); // perpendicular to (fx, -fz)
          e.mesh.quaternion.setFromAxisAngle(axis, ang);
          y = Math.sin(ang) * 0.058;
          // a lying pin tumbles a little as it slides
          if (ang >= Math.PI / 2) {
            const spinQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (f - fx.fallF) * 0.07 * (k % 2 ? 1 : -1));
            e.mesh.quaternion.premultiply(spinQ);
          }
        } else if (fx.wobF >= 0 && f >= fx.wobF) {
          const w = f - fx.wobF;
          const amp = 0.14 * Math.exp(-w * 0.09) * Math.sin(w * 0.9);
          e.mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0.4).normalize(), amp);
        }
        if (fx.outF >= 0 && f >= fx.outF) y -= Math.min(0.35, (f - fx.outF) * 0.03);
        e.mesh.position.set(px, y, -pz);
        e.mesh.visible = !(fx.outF >= 0 && f > fx.outF + 14);
      });

      for (const ev of rec.events) {
        const key = `${ev.f}:${ev.type}`;
        if (f >= ev.f && !anim.fired.has(key)) {
          anim.fired.add(key);
          if (ev.type === 'hit') { sfx.play('crash', { vol: 0.9 }); sfx.play('dice'); }
          else if (ev.type === 'clatter') sfx.play('dice', { vol: 0.7 });
          else if (ev.type === 'gutter') sfx.play('move', { vol: 0.8 });
        }
      }
      // result once the deck settles
      if (f >= n && !anim.ended && !anim.local) {
        anim.ended = true;
        resultCallout(rec);
        rackHud(rec.before.filter((p) => !rec.knocked.includes(p.id)).map((p) => p.id));
        renderDom();
      }
      // sweep: fallen pins sink away; a fresh rack drops in
      const sweepF = f - n - HOLD_FRAMES;
      if (sweepF > 0 && !anim.local) {
        const s = Math.min(1, sweepF / SWEEP_FRAMES);
        rec.before.forEach((p) => {
          const e = pinMeshes.get(p.id);
          if (!e) return;
          const gone = rec.knocked.includes(p.id) || rec.freshNext;
          if (gone) {
            if (!e.mesh.material.transparent) { e.mesh.material.transparent = true; e.mesh.material.needsUpdate = true; }
            e.mesh.material.opacity = 1 - s;
            e.mesh.position.y -= s * 0.05;
          }
        });
      }
      if (f > n + HOLD_FRAMES + SWEEP_FRAMES && !anim.local) finishAnim();
      else if (f > n + 300 && anim.local) { // the server never answered; drop the preview
        anim = null;
        localPending = null;
        setPins(view.pins);
        renderDom();
      }
      // camera rides with the ball, then holds on the deck
      const camZ = Math.min(bz - 3.4, S.PIN_Z0 - 4.6);
      const near = clamp((bz - 6) / (S.PIN_Z0 - 9), 0, 1);
      const cz = Math.max(-2.0, camZ);
      updateCamera(bx * 0.35, lerp(1.3, 0.82, near), -cz, bx * 0.3, 0.05, -Math.min(cz + 16, S.PIN_Z0 + 0.6), 0.14);
    } else {
      const seat = mySeat();
      showBall = !!(view && view.phase === 'playing');
      if (showBall) {
        G.ball.material = G.ballMats[seat && view.turn === seat ? seat : view.turn] || G.ballMats.p1;
        if (!(seat && view.turn === seat)) bx = 0;
        by = S.BALL_R + Math.sin(now / 400) * 0.004 * (canRoll() ? 1 : 0);
      }
      ballSpin.px = bx; ballSpin.pz = bz;
      updateCamera(bx * 0.25, 1.3, 2.0, bx * 0.08, 0.05, -14, 0.07);
    }

    ball.visible = showBall;
    ball.position.set(bx, by, -bz);
    blob.visible = showBall && Math.abs(bx) < S.LANE_HALF && bz < S.DECK_END;
    blob.position.set(bx, 0.002, -bz);

    // aim guide while swiping
    const guide = drag && drag.mode === 'swipe' && drag.input && drag.input.len > 20;
    if (guide) {
      const path = S.ballPath(S.normInput(drag.input), 6.5, 30);
      for (let k = 0; k < G.dots.length; k++) {
        const p = path[Math.min(path.length - 1, k + 1)];
        G.dots[k].visible = !!p && k + 1 < path.length;
        if (p) G.dots[k].position.set(p[0], 0.004, -p[1]);
        G.dots[k].material.opacity = 0.85 * (1 - k / G.dots.length);
      }
    } else for (const d of G.dots) d.visible = false;

    // sparks
    for (const s of G.sparks) {
      if (!s.visible) continue;
      s.userData.v.y -= 9.8 / 60;
      s.position.addScaledVector(s.userData.v, 1 / 60);
      s.userData.life -= 1 / 50;
      s.material.opacity = Math.max(0, s.userData.life);
      if (s.userData.life <= 0 || s.position.y < 0) s.visible = false;
    }

    // keep the canvas sized to its box
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const size = renderer.getSize(new THREE.Vector2());
    if (w && h && (size.x !== w || size.y !== h)) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 0.9 ? 42 : 38;
      camera.updateProjectionMatrix();
    }
    renderer.render(G.scene, camera);
    if (!anim && !drag && stage.classList.contains('can-roll') !== canRoll()) renderDom();
  }

  // ---- DOM ----
  function seatBox(seat) {
    const box = document.createElement('div');
    box.className = `bw-seat${view.phase === 'playing' && view.turn === seat ? ' turn' : ''}`;
    const dot = document.createElement('span');
    dot.className = 'bw-dot';
    dot.style.background = SEAT_COLOR[seat];
    dot.style.color = SEAT_COLOR[seat];
    const name = document.createElement('span');
    const occ = view.players[seat];
    name.textContent = `${seat.toUpperCase()}: ${occ ? nicknameFor(occ, seat) : '(empty)'}${occ && occ === api.getClientId() ? ' (you)' : ''}`;
    name.style.color = SEAT_COLOR[seat];
    box.append(dot, name);
    const me = mySeat();
    if (!occ) {
      if (!me) {
        const btn = document.createElement('button');
        btn.textContent = `BOWL AS ${seat.toUpperCase()}`;
        btn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat }));
        box.appendChild(btn);
      }
      const bot = document.createElement('button');
      bot.textContent = 'PLAY VS BOT';
      bot.addEventListener('click', () => api.sendAction({ kind: 'sit', seat, bot: true, level: preferredLevel() }));
      box.append(bot, levelSelect(preferredLevel()));
    } else if (occ === 'BOT') {
      box.appendChild(levelSelect((view.botLevels || {})[seat], (level) => api.sendAction({ kind: 'setBotLevel', seat, level })));
      const rm = document.createElement('button');
      rm.textContent = 'REMOVE BOT';
      rm.addEventListener('click', () => api.sendAction({ kind: 'removeBot', seat }));
      box.appendChild(rm);
    }
    return box;
  }

  function scorecard(sh) {
    const table = document.createElement('table');
    const cols = document.createElement('colgroup');
    cols.innerHTML = '<col class="name">' + '<col>'.repeat(9) + '<col class="f10"><col class="tot">';
    table.appendChild(cols);
    const head = document.createElement('tr');
    head.innerHTML = '<th class="name">BOWLER</th>' + Array.from({ length: 10 }, (_, i) => `<th>${i + 1}</th>`).join('') + '<th class="tot">TOTAL</th>';
    table.appendChild(head);
    const curTurn = anim ? anim.rec.by : sh.turn;
    const curFrame = anim ? anim.rec.frame : sh.frame;
    for (const seat of SEATS) {
      const rolls = sh.rolls[seat];
      const cum = S.scoreFrames(rolls);
      const tr = document.createElement('tr');
      if (view.phase === 'playing' && curTurn === seat) tr.className = 'turn';
      const nm = document.createElement('td');
      nm.className = 'name';
      nm.textContent = seatName(seat);
      nm.style.color = SEAT_COLOR[seat];
      tr.appendChild(nm);
      for (let f = 0; f < 10; f++) {
        const td = document.createElement('td');
        td.className = `fr${view.phase === 'playing' && curTurn === seat && curFrame === f ? ' cur' : ''}`;
        const marks = document.createElement('div');
        marks.className = 'marks';
        const m = S.frameMarks(rolls[f], f);
        const slots = f === 9 ? 3 : 2;
        for (let k = 0; k < slots; k++) {
          const sp = document.createElement('span');
          const v = m[k] || '';
          sp.textContent = v;
          if (v === 'X') sp.className = 'x';
          else if (v === '/') sp.className = 's';
          if (f < 9 && k === 0 && m[1] === 'X') sp.style.borderLeft = '0';
          marks.appendChild(sp);
        }
        const c = document.createElement('div');
        c.className = 'cum';
        c.textContent = cum[f] == null ? '' : String(cum[f]);
        td.append(marks, c);
        tr.appendChild(td);
      }
      const tot = document.createElement('td');
      tot.className = 'tot';
      tot.textContent = String(S.knownTotal(rolls));
      tot.style.color = SEAT_COLOR[seat];
      tr.appendChild(tot);
      table.appendChild(tr);
    }
    return table;
  }

  function resultsOpts() {
    if (!view || view.phase !== 'game_over' || anim || queue.length) return null;
    const me = mySeat();
    const w = view.winner;
    const draw = !w || w === 'draw';
    const order = draw ? SEATS : [w, w === 'p1' ? 'p2' : 'p1'];
    const st = (s) => view.stats[s];
    return {
      title: draw ? "IT'S A DRAW" : me === w ? 'YOU WIN!' : me ? 'YOU LOSE' : `${seatName(w)} WINS!`,
      subtitle: SEATS.map((s) => `${s.toUpperCase()} ${st(s).strikes}X ${st(s).spares}/`).join(' · '),
      outcome: draw ? 'draw' : me == null ? 'over' : me === w ? 'win' : 'lose',
      rows: order.map((s) => ({ name: seatName(s), value: `${view.totals[s]}`, win: !draw && s === w, you: s === me })),
      rematch: me ? { label: 'REMATCH', onClick: () => api.sendAction({ kind: 'resetGame' }) } : null,
    };
  }

  function renderDom() {
    if (destroyed) return;
    results.update(resultsOpts());
    if (!view || !S) {
      status.textContent = 'Loading...';
      return;
    }
    const seat = mySeat();
    const over = view.phase === 'game_over' && !anim && !queue.length;
    const sh = (!anim && shown) || shown || shownFromView();
    const rollingBy = anim ? anim.rec.by : null;
    status.className = 'bw-status';
    status.style.color = '';
    if (view.phase === 'waiting') {
      status.textContent = 'Waiting for both bowlers.';
    } else if (over) {
      status.textContent = view.winner === 'draw' ? "IT'S A DRAW!" : `${seatName(view.winner)} WINS ${view.totals[view.winner]}–${view.totals[view.winner === 'p1' ? 'p2' : 'p1']}!`;
      status.style.color = '#ffb000';
    } else if (rollingBy) {
      status.textContent = rollingBy === seat ? 'ROLLING…' : `${seatName(rollingBy)} ROLLING…`;
      status.style.color = SEAT_COLOR[rollingBy];
    } else if (seat && view.turn === seat) {
      status.textContent = `▶ YOUR TURN — FRAME ${view.frame + 1}, BALL ${view.ball + 1}`;
      status.classList.add('mine');
    } else {
      status.textContent = `${seatName(view.turn)} TO BOWL — FRAME ${view.frame + 1}`;
      status.style.color = SEAT_COLOR[view.turn];
    }
    err.textContent = flashError ? REJECT_MESSAGES[flashError] || 'Roll rejected' : '';

    seats.innerHTML = '';
    seats.append(seatBox('p1'), seatBox('p2'));
    if (seat) {
      const leave = document.createElement('button');
      leave.textContent = 'LEAVE SEAT';
      leave.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seats.appendChild(leave);
    }

    // HUD
    frameInfo.innerHTML = '';
    if (view.phase !== 'waiting') {
      const by = rollingBy || view.turn;
      const fr = anim ? anim.rec.frame : view.frame;
      const bl = anim ? anim.rec.ball : view.ball;
      const top = document.createElement('div');
      top.className = 'big';
      top.textContent = view.phase === 'game_over' && !anim ? 'FINAL' : `FRAME ${fr + 1} · BALL ${bl + 1}`;
      const who = document.createElement('div');
      who.style.color = SEAT_COLOR[by];
      who.textContent = view.phase === 'game_over' && !anim ? '' : seatName(by);
      const sc = document.createElement('div');
      sc.style.opacity = '0.85';
      sc.textContent = SEATS.map((s) => `${s.toUpperCase()} ${S.knownTotal(sh.rolls[s])}`).join('  ');
      frameInfo.append(top, who, sc);
    }
    if (!anim || !anim.ended) rackHud((anim ? anim.rec.before : view.pins).map((p) => p.id));

    cardEl.innerHTML = '';
    cardEl.appendChild(scorecard(sh));

    const cr = canRoll();
    stage.classList.toggle('can-roll', cr);
    hint.textContent = cr ? (view.ball === 0 && view.pins.length === 10 ? '◀ DRAG TO LINE UP ▶ · SWIPE UP TO BOWL' : 'PICK UP THE SPARE — SWIPE UP') : '';

    options.innerHTML = '';
    if (over && seat) {
      const again = document.createElement('button');
      again.textContent = 'REMATCH (SWAP ORDER)';
      again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
      options.appendChild(again);
    }
  }

  // ---- boot ----
  Promise.all([loadScript('games/slope/three.min.js', 'THREE'), loadScript('games/bowling/sim.js', 'BowlingSim')])
    .then(([THREE, Sim]) => {
      if (destroyed) return;
      S = Sim;
      try {
        G = createScene(THREE, S, canvas);
      } catch (e) {
        stage.innerHTML = '<div class="bw-fail">3D graphics (WebGL) are not available in this browser.</div>';
        renderDom();
        return;
      }
      if (view) setPins(view.pins);
      raf = requestAnimationFrame(frame);
      renderDom();
    })
    .catch(() => {
      stage.innerHTML = '<div class="bw-fail">Could not load the 3D engine.</div>';
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
      lastSeqSeen = data.lastThrow ? data.lastThrow.seq : 0;
      shown = shownFromView();
      if (G) setPins(data.pins);
      if (prev && prev.phase !== 'playing' && data.phase === 'playing') sfx.play('go');
    } else if (data.lastThrow && data.lastThrow.seq > lastSeqSeen) {
      onNewThrow(data.lastThrow);
    } else if (!anim && !queue.length) {
      shown = shownFromView();
      if (G) setPins(data.pins);
    }
    if (prev && !prev.winner && data.winner) {
      const seat = mySeat();
      const left = anim ? Math.max(0, (anim.rec.frames.length + HOLD_FRAMES) * (1000 / 30) - (performance.now() - anim.start)) : 0;
      setTimeout(() => sfx.play(!seat || data.winner === 'draw' ? 'point' : data.winner === seat ? 'win' : 'lose'), left + queue.length * 3000);
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
          if (G && view) setPins(view.pins);
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
