// Headless swing bot: runs the real player physics through a city and checks it
// behaves (no NaNs, never inside a box, sensible speeds, swings actually chain).
import { City, G } from "../src/city.js";
import { World } from "../src/collide.js";
import { Player, P } from "../src/player.js";
const w = new World(new City(1337));
const pl = new Player(w);
console.log("spawn", pl.p);
const ctl = (o = {}) => ({ mx: 0, mz: 1, yaw: 0, swing: false, swingP: false, jump: false, jumpP: false, zip: false, dash: false, dive: false,
  fwd: { x: 0, y: 0, z: -1 }, camPos: { ...pl.p }, ...o });
const dt = 1 / 60;
let t = 0, bad = 0, nan = 0, maxS = 0, states = {}, lowest = 1e9, events = {};
const inside = () => w.overlaps(pl.p.x - P.HX + 0.02, pl.p.y - P.HY + 0.02, pl.p.z - P.HZ + 0.02, pl.p.x + P.HX - 0.02, pl.p.y + P.HY - 0.02, pl.p.z + P.HZ - 0.02);
// scenario 1: run, charged jump, then hold swing heading north up the avenue
for (let i = 0; i < 60 * 40; i++, t += dt) {
  let c;
  if (t < 1) c = ctl();
  else if (t < 1.8) c = ctl({ jump: true });
  else c = ctl({ swing: (t % 3.2) < 2.6, swingP: Math.abs(t - 2) < dt / 2, jump: false, mx: Math.sin(t * 0.3) * 0.3 });
  pl.update(dt, c);
  for (const e of pl.events) events[e] = (events[e] || 0) + 1;
  pl.events.length = 0;
  if (![pl.p.x, pl.p.y, pl.p.z, pl.v.x, pl.v.y, pl.v.z].every(Number.isFinite)) nan++;
  if (inside()) bad++;
  const s = Math.hypot(pl.v.x, pl.v.y, pl.v.z);
  maxS = Math.max(maxS, s);
  states[pl.state] = (states[pl.state] || 0) + 1;
  if (pl.state === "swing") lowest = Math.min(lowest, pl.p.y - P.HY);
  if (i % 120 === 0) console.log(t.toFixed(1), pl.state.padEnd(6), "p", pl.p.x.toFixed(0), pl.p.y.toFixed(1), pl.p.z.toFixed(0), "speed", s.toFixed(1), "rope", pl.rope.toFixed(1));
}
console.log({ nan, insideFrames: bad, maxSpeed: maxS.toFixed(1), states, lowestSwingFeet: lowest.toFixed(1), events, stats: pl.stats });
