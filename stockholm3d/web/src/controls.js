// Three camera modes: orbit (map-style), fly (free 6-DOF), walk (street level).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const EYE = 1.7;

export class CameraRig {
  constructor(camera, dom, heightAt) {
    this.camera = camera;
    this.dom = dom;
    this.heightAt = heightAt;
    this.mode = "orbit";
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.orbit = new OrbitControls(camera, dom);
    Object.assign(this.orbit, {
      enableDamping: true, dampingFactor: 0.12, screenSpacePanning: false, zoomToCursor: true,
      minDistance: 15, maxDistance: 16000, maxPolarAngle: Math.PI * 0.49, zoomSpeed: 1.2,
    });
    this.orbit.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.orbit.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.flight = null;  // active fly-to animation
    this.colliders = [];  // meshes walk mode can't pass through
    this.ray = new THREE.Raycaster();
    this.onModeChange = () => {};

    addEventListener("keydown", (e) => {
      if (e.target.closest?.("input, select, textarea")) return;
      this.keys.add(e.code);
      if (this.mode !== "orbit" && ["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "Space"].includes(e.code)) e.preventDefault();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => this.keys.clear());
    // drag-to-look in fly/walk (no pointer lock: it misbehaves on Firefox+X11)
    let drag = null;
    dom.addEventListener("pointerdown", (e) => {
      if (this.mode === "orbit") return;
      drag = { x: e.clientX, y: e.clientY };
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY };
      this.yaw -= dx * 0.0035;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0035, -1.5, 1.5);
    });
    dom.addEventListener("pointerup", () => { drag = null; });
    dom.addEventListener("wheel", (e) => {
      if (this.mode !== "fly") return;
      e.preventDefault();
      this.flySpeedMul = THREE.MathUtils.clamp((this.flySpeedMul || 1) * (e.deltaY > 0 ? 0.85 : 1.18), 0.1, 20);
    }, { passive: false });
  }

  setMode(mode) {
    if (mode === this.mode) return;
    const cam = this.camera;
    if (mode === "orbit") {
      // aim the orbit at the ground point ahead of us
      const dir = cam.getWorldDirection(new THREE.Vector3());
      let t = 400;
      if (dir.y < -0.05) t = Math.min(4000, (cam.position.y - this.heightAt(cam.position.x, cam.position.z)) / -dir.y);
      const target = cam.position.clone().addScaledVector(dir, t);
      target.y = this.heightAt(target.x, target.z);
      if (this.mode === "walk") cam.position.y += 60;
      this.orbit.target.copy(target);
      this.orbit.enabled = true;
      this.orbit.update();
    } else {
      this.orbit.enabled = false;
      const e = new THREE.Euler().setFromQuaternion(cam.quaternion, "YXZ");
      this.yaw = e.y;
      this.pitch = e.x;
      if (mode === "walk") {
        if (this.mode === "orbit") cam.position.set(this.orbit.target.x, 0, this.orbit.target.z);
        this.nearestLand(cam.position);
        cam.position.y = Math.max(this.heightAt(cam.position.x, cam.position.z), 0.8) + EYE;
        this.pitch = 0.05;
      }
    }
    this.mode = mode;
    this.onModeChange(mode);
  }

  /** Would stepping by `v` (horizontal) walk into a wall? Probes at knee and chest height. */
  blocked(v) {
    const len = v.length(), dir = v.clone().normalize();
    const near = this.colliders.filter((m) => m.visible);
    for (const h of [-1.1, -0.3]) {
      const o = this.camera.position.clone();
      o.y += h;
      this.ray.set(o, dir);
      this.ray.far = len + 0.6;
      if (this.ray.intersectObjects(near, false).length) return true;
    }
    return false;
  }

  /** Move `p` (in place) to the closest dry ground within ~400 m, spiralling out. */
  nearestLand(p) {
    if (this.heightAt(p.x, p.z) > 1.4) return;
    for (let r = 10; r <= 400; r += 10) {
      for (let a = 0; a < 16; a++) {
        const x = p.x + r * Math.cos(a * Math.PI / 8), z = p.z + r * Math.sin(a * Math.PI / 8);
        if (this.heightAt(x, z) > 1.4 && this.heightAt(x + 8, z) > 1.4 && this.heightAt(x, z + 8) > 1.4) {
          p.x = x; p.z = z;
          return;
        }
      }
    }
  }

  /** Smoothly move the camera to look at `target` from `pos` (orbit mode). */
  flyTo(pos, target, secs = 2.4) {
    if (this.mode !== "orbit") this.setMode("orbit");
    this.flight = { t: 0, secs, p0: this.camera.position.clone(), t0: this.orbit.target.clone(), p1: pos.clone(), t1: target.clone() };
  }

  distance() {
    return this.mode === "orbit" ? this.camera.position.distanceTo(this.orbit.target)
      : Math.max(200, (this.camera.position.y - this.heightAt(this.camera.position.x, this.camera.position.z)) * 3);
  }

  focus() {
    if (this.mode === "orbit") return this.orbit.target;
    const d = this.camera.getWorldDirection(new THREE.Vector3());
    return this.camera.position.clone().addScaledVector(d, this.mode === "walk" ? 60 : 300);
  }

  update(dt) {
    const cam = this.camera;
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.secs);
      const k = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      // arc up a little when travelling far
      const lift = Math.sin(Math.PI * k) * Math.min(1200, f.p0.distanceTo(f.p1) * 0.25);
      cam.position.lerpVectors(f.p0, f.p1, k).y += lift;
      this.orbit.target.lerpVectors(f.t0, f.t1, k);
      cam.lookAt(this.orbit.target);
      if (f.t >= 1) { this.flight = null; this.orbit.update(); }
      return;
    }
    if (this.mode === "orbit") {
      this.orbit.update();
      // keep the pivot on the ground and the camera above it
      const t = this.orbit.target;
      t.y += (this.heightAt(t.x, t.z) - t.y) * 0.2;
      const g = this.heightAt(cam.position.x, cam.position.z) + 3;
      if (cam.position.y < g) cam.position.y = g;
      return;
    }
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
    const k = this.keys;
    const fwd = new THREE.Vector3(), right = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    right.crossVectors(fwd, cam.up).normalize();
    const move = new THREE.Vector3();
    if (this.mode === "walk") { fwd.y = 0; fwd.normalize(); }
    if (k.has("KeyW") || k.has("ArrowUp")) move.add(fwd);
    if (k.has("KeyS") || k.has("ArrowDown")) move.sub(fwd);
    if (k.has("KeyD") || k.has("ArrowRight")) move.add(right);
    if (k.has("KeyA") || k.has("ArrowLeft")) move.sub(right);
    const ground = this.heightAt(cam.position.x, cam.position.z);
    if (this.mode === "fly") {
      if (k.has("KeyE") || k.has("Space")) move.y += 1;
      if (k.has("KeyQ") || k.has("KeyC")) move.y -= 1;
      const alt = Math.max(cam.position.y - ground, 5);
      const speed = THREE.MathUtils.clamp(alt * 1.2, 15, 900) * (this.flySpeedMul || 1) * (k.has("ShiftLeft") || k.has("ShiftRight") ? 4 : 1);
      if (move.lengthSq() > 0) cam.position.addScaledVector(move.normalize(), speed * dt);
      const g = this.heightAt(cam.position.x, cam.position.z) + 2;
      if (cam.position.y < g) cam.position.y = g;
    } else {
      const speed = k.has("ShiftLeft") || k.has("ShiftRight") ? 14 : 4.5;
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(speed * dt);
        // slide along walls: try the full step, then each axis on its own
        const tries = [move, new THREE.Vector3(move.x, 0, 0), new THREE.Vector3(0, 0, move.z)];
        const step = tries.find((v) => v.lengthSq() > 1e-8 && !this.blocked(v));
        if (step) cam.position.add(step);
      }
      cam.position.y = Math.max(this.heightAt(cam.position.x, cam.position.z), 0.8) + EYE;
    }
  }
}
