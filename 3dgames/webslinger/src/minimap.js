// Heading-up minimap (canvas 2D): blocks, the park, water, tokens, race starts,
// the next race rings and the ghost. Redrawn at ~30 Hz; M toggles it.
import { G } from "./city.js";

export class Minimap {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.t = 0;
    this.range = 420;          // metres from centre to edge
  }

  update(dt, pl, yaw, tokens, races) {
    this.t -= dt;
    if (this.t > 0 || this.cv.offsetParent === null) return;
    this.t = 1 / 30;
    const cv = this.cv, g = this.ctx, dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(cv.clientWidth * dpr);
    if (cv.width !== W) { cv.width = W; cv.height = W; }
    const R = W / 2, k = R / this.range;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.clip();
    g.fillStyle = "rgba(18,40,60,0.78)"; g.fillRect(0, 0, W, W);
    // world → map: translate to the player, rotate so the camera looks up
    g.translate(R, R);
    g.rotate(yaw);
    g.scale(k, k);
    g.translate(-pl.p.x, -pl.p.z);
    const I = G.ISLAND;
    g.fillStyle = "rgba(40,44,52,0.9)";
    g.fillRect(I.x0, I.z0, I.x1 - I.x0, I.z1 - I.z0);
    const P = G.PARK, reach = this.range * 1.5;
    for (let i = 0; i < G.NX; i++) {
      const x0 = G.X0 + i * G.PX + G.AW / 2, x1 = x0 + G.BX;
      if (x1 < pl.p.x - reach || x0 > pl.p.x + reach) continue;
      for (let j = 0; j < G.NZ; j++) {
        const z0 = G.Z0 + j * G.PZ + G.SW / 2, z1 = z0 + G.BZ;
        if (z1 < pl.p.z - reach || z0 > pl.p.z + reach) continue;
        const park = i >= P.i0 && i < P.i1 && j >= P.j0 && j < P.j1;
        g.fillStyle = park ? "rgba(60,110,60,0.95)" : "rgba(120,128,140,0.95)";
        g.fillRect(x0, z0, x1 - x0, z1 - z0);
      }
    }
    // park interior streets are grass too
    g.fillStyle = "rgba(60,110,60,0.95)";
    g.fillRect(P.x0, P.z0, P.x1 - P.x0, P.z1 - P.z0);
    const dot = (x, z, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, z, r / k, 0, Math.PI * 2); g.fill(); };
    for (const t of tokens.list) if (!t.got) dot(t.x, t.z, 2.2 * dpr, "#ffb02e");
    const A = races.active;
    if (!A) {
      for (const c of races.courses) {
        const s = c.rings[0];
        g.save(); g.translate(s.x, s.z); g.rotate(Math.PI / 4);
        g.fillStyle = "#ffcf40"; const d = 4.5 * dpr / k; g.fillRect(-d, -d, 2 * d, 2 * d);
        g.restore();
      }
    } else {
      const rs = A.c.rings;
      g.strokeStyle = "rgba(90,220,255,0.55)"; g.lineWidth = 2 * dpr / k;
      g.beginPath(); g.moveTo(pl.p.x, pl.p.z);
      for (let q = A.k; q < rs.length; q++) g.lineTo(rs[q].x, rs[q].z);
      g.stroke();
      for (let q = A.k; q < Math.min(rs.length, A.k + 3); q++) dot(rs[q].x, rs[q].z, (q === A.k ? 4 : 2.5) * dpr, q === A.k ? "#7ff0ff" : "#3aa6c8");
      if (races.ghost.visible) dot(races.ghost.position.x, races.ghost.position.z, 3 * dpr, "#d070ff");
    }
    g.restore();
    // player arrow (always pointing up = camera direction, body shows facing)
    g.save(); g.translate(R, R); g.rotate(yaw - pl.facing);
    g.fillStyle = "#fff"; g.strokeStyle = "#e8203a"; g.lineWidth = 2 * dpr;
    const s = 7 * dpr;
    g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.7, s * 0.8); g.lineTo(0, s * 0.35); g.lineTo(-s * 0.7, s * 0.8); g.closePath();
    g.fill(); g.stroke();
    g.restore();
    g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = 1.5 * dpr;
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.stroke();
  }
}
