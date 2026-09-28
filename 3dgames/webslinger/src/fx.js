// Particles: soft sprites for landing dust, water spray, wall grit, the puff of
// concrete where a web strikes, and feathers when pigeons burst off a ledge.
// One pool of points simulated on the CPU (gravity, drag, growth, fade), lit by
// the same sun / sky colours as the city so a puff at dusk is dusk-coloured.
import * as THREE from "three";
import { U } from "./materials.js";

const N = 900;

const VERT = /* glsl */`
attribute float aSize; attribute float aAlpha; attribute vec3 aCol; attribute float aLit;
uniform float uScale;
varying float vAlpha; varying vec3 vCol; varying float vLit;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(300.0, aSize * uScale / max(0.3, -mv.z));
  vAlpha = aAlpha; vCol = aCol; vLit = aLit;
}`;
const FRAG = /* glsl */`
uniform vec3 uSunCol; uniform vec3 uHorizon;
varying float vAlpha; varying vec3 vCol; varying float vLit;
void main(){
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r = dot(d, d);
  if (r > 1.0) discard;
  // soft billow: dense core, feathered edge, a hint of top-lighting
  float a = pow(1.0 - r, 1.6) * vAlpha;
  float top = 0.8 + 0.35 * (-d.y);
  vec3 light = mix(vec3(1.0), uHorizon * 1.4 + uSunCol * 0.03 * top, vLit);
  gl_FragColor = vec4(vCol * light, a);
}`;

export class FX {
  constructor(scene) {
    this.pos = new Float32Array(N * 3);
    this.size = new Float32Array(N);
    this.alpha = new Float32Array(N);
    this.col = new Float32Array(N * 3);
    this.lit = new Float32Array(N);
    this.p = Array.from({ length: N }, () => ({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 1, s0: 0.3, s1: 1, a: 1, g: 0, drag: 1, floor: -1e9 }));
    this.next = 0;
    const g = new THREE.BufferGeometry();
    const attr = (a, n) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", attr(this.pos, 3));
    g.setAttribute("aSize", attr(this.size, 1));
    g.setAttribute("aAlpha", attr(this.alpha, 1));
    g.setAttribute("aCol", attr(this.col, 3));
    g.setAttribute("aLit", attr(this.lit, 1));
    this.g = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 600 }, uSunCol: U.uSunCol, uHorizon: U.uHorizon },
    });
    this.mesh = new THREE.Points(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    this.live = 0;
  }

  spawn(o) {
    const q = this.p[this.next];
    this.next = (this.next + 1) % N;
    Object.assign(q, { on: true, t: 0, g: 0, drag: 1.5, floor: -1e9, lit: 1 }, o);
    return q;
  }

  /** ground dust: a low ring rolling outward (hard landings kick up more) */
  dust(x, y, z, k = 1, vx = 0, vz = 0, col = [0.55, 0.52, 0.48]) {
    const n = Math.round(8 + 26 * k);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (2 + Math.random() * 5) * (0.5 + k);
      this.spawn({ x: x + Math.cos(a) * 0.3, y: y + 0.1, z: z + Math.sin(a) * 0.3,
        vx: Math.cos(a) * sp + vx * 0.25, vy: 0.4 + Math.random() * 1.5 * k, vz: Math.sin(a) * sp + vz * 0.25,
        life: 0.9 + Math.random() * 0.9 * (0.6 + k), s0: 0.35, s1: 1.4 + 1.8 * k, a: 0.35 + 0.15 * k, drag: 3.2, g: -0.3,
        c: col });
    }
  }

  /** a puff of concrete dust and chips where a web strikes (n = surface normal-ish) */
  impact(x, y, z, nx, ny, nz) {
    for (let i = 0; i < 12; i++) {
      const sp = 1.5 + Math.random() * 4;
      const rx = (Math.random() - 0.5) * 1.6, ry = (Math.random() - 0.5) * 1.6, rz = (Math.random() - 0.5) * 1.6;
      const chip = i < 4;
      this.spawn({ x, y, z, vx: (nx + rx) * sp, vy: (ny + ry) * sp, vz: (nz + rz) * sp,
        life: chip ? 1.4 : 0.8 + Math.random() * 0.6, s0: chip ? 0.07 : 0.25, s1: chip ? 0.07 : 1.1, a: chip ? 0.9 : 0.4,
        drag: chip ? 0.3 : 2.5, g: chip ? 18 : -0.2, c: chip ? [0.4, 0.39, 0.37] : [0.62, 0.6, 0.57] });
    }
  }

  /** water: a crown of spray and falling droplets */
  splash(x, y, z, k = 1) {
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random();
      const drop = i % 3 !== 0;
      const sp = drop ? 3 + r * 5 : 2 + r * 3;
      this.spawn({ x: x + Math.cos(a) * 0.5, y, z: z + Math.sin(a) * 0.5,
        vx: Math.cos(a) * sp, vy: (drop ? 6 + Math.random() * 9 : 1 + Math.random() * 3) * k, vz: Math.sin(a) * sp,
        life: drop ? 1.2 : 1.6, s0: drop ? 0.12 : 0.6, s1: drop ? 0.1 : 2.6, a: drop ? 0.8 : 0.35,
        drag: drop ? 0.2 : 2, g: drop ? 22 : 0, floor: y - 0.2, c: drop ? [0.85, 0.92, 1.0] : [0.8, 0.85, 0.9] });
    }
  }

  /** grit scraped off a wall under your feet */
  grit(x, y, z, nx, nz) {
    for (let i = 0; i < 3; i++) {
      this.spawn({ x, y, z, vx: nx * 2 + (Math.random() - 0.5) * 2, vy: -1 + Math.random() * 2, vz: nz * 2 + (Math.random() - 0.5) * 2,
        life: 0.6, s0: 0.15, s1: 0.6, a: 0.3, drag: 2.5, g: 2, c: [0.55, 0.53, 0.5] });
    }
  }

  /** a few loose feathers drifting down */
  feathers(x, y, z) {
    for (let i = 0; i < 4; i++) {
      this.spawn({ x, y, z, vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 3,
        life: 3 + Math.random() * 2, s0: 0.05, s1: 0.05, a: 0.95, drag: 3.5, g: 3, c: [0.75, 0.76, 0.8], flutter: Math.random() * 6 });
    }
  }

  update(dt, camera, heightPx) {
    this.mat.uniforms.uScale.value = heightPx / (2 * Math.tan(camera.fov * Math.PI / 360));
    let live = 0;
    for (let i = 0; i < N; i++) {
      const q = this.p[i];
      if (!q.on) { this.alpha[i] = 0; continue; }
      q.t += dt;
      if (q.t >= q.life) { q.on = false; this.alpha[i] = 0; continue; }
      live++;
      const dr = Math.exp(-q.drag * dt);
      q.vx *= dr; q.vz *= dr; q.vy = q.vy * dr - q.g * dt;
      if (q.flutter) { q.vx += Math.sin(q.t * 5 + q.flutter) * 3 * dt; q.vz += Math.cos(q.t * 4 + q.flutter) * 3 * dt; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.y < q.floor) { q.y = q.floor; q.vy *= -0.2; q.vx *= 0.5; q.vz *= 0.5; }
      const u = q.t / q.life;
      this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
      this.size[i] = q.s0 + (q.s1 - q.s0) * (1 - (1 - u) * (1 - u));
      // quick fade-in, long fade-out
      this.alpha[i] = q.a * Math.min(1, q.t * 20) * (1 - u) * (1 - u);
      this.col[i * 3] = q.c[0]; this.col[i * 3 + 1] = q.c[1]; this.col[i * 3 + 2] = q.c[2];
      this.lit[i] = q.lit;
    }
    this.live = live;
    const a = this.g.attributes;
    a.position.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = a.aCol.needsUpdate = a.aLit.needsUpdate = true;
  }
}
