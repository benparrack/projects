// Ring races (courses are built in courses.js). Fly through the start ring (or press G to be dropped in
// front of the next course) to start the clock. The best run per course is saved
// with its splits and a ghost you race against.
import * as THREE from "three";
import { COURSES, buildCourse, fmtTime } from "./courses.js";
export { fmtTime };

const store = {
  get(k, d) { try { const v = localStorage.getItem("webslinger." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("webslinger." + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const fmt = fmtTime;

export class Races {
  constructor(scene, world) {
    this.world = world;
    this.courses = COURSES.map((c, i) => ({ ...c, i, rings: buildCourse(c, world), best: store.get(`race${i}.best`, null), splits: store.get(`race${i}.splits`, null) }));
    this.active = null;       // {c, k (next ring), t, splits, ghostRec}
    this.pick = 0;            // course G teleports to next
    this.msg = null;          // HUD message; main shows it and clears it
    this.lastDelta = null;
    // meshes: one pool of rings for the active course (+ beacons at every start)
    const glow = (col, o = 1) => {
      const m = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      m.fog = false;
      return m;
    };
    this.ringGeo = new THREE.TorusGeometry(1, 0.045, 10, 64);
    this.matNext = glow(new THREE.Color(0.4, 2.4, 3.2));
    this.matLater = glow(new THREE.Color(0.1, 0.5, 0.7), 0.6);
    this.matStart = glow(new THREE.Color(3.0, 1.7, 0.3));
    this.pool = [];
    for (let k = 0; k < 40; k++) {
      const m = new THREE.Mesh(this.ringGeo, this.matLater);
      m.visible = false; m.frustumCulled = false;
      scene.add(m); this.pool.push(m);
    }
    // start beacons: tall soft light columns + the start ring itself
    const bg = new THREE.CylinderGeometry(1.6, 1.6, 600, 16, 1, true); bg.translate(0, 300, 0);
    const bmat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: "varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = position.y; vec4 w = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }",
      fragmentShader: "uniform float uTime; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float e = pow(abs(dot(vN, vV)), 1.5); float f = exp(-vY / 220.0) * (0.75 + 0.25 * sin(vY * 0.05 - uTime * 3.0)); gl_FragColor = vec4(vec3(2.4, 1.4, 0.3) * e * f * 0.55, 1.0); }",
    });
    this.beaconMat = bmat;
    this.beacons = this.courses.map((c) => {
      const s = c.rings[0];
      const b = new THREE.Mesh(bg, bmat); b.position.set(s.x, 0, s.z); b.frustumCulled = false;
      const r = new THREE.Mesh(this.ringGeo, this.matStart); this.place(r, s, 1.15); r.frustumCulled = false;
      scene.add(b, r);
      return { b, r };
    });
    // ghost: a glowing orb with a short trail
    this.ghost = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), glow(new THREE.Color(1.6, 0.5, 2.6), 0.9));
    this.ghost.visible = false; this.ghost.frustumCulled = false;
    const tg = new THREE.BufferGeometry();
    this.trailN = 24;
    tg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.trailN * 3), 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: new THREE.Color(1.2, 0.4, 2.0), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.trail.visible = false; this.trail.frustumCulled = false;
    scene.add(this.ghost, this.trail);
    this.prev = { x: 0, y: 0, z: 0 };
  }

  place(m, r, s = 1) {
    m.position.set(r.x, r.y, r.z);
    m.lookAt(r.x + r.nx, r.y, r.z + r.nz);
    m.scale.setScalar(r.r * s);
  }

  /** drop the player 70 m in front of the next course's start ring */
  teleport(pl) {
    const c = this.courses[this.pick];
    this.pick = (this.pick + 1) % this.courses.length;
    this.cancel();
    const s = c.rings[0];
    pl.p.x = s.x - s.nx * 70; pl.p.z = s.z - s.nz * 70; pl.p.y = s.y + 14;
    pl.v.x = s.nx * 26; pl.v.z = s.nz * 26; pl.v.y = 4;
    Object.assign(pl.pp, pl.p); Object.assign(pl.rp, pl.p);
    pl.set("air"); pl.airT = 0; pl.releaseT = 0.3;
    pl.facing = Math.atan2(-s.nx, -s.nz);
    this.msg = { big: c.name, small: c.best ? "Best " + fmt(c.best) + " · fly through the gold ring" : "Fly through the gold ring to start" };
    return Math.atan2(-s.nx, -s.nz);
  }

  cancel() {
    if (!this.active) return;
    this.active = null;
    this.ghost.visible = this.trail.visible = false;
    this.msg = { big: "Race cancelled", small: "" };
  }

  start(c) {
    this.active = { c, k: 1, t: 0, splits: [0], rec: [], recT: 0, ghost: store.get(`race${c.i}.ghost`, null) };
    this.lastDelta = null;
    this.msg = { big: c.name, small: "GO!" };
  }

  /** crossed ring r between positions a and b (generous radius) */
  crossed(r, a, b) {
    const da = (a.x - r.x) * r.nx + (a.z - r.z) * r.nz, db = (b.x - r.x) * r.nx + (b.z - r.z) * r.nz;
    if (da > 0.5 || db < -0.5 || (da < -0.5 && db < -0.5)) return false;
    const t = da === db ? 1 : Math.min(1, Math.max(0, -da / (db - da)));
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
    return Math.hypot(x - r.x, y - r.y, z - r.z) < r.r * 1.35;
  }

  /** returns an event: "start" | "ring" | "finish" | null */
  update(dt, t, pl) {
    this.beaconMat.uniforms.uTime.value = t;
    const a = this.prev, b = pl.p;
    let ev = null;
    const A = this.active;
    if (!A) {
      for (const c of this.courses) if (this.crossed(c.rings[0], a, b)) { this.start(c); ev = "start"; break; }
    } else {
      A.t += dt;
      const rs = A.c.rings, r = rs[A.k];
      // record the ghost at 20 Hz
      A.recT -= dt;
      if (A.recT <= 0) { A.recT += 0.05; A.rec.push(Math.round(b.x * 10), Math.round(b.y * 10), Math.round(b.z * 10)); }
      if (this.crossed(r, a, b)) {
        A.splits.push(A.t);
        const bs = A.c.splits;
        this.lastDelta = bs && bs[A.k] != null ? A.t - bs[A.k] : null;
        A.k++;
        ev = "ring";
        if (A.k >= rs.length) ev = this.finish();
      }
    }
    this.prev.x = b.x; this.prev.y = b.y; this.prev.z = b.z;
    this.draw(t);
    return ev;
  }

  finish() {
    const A = this.active, c = A.c;
    const prev = c.best, isBest = prev == null || A.t < prev;
    if (isBest) {
      c.best = A.t; c.splits = A.splits;
      store.set(`race${c.i}.best`, A.t); store.set(`race${c.i}.splits`, A.splits); store.set(`race${c.i}.ghost`, A.rec);
    }
    this.msg = { big: (isBest ? "New best! " : "Finished ") + fmt(A.t), small: prev == null ? c.name : (A.t < prev ? "−" : "+") + Math.abs(A.t - prev).toFixed(2) + " vs best " + fmt(prev) };
    this.result = { t: A.t, best: isBest };
    this.active = null;
    this.ghost.visible = this.trail.visible = false;
    return "finish";
  }

  draw(t) {
    const A = this.active;
    this.pool.forEach((m) => (m.visible = false));
    this.beacons.forEach(({ b, r }) => { b.visible = r.visible = !A; r.rotation.z = t * 0.6; });
    if (!A) return;
    const rs = A.c.rings;
    for (let k = A.k, n = 0; k < rs.length && n < 3; k++, n++) {
      const m = this.pool[n];
      m.visible = true; m.material = n === 0 ? this.matNext : this.matLater;
      this.place(m, rs[k], n === 0 ? 1 + 0.05 * Math.sin(t * 6) : 1);
    }
    // ghost playback
    const g = A.ghost;
    if (g && g.length >= 6) {
      const f = A.t / 0.05, i = Math.floor(f), n = g.length / 3;
      if (i < n - 1) {
        const u = f - i, o = i * 3;
        this.ghost.position.set((g[o] + (g[o + 3] - g[o]) * u) / 10, (g[o + 1] + (g[o + 4] - g[o + 1]) * u) / 10, (g[o + 2] + (g[o + 5] - g[o + 2]) * u) / 10);
        this.ghost.visible = this.trail.visible = true;
        const pa = this.trail.geometry.attributes.position;
        for (let k = 0; k < this.trailN; k++) {
          const j = Math.max(0, i - k) * 3;
          if (k === 0) pa.setXYZ(0, this.ghost.position.x, this.ghost.position.y, this.ghost.position.z);
          else pa.setXYZ(k, g[j] / 10, g[j + 1] / 10, g[j + 2] / 10);
        }
        pa.needsUpdate = true;
      } else this.ghost.visible = this.trail.visible = false;
    }
  }

  /** next ring position (for the HUD pointer / minimap) */
  next() { const A = this.active; return A ? A.c.rings[A.k] : null; }
}
