// Physically based sky. A Nishita single-scattering model is baked into a small
// equirect LUT whenever the sun moves; the full-res dome samples it and adds the
// sun disc, lit clouds, stars and the moon. The same LUT colours the height fog
// (materials.js), so distant buildings melt into exactly the sky behind them.
// Sun light colour/intensity comes from the same model evaluated on the CPU.
import * as THREE from "three";
import { U } from "./materials.js";

const RE = 6360e3, RA = 6420e3, HR = 7994, HM = 1200;
const BR = [5.5e-6, 13.0e-6, 22.4e-6], BM = 21e-6;

const ATMOS_GLSL = /* glsl */`
const float Re = 6360e3, Ra = 6420e3, Hr = 7994.0, Hm = 1200.0;
const vec3 bR = vec3(5.5e-6, 13.0e-6, 22.4e-6);
const float bM = 21e-6;
vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd), c = dot(ro, ro) - r * r, d = b * b - c;
  if (d < 0.0) return vec2(1e9, -1e9);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}
vec3 scatter(vec3 rd, vec3 sun, float sunI, float g) {
  vec3 ro = vec3(0.0, Re + 120.0, 0.0);
  float tmax = raySphere(ro, rd, Ra).y;
  vec2 tg = raySphere(ro, rd, Re);
  if (tg.x > 0.0) tmax = tg.x;
  const int N = 20, M = 8;
  float seg = tmax / float(N);
  float odR = 0.0, odM = 0.0;
  vec3 sR = vec3(0.0), sM = vec3(0.0);
  float mu = dot(rd, sun);
  float pR = 3.0 / (16.0 * 3.14159) * (1.0 + mu * mu);
  float g2 = g * g;
  float pM = 3.0 / (8.0 * 3.14159) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * (seg * (float(i) + 0.5));
    float h = length(p) - Re;
    float hr = exp(-h / Hr) * seg, hm = exp(-h / Hm) * seg;
    odR += hr; odM += hm;
    float tl = raySphere(p, sun, Ra).y;
    float segL = tl / float(M);
    float lR = 0.0, lM = 0.0;
    bool ok = true;
    for (int j = 0; j < M; j++) {
      vec3 q = p + sun * (segL * (float(j) + 0.5));
      float hl = length(q) - Re;
      if (hl < 0.0) { ok = false; break; }
      lR += exp(-hl / Hr) * segL; lM += exp(-hl / Hm) * segL;
    }
    if (ok) {
      vec3 att = exp(-(bR * (odR + lR) + bM * 1.1 * (odM + lM)));
      sR += att * hr; sM += att * hm;
    }
  }
  return (sR * bR * pR + sM * bM * pM) * sunI;
}`;

const FS_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class Sky {
  constructor(renderer) {
    this.renderer = renderer;
    this.lut = new THREE.WebGLRenderTarget(256, 128, {
      type: THREE.HalfFloatType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false,
    });
    this.lut.texture.colorSpace = THREE.LinearSRGBColorSpace;
    U.uSkyLUT.value = this.lut.texture;
    this.lutMat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3() }, uMoon: { value: new THREE.Vector3() }, uNightSky: { value: 0 }, uHaze: { value: 1 }, uTwi: { value: 0 } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform vec3 uSun; uniform vec3 uMoon; uniform float uNightSky; uniform float uHaze; uniform float uTwi;
        ${ATMOS_GLSL}
        void main() {
          float az = (vUv.x - 0.5) * 6.2831853;
          float s = vUv.y * 2.0 - 1.0;
          float y = sign(s) * s * s;
          float c = sqrt(max(0.0, 1.0 - y * y));
          vec3 rd = vec3(cos(az) * c, y, sin(az) * c);
          vec3 col = scatter(rd, uSun, 22.0, 0.76 + 0.02 * uHaze);
          col += scatter(rd, uMoon, 0.045, 0.76) * uNightSky;
          // night: deep blue + orange light pollution hugging the horizon
          float up = max(y, 0.0);
          col += uNightSky * (vec3(0.006, 0.01, 0.026) * (1.0 - 0.6 * up) + vec3(0.05, 0.028, 0.014) * exp(-up * 8.0));
          // twilight (sun just below the horizon): single scattering alone goes black here,
          // so add the deep-blue dome and the warm band hugging the horizon under the sun
          float toward = max(dot(normalize(rd.xz + 1e-4), normalize(uSun.xz + 1e-4)), 0.0);
          vec3 twi = mix(vec3(0.012, 0.024, 0.07), vec3(0.035, 0.045, 0.085), exp(-up * 3.0))
                   + vec3(0.11, 0.045, 0.014) * exp(-up * 7.0) * toward * toward;
          col += uTwi * twi;
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.fsScene = new THREE.Scene();
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.fsScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lutMat));

    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uLUT: U.uSkyLUT, uSun: U.uSunDir, uSunCol: U.uSunCol, uTime: U.uTime,
        uMoon: { value: new THREE.Vector3(0, 1, 0) }, uNightSky: { value: 0 },
        uCloud: { value: 0.45 }, uCamPos: { value: new THREE.Vector3() }, uSunVis: { value: 1 },
        uZenith: { value: new THREE.Color() },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vDir;
        uniform sampler2D uLUT; uniform vec3 uSun; uniform vec3 uSunCol; uniform float uTime;
        uniform vec3 uMoon; uniform float uNightSky; uniform float uCloud; uniform vec3 uCamPos; uniform float uSunVis;
        uniform vec3 uZenith;
        float hh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float hh3(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hh(i), hh(i+vec2(1,0)), u.x), mix(hh(i+vec2(0,1)), hh(i+vec2(1,1)), u.x), u.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
          for (int i = 0; i < 6; i++){ s += a * vn(p); p = m * p; a *= 0.5; } return s; }
        vec2 skyUV(vec3 d){ float u = atan(d.z, d.x) / 6.2831853 + 0.5; float y = clamp(d.y, -1.0, 1.0);
          return vec2(u, 0.5 + 0.5 * sign(y) * sqrt(abs(y))); }
        float cloudD(vec2 p) {
          float base = fbm(p);
          float cov = uCloud + 0.25 * (vn(p * 0.13 + 7.0) - 0.5);
          return smoothstep(1.0 - cov, 1.0 - cov + 0.35, base);
        }
        void main() {
          vec3 rd = normalize(vDir);
          // below the horizon only the far-clipped water shows: continue the (fogged) horizon colour
          vec3 col = texture2D(uLUT, skyUV(vec3(rd.x, max(rd.y, 0.015), rd.z))).rgb;
          float mu = dot(rd, uSun);
          // sun disc with limb darkening + a tight glow
          float sd = smoothstep(0.99996, 0.999985, mu);
          float limb = sqrt(max(0.0, 1.0 - (1.0 - mu) / (1.0 - 0.99996)));
          vec3 sunDisc = uSunCol * sd * (0.4 + 0.6 * limb) * 900.0 * uSunVis;
          col += uSunCol * pow(max(mu, 0.0), 900.0) * 1.6 * uSunVis;
          if (rd.y < 0.015) col += uSunCol * pow(max(mu, 0.0), 12.0) * 0.12;
          // stars + moon
          if (uNightSky > 0.01) {
            vec3 sp = rd * 420.0;
            vec3 cell = floor(sp);
            float st = hh3(cell);
            vec3 fp = fract(sp) - 0.5;
            float star = step(0.985, st) * smoothstep(0.2, 0.0, length(fp)) * (0.6 + 0.4 * sin(uTime * (2.0 + st * 5.0) + st * 90.0));
            col += vec3(0.9, 0.95, 1.1) * star * 0.8 * uNightSky * smoothstep(0.0, 0.15, rd.y) * (0.3 + 2.0 * pow(fract(st * 97.0), 6.0));
            float md = dot(rd, uMoon);
            float disc = smoothstep(0.99985, 0.99989, md);
            vec3 mcol = vec3(0.9, 0.92, 1.0) * (0.75 + 0.25 * vn(rd.xz * 900.0)) * 3.0;
            col = mix(col, mcol, disc * uNightSky);
            col += vec3(0.5, 0.6, 0.8) * pow(max(md, 0.0), 300.0) * 0.08 * uNightSky;
          }
          // cloud layer
          if (rd.y > 0.0 && uCloud > 0.01) {
            float t = (2200.0 - uCamPos.y) / rd.y;
            vec2 p = (uCamPos.xz + rd.xz * t) / 2600.0 + vec2(uTime * 0.0015, uTime * 0.0006);
            float d = cloudD(p);
            if (d > 0.001) {
              vec2 sd2 = normalize(uSun.xz + 1e-4) * 0.06;
              float shadow = cloudD(p + sd2) * 0.6 + cloudD(p + sd2 * 2.5) * 0.4;
              float light = exp(-shadow * 2.2);
              float silver = pow(max(mu, 0.0), 8.0) * 2.5 + pow(max(mu, 0.0), 60.0) * 6.0;
              float sunUp = smoothstep(-0.12, 0.05, uSun.y);
              vec3 amb = uZenith * 1.1 + vec3(0.02, 0.018, 0.02) * uNightSky;
              vec3 cc = amb * (0.6 + 0.4 * (1.0 - d)) + uSunCol * (light * 0.055 + silver * 0.02 * (1.0 - d)) * sunUp;
              // clouds lit from below by the city at night
              cc += vec3(0.035, 0.02, 0.012) * uNightSky * (1.0 - smoothstep(0.0, 0.5, rd.y));
              float fade = exp(-t / 45000.0) * smoothstep(0.0, 0.06, rd.y);
              col = mix(col, cc, d * fade * 0.95);
              sunDisc *= 1.0 - d * fade;
            }
          }
          col += sunDisc;
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = 1000;

    this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(this.dome.geometry, this.domeMat);
    this.envScene.add(this.envDome);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;

    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.sunLight = new THREE.Color();
    this.state = { night: 0, day: 1, twilight: 1 };
    this.cloud = 0.45;
    this.haze = 1;
  }

  /** hour 0..24 → sun direction (x east, z south, -z north); a gently tilted arc */
  static sunFromHour(hour, out) {
    const t = (hour - 6) / 12;                 // 0 sunrise .. 1 sunset
    const el = 58 * Math.sin(Math.PI * t) * Math.PI / 180;
    const az = (90 + (hour - 6) * 15) * Math.PI / 180;
    return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  }

  setTime(hour, cloud = this.cloud, haze = this.haze) {
    this.hour = hour; this.cloud = cloud; this.haze = haze;
    Sky.sunFromHour(hour, this.sunDir);
    Sky.sunFromHour(hour + 12, this.moonDir);
    this.moonDir.y = Math.abs(this.moonDir.y) * 0.8 + 0.25;
    this.moonDir.normalize();
    const el = Math.asin(this.sunDir.y) * 180 / Math.PI;
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const day = sm(-3, 6, el), twilight = sm(-12, 2, el), night = 1 - sm(-10, 1, el);
    this.state = { day, twilight, night, el };

    // bake the LUT
    this.lutMat.uniforms.uSun.value.copy(this.sunDir);
    this.lutMat.uniforms.uMoon.value.copy(this.moonDir);
    this.lutMat.uniforms.uNightSky.value = night;
    this.lutMat.uniforms.uHaze.value = haze;
    const twi = sm(-14, -4, el) * (1 - sm(-1, 4, el));
    this.lutMat.uniforms.uTwi.value = twi;
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(this.lut);
    r.render(this.fsScene, this.fsCam);
    r.setRenderTarget(prev);

    // CPU: sunlight colour (transmittance) and horizon / zenith sky colours
    const tr = transmittance(this.sunDir);
    const sunI = 9.5 * day;
    U.uSunDir.value.copy(this.sunDir);
    U.uSunCol.value.setRGB(tr[0] * 22, tr[1] * 22, tr[2] * 22);
    this.sunLight.setRGB(tr[0] * sunI, tr[1] * sunI, tr[2] * sunI);
    const away = new THREE.Vector3(-this.sunDir.x, 0.05, -this.sunDir.z).normalize();
    const hz = scatterCPU(away, this.sunDir, 22);
    const zen = scatterCPU(new THREE.Vector3(0, 1, 0), this.sunDir, 22);
    const nightHz = [0.05 * night + 0.035 * twi, 0.028 * night + 0.045 * twi, 0.014 * night + 0.085 * twi];
    U.uHorizon.value.setRGB(hz[0] + nightHz[0], hz[1] + nightHz[1], hz[2] + nightHz[2]);
    this.domeMat.uniforms.uZenith.value.setRGB(zen[0] + 0.006 * night + 0.012 * twi, zen[1] + 0.01 * night + 0.024 * twi, zen[2] + 0.026 * night + 0.07 * twi);
    this.domeMat.uniforms.uMoon.value.copy(this.moonDir);
    this.domeMat.uniforms.uNightSky.value = night;
    this.domeMat.uniforms.uCloud.value = cloud;
    this.domeMat.uniforms.uSunVis.value = sm(-2, 0.5, el);

    // image-based lighting from the dome (clouds included)
    this.domeMat.uniforms.uCamPos.value.set(0, 0, 0);
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 10);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    return this.state;
  }

  update(camera) {
    this.dome.position.copy(camera.position);
    this.dome.scale.setScalar(camera.far * 0.9);
    this.domeMat.uniforms.uCamPos.value.copy(camera.position);
  }
}

function raySphere(o, d, r) {
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r;
  const disc = b * b - c;
  if (disc < 0) return [1e9, -1e9];
  const s = Math.sqrt(disc);
  return [-b - s, -b + s];
}

function transmittance(dir) {
  const o = [0, RE + 120, 0], d = [dir.x, Math.max(dir.y, -0.2), dir.z];
  const n = Math.hypot(...d); d[0] /= n; d[1] /= n; d[2] /= n;
  if (raySphere(o, d, RE)[0] > 0) return [0, 0, 0];
  const t = raySphere(o, d, RA)[1], N = 64, seg = t / N;
  let oR = 0, oM = 0;
  for (let i = 0; i < N; i++) {
    const s = seg * (i + 0.5);
    const h = Math.hypot(o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s) - RE;
    oR += Math.exp(-h / HR) * seg; oM += Math.exp(-h / HM) * seg;
  }
  return BR.map((b) => Math.exp(-(b * oR + BM * 1.1 * oM)));
}

function scatterCPU(rd, sun, sunI) {
  const o = [0, RE + 120, 0], d = [rd.x, rd.y, rd.z], s = [sun.x, sun.y, sun.z];
  const tmax = raySphere(o, d, RA)[1];
  const N = 16, M = 8, seg = tmax / N;
  let odR = 0, odM = 0;
  const sR = [0, 0, 0], sM = [0, 0, 0];
  const mu = d[0] * s[0] + d[1] * s[1] + d[2] * s[2], g = 0.76;
  const pR = 3 / (16 * Math.PI) * (1 + mu * mu);
  const pM = 3 / (8 * Math.PI) * ((1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * mu, 1.5));
  for (let i = 0; i < N; i++) {
    const p = [o[0] + d[0] * seg * (i + 0.5), o[1] + d[1] * seg * (i + 0.5), o[2] + d[2] * seg * (i + 0.5)];
    const h = Math.hypot(...p) - RE;
    const hr = Math.exp(-h / HR) * seg, hm = Math.exp(-h / HM) * seg;
    odR += hr; odM += hm;
    const tl = raySphere(p, s, RA)[1], sl = tl / M;
    let lR = 0, lM = 0, ok = true;
    for (let j = 0; j < M; j++) {
      const q = [p[0] + s[0] * sl * (j + 0.5), p[1] + s[1] * sl * (j + 0.5), p[2] + s[2] * sl * (j + 0.5)];
      const hl = Math.hypot(...q) - RE;
      if (hl < 0) { ok = false; break; }
      lR += Math.exp(-hl / HR) * sl; lM += Math.exp(-hl / HM) * sl;
    }
    if (!ok) continue;
    for (let k = 0; k < 3; k++) {
      const att = Math.exp(-(BR[k] * (odR + lR) + BM * 1.1 * (odM + lM)));
      sR[k] += att * hr; sM[k] += att * hm;
    }
  }
  return [0, 1, 2].map((k) => (sR[k] * BR[k] * pR + sM[k] * BM * pM) * sunI);
}
