// Pigeons: small flocks perched along rooftop parapets and pecking around the
// park. Swing past, land nearby or stick a web close to them and the flock
// bursts off the ledge (staggered, wings clapping), circles out over the street,
// and drifts back to its perch once you've gone. Instanced (body + two wings).
import * as THREE from "three";
import { G, rng } from "./city.js";
import { fogPatch } from "./materials.js";
import { mergeGeos } from "./cityMesh.js";

const damp = (k, dt) => 1 - Math.exp(-k * dt);

function colored(g, c) {
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute("uv");
  const a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) a.set(c, i);
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return g;
}

// pigeon colour morphs: blue bar (most), dark checker, pale, brown
const MORPHS = [[1, 1, 1], [1, 1, 1], [1, 1, 1], [0.62, 0.62, 0.66], [1.5, 1.48, 1.45], [1.15, 0.9, 0.72]];

export class Birds {
  constructor(scene, city, world) {
    const r = rng(4242);
    this.w = world;
    this.flocks = [];
    this.birds = [];
    const add = (pts, perch) => {
      const f = { birds: [], cx: 0, cy: 0, cz: 0, scared: false, t: 0, perch };
      for (const [x, y, z, h] of pts) {
        const b = { f, hx: x, hy: y, hz: z, hh: h, x, y, z, h, pitch: 0, vx: 0, vy: 0, vz: 0,
          flying: false, t: 0, delay: 0, phase: r() * 10, flap: 0, s: 0.9 + r() * 0.3, back: 9 + r() * 6,
          orbit: r() < 0.5 ? 1 : -1, peck: r() * 4 };
        f.birds.push(b); this.birds.push(b);
        f.cx += x / pts.length; f.cy += y / pts.length; f.cz += z / pts.length;
      }
      this.flocks.push(f);
    };
    // rooftop parapets (the 1.1 m wall around most roofs, 0.5 m thick)
    const lots = city.lots.filter((L) => L.y < 140 && L.x1 - L.x0 > 10 && L.z1 - L.z0 > 10);
    for (let k = 0, tries = 0; k < 130 && lots.length && tries < 2000; tries++) {
      const L = lots[Math.floor(r() * lots.length)];
      const side = Math.floor(r() * 4), n = 3 + Math.floor(r() * 6);
      const y = L.y + 1.1;
      const alongX = side < 2, len = alongX ? L.x1 - L.x0 : L.z1 - L.z0;
      const s0 = 2 + r() * Math.max(0, len - 4 - n * 0.7);
      const edge = side === 0 ? L.z0 + 0.25 : side === 1 ? L.z1 - 0.25 : side === 2 ? L.x0 + 0.25 : L.x1 - 0.25;
      // face out over the street (with a little jitter)
      const out = side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2;
      const odx = -Math.sin(out), odz = -Math.cos(out);
      const pts = [];
      let s = s0;
      for (let i = 0; i < n; i++) {
        s += 0.35 + r() * 0.6;
        const x = alongX ? L.x0 + s : edge, z = alongX ? edge : L.z0 + s;
        // a clear perch: nothing on top of it, open air out over the edge
        if (world.overlaps(x - 0.1, y + 0.05, z - 0.1, x + 0.1, y + 0.5, z + 0.1)) continue;
        if (world.raycast(x, y + 0.3, z, odx, 0, odz, 10) || world.raycast(x, y + 0.3, z, odx * 0.7, 0.7, odz * 0.7, 12)) continue;
        pts.push([x, y, z, out + (r() - 0.5) * 1.6 + (r() < 0.25 ? Math.PI : 0)]);
      }
      if (pts.length >= 3) { add(pts, true); k++; }
    }
    // the park lawns and plazas: loose groups on the ground
    const P = G.PARK;
    for (let k = 0; k < 26; k++) {
      const x = P.x0 + 8 + r() * (P.x1 - P.x0 - 16), z = P.z0 + 8 + r() * (P.z1 - P.z0 - 16);
      const pts = [];
      const n = 5 + Math.floor(r() * 8);
      for (let i = 0; i < n; i++) {
        const bx = x + (r() - 0.5) * 5, bz = z + (r() - 0.5) * 5;
        const fy = world.floorBelow(bx, bz, 30);
        if (!(fy > -1 && fy < 3)) continue;
        pts.push([bx, fy, bz, r() * Math.PI * 2]);
      }
      if (pts.length > 2) add(pts, false);
    }
    const N = this.birds.length;
    // geometry (bird faces -z, origin at the feet)
    const body = colored(new THREE.BoxGeometry(0.13, 0.12, 0.3).translate(0, 0.13, 0.01), [0.36, 0.38, 0.44]);
    const breast = colored(new THREE.BoxGeometry(0.11, 0.1, 0.1).translate(0, 0.13, -0.12), [0.34, 0.4, 0.4]);
    const head = colored(new THREE.BoxGeometry(0.075, 0.08, 0.09).translate(0, 0.22, -0.16), [0.26, 0.28, 0.33]);
    const beak = colored(new THREE.BoxGeometry(0.02, 0.02, 0.04).translate(0, 0.21, -0.22), [0.15, 0.13, 0.12]);
    const tail = colored(new THREE.BoxGeometry(0.1, 0.02, 0.13).translate(0, 0.12, 0.2), [0.2, 0.21, 0.25]);
    const legs = colored(new THREE.BoxGeometry(0.06, 0.07, 0.03).translate(0, 0.035, 0), [0.55, 0.2, 0.2]);
    const bg = mergeGeos([body, breast, head, beak, tail, legs]);
    bg.computeVertexNormals();
    // wing: a flat tapered blade from the shoulder hinge out to +x
    const wg = new THREE.BufferGeometry();
    const wp = [0, 0, -0.07, 0, 0, 0.09, 0.3, 0, 0.07, 0, 0, -0.07, 0.3, 0, 0.07, 0.33, 0, 0.0];
    wg.setAttribute("position", new THREE.Float32BufferAttribute(wp, 3));
    const wc = [0.42, 0.44, 0.5, 0.42, 0.44, 0.5, 0.18, 0.18, 0.2, 0.42, 0.44, 0.5, 0.18, 0.18, 0.2, 0.16, 0.16, 0.18];
    wg.setAttribute("color", new THREE.Float32BufferAttribute(wc, 3));
    wg.computeVertexNormals();
    const mat = fogPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), "ws-bird");
    this.body = new THREE.InstancedMesh(bg, mat, N);
    this.wings = new THREE.InstancedMesh(wg, mat, N * 2);
    for (const m of [this.body, this.wings]) { m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; scene.add(m); }
    const col = new THREE.Color();
    this.birds.forEach((b, i) => {
      const m = MORPHS[Math.floor(r() * MORPHS.length)];
      col.setRGB(m[0], m[1], m[2]);
      this.body.setColorAt(i, col); this.wings.setColorAt(i * 2, col); this.wings.setColorAt(i * 2 + 1, col);
    });
    this.M = new THREE.Matrix4(); this.W = new THREE.Matrix4(); this.R = new THREE.Matrix4();
    this.q = new THREE.Quaternion(); this.e = new THREE.Euler(0, 0, 0, "YXZ");
    this.pv = new THREE.Vector3(); this.sv = new THREE.Vector3();
    this.birds.forEach((b, i) => this.write(b, i));
    this.flying = 0;
    this.events = [];   // {x, y, z, n} scatter bursts for sound / feathers
  }

  write(b, i) {
    this.e.set(b.pitch, b.h, 0);
    this.q.setFromEuler(this.e);
    this.M.compose(this.pv.set(b.x, b.y, b.z), this.q, this.sv.setScalar(b.s));
    this.body.setMatrixAt(i, this.M);
    // wings: folded along the back when perched, clapping in flight
    const a = b.flying ? b.flap : -0.1;
    for (const side of [1, -1]) {
      this.W.makeRotationZ(side * a);
      if (!b.flying) this.W.multiply(this.R.makeRotationY(-side * 1.35));
      this.W.setPosition(side * 0.05, 0.17, -0.03);
      if (side < 0) this.W.multiply(this.R.makeScale(-1, 1, 1));
      this.W.premultiply(this.M);
      this.wings.setMatrixAt(i * 2 + (side > 0 ? 0 : 1), this.W);
    }
  }

  scare(f, px, py, pz) {
    if (f.scared) return;
    f.scared = true; f.t = 0;
    let ax = f.cx - px, az = f.cz - pz;
    const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    for (const b of f.birds) {
      b.flying = true; b.t = 0; b.delay = Math.random() * 0.35;
      const sp = 5 + Math.random() * 4;
      const jx = (Math.random() - 0.5) * 0.9, jz = (Math.random() - 0.5) * 0.9;
      b.vx = (ax + jx) * sp; b.vz = (az + jz) * sp; b.vy = 3.5 + Math.random() * 3;
      b.ox = f.cx + ax * (18 + Math.random() * 14); b.oz = f.cz + az * (18 + Math.random() * 14);
      b.or = 9 + Math.random() * 8;
      // circle above the local skyline, not through the neighbouring towers
      let top = f.cy;
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        top = Math.max(top, this.w.floorBelow(b.ox + Math.cos(a) * b.or, b.oz + Math.sin(a) * b.or, 2000));
      }
      b.oy = Math.max(f.cy + 10, top + 6) + Math.random() * 10;
      b.probe = 0;
    }
    this.events.push({ x: f.cx, y: f.cy, z: f.cz, n: f.birds.length });
  }

  /** px.. player position, sp speed, extra: [{x,y,z,r}] disturbances (web hits, hard landings) */
  update(dt, pl, extra) {
    const px = pl.p.x, py = pl.p.y, pz = pl.p.z;
    const sp = Math.hypot(pl.v.x, pl.v.y, pl.v.z);
    for (const f of this.flocks) {
      const dx = f.cx - px, dy = f.cy - py, dz = f.cz - pz;
      const d = Math.hypot(dx, dy * 1.5, dz);
      if (!f.scared) {
        if (d < 9 + Math.min(16, sp * 0.45)) this.scare(f, px, py, pz);
        else for (const e of extra) if (Math.hypot(f.cx - e.x, f.cy - e.y, f.cz - e.z) < e.r) { this.scare(f, e.x, e.y, e.z); break; }
      } else {
        f.t += dt;
        // everyone home? the flock settles
        if (f.birds.every((b) => !b.flying)) f.scared = false;
      }
    }
    let n = 0, changed = false;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      if (!b.flying) {
        // pecking about on the lawn when you're close enough to see it
        if (!b.f.perch && Math.abs(b.x - px) < 60 && Math.abs(b.z - pz) < 60) {
          b.peck -= dt;
          if (b.peck < 0) { b.peck = 0.6 + Math.random() * 2.5; b.h += (Math.random() - 0.5) * 1.5; }
          b.pitch = b.peck < 0.25 ? 0.5 : 0;
          this.write(b, i); changed = true;
        }
        continue;
      }
      n++; changed = true;
      b.t += dt;
      if (b.t < b.delay) continue;
      const t = b.t - b.delay;
      let wx, wy, wz, flapping = true;
      const hd = Math.hypot(b.hx - b.x, b.hy - b.y, b.hz - b.z);
      const playerNearHome = Math.hypot(b.hx - px, b.hy - py, b.hz - pz) < 22;
      if (t < 1.1) {
        // burst: climb hard away from the scare
        wx = b.vx; wy = Math.max(b.vy, 3); wz = b.vz;
      } else if (t < b.back || (playerNearHome && t < 60)) {
        // wheel around over the street
        const rx = b.x - b.ox, rz = b.z - b.oz, rl = Math.hypot(rx, rz) || 1;
        const tx = -rz / rl * b.orbit, tz = rx / rl * b.orbit;
        const pull = (b.or - rl) * 0.6;
        wx = tx * 10 + rx / rl * pull; wz = tz * 10 + rz / rl * pull; wy = (b.oy - b.y) * 0.8;
        flapping = wy > 0.5 || Math.sin(t * 1.3 + b.phase) > 0.4;
      } else {
        // glide home, flaring and flapping for the landing
        const k = Math.min(9, hd * 1.4 + 0.5) / (hd || 1);
        wx = (b.hx - b.x) * k; wy = (b.hy + 0.02 - b.y) * k + (hd > 6 ? 1.2 : 0); wz = (b.hz - b.z) * k;
        flapping = hd < 4 || wy > 0.5;
        if (hd < 0.25) {
          b.flying = false; b.x = b.hx; b.y = b.hy; b.z = b.hz; b.h = b.hh; b.pitch = 0;
          this.write(b, i);
          continue;
        }
      }
      // look ahead along the flight path; veer up and away from walls
      b.probe -= dt;
      if (b.probe <= 0 && hd > 3) {
        b.probe = 0.1;
        const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
        const h = this.w.raycast(b.x, b.y + 0.15, b.z, b.vx / sp, b.vy / sp, b.vz / sp, sp * 0.9 + 2);
        b.avoid = h ? { x: h.nx, y: Math.max(0.8, h.ny), z: h.nz } : null;
      }
      if (b.avoid) { wx += b.avoid.x * 12; wy += b.avoid.y * 9; wz += b.avoid.z * 12; flapping = true; }
      const kk = damp(t < 1.1 && !b.avoid ? 1 : 2.2, dt);
      const lx = b.x, ly = b.y, lz = b.z;
      b.vx += (wx - b.vx) * kk; b.vy += (wy - b.vy) * kk; b.vz += (wz - b.vz) * kk;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      // never inside a building (the landing approach onto the ledge excepted)
      if (hd > 1.5 && this.w.overlaps(b.x - 0.1, b.y + 0.05, b.z - 0.1, b.x + 0.1, b.y + 0.25, b.z + 0.1)) {
        if (!this.w.overlaps(lx - 0.1, ly + 0.05, lz - 0.1, lx + 0.1, ly + 0.25, lz + 0.1)) { b.x = lx; b.y = ly; b.z = lz; }
        else b.y += 8 * dt;   // somehow inside: climb straight out
        b.vx *= -0.3; b.vz *= -0.3; b.vy = Math.max(b.vy, 4);
      }
      const hs = Math.hypot(b.vx, b.vz);
      if (hs > 0.3) {
        const want = Math.atan2(-b.vx, -b.vz);
        let dh = want - b.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        b.h += dh * damp(8, dt);
      }
      b.pitch = Math.max(-0.6, Math.min(0.9, Math.atan2(b.vy, hs + 0.5) * 0.8));
      b.phase += dt * (flapping ? (t < 1.1 || hd < 4 ? 15 : 10) : 0);
      const flapA = flapping ? 0.1 + 0.95 * Math.sin(b.phase) : 0.12 + 0.05 * Math.sin(t * 3 + b.phase);
      b.flap = flapA;
      this.write(b, i);
    }
    this.flying = n;
    if (changed) {
      this.body.instanceMatrix.needsUpdate = true;
      this.wings.instanceMatrix.needsUpdate = true;
    }
  }
}
