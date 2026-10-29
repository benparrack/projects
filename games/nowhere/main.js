import * as THREE from 'three';
import { link, crossed, teleport } from './portal.js';

const FOG = 0x0b0d16, MAX_DEPTH = 3, EYE = 1.6;
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.FogExp2(FOG, 0.045);
scene.add(new THREE.HemisphereLight(0x8a96b8, 0x3a2a1c, 0.9));
const camera = new THREE.PerspectiveCamera(72, 1, 0.01, 300);
const base = camera.clone(); // unscaled projection for the views through portals

// ---------- materials ----------
function tex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);
const stripes = (bg, fg, n) => tex(256, (g, s) => {
  g.fillStyle = bg; g.fillRect(0, 0, s, s); g.fillStyle = fg;
  for (let i = 0; i < n; i++) g.fillRect(i * s / n, 0, s / n / 3, s);
  for (let i = 0; i < 2 * n; i++) { g.beginPath(); g.arc((i % n + 0.66) * s / n, (Math.floor(i / n) + 0.5) * s / 2, 4, 0, 7); g.fill(); }
});
const planks = (bg) => tex(256, (g, s) => {
  for (let i = 0; i < 8; i++) {
    g.fillStyle = `hsl(28, 35%, ${rnd(18, 28)}%)`; g.fillRect(0, i * s / 8, s, s / 8);
    g.fillStyle = bg; g.fillRect(0, i * s / 8, s, 1.5); g.fillRect(rnd(0, s), i * s / 8, 1.5, s / 8);
  }
});
const checker = (a, b) => tex(256, (g, s) => {
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? a : b; g.fillRect(i * s / 4, j * s / 4, s / 4, s / 4); }
});
const noise = (h, s1, l0, l1) => tex(128, (g, s) => {
  for (let i = 0; i < s; i += 4) for (let j = 0; j < s; j += 4) { g.fillStyle = `hsl(${h}, ${s1}%, ${rnd(l0, l1)}%)`; g.fillRect(i, j, 4, 4); }
});
const std = (map, color = 0xffffff, rough = 0.85) => new THREE.MeshStandardMaterial({ map, color, roughness: rough });
const glow = (color) => new THREE.MeshBasicMaterial({ color });
const M = {
  wallpaper: std(stripes('#3d5a4a', '#47695a', 4)), wood: std(planks('#1a120c')), ceil: std(null, 0xd8d0c0),
  booth: std(planks('#0a1530'), 0x6a8cff), hallWall: std(stripes('#c9bfa8', '#d4caae', 2)), marble: std(checker('#e8e2d6', '#2a2a30'), 0xffffff, 0.35),
  column: std(null, 0xe8e0cc, 0.5), rug: std(noise(355, 60, 22, 30)), yellow: std(stripes('#b8a35a', '#c2ae66', 6)),
  carpet: std(noise(48, 30, 30, 36)), grass: std(noise(110, 30, 10, 16)), stone: std(noise(30, 8, 30, 40)),
  hedge: std(noise(120, 35, 8, 15)), bark: std(null, 0x3a2818), leaves: std(noise(130, 30, 10, 18)),
  frame: std(planks('#2a1a10'), 0xffffff, 0.6), door: std(planks('#140c06'), 0xb07850), brass: std(null, 0xd4a640, 0.3),
  lamp: glow(0xfff2d0), tube: glow(0xf4f8ff),
  window: new THREE.MeshBasicMaterial({ map: tex(256, (g, s) => { // a moonlit night behind leaded panes
    const grad = g.createLinearGradient(0, 0, 0, s); grad.addColorStop(0, '#0d1a3a'); grad.addColorStop(1, '#3a5a9a');
    g.fillStyle = grad; g.fillRect(0, 0, s, s); g.fillStyle = '#e8eef8';
    for (let i = 0; i < 40; i++) g.fillRect(rnd(0, s), rnd(0, s * 0.6), 2, 2);
    g.fillStyle = '#1a1410'; for (let i = 0; i <= 4; i++) { g.fillRect(i * s / 4 - 4, 0, 8, s); g.fillRect(0, i * s / 4 - 4, s, 8); }
  }) }), moon: new THREE.MeshBasicMaterial({ color: 0xf0ecd8, fog: false }),
};
// Textures repeat once per metre: scale each box face's UVs by its size.
function boxGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let i = 0; i < uv.count; i++) { const [a, b] = dims[i >> 2]; uv.setXY(i, uv.getX(i) * a, uv.getY(i) * b); }
  return g;
}

// ---------- building ----------
const walls = []; // colliders: [x0, z0, x1, z1]
function solid(w, h, d, mat, x, y, z, collide = true) {
  const m = new THREE.Mesh(boxGeo(w, h, d), mat);
  m.position.set(x, y + h / 2, z); scene.add(m);
  if (collide) { m.userData.wall = [x - w / 2, z - d / 2, x + w / 2, z + d / 2]; walls.push(m.userData.wall); }
  return m;
}
function light(x, y, z, color = 0xffe6c0, power = 6, dist = 12) {
  const l = new THREE.PointLight(color, power, dist, 1.4); l.position.set(x, y, z); scene.add(l);
}
// A room with 0.2 m walls centred on its outline. Doors: { side: n|s|e|w, at, w, h } -> doorway frames for portals.
function room(cx, cz, W, D, H, m, doors = []) {
  const T = 0.2;
  solid(W, 0.1, D, m.floor, cx, -0.1, cz, false);
  solid(W, 0.1, D, m.ceil, cx, H, cz, false);
  for (const side of 'nsew') {
    const horiz = side === 'n' || side === 's', L = (horiz ? W : D) + T;
    const fixed = { n: cz - D / 2, s: cz + D / 2, e: cx + W / 2, w: cx - W / 2 }[side];
    const seg = (a, b, y0, y1) => {
      if (b - a < 1e-3) return;
      if (horiz) solid(b - a, y1 - y0, T, m.wall, cx + (a + b) / 2, y0, fixed, y0 === 0);
      else solid(T, y1 - y0, b - a, m.wall, fixed, y0, cz + (a + b) / 2, y0 === 0);
    };
    let s = -L / 2;
    for (const d of doors.filter((d) => d.side === side).sort((a, b) => a.at - b.at)) {
      seg(s, d.at - d.w / 2, 0, H); seg(d.at - d.w / 2, d.at + d.w / 2, d.h, H); s = d.at + d.w / 2;
      d.x = horiz ? cx + d.at : fixed; d.z = horiz ? fixed : cz + d.at;
      d.rot = { n: 0, s: Math.PI, e: -Math.PI / 2, w: Math.PI / 2 }[side]; // +Z into the room
    }
    seg(s, L / 2, 0, H);
  }
  return doors;
}

const portals = [];
const res = new THREE.Vector2();
const fogMat = new THREE.MeshBasicMaterial({ color: FOG, fog: false });
function portal(w, h, x, y, z, rot, s = 1) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, res: { value: res } },
    vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D map; uniform vec2 res; void main() { gl_FragColor = texture2D(map, gl_FragCoord.xy / res);\n#include <colorspace_fragment>\n}',
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.position.set(x, y, z); mesh.rotation.y = rot; mesh.scale.setScalar(s); scene.add(mesh);
  const p = { mesh, mat, w, h }; portals.push(p); return p;
}
const doorPortal = (d) => portal(d.w, d.h, d.x, d.h / 2, d.z, d.rot);
const DOOR = { w: 1.2, h: 2.4 };

// A free-standing wooden doorframe (posts and lintel) at scale s; returns its portal.
function doorframe(x, y, z, rot, s) {
  const g = new THREE.Group(), w = 1.0, h = 2.1, t = 0.12;
  for (const [px, py, sw, sh] of [[-(w + t) / 2, 0, t, h + t], [(w + t) / 2, 0, t, h + t], [0, h, w, t]]) {
    const m = new THREE.Mesh(boxGeo(sw, sh, t), M.frame); m.position.set(px, py + sh / 2, 0); g.add(m);
  }
  g.position.set(x, y, z); g.rotation.y = rot; g.scale.setScalar(s); scene.add(g); g.updateMatrixWorld();
  for (const px of [-(w + t) / 2, (w + t) / 2]) { // post colliders
    const c = new THREE.Vector3(px, 0, 0).applyMatrix4(g.matrixWorld), r = t * s / 2 + 0.01 * s;
    walls.push([c.x - r, c.z - r, c.x + r, c.z + r]);
  }
  return portal(w, h, x, y + h * s / 2, z, rot, s);
}

// --- The hub: a small sitting room. ---
const hub = room(0, 0, 12, 12, 3.4, { floor: M.wood, ceil: M.ceil, wall: M.wallpaper }, [
  { side: 'n', at: 0, ...DOOR }, { side: 'e', at: 0, ...DOOR }, { side: 's', at: 3, ...DOOR }]);
light(-2, 3.0, -2); light(2.5, 3.0, 2.5);
for (const [x, z] of [[-2, -2], [2.5, 2.5]]) solid(0.5, 0.12, 0.5, M.lamp, x, 3.28, z, false);
solid(2.4, 0.5, 0.9, M.rug, -3.5, 0, -4.6); // a low bench by the north wall
// The wardrobe against the west wall.
solid(1.4, 2.6, 0.1, M.booth, -5.3, 0, 0.65); solid(1.4, 2.6, 0.1, M.booth, -5.3, 0, -0.65);
solid(1.5, 0.12, 1.5, M.booth, -5.3, 2.6, 0, false); solid(0.12, 0.2, 1.4, M.booth, -4.6, 2.4, 0, false);
const wardrobe = portal(1.2, 2.4, -4.6, 1.2, 0, Math.PI / 2);
// The table with a tiny doorframe on it. Its top is fenced by thin colliders so a tiny you can walk on it.
const TOP = 0.82;
solid(2.0, 0.04, 1.2, M.frame, 2.5, TOP - 0.04, 3, false);
for (const [x, z] of [[1.6, 2.5], [3.4, 2.5], [1.6, 3.5], [3.4, 3.5]]) solid(0.07, TOP - 0.04, 0.07, M.frame, x, 0, z, false);
walls.push([1.5, 2.4, 3.5, 2.42], [1.5, 3.58, 3.5, 3.6], [1.5, 2.4, 1.52, 3.6], [3.48, 2.4, 3.5, 3.6]);
const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 24), std(null, 0x9a3a2a, 0.4));
mug.position.set(3.05, TOP + 0.05, 3.25); scene.add(mug); walls.push([3.0, 3.2, 3.1, 3.3]);
solid(0.22, 0.06, 0.3, std(null, 0x2a4a3a), 1.9, TOP, 3.25); solid(0.2, 0.05, 0.28, std(null, 0x6a2a2a), 1.9, TOP + 0.06, 3.24, false);
const tinyFrame = doorframe(2.5, TOP, 2.6, 0, 0.1);

// --- The hall, through the wardrobe. ---
const [hallDoor] = room(200, 0, 16, 40, 9, { floor: M.marble, ceil: M.ceil, wall: M.hallWall }, [{ side: 's', at: 0, ...DOOR }]);
for (const x of [195, 205]) for (let z = -16; z <= 16; z += 6.4) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 9, 20), M.column); c.position.set(x, 4.5, z); scene.add(c);
  walls.push([x - 0.5, z - 0.5, x + 0.5, z + 0.5]);
}
solid(3, 0.02, 34, M.rug, 200, 0, 1, false);
for (const z of [-12, 0, 12]) { light(200, 7, z, 0xffe2b0, 30, 22); const ch = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), M.lamp); ch.position.set(200, 7.5, z); scene.add(ch); }
for (const x of [192.11, 207.89]) for (let z = -14; z <= 14; z += 7) {
  const w = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 4), M.window); w.position.set(x, 5, z); w.rotation.y = x < 200 ? Math.PI / 2 : -Math.PI / 2; scene.add(w);
}
// A great clock on the far wall that keeps real time.
const clockCanvas = document.createElement('canvas'); clockCanvas.width = clockCanvas.height = 512;
const clockTex = new THREE.CanvasTexture(clockCanvas); clockTex.colorSpace = THREE.SRGBColorSpace;
const clockFace = new THREE.Mesh(new THREE.CircleGeometry(2.6, 64), new THREE.MeshStandardMaterial({ map: clockTex, roughness: 0.5 }));
clockFace.position.set(200, 5, -19.88); scene.add(clockFace);
light(200, 5, -16, 0xffe2b0, 10, 8);
function drawClock() {
  const g = clockCanvas.getContext('2d'), now = new Date(), c = 256;
  g.fillStyle = '#efe6cc'; g.beginPath(); g.arc(c, c, 256, 0, 7); g.fill();
  g.strokeStyle = '#a8862a'; g.lineWidth = 18; g.beginPath(); g.arc(c, c, 246, 0, 7); g.stroke();
  g.fillStyle = '#2a2418'; g.font = '44px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'].forEach((n, i) =>
    g.fillText(n, c + Math.sin(i * Math.PI / 6) * 190, c - Math.cos(i * Math.PI / 6) * 190));
  const hand = (turns, len, w) => {
    g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(c, c);
    g.lineTo(c + Math.sin(turns * 2 * Math.PI) * len, c - Math.cos(turns * 2 * Math.PI) * len); g.stroke();
  };
  const sec = now.getSeconds(), min = now.getMinutes() + sec / 60;
  g.strokeStyle = '#2a2418'; hand(((now.getHours() % 12) + min / 60) / 12, 120, 14); hand(min / 60, 175, 9);
  g.strokeStyle = '#8a1a1a'; hand(sec / 60, 190, 3);
  clockTex.needsUpdate = true;
}
drawClock(); setInterval(drawClock, 1000);

// --- The hallway that keeps going. Everything repeats every 20 m between the two loop portals. ---
const [hallwayIn, sideDoor] = room(0, -214, 3, 28, 3, { floor: M.carpet, ceil: M.ceil, wall: M.yellow },
  [{ side: 's', at: 0, ...DOOR }, { side: 'e', at: -1, ...DOOR }]);
for (let z = -202.5; z > -228; z -= 5) solid(0.6, 0.04, 1.4, M.tube, 0, 2.96, z, false);
for (const z of [-200, -210, -220, -230]) light(0, 2.7, z, 0xf0f4ff, 5, 10);
const loopA = portal(3.2, 3.2, 0, 1.5, -205, Math.PI), loopB = portal(3.2, 3.2, 0, 1.5, -225, 0);
const signCanvas = document.createElement('canvas'); signCanvas.width = 512; signCanvas.height = 256;
const signTex = new THREE.CanvasTexture(signCanvas); signTex.colorSpace = THREE.SRGBColorSpace;
const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6 }));
sign.position.set(-1.39, 1.7, -212); sign.rotation.y = Math.PI / 2; scene.add(sign);
function drawSign(n) {
  const g = signCanvas.getContext('2d');
  g.fillStyle = '#e8e0c8'; g.fillRect(0, 0, 512, 256); g.fillStyle = '#2a2418'; g.textAlign = 'center';
  g.font = 'bold 120px Georgia, serif'; g.fillText(String(Math.abs(n)), 256, 150);
  g.font = 'italic 34px Georgia, serif'; g.fillText(n ? 'times around' : 'you are here', 256, 215);
  signTex.needsUpdate = true;
}
drawSign(0);
// The way out, locked until you have gone round enough times. A door leaf on each side.
const leaves = [solid(0.06, 2.4, 1.2, M.door, 1.45, 0, -215), solid(1.2, 2.4, 0.06, M.door, 3, 0, 5.95)];
for (const [leaf, x, z] of [[leaves[0], -0.04, 0.4], [leaves[1], 0.4, -0.04]]) {
  const k = new THREE.Mesh(new THREE.SphereGeometry(0.04), M.brass); k.position.set(x, -0.15, z); leaf.add(k);
}

// --- The courtyard at night, through the east door. ---
const C = -200;
solid(60, 0.1, 60, M.grass, C, -0.1, 0, false);
const [facadeDoor] = room(C - 18, 0, 6, 12, 5, { floor: M.stone, ceil: M.stone, wall: M.stone }, [{ side: 'e', at: 0, ...DOOR }]);
facadeDoor.rot = Math.PI / 2; // this door is entered from outside, so it faces out
for (const [x, z, w, d] of [[C, -30, 60, 1], [C, 30, 60, 1], [C - 30, 0, 1, 60], [C + 30, 0, 1, 60]]) solid(w, 1.4, d, M.hedge, x, 0, z);
for (let i = 0; i < 26; i++) {
  const a = rnd(0, 7), r = rnd(9, 26), x = C + Math.cos(a) * r, z = Math.sin(a) * r;
  if (x < C + 5 && Math.abs(z) < 8) continue; // keep the path from the house to the frame clear
  const s = rnd(0.8, 1.5);
  solid(0.3 * s, 2 * s, 0.3 * s, M.bark, x, 0, z);
  const top = new THREE.Mesh(new THREE.ConeGeometry(1.4 * s, 3.5 * s, 9), M.leaves); top.position.set(x, 3.4 * s, z); scene.add(top);
}
for (const [x, z] of [[C - 8, -3], [C - 8, 3], [C + 6, -6], [C + 6, 6]]) {
  solid(0.12, 3, 0.12, M.bark, x, 0, z); solid(0.3, 0.3, 0.3, M.lamp, x, 3, z, false); light(x, 3.2, z, 0xffc880, 22, 16);
}
const moon = new THREE.Mesh(new THREE.SphereGeometry(8, 24, 16), M.moon); moon.position.set(C + 60, 70, -140); scene.add(moon);
{
  const pts = [];
  for (let i = 0; i < 1500; i++) {
    const a = rnd(0, Math.PI * 2), e = Math.asin(rnd(0.05, 1));
    pts.push(C + Math.cos(a) * Math.cos(e) * 200, Math.sin(e) * 200, Math.sin(a) * Math.cos(e) * 200);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false })));
}
const bigFrame = doorframe(C + 2, 0, 0, -Math.PI / 2, 1);

// ---------- wiring ----------
link(doorPortal(hub[0]), doorPortal(hallwayIn));
link(doorPortal(hub[1]), doorPortal(facadeDoor));
const exitPair = [doorPortal(hub[2]), doorPortal(sideDoor)];
link(...exitPair);
link(wardrobe, doorPortal(hallDoor));
link(loopA, loopB);
link(bigFrame, tinyFrame);
for (const p of exitPair) p.closed = true;

// ---------- rendering through portals ----------
// Each portal view is drawn into a texture first (deepest first); portals past MAX_DEPTH show fog.
const pool = [], cams = [];
const getRT = (d, i) => {
  pool[d] ??= [];
  return (pool[d][i] ??= new THREE.WebGLRenderTarget(res.x, res.y, { samples: 4, colorSpace: THREE.SRGBColorSpace }));
};
const getCam = (d, i) => ((cams[d] ??= [])[i] ??= Object.assign(new THREE.PerspectiveCamera(), { matrixAutoUpdate: false }));
const FLIP = new THREE.Matrix4().makeRotationY(Math.PI);
const frustum = new THREE.Frustum(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _q = new THREE.Quaternion();
const _s = new THREE.Vector3(), _plane = new THREE.Plane(), _clip = new THREE.Vector4(), ONE = new THREE.Vector3(1, 1, 1);

function sees(cam, p) {
  if (p.closed) return false;
  _v.setFromMatrixPosition(cam.matrixWorld).sub(p.pos);
  if (_v.dot(p.n) <= 0) return false;
  frustum.setFromProjectionMatrix(_m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  return frustum.intersectsObject(p.mesh);
}
function virtualCam(vc, cam, p) {
  const d = p.dest;
  vc.matrix.copy(d.mesh.matrixWorld).multiply(FLIP).multiply(p.inv).multiply(cam.matrixWorld);
  vc.matrix.decompose(_v, _q, _s); vc.matrix.compose(_v, _q, ONE); // drop scale so fog uses real distances
  vc.matrixWorld.copy(vc.matrix); vc.matrixWorldInverse.copy(vc.matrix).invert();
  // Oblique near plane on the destination doorway, so nothing behind it gets in the way.
  const pm = vc.projectionMatrix.copy(base.projectionMatrix);
  _plane.setFromNormalAndCoplanarPoint(d.n, d.pos).applyMatrix4(vc.matrixWorldInverse);
  _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
  const e = pm.elements, q = new THREE.Vector4(
    (Math.sign(_clip.x) + e[8]) / e[0], (Math.sign(_clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
  _clip.multiplyScalar(2 / _clip.dot(q));
  e[2] = _clip.x; e[6] = _clip.y; e[10] = _clip.z + 1; e[14] = _clip.w;
  vc.projectionMatrixInverse.copy(pm).invert();
}
// The pixel rectangle p covers as seen from cam, clipped to the parent view's; null when off it.
const _c = new THREE.Vector4();
function screenRect(cam, p, clip) {
  _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).multiply(p.mesh.matrixWorld);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    _c.set(sx * p.w / 2, sy * p.h / 2, 0, 1).applyMatrix4(_m);
    if (_c.w < 1e-6) { [x0, y0, x1, y1] = [0, 0, res.x, res.y]; break; } // a corner behind the eye: don't guess
    const x = (_c.x / _c.w * 0.5 + 0.5) * res.x, y = (_c.y / _c.w * 0.5 + 0.5) * res.y;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const [cx0, cy0, cx1, cy1] = clip ?? [0, 0, res.x, res.y];
  x0 = Math.max(Math.floor(x0), cx0); y0 = Math.max(Math.floor(y0), cy0);
  x1 = Math.min(Math.ceil(x1), cx1); y1 = Math.min(Math.ceil(y1), cy1);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
}
// Draw cam's view into target (null = screen), only inside rect. via = the doorway cam looks out of.
function renderView(cam, depth, target, rect = null, via = null) {
  const kids = [];
  if (depth < MAX_DEPTH) for (const p of portals) {
    if (!sees(cam, p)) continue;
    if (via && _v.copy(p.pos).sub(via.pos).dot(via.n) < -0.01) continue; // behind the doorway we look out of
    const r = screenRect(cam, p, rect);
    if (!r) continue;
    const vc = getCam(depth, kids.length), rt = getRT(depth, kids.length);
    virtualCam(vc, cam, p);
    rt.scissor.set(r[0], r[1], r[2] - r[0], r[3] - r[1]); rt.scissorTest = true;
    renderView(vc, depth + 1, rt, r, p.dest);
    kids.push([p, rt]);
  }
  for (const p of portals) p.mesh.material = fogMat;
  for (const [p, rt] of kids) { p.mesh.material = p.mat; p.mat.uniforms.map.value = rt.texture; }
  renderer.setRenderTarget(target);
  renderer.render(scene, cam);
}

// ---------- player ----------
const player = { pos: new THREE.Vector3(0, EYE, 4), yaw: 0, pitch: 0, scale: 1 };
const keys = new Set();
addEventListener('keydown', (e) => { keys.add(e.code); start(); });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); start(); });
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  player.yaw -= (e.clientX - drag[0]) * 0.004;
  player.pitch = THREE.MathUtils.clamp(player.pitch - (e.clientY - drag[1]) * 0.004, -1.4, 1.4);
  drag = [e.clientX, e.clientY];
});
const intro = document.getElementById('intro'), caption = document.getElementById('caption');
function start() { intro.classList.add('gone'); }
let captionTimer;
function say(text) {
  caption.textContent = text; caption.classList.add('on');
  clearTimeout(captionTimer); captionTimer = setTimeout(() => caption.classList.remove('on'), 4000);
}

function collide(pos, r) {
  for (const [x0, z0, x1, z1] of walls) {
    const dx = pos.x - THREE.MathUtils.clamp(pos.x, x0, x1), dz = pos.z - THREE.MathUtils.clamp(pos.z, z0, z1);
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-12) { const d = Math.sqrt(d2), k = (r - d) / d; pos.x += dx * k; pos.z += dz * k; }
    else { // centre inside the box: push out the short way
      const opts = [[x0 - r - pos.x, 0], [x1 + r - pos.x, 0], [0, z0 - r - pos.z], [0, z1 + r - pos.z]];
      const [ox, oz] = opts.sort((a, b) => Math.hypot(...a) - Math.hypot(...b))[0];
      pos.x += ox; pos.z += oz;
    }
  }
}

let laps = 0, unlocked = false;
window.nowhere = { player, get laps() { return laps; } }; // for the browser test
const prev = new THREE.Vector3();
function step(dt) {
  const turn = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0);
  player.yaw += turn * 2 * dt;
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  if (!f && !s) return;
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4.5 : 2.2) * player.scale * dt / Math.hypot(f, s);
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  prev.copy(player.pos);
  player.pos.x += (-sy * f + cy * s) * speed;
  player.pos.z += (-cy * f - sy * s) * speed;
  collide(player.pos, 0.25 * player.scale);
  for (const p of portals) {
    if (!crossed(p, prev, player.pos)) continue;
    teleport(p, player);
    if (p === loopB) laps++;
    if (p === loopA) laps--;
    if (p === loopA || p === loopB) { drawSign(laps); onLap(); }
    if (p === bigFrame) say('Everything got very large.');
    if (p === tinyFrame) say('Back to your usual size.');
    if (p === wardrobe) say('It is bigger on the inside.');
    break;
  }
}
function onLap() {
  if (unlocked || Math.abs(laps) < 4) return;
  unlocked = true;
  for (const l of leaves) { scene.remove(l); walls.splice(walls.indexOf(l.userData.wall), 1); }
  for (const p of exitPair) p.closed = false;
  say('Somewhere nearby, a door clicks open.');
}

// ---------- loop ----------
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.getDrawingBufferSize(res);
  for (const c of [camera, base]) { c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); }
  for (const level of pool) for (const rt of level ?? []) rt.setSize(res.x, res.y);
}
addEventListener('resize', resize);
resize();

let last = 0;
renderer.setAnimationLoop((t) => {
  step(Math.min((t - last) / 1000, 0.05)); last = t;
  camera.near = 0.01 * player.scale; camera.far = 300 * player.scale; camera.updateProjectionMatrix();
  camera.position.copy(player.pos);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  camera.updateMatrixWorld();
  renderView(camera, 0, null);
});
