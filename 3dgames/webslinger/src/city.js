// Procedural island city: a Manhattan-style street grid of skyscraper canyons, a
// central park, a seawall and distant shores across the water. Everything solid is
// an axis-aligned box, so collision and web raycasts stay exact and cheap
// (see collide.js). Rendering geometry is merged per 256 m chunk.

export const G = {
  BX: 150, BZ: 80,      // block size (x, z)
  AW: 34, SW: 24,       // avenue / street width (kerb to kerb incl. sidewalks)
  NX: 12, NZ: 26,       // blocks in x / z
  WALK: 5,              // sidewalk depth (part of the road width)
  SHORE: 34,            // waterfront promenade beyond the outer avenues
  WATER_Y: -1.6,
};
G.PX = G.BX + G.AW;
G.PZ = G.BZ + G.SW;
G.X0 = -G.NX * G.PX / 2;
G.Z0 = -G.NZ * G.PZ / 2;
G.ISLAND = {
  x0: G.X0 - G.AW / 2 - G.SHORE, x1: G.X0 + G.NX * G.PX + G.AW / 2 + G.SHORE,
  z0: G.Z0 - G.SW / 2 - G.SHORE, z1: G.Z0 + G.NZ * G.PZ + G.SW / 2 + G.SHORE,
};
// park spans blocks i 5..6, j 8..14 (the avenue/streets inside it are grass)
G.PARK = { i0: 5, i1: 7, j0: 8, j1: 15 };
G.PARK.x0 = G.X0 + G.PARK.i0 * G.PX + G.AW / 2;
G.PARK.x1 = G.X0 + G.PARK.i1 * G.PX - G.AW / 2;
G.PARK.z0 = G.Z0 + G.PARK.j0 * G.PZ + G.SW / 2;
G.PARK.z1 = G.Z0 + G.PARK.j1 * G.PZ - G.SW / 2;

// facade / surface styles understood by the building shader (materials.js)
export const S = {
  PLAIN: 0, GLASS: 1, STONE: 2, BRICK: 3, RIBBON: 4, SHOP: 5, MECH: 6,
  WALK: 7, METAL: 8, GRASS: 9, SEAWALL: 10, LAMP: 11, TANK: 12, ROOF: 13,
};

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, z) {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const lin = (hex) => {
  const c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  return c.map((v) => Math.pow(v / 255, 2.2));
};
const PAL = {
  glass: [0x1d3440, 0x2a2620, 0x39424c, 0x121a26, 0x24343a, 0x3a3226, 0x1a2a38].map(lin),
  stone: [0xc4b69c, 0x9c9a94, 0xb09474, 0xd4ccbe, 0x8a8278, 0xbfae8e].map(lin),
  brick: [0x7a3a2a, 0x8c5238, 0x62342a, 0x9c7458, 0x6e4a3a, 0x844030].map(lin),
  concrete: [0xa8a49c, 0x8e8c88, 0xb8b2a6, 0x7c7a76].map(lin),
  roof: [0x5a5854, 0x4a4844, 0x6a6660, 0x3e3c3a].map(lin),
};
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];

/** Height budget of the skyline at a point: downtown + midtown peaks, park frontage. */
export function districtHeight(x, z) {
  const g = (cx, cz, s) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * s * s));
  let h = 34;
  h += 290 * g(-60, 1020, 360);          // downtown (south)
  h += 260 * g(120, -560, 420);          // midtown
  h += 70 * g(-700, 200, 500);
  h += 90 * vnoise(x / 420 + 11, z / 420 + 7);
  // tall frontage along the park
  const P = G.PARK;
  const dx = Math.max(P.x0 - x, 0, x - P.x1), dz = Math.max(P.z0 - z, 0, z - P.z1);
  const d = Math.hypot(dx, dz);
  if (d > 0 && d < 160) h += 110 * (1 - d / 160);
  return h;
}

export class City {
  constructor(seed = 1337) {
    this.seed = seed;
    this.boxes = [];        // {x0,y0,z0,x1,y1,z1,style,col,seed,collide,detail,bottom}
    this.meshes = [];       // non-box visuals: {kind:'cyl'|'cone', ...}
    this.trees = [];        // {x,y,z,s,seed}
    this.lamps = [];        // {x,z,dir}
    this.lights = [];       // aircraft warning lights {x,y,z}
    this.tokens = [];       // collectible positions
    this.far = [];          // distant-shore boxes (render only)
    this.pond = null;
    this.generate();
  }

  box(x0, y0, z0, x1, y1, z1, style, col, opt = {}) {
    if (x1 - x0 < 0.01 || y1 - y0 < 0.01 || z1 - z0 < 0.01) return null;
    const b = { x0, y0, z0, x1, y1, z1, style, col, seed: opt.seed ?? Math.random(),
      collide: opt.collide ?? true, detail: opt.detail ?? false, bottom: opt.bottom ?? false, rim: opt.rim ?? 0 };
    (opt.far ? this.far : this.boxes).push(b);
    return b;
  }

  generate() {
    const r = rng(this.seed);
    this.r = r;
    const P = G.PARK, I = G.ISLAND;

    // island base, seawall, sidewalks
    for (let i = 0; i < G.NX; i++) {
      for (let j = 0; j < G.NZ; j++) {
        const bx0 = G.X0 + i * G.PX + G.AW / 2, bz0 = G.Z0 + j * G.PZ + G.SW / 2;
        const bx1 = bx0 + G.BX, bz1 = bz0 + G.BZ;
        const inPark = i >= P.i0 && i < P.i1 && j >= P.j0 && j < P.j1;
        if (inPark) continue;
        this.box(bx0 - G.WALK, -1, bz0 - G.WALK, bx1 + G.WALK, 0.2, bz1 + G.WALK, S.WALK, lin(0x9a968e), { seed: r() });
        this.block(bx0, bz0, bx1, bz1, r);
      }
    }
    this.park(r);
    // seawall ring + promenade kerb
    const sw = lin(0x7c776c), t = 2.5;
    this.box(I.x0 - t, -7, I.z0 - t, I.x1 + t, 0.25, I.z0, S.SEAWALL, sw);
    this.box(I.x0 - t, -7, I.z1, I.x1 + t, 0.25, I.z1 + t, S.SEAWALL, sw);
    this.box(I.x0 - t, -7, I.z0, I.x0, 0.25, I.z1, S.SEAWALL, sw);
    this.box(I.x1, -7, I.z0, I.x1 + t, 0.25, I.z1, S.SEAWALL, sw);
    // railings on the seawall (visual; thin)
    this.streetLamps(r);
    this.farShores(r);
    this.placeTokens(r);
  }

  block(bx0, bz0, bx1, bz1, r) {
    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
    const dh = districtHeight(cx, cz);
    const lots = [];
    const big = dh > 170 && r() < 0.55;
    const nx = big ? 1 + (r() < 0.5 ? 1 : 0) : 2 + Math.floor(r() * 3.2);
    const nz = big ? 1 : (r() < 0.6 ? 2 : 1);
    // random partition of the block
    const cuts = (a, b, n, min) => {
      const w = [];
      for (let k = 0; k < n; k++) w.push(0.6 + r());
      const s = w.reduce((p, q) => p + q, 0);
      const out = [a];
      let acc = a;
      for (let k = 0; k < n - 1; k++) { acc += (b - a) * w[k] / s; out.push(acc); }
      out.push(b);
      for (let k = 1; k < out.length; k++) if (out[k] - out[k - 1] < min) return [a, b];
      return out;
    };
    const xs = cuts(bx0, bx1, nx, 22), zs = cuts(bz0, bz1, nz, 26);
    for (let a = 0; a < xs.length - 1; a++)
      for (let b = 0; b < zs.length - 1; b++) lots.push([xs[a], zs[b], xs[a + 1], zs[b + 1]]);
    for (const [x0, z0, x1, z1] of lots) {
      let h = dh * (0.42 + 0.95 * Math.pow(r(), 0.85));
      const size = Math.min(x1 - x0, z1 - z0);
      if (size < 30) h = Math.min(h, 60 + size * 3);
      if (r() < 0.035 && dh > 200) h = 330 + r() * 150;   // supertall landmark
      h = Math.max(14, Math.round(h / 3.8) * 3.8);
      // occasional gap lot: plaza (lets light in, adds variety)
      if (r() < 0.035 && dh < 200) { this.plaza(x0, z0, x1, z1, r); continue; }
      const roll = r();
      if (h > 110 && roll < 0.55) this.glassTower(x0, z0, x1, z1, h, r);
      else if (h > 90 && roll < 0.85) this.decoTower(x0, z0, x1, z1, h, r);
      else if (h < 75 && roll < 0.8) this.brick(x0, z0, x1, z1, h, r);
      else this.modern(x0, z0, x1, z1, h, r);
    }
  }

  shop(x0, z0, x1, z1, h, r) {
    this.box(x0, 0, z0, x1, h, z1, S.SHOP, pick(r, PAL.stone), { seed: r() });
  }

  roofTop(x0, z0, x1, z1, y, r, col) {
    // parapet ring + rooftop clutter
    const t = 0.5, ph = 1.1;
    const c = col || pick(r, PAL.concrete);
    this.box(x0, y, z0, x1, y + ph, z0 + t, S.PLAIN, c, { detail: true });
    this.box(x0, y, z1 - t, x1, y + ph, z1, S.PLAIN, c, { detail: true });
    this.box(x0, y, z0 + t, x0 + t, y + ph, z1 - t, S.PLAIN, c, { detail: true });
    this.box(x1 - t, y, z0 + t, x1, y + ph, z1 - t, S.PLAIN, c, { detail: true });
    const w = x1 - x0, d = z1 - z0;
    const n = Math.floor(r() * 4 * Math.min(1, w * d / 900));
    for (let k = 0; k < n; k++) {
      const sx = 2 + r() * 4, sz = 2 + r() * 3, sy = 1.2 + r() * 2.2;
      const px = x0 + 2 + r() * Math.max(0, w - sx - 4), pz = z0 + 2 + r() * Math.max(0, d - sz - 4);
      this.box(px, y, pz, px + sx, y + sy, pz + sz, S.MECH, pick(r, PAL.concrete), { detail: true, seed: r() });
    }
  }

  waterTank(x, z, y, r) {
    const rad = 2.2 + r() * 1.2, legs = 3 + r() * 2, th = 4 + r() * 2;
    this.meshes.push({ kind: "tank", x, z, y, rad, legs, th, seed: r() });
    this.box(x - rad, y + legs, z - rad, x + rad, y + legs + th + rad * 0.5, z + rad, S.TANK, lin(0x6a5040),
      { detail: true, render: false });
    this.boxes[this.boxes.length - 1].render = false;
  }

  glassTower(x0, z0, x1, z1, h, r) {
    const glass = pick(r, PAL.glass);
    const podium = r() < 0.6;
    const ph = podium ? 12 + Math.floor(r() * 4) * 3.8 : 6;
    this.shop(x0, z0, x1, z1, 6, r);
    if (podium) this.box(x0, 6, z0, x1, ph, z1, r() < 0.5 ? S.STONE : S.GLASS, r() < 0.5 ? pick(r, PAL.stone) : glass, { seed: r() });
    const maxIn = Math.max(0, (Math.min(x1 - x0, z1 - z0) - 20) / 2);
    let m = podium ? Math.min(maxIn, 3 + r() * 7) : 0;
    let tx0 = x0 + m, tz0 = z0 + m, tx1 = x1 - m, tz1 = z1 - m;
    let y = ph;
    const tiers = h > 200 ? 1 + Math.floor(r() * 3) : 1 + (r() < 0.3 ? 1 : 0);
    const seed = r();
    for (let k = 0; k < tiers; k++) {
      const top = k === tiers - 1 ? h : y + (h - y) * (0.55 + 0.2 * r());
      this.box(tx0, y, tz0, tx1, top, tz1, S.GLASS, glass, { seed });
      y = top;
      if (k < tiers - 1) {
        const inset = Math.min(3 + r() * 5, Math.max(0, (Math.min(tx1 - tx0, tz1 - tz0) - 16) / 2));
        this.roofTop(tx0, tz0, tx1, tz1, y, r);
        tx0 += inset; tz0 += inset; tx1 -= inset; tz1 -= inset;
      }
    }
    this.roofTop(tx0, tz0, tx1, tz1, h, r, glass.map((v) => v * 2.2));
    // crown: mechanical penthouse
    const ci = Math.min(4, (Math.min(tx1 - tx0, tz1 - tz0) - 8) / 2);
    if (ci > 0) this.box(tx0 + ci, h, tz0 + ci, tx1 - ci, h + 5 + r() * 6, tz1 - ci, S.MECH, glass.map((v) => v * 1.5), { seed: r() });
    if (h > 250) this.antenna((tx0 + tx1) / 2, (tz0 + tz1) / 2, h + 8, 30 + r() * 60, r);
  }

  antenna(x, z, y, len, r) {
    const w = 0.8;
    this.box(x - w, y, z - w, x + w, y + len, z + w, S.METAL, lin(0x8a8a90), { seed: r() });
    this.box(x - 3, y, z - 3, x + 3, y + 3, z + 3, S.MECH, lin(0x505258), { seed: r() });
    this.lights.push({ x, y: y + len + 0.6, z });
  }

  decoTower(x0, z0, x1, z1, h, r) {
    const stone = pick(r, PAL.stone);
    this.shop(x0, z0, x1, z1, 6, r);
    const tiers = h > 180 ? 3 + Math.floor(r() * 3) : 2 + Math.floor(r() * 2);
    let tx0 = x0, tz0 = z0, tx1 = x1, tz1 = z1, y = 6;
    const seed = r();
    for (let k = 0; k < tiers; k++) {
      const frac = k === tiers - 1 ? 1 : 0.45 + 0.25 * r();
      const top = k === tiers - 1 ? h : Math.round((y + (h - y) * frac) / 3.8) * 3.8;
      this.box(tx0, y, tz0, tx1, top, tz1, S.STONE, stone, { seed });
      // cornice band
      this.box(tx0 - 0.4, top - 1.2, tz0 - 0.4, tx1 + 0.4, top, tz1 + 0.4, S.PLAIN, stone.map((v) => v * 1.12), { detail: true, bottom: true, rim: 0.4 });
      y = top;
      if (k < tiers - 1) {
        const room = (Math.min(tx1 - tx0, tz1 - tz0) - 14) / 2;
        if (room <= 1) break;
        const inset = Math.min(room, 3 + r() * 6);
        this.roofTop(tx0, tz0, tx1, tz1, y, r, stone);
        tx0 += inset; tz0 += inset; tx1 -= inset; tz1 -= inset;
      }
    }
    const cx = (tx0 + tx1) / 2, cz = (tz0 + tz1) / 2;
    if (h > 150 && r() < 0.6) {
      // stepped spire
      let s = Math.min(tx1 - tx0, tz1 - tz0) / 2 - 1.5, yy = y;
      for (let k = 0; k < 4 && s > 2; k++) {
        const hh = 6 + r() * 6;
        this.box(cx - s, yy, cz - s, cx + s, yy + hh, cz + s, k < 2 ? S.STONE : S.METAL, k < 2 ? stone : lin(0xb8b4a8), { seed });
        yy += hh; s *= 0.62;
      }
      const sl = 25 + r() * 35;
      this.meshes.push({ kind: "cone", x: cx, z: cz, y: yy, rad: Math.max(1.2, s), h: sl, col: lin(0xc8c4b8) });
      this.box(cx - s * 0.5, yy, cz - s * 0.5, cx + s * 0.5, yy + sl * 0.6, cz + s * 0.5, S.METAL, lin(0xc8c4b8), { detail: true });
      this.boxes[this.boxes.length - 1].render = false;
      this.lights.push({ x: cx, y: yy + sl + 0.5, z: cz });
    } else {
      this.roofTop(tx0, tz0, tx1, tz1, y, r, stone);
      if (r() < 0.4 && tx1 - tx0 > 14) this.waterTank(cx + (r() - 0.5) * 4, cz + (r() - 0.5) * 4, y, r);
    }
  }

  brick(x0, z0, x1, z1, h, r) {
    const col = pick(r, PAL.brick);
    const sh = 5;
    this.shop(x0, z0, x1, z1, sh, r);
    const seed = r();
    let top = h;
    const setback = h > 40 && r() < 0.35;
    const y1 = setback ? Math.round(h * (0.65 + 0.15 * r()) / 3.8) * 3.8 : h;
    this.box(x0, sh, z0, x1, y1, z1, S.BRICK, col, { seed });
    this.box(x0 - 0.7, y1 - 1.4, z0 - 0.7, x1 + 0.7, y1, z1 + 0.7, S.PLAIN, pick(r, PAL.stone), { detail: true, bottom: true, rim: 0.7 });
    let rx0 = x0, rz0 = z0, rx1 = x1, rz1 = z1;
    if (setback) {
      const inset = Math.min(4, (Math.min(x1 - x0, z1 - z0) - 10) / 2);
      if (inset > 1) {
        this.roofTop(x0, z0, x1, z1, y1, r);
        rx0 += inset; rz0 += inset; rx1 -= inset; rz1 -= inset;
        this.box(rx0, y1, rz0, rx1, top, rz1, S.BRICK, col, { seed });
      } else top = y1;
    } else top = y1;
    this.roofTop(rx0, rz0, rx1, rz1, top, r, col);
    if (r() < 0.55 && rx1 - rx0 > 10 && rz1 - rz0 > 10)
      this.waterTank(rx0 + 4 + r() * (rx1 - rx0 - 8), rz0 + 4 + r() * (rz1 - rz0 - 8), top, r);
  }

  modern(x0, z0, x1, z1, h, r) {
    const col = pick(r, PAL.concrete);
    this.shop(x0, z0, x1, z1, 6, r);
    const seed = r();
    this.box(x0, 6, z0, x1, h, z1, r() < 0.5 ? S.RIBBON : S.GLASS, r() < 0.5 ? col : pick(r, PAL.glass), { seed });
    this.roofTop(x0, z0, x1, z1, h, r);
  }

  plaza(x0, z0, x1, z1, r) {
    this.box(x0 + 1, 0.2, z0 + 1, x1 - 1, 0.45, z1 - 1, S.WALK, lin(0xb0a898), { seed: r() });
    const n = Math.floor((x1 - x0) * (z1 - z0) / 260);
    for (let k = 0; k < n; k++)
      this.trees.push({ x: x0 + 4 + r() * (x1 - x0 - 8), y: 0.45, z: z0 + 4 + r() * (z1 - z0 - 8), s: 0.7 + r() * 0.5, seed: r() });
  }

  park(r) {
    const P = G.PARK;
    const pw = P.x1 - P.x0, pd = P.z1 - P.z0;
    // pond in the middle-north of the park; grass slab made of 4 boxes around it
    const qx0 = P.x0 + pw * 0.22, qx1 = P.x1 - pw * 0.22, qz0 = P.z0 + pd * 0.18, qz1 = P.z0 + pd * 0.36;
    this.pond = { x0: qx0, z0: qz0, x1: qx1, z1: qz1 };
    const grass = lin(0x4a6a32);
    const e = G.WALK;
    this.box(P.x0 - e, -1, P.z0 - e, P.x1 + e, 0.3, qz0, S.GRASS, grass);
    this.box(P.x0 - e, -1, qz1, P.x1 + e, 0.3, P.z1 + e, S.GRASS, grass);
    this.box(P.x0 - e, -1, qz0, qx0, 0.3, qz1, S.GRASS, grass);
    this.box(qx1, -1, qz0, P.x1 + e, 0.3, qz1, S.GRASS, grass);
    // trees, avoiding the pond, denser near edges; a few rock outcrops
    let placed = 0;
    for (let k = 0; k < 9000 && placed < 1500; k++) {
      const x = P.x0 + r() * pw, z = P.z0 + r() * pd;
      if (x > qx0 - 6 && x < qx1 + 6 && z > qz0 - 6 && z < qz1 + 6) continue;
      const n = vnoise(x / 60, z / 60);
      if (n < 0.45) continue;
      // keep a few meadows + paths clear
      const path = Math.abs(Math.sin((x - P.x0) / 70 + Math.cos(z / 90) * 1.5));
      if (path < 0.06) continue;
      this.trees.push({ x, y: 0.3, z, s: 0.8 + r() * 0.8, seed: r() });
      placed++;
    }
    for (let k = 0; k < 14; k++) {
      const x = P.x0 + 20 + r() * (pw - 40), z = P.z0 + 20 + r() * (pd - 40);
      if (x > qx0 - 10 && x < qx1 + 10 && z > qz0 - 10 && z < qz1 + 10) continue;
      const s = 3 + r() * 5;
      this.box(x - s, 0, z - s * 0.7, x + s, 0.3 + 1 + r() * 3, z + s * 0.7, S.PLAIN, lin(0x77746c), { seed: r(), detail: true });
    }
  }

  streetLamps(r) {
    // lamps along both sidewalks of every avenue and street (skip the park interior)
    const P = G.PARK;
    const inPark = (x, z) => x > P.x0 - 2 && x < P.x1 + 2 && z > P.z0 - 2 && z < P.z1 + 2;
    for (let i = 0; i <= G.NX; i++) {
      const ax = G.X0 + i * G.PX;
      for (const side of [-1, 1]) {
        const x = ax + side * (G.AW / 2 - 1.2);
        for (let z = G.Z0 - G.SW / 2; z < G.Z0 + G.NZ * G.PZ; z += 32) {
          const zz = z + 14;
          const m = ((zz - G.Z0) % G.PZ + G.PZ) % G.PZ;
          if (m < G.SW / 2 + 3 || m > G.PZ - G.SW / 2 - 3) continue;
          if (!inPark(x, zz)) this.lamps.push({ x, z: zz, dx: -side, dz: 0 });
        }
      }
    }
    for (let j = 0; j <= G.NZ; j++) {
      const sz = G.Z0 + j * G.PZ;
      for (const side of [-1, 1]) {
        const z = sz + side * (G.SW / 2 - 1.2);
        for (let x = G.X0; x < G.X0 + G.NX * G.PX; x += 36) {
          const xx = x + 18;
          const m = ((xx - G.X0) % G.PX + G.PX) % G.PX;
          if (m < G.AW / 2 + 3 || m > G.PX - G.AW / 2 - 3) continue;
          if (!inPark(xx, z)) this.lamps.push({ x: xx, z, dx: 0, dz: -side });
        }
      }
    }
  }

  farShores(r) {
    // low-detail skylines across the rivers (east, west, north); open sea to the south
    const I = G.ISLAND;
    const shores = [
      { x0: I.x1 + 700, x1: I.x1 + 3200, z0: I.z0 - 2500, z1: I.z1 + 400, tall: 0.5 },
      { x0: I.x0 - 3400, x1: I.x0 - 900, z0: I.z0 - 2500, z1: I.z1 - 200, tall: 0.9 },
      { x0: I.x0 - 900, x1: I.x1 + 700, z0: I.z0 - 3400, z1: I.z0 - 1100, tall: 0.4 },
    ];
    for (const s of shores) {
      this.box(s.x0, -3, s.z0, s.x1, 1.5, s.z1, S.PLAIN, lin(0x3c4034), { far: true, collide: false });
      for (let x = s.x0 + 20; x < s.x1 - 20; x += 36 + r() * 30) {
        for (let z = s.z0 + 20; z < s.z1 - 20; z += 36 + r() * 30) {
          if (r() < 0.35) continue;
          const near = Math.max(0, 1 - Math.min(Math.abs(x - (s.x0 + s.x1) / 2), 99999) / ((s.x1 - s.x0)));
          let h = 10 + Math.pow(r(), 3) * 110 * s.tall * (0.4 + near);
          if (r() < 0.01) h = 150 + r() * 120 * s.tall;
          const w = 14 + r() * 22, d = 14 + r() * 22;
          const style = h > 70 ? (r() < 0.5 ? S.GLASS : S.STONE) : (r() < 0.6 ? S.BRICK : S.STONE);
          const col = style === S.GLASS ? pick(r, PAL.glass) : style === S.BRICK ? pick(r, PAL.brick) : pick(r, PAL.stone);
          this.box(x, 1, z, x + w, 1 + h, z + d, style, col, { far: true, collide: false, seed: r() });
        }
      }
    }
  }

  placeTokens(r) {
    // collectibles: rooftops (reward exploring up) and mid-air in canyons (reward swinging)
    const roofs = this.boxes.filter((b) => b.collide && !b.detail && b.y1 > 40 && b.style !== S.MECH && b.style !== S.METAL
      && (b.x1 - b.x0) > 12 && (b.z1 - b.z0) > 12);
    for (let k = 0; k < 40 && roofs.length; k++) {
      const b = roofs[Math.floor(r() * roofs.length)];
      this.tokens.push({ x: (b.x0 + b.x1) / 2, y: b.y1 + 2.5, z: (b.z0 + b.z1) / 2 });
    }
    for (let k = 0; k < 60; k++) {
      const i = Math.floor(r() * (G.NX + 1)), j = Math.floor(r() * G.NZ);
      const along = r() < 0.5;
      let x, z;
      if (along) { x = G.X0 + i * G.PX; z = G.Z0 + j * G.PZ + G.PZ / 2; }
      else { x = G.X0 + Math.min(i, G.NX - 1) * G.PX + G.PX / 2; z = G.Z0 + j * G.PZ; }
      const P = G.PARK;
      if (x > P.x0 && x < P.x1 && z > P.z0 && z < P.z1) continue;
      const dh = districtHeight(x, z);
      this.tokens.push({ x, y: 18 + r() * Math.min(60, dh * 0.4), z });
    }
  }
}
