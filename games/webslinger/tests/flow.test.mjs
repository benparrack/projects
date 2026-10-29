// Swing-flow benchmark: a bot that swings like a player (hold, let go on the upswing,
// grab again) down avenues/streets and diagonally. Reports wall hits, glancing
// grazes, average horizontal speed and distance. Usage: node tests/flow.test.mjs [assist 0|1]
const root = "..", assistArg = process.argv[2] ?? "1";
const { City, G } = await import(new URL(root + "/src/city.js", import.meta.url).href);
const { World } = await import(new URL(root + "/src/collide.js", import.meta.url).href);
const { Player } = await import(new URL(root + "/src/player.js", import.meta.url).href);
const w = new World(new City(1337));
const runs = [
  { x: 0, z: 600, yaw: 0, name: "avenue -z" },
  { x: -1104 + 184 * 3, z: 900, yaw: 0, name: "avenue2 -z" },
  { x: -900, z: G.Z0 + 20 * G.PZ, yaw: -Math.PI / 2, name: "street +x" },
  { x: 0, z: 600, yaw: 0.45, name: "diagonal" },
];
let tot = { walls: 0, graze: 0, speed: 0, dist: 0, top: 0 };
for (const R of runs) {
  const pl = new Player(w);
  if (assistArg !== undefined && "assist" in pl) pl.assist = +assistArg;
  pl.spawn ? pl.spawn(R.x, R.z) : 0; pl.p.x = R.x; pl.p.z = R.z; pl.p.y = w.floorBelow(R.x, R.z, 400) + 0.95; pl.state = "ground";
  const dt = 1 / 120; let t = 0, held = true, heldPrev = false, relT = 0, walls = 0, graze = 0, sp = 0, n = 0, top = 0, st0 = pl.state;
  const x0 = pl.p.x, z0 = pl.p.z;
  for (let i = 0; i < 120 * 45; i++, t += dt) {
    // bot: hold to swing, let go on the upswing, grab again shortly after
    if (pl.state === "swing" && pl.v.y > 5 && pl.attachT > 0.4) { held = false; relT = 0; }
    relT += dt; if (!held && relT > 0.3) held = true;
    const c = { mx: 0, mz: 1, yaw: R.yaw, swing: t > 1.6 && held, swingP: t > 1.6 && held && !heldPrev, jump: t > 0.6 && t < 1.4, jumpP: false, zip: false, dash: false, dive: false, fwd: { x: -Math.sin(R.yaw), y: 0, z: -Math.cos(R.yaw) }, camPos: { ...pl.p } };
    heldPrev = c.swing;
    pl.update(dt, c);
    for (const e of pl.events) { if (e === "wall") walls++; if (e === "graze") graze++; }
    pl.events.length = 0;
    if (t > 3) { const s = Math.hypot(pl.v.x, pl.v.z); sp += s; n++; top = Math.max(top, s); }
  }
  const d = Math.hypot(pl.p.x - x0, pl.p.z - z0);
  console.log(R.name.padEnd(12), "walls", walls, "graze", graze, "avgHSpeed", (sp / n).toFixed(1), "topH", top.toFixed(1), "net dist", d.toFixed(0), "swings", pl.stats.swings);
  tot.walls += walls; tot.graze += graze; tot.speed += sp / n / runs.length; tot.dist += d;
}
console.log("TOTAL walls", tot.walls, "graze", tot.graze, "avgH", tot.speed.toFixed(1), "dist", tot.dist.toFixed(0));
