// Street life: instanced cars (lots of yellow cabs) streaming along every avenue
// and street lane, with head/tail lights that glow at night; plus the collectible
// tokens scattered over rooftops and in mid-air.
import * as THREE from "three";
import { G, rng } from "./city.js";
import { fogPatch, glowMaterial } from "./materials.js";
import { mergeGeos } from "./cityMesh.js";

const PALETTE = [[0.75, 0.5, 0.02], [0.75, 0.5, 0.02], [0.75, 0.5, 0.02], [0.02, 0.02, 0.025], [0.5, 0.5, 0.52], [0.8, 0.8, 0.82],
  [0.06, 0.08, 0.14], [0.3, 0.02, 0.02], [0.1, 0.1, 0.1], [0.02, 0.1, 0.06]];

function colored(g, c) {
  if (g.index) g = g.toNonIndexed(); g.deleteAttribute("uv");
  const a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) a.set(c, i);
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return g;
}

export class Traffic {
  constructor(scene, count = 700) {
    const r = rng(99);
    const lanes = [];
    const I = G.ISLAND, P = G.PARK;
    const zA = G.Z0 - G.SW / 2, zB = G.Z0 + G.NZ * G.PZ + G.SW / 2;
    const xA = G.X0, xB = G.X0 + G.NX * G.PX;
    for (let i = 0; i <= G.NX; i++) {
      const x = G.X0 + i * G.PX;
      const segs = x > P.x0 && x < P.x1 ? [[zA, P.z0 - G.SW], [P.z1 + G.SW, zB]] : [[zA, zB]];
      for (const o of [-8, -3, 3, 8]) for (const [a, b] of segs) lanes.push({ ax: "z", c: x + o, dir: o > 0 ? -1 : 1, a, b });
    }
    for (let j = 0; j <= G.NZ; j++) {
      const z = G.Z0 + j * G.PZ;
      const segs = z > P.z0 && z < P.z1 ? [[xA, P.x0 - G.AW], [P.x1 + G.AW, xB]] : [[xA, xB]];
      // one-way streets alternate direction
      const dir = j % 2 ? 1 : -1;
      for (const o of [-3.5, 3.5]) for (const [a, b] of segs) lanes.push({ ax: "x", c: z + o, dir, a, b });
    }
    const w = lanes.map((l) => l.b - l.a), tot = w.reduce((a, b) => a + b, 0);
    this.cars = [];
    for (let k = 0; k < count; k++) {
      let x = r() * tot, li = 0;
      while (x > w[li]) x -= w[li++];
      const l = lanes[li];
      this.cars.push({ l, s: l.a + x, v: (l.ax === "z" ? 13 : 9) + r() * 5, col: PALETTE[Math.floor(r() * PALETTE.length)] });
    }
    // geometry: body + cabin; lights as separate glow mesh
    const body = new THREE.BoxGeometry(1.9, 0.75, 4.5); body.translate(0, 0.72, 0);
    const cab = new THREE.BoxGeometry(1.7, 0.62, 2.3); cab.translate(0, 1.4, 0.25);
    const under = new THREE.BoxGeometry(1.8, 0.35, 4.2); under.translate(0, 0.3, 0);
    const g = mergeGeos([colored(body, [1, 1, 1]), colored(cab, [0.35, 0.37, 0.4]), colored(under, [0.05, 0.05, 0.05])]);
    g.computeVertexNormals();
    const mat = fogPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.5 }), "ws-car");
    this.mesh = new THREE.InstancedMesh(g, mat, count);
    this.mesh.castShadow = false; this.mesh.receiveShadow = true;
    const lights = [];
    for (const s of [-1, 1]) {
      const h = new THREE.BoxGeometry(0.4, 0.18, 0.05); h.translate(s * 0.62, 0.82, -2.26); lights.push(colored(h, [1.0, 0.85, 0.6]));
      const t = new THREE.BoxGeometry(0.4, 0.16, 0.05); t.translate(s * 0.62, 0.85, 2.26); lights.push(colored(t, [0.9, 0.02, 0.01]));
    }
    this.lights = new THREE.InstancedMesh(mergeGeos(lights), glowMaterial("car"), count);
    const c = new THREE.Color();
    this.cars.forEach((car, i) => this.mesh.setColorAt(i, c.setRGB(...car.col)));
    this.m = new THREE.Matrix4();
    this.update(0);
    this.mesh.frustumCulled = false; this.lights.frustumCulled = false;
    scene.add(this.mesh, this.lights);
  }

  update(dt) {
    const m = this.m;
    this.cars.forEach((car, i) => {
      const l = car.l;
      car.s += car.v * l.dir * dt;
      if (car.s > l.b) car.s = l.a; else if (car.s < l.a) car.s = l.b;
      const yaw = l.ax === "z" ? (l.dir < 0 ? 0 : Math.PI) : (l.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      m.makeRotationY(yaw);
      if (l.ax === "z") m.setPosition(l.c, 0, car.s); else m.setPosition(car.s, 0, l.c);
      this.mesh.setMatrixAt(i, m); this.lights.setMatrixAt(i, m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.lights.instanceMatrix.needsUpdate = true;
  }
}

export class Tokens {
  constructor(scene, list) {
    this.list = list.map((t) => ({ ...t, got: false }));
    const g = new THREE.OctahedronGeometry(0.9, 0);
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) c.set([1.0, 0.55, 0.08], i);
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    mat.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 6.0;");
    };
    mat.fog = false;
    this.mesh = new THREE.InstancedMesh(g, mat, this.list.length);
    // halo
    const hg = new THREE.RingGeometry(1.4, 1.6, 32);
    const hc = new Float32Array(hg.attributes.position.count * 3);
    for (let i = 0; i < hc.length; i += 3) hc.set([1.0, 0.7, 0.2], i);
    hg.setAttribute("color", new THREE.BufferAttribute(hc, 3));
    this.halo = new THREE.InstancedMesh(hg, mat, this.list.length);
    this.mesh.frustumCulled = this.halo.frustumCulled = false;
    scene.add(this.mesh, this.halo);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler();
    this.v = new THREE.Vector3(); this.s = new THREE.Vector3();
    this.count = 0;
  }

  update(dt, t, p, camera) {
    let got = null;
    this.list.forEach((k, i) => {
      if (!k.got) {
        const dx = p.x - k.x, dy = p.y - k.y, dz = p.z - k.z;
        if (dx * dx + dy * dy + dz * dz < 3.2 * 3.2) { k.got = true; k.t = 0; this.count++; got = k; }
      }
      let sc = 1;
      if (k.got) { k.t += dt; sc = k.t < 0.35 ? 1 + k.t * 6 : 0; }
      this.q.setFromEuler(this.e.set(0, t * 1.8 + i, 0));
      this.m.compose(this.v.set(k.x, k.y + Math.sin(t * 2 + i) * 0.3, k.z), this.q, this.s.setScalar(sc * (1 + 0.1 * Math.sin(t * 5 + i))));
      this.mesh.setMatrixAt(i, this.m);
      this.q.copy(camera.quaternion);
      this.m.compose(this.v, this.q, this.s.setScalar(sc));
      this.halo.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.halo.instanceMatrix.needsUpdate = true;
    return got;
  }

  nearest(p) {
    let best = null, bd = 1e18;
    for (const k of this.list) {
      if (k.got) continue;
      const d = (k.x - p.x) ** 2 + (k.z - p.z) ** 2 + (k.y - p.y) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
}
