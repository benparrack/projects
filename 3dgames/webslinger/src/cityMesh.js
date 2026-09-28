// Turns the City description into GPU meshes: buildings merged per 256 m chunk
// (with a separate near-only "detail" layer for rooftop clutter), instanced trees,
// street lamps and aircraft warning lights, the street plane and the water.
import * as THREE from "three";
import { G, S } from "./city.js";
import { buildingMaterial, streetMaterial, waterMaterial, treeMaterial, glowMaterial, fogPatch } from "./materials.js";

const CHUNK = 256;

class Builder {
  constructor() { this.n = 0; this.cap = 4096; this.alloc(); this.idx = []; }
  alloc() {
    const grow = (a, k) => { const b = new Float32Array(this.cap * k); if (a) b.set(a); return b; };
    this.pos = grow(this.pos, 3); this.nrm = grow(this.nrm, 3); this.col = grow(this.col, 3); this.dat = grow(this.dat, 4);
  }
  vert(x, y, z, nx, ny, nz, c, d) {
    if (this.n >= this.cap) { this.cap *= 2; this.alloc(); }
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.nrm[i * 3] = nx; this.nrm[i * 3 + 1] = ny; this.nrm[i * 3 + 2] = nz;
    this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
    this.dat[i * 4] = d[0]; this.dat[i * 4 + 1] = d[1]; this.dat[i * 4 + 2] = d[2]; this.dat[i * 4 + 3] = d[3];
    return i;
  }
  quad(a, b, c, d, n, col, dat) {
    const i = this.vert(...a, ...n, col, dat); this.vert(...b, ...n, col, dat);
    this.vert(...c, ...n, col, dat); this.vert(...d, ...n, col, dat);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  box(b) {
    const { x0, y0, z0, x1, y1, z1 } = b;
    const d = [b.style, b.seed, y0, y1], c = b.col;
    if (b.rim > 0) {
      // cornice: only the overhanging rim of the top face, so it doesn't z-fight with the roof
      const r = b.rim, top = (a0, a1, c0, c1) => this.quad([a0, y1, c1], [a1, y1, c1], [a1, y1, c0], [a0, y1, c0], [0, 1, 0], c, d);
      top(x0, x1, z0, z0 + r); top(x0, x1, z1 - r, z1); top(x0, x0 + r, z0 + r, z1 - r); top(x1 - r, x1, z0 + r, z1 - r);
    } else this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], c, d);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], c, d);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], c, d);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], c, d);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], c, d);
    if (b.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], c, d);
  }
  geometry(g, matrix, col, dat) {
    const gg = g.index ? g.toNonIndexed() : g;
    gg.applyMatrix4(matrix);
    gg.computeVertexNormals();
    const p = gg.attributes.position, n = gg.attributes.normal;
    for (let i = 0; i < p.count; i += 3) {
      const k = this.n;
      for (let j = 0; j < 3; j++) this.vert(p.getX(i + j), p.getY(i + j), p.getZ(i + j), n.getX(i + j), n.getY(i + j), n.getZ(i + j), col, dat);
      this.idx.push(k, k + 1, k + 2);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos.slice(0, this.n * 3), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(this.nrm.slice(0, this.n * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.col.slice(0, this.n * 3), 3));
    g.setAttribute("aData", new THREE.BufferAttribute(this.dat.slice(0, this.n * 4), 4));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export class CityMesh {
  constructor(city, scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.detail = [];
    this.material = buildingMaterial();
    const chunks = new Map();
    const key = (x, z, det) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)},${det ? 1 : 0}`;
    const get = (k) => chunks.get(k) || (chunks.set(k, new Builder()), chunks.get(k));
    for (const b of city.boxes) {
      if (b.render === false) continue;
      get(key((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, b.detail)).box(b);
    }
    // water tanks + spire cones
    const m4 = new THREE.Matrix4();
    for (const m of city.meshes) {
      const bld = get(key(m.x, m.z, true));
      if (m.kind === "tank") {
        const wood = [0.2, 0.11, 0.07], steel = [0.1, 0.1, 0.1];
        const d = [S.TANK, m.seed, m.y, m.y + m.legs + m.th];
        bld.geometry(new THREE.CylinderGeometry(m.rad, m.rad, m.th, 14, 1, false), m4.makeTranslation(m.x, m.y + m.legs + m.th / 2, m.z), wood, d);
        bld.geometry(new THREE.ConeGeometry(m.rad * 1.05, m.rad * 0.6, 14), m4.makeTranslation(m.x, m.y + m.legs + m.th + m.rad * 0.3, m.z), [0.06, 0.06, 0.06], [S.ROOF, m.seed, 0, 0]);
        for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
          bld.geometry(new THREE.BoxGeometry(0.25, m.legs, 0.25), m4.makeTranslation(m.x + sx * m.rad * 0.7, m.y + m.legs / 2, m.z + sz * m.rad * 0.7), steel, [S.METAL, 0, 0, 0]);
      } else if (m.kind === "cone") {
        get(key(m.x, m.z, false)).geometry(new THREE.ConeGeometry(m.rad, m.h, 8), m4.makeTranslation(m.x, m.y + m.h / 2, m.z), m.col, [S.METAL, 0.5, m.y, m.y + m.h]);
      }
    }
    for (const [k, bld] of chunks) {
      if (!bld.n) continue;
      const mesh = new THREE.Mesh(bld.build(), this.material);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      if (k.endsWith(",1")) { this.detail.push(mesh); mesh.userData.center = mesh.geometry.boundingSphere.center; }
      this.group.add(mesh);
    }
    // distant shores: one merged mesh, no shadows
    const far = new Builder();
    for (const b of city.far) far.box(b);
    this.far = new THREE.Mesh(far.build(), this.material);
    this.far.matrixAutoUpdate = false;
    scene.add(this.far);

    this.streets(scene);
    this.water(scene, city);
    this.trees(scene, city);
    this.lamps(scene, city);
    this.warning(scene, city);
  }

  streets(scene) {
    const I = G.ISLAND;
    const g = new THREE.PlaneGeometry(I.x1 - I.x0, I.z1 - I.z0);
    g.rotateX(-Math.PI / 2);
    g.translate((I.x0 + I.x1) / 2, 0, (I.z0 + I.z1) / 2);
    this.street = new THREE.Mesh(g, streetMaterial());
    this.street.receiveShadow = true;
    this.street.matrixAutoUpdate = false;
    scene.add(this.street);
  }

  water(scene, city) {
    const g = new THREE.PlaneGeometry(60000, 60000);
    g.rotateX(-Math.PI / 2);
    this.waterMat = waterMaterial();
    this.waterMesh = new THREE.Mesh(g, this.waterMat);
    this.waterMesh.position.y = G.WATER_Y;
    this.waterMesh.receiveShadow = true;
    this.waterMesh.updateMatrix();
    this.waterMesh.matrixAutoUpdate = false;
    scene.add(this.waterMesh);
    // park pond
    const p = city.pond;
    const pg = new THREE.PlaneGeometry(p.x1 - p.x0, p.z1 - p.z0);
    pg.rotateX(-Math.PI / 2);
    pg.translate((p.x0 + p.x1) / 2, -0.1, (p.z0 + p.z1) / 2);
    this.pond = new THREE.Mesh(pg, this.waterMat);
    this.pond.receiveShadow = true;
    scene.add(this.pond);
  }

  trees(scene, city) {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.18, 0.3, 4, 6);
    trunk.translate(0, 2, 0);
    parts.push([trunk, [0.16, 0.1, 0.06], 0]);
    let s = 3;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (const [y, r, dx, dz] of [[5.2, 2.6, 0, 0], [6.6, 1.9, 0.8, -0.4], [4.8, 1.8, -1.1, 0.7], [7.4, 1.3, -0.3, 0.2]]) {
      const b = new THREE.IcosahedronGeometry(r, 1);
      const p = b.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = 0.82 + rnd() * 0.3;
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.85, p.getZ(i) * k);
      }
      b.translate(dx, y, dz);
      parts.push([b, [0.11, 0.2, 0.06], 1]);
    }
    const geos = parts.map(([g, c, leaf]) => {
      const gg = g.index ? g.toNonIndexed() : g;
      const n = gg.attributes.position.count;
      const col = new Float32Array(n * 3), lf = new Float32Array(n);
      for (let i = 0; i < n; i++) { col.set(c, i * 3); lf[i] = leaf; }
      gg.setAttribute("color", new THREE.BufferAttribute(col, 3));
      gg.setAttribute("aLeaf", new THREE.BufferAttribute(lf, 1));
      gg.deleteAttribute("uv");
      return gg;
    });
    const merged = mergeGeos(geos);
    merged.computeVertexNormals();
    const mesh = new THREE.InstancedMesh(merged, treeMaterial(), city.trees.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const tint = new THREE.Color();
    city.trees.forEach((t, i) => {
      q.setFromEuler(e.set(0, t.seed * 6.28, 0));
      m.compose(v.set(t.x, t.y, t.z), q, sc.setScalar(t.s));
      mesh.setMatrixAt(i, m);
      tint.setRGB(0.8 + t.seed * 0.4, 0.85 + ((t.seed * 7) % 1) * 0.3, 0.7 + ((t.seed * 13) % 1) * 0.3);
      mesh.setColorAt(i, tint);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    this.treeMesh = mesh;
  }

  lamps(scene, city) {
    const pole = new THREE.CylinderGeometry(0.09, 0.13, 7.5, 6);
    pole.translate(0, 3.75, 0);
    const arm = new THREE.BoxGeometry(0.1, 0.1, 2.2);
    arm.translate(0, 7.4, 1.0);
    const g = mergeGeos([pole.toNonIndexed(), arm.toNonIndexed()].map((x) => { x.deleteAttribute("uv"); return x; }));
    const head = new THREE.BoxGeometry(0.45, 0.16, 0.9);
    head.translate(0, 7.3, 2.0);
    const hc = new Float32Array(head.attributes.position.count * 3);
    for (let i = 0; i < hc.length; i += 3) hc.set([1.0, 0.72, 0.42], i);
    head.setAttribute("color", new THREE.BufferAttribute(hc, 3));
    const poles = new THREE.InstancedMesh(g, fogPatch(new THREE.MeshStandardMaterial({ color: 0x1c2024, roughness: 0.5, metalness: 0.6 }), "ws-pole"), city.lamps.length);
    const heads = new THREE.InstancedMesh(head, glowMaterial("lamp"), city.lamps.length);
    const m = new THREE.Matrix4();
    city.lamps.forEach((l, i) => {
      m.makeRotationY(Math.atan2(l.dx, l.dz));
      m.setPosition(l.x, 0.2, l.z);
      poles.setMatrixAt(i, m); heads.setMatrixAt(i, m);
    });
    poles.castShadow = true;
    poles.computeBoundingSphere(); heads.computeBoundingSphere();
    scene.add(poles, heads);
  }

  warning(scene, city) {
    const g = new THREE.SphereGeometry(0.7, 8, 6);
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) c.set([1, 0.05, 0.03], i);
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    const mesh = new THREE.InstancedMesh(g, glowMaterial("blink"), city.lights.length);
    const m = new THREE.Matrix4();
    city.lights.forEach((l, i) => { m.makeTranslation(l.x, l.y, l.z); mesh.setMatrixAt(i, m); });
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  /** show rooftop clutter only near the camera */
  update(cam) {
    for (const m of this.detail) m.visible = m.userData.center.distanceToSquared(cam.position) < 650 * 650;
  }
}

export function mergeGeos(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(list[0].attributes)) {
    const size = list[0].attributes[name].itemSize;
    const arr = new Float32Array(n * size);
    let o = 0;
    for (const g of list) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}
