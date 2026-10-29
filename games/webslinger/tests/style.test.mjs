// Style combos + air tricks, headless: the flow bot swings down an avenue and does
// a trick after each release. Checks that tricks complete, combos score and bank,
// a trick started just before touchdown bails, and nothing goes NaN.
const u = (p) => new URL("../src/" + p, import.meta.url).href;
const { City } = await import(u("city.js"));
const { World } = await import(u("collide.js"));
const { Player } = await import(u("player.js"));
const { Style } = await import(u("style.js"));
const { COURSES, buildCourse } = await import(u("courses.js"));
const w = new World(new City(1337));
let fails = 0;
const check = (ok, msg) => { console.log((ok ? "ok   " : "FAIL ") + msg); if (!ok) fails++; };

// --- swinging with tricks
{
  const pl = new Player(w), st = new Style(w);
  pl.spawn(0, 600);
  const dt = 1 / 120, yaw = 0;
  let t = 0, held = true, heldPrev = false, relT = 0, trickAt = -1, nan = 0;
  const count = {};
  for (let i = 0; i < 120 * 30; i++, t += dt) {
    if (pl.state === "swing" && pl.v.y > 5 && pl.attachT > 0.4) { held = false; relT = 0; trickAt = t + 0.05; }
    relT += dt; if (!held && relT > 0.3 && pl.trickT <= 0) held = true;
    const trick = trickAt > 0 && t >= trickAt;
    if (trick) trickAt = -1;
    const mx = [0, 1, -1, 0][Math.floor(t) % 4], mz = [1, 0, 0, -0.5][Math.floor(t) % 4];
    const c = { mx: trick ? mx : 0, mz: trick ? mz : 1, yaw, swing: t > 1.6 && held, swingP: t > 1.6 && held && !heldPrev, jump: t > 0.6 && t < 1.4, jumpP: false, zip: false, dash: false, dive: false, trick, fwd: { x: 0, y: 0, z: -1 }, camPos: { ...pl.p } };
    heldPrev = c.swing;
    pl.update(dt, c);
    for (const e of pl.events) count[e] = (count[e] || 0) + 1;
    st.events(pl.events, pl);
    pl.events.length = 0;
    st.update(dt, pl);
    if (![pl.p.x, pl.p.y, pl.p.z, pl.v.x, pl.v.y, pl.v.z].every(Number.isFinite)) nan++;
  }
  console.log("events", count, "combo", st.points, "x" + st.mult, "banked total", st.total);
  check(nan === 0, "no NaN");
  check((count.trick || 0) >= 5, `tricks started (${count.trick || 0})`);
  check((count.trickDone || 0) >= (count.trick || 0) * 0.6, `most tricks completed (${count.trickDone || 0}/${count.trick || 0})`);
  check(st.points * st.mult + st.total > 3000, "style points scored");
}
// --- a trick right before touchdown bails and loses the combo
{
  const pl = new Player(w), st = new Style(w);
  pl.spawn(0, 600);
  pl.p.y += 0.3; pl.v.y = -8; pl.state = "air";
  st.add("Test", 500);
  const c = { mx: 0, mz: 1, yaw: 0, trick: true, fwd: { x: 0, y: 0, z: -1 }, camPos: { ...pl.p } };
  let bail = false;
  for (let i = 0; i < 120 && !bail; i++) {
    pl.update(1 / 120, c); c.trick = false;
    st.events(pl.events, pl);
    if (pl.events.includes("bail")) bail = true;
    pl.events.length = 0;
  }
  check(bail, "landing mid-trick bails");
  check(!st.active && st.total === 0, "bail loses the combo");
}
// --- courses: every ring clear of buildings, sensible spacing
for (const c of COURSES) {
  const rs = buildCourse(c, w);
  let maxGap = 0;
  for (let i = 1; i < rs.length; i++) maxGap = Math.max(maxGap, Math.hypot(rs[i].x - rs[i - 1].x, rs[i].z - rs[i - 1].z));
  check(rs.length >= 10 && maxGap < 200, `${c.name}: ${rs.length} rings, max gap ${maxGap.toFixed(0)} m`);
}
if (fails) { console.log(fails + " failed"); process.exit(1); }
