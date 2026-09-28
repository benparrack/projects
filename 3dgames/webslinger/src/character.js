// Procedural web-slinger: a jointed capsule mannequin in a red/blue suit with
// raised web lines, big white lenses and a chest emblem, animated by blending
// hand-authored poses and procedural cycles (run, swing, fall, dive, flips).
import * as THREE from "three";
import { fogPatch } from "./materials.js";

const RED = [0.42, 0.018, 0.022], BLUE = [0.018, 0.04, 0.2], DARK = [0.012, 0.012, 0.016];

function suitMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.0 });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLoc;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLoc = position;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLoc;")
      .replace("#include <color_fragment>", `#include <color_fragment>
{
  // raised web lines on the red panels: meridians + rings around each limb
  float red = step(diffuseColor.b * 1.5, diffuseColor.r);
  float ang = atan(vLoc.z, vLoc.x) * 2.2;
  float ring = vLoc.y * 17.0;
  float wa = abs(fract(ang) - 0.5), wr = abs(fract(ring) - 0.5);
  float line = 1.0 - smoothstep(0.035, 0.08, min(wa, wr));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.32, line * red);
  // fine fabric weave
  diffuseColor.rgb *= 0.9 + 0.1 * sin(vLoc.x * 900.0) * sin(vLoc.y * 900.0);
}`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.62, step(diffuseColor.r, diffuseColor.b));");
  };
  return fogPatch(m, "ws-suit");
}

function colorize(g, fn) {
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); c.set(fn(v), i * 3); }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}

/** capsule hanging down from its joint (y = 0 .. -len) */
function limb(r0, r1, len, fn) {
  const g = new THREE.CapsuleGeometry((r0 + r1) / 2, Math.max(0.01, len - (r0 + r1)), 5, 12);
  // taper
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), t = THREE.MathUtils.clamp(0.5 - y / len, 0, 1);
    const k = THREE.MathUtils.lerp(r0, r1, t) / ((r0 + r1) / 2);
    p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k);
  }
  g.translate(0, -len / 2, 0);
  g.computeVertexNormals();
  return colorize(g, fn || (() => RED));
}

const POSES = {
  // joint: [x, y, z] euler (radians). x+ swings a limb forward.
  stand: { spine: [0.02, 0, 0], chest: [0.02, 0, 0], head: [0, 0, 0], lSh: [0.05, 0, 0.12], rSh: [0.05, 0, -0.12], lEl: [0.2, 0, 0], rEl: [0.2, 0, 0], lHip: [0, 0, 0.04], rHip: [0, 0, -0.04], lKn: [-0.05, 0, 0], rKn: [-0.05, 0, 0] },
  crouch: { spine: [0.45, 0, 0], chest: [0.2, 0, 0], head: [-0.4, 0, 0], lSh: [0.4, 0, 0.5], rSh: [0.4, 0, -0.5], lEl: [0.6, 0, 0], rEl: [0.6, 0, 0], lHip: [1.3, 0, 0.35], rHip: [1.3, 0, -0.35], lKn: [-2.1, 0, 0], rKn: [-2.1, 0, 0] },
  air: { spine: [0.1, 0, 0], chest: [0.05, 0, 0], head: [-0.1, 0, 0], lSh: [-0.3, 0, 1.2], rSh: [-0.3, 0, -1.2], lEl: [0.5, 0, 0], rEl: [0.5, 0, 0], lHip: [0.6, 0, 0.15], rHip: [0.15, 0, -0.2], lKn: [-1.4, 0, 0], rKn: [-0.5, 0, 0] },
  fall: { spine: [-0.15, 0, 0], chest: [-0.1, 0, 0], head: [0.3, 0, 0], lSh: [0.2, 0, 1.9], rSh: [0.2, 0, -1.9], lEl: [0.4, 0, 0], rEl: [0.4, 0, 0], lHip: [0.2, 0, 0.45], rHip: [0.2, 0, -0.45], lKn: [-0.9, 0, 0], rKn: [-0.9, 0, 0] },
  dive: { spine: [0.05, 0, 0], chest: [0, 0, 0], head: [-0.6, 0, 0], lSh: [-0.35, 0, 0.18], rSh: [-0.35, 0, -0.18], lEl: [0.05, 0, 0], rEl: [0.05, 0, 0], lHip: [0.05, 0, 0.02], rHip: [0.05, 0, -0.02], lKn: [-0.2, 0, 0], rKn: [-0.1, 0, 0] },
  // swing (right hand on the rope): rope arm straight up, legs tucked forward
  swingR: { spine: [0.15, 0, 0], chest: [0.05, 0, 0.05], head: [-0.15, 0, 0], lSh: [0.5, 0, 0.6], rSh: [0.15, 0, -2.95], lEl: [1.1, 0, 0], rEl: [0.05, 0, 0], lHip: [0.95, 0, 0.1], rHip: [0.55, 0, -0.1], lKn: [-1.3, 0, 0], rKn: [-0.9, 0, 0] },
  flip: { spine: [0.8, 0, 0], chest: [0.4, 0, 0], head: [-0.2, 0, 0], lSh: [1.0, 0, 0.4], rSh: [1.0, 0, -0.4], lEl: [1.4, 0, 0], rEl: [1.4, 0, 0], lHip: [2.0, 0, 0.2], rHip: [2.0, 0, -0.2], lKn: [-2.4, 0, 0], rKn: [-2.4, 0, 0] },
  zip: { spine: [0.1, 0, 0], chest: [0, 0, 0], head: [-0.2, 0, 0], lSh: [2.7, 0, 0.1], rSh: [2.7, 0, -0.1], lEl: [0.1, 0, 0], rEl: [0.1, 0, 0], lHip: [0.3, 0, 0.1], rHip: [-0.1, 0, -0.1], lKn: [-0.8, 0, 0], rKn: [-0.4, 0, 0] },
};
POSES.swingL = mirror(POSES.swingR);
function mirror(p) {
  const o = {};
  for (const k in p) {
    const m = k[0] === "l" ? "r" + k.slice(1) : k[0] === "r" ? "l" + k.slice(1) : k;
    o[m] = [p[k][0], -p[k][1], -p[k][2]];
  }
  return o;
}

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export class Character {
  constructor(scene) {
    this.root = new THREE.Group();
    this.body = new THREE.Group();       // oriented (rope / wall / flips)
    this.root.add(this.body);
    scene.add(this.root);
    const mat = suitMaterial();
    const J = (this.j = {});
    const mesh = (g, parent) => { const m = new THREE.Mesh(g, mat); m.castShadow = true; parent.add(m); return m; };
    const joint = (name, parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); J[name] = g; return g; };

    const sideCol = (side) => (v) => (v.x * side > 0.035 ? BLUE : RED);
    // pelvis at +0.05 from the AABB centre
    const hips = joint("hips", this.body, 0, 0.05, 0);
    mesh(colorize(new THREE.CapsuleGeometry(0.125, 0.12, 4, 12).rotateZ(Math.PI / 2).scale(1, 1, 0.8), (v) => (Math.abs(v.x) > 0.1 ? BLUE : RED)), hips);
    const spine = joint("spine", hips, 0, 0.05, 0);
    const ab = new THREE.CapsuleGeometry(0.12, 0.12, 4, 12).scale(1.05, 1, 0.75).translate(0, 0.12, 0);
    mesh(colorize(ab, (v) => (Math.abs(v.x) > 0.075 ? BLUE : RED)), spine);
    const chest = joint("chest", spine, 0, 0.24, 0);
    const ch = new THREE.CapsuleGeometry(0.15, 0.12, 5, 14).scale(1.12, 1, 0.72).translate(0, 0.12, 0);
    mesh(colorize(ch, (v) => (Math.abs(v.x) > 0.11 && v.y < 0.17 ? BLUE : RED)), chest);
    // emblem
    const em = new THREE.Group();
    em.position.set(0, 0.14, -0.118);
    const dark = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.5 });
    fogPatch(dark, "ws-dark");
    const bodyE = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6).scale(0.8, 1.3, 0.35), dark); em.add(bodyE);
    for (const s of [-1, 1]) for (const a of [0.5, 0.15, -0.2, -0.55]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.007, 0.006), dark);
      leg.position.set(s * 0.045, a * 0.04, 0); leg.rotation.z = s * a * 1.4; em.add(leg);
    }
    chest.add(em);
    const neck = joint("head", chest, 0, 0.3, 0);
    mesh(colorize(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10).translate(0, 0.02, 0), () => RED), neck);
    const hg = new THREE.SphereGeometry(0.115, 20, 16).scale(0.92, 1.12, 1).translate(0, 0.17, -0.005);
    mesh(colorize(hg, () => RED), neck);
    // lenses: white with black rims
    const lensMat = new THREE.MeshStandardMaterial({ color: 0xf2f4ff, roughness: 0.15, emissive: 0x303238 });
    fogPatch(lensMat, "ws-lens");
    for (const s of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8).scale(1.1, 0.72, 0.35), dark);
      rim.position.set(s * 0.045, 0.19, -0.1); rim.rotation.set(0.1, s * 0.35, s * -0.45);
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 8).scale(1.1, 0.68, 0.35), lensMat);
      lens.position.set(s * 0.045, 0.19, -0.106); lens.rotation.copy(rim.rotation);
      neck.add(rim, lens);
    }
    for (const [side, L] of [[-1, "l"], [1, "r"]]) {
      const sh = joint(L + "Sh", chest, side * 0.19, 0.22, 0);
      mesh(colorize(new THREE.SphereGeometry(0.075, 12, 8), () => RED), sh);
      mesh(limb(0.07, 0.052, 0.3, sideCol(side)), sh);
      const el = joint(L + "El", sh, 0, -0.29, 0);
      mesh(limb(0.052, 0.042, 0.27), el);
      const hand = new THREE.Group(); hand.position.set(0, -0.3, 0); el.add(hand); J[L + "Hand"] = hand;
      mesh(colorize(new THREE.SphereGeometry(0.048, 10, 8).scale(0.85, 1.25, 0.6), () => RED), hand);
      const hip = joint(L + "Hip", hips, side * 0.1, -0.04, 0);
      mesh(limb(0.09, 0.062, 0.45, () => BLUE), hip);
      const kn = joint(L + "Kn", hip, 0, -0.44, 0);
      mesh(limb(0.062, 0.045, 0.43, (v) => (v.y < -0.24 ? RED : BLUE)), kn);
      const foot = colorize(new THREE.CapsuleGeometry(0.045, 0.12, 4, 8).rotateX(Math.PI / 2).translate(0, -0.44, -0.06), () => RED);
      mesh(foot, kn);
    }
    this.names = Object.keys(POSES.stand);
    this.cur = {};
    for (const n of this.names) this.cur[n] = [...POSES.stand[n]];
    this.phase = 0;
    this.flipAngle = 0;
    this.q = new THREE.Quaternion();
    this.qt = new THREE.Quaternion();
    this.m = new THREE.Matrix4();
    this.v1 = new THREE.Vector3(); this.v2 = new THREE.Vector3(); this.v3 = new THREE.Vector3();
    this.lean = 0;
    this.handPos = { l: new THREE.Vector3(), r: new THREE.Vector3() };
  }

  /** orient body: up axis & forward axis in world → quaternion */
  basis(up, fwd) {
    const back = this.v3.copy(fwd).negate();
    back.addScaledVector(up, -back.dot(up)).normalize();
    const right = this.v2.crossVectors(up, back).normalize();
    this.m.makeBasis(right, up, back);
    return this.qt.setFromRotationMatrix(this.m);
  }

  update(dt, pl, c, t) {
    const v = pl.v, hs = Math.hypot(v.x, v.z), sp = Math.hypot(v.x, v.y, v.z);
    this.root.position.set(pl.p.x, pl.p.y, pl.p.z);
    const target = {};
    const put = (pose, w = 1) => { for (const n of this.names) { const a = target[n] || (target[n] = [0, 0, 0]), b = pose[n]; a[0] += b[0] * w; a[1] += b[1] * w; a[2] += b[2] * w; } };
    let rate = 14;
    const up = this.v1.set(0, 1, 0), fwd = new THREE.Vector3(-Math.sin(pl.facing), 0, -Math.cos(pl.facing));
    const st = pl.state;
    if (st === "ground") {
      if (pl.charge > 0.05) put(POSES.crouch, 1);
      else if (pl.roll > 0) {
        put(POSES.flip, 1);
      } else if (hs > 0.8) {
        // run cycle: stride length grows with speed
        this.phase += dt * (3.2 + hs * 0.42);
        const s = Math.sin(this.phase), k = Math.min(1, hs / 10), sprint = Math.min(1, Math.max(0, (hs - 10) / 7));
        const amp = 0.55 + 0.45 * k;
        const run = {
          spine: [0.12 + 0.25 * sprint, s * 0.05, 0], chest: [0.05 + sprint * 0.1, -s * 0.15, 0], head: [-0.1 - 0.25 * sprint, s * 0.1, 0],
          lSh: [s * 0.9 * amp - sprint * 0.6, 0, 0.15 + sprint * 0.2], rSh: [-s * 0.9 * amp - sprint * 0.6, 0, -0.15 - sprint * 0.2],
          lEl: [1.2 + sprint * 0.3, 0, 0], rEl: [1.2 + sprint * 0.3, 0, 0],
          lHip: [-s * 1.0 * amp + 0.2, 0, 0.03], rHip: [s * 1.0 * amp + 0.2, 0, -0.03],
          lKn: [-(0.35 + Math.max(0, -Math.cos(this.phase)) * 1.6 * amp), 0, 0], rKn: [-(0.35 + Math.max(0, Math.cos(this.phase)) * 1.6 * amp), 0, 0],
        };
        put(run);
        rate = 20;
      } else {
        this.phase += dt * 1.5;
        const b = Math.sin(this.phase) * 0.02;
        put(POSES.stand); target.chest[0] += b; target.head[0] -= b;
      }
      this.body.position.y = pl.roll > 0 ? -0.35 : pl.charge > 0.05 ? -0.35 * Math.min(1, pl.charge * 3) : Math.abs(Math.sin(this.phase)) * 0.04 * Math.min(1, hs / 8);
    } else if (st === "swing") {
      put(pl.hand > 0 ? POSES.swingR : POSES.swingL);
      // legs kick through the bottom of the arc
      const k = Math.sin(pl.attachT * 3.5) * 0.25;
      target.lHip[0] += k; target.rHip[0] -= k;
      // body hangs along the rope
      const A = pl.anchor;
      up.set(A.x - pl.p.x, A.y - pl.p.y, A.z - pl.p.z).normalize();
      fwd.set(v.x, v.y, v.z).normalize();
      if (sp < 1) fwd.set(-Math.sin(pl.facing), 0, -Math.cos(pl.facing));
      this.body.position.y = 0;
    } else if (st === "wall") {
      // run up the wall with the wall as the floor
      this.phase += dt * (3 + Math.abs(v.y) * 0.5);
      const s = Math.sin(this.phase);
      const climb = {
        spine: [0.3, 0, 0], chest: [0.1, 0, 0], head: [-0.5, 0, 0],
        lSh: [s * 1.1, 0, 0.3], rSh: [-s * 1.1, 0, -0.3], lEl: [1.3, 0, 0], rEl: [1.3, 0, 0],
        lHip: [-s * 1.1 + 0.4, 0, 0.1], rHip: [s * 1.1 + 0.4, 0, -0.1],
        lKn: [-(0.4 + Math.max(0, -Math.cos(this.phase)) * 1.5), 0, 0], rKn: [-(0.4 + Math.max(0, Math.cos(this.phase)) * 1.5), 0, 0],
      };
      put(climb);
      const n = pl.wallN;
      up.set(n.x, 0, n.z);
      if (v.y > -2) fwd.set(v.x * 0.3, Math.max(2, v.y), v.z * 0.3); else fwd.set(v.x, 0.5, v.z);
      fwd.normalize();
      this.body.position.y = 0;
      rate = 18;
    } else if (st === "zip") {
      put(POSES.zip);
      // zip: arms-first, body points toward the target
      up.set(v.x, v.y, v.z).normalize();
      fwd.set(0, -1, 0);
      this.body.position.y = 0;
    } else {
      // air: blend tuck/fall/dive by vertical speed and input
      const diving = c.dive && v.y < 5;
      if (pl.flip > 0) put(POSES.flip);
      else if (diving) put(POSES.dive);
      else {
        const fall = Math.min(1, Math.max(0, (-v.y - 4) / 20));
        put(POSES.air, 1 - fall); put(POSES.fall, fall);
        // flail a little in the wind
        const w = Math.sin(t * 9) * 0.08 * fall;
        target.lSh[2] += w; target.rSh[2] -= w;
      }
      if (diving) {
        // head-first along the velocity
        up.set(v.x, v.y, v.z).normalize();
        fwd.set(0, -1, 0);
      } else if (-v.y > 12 && pl.flip <= 0) {
        // skydiving belly-down, leaning with the fall
        const f = Math.min(1, (-v.y - 12) / 20);
        up.set(-Math.sin(pl.facing) * f, 1 - f * 0.85, -Math.cos(pl.facing) * f).normalize();
        fwd.set(-Math.sin(pl.facing), -f * 1.5, -Math.cos(pl.facing)).normalize();
      }
      this.body.position.y = 0;
      rate = 9;
    }
    // orientation (with flips layered on top)
    this.basis(up, fwd);
    this.q.slerp(this.qt, 1 - Math.exp(-(st === "swing" ? 16 : 10) * dt));
    this.body.quaternion.copy(this.q);
    if (pl.flip > 0 || pl.roll > 0) {
      const dur = pl.flip > 0 ? 0.75 : 0.55, rem = pl.flip > 0 ? pl.flip : pl.roll;
      const f = 1 - rem / dur, e = f * f * (3 - 2 * f);
      this.flipAngle = -e * Math.PI * 2;
      this.body.rotateX(this.flipAngle);
    }
    for (const n of this.names) {
      const a = this.cur[n], b = target[n];
      a[0] = damp(a[0], b[0], rate, dt); a[1] = damp(a[1], b[1], rate, dt); a[2] = damp(a[2], b[2], rate, dt);
      this.j[n].rotation.set(a[0], a[1], a[2]);
    }
    this.root.updateMatrixWorld(true);
    this.j.lHand.getWorldPosition(this.handPos.l);
    this.j.rHand.getWorldPosition(this.handPos.r);
  }
}
