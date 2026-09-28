import * as THREE from "three";
import { CSM } from "three/addons/csm/CSM.js";
import { City, G } from "./city.js";
import { World } from "./collide.js";
import { U } from "./materials.js";
import { CityMesh } from "./cityMesh.js";
import { Sky } from "./sky.js";
import { Post } from "./post.js";
import { Input } from "./input.js";
import { Player } from "./player.js";
import { ChaseCam } from "./camera.js";
import { Character } from "./character.js";
import { Webs } from "./web.js";
import { Audio } from "./audio.js";
import { Traffic, Tokens } from "./traffic.js";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("webslinger." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("webslinger." + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ------------------------------------------------------------------ settings
const QUALITY = {
  low: { minScale: 0.45, maxScale: 0.7, samples: 0, shadow: 1024, cascades: 2, rays: false, interior: 0, traffic: 300, bloom: true, ao: false },
  medium: { minScale: 0.55, maxScale: 0.85, samples: 0, shadow: 2048, cascades: 3, rays: true, interior: 1, traffic: 500, bloom: true, ao: true },
  high: { minScale: 0.6, maxScale: 1.0, samples: 4, shadow: 2048, cascades: 3, rays: true, interior: 1, traffic: 700, bloom: true, ao: true },
  ultra: { minScale: 0.75, maxScale: 1.0, samples: 4, shadow: 4096, cascades: 4, rays: true, interior: 1, traffic: 900, bloom: true, ao: true },
};
const TIMES = [
  { name: "Golden Hour", hour: 17.55, cloud: 0.4 },
  { name: "Sunset", hour: 18.05, cloud: 0.5 },
  { name: "Blue Hour", hour: 18.55, cloud: 0.35 },
  { name: "Night", hour: 22.5, cloud: 0.3 },
  { name: "Dawn", hour: 6.6, cloud: 0.45 },
  { name: "Morning", hour: 9.0, cloud: 0.35 },
  { name: "Midday", hour: 12.5, cloud: 0.4 },
];
// post "looks": Cinematic = punchy ACES grade with lens effects; Realistic = AgX film
// response, SSAO, eye adaptation, neutral grade, extra aerial haze, no lens tricks
const LOOKS = {
  cinematic: { name: "Cinematic", tonemap: 0, exp: 1, ao: 0.55, adapt: 0.3, sat: 1.08, contrast: 1.06, warm: 0.6, vignette: 0.35, grain: 0.012, ca: 1, blur: 1, bloom: 0.06, rays: 1, fog: 1, comic: 0 },
  realistic: { name: "Realistic", tonemap: 1, exp: 1, ao: 0.9, adapt: 0.5, sat: 1.0, contrast: 1.0, warm: 0.2, vignette: 0.2, grain: 0.006, ca: 0, blur: 0.45, bloom: 0.035, rays: 0.7, fog: 1.1, comic: 0 },
  comic: { name: "Comic book", tonemap: 0, exp: 1, ao: 0.4, adapt: 0.25, sat: 1.08, contrast: 1.06, warm: 0.6, vignette: 0.35, grain: 0.012, ca: 0.5, blur: 1, bloom: 0.06, rays: 1, fog: 1, comic: 1 },
};
const LOOK_ORDER = ["cinematic", "realistic", "comic"];
const S = {
  quality: store.get("quality", "high"),
  time: store.get("time", 0),
  look: store.get("look", store.get("comic", false) ? "comic" : "cinematic"),
  sens: store.get("sens", 1),
  invertY: store.get("invertY", false),
  autoCam: store.get("autoCam", true),
  assist: store.get("assist", true),
  volume: store.get("volume", 0.8),
  fov: store.get("fov", 70),
  timeFlow: store.get("timeFlow", false),
  dynRes: store.get("dynRes", true),
  motion: store.get("motion", 1),
};
const Q = QUALITY[S.quality] || QUALITY.high;

// ------------------------------------------------------------------ renderer
const canvas = $("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false, preserveDrawingBuffer: location.search.includes("debug") });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // the composite pass encodes sRGB itself

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.00022);
const camera = new THREE.PerspectiveCamera(S.fov, 1, 0.12, 9000);

// ------------------------------------------------------------------ world
const t0 = performance.now();
const city = new City(1337);
const world = new World(city);
const sky = new Sky(renderer);
U.uSkyLUT.value = sky.lut.texture;
scene.add(sky.dome);
const cityMesh = new CityMesh(city, scene);
const traffic = new Traffic(scene, Q.traffic);
const tokens = new Tokens(scene, city.tokens);
const player = new Player(world);
const hero = new Character(scene);
const webs = new Webs(scene);
const chase = new ChaseCam(camera, world);
chase.baseFov = S.fov;
const input = new Input(canvas);
input.sens = S.sens; input.invertY = S.invertY;
const audio = new Audio();
const post = new Post(renderer);
post.opts.rays = Q.rays; post.opts.bloom = Q.bloom;
U.uInterior.value = Q.interior;
console.log(`[webslinger] world built in ${(performance.now() - t0) | 0} ms: ${city.boxes.length} boxes`);

// cascaded shadows for the sun, chained after our own shader patches
const csm = new CSM({
  maxFar: 1400, cascades: Q.cascades, mode: "practical", parent: scene, shadowMapSize: Q.shadow,
  lightDirection: new THREE.Vector3(0, -1, 0), camera, lightIntensity: 1, lightNear: 1, lightFar: 3000, lightMargin: 600,
  shadowBias: -0.00012,
});
csm.fade = true;
for (const l of csm.lights) { l.shadow.normalBias = 0.04; l.shadow.radius = 1.5; }
function csmify(m) {
  const mine = m.onBeforeCompile;
  csm.setupMaterial(m);
  const theirs = m.onBeforeCompile;
  m.onBeforeCompile = (s, r) => { if (mine) mine.call(m, s, r); theirs.call(m, s, r); };
}
const seen = new Set();
scene.traverse((o) => {
  if (!o.isMesh || !o.material || seen.has(o.material)) return;
  const m = o.material;
  if (m.isMeshStandardMaterial) { seen.add(m); csmify(m); }
});

// ------------------------------------------------------------------ spawn
function pickSpawn() {
  // a mid-height rooftop on the south side of a cross street, looking west down
  // the canyon toward the sunset
  let best = null, bs = -1e9;
  for (const b of world.boxes) {
    if (b.detail || b.y0 > 30 || b.y1 < 70 || b.y1 > 150) continue;
    const cx = (b.x0 + b.x1) / 2;
    if (cx < 150 || cx > 700 || b.z0 < -1100 || b.z1 > -560) continue;
    const j = Math.round((b.z0 - G.Z0) / G.PZ);
    const streetZ = G.Z0 + j * G.PZ;
    if (Math.abs(b.z0 - (streetZ + G.SW / 2)) > 6) continue;
    const s = -Math.abs(b.y1 - 110) * 0.1 - Math.abs(cx - 400) * 0.01;
    if (s > bs) { bs = s; best = b; }
  }
  if (!best) return { x: 0, y: 1, z: -700, yaw: Math.PI / 2 };
  return { x: best.x0 + 6, y: best.y1, z: best.z0 + 3, yaw: Math.PI / 2 };
}
const spawn = pickSpawn();
function toSpawn() {
  player.p.x = spawn.x; player.p.z = spawn.z;
  player.p.y = world.floorBelow(spawn.x, spawn.z, spawn.y + 30) + 0.95;
  player.v.x = player.v.y = player.v.z = 0;
  Object.assign(player.pp, player.p); Object.assign(player.rp, player.p);
  player.state = "ground"; player.facing = spawn.yaw;
  chase.yaw = spawn.yaw; chase.pitch = 0.02;
  chase.target.set(player.p.x, player.p.y + 0.9, player.p.z);
}
toSpawn();
player.assist = S.assist ? 1 : 0;

// ------------------------------------------------------------------ time of day
let hour = TIMES[S.time % TIMES.length].hour;
let skyState = null;
const sunScreen = new THREE.Vector3();
let lastBake = -1;
function applyTime(h, force) {
  hour = ((h % 24) + 24) % 24;
  if (!force && Math.abs(hour - lastBake) < 0.02) return;
  lastBake = hour;
  skyState = sky.setTime(hour, TIMES[S.time % TIMES.length].cloud);
  scene.environment = sky.envRT.texture;
  U.uNight.value = skyState.night;
  U.uDayAmb.value = Math.max(skyState.day, 0.05);
  U.uLitShare.value = 0.3 + 0.22 * skyState.night;
  const sd = sky.sunDir.y > 0.02 ? sky.sunDir : sky.moonDir;
  csm.lightDirection.copy(sd).negate();
  shadowForce = true;
  const moon = new THREE.Color(0.05, 0.07, 0.12).multiplyScalar(skyState.night * 1.2);
  for (const l of csm.lights) { l.color.copy(sky.sunDir.y > 0.02 ? sky.sunLight : moon); l.intensity = 1; }
  scene.environmentIntensity = 1;
}
applyTime(hour, true);
function setTimePreset(i) {
  S.time = (i + TIMES.length) % TIMES.length;
  store.set("time", S.time);
  applyTime(TIMES[S.time].hour, true);
  post.adaptReset = true;
  toast(TIMES[S.time].name);
}

// ------------------------------------------------------------------ shadows
// Far cascades cover a lot of city and change slowly on screen, so they're redrawn
// every 2nd/3rd/4th frame. A skipped cascade keeps its old shadow matrix together
// with its old map (three skips both), so static shadows stay exactly right; only
// moving things far away update at a lower rate. A fast camera turn or a jump in
// position redraws everything, since a stale far cascade might not cover the view.
var shadowFrame = 0, shadowForce = true;   // var: applyTime() runs above this line
const lastCamQ = new THREE.Quaternion(), lastCamP = new THREE.Vector3();
function staggerShadows() {
  shadowFrame++;
  const every = [1, 2, 3, 4];
  const jump = shadowForce || camera.quaternion.angleTo(lastCamQ) > 0.04 || camera.position.distanceTo(lastCamP) > 12;
  shadowForce = false;
  lastCamQ.copy(camera.quaternion); lastCamP.copy(camera.position);
  csm.lights.forEach((l, i) => {
    l.shadow.autoUpdate = false;
    l.shadow.needsUpdate = jump || (shadowFrame + i) % every[Math.min(i, 3)] === 0;
  });
}

// ------------------------------------------------------------------ sizing
let dynScale = store.get("scale", Q.maxScale);
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(innerWidth * dpr), h = Math.floor(innerHeight * dpr);
  renderer.setSize(w, h, false);
  canvas.style.width = innerWidth + "px"; canvas.style.height = innerHeight + "px";
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const sc = S.dynRes ? dynScale : Q.maxScale;
  // at HiDPI density 4x MSAA is indistinguishable from 2x but costs ~2 ms at 5 MP
  post.setSize(w, h, sc, Q.samples >= 4 && dpr * sc >= 1.5 ? 2 : Q.samples);
  // MSAA'd and not upscaled: FXAA would only soften it
  post.opts.fxaa = post.samples === 0 || post.scale < 0.95;
}
addEventListener("resize", resize);
resize();

// ------------------------------------------------------------------ UI
let toastT = 0;
function toast(msg) { const el = $("toast"); el.textContent = msg; el.classList.add("on"); toastT = 1.6; }
let playing = false, paused = true;
function startPlay() {
  audio.start(); audio.setVolume(S.volume);
  input.lock();
}
$("play").addEventListener("click", startPlay);
$("resume").addEventListener("click", startPlay);
canvas.addEventListener("click", () => { if (!input.locked && playing) startPlay(); });
document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) { playing = true; paused = false; $("title").classList.add("hidden"); $("menu").classList.add("hidden"); $("hud").classList.remove("hidden"); }
  else if (playing) { paused = true; $("menu").classList.remove("hidden"); }
});
function setLook(k, announce) {
  if (!LOOKS[k]) k = "cinematic";
  S.look = k; store.set("look", k);
  $("s-look").value = k;
  if (announce) toast(LOOKS[k].name);
}
function bindSettings() {
  const q = $("s-quality"); q.value = S.quality;
  q.onchange = () => { store.set("quality", q.value); location.reload(); };
  const tm = $("s-time");
  tm.innerHTML = TIMES.map((t, i) => `<option value="${i}">${t.name}</option>`).join("");
  tm.value = S.time; tm.onchange = () => setTimePreset(+tm.value);
  const bind = (id, key, fn, prop = "checked") => {
    const el = $(id); el[prop] = S[key];
    el.oninput = () => { S[key] = prop === "checked" ? el.checked : +el.value; store.set(key, S[key]); fn && fn(); };
  };
  const lk = $("s-look"); lk.value = S.look;
  lk.onchange = () => setLook(lk.value);
  bind("s-flow", "timeFlow");
  bind("s-auto", "autoCam");
  bind("s-assist", "assist", () => (player.assist = S.assist ? 1 : 0));
  bind("s-invert", "invertY", () => (input.invertY = S.invertY));
  bind("s-dyn", "dynRes", resize);
  bind("s-sens", "sens", () => (input.sens = S.sens), "value");
  bind("s-vol", "volume", () => audio.setVolume(S.volume), "value");
  bind("s-fov", "fov", () => (chase.baseFov = S.fov), "value");
  bind("s-motion", "motion", null, "value");
}
bindSettings();
$("tokTotal").textContent = tokens.list.length;

// ------------------------------------------------------------------ loop
let last = performance.now(), time = 0;
let frames = 0, fpsT = 0, fps = 60, slowT = 0, fastT = 0, lastResChange = 0, cooldown = 0;
let mainWeb = null, flash = 0, statsOn = false;
const tmpV = new THREE.Vector3();
const titleCam = { a: 0 };
const ctl = { mx: 0, mz: 0, lookX: 0, lookY: 0, swing: false, swingP: false, jump: false, jumpP: false, zip: false, dash: false, dive: false };

function handleEvents(speed) {
  for (const e of player.events) {
    audio.play(e, speed);
    if (e === "thwip") {
      const hand = player.hand > 0 ? hero.handPos.r : hero.handPos.l;
      if (mainWeb) webs.letGo(mainWeb);
      mainWeb = webs.shoot(hand, tmpV.set(player.anchor.x, player.anchor.y, player.anchor.z));
    } else if (e === "release" || e === "releaseJump" || e === "landHard" || e === "land" || e === "wall" || e === "respawn") {
      if (mainWeb) { webs.letGo(mainWeb); mainWeb = null; }
      if (e === "landHard") chase.shake = 1;
      if (e === "respawn") { flash = 1; post.adaptReset = true; toast("Back to the city"); }
    } else if (e === "zip") {
      if (mainWeb) webs.letGo(mainWeb);
      mainWeb = webs.shoot(hero.handPos.r, tmpV.set(player.zipT.x, player.zipT.y, player.zipT.z));
    } else if (e === "launch" || e === "vault") {
      if (mainWeb) { webs.letGo(mainWeb); mainWeb = null; }
      if (e === "launch") chase.shake = 0.4;
    } else if (e === "dash") {
      for (const [h, side] of [[hero.handPos.l, -1], [hero.handPos.r, 1]]) {
        const s = webs.shoot(h, tmpV.set(player.zipT.x + side * 6 * Math.cos(chase.yaw), player.zipT.y, player.zipT.z - side * 6 * Math.sin(chase.yaw)));
        setTimeout(() => webs.letGo(s), 180);
      }
      chase.shake = 0.3;
    } else if (e === "superjump") chase.shake = 0.35;
  }
  player.events.length = 0;
}

function frame(now) {
  requestAnimationFrame(frame);
  tick(now);
}
function tick(now) {
  const rawDt = (now - last) / 1000;
  last = now;
  const dt = Math.min(rawDt, 1 / 20);
  time += dt;
  U.uTime.value = time;

  const c = input.poll();
  if (window.WS?.fake) Object.assign(c, window.WS.fake);
  if (c.menu && input.locked) document.exitPointerLock();
  if (c.time) setTimePreset(S.time + 1);
  if (c.comic) setLook(LOOK_ORDER[(LOOK_ORDER.indexOf(S.look) + 1) % LOOK_ORDER.length], true);
  if (c.photo) { $("hud").classList.toggle("hidden"); }
  if (c.help) $("help").classList.toggle("hidden");
  if (input.keys.has("F3")) { input.keys.delete("F3"); statsOn = !statsOn; $("stats").classList.toggle("hidden", !statsOn); }

  let speed = 0;
  if (playing && !paused) {
    Object.assign(ctl, c);
    ctl.yaw = chase.yaw;
    ctl.fwd = chase.fwd;
    ctl.camPos = camera.position;
    player.update(dt, ctl);
    hero.update(dt, player, c, time);
    speed = chase.update(dt, player, c, S);
    handleEvents(speed);
    if (mainWeb) {
      if (player.state === "swing" || player.state === "zip") mainWeb.a.copy(player.state === "swing" && player.hand < 0 ? hero.handPos.l : hero.handPos.r);
    }
    const got = tokens.update(dt, time, player.p, camera);
    if (got) {
      audio.play(tokens.count === tokens.list.length ? "allTokens" : "token");
      $("tok").textContent = tokens.count;
      flash = 0.25;
      toast(tokens.count === tokens.list.length ? "Every token found!" : `Token ${tokens.count} / ${tokens.list.length}`);
    }
    audio.update(dt, speed, player.p.y);
    if (S.timeFlow) applyTime(hour + dt / 60);   // one game hour per real minute
  } else {
    // title / pause: slow cinematic orbit around the spawn
    if (!playing && window.WS?.view) {
      const v = window.WS.view;
      camera.position.set(v[0], v[1], v[2]); camera.lookAt(v[3], v[4], v[5]);
      if (v[6]) { camera.fov = v[6]; camera.updateProjectionMatrix(); }
    } else if (!playing) {
      titleCam.a += dt * 0.05;
      const r = 70;
      camera.position.set(spawn.x - 40 + Math.cos(titleCam.a) * r, spawn.y + 35 + Math.sin(titleCam.a * 0.7) * 10, spawn.z + 30 + Math.sin(titleCam.a) * r);
      camera.lookAt(spawn.x - 200, spawn.y + 10, spawn.z - 20);
      hero.update(dt, player, c, time);
    }
    tokens.update(0, time, { x: 1e9, y: 0, z: 0 }, camera);
  }
  traffic.update(dt);
  webs.update(dt, camera);

  // HUD
  if (playing) {
    $("spd").textContent = Math.round(speed * 3.6);
    $("alt").textContent = Math.round(player.p.y - 0.9);
    const d = $("dash");
    d.textContent = "◆".repeat(player.dash) + "◇".repeat(Math.max(0, 3 - player.dash));
    const nt = tokens.nearest(player.p);
    if (nt) {
      tmpV.set(nt.x, nt.y, nt.z).project(camera);
      const on = tmpV.z < 1 && Math.abs(tmpV.x) < 1 && Math.abs(tmpV.y) < 1;
      const mk = $("marker");
      mk.style.display = on ? "block" : "none";
      if (on) {
        mk.style.left = ((tmpV.x * 0.5 + 0.5) * innerWidth) + "px";
        mk.style.top = ((-tmpV.y * 0.5 + 0.5) * innerHeight) + "px";
        mk.textContent = Math.round(Math.hypot(nt.x - player.p.x, nt.y - player.p.y, nt.z - player.p.z)) + " m";
      }
    }
    $("charge").style.width = (player.charge / 0.75 * 100) + "%";
  }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $("toast").classList.remove("on"); }

  // render
  sky.update(camera);
  cityMesh.update(camera);
  camera.updateMatrixWorld();
  csm.update();
  staggerShadows();
  const pc = post.comp.uniforms;
  // sun position on screen for god rays
  sunScreen.copy(sky.sunDir).multiplyScalar(5000).add(camera.position).project(camera);
  const sunVisible = sky.sunDir.y > -0.03 && sunScreen.z < 1 && tmpV.copy(sky.sunDir).dot(chase.fwd) > 0;
  post.opts.rays = Q.rays && sunVisible;
  const ps = { dt, sunScreen: new THREE.Vector3(sunScreen.x * 0.5 + 0.5, sunScreen.y * 0.5 + 0.5, sunVisible ? 1 : 0) };
  const n = skyState.night, tw = skyState.twilight;
  pc.uExposure.value = THREE.MathUtils.lerp(1.1, 1.9, Math.min(1, n * 1.2)) * (1 + (1 - skyState.day) * tw * 0.8);
  pc.uRays.value = 0.35 * skyState.day + 0.25 * tw;
  const sp01 = Math.min(1, Math.max(0, (speed - 20) / 45)) * S.motion * (LOOKS[S.look] || LOOKS.cinematic).blur;
  pc.uSpeed.value = THREE.MathUtils.lerp(pc.uSpeed.value, sp01, 1 - Math.exp(-4 * dt));
  const L = LOOKS[S.look] || LOOKS.cinematic;
  pc.uCA.value = S.motion * L.ca;
  pc.uComic.value = L.comic;
  pc.uTonemap.value = L.tonemap;
  pc.uSat.value = L.sat; pc.uContrast.value = L.contrast; pc.uWarm.value = L.warm;
  pc.uVignette.value = L.vignette; pc.uGrain.value = L.grain; pc.uBloom.value = L.bloom;
  pc.uRays.value *= L.rays;
  pc.uExposure.value *= L.exp;
  post.opts.ao = Q.ao && L.ao > 0; pc.uAO.value = L.ao;
  post.opts.adapt = L.adapt > 0; pc.uAdapt.value = L.adapt;
  // metering target: mid-grey by day, much darker at night so night stays night
  pc.uKey.value = THREE.MathUtils.lerp(0.2, 0.05, Math.min(1, n * 1.1 + tw * 0.3));
  U.uFogBoost.value = L.fog;
  pc.uTime.value = time;
  flash = Math.max(0, flash - dt * 2);
  pc.uFlash.value = flash * 0.5;
  pc.uLetterbox.value = playing ? 0 : 0.06;
  // blur centre follows the travel direction on screen
  if (speed > 5) {
    tmpV.set(player.v.x, player.v.y, player.v.z).normalize().multiplyScalar(200).add(camera.position).project(camera);
    const bx = tmpV.z < 1 ? THREE.MathUtils.clamp(tmpV.x * 0.5 + 0.5, 0.2, 0.8) : 0.5, by = tmpV.z < 1 ? THREE.MathUtils.clamp(tmpV.y * 0.5 + 0.5, 0.2, 0.8) : 0.5;
    pc.uBlurCenter.value.x += (bx - pc.uBlurCenter.value.x) * Math.min(1, dt * 3);
    pc.uBlurCenter.value.y += (by - pc.uBlurCenter.value.y) * Math.min(1, dt * 3);
  }
  post.renderScene(scene, camera);
  post.finish(camera, ps);

  // dynamic resolution: hold ~60 fps
  frames++; fpsT += rawDt;
  if (fpsT > 0.5) {
    fps = frames / fpsT; frames = 0; fpsT = 0;
    cooldown -= 0.5;
    if (S.dynRes) {
      if (fps < 55) { slowT += 0.5; fastT = 0; } else if (fps > 58.5) { fastT += 0.5; slowT = 0; } else { slowT = fastT = 0; }
      let ns = dynScale;
      if (slowT >= 1) { ns = Math.max(Q.minScale, dynScale * (fps < 40 ? 0.82 : 0.92)); slowT = 0; cooldown = 8; }
      else if (fastT >= 3 && cooldown <= 0) { ns = Math.min(Q.maxScale, dynScale * 1.05); fastT = 0; }
      ns = Math.round(ns * 40) / 40;
      if (ns !== dynScale) { dynScale = ns; store.set("scale", dynScale); resize(); }
    }
    if (statsOn) $("stats").textContent = `${fps.toFixed(0)} fps · ${post.w}×${post.h} (${Math.round(post.scale * 100)}%) · ${renderer.info.render.calls} draws · ${(renderer.info.render.triangles / 1e6).toFixed(2)}M tris · ${player.state}`;
  }
}
requestAnimationFrame(frame);
$("loading").classList.add("hidden");

// debug hooks for automated checks
window.WS = {
  shot: (w = 1400) => {
    const c2 = document.createElement("canvas"); c2.width = w; c2.height = Math.round(w * canvas.height / canvas.width);
    c2.getContext("2d").drawImage(canvas, 0, 0, c2.width, c2.height);
    return c2.toDataURL("image/jpeg", 0.88);
  },
  // headless-ish testing: enter play mode without pointer lock; WS.fake = {swing: true, ...} overrides input
  play: () => { playing = true; paused = false; $("title").classList.add("hidden"); $("hud").classList.remove("hidden"); },
  fake: null,
  tick: (n = 1, ms = 16.7) => { for (let i = 0; i < n; i++) tick(last + ms); },  player, chase, camera, post, sky, applyTime, setTimePreset, setLook, S, renderer, input, csm, world, city };
