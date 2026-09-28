// Chase camera: mouse/stick orbit around the player with a critically-damped
// follow, speed-driven FOV kick and pull-back, a gentle auto-align behind the
// direction of travel while swinging, collision pull-in, and screen shake.
// It also feels the physics: the camera sinks a little under the g-load at the
// bottom of a swing and floats at the top, and wind buffets it at high speed.
import * as THREE from "three";

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export class ChaseCam {
  constructor(camera, world) {
    this.cam = camera;
    this.w = world;
    this.yaw = 0; this.pitch = -0.12;
    this.dist = 6.5;
    this.target = new THREE.Vector3();
    this.fov = 70; this.baseFov = 70;
    this.shake = 0;
    this.idle = 0;
    this.fwd = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.roll = 0;
    this.lastLook = 0;
    this.lastHead = null;
    this.turnRate = 0;
    this.pvy = 0; this.gAcc = 0; this.gOff = 0;
  }

  update(dt, pl, c, opts) {
    const cam = this.cam;
    this.yaw -= c.lookX;
    this.pitch = THREE.MathUtils.clamp(this.pitch - c.lookY, -1.35, 1.2);
    const looked = Math.abs(c.lookX) + Math.abs(c.lookY) > 0.0005;
    this.lastLook = looked ? 0 : this.lastLook + dt;
    const v = pl.v;
    const hs = Math.hypot(v.x, v.z);
    const speed = Math.hypot(v.x, v.y, v.z);
    // auto-align behind travel when moving fast and the player isn't steering the view
    if (opts.autoCam && hs > 9 && this.lastLook > 0.6 && pl.state !== "ground") {
      const want = Math.atan2(-v.x, -v.z);
      let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-1.1 * dt)) * Math.min(1, (hs - 9) / 10);
      // look slightly down on dives, level on swings
      const wantP = THREE.MathUtils.clamp(-0.1 + v.y * 0.006, -0.55, 0.15);
      this.pitch = damp(this.pitch, wantP, 0.5, dt);
    }
    // follow target: slightly above the player; lag in y softens landings
    const ty = pl.rp.y + 0.9;
    this.target.x = damp(this.target.x, pl.rp.x, 30, dt);
    this.target.z = damp(this.target.z, pl.rp.z, 30, dt);
    this.target.y = Math.abs(this.target.y - ty) > 8 ? ty : damp(this.target.y, ty, pl.state === "ground" ? 14 : 22, dt);
    // pull back with speed
    const want = 6.2 + Math.min(1, speed / 45) * 4.5 + (pl.state === "wall" ? 1.5 : 0);
    this.dist = damp(this.dist, want, 2.2, dt);
    const fovW = this.baseFov + Math.min(1, Math.max(0, speed - 12) / 40) * 22;
    this.fov = damp(this.fov, fovW, 3, dt);

    // g-load: vertical acceleration beyond free fall (rope pull at the bottom of
    // a swing, a jump-off kick); the operator "sinks" under it, floats at the top
    const inAir = pl.state === "swing" || pl.state === "air";
    if (dt > 0) {
      const exc = inAir ? (v.y - this.pvy) / dt + 22 : 0;
      this.gAcc = damp(this.gAcc, THREE.MathUtils.clamp(exc, -40, 80), 7, dt);
    }
    this.pvy = v.y;
    this.gOff = damp(this.gOff, -THREE.MathUtils.clamp(this.gAcc * 0.011, -0.22, 0.55), 5, dt);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.fwd.set(-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp);
    // right-shoulder offset
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const shoulder = 0.9;
    const ox = this.target.x + rx * shoulder, oz = this.target.z + rz * shoulder, oy = this.target.y + 0.35 + this.gOff;
    // collision: cast from the pivot back toward the camera
    let d = this.dist;
    const bx = -this.fwd.x, by = -this.fwd.y, bz = -this.fwd.z;
    const h = this.w.raycast(ox, oy, oz, bx, by, bz, d + 0.4);
    if (h) d = Math.max(0.6, h.t - 0.4);
    this.curDist = d;
    cam.position.set(ox + bx * d, oy + by * d, oz + bz * d);
    if (cam.position.y < 0.4 && this.w.onIsland(cam.position.x, cam.position.z)) cam.position.y = 0.4;
    // shake
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const s = this.shake * this.shake * 0.35;
    const t = performance.now() / 1000;
    cam.position.x += Math.sin(t * 47) * s; cam.position.y += Math.sin(t * 59 + 1) * s; cam.position.z += Math.sin(t * 53 + 2) * s;
    // wind buffeting at speed (irregular: three incommensurate wobbles) and a
    // barely-there handheld drift the rest of the time
    const buf = Math.max(0, Math.min(1, (speed - 28) / 35)) ** 2 * 0.045 * (opts.motion ?? 1);
    const hh = 0.012;
    cam.position.x += (Math.sin(t * 13.1) + Math.sin(t * 21.7 + 2)) * buf + Math.sin(t * 0.37) * hh;
    cam.position.y += (Math.sin(t * 17.3 + 1) + Math.sin(t * 27.1)) * buf + Math.sin(t * 0.29 + 1) * hh;
    this.tmp.copy(cam.position).add(this.fwd);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.tmp);
    // bank into turns: smoothed yaw rate of the travel direction (like a camera
    // operator leaning into the curve), plus a little from the stick on the rope
    if (hs > 6) {
      const head = Math.atan2(-v.x, -v.z);
      if (this.lastHead !== null && dt > 0) {
        let dh = head - this.lastHead; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        this.turnRate = damp(this.turnRate, dh / dt, 4, dt);
      }
      this.lastHead = head;
    } else { this.lastHead = null; this.turnRate = damp(this.turnRate, 0, 4, dt); }
    const air = pl.state === "swing" || pl.state === "air";
    const bank = air ? THREE.MathUtils.clamp(this.turnRate * Math.min(1, hs / 30) * 0.06, -0.1, 0.1) : 0;
    const rollW = bank + (pl.state === "swing" ? -c.mx * 0.04 : 0);
    this.roll = damp(this.roll, rollW, 3, dt);
    cam.rotateZ(this.roll);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    return speed;
  }
}
