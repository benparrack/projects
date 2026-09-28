// Web strands: camera-facing ribbons rebuilt on the CPU each frame. A strand
// shoots out from the hand to its anchor (tip travels at ~300 m/s with a slight
// wobble), stays taut while swinging (sagging when slack), and after release
// drops away from the hand and fades, left hanging from the building.
import * as THREE from "three";

const SEG = 28, POOL = 10;

const VERT = /* glsl */`
attribute float aAlpha;
attribute float aU;
varying float vAlpha; varying float vU; varying float vSide;
void main(){
  vAlpha = aAlpha; vU = aU; vSide = uv.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;
const FRAG = /* glsl */`
uniform vec3 uCol; uniform float uGlow;
varying float vAlpha; varying float vU; varying float vSide;
void main(){
  float edge = 1.0 - pow(abs(vSide * 2.0 - 1.0), 2.0);
  // faint twisted-fibre banding
  float band = 0.85 + 0.15 * sin(vU * 900.0 + vSide * 6.0);
  gl_FragColor = vec4(uCol * band * (0.8 + uGlow), vAlpha * edge);
}`;

class Strand {
  constructor() {
    this.a = new THREE.Vector3(); this.b = new THREE.Vector3();
    this.tip = 1; this.sag = 0; this.alpha = 0; this.life = 0; this.attached = false; this.free = true;
    this.fall = new THREE.Vector3();
  }
}

export class Webs {
  constructor(scene) {
    const n = POOL * (SEG + 1) * 2;
    this.pos = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    this.u = new Float32Array(n);
    const uv = new Float32Array(n * 2);
    const idx = [];
    for (let s = 0; s < POOL; s++) for (let i = 0; i <= SEG; i++) {
      const k = (s * (SEG + 1) + i) * 2;
      uv[k * 2 + 1] = 0; uv[(k + 1) * 2 + 1] = 1;
      if (i < SEG) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aU", new THREE.BufferAttribute(this.u, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uCol: { value: new THREE.Color(1.6, 1.62, 1.7) }, uGlow: { value: 0 } },
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this.g = g;
    this.strands = Array.from({ length: POOL }, () => new Strand());
    this.main = null;
    this.tmp = new THREE.Vector3(); this.t2 = new THREE.Vector3(); this.t3 = new THREE.Vector3();
  }

  get() {
    let s = this.strands.find((x) => x.free);
    if (!s) s = this.strands.reduce((a, b) => (a.alpha < b.alpha ? a : b));
    s.free = false; s.tip = 0; s.sag = 0; s.alpha = 1; s.life = 0; s.attached = true;
    s.fall.set(0, 0, 0);
    return s;
  }

  /** fire a strand from the hand to a point; returns it (stays attached until let go) */
  shoot(from, to) {
    const s = this.get();
    s.a.copy(from); s.b.copy(to);
    return s;
  }

  letGo(s) {
    if (!s) return;
    s.attached = false; s.life = 0;
  }

  update(dt, camera) {
    let v = 0;
    const cp = camera.position;
    for (let si = 0; si < POOL; si++) {
      const s = this.strands[si];
      if (!s.free) {
        s.life += dt;
        const len = s.a.distanceTo(s.b);
        s.tip = Math.min(1, s.tip + dt * 320 / Math.max(len, 1));
        if (!s.attached) {
          // the loose end falls & the strand fades out
          s.fall.y -= 9 * dt;
          s.a.addScaledVector(s.fall, dt);
          s.sag = Math.min(len * 0.25, s.sag + dt * len * 0.5);
          s.alpha = Math.max(0, s.alpha - dt * 0.9);
          if (s.alpha <= 0) s.free = true;
        }
      }
      const vis = !s.free;
      const len = s.a.distanceTo(s.b);
      for (let i = 0; i <= SEG; i++) {
        const k = (si * (SEG + 1) + i) * 2;
        if (!vis) { this.alpha[k] = this.alpha[k + 1] = 0; continue; }
        const f = (i / SEG) * s.tip;
        const p = this.tmp.lerpVectors(s.a, s.b, f);
        // sag (parabola) and a travelling wobble while the tip is in flight
        p.y -= s.sag * 4 * f * (1 - f);
        if (s.tip < 1) {
          const w = Math.sin(f * 18 - s.life * 60) * 0.25 * (1 - s.tip) * f;
          p.x += w; p.y += w * 0.5;
        }
        // tangent
        const f2 = Math.min(1, f + 0.01);
        const q = this.t2.lerpVectors(s.a, s.b, f2); q.y -= s.sag * 4 * f2 * (1 - f2);
        const tan = q.sub(p).normalize();
        const toC = this.t3.copy(cp).sub(p);
        const dist = toC.length();
        // at least ~1.3 px wide, fading instead of shrinking further
        const px = dist * 0.0009;
        const w = Math.max(0.018, px);
        const side = tan.cross(toC.normalize()).normalize().multiplyScalar(w);
        this.pos[k * 3] = p.x - side.x; this.pos[k * 3 + 1] = p.y - side.y; this.pos[k * 3 + 2] = p.z - side.z;
        this.pos[k * 3 + 3] = p.x + side.x; this.pos[k * 3 + 4] = p.y + side.y; this.pos[k * 3 + 5] = p.z + side.z;
        const a = s.alpha * Math.min(1, 0.018 / w + 0.35) * (i === SEG && s.tip < 1 ? 0.5 : 1);
        this.alpha[k] = this.alpha[k + 1] = a;
        this.u[k] = this.u[k + 1] = f * len * 0.02;
        v++;
      }
    }
    this.g.attributes.position.needsUpdate = true;
    this.g.attributes.aAlpha.needsUpdate = true;
    this.g.attributes.aU.needsUpdate = true;
  }
}
