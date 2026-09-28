// Collision world over the city's axis-aligned boxes: a uniform xz grid, ray casts
// (slab test), AABB overlap queries and axis-separated swept movement.
import { G } from "./city.js";

const CELL = 16;

export class World {
  constructor(city) {
    const I = G.ISLAND;
    this.ox = I.x0 - 64; this.oz = I.z0 - 64;
    this.nx = Math.ceil((I.x1 - I.x0 + 128) / CELL);
    this.nz = Math.ceil((I.z1 - I.z0 + 128) / CELL);
    this.cells = new Array(this.nx * this.nz);
    this.boxes = city.boxes.filter((b) => b.collide);
    const n = this.boxes.length;
    // flat copy for speed
    this.b = new Float32Array(n * 6);
    this.stamp = new Uint32Array(n);
    this.frame = 1;
    for (let k = 0; k < n; k++) {
      const q = this.boxes[k];
      this.b.set([q.x0, q.y0, q.z0, q.x1, q.y1, q.z1], k * 6);
      const [i0, j0] = this.cell(q.x0, q.z0), [i1, j1] = this.cell(q.x1, q.z1);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const c = j * this.nx + i;
        (this.cells[c] || (this.cells[c] = [])).push(k);
      }
    }
    this.hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, box: -1 };
  }

  cell(x, z) {
    const i = Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.ox) / CELL)));
    const j = Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.oz) / CELL)));
    return [i, j];
  }

  /** calls fn(k) once for every box whose cells overlap the xz rectangle */
  forEachNear(x0, z0, x1, z1, fn) {
    const f = ++this.frame;
    const [i0, j0] = this.cell(x0, z0), [i1, j1] = this.cell(x1, z1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const list = this.cells[j * this.nx + i];
      if (!list) continue;
      for (let m = 0; m < list.length; m++) {
        const k = list[m];
        if (this.stamp[k] === f) continue;
        this.stamp[k] = f;
        if (fn(k) === false) return;
      }
    }
  }

  overlaps(x0, y0, z0, x1, y1, z1) {
    let any = false;
    const b = this.b;
    this.forEachNear(x0, z0, x1, z1, (k) => {
      const o = k * 6;
      if (x1 > b[o] && x0 < b[o + 3] && y1 > b[o + 1] && y0 < b[o + 4] && z1 > b[o + 2] && z0 < b[o + 5]) { any = true; return false; }
    });
    return any || y0 < 0 && this.onIsland(x0, z0);
  }

  onIsland(x, z) {
    const I = G.ISLAND;
    return x > I.x0 && x < I.x1 && z > I.z0 && z < I.z1;
  }

  /**
   * Ray cast against all boxes and the street plane (y=0 on the island).
   * Returns this.hit (reused) or null. dir must be normalised.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    const h = this.hit;
    let best = maxT, bk = -1, bnx = 0, bny = 0, bnz = 0;
    // ground plane
    if (dy < 0) {
      const t = -oy / dy;
      if (t > 0 && t < best && this.onIsland(ox + dx * t, oz + dz * t)) { best = t; bk = -2; bnx = 0; bny = 1; bnz = 0; }
    }
    const ex = ox + dx * maxT, ez = oz + dz * maxT;
    // walk the grid cells the ray's xz footprint crosses (DDA)
    const f = ++this.frame;
    const b = this.b;
    const idx = 1 / (dx || 1e-9), idy = 1 / (dy || 1e-9), idz = 1 / (dz || 1e-9);
    let [ci, cj] = this.cell(ox, oz);
    const [ti, tj] = this.cell(ex, ez);
    const si = dx > 0 ? 1 : -1, sj = dz > 0 ? 1 : -1;
    let tMaxX = Math.abs(dx) < 1e-9 ? Infinity : ((this.ox + (ci + (dx > 0 ? 1 : 0)) * CELL) - ox) * idx;
    let tMaxZ = Math.abs(dz) < 1e-9 ? Infinity : ((this.oz + (cj + (dz > 0 ? 1 : 0)) * CELL) - oz) * idz;
    const tdx = Math.abs(CELL * idx), tdz = Math.abs(CELL * idz);
    let tEnter = 0;
    for (let guard = 0; guard < 4096; guard++) {
      if (tEnter > best) break;
      const list = ci >= 0 && cj >= 0 && ci < this.nx && cj < this.nz ? this.cells[cj * this.nx + ci] : null;
      if (list) for (let m = 0; m < list.length; m++) {
        const k = list[m];
        if (this.stamp[k] === f) continue;
        this.stamp[k] = f;
        const o = k * 6;
        let t1 = (b[o] - ox) * idx, t2 = (b[o + 3] - ox) * idx;
        let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2), ax = 0;
        t1 = (b[o + 1] - oy) * idy; t2 = (b[o + 4] - oy) * idy;
        let a = Math.min(t1, t2);
        if (a > tmin) { tmin = a; ax = 1; }
        tmax = Math.min(tmax, Math.max(t1, t2));
        t1 = (b[o + 2] - oz) * idz; t2 = (b[o + 5] - oz) * idz;
        a = Math.min(t1, t2);
        if (a > tmin) { tmin = a; ax = 2; }
        tmax = Math.min(tmax, Math.max(t1, t2));
        if (tmax >= tmin && tmin > 0 && tmin < best) {
          best = tmin; bk = k;
          bnx = ax === 0 ? -Math.sign(dx) : 0; bny = ax === 1 ? -Math.sign(dy) : 0; bnz = ax === 2 ? -Math.sign(dz) : 0;
        }
      }
      if (ci === ti && cj === tj) break;
      if (tMaxX < tMaxZ) { tEnter = tMaxX; tMaxX += tdx; ci += si; }
      else { tEnter = tMaxZ; tMaxZ += tdz; cj += sj; }
      if (tEnter > maxT) break;
    }
    if (bk === -1) return null;
    h.t = best; h.x = ox + dx * best; h.y = oy + dy * best; h.z = oz + dz * best;
    h.nx = bnx; h.ny = bny; h.nz = bnz; h.box = bk;
    return h;
  }

  /**
   * Move an AABB (half extents hx, hy, hz; position = centre) by (dx,dy,dz),
   * one axis at a time. Returns contact flags in out: {x:-1|0|1, y, z} = which
   * side got blocked, plus stepped (auto step-up over kerbs).
   */
  move(p, hx, hy, hz, dx, dy, dz, out, canStep) {
    out.x = out.y = out.z = 0; out.stepped = false;
    const b = this.b;
    const sweep = (axis, d) => {
      if (d === 0) return;
      const lo = [p.x - hx, p.y - hy, p.z - hz], hi = [p.x + hx, p.y + hy, p.z + hz];
      lo[axis] += Math.min(0, d); hi[axis] += Math.max(0, d);
      let allowed = d;
      this.forEachNear(lo[0], lo[2], hi[0], hi[2], (k) => {
        const o = k * 6;
        if (!(hi[0] > b[o] && lo[0] < b[o + 3] && hi[1] > b[o + 1] && lo[1] < b[o + 4] && hi[2] > b[o + 2] && lo[2] < b[o + 5])) return;
        const c = axis === 0 ? p.x : axis === 1 ? p.y : p.z;
        const he = axis === 0 ? hx : axis === 1 ? hy : hz;
        if (d > 0) {
          const lim = b[o + axis] - (c + he);
          if (lim >= -0.05) allowed = Math.min(allowed, Math.max(0, lim - 1e-4));
        } else {
          const lim = b[o + 3 + axis] - (c - he);
          if (lim <= 0.05) allowed = Math.max(allowed, Math.min(0, lim + 1e-4));
        }
      });
      // ground plane on the island
      if (axis === 1 && d < 0 && this.onIsland(p.x, p.z)) {
        const lim = 0 - (p.y - hy);
        if (lim <= 0.05) allowed = Math.max(allowed, Math.min(0, lim));
      }
      if (allowed !== d) {
        const s = Math.sign(d);
        if (axis === 0) out.x = s; else if (axis === 1) out.y = s; else out.z = s;
      }
      if (axis === 0) p.x += allowed; else if (axis === 1) p.y += allowed; else p.z += allowed;
      return allowed;
    };
    sweep(1, dy);
    for (const [axis, d] of [[0, dx], [2, dz]]) {
      const before = axis === 0 ? p.x : p.z;
      sweep(axis, d);
      const blocked = axis === 0 ? out.x : out.z;
      if (blocked && canStep) {
        // try stepping up a kerb / low ledge (< 0.6 m)
        const y0 = p.y;
        for (const up of [0.25, 0.45, 0.62]) {
          const q = { x: before, y: y0 + up, z: axis === 0 ? p.z : before };
          if (axis === 0) q.z = p.z; else q.x = p.x;
          if (this.overlaps(q.x - hx, q.y - hy, q.z - hz, q.x + hx, q.y + hy, q.z + hz)) continue;
          const nq = { ...q };
          if (axis === 0) nq.x += d; else nq.z += d;
          if (this.overlaps(nq.x - hx, nq.y - hy, nq.z - hz, nq.x + hx, nq.y + hy, nq.z + hz)) continue;
          p.x = nq.x; p.y = nq.y; p.z = nq.z;
          if (axis === 0) out.x = 0; else out.z = 0;
          out.stepped = true;
          break;
        }
      }
    }
    return out;
  }

  /** highest surface top (box or street) under (x,z) at or below y; -Infinity over water */
  floorBelow(x, z, y) {
    let best = this.onIsland(x, z) ? 0 : -Infinity;
    const b = this.b;
    this.forEachNear(x, z, x, z, (k) => {
      const o = k * 6;
      if (x >= b[o] && x <= b[o + 3] && z >= b[o + 2] && z <= b[o + 5] && b[o + 4] <= y + 0.01 && b[o + 4] > best) best = b[o + 4];
    });
    return best;
  }
}
