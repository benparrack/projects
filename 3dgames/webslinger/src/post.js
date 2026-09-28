// HDR post pipeline (no EffectComposer): scene → half-float MSAA target with depth,
// physically-flavoured bloom (13-tap downsample / tent upsample mip chain with a
// Karis average against fireflies), screen-space god rays from the sun, then one
// composite pass (speed blur, chromatic aberration, ACES, grading, vignette,
// grain, optional comic-book ink + halftone) and FXAA + upscale to the canvas.
import * as THREE from "three";

const VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DOWN = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uFirst; uniform float uThreshold;
vec3 s(vec2 o){ vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb; return any(isnan(c)) || any(isinf(c)) ? vec3(0.0) : c; }
float karis(vec3 c){ return 1.0 / (1.0 + max(c.r, max(c.g, c.b))); }
void main(){
  vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
  vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
  vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
  vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
  vec3 col;
  if (uFirst > 0.5) {
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = karis(g0), w1 = karis(g1), w2 = karis(g2), w3 = karis(g3), w4 = karis(g4);
    col = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5) /
          (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5);
    float br = max(col.r, max(col.g, col.b));
    float knee = uThreshold * 0.6;
    float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    col *= max(soft, br - uThreshold) / max(br, 1e-4);
    col = min(col, vec3(60.0));
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const UP = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSrc; uniform sampler2D tPrev; uniform vec2 uTexel; uniform float uRadius; uniform float uMix;
void main(){
  vec2 t = uTexel * uRadius;
  vec3 c = texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb + texture2D(tSrc, vUv + vec2(0, t.y)).rgb * 2.0 + texture2D(tSrc, vUv + t).rgb
         + texture2D(tSrc, vUv + vec2(-t.x, 0)).rgb * 2.0 + texture2D(tSrc, vUv).rgb * 4.0 + texture2D(tSrc, vUv + vec2(t.x, 0)).rgb * 2.0
         + texture2D(tSrc, vUv - t).rgb + texture2D(tSrc, vUv + vec2(0, -t.y)).rgb * 2.0 + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb;
  c /= 16.0;
  gl_FragColor = vec4(texture2D(tPrev, vUv).rgb + c * uMix, 1.0);
}`;

const RAYS = /* glsl */`
varying vec2 vUv;
uniform sampler2D tScene; uniform sampler2D tDepth; uniform vec3 uSun; uniform float uAspect; uniform vec3 uSunCol;
void main(){
  if (uSun.z <= 0.0) { gl_FragColor = vec4(0.0); return; }
  vec2 d = (uSun.xy - vUv);
  const int N = 40;
  vec2 st = d / float(N) * 0.95;
  vec2 p = vUv;
  vec3 acc = vec3(0.0);
  float w = 1.0;
  float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
  p += st * jitter;
  for (int i = 0; i < N; i++) {
    float z = texture2D(tDepth, p).r;
    float sky = step(0.99999, z);
    vec2 q = (p - uSun.xy) * vec2(uAspect, 1.0);
    float fall = exp(-dot(q, q) * 7.0);
    acc += min(texture2D(tScene, p).rgb, vec3(4.0)) * sky * fall * w;
    w *= 0.975;
    p += st;
  }
  gl_FragColor = vec4(acc / float(N), 1.0);
}`;


// Screen-space ambient occlusion at half resolution: horizon-style hemisphere samples
// around a depth-reconstructed normal. The radius grows with distance so near ledges get
// crisp contact shadows and far street canyons darken toward the bottom. Stores AO in r,
// linear depth in g (for the depth-aware blur in the composite).
const SSAO = /* glsl */`
varying vec2 vUv;
uniform sampler2D tDepth; uniform mat4 uProjInv; uniform vec2 uTexel; uniform float uProjY; uniform float uTime;
vec3 vpos(vec2 uv){ float z = texture2D(tDepth, uv).r; vec4 p = uProjInv * vec4(vec3(uv, z) * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
void main(){
  float z0 = texture2D(tDepth, vUv).r;
  if (z0 >= 0.99999) { gl_FragColor = vec4(1.0, 1e5, 0.0, 1.0); return; }
  vec3 P = vpos(vUv);
  // normal from the flatter of the two neighbours on each axis (avoids smearing across edges)
  vec3 pr = vpos(vUv + vec2(uTexel.x, 0.0)), pl = vpos(vUv - vec2(uTexel.x, 0.0));
  vec3 pu = vpos(vUv + vec2(0.0, uTexel.y)), pd = vpos(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
  vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 n = normalize(cross(dx, dy));
  float dist = -P.z;
  float R = clamp(1.2 + dist * 0.035, 1.2, 14.0);
  float rs = R * uProjY * 0.5 / dist;             // radius in uv units
  rs = min(rs, 0.12);
  // interleaved gradient noise rotates the spiral per pixel; the blur hides the pattern
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float rot = ign * 6.2831853;
  const int N = 12;
  float occ = 0.0;
  for (int i = 0; i < N; i++) {
    float fi = (float(i) + 0.5) / float(N);
    float a = rot + float(i) * 2.3999632;
    vec2 o = vec2(cos(a), sin(a)) * rs * sqrt(fi) * vec2(uTexel.y / uTexel.x, 1.0);
    vec3 v = vpos(vUv + o) - P;
    float l = length(v);
    occ += max(0.0, dot(v / max(l, 1e-4), n) - 0.12) * (1.0 - smoothstep(0.55 * R, R, l));
  }
  float ao = clamp(1.0 - 1.35 * occ / float(N), 0.0, 1.0);
  gl_FragColor = vec4(ao * ao, dist, 0.0, 1.0);
}`;

// Eye adaptation: average log-luminance of the frame into a small grid, then a 1×1
// target that eases toward it over time (ping-pong), centre-weighted like a camera meter.
const LUM = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSrc; uniform vec2 uTexel;
void main(){
  float s = 0.0;
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
    vec3 c = texture2D(tSrc, vUv + (vec2(x, y) - 1.5) * 0.25 * uTexel).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    s += log(clamp(l, 1e-4, 60.0));
  }
  gl_FragColor = vec4(s / 16.0, 0.0, 0.0, 1.0);
}`;
const ADAPT = /* glsl */`
varying vec2 vUv;
uniform sampler2D tLum; uniform sampler2D tPrev; uniform float uRate; uniform vec2 uGrid;
void main(){
  float s = 0.0, w = 0.0;
  for (int y = 0; y < 18; y++) for (int x = 0; x < 32; x++) {
    vec2 uv = (vec2(x, y) + 0.5) / uGrid;
    vec2 q = (uv - 0.5) * vec2(1.6, 1.0);
    float k = 0.35 + exp(-dot(q, q) * 6.0);
    s += texture2D(tLum, uv).r * k; w += k;
  }
  float avg = exp(s / w);
  float prev = texture2D(tPrev, vec2(0.5)).r;
  float a = prev <= 0.0 ? avg : prev + (avg - prev) * uRate;
  gl_FragColor = vec4(a, 0.0, 0.0, 1.0);
}`;

const COMPOSITE = /* glsl */`
varying vec2 vUv;
uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tRays; uniform sampler2D tDepth;
uniform vec2 uRes; uniform float uTime;
uniform float uExposure, uBloom, uRays, uSpeed, uCA, uVignette, uGrain, uSat, uContrast, uComic, uWarm;
uniform float uNear, uFar; uniform vec2 uBlurCenter; uniform float uFlash; uniform vec3 uFlashCol;
uniform float uLetterbox;
uniform sampler2D tAO; uniform vec2 uAOTexel; uniform float uAO;
uniform sampler2D tAdapt; uniform float uAdapt; uniform float uKey; uniform float uTonemap;

vec3 aces(vec3 v) {
  const mat3 I = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 O = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  v = I * v;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(O * (a / b), 0.0, 1.0);
}
// AgX (Troy Sobotka / Blender), sRGB primaries: film-like highlight roll-off and hue
// preservation, far less of the saturated "game" look than ACES
vec3 agxCurve(vec3 x){ vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
vec3 agx(vec3 c){
  const mat3 IN = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 OUT = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  c = IN * max(c, 1e-10);
  c = clamp((log2(c) + 12.47393) / 16.5, 0.0, 1.0);
  c = agxCurve(c);
  // "punchy" look (as in Blender): a touch more contrast and saturation in display space
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = pow(max(vec3(l) + (c - l) * 1.3, 0.0), vec3(1.3));
  c = OUT * c;
  return pow(clamp(c, 0.0, 1.0), vec3(2.2));
}
float linDepth(float z){ float ndc = z * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear)); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

void main(){
  vec2 uv = vUv;
  vec2 fromC = uv - uBlurCenter;
  float r2 = dot(fromC * vec2(uRes.x / uRes.y, 1.0), fromC * vec2(uRes.x / uRes.y, 1.0));
  // radial speed blur, strongest at the edges
  vec3 col = vec3(0.0);
  float amt = uSpeed * 0.07 * smoothstep(0.02, 0.5, r2);
  const int NB = 10;
  float jit = hash(uv * uRes + uTime);
  for (int i = 0; i < NB; i++) {
    float t = (float(i) + jit) / float(NB);
    vec2 o = -fromC * amt * t;
    // chromatic aberration grows toward the edges and with speed
    float ca = uCA * (0.002 + 0.006 * uSpeed) * r2;
    col.r += texture2D(tScene, uv + o + fromC * ca).r;
    col.g += texture2D(tScene, uv + o).g;
    col.b += texture2D(tScene, uv + o - fromC * ca).b;
  }
  col /= float(NB);
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  if (uAO > 0.0) {
    // depth-aware 3x3 blur of the half-res AO, then applied mostly to ambient-lit tones
    float zc = linDepth(texture2D(tDepth, uv).r);
    float s = 0.0, w = 0.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 a = texture2D(tAO, uv + vec2(x, y) * uAOTexel).rg;
      float k = exp(-abs(a.y - zc) / (0.04 * zc + 0.05)) * (x == 0 && y == 0 ? 2.0 : 1.0);
      s += a.x * k; w += k;
    }
    float ao = w > 1e-4 ? s / w : 1.0;
    float lum0 = dot(col, vec3(0.2126, 0.7152, 0.0722)) * uExposure;
    col *= mix(1.0, ao, uAO * (1.0 - 0.6 * smoothstep(0.4, 2.5, lum0)));
  }
  col += texture2D(tBloom, uv).rgb * uBloom;
  col += texture2D(tRays, uv).rgb * uRays;
  float ex = uExposure;
  if (uAdapt > 0.0) {
    float avg = texture2D(tAdapt, vec2(0.5)).r;
    if (avg > 0.0) ex *= clamp(pow(uKey / max(avg * uExposure, 1e-4), uAdapt), 0.6, 1.7);
  }
  col *= ex;
  col = uTonemap > 0.5 ? agx(col) : aces(col);
  // grade (display-referred)
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat);
  col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0);
  vec3 shadowTint = vec3(0.92, 1.0, 1.07), hiTint = vec3(1.06, 1.0, 0.92);
  col *= mix(mix(vec3(1.0), shadowTint, uWarm), mix(vec3(1.0), hiTint, uWarm), smoothstep(0.1, 0.8, l));
  if (uComic > 0.5) {
    // ink outlines from depth discontinuities, posterised tones, halftone in shadows
    vec2 px = 1.0 / uRes;
    float c0 = linDepth(texture2D(tDepth, uv).r);
    float e = 0.0;
    for (int k = 0; k < 4; k++) {
      vec2 o = (k == 0 ? vec2(1, 0) : k == 1 ? vec2(-1, 0) : k == 2 ? vec2(0, 1) : vec2(0, -1)) * px * 1.5;
      float dz = linDepth(texture2D(tDepth, uv + o).r);
      e = max(e, abs(dz - c0) / max(c0, 1.0));
    }
    float ink = smoothstep(0.04, 0.12, e) * (1.0 - smoothstep(600.0, 2500.0, c0));
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 post = floor(col * 5.0 + 0.5) / 5.0;
    col = mix(col, post, 0.55);
    float ang = 0.785;
    vec2 hp = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * (uv * uRes) / 6.0;
    float dotd = length(fract(hp) - 0.5);
    float rad = sqrt(clamp(1.0 - lum * 1.6, 0.0, 1.0)) * 0.55;
    col *= mix(1.0, 0.55, (1.0 - smoothstep(rad - 0.08, rad, dotd)) * step(0.02, rad));
    col = mix(col, vec3(0.03, 0.02, 0.05), ink);
    col = mix(col, col * vec3(1.05, 0.97, 1.03), 0.5);
  }
  // hit / collect flash
  col = mix(col, uFlashCol, uFlash);
  // vignette
  vec2 vq = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  col *= 1.0 - uVignette * smoothstep(0.35, 1.1, length(vq));
  if (uLetterbox > 0.0 && abs(uv.y - 0.5) > 0.5 - uLetterbox) col = vec3(0.0);
  col = toSRGB(col);
  col += (hash(uv * uRes + fract(uTime) * 91.0) - 0.5) * (uGrain + 1.0 / 255.0);
  gl_FragColor = vec4(col, 1.0);
}`;

const FXAA = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uOn; uniform float uSharpen;
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec3 M = texture2D(tSrc, vUv).rgb;
  if (uOn < 0.5) { gl_FragColor = vec4(M, 1.0); return; }
  vec3 NW = texture2D(tSrc, vUv + vec2(-1, -1) * uTexel).rgb, NE = texture2D(tSrc, vUv + vec2(1, -1) * uTexel).rgb;
  vec3 SW = texture2D(tSrc, vUv + vec2(-1, 1) * uTexel).rgb, SE = texture2D(tSrc, vUv + vec2(1, 1) * uTexel).rgb;
  float lNW = lum(NW), lNE = lum(NE), lSW = lum(SW), lSE = lum(SE), lM = lum(M);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
  dir = clamp(dir * rcp, -8.0, 8.0) * uTexel;
  vec3 A = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 B = A * 0.5 + 0.25 * (texture2D(tSrc, vUv - dir * 0.5).rgb + texture2D(tSrc, vUv + dir * 0.5).rgb);
  float lB = lum(B);
  vec3 c = (lB < lMin || lB > lMax) ? A : B;
  // light sharpening to offset the upscale blur
  vec3 blur = (NW + NE + SW + SE) * 0.25;
  c += (M - blur) * uSharpen;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class Post {
  constructor(renderer) {
    this.r = renderer;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.fs = new THREE.Scene();
    this.fs.add(this.quad);
    const mk = (fs, u) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false });
    this.down = mk(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uThreshold: { value: 1.2 } });
    this.up = mk(UP, { tSrc: { value: null }, tPrev: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 }, uMix: { value: 1 } });
    this.rays = mk(RAYS, { tScene: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector3() }, uAspect: { value: 1 }, uSunCol: { value: new THREE.Color() } });
    this.comp = mk(COMPOSITE, {
      tScene: { value: null }, tBloom: { value: null }, tRays: { value: null }, tDepth: { value: null },
      uRes: { value: new THREE.Vector2() }, uTime: { value: 0 }, uExposure: { value: 1 }, uBloom: { value: 0.06 },
      uRays: { value: 0.5 }, uSpeed: { value: 0 }, uCA: { value: 1 }, uVignette: { value: 0.35 }, uGrain: { value: 0.012 },
      uSat: { value: 1.08 }, uContrast: { value: 1.06 }, uComic: { value: 0 }, uWarm: { value: 0.6 },
      uNear: { value: 0.1 }, uFar: { value: 1000 }, uBlurCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uFlash: { value: 0 }, uFlashCol: { value: new THREE.Color(1, 1, 1) }, uLetterbox: { value: 0 },
    });
    Object.assign(this.comp.uniforms, {
      tAO: { value: null }, uAOTexel: { value: new THREE.Vector2() }, uAO: { value: 0 },
      tAdapt: { value: null }, uAdapt: { value: 0 }, uKey: { value: 0.2 }, uTonemap: { value: 0 },
    });
    this.ssao = mk(SSAO, { tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() }, uProjY: { value: 1 }, uTime: { value: 0 } });
    this.lum = mk(LUM, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2(1 / 32, 1 / 18) } });
    this.adapt = mk(ADAPT, { tLum: { value: null }, tPrev: { value: null }, uRate: { value: 0.05 }, uGrid: { value: new THREE.Vector2(32, 18) } });
    const small = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    this.lumRT = small(32, 18);
    this.adaptRT = [small(1, 1), small(1, 1)];
    this.fxaa = mk(FXAA, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uOn: { value: 1 }, uSharpen: { value: 0 } });
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
    this.samples = 4;
    this.scale = 1;
    this.opts = { bloom: true, rays: true, fxaa: true, ao: false, adapt: false };
    this.w = this.h = 0;
  }

  rt(w, h, opts = {}) {
    return new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: !!opts.depth, samples: opts.samples || 0, generateMipmaps: false,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
      depthTexture: opts.depth ? new THREE.DepthTexture(w, h, THREE.UnsignedIntType) : null,
    });
  }

  /** width/height of the canvas drawing buffer; scale = internal render scale */
  setSize(w, h, scale = this.scale, samples = this.samples) {
    const iw = Math.max(64, Math.round(w * scale)), ih = Math.max(64, Math.round(h * scale));
    if (iw === this.w && ih === this.h && samples === this.samples && this.sceneRT) { this.cw = w; this.ch = h; return; }
    this.dispose();
    this.cw = w; this.ch = h; this.w = iw; this.h = ih; this.scale = scale; this.samples = samples;
    this.sceneRT = this.rt(iw, ih, { depth: true, samples });
    this.mips = [];
    let mw = iw >> 1, mh = ih >> 1;
    for (let i = 0; i < 6 && mw >= 4 && mh >= 4; i++) { this.mips.push(this.rt(mw, mh)); mw >>= 1; mh >>= 1; }
    this.ups = this.mips.slice(0, -1).map((m) => this.rt(m.width, m.height));
    this.raysRT = this.rt(Math.max(4, iw >> 2), Math.max(4, ih >> 2));
    this.aoRT = this.rt(Math.max(4, iw >> 1), Math.max(4, ih >> 1));
    this.ldr = new THREE.WebGLRenderTarget(iw, ih, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  }

  dispose() {
    for (const t of [this.sceneRT, this.raysRT, this.aoRT, this.ldr, ...(this.mips || []), ...(this.ups || [])]) if (t) { t.depthTexture?.dispose(); t.dispose(); }
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.fs, this.cam);
  }

  /** render the scene into the HDR target (call pre() for extra passes first) */
  renderScene(scene, camera) {
    this.r.setRenderTarget(this.sceneRT);
    this.r.render(scene, camera);
  }

  finish(camera, p) {
    const c = this.comp.uniforms;
    // bloom chain
    if (this.opts.bloom && this.mips.length > 2) {
      let src = this.sceneRT.texture;
      for (let i = 0; i < this.mips.length; i++) {
        this.down.uniforms.tSrc.value = src;
        const sw = i === 0 ? this.w : this.mips[i - 1].width, sh = i === 0 ? this.h : this.mips[i - 1].height;
        this.down.uniforms.uTexel.value.set(1 / sw, 1 / sh);
        this.down.uniforms.uFirst.value = i === 0 ? 1 : 0;
        this.pass(this.down, this.mips[i]);
        src = this.mips[i].texture;
      }
      let prev = this.mips[this.mips.length - 1].texture;
      for (let i = this.mips.length - 2; i >= 0; i--) {
        this.up.uniforms.tSrc.value = prev;
        this.up.uniforms.tPrev.value = this.mips[i].texture;
        this.up.uniforms.uTexel.value.set(1 / this.mips[i + 1].width, 1 / this.mips[i + 1].height);
        this.up.uniforms.uMix.value = 1.0;
        this.pass(this.up, this.ups[i]);
        prev = this.ups[i].texture;
      }
      c.tBloom.value = prev;
    } else c.tBloom.value = this.black;
    // god rays
    if (this.opts.rays && p.sunScreen.z > 0) {
      const u = this.rays.uniforms;
      u.tScene.value = this.sceneRT.texture; u.tDepth.value = this.sceneRT.depthTexture;
      u.uSun.value.copy(p.sunScreen); u.uAspect.value = this.w / this.h;
      this.pass(this.rays, this.raysRT);
      c.tRays.value = this.raysRT.texture;
    } else c.tRays.value = this.black;
    // ambient occlusion
    if (this.opts.ao) {
      const u = this.ssao.uniforms;
      u.tDepth.value = this.sceneRT.depthTexture;
      u.uProjInv.value.copy(camera.projectionMatrixInverse);
      u.uProjY.value = camera.projectionMatrix.elements[5];
      u.uTexel.value.set(1 / this.aoRT.width, 1 / this.aoRT.height);
      this.pass(this.ssao, this.aoRT);
      c.tAO.value = this.aoRT.texture;
      c.uAOTexel.value.set(1 / this.aoRT.width, 1 / this.aoRT.height);
    } else c.uAO.value = 0;
    // eye adaptation
    if (this.opts.adapt) {
      this.lum.uniforms.tSrc.value = this.sceneRT.texture;
      this.pass(this.lum, this.lumRT);
      const [prev, next] = this.adaptRT;
      this.adapt.uniforms.tLum.value = this.lumRT.texture;
      this.adapt.uniforms.tPrev.value = prev.texture;
      this.adapt.uniforms.uRate.value = 1 - Math.exp(-(p.dt ?? 1 / 60) * 1.6);
      this.pass(this.adapt, next);
      this.adaptRT = [next, prev];
      c.tAdapt.value = next.texture;
    } else c.uAdapt.value = 0;
    c.tScene.value = this.sceneRT.texture;
    c.tDepth.value = this.sceneRT.depthTexture;
    c.uRes.value.set(this.w, this.h);
    c.uNear.value = camera.near; c.uFar.value = camera.far;
    this.pass(this.comp, this.ldr);
    this.fxaa.uniforms.tSrc.value = this.ldr.texture;
    this.fxaa.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
    this.fxaa.uniforms.uOn.value = this.opts.fxaa ? 1 : 0;
    this.fxaa.uniforms.uSharpen.value = this.scale < 0.95 ? 0.35 : 0.1;
    this.pass(this.fxaa, null);
  }
}
