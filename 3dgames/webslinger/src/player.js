// Player movement + web-swinging physics. Pure JS (no three.js) so it can be run
// headless in Node for tests.
//
// The swing is a real pendulum: an inextensible rope removes the outward radial
// velocity every substep (240 Hz), so gravity alone turns a fall into a sweeping
// arc and momentum carries through. On top of the physics there are a few
// movie-style assists: at the moment the web catches, speed is redirected along
// the arc instead of being eaten by the rope; the rope quietly reels in on the
// downswing (like pumping a swing, which is how angular momentum speeds you up);
// there is a small push through the bottom of the arc; and the rope is always
// short enough that the lowest point of the arc clears the street.
import { G } from "./city.js";

export const P = {
  HX: 0.38, HY: 0.9, HZ: 0.38,
  GRAV: 22,
  DRAG: 0.0021,          // quadratic air drag (terminal ≈ 100 m/s)
  RUN: 10, SPRINT: 17, RUN_ACC: 70, AIR_ACC: 9,
  JUMP: 10.5, JUMP_MAX: 27, CHARGE: 0.75,
  ROPE_MIN: 12, ROPE_MAX: 95, CLEAR: 4.5,
  REEL: 16,              // m/s pulling in when the rope must shorten
  PUMP: 1.4,             // m/s reel-in on the downswing
  BOTTOM_BOOST: 7, W_PUMP: 5, STEER: 13,
  WALL_UP: 14, WALL_SIDE: 10,
  DASH: 3, DASH_REGEN: 1.3,
  STEP: 1 / 240,
};

const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const len = (a) => Math.hypot(a.x, a.y, a.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export class Player {
  constructor(world) {
    this.w = world;
    this.p = v3(); this.v = v3();
    this.state = "air";
    this.anchor = v3(); this.rope = 0; this.ropeTarget = 0; this.attachT = 0;
    this.hand = 1;               // +1 right hand, -1 left hand
    this.wallN = v3();
    this.zipT = v3(); this.zipMode = "";
    this.dash = P.DASH; this.dashRegen = 0;
    this.charge = 0; this.chargeHeld = false;
    this.releaseT = 9; this.groundT = 0; this.airT = 0; this.stateT = 0;
    this.flip = 0; this.roll = 0; this.landHard = 0;
    this.facing = 0;             // yaw of the body
    this.events = [];
    this.lastSwingSide = 1;
    this.out = { x: 0, y: 0, z: 0, stepped: false };
    this.acc = 0;
    this.stats = { maxSpeed: 0, swings: 0, dist: 0 };
    this.noAnchorT = 0;
    this.webT = 0;               // time since the web was fired (rope shoot-out anim)
    this.spawn();
  }

  spawn(x = 0, z = -700) {
    // on a street near the middle of the island, at a safe height
    const f = this.w.floorBelow(x, z, 900);
    this.p.x = x; this.p.z = z; this.p.y = f + P.HY + 0.05;
    this.v.x = this.v.y = this.v.z = 0;
    this.state = "ground";
    this.stateT = 0;
  }

  emit(e) { this.events.push(e); }

  set(s) { if (this.state !== s) { this.state = s; this.stateT = 0; } }

  /** advance by dt (render frame), with fixed physics substeps */
  update(dt, c) {
    this.acc += Math.min(dt, 0.1);
    this.ctl = c;
    // edge-triggered inputs are consumed by the first substep
    let first = true;
    while (this.acc >= P.STEP) {
      this.step(P.STEP, c, first);
      first = false;
      this.acc -= P.STEP;
    }
    const sp = len(this.v);
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, sp);
  }

  moveDir(c) {
    // camera-relative input on the ground plane
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
    return v3(fx * c.mz + rx * c.mx, 0, fz * c.mz + rz * c.mx);
  }

  step(dt, c, first) {
    this.stateT += dt; this.releaseT += dt; this.webT += dt;
    this.flip = Math.max(0, this.flip - dt); this.roll = Math.max(0, this.roll - dt);
    this.landHard = Math.max(0, this.landHard - dt * 2);
    this.noAnchorT = Math.max(0, this.noAnchorT - dt);
    const onRope = this.state === "swing";
    if (this.state === "ground" || onRope) {
      this.dashRegen += dt;
      if (this.dashRegen > P.DASH_REGEN && this.dash < P.DASH) { this.dash++; this.dashRegen = 0; }
    }

    // --- actions (edge-triggered) ---
    if (first) {
      if (c.zip && this.state !== "zip") this.tryZip(c);
      if (c.dash && this.state !== "ground" && this.state !== "zip" && this.dash > 0) this.airDash(c);
      if (c.swingP && this.state !== "swing" && this.state !== "zip") this.tryAttach(c, true);
      if (c.respawn) { this.respawn(); return; }
    }
    // hold swing to keep chaining: re-fire on the way down
    if (c.swing && (this.state === "air") && this.releaseT > 0.28 && this.v.y < 3 && this.airT > 0.12 && this.noAnchorT <= 0)
      this.tryAttach(c, false);

    switch (this.state) {
      case "ground": this.ground(dt, c, first); break;
      case "air": this.air(dt, c, first); break;
      case "swing": this.swing(dt, c, first); break;
      case "wall": this.wall(dt, c, first); break;
      case "zip": this.zipStep(dt, c); break;
    }

    // water: out of the island and below the seawall
    if (this.p.y < G.WATER_Y + 0.3 && !this.w.onIsland(this.p.x, this.p.z)) {
      this.emit("splash");
      this.respawn();
    }
    if (this.p.y < -50) this.respawn();
  }

  respawn() {
    const I = G.ISLAND;
    const x = clamp(this.p.x, I.x0 + 60, I.x1 - 60), z = clamp(this.p.z, I.z0 + 60, I.z1 - 60);
    // drop onto the nearest avenue so we don't land inside a block
    const px = G.X0 + Math.round((x - G.X0) / G.PX) * G.PX;
    this.spawn(clamp(px, I.x0 + 40, I.x1 - 40), z);
    this.emit("respawn");
  }

  // ---------------------------------------------------------------- ground
  ground(dt, c, first) {
    const d = this.moveDir(c);
    const want = Math.hypot(d.x, d.z);
    this.groundT += dt; this.airT = 0;
    // sprint builds up while you keep moving
    this.runT = want > 0.3 ? (this.runT || 0) + dt : 0;
    const top = P.RUN + (P.SPRINT - P.RUN) * clamp((this.runT - 0.3) / 0.8, 0, 1);
    const hs = Math.hypot(this.v.x, this.v.z);
    // keep momentum from a landing: allowed speed decays to the run speed
    const cap = Math.max(top * want, hs - 16 * dt);
    const tx = d.x * cap / (want || 1), tz = d.z * cap / (want || 1);
    const a = (want > 0.1 ? P.RUN_ACC : 45) * dt;
    const ex = (want > 0.1 ? tx : 0) - this.v.x, ez = (want > 0.1 ? tz : 0) - this.v.z;
    const el = Math.hypot(ex, ez);
    if (el > 0) { const k = Math.min(1, a / el); this.v.x += ex * k; this.v.z += ez * k; }
    this.v.y = -2;
    if (want > 0.1) this.turnTo(Math.atan2(-d.x, -d.z), dt, 12);

    // jump (hold to charge a super jump; release to go)
    if (c.jump) { this.charge = Math.min(P.CHARGE, this.charge + dt); this.chargeHeld = true; }
    if ((this.chargeHeld && !c.jump) || this.charge >= P.CHARGE) {
      const k = clamp((this.charge - 0.12) / (P.CHARGE - 0.12), 0, 1);
      this.v.y = P.JUMP + (P.JUMP_MAX - P.JUMP) * k * k;
      this.charge = 0; this.chargeHeld = false;
      this.emit(k > 0.5 ? "superjump" : "jump");
      this.set("air"); this.airT = 0;
      this.p.y += 0.05;
      return;
    }
    const r = this.integrate(dt, true);
    if (r.y !== -1) {
      // walked off an edge?
      const f = this.w.floorBelow(this.p.x, this.p.z, this.p.y - P.HY + 0.01);
      if (this.p.y - P.HY - f > 0.7) { this.set("air"); this.airT = 0; }
    }
    this.wallCheck(r, c);
  }

  // ------------------------------------------------------------------- air
  air(dt, c) {
    this.airT += dt; this.groundT = 0;
    const d = this.moveDir(c);
    this.v.x += d.x * P.AIR_ACC * dt;
    this.v.z += d.z * P.AIR_ACC * dt;
    const dive = c.dive && this.v.y < 5;
    this.gravity(dt, dive ? 1.7 : 1, dive ? 0.45 : 1);
    const hs = Math.hypot(this.v.x, this.v.z);
    if (hs > 2) this.turnTo(Math.atan2(-this.v.x, -this.v.z), dt, 5);
    const vy = this.v.y;
    const r = this.integrate(dt, false);
    if (r.y === -1) this.land(vy);
    else this.wallCheck(r, c);
  }

  land(vy) {
    if (vy < -24) { this.roll = 0.55; this.landHard = 1; this.emit("landHard"); }
    else this.emit(vy < -8 ? "land" : "step");
    this.v.y = 0;
    this.charge = 0; this.chargeHeld = false;
    this.set("ground"); this.groundT = 0;
    this.dash = Math.min(P.DASH, this.dash + 1);
  }

  gravity(dt, gk = 1, dk = 1) {
    this.v.y -= P.GRAV * gk * dt;
    const s = len(this.v);
    if (s > 0) {
      const k = Math.max(0, 1 - P.DRAG * dk * s * dt);
      this.v.x *= k; this.v.y *= k; this.v.z *= k;
    }
  }

  integrate(dt, canStep) {
    const p0x = this.p.x, p0z = this.p.z;
    const r = this.w.move(this.p, P.HX, P.HY, P.HZ, this.v.x * dt, this.v.y * dt, this.v.z * dt, this.out, canStep);
    if (r.x) this.v.x = r.x * this.v.x < 0 ? this.v.x : 0;
    if (r.z) this.v.z = r.z * this.v.z < 0 ? this.v.z : 0;
    if (r.y === 1 && this.v.y > 0) this.v.y = 0;
    if (r.y === -1 && this.v.y < 0 && this.state !== "ground") { /* landing handled by caller */ }
    this.stats.dist += Math.hypot(this.p.x - p0x, this.p.z - p0z);
    return r;
  }

  turnTo(yaw, dt, rate) {
    let d = yaw - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * Math.min(1, rate * dt);
  }

  // ------------------------------------------------------------- wall run
  /** hit a wall while moving into it → start running up / along it */
  wallCheck(r, c, speedIn) {
    if (!r.x && !r.z) return false;
    const nx = r.x ? -r.x : 0, nz = r.z ? -r.z : 0;
    const d = this.moveDir(c);
    const into = -(d.x * nx + d.z * nz);
    const hsIn = speedIn ?? 0;
    if (into < 0.4 && hsIn < 8) return false;
    // needs to be a real wall (not a kerb): something solid at head height too
    const h = this.w.raycast(this.p.x, this.p.y + 1.2, this.p.z, -nx, 0, -nz, P.HX + 0.6);
    if (!h) return false;
    this.wallN.x = nx; this.wallN.y = 0; this.wallN.z = nz;
    // carry momentum up the wall
    const hs = Math.max(hsIn, Math.hypot(this.v.x, this.v.z));
    this.v.y = Math.max(this.v.y, Math.min(34, P.WALL_UP + hs * 0.55));
    // keep the along-wall component
    const vn = this.v.x * nx + this.v.z * nz;
    this.v.x -= vn * nx; this.v.z -= vn * nz;
    this.set("wall");
    this.emit("wall");
    return true;
  }

  wall(dt, c, first) {
    this.airT = 0;
    const n = this.wallN;
    // tangent axes: up and along (right-handed around the normal)
    const ax = -n.z, az = n.x;           // "right" along the wall when facing it
    const d = this.moveDir(c);
    const into = -(d.x * n.x + d.z * n.z);              // pushing towards the wall = climb
    const side = d.x * ax + d.z * az;
    const hsAlong = this.v.x * ax + this.v.z * az;
    // vertical: climbing input holds speed, otherwise gravity slowly takes over
    if (into > 0.2 || c.mz > 0.2) this.v.y += (Math.max(P.WALL_UP, this.v.y) - this.v.y) * Math.min(1, 6 * dt) + 0 * dt;
    else this.v.y -= P.GRAV * 0.55 * dt;
    this.v.y -= this.v.y > P.WALL_UP ? 9 * dt : 0;
    const targetAlong = side * P.WALL_SIDE + (Math.abs(side) < 0.1 ? hsAlong * 0.98 : 0);
    const na = hsAlong + (targetAlong - hsAlong) * Math.min(1, 5 * dt);
    this.v.x = ax * na - n.x * 1.0; this.v.z = az * na - n.z * 1.0;   // slight pull into the wall
    this.turnTo(Math.atan2(n.x, n.z), dt, 14);
    if (first && c.jumpP) {
      // kick off the wall, away and up, keeping along-wall speed
      this.v.x = n.x * 13 + ax * na; this.v.z = n.z * 13 + az * na; this.v.y = Math.max(this.v.y, 0) * 0.5 + 11;
      this.flip = 0.6;
      this.emit("jump");
      this.set("air"); this.releaseT = 0;
      return;
    }
    const r = this.integrate(dt, false);
    if (r.y === -1) { this.land(this.v.y); return; }
    if (r.y === 1) {
      // bumped an overhang (cornice / setback underside): peel off the wall
      this.v.x += n.x * 5; this.v.z += n.z * 5; this.v.y = Math.min(this.v.y, 0);
      this.set("air"); this.releaseT = 0;
      return;
    }
    // still a wall in front of the chest?
    const h = this.w.raycast(this.p.x, this.p.y + 0.3, this.p.z, -n.x, 0, -n.z, P.HX + 0.7);
    if (!h) {
      const feet = this.w.raycast(this.p.x, this.p.y - P.HY + 0.1, this.p.z, -n.x, 0, -n.z, P.HX + 0.7);
      if (this.v.y > 0 && feet) {
        // top edge: vault over onto the roof with a little hop forward
        this.v.y = 9.5;
        this.v.x = -n.x * 8 + ax * na * 0.6; this.v.z = -n.z * 8 + az * na * 0.6;
        this.flip = 0.5;
        this.emit("vault");
      }
      this.set("air"); this.releaseT = 0;
      return;
    }
    if (this.v.y < -14 || this.stateT > 12) { this.v.x += n.x * 4; this.v.z += n.z * 4; this.set("air"); }
  }

  // ---------------------------------------------------------------- swing
  /**
   * Find a web anchor: a building surface ahead and above, to the left/right,
   * biased by where you're moving, where the camera looks, and the stick.
   */
  findAnchor(c) {
    const w = this.w;
    const hs = Math.hypot(this.v.x, this.v.z);
    // heading: blend velocity with camera direction (camera steers the swing)
    const cfx = -Math.sin(c.yaw), cfz = -Math.cos(c.yaw);
    let hx = cfx, hz = cfz;
    if (hs > 4) {
      const k = clamp((hs - 4) / 20, 0, 0.55);
      hx = cfx * (1 - k) + (this.v.x / hs) * k; hz = cfz * (1 - k) + (this.v.z / hs) * k;
    }
    const d = this.moveDir(c);
    hx += d.x * 0.5; hz += d.z * 0.5;
    const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    const rx = -hz, rz = hx;      // right of heading
    const ox = this.p.x, oy = this.p.y + 0.6, oz = this.p.z;
    const steer = c.mx;
    let best = null, bestS = -1e9;
    const speed = len(this.v);
    // ideal horizontal reach grows with speed so fast swings get long ropes
    const idealLen = clamp(28 + speed * 0.7, 30, 80);
    for (const el of [42, 52, 62, 72, 82]) {
      const ce = Math.cos(el * Math.PI / 180), se = Math.sin(el * Math.PI / 180);
      for (const yawOff of [-75, -55, -38, -22, -8, 8, 22, 38, 55, 75]) {
        const a = yawOff * Math.PI / 180;
        const dx = (hx * Math.cos(a) + rx * Math.sin(a)) * ce, dz = (hz * Math.cos(a) + rz * Math.sin(a)) * ce, dy = se;
        const h = w.raycast(ox, oy, oz, dx, dy, dz, 130);
        if (!h || h.box < 0) continue;
        if (h.y < this.p.y + 7) continue;
        const L = h.t;
        if (L < P.ROPE_MIN) continue;
        // how low would the arc go? (lowest point ≈ anchor.y - L)
        const floor = w.floorBelow(h.x, h.z, h.y - 1);
        const clear = h.y - L - (floor === -Infinity ? G.WATER_Y : floor);
        let s = 0;
        s -= Math.abs(L - idealLen) * 0.05;
        s -= Math.abs(el - 60) * 0.03;
        s -= Math.abs(yawOff) * 0.012;                 // prefer ahead
        s += Math.sign(yawOff) * steer * 0.8;          // stick picks the side
        s += Math.sign(yawOff) === -this.lastSwingSide ? 0.35 : 0;   // alternate hands
        s += clear < P.CLEAR + P.HY ? -0.6 : 0;
        s += h.ny === 0 ? 0.3 : -0.2;                  // walls feel right, roofs OK
        if (s > bestS) { bestS = s; best = { x: h.x, y: h.y, z: h.z, L, side: Math.sign(yawOff) || 1, nx: h.nx, ny: h.ny, nz: h.nz }; }
      }
    }
    return best;
  }

  tryAttach(c, manual) {
    const a = this.findAnchor(c);
    if (!a) {
      if (manual) { this.emit("noanchor"); }
      this.noAnchorT = 0.25;
      return false;
    }
    // pull the anchor a hair out of the surface so the rope end is visible
    this.anchor.x = a.x + a.nx * 0.05; this.anchor.y = a.y + a.ny * 0.05; this.anchor.z = a.z + a.nz * 0.05;
    const dx = this.p.x - this.anchor.x, dy = this.p.y - this.anchor.y, dz = this.p.z - this.anchor.z;
    const dist = Math.hypot(dx, dy, dz);
    const nx = dx / dist, ny = dy / dist, nz = dz / dist;
    // the catch: redirect momentum along the arc instead of losing the radial part
    const sp = len(this.v);
    const vr = dot(this.v, { x: nx, y: ny, z: nz });
    if (vr > 0) {
      this.v.x -= vr * nx; this.v.y -= vr * ny; this.v.z -= vr * nz;
      const st = len(this.v);
      const keep = Math.max(sp * 0.82, st);
      if (st > 0.5) { const k = keep / st; this.v.x *= k; this.v.y *= k; this.v.z *= k; }
      else {
        // falling straight down: kick forward along the arc
        const cfx = -Math.sin(c.yaw), cfz = -Math.cos(c.yaw);
        this.v.x = cfx * keep; this.v.z = cfz * keep;
      }
    }
    this.rope = dist;
    this.ropeTarget = dist;
    this.hand = a.side;
    this.lastSwingSide = a.side;
    this.attachT = 0; this.webT = 0;
    this.set("swing");
    this.stats.swings++;
    this.emit("thwip");
    return true;
  }

  swing(dt, c, first) {
    this.attachT += dt; this.airT = 0;
    const A = this.anchor;
    // release
    if (!c.swing || (first && c.jumpP)) { this.release(first && c.jumpP); return; }

    let dx = this.p.x - A.x, dy = this.p.y - A.y, dz = this.p.z - A.z;
    let dist = Math.hypot(dx, dy, dz);
    let nx = dx / dist, ny = dy / dist, nz = dz / dist;
    const sp = len(this.v);
    const below = -ny;            // 1 straight below anchor, 0 at horizontal
    // --- rope length target: keep the arc above the street
    const floor = this.w.floorBelow(A.x, A.z, A.y - 1);
    const ground = floor === -Infinity ? G.WATER_Y : floor;
    const maxL = Math.max(P.ROPE_MIN * 0.7, A.y - ground - P.CLEAR - P.HY);
    if (this.ropeTarget > maxL) this.ropeTarget = maxL;
    // pumping: reel in a little on the downswing, like leaning into a swing
    if (this.v.y < 0 && below > 0.3) this.ropeTarget = Math.max(P.ROPE_MIN, this.ropeTarget - P.PUMP * dt);
    if (this.rope > this.ropeTarget) this.rope = Math.max(this.ropeTarget, this.rope - P.REEL * dt);
    else this.rope = this.ropeTarget;

    // --- forces
    this.gravity(dt, 1, 0.8);
    // tangent direction of travel
    const vr = dot(this.v, { x: nx, y: ny, z: nz });
    let tx = this.v.x - vr * nx, ty = this.v.y - vr * ny, tz = this.v.z - vr * nz;
    const tl = Math.hypot(tx, ty, tz);
    if (tl > 0.5) {
      tx /= tl; ty /= tl; tz /= tl;
      // push through the bottom of the arc (+ W to pump harder)
      const bottom = Math.max(0, below - 0.55) / 0.45;
      const push = (P.BOTTOM_BOOST + P.W_PUMP * Math.max(0, c.mz)) * bottom * (sp < 55 ? 1 : 0.2);
      this.v.x += tx * push * dt; this.v.y += ty * push * dt; this.v.z += tz * push * dt;
      // A/D: steer sideways (perpendicular to both the rope and the travel direction)
      const sx = ny * tz - nz * ty, sy = nz * tx - nx * tz, sz = nx * ty - ny * tx;
      // camera-relative sign: right on screen is +mx
      const rxc = Math.cos(c.yaw), rzc = -Math.sin(c.yaw);
      const sgn = (sx * rxc + sz * rzc) >= 0 ? 1 : -1;
      const st = P.STEER * c.mx * sgn;
      this.v.x += sx * st * dt; this.v.y += sy * st * dt; this.v.z += sz * st * dt;
      // camera nudges the swing plane too, gently
      const cfx = -Math.sin(c.yaw), cfz = -Math.cos(c.yaw);
      const hs = Math.hypot(this.v.x, this.v.z);
      if (hs > 5) {
        // rotate horizontal velocity towards the camera heading a little
        const cross = (this.v.x * cfz - this.v.z * cfx) / hs;
        const ang = clamp(-cross, -1, 1) * 0.55 * dt;
        const cs = Math.cos(ang), sn = Math.sin(ang);
        const vx = this.v.x, vz = this.v.z;
        this.v.x = vx * cs - vz * sn; this.v.z = vx * sn + vz * cs;
      }
    }
    const hs = Math.hypot(this.v.x, this.v.z);
    if (hs > 2) this.turnTo(Math.atan2(-this.v.x, -this.v.z), dt, 8);

    // --- integrate, then enforce the rope
    const vy0 = this.v.y;
    const vIn = Math.hypot(this.v.x, this.v.z);
    const r = this.integrate(dt, false);
    dx = this.p.x - A.x; dy = this.p.y - A.y; dz = this.p.z - A.z;
    dist = Math.hypot(dx, dy, dz);
    if (dist > this.rope) {
      nx = dx / dist; ny = dy / dist; nz = dz / dist;
      // position: back onto the sphere (collision-aware)
      const corr = dist - this.rope;
      this.w.move(this.p, P.HX, P.HY, P.HZ, -nx * corr, -ny * corr, -nz * corr, this.out, false);
      // velocity: drop the outward radial part (inextensible rope)
      const vr2 = dot(this.v, { x: nx, y: ny, z: nz });
      if (vr2 > 0) { this.v.x -= vr2 * nx; this.v.y -= vr2 * ny; this.v.z -= vr2 * nz; }
    }
    if (r.y === -1) { this.land(vy0); return; }
    if ((r.x || r.z) && this.wallCheck(r, c, vIn)) return;
    // swung up past the anchor: let go automatically at the top of the arc
    if (this.p.y > A.y - this.rope * 0.12 && this.v.y > 0 && this.attachT > 0.3) { this.release(false, true); return; }
    if (this.attachT > 8) this.release(false);
  }

  release(jumped, auto) {
    // release boost: a flick forward and up, strongest at the front of the arc
    const s = Math.hypot(this.v.x, this.v.z);
    if (s > 3) {
      const up = this.v.y > -4 ? (jumped ? 9 : 5.5) : (jumped ? 6 : 2);
      const fw = jumped ? 4 : 2.5;
      this.v.x += (this.v.x / s) * fw; this.v.z += (this.v.z / s) * fw;
      this.v.y = Math.max(this.v.y, 0) + up;
      if (this.v.y > 6) this.flip = auto ? 0 : 0.75;
    } else if (jumped) this.v.y += 8;
    this.set("air");
    this.releaseT = 0; this.airT = 0;
    this.emit(jumped ? "releaseJump" : "release");
  }

  // ---------------------------------------------------- web-zip & dashes
  airDash(c) {
    this.dash--; this.dashRegen = 0;
    const cf = c.fwd;   // camera look direction (unit)
    let dx = cf.x, dy = Math.max(-0.2, cf.y) + 0.15, dz = cf.z;
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    const sp = Math.max(30, len(this.v) * 0.9 + 8);
    this.v.x = dx * sp; this.v.y = dy * sp; this.v.z = dz * sp;
    this.zipT.x = this.p.x + dx * 40; this.zipT.y = this.p.y + dy * 40 + 6; this.zipT.z = this.p.z + dz * 40;
    this.webT = 0;
    this.set("air"); this.releaseT = 0.1;
    this.emit("dash");
  }

  /** point launch: zip to the ledge the camera is aiming at, then fling up over it */
  tryZip(c) {
    const cf = c.fwd;
    const ox = c.camPos.x, oy = c.camPos.y, oz = c.camPos.z;
    const h = this.w.raycast(ox, oy, oz, cf.x, cf.y, cf.z, 220);
    if (!h || h.box < 0) { this.emit("noanchor"); return; }
    const b = this.w.boxes[h.box];
    const toTop = b.y1 - h.y;
    if (h.ny === 1) {
      this.zipMode = "land";
      this.zipT.x = h.x; this.zipT.y = h.y + P.HY + 0.1; this.zipT.z = h.z;
    } else if (toTop < 60) {
      this.zipMode = "launch";
      // just over the lip, a little inward
      this.zipT.x = h.x - h.nx * 0.3; this.zipT.y = b.y1 + 0.2; this.zipT.z = h.z - h.nz * 0.3;
      this.zipN = { x: h.nx, z: h.nz };
    } else {
      this.zipMode = "wall";
      this.zipT.x = h.x + h.nx * (P.HX + 0.2); this.zipT.y = h.y; this.zipT.z = h.z + h.nz * (P.HX + 0.2);
      this.zipN = { x: h.nx, z: h.nz };
    }
    const d = Math.hypot(this.zipT.x - this.p.x, this.zipT.y - this.p.y, this.zipT.z - this.p.z);
    if (d < 3) return;
    this.zipSpeed = Math.max(18, len(this.v) * 0.6);
    this.webT = 0;
    this.set("zip");
    this.emit("zip");
  }

  zipStep(dt, c) {
    const T = this.zipT;
    const dx = T.x - this.p.x, dy = T.y - this.p.y, dz = T.z - this.p.z;
    const d = Math.hypot(dx, dy, dz);
    this.zipSpeed = Math.min(62, this.zipSpeed + 95 * dt);
    const s = Math.min(this.zipSpeed, d / dt);
    // steer velocity smoothly toward the target
    const k = Math.min(1, 14 * dt);
    this.v.x += (dx / d * s - this.v.x) * k; this.v.y += (dy / d * s - this.v.y) * k; this.v.z += (dz / d * s - this.v.z) * k;
    this.turnTo(Math.atan2(-dx, -dz), dt, 10);
    const r = this.integrate(dt, false);
    const arrived = d < 1.6 || this.stateT > 6;
    if (this.zipMode === "launch" && (arrived || (r.x || r.z) && this.p.y > T.y - 3)) {
      // the point-launch: fling up and over the edge
      this.v.x = -this.zipN.x * 10 + this.v.x * 0.15; this.v.z = -this.zipN.z * 10 + this.v.z * 0.15;
      this.v.y = 21;
      this.p.y = Math.max(this.p.y, T.y + P.HY + 0.05);
      this.flip = 0.8;
      this.set("air"); this.releaseT = 0;
      this.emit("launch");
      return;
    }
    if (r.y === -1) { this.land(-10); return; }
    if (arrived || r.x || r.z) {
      if (this.zipMode === "wall" || r.x || r.z) {
        this.wallN.x = this.zipN ? this.zipN.x : -(r.x || 0); this.wallN.y = 0; this.wallN.z = this.zipN ? this.zipN.z : -(r.z || 0);
        this.v.x = this.v.z = 0; this.v.y = 6;
        this.set("wall");
        this.emit("wall");
      } else {
        this.set("air"); this.releaseT = 0;
      }
    }
  }
}
