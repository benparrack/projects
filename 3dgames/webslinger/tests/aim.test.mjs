// Swing targeting: looking at a pole tip (antenna / spire / rooftop mast) locks the
// web onto it; looking up at a building edge makes that spot the likely anchor.
// Also re-runs a flow bot with the camera pitched up to check pole locks don't
// wreck normal swinging. Usage: node tests/aim.test.mjs
const root = "..";
const { City, G } = await import(new URL(root + "/src/city.js", import.meta.url).href);
const { World } = await import(new URL(root + "/src/collide.js", import.meta.url).href);
const { Player } = await import(new URL(root + "/src/player.js", import.meta.url).href);
const w = new World(new City(1337));
let fails = 0;
const ok = (c, msg) => { console.log((c ? "ok   " : "FAIL ") + msg); if (!c) fails++; };
const norm = (x, y, z) => { const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l }; };
const base = { mx: 0, mz: 1, swing: false, swingP: false, jump: false, jumpP: false, zip: false, dash: false, dive: false };

// pick mast tips 40–90 m up, stand the player on the avenue next to them in the air
let tried = 0, locked = 0, swung = 0, offLocked = 0;
for (const q of w.poles) {
  if (q.y < 40 || q.y > 90 || tried >= 40) continue;
  // nearest avenue / street centre line
  const i = Math.round((q.x - G.X0) / G.PX), ax = G.X0 + i * G.PX;
  if (Math.abs(ax - q.x) > 40) continue;
  tried++;
  const pl = new Player(w);
  pl.p.x = ax; pl.p.z = q.z + 45; pl.p.y = q.y - 26; pl.state = "air";
  pl.v.x = 0; pl.v.z = -25; pl.v.y = 0;
  const cam = { x: pl.p.x, y: pl.p.y + 2, z: pl.p.z + 6 };
  const c = { ...base, yaw: 0, camPos: cam, fwd: norm(q.x - cam.x, q.y - cam.y, q.z - cam.z) };
  const a = pl.findAnchor(c);
  if (a && a.pole && Math.abs(a.x - q.x) < 0.01 && Math.abs(a.z - q.z) < 0.01) locked++;
  else continue;
  // aim 20° to the side: shouldn't lock onto this pole
  const f = c.fwd, s = Math.sin(0.35), co = Math.cos(0.35);
  const c2 = { ...c, fwd: { x: f.x * co - f.z * s, y: f.y, z: f.x * s + f.z * co } };
  const b = pl.findAnchor(c2);
  if (b && b.pole && b.x === q.x && b.z === q.z) offLocked++;
  // swing from it for 1.2 s
  c.swing = true; c.swingP = true;
  let bad = false;
  for (let k = 0; k < 144; k++) {
    pl.update(1 / 120, c); c.swingP = false;
    if (!Number.isFinite(pl.p.x + pl.p.y + pl.v.x)) bad = true;
    pl.events.length = 0;
  }
  if (!bad && pl.stats.swings >= 1) swung++;
}
ok(tried >= 20, `found ${tried} mast tips 40–90 m up beside an avenue`);
ok(locked >= tried * 0.7, `crosshair locks the pole ${locked}/${tried}`);
ok(offLocked === 0, `no lock when aiming 20° off (${offLocked})`);
ok(swung === locked, `swings from locked poles stay finite (${swung}/${locked})`);

// crosshair on a building edge while looking up picks (near) that spot
{
  const pl = new Player(w);
  pl.p.x = 0; pl.p.z = 600; pl.p.y = 20; pl.state = "air"; pl.v.z = -20;
  let near = 0, n = 0;
  for (const yawOff of [-0.5, -0.3, 0.3, 0.5]) {
    const f = norm(Math.sin(yawOff) * -1, 0.75, -Math.cos(yawOff));
    const cam = { x: pl.p.x, y: pl.p.y + 1.5, z: pl.p.z + 5 };
    const h = w.raycast(cam.x, cam.y, cam.z, f.x, f.y, f.z, 160);
    if (!h || h.box < 0 || h.y < pl.p.y + 10) continue;
    const hx = h.x, hy = h.y, hz = h.z;
    const a = pl.findAnchor({ ...base, yaw: 0, camPos: cam, fwd: f });
    n++;
    if (a && Math.hypot(a.x - hx, a.y - hy, a.z - hz) < 12) near++;
  }
  ok(n > 0 && near >= n - 1, `looking up at a wall anchors near the crosshair ${near}/${n}`);
}

// flow bot with the camera pitched up: pole locks must not wreck momentum
const runs = [
  { x: 0, z: 600, yaw: 0 }, { x: -1104 + 184 * 3, z: 900, yaw: 0 },
  { x: -900, z: G.Z0 + 20 * G.PZ, yaw: -Math.PI / 2 }, { x: 0, z: 600, yaw: 0.45 },
];
for (const pitch of [0.12, 0.3]) {
  let walls = 0, spd = 0, poles = 0, sw = 0;
  for (const R of runs) {
    const pl = new Player(w);
    pl.p.x = R.x; pl.p.z = R.z; pl.p.y = w.floorBelow(R.x, R.z, 400) + 0.95; pl.state = "ground";
    const dt = 1 / 120; let t = 0, held = true, prev = false, relT = 0, sp = 0, n = 0;
    for (let i = 0; i < 120 * 45; i++, t += dt) {
      if (pl.state === "swing" && pl.v.y > 5 && pl.attachT > 0.4) { held = false; relT = 0; }
      relT += dt; if (!held && relT > 0.3) held = true;
      const cp = Math.cos(pitch);
      const c = { ...base, yaw: R.yaw, swing: t > 1.6 && held, swingP: t > 1.6 && held && !prev, jump: t > 0.6 && t < 1.4,
        fwd: { x: -Math.sin(R.yaw) * cp, y: Math.sin(pitch), z: -Math.cos(R.yaw) * cp },
        camPos: { x: pl.p.x + Math.sin(R.yaw) * 6, y: pl.p.y + 2, z: pl.p.z + Math.cos(R.yaw) * 6 } };
      prev = c.swing;
      const s0 = pl.stats.swings;
      pl.update(dt, c);
      if (pl.stats.swings > s0 && pl.anchorPole) poles++;
      for (const e of pl.events) if (e === "wall") walls++;
      pl.events.length = 0;
      if (t > 3) { sp += Math.hypot(pl.v.x, pl.v.z); n++; }
    }
    spd += sp / n / runs.length; sw += pl.stats.swings;
  }
  console.log(`     pitch ${pitch}: walls ${walls}, avgH ${spd.toFixed(1)} m/s, pole swings ${poles}/${sw}`);
  ok(walls <= 6 && spd > 28, `flow with camera pitched ${pitch} rad still flows`);
}
process.exit(fails ? 1 : 0);
