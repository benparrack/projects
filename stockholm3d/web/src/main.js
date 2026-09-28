import * as THREE from "three";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { fetchBytes, parseHeightmap } from "./data.js";
import { World } from "./world.js";
import { Atmosphere } from "./sky.js";
import { CameraRig } from "./controls.js";
import { shared } from "./materials.js";
import { sunPosition, sunTimes, stockholmToUTC, utcToStockholm, fmtClock } from "./sun.js";

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- renderer
const canvas = $("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const labelRenderer = new CSS2DRenderer({ element: $("labels") });
labelRenderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 60000);
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
});

const progress = (f, text) => {
  $("loading").querySelector("i").style.width = `${Math.round(f * 100)}%`;
  if (text) $("loading").querySelector("span").textContent = text;
};

// ---------------------------------------------------------------- data
const [manifest, hmBuf] = await Promise.all([
  fetch("data/manifest.json").then((r) => r.json()),
  fetchBytes("data/terrain.bin.gz"),
]);
const hm = parseHeightmap(hmBuf);
const heightAt = (x, z) => hm.at(x, z);
const O = manifest.origin;
const toLocal = (lat, lon) => ({ x: (lon - O.lon) * O.mPerDegLon, z: -(lat - O.lat) * O.mPerDegLat });
const toLatLon = (x, z) => ({ lat: O.lat - z / O.mPerDegLat, lon: O.lon + x / O.mPerDegLon });

const world = new World(scene, manifest, hm);
world.buildTerrain();
world.buildWater();
const atmos = new Atmosphere(renderer, scene, O.lat, O.lon);
const rig = new CameraRig(camera, canvas, heightAt);
rig.colliders = world.pickables;

// ---------------------------------------------------------------- state (URL hash)
const state = { ms: Date.now(), speed: 0, season: "auto" };

function landmarkView(l) {
  const target = new THREE.Vector3(l.x, l.ground + l.height * 0.4, l.z);
  const dist = Math.max(l.height * 3.4, 260);
  const az = l.az * Math.PI / 180, el = 0.36;
  const pos = new THREE.Vector3(l.x + Math.sin(az) * Math.cos(el) * dist, target.y + Math.sin(el) * dist,
    l.z - Math.cos(az) * Math.cos(el) * dist);
  return { pos, target };
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const c = p.get("c")?.split(",").map(Number);
  if (c && c.length === 6 && c.every(Number.isFinite)) {
    camera.position.set(c[0], c[1], c[2]);
    rig.orbit.target.set(c[3], c[4], c[5]);
  } else {
    camera.position.set(-900, 700, 1500);
    rig.orbit.target.set(-60, 5, -120);
  }
  const t = p.get("t");
  if (t && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(t)) {
    const [d, hmn] = t.split("T");
    const [y, m, dd] = d.split("-").map(Number);
    const [hh, mm] = hmn.split(":").map(Number);
    state.ms = stockholmToUTC(y, m - 1, dd, hh * 60 + mm);
  }
  if (p.get("s")) state.season = p.get("s");
  camera.lookAt(rig.orbit.target);
  rig.orbit.update();
  const mode = p.get("m");
  if (mode === "fly" || mode === "walk") rig.setMode(mode);
}

let hashTimer = 0;
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const f = rig.focus();
    const r = (v) => Math.round(v);
    const L = utcToStockholm(state.ms);
    const t = `${L.y}-${String(L.m + 1).padStart(2, "0")}-${String(L.d).padStart(2, "0")}T${fmtClock(L.minutes)}`;
    const p = new URLSearchParams({ c: [camera.position.x, camera.position.y, camera.position.z, f.x, f.y, f.z].map(r).join(","), t });
    if (rig.mode !== "orbit") p.set("m", rig.mode);
    if (state.season !== "auto") p.set("s", state.season);
    history.replaceState(null, "", `#${p}`);
  }, 400);
}

// ---------------------------------------------------------------- time UI
function syncTimeUI() {
  const L = utcToStockholm(state.ms);
  $("date").value = `${L.y}-${String(L.m + 1).padStart(2, "0")}-${String(L.d).padStart(2, "0")}`;
  if (document.activeElement !== $("clock")) $("clock").value = Math.floor(L.minutes);
  $("clock-out").textContent = fmtClock(L.minutes);
  if (syncTimeUI.day !== $("date").value) {
    syncTimeUI.day = $("date").value;
    const st = sunTimes(L.y, L.m, L.d, O.lat, O.lon);
    const f = (ms) => (ms == null ? "—" : fmtClock(utcToStockholm(ms).minutes));
    const len = st.sunrise && st.sunset ? (st.sunset - st.sunrise) / 60000 : 0;
    $("suntimes").textContent = `☀ ${f(st.sunrise)} – ${f(st.sunset)} · ${Math.floor(len / 60)}h ${Math.round(len % 60)}m daylight`;
    applySeason();
  }
}
function setLocal(dateStr, minutes) {
  const [y, m, d] = dateStr.split("-").map(Number);
  state.ms = stockholmToUTC(y, m - 1, d, minutes);
  syncTimeUI(); writeHash();
}
$("date").addEventListener("change", () => $("date").value && setLocal($("date").value, Number($("clock").value)));
$("clock").addEventListener("input", () => setLocal($("date").value, Number($("clock").value)));
$("now").addEventListener("click", () => { state.ms = Date.now(); setSpeed(1); syncTimeUI(); writeHash(); });
function setSpeed(s) {
  state.speed = s;
  for (const b of document.querySelectorAll("[data-speed]")) b.classList.toggle("on", Number(b.dataset.speed) === s);
}
for (const b of document.querySelectorAll("[data-speed]")) b.addEventListener("click", () => setSpeed(Number(b.dataset.speed)));
$("season").addEventListener("change", () => { state.season = $("season").value; applySeason(); writeHash(); });

// seasons: snow cover, leaf colour
const LEAF = {
  summer: new THREE.Color(0x4c6e32), spring: new THREE.Color(0x6f9a3a), autumn: new THREE.Color(0xb8782a), bare: new THREE.Color(0x6a5a4a),
};
function applySeason() {
  let s = state.season;
  const L = utcToStockholm(state.ms);
  const doy = (Date.UTC(L.y, L.m, L.d) - Date.UTC(L.y, 0, 1)) / 86400000;
  let snow = 0, leaf = LEAF.summer;
  if (s === "auto") {
    // Stockholm: snow cover mid-Dec to mid-Mar; leaves turn in October, gone by mid-November, back in May
    snow = doy >= 347 || doy < 60 ? 1 : doy < 75 ? (75 - doy) / 15 : doy >= 335 ? (doy - 335) / 12 : 0;
    leaf = doy < 115 || doy >= 318 ? LEAF.bare : doy < 140 ? LEAF.spring : doy >= 275 ? LEAF.autumn : LEAF.summer;
  } else if (s === "winter") { snow = 1; leaf = LEAF.bare; } else if (s === "autumn") { leaf = LEAF.autumn; }
  shared.uSnow.value = snow;
  world.setSeasonLeaves(leaf);
  $("season").value = state.season;
}

// ---------------------------------------------------------------- modes
for (const b of document.querySelectorAll("[data-mode]")) b.addEventListener("click", () => rig.setMode(b.dataset.mode));
rig.onModeChange = (m) => {
  for (const b of document.querySelectorAll("[data-mode]")) b.classList.toggle("on", b.dataset.mode === m);
  $("help").textContent = {
    orbit: "Map: left-drag pan · right-drag rotate · wheel zoom · click a building",
    fly: "Fly: WASD move · E/Q up/down · drag to look · wheel = speed · Shift = fast",
    walk: "Walk: WASD · drag to look · Shift = run",
  }[m];
  writeHash();
};
rig.orbit.addEventListener("change", writeHash);

// ---------------------------------------------------------------- labels
const labels = [];
function addLabel(text, x, y, z, cls, minD, maxD) {
  const el = document.createElement("div");
  el.className = `label ${cls}`;
  el.textContent = text;
  const o = new CSS2DObject(el);
  o.position.set(x, y, z);
  scene.add(o);
  labels.push({ o, el, minD, maxD, landmark: cls === "landmark" });
}
for (const l of manifest.labels) {
  addLabel(l.name, l.x, heightAt(l.x, l.z) + 40, l.z, l.rank ? "minor" : "", l.rank ? 250 : 700, l.rank ? 3500 : 11000);
}
for (const l of manifest.landmarks) addLabel(l.name, l.x, l.ground + l.height + 12, l.z, "landmark", 0, 3000);
function updateLabels() {
  const walking = rig.mode === "walk";
  for (const l of labels) {
    const d = camera.position.distanceTo(l.o.position);
    // at street level district names float through buildings; keep only nearby landmarks
    const a = walking && (!l.landmark || d > 1200) ? 0 : d < l.minD ? 0 : d > l.maxD ? 0 : Math.min(1, (d - l.minD) / (l.minD * 0.5 + 1), (l.maxD - d) / (l.maxD * 0.3));
    l.el.style.opacity = a.toFixed(2);
    l.o.visible = a > 0.02;
  }
}

// ---------------------------------------------------------------- landmarks + search
for (const [i, l] of manifest.landmarks.entries()) {
  const o = document.createElement("option");
  o.value = i; o.textContent = l.name;
  $("landmarks").append(o);
}
$("landmarks").addEventListener("change", (e) => {
  const l = manifest.landmarks[e.target.value];
  if (l) { const v = landmarkView(l); rig.flyTo(v.pos, v.target); }
  e.target.value = "";
  e.target.blur();
});

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const index = [
  ...manifest.landmarks.map((l) => ({ n: l.name, x: l.x, z: l.z, h: l.height, k: "landmark", lm: l })),
  ...manifest.labels.map((l) => ({ n: l.name, x: l.x, z: l.z, h: 0, k: "district" })),
  ...manifest.search,
].map((e) => ({ ...e, key: norm(e.n) }));
let sel = 0, hits = [];
function showResults() {
  const q = norm($("q").value.trim());
  const ul = $("results");
  if (!q) { ul.hidden = true; return; }
  hits = index.filter((e) => e.key.includes(q))
    .sort((a, b) => (b.key.startsWith(q) - a.key.startsWith(q)) || (b.k === "landmark") - (a.k === "landmark") || a.n.length - b.n.length)
    .slice(0, 12);
  sel = 0;
  ul.innerHTML = "";
  hits.forEach((h, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span></span><small></small>`;
    li.firstChild.textContent = h.n;
    li.lastChild.textContent = h.k.replaceAll("_", " ");
    li.classList.toggle("sel", i === sel);
    li.addEventListener("mousedown", (e) => { e.preventDefault(); go(h); });
    ul.append(li);
  });
  ul.hidden = hits.length === 0;
}
function go(h) {
  $("results").hidden = true;
  $("q").blur();
  if (h.lm) { const v = landmarkView(h.lm); rig.flyTo(v.pos, v.target); return; }
  const g = heightAt(h.x, h.z);
  const H = Math.max(h.h || 15, 15);
  const d = h.k === "district" || h.k === "suburb" ? 1400 : Math.max(H * 4, 220);
  const dir = new THREE.Vector3().subVectors(camera.position, rig.orbit.target).setY(0).normalize();
  if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(0, 0, 1);
  const target = new THREE.Vector3(h.x, g + H * 0.4, h.z);
  rig.flyTo(target.clone().addScaledVector(dir, d * 0.85).setY(target.y + d * 0.5), target);
}
$("q").addEventListener("input", showResults);
$("q").addEventListener("keydown", (e) => {
  const lis = [...$("results").children];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + lis.length) % Math.max(lis.length, 1);
    lis.forEach((li, i) => li.classList.toggle("sel", i === sel));
  } else if (e.key === "Enter" && hits[sel]) go(hits[sel]);
  else if (e.key === "Escape") { $("results").hidden = true; $("q").blur(); }
});
$("q").addEventListener("blur", () => setTimeout(() => ($("results").hidden = true), 150));

// ---------------------------------------------------------------- picking
const ray = new THREE.Raycaster();
let highlight = null;
const hlMat = new THREE.MeshBasicMaterial({ color: 0xffc640, transparent: true, opacity: 0.45, depthWrite: false, fog: false });
let down = null;
canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener("pointerup", async (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || e.button !== 0) return;
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(world.pickables, false)[0];
  if (!hit) { clearPick(); return; }
  const { idx, info } = await world.infoFor(hit.object, hit.faceIndex);
  clearPick();
  highlight = new THREE.Mesh(world.highlightGeometry(hit.object, idx), hlMat);
  highlight.renderOrder = 2;
  scene.add(highlight);
  showInfo(info, highlight.geometry.boundingBox, hit.point);
});
function clearPick() {
  if (highlight) { scene.remove(highlight); highlight.geometry.dispose(); highlight = null; }
  $("info").hidden = true;
}
$("info-close").addEventListener("click", clearPick);
addEventListener("keydown", (e) => { if (e.key === "Escape") clearPick(); });

const KIND = {
  yes: "Building", apartments: "Apartments", residential: "Residential", commercial: "Commercial", office: "Offices",
  retail: "Retail", church: "Church", cathedral: "Cathedral", chapel: "Chapel", public: "Public building", civic: "Civic",
  government: "Government", university: "University", school: "School", hospital: "Hospital", hotel: "Hotel",
  industrial: "Industrial", warehouse: "Warehouse", house: "House", townhall: "Town hall", museum: "Museum",
  palace: "Palace", train_station: "Railway station", transportation: "Transport", garage: "Garage", shed: "Shed",
};
function showInfo(info, bbox, point) {
  const t = (s) => document.createTextNode(s);
  const title = info.name || (info.structure === "bridge" ? "Bridge" : info.structure === "pier" ? "Pier"
    : info["addr:street"] ? `${info["addr:street"]} ${info["addr:housenumber"] || ""}` : KIND[info.building] || "Building");
  $("info-title").textContent = title;
  const sub = info.structure ? (info.highway ? `${info.highway.replaceAll("_", " ")} bridge` : info.railway ? `${info.railway.replaceAll("_", " ")} bridge` : info.structure)
    : [KIND[info.building] || info.building?.replaceAll("_", " "), info.amenity?.replaceAll("_", " "), info.tourism]
      .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" · ");
  $("info-sub").textContent = sub || "";
  const dl = $("info-list");
  dl.replaceChildren();
  const row = (k, v) => { if (v == null || v === "") return; const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = k; dd.append(typeof v === "string" ? t(v) : v); dl.append(dt, dd); };
  const top = bbox.max.y, ground = heightAt((bbox.min.x + bbox.max.x) / 2, (bbox.min.z + bbox.max.z) / 2);
  if (info.name && info["addr:street"]) row("Address", `${info["addr:street"]} ${info["addr:housenumber"] || ""}`.trim());
  row("Height", info.height ? `${info.height.replace(/ ?m$/, "")} m` : info.structure ? null : `≈ ${Math.round(top - Math.min(ground, bbox.min.y))} m (estimated)`);
  row("Levels", info["building:levels"]);
  row("Length", info.length_m ? `${info.length_m} m` : null);
  row("Built", info.start_date);
  row("Architect", info.architect?.replaceAll(";", ", "));
  row("Roof", info["roof:shape"]?.replaceAll("_", " "));
  row("Material", info["building:material"]);
  row("Also known as", info.alt_name || info.old_name);
  row("About", info.description);
  const ll = toLatLon(point.x, point.z);
  row("Location", `${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)}`);
  const links = $("info-links");
  links.replaceChildren();
  const a = (href, text) => { const el = document.createElement("a"); el.href = href; el.target = "_blank"; el.rel = "noopener"; el.textContent = text; links.append(el, t("  ")); };
  if (info.wikipedia) {
    const [lang, ...rest] = info.wikipedia.split(":");
    a(`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(rest.join(":").replaceAll(" ", "_"))}`, "Wikipedia");
  }
  if (info.website) a(info.website, "Website");
  if (info.id) {
    const kind = { w: "way", r: "relation", n: "node" }[info.id[0]];
    if (kind) a(`https://www.openstreetmap.org/${kind}/${info.id.slice(1)}`, "OpenStreetMap");
  }
  $("info").hidden = false;
}

// ---------------------------------------------------------------- boot
readHash();
syncTimeUI();
world.focus.copy(rig.focus());
world.updateGround(camera.position);
const treesP = world.loadTrees();
let firstFrame = false;
world.loadMeshTiles((n, N) => progress(n / N, `Loading buildings… ${n}/${N}`)).then(async () => {
  await treesP;
  $("loading").classList.add("done");
  window.__ready = true;
});
applySeason();

let last = performance.now(), groundTimer = 0, cullTimer = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state.speed) {
    state.ms += dt * 1000 * state.speed;
    syncTimeUI();
    if (Math.floor(now / 1000) !== Math.floor((now - dt * 1000) / 1000)) writeHash();
  }
  rig.update(dt);
  const pos = sunPosition(state.ms, O.lat, O.lon);
  const L = utcToStockholm(state.ms);
  // fewer windows lit after midnight
  shared.uLitShare.value = L.minutes > 60 && L.minutes < 330 ? 0.18 : 0.5;
  atmos.update(pos, state.ms, camera, rig.focus(), rig.distance());
  atmos.sky.material.uniforms.time.value = now / 1000;
  world.animate(now / 1000);
  if ((groundTimer -= dt) < 0) { groundTimer = 0.5; world.updateGround(camera.position); world.cull(camera.position); }
  if ((cullTimer -= dt) < 0) { cullTimer = 0.1; updateLabels(); }
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  if (!firstFrame) { firstFrame = true; progress(0.02); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// debugging / automated screenshots
window.s3d = { THREE, scene, camera, rig, world, state, atmos, manifest, landmarkView, toLocal, toLatLon,
  setTime(iso) { const [d, t] = iso.split("T"); const [h, m] = t.split(":").map(Number); setLocal(d, h * 60 + m); },
  view(name) { const l = manifest.landmarks.find((x) => x.name === name); const v = landmarkView(l); camera.position.copy(v.pos); rig.orbit.target.copy(v.target); camera.lookAt(v.target); rig.orbit.update(); },
  groundPending: () => world.queue.pending };
