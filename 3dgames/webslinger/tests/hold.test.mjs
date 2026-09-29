// Held-swing chain: a player who just holds swing (as the controls page says) and
// pushes forward must keep flying down the street. Before 2026-09-29 a held
// swing only let go near the anchor's height: you left going straight up at
// walking pace, or rocked back and forth under the anchor (14.7 m/s average, 21
// m travelled in 25 s). Also checks the rope never goes slack and snaps taut.
import { City } from "../src/city.js";
import { World } from "../src/collide.js";
import { Player } from "../src/player.js";
const w = new World(new City(1337));
let fails = 0;
const check = (ok, msg) => { console.log((ok ? "ok   " : "FAIL ") + msg); if (!ok) fails++; };
const runs = [
  { x: -1104 + 184 * 3, z: 900, yaw: 0, name: "avenue" },
  { x: -900, z: -1352 + 20 * 104, yaw: -Math.PI / 2, name: "street" },
];
for (const R of runs) {
  const pl = new Player(w);
  pl.p.x = R.x; pl.p.z = R.z; pl.p.y = w.floorBelow(R.x, R.z, 400) + 0.95; pl.state = "ground";
  const dt = 1 / 120;
  let t = 0, prevSwing = false, hs = 0, n = 0, snaps = 0, t0 = 0, longest = 0, steepest = 0, pv = null;
  for (let i = 0; i < 120 * 25; i++, t += dt) {
    const swing = t > 1.6;
    const c = { mx: 0, mz: 1, yaw: R.yaw, swing, swingP: swing && !prevSwing, jump: t > 0.6 && t < 1.4, jumpP: false, zip: false, dash: false, dive: false,
      fwd: { x: -Math.sin(R.yaw), y: 0, z: -Math.cos(R.yaw) }, camPos: { ...pl.p } };
    prevSwing = swing;
    const st0 = pl.state;
    pl.update(dt, c);
    const ev = pl.events.slice(); pl.events.length = 0;
    if (ev.includes("thwip")) t0 = t;
    if (st0 === "swing" && pl.state === "air") {
      longest = Math.max(longest, t - t0);
      steepest = Math.max(steepest, Math.atan2(pl.v.y, Math.hypot(pl.v.x, pl.v.z)) * 180 / Math.PI);
    }
    if (pv && t > 2 && !ev.length && Math.hypot(pl.v.x - pv.x, pl.v.y - pv.y, pl.v.z - pv.z) > 3) snaps++;
    pv = { ...pl.v };
    if (t > 3) { hs += Math.hypot(pl.v.x, pl.v.z); n++; }
  }
  const avg = hs / n;
  check(avg > 35, `${R.name}: held chain keeps its speed (avg ${avg.toFixed(1)} m/s, ${pl.stats.swings} swings)`);
  check(longest < 2.6, `${R.name}: held swings let go in time (longest ${longest.toFixed(2)} s)`);
  check(steepest < 50, `${R.name}: auto-release flies forward, not straight up (steepest ${steepest.toFixed(0)}°)`);
  check(snaps === 0, `${R.name}: no slack-rope snaps (${snaps})`);
}
process.exit(fails ? 1 : 0);
