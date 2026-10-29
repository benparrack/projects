// Pigeons: flocks scatter when you swing past or a web lands next to them, fly
// clear (not through buildings), and settle back on their perch once you've
// gone. Also checks the particle pool runs headless. Usage: node tests/birds.test.mjs
// the modules import "three" (an importmap in the browser): resolve it to the vendored copy
import { register } from "node:module";
const three = new URL("../vendor/three/three.module.js", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(
  `export async function resolve(s, c, next) { return s === "three" ? { url: ${JSON.stringify(three)}, shortCircuit: true } : next(s, c); }`));
const root = "..";
const { City } = await import(new URL(root + "/src/city.js", import.meta.url).href);
const { World } = await import(new URL(root + "/src/collide.js", import.meta.url).href);
const { Birds } = await import(new URL(root + "/src/birds.js", import.meta.url).href);
const { FX } = await import(new URL(root + "/src/fx.js", import.meta.url).href);
const city = new City(1337), w = new World(city);
let fails = 0;
const ok = (c, msg) => { console.log((c ? "ok   " : "FAIL ") + msg); if (!c) fails++; };
const scene = { add() {} };
const t0 = performance.now();
const birds = new Birds(scene, city, w);
console.log(`     ${birds.birds.length} pigeons in ${birds.flocks.length} flocks, built in ${(performance.now() - t0).toFixed(0)} ms`);
ok(birds.birds.length > 500, "plenty of pigeons");
// every perch is on something solid, not floating or buried
let bad = 0;
for (const b of birds.birds) { const f = w.floorBelow(b.hx, b.hz, b.hy + 0.5); if (Math.abs(f - b.hy) > 0.15) bad++; }
ok(bad <= birds.birds.length * 0.02, `perches sit on a surface (${bad} off)`);

// fly the player past 20 rooftop flocks at swing speed, then leave
const far = { p: { x: 1e5, y: 0, z: 1e5 }, v: { x: 0, y: 0, z: 0 } };
let scattered = 0, home = 0, inside = 0, frames = 0, nan = 0, tried = 0;
for (const f of birds.flocks.filter((f) => f.perch).slice(0, 20)) {
  tried++;
  const pl = { p: { x: f.cx + 30, y: f.cy + 3, z: f.cz }, v: { x: -30, y: 0, z: 0 } };
  for (let i = 0; i < 120; i++) { pl.p.x += pl.v.x / 60; birds.update(1 / 60, pl, []); }
  if (f.scared) scattered++;
  for (let i = 0; i < 60 * 40; i++) {
    birds.update(1 / 60, far, []);
    if (i % 6 === 0) for (const b of f.birds) {
      if (!b.flying) continue;
      frames++;
      if (!Number.isFinite(b.x + b.y + b.z)) nan++;
      else if (b.t > b.delay + 0.3 && w.overlaps(b.x - 0.1, b.y + 0.05, b.z - 0.1, b.x + 0.1, b.y + 0.25, b.z + 0.1)) inside++;
    }
  }
  if (f.birds.every((b) => !b.flying && b.x === b.hx && b.z === b.hz)) home++;
}
birds.events.length = 0;
ok(scattered === tried, `swinging past scatters the flock (${scattered}/${tried})`);
ok(home === tried, `flocks settle back on their perch (${home}/${tried})`);
ok(nan === 0, "no NaN");
ok(inside <= frames * 0.03, `flying pigeons stay out of buildings (${inside}/${frames} samples inside)`);

// a web strike next to a flock spooks it; far away doesn't
{
  const f = birds.flocks.find((f) => f.perch && !f.scared);
  birds.update(1 / 60, far, [{ x: f.cx + 40, y: f.cy, z: f.cz, r: 10 }]);
  const before = f.scared;
  birds.update(1 / 60, far, [{ x: f.cx + 3, y: f.cy + 2, z: f.cz, r: 10 }]);
  ok(!before && f.scared && birds.events.length === 1, "a web hit next to a flock spooks it");
}

// particles: spawn a mix, step until everything has faded
{
  const fx = new FX(scene);
  fx.dust(0, 0, 0, 1); fx.impact(0, 10, 0, 1, 0, 0); fx.splash(0, -1.6, 0); fx.feathers(0, 5, 0); fx.grit(0, 1, 0, 1, 0);
  const cam = { fov: 70 };
  fx.update(1 / 60, cam, 1080);
  const n0 = fx.live;
  let fin = true;
  for (let i = 0; i < 60 * 6; i++) { fx.update(1 / 60, cam, 1080); for (let k = 0; k < fx.pos.length; k++) if (!Number.isFinite(fx.pos[k])) fin = false; }
  ok(n0 > 100 && fx.live === 0 && fin, `particles spawn (${n0}), stay finite and fade out`);
}
process.exit(fails ? 1 : 0);
