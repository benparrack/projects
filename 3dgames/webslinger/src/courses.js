// Ring-race courses (pure JS, no three.js, so tests can build them headless).
// Each course is a list of grid intersections; rings are laid along the avenues and
// streets between them at swinging height, and checked for clearance against the
// city boxes.
import { G } from "./city.js";

// [avenue i, street j] waypoints; h(k) = ring height pattern (clamped to the skyline)
export const COURSES = [
  { name: "Avenue Sprint", path: [[8, 3], [8, 20]], h: (k) => 30 + 14 * Math.sin(k * 0.9) },
  { name: "Crosstown Zigzag", path: [[9, 3], [9, 7], [11, 7], [11, 12], [9, 12], [9, 17], [11, 17]], h: (k) => 34 + 10 * Math.sin(k * 1.7) },
  { name: "Skyline Dive", path: [[3, 2], [3, 6], [1, 6], [1, 13], [3, 13], [3, 21]], h: (k) => (k % 3 === 2 ? 11 : 60 + 12 * Math.sin(k)) },
  { name: "Park Loop", path: [[4, 7], [8, 7], [8, 16], [4, 16], [4, 8]], h: (k) => 26 + 12 * Math.sin(k * 1.3) },
];
const SPACING = 95;

/** ring list for a course: {x,y,z, nx,nz (travel dir), r} — pure, used by tests too */
export function buildCourse(course, world) {
  const pts = course.path.map(([i, j]) => ({ x: G.X0 + i * G.PX, z: G.Z0 + j * G.PZ }));
  const rings = [];
  for (let s = 0; s < pts.length - 1; s++) {
    const a = pts[s], b = pts[s + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z), nx = (b.x - a.x) / L, nz = (b.z - a.z) / L;
    const n = Math.max(1, Math.round(L / SPACING));
    // include the corner at the start of each leg except the very first (that's the
    // start ring, placed a little into the first leg)
    for (let k = s === 0 ? 0 : 0; k < n; k++) {
      const f = s === 0 && k === 0 ? 0.35 / n : k / n;
      rings.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, nx, nz, corner: k === 0 && s > 0 });
    }
    if (s === pts.length - 2) rings.push({ x: b.x, z: b.z, nx, nz, corner: false });
  }
  // corners face the average of the two legs so they can be flown through diagonally
  for (let k = 1; k < rings.length - 1; k++) {
    const r = rings[k];
    if (!r.corner) continue;
    const p = rings[k - 1], q = rings[k + 1];
    const ax = q.x - p.x, az = q.z - p.z, l = Math.hypot(ax, az);
    r.nx = ax / l; r.nz = az / l;
  }
  const out = [];
  rings.forEach((r, k) => {
    const alongX = Math.abs(r.nx) > Math.abs(r.nz);
    // road half-width across the travel direction (corners: the narrower one)
    const half = r.corner ? G.SW / 2 : alongX ? G.SW / 2 : G.AW / 2;
    const R = Math.min(7.5, half - 3.5);
    // skyline beside the ring
    const ox = alongX ? 0 : half + 25, oz = alongX ? half + 25 : 0;
    const sky = Math.max(world.floorBelow(r.x + ox, r.z + oz, 2000), world.floorBelow(r.x - ox, r.z - oz, 2000), 30);
    let y = Math.min(course.h(k), sky * 0.85);
    y = Math.max(y, 10);
    const clear = (yy) => {
      const ex = Math.abs(r.nz) * R + Math.abs(r.nx) * 1.2, ez = Math.abs(r.nx) * R + Math.abs(r.nz) * 1.2;
      return !world.overlaps(r.x - ex, yy - R, r.z - ez, r.x + ex, yy + R, r.z + ez);
    };
    let ok = false;
    for (let d = 0; d < 40 && !ok; d += 3) {
      if (clear(y - d) && y - d >= 10) { y -= d; ok = true; }
      else if (clear(y + d)) { y += d; ok = true; }
    }
    if (ok) out.push({ x: r.x, y, z: r.z, nx: r.nx, nz: r.nz, r: R });
  });
  return out;
}

export const fmtTime = (t) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return (m ? m + ":" + (s < 10 ? "0" : "") : "") + s.toFixed(2);
};

