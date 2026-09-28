// Keyboard + mouse (pointer lock) + gamepad, folded into one per-frame state.
export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.pressed = new Set();     // edge-triggered this frame
    this.mouse = { dx: 0, dy: 0, l: false, r: false, m: false, lp: false, rp: false };
    this.sens = 1;
    this.invertY = false;
    this.locked = false;
    this.pad = null;
    this.padPrev = [];
    addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code);
      if (["Space", "Tab", "ControlLeft"].includes(e.code)) e.preventDefault();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => { this.keys.clear(); this.mouse.l = this.mouse.r = this.mouse.m = false; });
    el.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.l = true; this.mouse.lp = true; }
      if (e.button === 2) { this.mouse.r = true; this.mouse.rp = true; }
      if (e.button === 1) { this.mouse.m = true; e.preventDefault(); }
    });
    addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouse.l = false;
      if (e.button === 2) this.mouse.r = false;
      if (e.button === 1) this.mouse.m = false;
    });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      // ignore the occasional huge spurious delta some browsers emit on lock
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked) { this.mouse.l = this.mouse.r = this.mouse.m = false; this.keys.clear(); }
    });
  }

  lock() {
    const p = this.el.requestPointerLock?.({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => this.el.requestPointerLock());
  }

  /** sample once per rendered frame; returns a normalised control state */
  poll() {
    const k = this.keys, P = this.pressed;
    const s = {
      mx: 0, mz: 0,
      lookX: this.mouse.dx * 0.0022 * this.sens,
      lookY: this.mouse.dy * 0.0022 * this.sens * (this.invertY ? -1 : 1),
      swing: this.mouse.l || k.has("ShiftLeft") || k.has("ShiftRight"),
      swingP: this.mouse.lp,
      zip: this.mouse.rp || P.has("KeyE"),
      jump: k.has("Space"), jumpP: P.has("Space"),
      dash: P.has("KeyQ"),
      dive: k.has("ControlLeft") || k.has("KeyC"),
      sprint: true,
      pad: false,
      menu: P.has("Escape"), time: P.has("KeyT"), comic: P.has("KeyV"), photo: P.has("KeyP"),
      respawn: P.has("KeyR"), help: P.has("KeyH"),
      trick: P.has("KeyF"), focus: k.has("Tab") || this.mouse.m,
      race: P.has("KeyG"), map: P.has("KeyM"),
    };
    if (k.has("KeyW") || k.has("ArrowUp")) s.mz += 1;
    if (k.has("KeyS") || k.has("ArrowDown")) s.mz -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) s.mx += 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) s.mx -= 1;
    this.mouse.dx = this.mouse.dy = 0;
    this.mouse.lp = this.mouse.rp = false;
    P.clear();

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const b = (i) => !!gp.buttons[i]?.pressed;
      const e = (i) => b(i) && !this.padPrev[i];
      const lx = dz(gp.axes[0]), ly = dz(gp.axes[1]), rx = dz(gp.axes[2]), ry = dz(gp.axes[3]);
      if (lx || ly || rx || ry || gp.buttons.some((x) => x.pressed)) s.pad = true;
      s.mx += lx; s.mz -= ly;
      s.lookX += rx * Math.abs(rx) * 0.05 * this.sens;
      s.lookY += ry * Math.abs(ry) * 0.035 * this.sens * (this.invertY ? -1 : 1);
      // RT swing, A jump, LT zip, B dive, X dash, Y trick, RB focus (slow-mo),
      // LB time of day, Back race, Start menu
      s.swing ||= (gp.buttons[7]?.value || 0) > 0.3;
      s.swingP ||= (gp.buttons[7]?.value || 0) > 0.3 && !this.padPrev[7];
      s.jump ||= b(0); s.jumpP ||= e(0);
      s.zip ||= e(6);
      s.dive ||= b(1);
      s.dash ||= e(2);
      s.trick ||= e(3);
      s.focus ||= b(5);
      s.time ||= e(4);
      s.race ||= e(8);
      s.menu ||= e(9);
      this.padPrev = gp.buttons.map((x, i) => (i === 7 ? x.value > 0.3 : x.pressed));
    }
    const len = Math.hypot(s.mx, s.mz);
    if (len > 1) { s.mx /= len; s.mz /= len; }
    return s;
  }
}
