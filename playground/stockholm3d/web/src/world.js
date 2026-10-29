// Scene content: terrain tiles (streamed ground textures), building/bridge
// tiles, trees, water.
import * as THREE from "three";
import { fetchBytes, parseMeshTile, parseTrees, Queue } from "./data.js";
import { buildingMaterial, terrainMaterial, treeMaterial, waterNormals, shared } from "./materials.js";

const DATA = "data/";

export class World {
  constructor(scene, manifest, hm) {
    this.scene = scene;
    this.man = manifest;
    this.hm = hm;
    this.T = manifest.tileSize;
    this.g = manifest.grid;
    this.queue = new Queue(6);
    this.pickables = [];
    this.buildingMat = buildingMaterial();
    this.terrainTiles = new Map();
    this.meshTiles = [];
    this.treeChunks = [];
    this.loaded = 0;
    this.total = 0;
    this.focus = new THREE.Vector3();
  }

  tileCentre(i, j) {
    return new THREE.Vector3(this.g.x0 + (i + 0.5) * this.T, 0, this.g.z0 + (j + 0.5) * this.T);
  }

  // ---------------- terrain
  buildTerrain() {
    const placeholder = new THREE.DataTexture(new Uint8Array([168, 164, 156, 0]), 1, 1);
    placeholder.colorSpace = THREE.SRGBColorSpace;
    placeholder.needsUpdate = true;
    const N = 50;  // quads per side (10 m)
    const V = (N + 1) * (N + 1), SK = 4 * (N + 1);  // grid + skirt vertices
    const { hm } = this;
    const maxX = hm.x0 + (hm.cols - 1) * hm.step, maxZ = hm.z0 + (hm.rows - 1) * hm.step;
    this.terrainLods = [1, 2, 5, 10].map((k) => terrainIndex(N, k));
    for (let i = 0; i < this.g.nx; i++) for (let j = 0; j < this.g.nz; j++) {
      const x0 = this.g.x0 + i * this.T, z0 = this.g.z0 + j * this.T;
      const pos = new Float32Array((V + SK) * 3), uv = new Float32Array((V + SK) * 2);
      const nrm = new Float32Array(pos.length);
      for (let r = 0; r <= N; r++) for (let c = 0; c <= N; c++) {
        const k = r * (N + 1) + c;
        const x = Math.min(x0 + c * this.T / N, maxX), z = Math.min(z0 + r * this.T / N, maxZ);
        const y = hm.at(x, z);
        pos.set([x, y, z], k * 3);
        uv.set([(x - x0) / this.T, (z - z0) / this.T], k * 2);
        const e = 5;
        const n = new THREE.Vector3(hm.at(x - e, z) - hm.at(x + e, z), 2 * e, hm.at(x, z - e) - hm.at(x, z + e)).normalize();
        nrm.set([n.x, n.y, n.z], k * 3);
      }
      // skirt: a copy of each border vertex 4 m lower hides cracks between LODs
      skirtVertices(N).forEach((g, s) => {
        const d = V + s;
        pos.set([pos[g * 3], pos[g * 3 + 1] - 4, pos[g * 3 + 2]], d * 3);
        nrm.set(nrm.subarray(g * 3, g * 3 + 3), d * 3);
        uv.set(uv.subarray(g * 2, g * 2 + 2), d * 2);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      geo.setIndex(this.terrainLods[0]);
      geo.computeBoundingSphere();
      const mat = terrainMaterial(placeholder);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
      this.terrainTiles.set(`${i}_${j}`, { i, j, mesh, mat, blob: null, res: 0, want: 0, busy: false, lod: 0 });
    }
  }

  // ground texture LOD: 2048 px (separate hi-res file) right around a low camera,
  // 1024 near, 512 mid-range, 256 far
  async updateGround(camPos) {
    for (const t of this.terrainTiles.values()) {
      const c = this.tileCentre(t.i, t.j);
      const d = Math.hypot(c.x - camPos.x, c.z - camPos.z) - this.T * 0.7;
      const alt = Math.max(camPos.y, 0);
      const e = Math.hypot(Math.max(d, 0), alt * 0.6);
      t.want = e < 260 ? 2048 : e < 900 ? 1024 : e < 2600 ? 512 : 256;
      t.dist = e;
      const lod = e < 1500 ? 0 : e < 3500 ? 1 : e < 7000 ? 2 : 3;
      if (lod !== t.lod) { t.lod = lod; t.mesh.geometry.setIndex(this.terrainLods[lod]); }
      if (t.want !== t.res && !t.busy) {
        t.busy = true;
        this.queue.push(e + (t.res ? 5000 : 0), () => this.loadGround(t)).finally(() => { t.busy = false; });
      }
    }
    this.queue.reprioritize((j) => j.priority);
  }

  async loadGround(t) {
    const res = t.want;
    const hi = res > 1024;
    if (hi ? !t.hblob : !t.blob) {
      const r = await fetch(`${DATA}ground/${hi ? "h" : "g"}_${t.i}_${t.j}.webp`);
      if (!r.ok) return;
      if (hi) t.hblob = await r.blob(); else t.blob = await r.blob();
    }
    // Firefox garbles alpha (the street-light mask) when resizing with "medium"/"high"
    // quality and premultiplyAlpha "none", so skip resizing at native size and use "low" otherwise.
    const opts = { premultiplyAlpha: "none", colorSpaceConversion: "none", imageOrientation: "none" };
    if (res < 1024) Object.assign(opts, { resizeWidth: res, resizeHeight: res, resizeQuality: "low" });
    const bmp = await createImageBitmap(hi ? t.hblob : t.blob, opts);
    if (!hi) t.hblob = null;  // drop the big blob once we've moved away
    const tex = new THREE.Texture(bmp);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.premultiplyAlpha = false;
    tex.anisotropy = 16;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    const old = t.mat.map;
    t.mat.map = tex;
    if (old && old.image instanceof ImageBitmap) { old.dispose(); old.image.close?.(); }
    t.res = res;
  }

  // ---------------- buildings + structures
  loadMeshTiles(onProgress) {
    const jobs = [];
    for (const k of this.man.buildingTiles) jobs.push(["b", "i", k]);
    for (const k of this.man.structureTiles) jobs.push(["s", "si", k]);
    this.total = jobs.length;
    const f = this.focus;
    const all = jobs.map(([p, ip, k]) => {
      const [i, j] = k.split("_").map(Number);
      const c = this.tileCentre(i, j);
      return this.queue.push(Math.hypot(c.x - f.x, c.z - f.z) - 1e5, async () => {
        const buf = await fetchBytes(`${DATA}tiles/${p}_${k}.bin.gz`);
        const tile = parseMeshTile(buf);
        this.addMeshTile(tile, `${DATA}tiles/${ip}_${k}.json`, p === "s");
        this.loaded++;
        onProgress?.(this.loaded, this.total);
      });
    });
    return Promise.all(all);
  }

  addMeshTile(tile, infoUrl, isStructure) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(tile.position, 3));
    const nib = new THREE.InterleavedBuffer(tile.normal, 4);
    geo.setAttribute("normal", new THREE.InterleavedBufferAttribute(nib, 3, 0, true));
    geo.setAttribute("aFlags", new THREE.InterleavedBufferAttribute(nib, 1, 3, false));
    const cib = new THREE.InterleavedBuffer(tile.color, 4);
    geo.setAttribute("color", new THREE.InterleavedBufferAttribute(cib, 3, 0, true));
    geo.setAttribute("aSeed", new THREE.InterleavedBufferAttribute(cib, 1, 3, true));
    geo.setAttribute("aBase", new THREE.BufferAttribute(this.buildingBases(tile), 2));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, this.buildingMat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.userData = { owner: tile.owner, infoUrl, info: null, structure: isStructure };
    this.scene.add(mesh);
    this.dirty = true;
    this.pickables.push(mesh);
    this.meshTiles.push(mesh);
  }

  /** Per-vertex (base height, sits-on-terrain) of each vertex's building, so the
   *  facade shader can align floors and draw a ground floor. */
  buildingBases(tile) {
    const { position: P, owner, T } = tile;
    const minY = new Map(), at = new Map();
    for (let t = 0; t < T; t++) {
      const o = owner[t];
      for (let k = 0; k < 3; k++) {
        const y = P[t * 9 + k * 3 + 1];
        if (!(minY.get(o) <= y)) { minY.set(o, y); at.set(o, t * 9 + k * 3); }
      }
    }
    const grounded = new Map();
    for (const [o, y] of minY) {
      const i = at.get(o);
      grounded.set(o, y < this.hm.at(P[i], P[i + 2]) + 1.5 ? 1 : 0);
    }
    const out = new Float32Array(T * 6);
    for (let t = 0; t < T; t++) {
      const o = owner[t], y = minY.get(o), g = grounded.get(o);
      for (let k = 0; k < 3; k++) { out[t * 6 + k * 2] = y; out[t * 6 + k * 2 + 1] = g; }
    }
    return out;
  }

  async infoFor(mesh, faceIndex) {
    const ud = mesh.userData;
    if (!ud.info) ud.info = await (await fetch(ud.infoUrl)).json();
    const idx = ud.owner[faceIndex];
    return { idx, info: ud.info[idx] };
  }

  /** Geometry of every triangle of building `idx` in `mesh`, for highlighting. */
  highlightGeometry(mesh, idx) {
    const own = mesh.userData.owner, P = mesh.geometry.attributes.position.array;
    const out = [];
    for (let t = 0; t < own.length; t++) if (own[t] === idx) for (let k = 0; k < 9; k++) out.push(P[t * 9 + k]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(out), 3));
    g.computeBoundingBox();
    return g;
  }

  // ---------------- trees
  async loadTrees() {
    const trees = parseTrees(await fetchBytes(`${DATA}trees.bin.gz`));
    const geos = [broadleafGeometry(), coniferGeometry()];
    this.treeMats = [treeMaterial(false), treeMaterial(true)];
    const CH = 1000;
    const chunks = new Map();
    for (const t of trees) {
      const key = `${Math.floor(t.x / CH)}_${Math.floor(t.z / CH)}_${t.kind}`;
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key).push(t);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    for (const [key, list] of chunks) {
      const kind = Number(key.split("_")[2]);
      const im = new THREE.InstancedMesh(geos[kind], this.treeMats[kind], list.length);
      list.forEach((t, i) => {
        const r = (t.seed % 997) / 997;
        const w = t.h * (kind ? 0.36 : 0.55) * (0.8 + 0.4 * r);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t.seed * 0.01);
        m.compose(p.set(t.x, t.y - 0.3, t.z), q, s.set(w / 10, t.h / 10, w / 10));
        im.setMatrixAt(i, m);
        const v = 0.8 + 0.4 * ((t.seed >> 5) % 101) / 100;
        im.setColorAt(i, col.setRGB(v, v * (0.95 + 0.1 * r), v * 0.9, THREE.LinearSRGBColorSpace));
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = im.receiveShadow = true;
      im.matrixAutoUpdate = false;
      this.scene.add(im);
      this.treeChunks.push(im);
      this.dirty = true;
    }
  }

  setSeasonLeaves(colorBroadleaf) {
    if (this.treeMats) this.treeMats[0].userData.leaf.value.copy(colorBroadleaf);
  }

  // hide far tree chunks (the fog swallows them anyway)
  cull(camPos) {
    for (const im of this.treeChunks) {
      const c = im.boundingSphere.center;
      const v = Math.hypot(c.x - camPos.x, c.z - camPos.z) < 3200 + camPos.y * 2;
      if (v !== im.visible) { im.visible = v; this.dirty = true; }
    }
  }

  // ---------------- water + surroundings
  buildWater() {
    const b = { x0: this.g.x0, z0: this.g.z0, x1: this.g.x0 + this.hm.step * (this.hm.cols - 1), z1: this.g.z0 + this.hm.step * (this.hm.rows - 1) };
    this.bounds = b;
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    const nm = waterNormals();
    nm.repeat.set(w / 60, d / 60);
    this.waterNormal = nm;
    const mat = new THREE.MeshStandardMaterial({ color: 0x173444, roughness: 0.06, metalness: 0.0, normalMap: nm,
      normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.7 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uNight;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.002, 0.004, 0.008) * uNight;");
    };
    const water = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    water.rotation.x = -Math.PI / 2;
    water.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
    water.receiveShadow = true;
    this.scene.add(water);
    this.water = water;
    // everything outside the data: a dull land skirt that the fog blends away
    const skirt = new THREE.MeshStandardMaterial({ color: 0x5a6150, roughness: 1 });
    const S = 60000;
    const add = (x0, z0, x1, z1) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), skirt);
      m.rotation.x = -Math.PI / 2;
      m.position.set((x0 + x1) / 2, 1.2, (z0 + z1) / 2);
      m.receiveShadow = false;
      this.scene.add(m);
    };
    add(b.x0 - S, b.z0 - S, b.x1 + S, b.z0);
    add(b.x0 - S, b.z1, b.x1 + S, b.z1 + S);
    add(b.x0 - S, b.z0, b.x0, b.z1);
    add(b.x1, b.z0, b.x1 + S, b.z1);
  }

  animate(t) {
    if (this.waterNormal) this.waterNormal.offset.set(t * 0.004, t * 0.0025);
  }
}

function withAttrs(geo, crown, rgb) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  g.setAttribute("aCrown", new THREE.BufferAttribute(new Float32Array(n).fill(crown), 1));
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(rgb, i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}

function merge(parts) {
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "color", "aCrown"]) {
    const arrs = parts.map((p) => p.attributes[name].array);
    const len = arrs.reduce((s, a) => s + a.length, 0);
    const a = new Float32Array(len);
    let o = 0;
    for (const x of arrs) { a.set(x, o); o += x.length; }
    out.setAttribute(name, new THREE.BufferAttribute(a, parts[0].attributes[name].itemSize));
  }
  out.computeBoundingSphere();
  return out;
}

// unit trees 10 m tall, 10 m wide (instances scale them)
function broadleafGeometry() {
  const trunk = new THREE.CylinderGeometry(0.35, 0.5, 4.5, 5, 1, true).translate(0, 2.25, 0);
  const crown = new THREE.IcosahedronGeometry(5, 0).scale(1, 1.15, 1).translate(0, 5.6, 0);
  return merge([withAttrs(trunk, 0, [0.36, 0.29, 0.22]), withAttrs(crown, 1, [1, 1, 1])]);
}

function coniferGeometry() {
  const trunk = new THREE.CylinderGeometry(0.25, 0.4, 3, 5, 1, true).translate(0, 1.5, 0);
  const low = new THREE.ConeGeometry(5, 6, 7, 1, true).translate(0, 4.5, 0);
  const high = new THREE.ConeGeometry(3.4, 5, 7, 1, true).translate(0, 7.5, 0);
  return merge([withAttrs(trunk, 0, [0.33, 0.26, 0.2]), withAttrs(low, 1, [1, 1, 1]), withAttrs(high, 1, [0.92, 0.95, 0.92])]);
}

// border vertex of each skirt vertex: top row, bottom row, left column, right column
function skirtVertices(N) {
  const out = [];
  for (let c = 0; c <= N; c++) out.push(c);
  for (let c = 0; c <= N; c++) out.push(N * (N + 1) + c);
  for (let r = 0; r <= N; r++) out.push(r * (N + 1));
  for (let r = 0; r <= N; r++) out.push(r * (N + 1) + N);
  return out;
}

/** Index buffer for a terrain tile using every k-th grid vertex, plus skirts. */
function terrainIndex(N, k) {
  const V = (N + 1) * (N + 1), idx = [];
  for (let r = 0; r < N; r += k) for (let c = 0; c < N; c += k) {
    const a = r * (N + 1) + c, b = a + k, d = a + k * (N + 1), e = d + k;
    idx.push(a, d, b, b, d, e);
  }
  for (let side = 0; side < 4; side++) for (let t = 0; t < N; t += k) {
    const s0 = side * (N + 1) + t, s1 = s0 + k;
    const g = skirtVertices(N);
    const a = g[s0], b = g[s1], sa = V + s0, sb = V + s1;
    idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);  // both windings
  }
  return new THREE.BufferAttribute(V + 4 * (N + 1) > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1);
}
