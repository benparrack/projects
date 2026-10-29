// Loading + decoding the preprocessed data (see scripts/*.py for the formats).

export async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  let buf = new Uint8Array(await r.arrayBuffer());
  // servers may or may not have undone the gzip already (Content-Encoding)
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip")));
    buf = new Uint8Array(await ds.arrayBuffer());
  }
  return buf;
}

function magic(buf, s) {
  return String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) === s;
}

/** SB3D mesh tile -> typed arrays. */
export function parseMeshTile(buf) {
  if (!magic(buf, "SB3D")) throw new Error("bad tile");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const V = dv.getUint32(4, true), T = dv.getUint32(8, true), idBytes = dv.getUint32(12, true);
  let o = 16;
  const take = (n) => { const s = buf.slice(o, o + n); o += n; return s.buffer; };
  const position = new Float32Array(take(V * 12));
  const normal = new Int8Array(take(V * 4));
  const color = new Uint8Array(take(V * 4));
  const owner = idBytes === 2 ? new Uint16Array(take(T * 2)) : new Uint32Array(take(T * 4));
  return { position, normal, color, owner, V, T };
}

/** Terrain heightmap (int16 decimetres). */
export function parseHeightmap(buf) {
  if (!magic(buf, "SHM1")) throw new Error("bad heightmap");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const cols = dv.getUint32(4, true), rows = dv.getUint32(8, true);
  const x0 = dv.getFloat32(12, true), z0 = dv.getFloat32(16, true), step = dv.getFloat32(20, true);
  const raw = new Int16Array(buf.slice(24, 24 + cols * rows * 2).buffer);
  const h = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) h[i] = raw[i] / 10;
  const at = (x, z) => {
    let c = (x - x0) / step, r = (z - z0) / step;
    c = Math.min(Math.max(c, 0), cols - 1.001);
    r = Math.min(Math.max(r, 0), rows - 1.001);
    const c0 = Math.floor(c), r0 = Math.floor(r), fc = c - c0, fr = r - r0;
    const i = r0 * cols + c0;
    return (h[i] * (1 - fc) + h[i + 1] * fc) * (1 - fr) + (h[i + cols] * (1 - fc) + h[i + cols + 1] * fc) * fr;
  };
  return { cols, rows, x0, z0, step, h, at };
}

/** Tree instances: x, y, z f32, kind u8, height*8 u8, seed u16 (16 bytes each). */
export function parseTrees(buf) {
  if (!magic(buf, "STR1")) throw new Error("bad trees");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint32(4, true);
  const out = new Array(n);
  for (let i = 0, o = 8; i < n; i++, o += 16) {
    out[i] = { x: dv.getFloat32(o, true), y: dv.getFloat32(o + 4, true), z: dv.getFloat32(o + 8, true),
      kind: dv.getUint8(o + 12), h: dv.getUint8(o + 13) / 8, seed: dv.getUint16(o + 14, true) };
  }
  return out;
}

/** Run async jobs with bounded concurrency, highest priority (lowest value) first. */
export class Queue {
  constructor(n = 6) { this.n = n; this.active = 0; this.jobs = []; }
  push(priority, fn) {
    return new Promise((res, rej) => {
      this.jobs.push({ priority, fn, res, rej });
      this.jobs.sort((a, b) => a.priority - b.priority);
      this.pump();
    });
  }
  reprioritize(f) { for (const j of this.jobs) j.priority = f(j); this.jobs.sort((a, b) => a.priority - b.priority); }
  pump() {
    while (this.active < this.n && this.jobs.length) {
      const j = this.jobs.shift();
      this.active++;
      j.fn().then(j.res, j.rej).finally(() => { this.active--; this.pump(); });
    }
  }
  get pending() { return this.jobs.length + this.active; }
}
