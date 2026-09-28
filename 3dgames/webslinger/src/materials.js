// Materials: MeshStandardMaterial patched with procedural facades (interior-mapped
// windows, reflective curtain walls with a fake skyline in their reflections, lit
// rooms/shops/crowns at night), streets with markings, water, trees, lamps.
// Also replaces three's fog with height fog whose colour comes from the sky LUT
// (sky.js), so buildings dissolve into exactly the sky colour behind them.
import * as THREE from "three";
import { G } from "./city.js";

export const U = {
  uTime: { value: 0 },
  uNight: { value: 0 },          // 0 day .. 1 night (window/street lights)
  uDayAmb: { value: 1 },         // daylight level for interiors
  uLitShare: { value: 0.55 },
  uInterior: { value: 1 },       // interior mapping on/off (quality)
  uWet: { value: 0 },            // wet streets
  uSkyLUT: { value: null },      // equirect sky radiance (sky.js)
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunCol: { value: new THREE.Color(1, 1, 1) },
  uFogFalloff: { value: 0.0035 },
  uFogBoost: { value: 1 },
  uHorizon: { value: new THREE.Color(0.5, 0.55, 0.6) },
  uReflTex: { value: null },     // planar water reflection (optional)
  uReflOn: { value: 0 },
  uReflMat: { value: new THREE.Matrix4() },
};

export const GLSL_COMMON = /* glsl */`
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float h11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
float fbm2(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * vn2(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
vec2 skyUV(vec3 d){ float u = atan(d.z, d.x) / 6.2831853 + 0.5; float y = clamp(d.y, -1.0, 1.0);
  float v = 0.5 + 0.5 * sign(y) * sqrt(abs(y)); return vec2(u, v); }
`;

// ---- fog: height fog coloured by the sky LUT --------------------------------
THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
varying vec3 vFogW;
#endif`;
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
{
  vec4 fw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  fw = instanceMatrix * fw;
  #endif
  vFogW = (modelMatrix * fw).xyz;
}
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
uniform vec3 fogColor;
uniform float fogDensity;
uniform float uFogFalloff;
uniform float uFogBoost;
uniform sampler2D uSkyLUT;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
varying vec3 vFogW;
vec2 fogSkyUV(vec3 d){ float u = atan(d.z, d.x) / 6.2831853 + 0.5; float y = clamp(d.y, -1.0, 1.0);
  return vec2(u, 0.5 + 0.5 * sign(y) * sqrt(abs(y))); }
vec3 applyFog(vec3 col, vec3 wp) {
  vec3 rd = wp - cameraPosition;
  float len = length(rd); rd /= len;
  float b = uFogFalloff;
  float fy = rd.y; if (abs(fy) < 1e-4) fy = 1e-4;
  float h0 = max(cameraPosition.y, -5.0);
  float amt = fogDensity * uFogBoost * exp(-h0 * b) * (1.0 - exp(-len * fy * b)) / (fy * b);
  // always fully fogged near the far plane so geometry dissolves into the sky dome
  float f = max(1.0 - exp(-amt), smoothstep(3000.0, 8000.0, len));
  vec3 sky = texture2D(uSkyLUT, fogSkyUV(normalize(vec3(rd.x, max(rd.y, 0.015), rd.z)))).rgb;
  // in-scattered sun glow (forward scattering)
  float mu = max(dot(rd, uSunDir), 0.0);
  sky += uSunCol * pow(mu, 12.0) * 0.12;
  return mix(col, sky, f);
}
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vFogW);
#endif`;

function withUniforms(shader) {
  Object.assign(shader.uniforms, U);
  // helpers go *before* three's common chunk so every later insertion can use them
  shader.fragmentShader = shader.fragmentShader.replace("#include <common>", GLSL_COMMON + "\n#include <common>");
}
/** Any standard material that should get the custom fog. */
export function fogPatch(m, key) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (s, r) => { if (prev) prev(s, r); if (!s.uniforms.uSkyLUT) withUniforms(s); };
  m.customProgramCacheKey = () => key;
  return m;
}

// ---- buildings ---------------------------------------------------------------
const BUILDING_FRAG = /* glsl */`
uniform float uTime;
uniform float uNight;
uniform float uDayAmb;
uniform float uLitShare;
uniform float uInterior;
uniform float uWet;
uniform vec3 uHorizon;
varying vec3 vWPos;
varying vec3 vWN;
varying vec4 vData;
float gWin = 0.0, gRough = 0.85, gMetal = 0.0, gRefl = 0.0;
vec3 gEmit = vec3(0.0);
vec2 gJit = vec2(0.0);

vec3 roomColor(vec2 id, vec2 f, vec3 V, vec3 T, vec3 N, vec2 cs, float depth, float seed, float litBoost, out float lit) {
  float h = h12(id + seed * 57.31);
  float h2 = h12(id * 1.37 + seed * 11.0 + 3.1);
  lit = step(h, clamp(uLitShare * litBoost, 0.0, 1.0));
  vec3 rd = vec3(dot(V, T) / cs.x, V.y / cs.y, max(dot(V, -N), 0.02) / depth);
  vec3 ro = vec3(f, 0.0);
  vec3 tw = (step(0.0, rd) - ro) / rd;
  float t = min(min(tw.x, tw.y), tw.z);
  vec3 hp = ro + rd * t;
  vec3 wall = mix(vec3(0.62, 0.56, 0.48), vec3(0.78, 0.8, 0.82), h2);
  wall = mix(wall, vec3(0.55, 0.62, 0.6), step(0.8, fract(h2 * 7.3)));
  vec3 c;
  bool ceil = false;
  if (t == tw.z) c = wall * 0.85;
  else if (t == tw.y) { if (rd.y > 0.0) { c = vec3(0.9, 0.9, 0.88); ceil = true; } else c = mix(vec3(0.22, 0.17, 0.13), vec3(0.35, 0.35, 0.38), step(0.5, h2)); }
  else c = wall * 0.95;
  // furniture / partition silhouettes at mid depth
  float tf = (0.45 + 0.2 * fract(h * 5.1)) / rd.z;
  vec3 fp = ro + rd * tf;
  if (tf < t && fp.y < 0.3 + 0.15 * fract(h * 9.7) && fp.x > 0.1 + 0.3 * fract(h * 3.3) && fp.x < 0.55 + 0.4 * fract(h * 7.9))
    c = vec3(0.1, 0.09, 0.08);
  float ao = mix(1.0, 0.45, hp.z) * (0.75 + 0.25 * hp.y);
  vec3 lc = mix(vec3(1.0, 0.7, 0.42), vec3(0.8, 0.88, 1.0), step(0.72, h2));
  vec3 col = c * ao * uDayAmb * 0.2;
  vec3 nightCol = c * ao * lc * 0.9;
  if (ceil) nightCol += lc * 1.1 * smoothstep(0.35, 0.3, abs(hp.x - 0.5)) * smoothstep(0.4, 0.3, abs(hp.z - 0.5));
  col += nightCol * lit * uNight;
  // dim blue TV-ish glow in a few unlit rooms
  col += vec3(0.1, 0.16, 0.3) * step(0.93, fract(h * 31.0)) * (1.0 - lit) * uNight * (0.6 + 0.4 * sin(uTime * 3.0 + h * 40.0));
  // blinds / curtains from the top
  float bl = fract(h * 13.7);
  float blind = bl < 0.45 ? bl * 1.4 : 0.0;
  if (f.y > 1.0 - blind) {
    vec3 bc = mix(vec3(0.72, 0.68, 0.6), vec3(0.4, 0.42, 0.45), step(0.5, fract(h * 3.1)));
    float slat = 0.85 + 0.15 * step(0.5, fract(f.y * cs.y * 6.0));
    col = bc * slat * (uDayAmb * 0.22 + lit * uNight * lc * 1.2);
  }
  return col;
}

void facadeWalls(int st, vec3 N, float seed, float base, float top, inout vec3 col) {
  vec3 T = vec3(-N.z, 0.0, N.x);
  float u = dot(vWPos, T) + seed * 13.0;
  float y = vWPos.y;
  vec2 cs; vec4 win; float depth = 1.4; float litBoost = 1.0;
  if (st == 1) { cs = vec2(1.5 + floor(seed * 3.0) * 0.35, 3.8); win = vec4(0.035, 0.965, 0.26, 0.985); depth = 2.6; }
  else if (st == 2) { cs = vec2(3.2 + floor(seed * 2.0) * 0.5, 3.8); win = vec4(0.27, 0.73, 0.26, 0.84); depth = 1.3; }
  else if (st == 3) { cs = vec2(2.7, 3.4); win = vec4(0.3, 0.7, 0.24, 0.8); depth = 1.1; }
  else if (st == 4) { cs = vec2(1.7, 3.8); win = vec4(0.03, 0.97, 0.4, 0.9); depth = 2.2; }
  else { cs = vec2(5.0 + seed * 3.0, 6.0); win = vec4(0.06, 0.94, 0.04, 0.72); depth = 1.6; litBoost = 1.7; }
  vec2 cell = vec2(u / cs.x, y / cs.y);
  vec2 id = floor(cell), f = fract(cell);
  vec2 fw = fwidth(cell);
  float far = smoothstep(0.25, 0.6, max(fw.x, fw.y));
  float wx = smoothstep(win.x - fw.x, win.x + fw.x, f.x) * (1.0 - smoothstep(win.y - fw.x, win.y + fw.x, f.x));
  float wy = smoothstep(win.z - fw.y, win.z + fw.y, f.y) * (1.0 - smoothstep(win.w - fw.y, win.w + fw.y, f.y));
  float cover = (win.y - win.x) * (win.w - win.z);
  float mask = mix(wx * wy, cover, far);
  if (st == 5 && y > 6.0) mask = 0.0;
  // wall surface
  vec3 wallc = col;
  float n = vn2(vWPos.xz * 0.35 + vec2(y * 0.5, 0.0)) * 0.5 + vn2(vec2(u, y) * 0.08) * 0.5;
  if (st == 3) {
    // brick courses, stone lintels/sills
    vec2 bq = vec2(u / 0.24 + 0.5 * floor(y / 0.08), y / 0.08);
    vec2 bw = fwidth(bq);
    float mort = max(smoothstep(0.9 - bw.x, 0.9, fract(bq.x)), smoothstep(0.82 - bw.y, 0.82, fract(bq.y)));
    mort *= 1.0 - smoothstep(0.3, 0.7, max(bw.x, bw.y));
    wallc *= (0.85 + 0.3 * h12(floor(bq))) * mix(1.0, 0.9, far);
    wallc = mix(wallc, vec3(0.5, 0.48, 0.44), mort * 0.6);
    float lint = step(win.x - 0.04, f.x) * step(f.x, win.y + 0.04) * (step(win.w, f.y) * step(f.y, win.w + 0.06) + step(win.z - 0.04, f.y) * step(f.y, win.z));
    wallc = mix(wallc, vec3(0.62, 0.58, 0.5), lint * (1.0 - far));
  } else if (st == 2) {
    // limestone: joints, pilasters between window bays
    float pil = smoothstep(0.08, 0.02, abs(f.x - 0.0)) + smoothstep(0.92, 0.98, f.x);
    wallc *= 0.9 + 0.2 * n + 0.08 * pil * (1.0 - far);
    float joint = smoothstep(0.97, 1.0, fract(y / 0.95)) * (1.0 - far);
    wallc *= 1.0 - 0.15 * joint;
    // recess shadow at the top of each window
    float rec = (1.0 - smoothstep(win.w - 0.06, win.w, f.y)) * smoothstep(win.w - 0.12, win.w - 0.06, f.y);
    mask *= 1.0; wallc *= 1.0;
    gEmit += vec3(0.0);
    col = wallc;
    col *= 1.0 - 0.25 * rec * wx * (1.0 - far);
  } else if (st == 1) {
    // spandrel panels: tinted opaque glass, same reflectivity
    wallc = col * (0.55 + 0.2 * h11(id.y + seed * 7.0));
  } else if (st == 4) {
    wallc *= 0.88 + 0.18 * n;
    float band = smoothstep(win.z - 0.02, win.z, f.y) * (1.0 - smoothstep(win.w, win.w + 0.02, f.y));
    wallc *= 1.0 - 0.2 * band;
  } else if (st == 5) {
    wallc *= 0.8 + 0.2 * n;
  }
  if (st != 2) col = wallc;
  // weathering streaks + ground-contact occlusion
  float streak = vn2(vec2(u * 0.6, y * 0.02 + seed * 9.0));
  col *= 0.92 + 0.12 * streak;
  col *= mix(0.55, 1.0, smoothstep(0.0, 3.5, y - base));
  // glass
  float refl = st == 1 ? 1.0 : mask;
  gRefl = refl;
  vec3 V = normalize(vWPos - cameraPosition);
  vec3 room = vec3(0.0);
  float lit = 0.0;
  if (mask > 0.001) {
    if (uInterior > 0.5 && far < 0.99) {
      room = roomColor(id, clamp((f - win.xz) / (win.yw - win.xz), 0.0, 1.0), V, T, N,
        cs * vec2(win.y - win.x, win.w - win.z), depth * cs.x, seed, litBoost, lit);
    } else {
      float hh = h12(id + seed * 57.31);
      lit = step(hh, uLitShare * litBoost);
      room = vec3(0.35, 0.33, 0.3) * uDayAmb * 0.3 + vec3(1.0, 0.72, 0.45) * lit * uNight * 0.9;
    }
    // far away: average lit share instead of per-window (no shimmer)
    vec3 avg = vec3(0.3, 0.29, 0.27) * uDayAmb * 0.3 + vec3(1.0, 0.72, 0.45) * uLitShare * litBoost * uNight * 0.45;
    room = mix(room, avg, far);
  }
  // glass: interiors seen through it fade out at grazing angles (Fresnel) where the reflection takes over
  float ndv = clamp(dot(-V, N), 0.0, 1.0);
  float fres = 0.06 + 0.94 * pow(1.0 - ndv, 4.0);
  float tintVis = (st == 1 ? 0.6 : 0.85) * (1.0 - fres);
  // metallic glass: albedo acts as reflectance (F0), so keep it mid-grey-blue, not black
  vec3 glassTint = st == 1 ? mix(vec3(0.42, 0.48, 0.54), col, 0.3) : vec3(0.3, 0.34, 0.38);
  // shop signage band above storefronts (colourful at night)
  if (st == 5 && y < 6.0) {
    float band = step(0.76, f.y) * step(f.y, 0.92);
    float hue = h12(id + seed);
    vec3 sc = 0.5 + 0.5 * cos(6.2831 * (hue + vec3(0.0, 0.33, 0.67)));
    col = mix(col, sc * 0.3, band);
    gEmit += sc * band * (0.15 + 2.4 * uNight) * step(0.35, fract(hue * 7.0));
  }
  if (st == 1) {
    // curtain wall: spandrels are opaque tinted glass, windows clear glass; all mirror-like
    col = mix(col * 0.6 + glassTint * 0.4, glassTint, mask);
    gEmit += room * mask * tintVis;
    gRough = 0.03 + 0.06 * h12(id * 0.37);
    gMetal = mix(0.3, 1.0, mask);
    gRough = mix(0.25, gRough, mask);
  } else {
    col = mix(col, glassTint, mask);
    gEmit += room * mask * tintVis;
    gRough = mix(st == 3 ? 0.92 : 0.8, 0.05, mask);
    gMetal = mask;
  }
  gWin = mask;
  // panel waviness in reflections
  gJit = (vec2(h12(id + 0.5), h12(id + 7.5)) - 0.5) * 0.035 * (1.0 - far);
  // lit crowns on tall towers at night
  if (top > 150.0 && y > top - 14.0 && fract(seed * 5.3) > 0.7) {
    float hue = fract(seed * 3.7);
    // mostly warm white floodlighting, the odd pastel accent
    vec3 cc = mix(vec3(1.0, 0.85, 0.62), 0.75 + 0.25 * cos(6.2831 * (hue + vec3(0.0, 0.33, 0.67))), step(0.6, hue));
    gEmit += cc * uNight * 0.22 * smoothstep(top - 14.0, top - 2.0, y) * (0.6 + 0.4 * mask);
  }
}

// lamp positions are periodic along every road, so their light pools are analytic
float lampPools(vec3 p) {
  float gx = p.x - (${G.X0.toFixed(2)});
  float gz = p.z - (${G.Z0.toFixed(2)});
  float dA = gx - ${G.PX.toFixed(1)} * floor(gx / ${G.PX.toFixed(1)} + 0.5);
  float dS = gz - ${G.PZ.toFixed(1)} * floor(gz / ${G.PZ.toFixed(1)} + 0.5);
  float la = abs(abs(dA) - ${(G.AW / 2 - 2.2).toFixed(2)});
  float za = mod(p.z - ${(G.Z0 - G.SW / 2 + 14).toFixed(2)}, 32.0) - 16.0;
  float ls = abs(abs(dS) - ${(G.SW / 2 - 2.2).toFixed(2)});
  float xs = mod(p.x - ${(G.X0 + 18).toFixed(2)}, 36.0) - 18.0;
  float a = exp(-(la * la + za * za) / 60.0) * step(abs(dA), ${(G.AW / 2 + 1).toFixed(1)});
  float s = exp(-(ls * ls + xs * xs) / 60.0) * step(abs(dS), ${(G.SW / 2 + 1).toFixed(1)});
  return max(a, s);
}

void surfaceTop(int st, float seed, inout vec3 col) {
  vec2 p = vWPos.xz;
  float n = fbm2(p * 0.4);
  if (st == 7) {
    // sidewalk slabs, kerb darker, lamp pools
    vec2 q = p / 1.6; vec2 fw = fwidth(q);
    float j = max(smoothstep(0.95 - fw.x, 0.95, fract(q.x)), smoothstep(0.95 - fw.y, 0.95, fract(q.y))) * (1.0 - smoothstep(0.2, 0.5, max(fw.x, fw.y)));
    col *= (0.82 + 0.25 * n) * (1.0 - 0.25 * j);
    col *= 0.85 + 0.15 * h12(floor(q));
    gRough = mix(0.85, 0.3, uWet * 0.8);
    gEmit += vec3(1.0, 0.68, 0.38) * lampPools(vWPos) * uNight * 0.55;
  } else if (st == 9) {
    // grass with mowing stripes, dirt paths
    float stripes = step(0.5, fract(p.x / 8.0));
    col *= 0.7 + 0.5 * n + 0.06 * stripes;
    col = mix(col, vec3(0.3, 0.42, 0.14), smoothstep(0.55, 0.8, fbm2(p * 0.03)) * 0.5);
    float path = abs(sin((p.x - ${G.PARK.x0.toFixed(1)}) / 70.0 + cos(p.y / 90.0) * 1.5));
    col = mix(col, vec3(0.42, 0.36, 0.28), smoothstep(0.07, 0.04, path));
    gRough = 0.95;
  } else if (st == 10) {
    col *= 0.85 + 0.2 * n;
    gRough = 0.9;
  } else {
    // rooftops: tar/gravel, darker seams, occasional white membrane
    vec3 roof = mix(vec3(0.16, 0.155, 0.15), vec3(0.3, 0.29, 0.27), n);
    if (fract(seed * 17.0) > 0.7) roof = mix(vec3(0.55, 0.55, 0.53), vec3(0.62, 0.62, 0.6), n);
    if (st == 0 || st == 6 || st == 8 || st == 12) roof = col * (0.8 + 0.3 * n);
    vec2 q = p / 3.0;
    float seam = smoothstep(0.96, 1.0, fract(q.x)) * (1.0 - smoothstep(0.1, 0.4, fwidth(q.x)));
    col = roof * (1.0 - 0.3 * seam);
    gRough = 0.9;
    if (st == 8) { gRough = 0.35; gMetal = 0.8; }
  }
}
`;

export function buildingMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    withUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec4 aData;
varying vec3 vWPos;
varying vec3 vWN;
varying vec4 vData;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWN = normal;
vData = aData;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${BUILDING_FRAG}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
{
  vec3 N = normalize(vWN);
  int st = int(vData.x + 0.5);
  float seed = vData.y;
  vec3 col = diffuseColor.rgb * (0.9 + 0.2 * fract(seed * 7.13));
  if (abs(N.y) < 0.5) {
    if (st >= 1 && st <= 5) facadeWalls(st, N, seed, vData.z, vData.w, col);
    else if (st == 6) {
      float l = smoothstep(0.4, 0.5, fract(vWPos.y / 0.5)) * (1.0 - smoothstep(0.3, 0.6, fwidth(vWPos.y / 0.5)));
      col *= 0.6 + 0.3 * l; gRough = 0.6; gMetal = 0.3;
    } else if (st == 8) { gRough = 0.3; gMetal = 0.85; col *= 0.9 + 0.1 * vn2(vWPos.xy * vec2(0.5, 3.0)); }
    else if (st == 7) {
      col *= 0.7;
      gEmit += vec3(1.0, 0.68, 0.38) * lampPools(vWPos) * uNight * 0.2;
    }
    else if (st == 10) {
      vec2 q = vec2(dot(vWPos.xz, vec2(-N.z, N.x)) / 1.8 + 0.5 * floor(vWPos.y / 0.7), vWPos.y / 0.7);
      col *= (0.8 + 0.25 * h12(floor(q))) * (0.75 + 0.25 * smoothstep(-1.6, 0.0, vWPos.y));
      gRough = 0.92;
    } else {
      col *= 0.9 + 0.15 * vn2(vWPos.xz * 0.5 + vWPos.y);
      col *= mix(0.6, 1.0, smoothstep(0.0, 2.5, vWPos.y - vData.z));
    }
  } else if (N.y > 0.5) {
    surfaceTop(st, seed, col);
  } else col *= 0.4;
  diffuseColor.rgb = col;
}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = gRough;`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>
metalnessFactor = gMetal;`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
if (gRefl > 0.0) {
  vec3 Nw = normalize(vWN);
  vec3 Tw = vec3(-Nw.z, 0.0, Nw.x);
  vec3 jit = (Tw * gJit.x + vec3(0.0, gJit.y, 0.0));
  normal = normalize(normal + (viewMatrix * vec4(jit, 0.0)).xyz);
}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
totalEmissiveRadiance += gEmit;`)
      .replace("#include <lights_fragment_maps>", `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
if (gRefl > 0.0) {
  // reflections of a fake skyline + street below the horizon, so glass shows a city, not just sky
  vec3 Vw = normalize(vWPos - cameraPosition);
  vec3 Nw = normalize(vWN);
  Nw = normalize(Nw + vec3(-Nw.z, 0.0, Nw.x) * gJit.x + vec3(0.0, gJit.y, 0.0));
  vec3 R = reflect(Vw, Nw);
  float az = atan(R.z, R.x) * 9.5492966 + dot(vWPos.xz, vec2(0.0021, 0.0017));
  float fid = floor(az * 4.0);
  float hgt = (0.06 + 0.42 * pow(h11(fid * 1.7 + 3.0), 2.0)) * (1.0 - clamp(vWPos.y / 520.0, 0.0, 0.85));
  float city = smoothstep(hgt + 0.004, hgt - 0.004, R.y);
  vec2 wq = vec2(az * 16.0, R.y * 80.0);
  float wl = step(h12(floor(wq) + fid), uLitShare * 0.5) * step(0.25, fract(wq.x)) * step(0.3, fract(wq.y));
  vec3 cityCol = uHorizon * mix(0.75, 0.12, uNight) * (0.45 + 0.9 * h11(fid)) + uSunCol * 0.05 * (1.0 - uNight) * step(0.6, h11(fid * 3.1)) * max(dot(normalize(R.xz + 1e-4), -normalize(uSunDir.xz + 1e-4)), 0.0) + vec3(1.0, 0.7, 0.42) * wl * uNight * 0.9;
  cityCol = mix(cityCol, uHorizon * 0.8, smoothstep(0.0, -0.4, R.y) * 0.5);
  radiance = mix(radiance, cityCol, city * gRefl);
}
#endif`);
  };
  m.customProgramCacheKey = () => "ws-building";
  return m;
}

// ---- streets -----------------------------------------------------------------
export function streetMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.9 });
  const PX = G.PX.toFixed(1), PZ = G.PZ.toFixed(1);
  m.onBeforeCompile = (shader) => {
    withUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uNight;
uniform float uWet;
varying vec3 vWPos;
float gRough = 0.9;
vec3 gEmit = vec3(0.0);
${BUILDING_FRAG.match(/float lampPools[\s\S]*?\n}\n/)[0]}
float dash(float a, float per, float on){ return step(fract(a / per), on / per); }
float lineAA(float d, float w){ float fw = fwidth(d) + 1e-4; return 1.0 - smoothstep(w - fw, w + fw, abs(d)); }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
{
  vec2 p = vWPos.xz;
  float gx = p.x - (${G.X0.toFixed(2)}), gz = p.y - (${G.Z0.toFixed(2)});
  float dA = gx - ${PX} * floor(gx / ${PX} + 0.5);   // from avenue centreline
  float dS = gz - ${PZ} * floor(gz / ${PZ} + 0.5);   // from street centreline
  float n = fbm2(p * 0.7);
  float big = vn2(p * 0.03);
  vec3 asph = vec3(0.045, 0.045, 0.048) * (0.75 + 0.45 * n) * (0.85 + 0.3 * big);
  // patch repairs
  asph *= 1.0 - 0.25 * smoothstep(0.62, 0.66, vn2(p * 0.08 + 31.0));
  float roadA = ${(G.AW / 2 - G.WALK).toFixed(1)}, roadS = ${(G.SW / 2 - G.WALK).toFixed(1)};
  bool onA = abs(dA) < roadA + 0.5, onS = abs(dS) < roadS + 0.5;
  vec3 paint = vec3(0.0);
  float white = 0.0, yellow = 0.0;
  if (onA && !onS) {
    // avenue: double yellow centre, dashed lanes, tyre tracks
    yellow += lineAA(abs(dA) - 0.25, 0.09);
    white += (lineAA(abs(dA) - 4.0, 0.08) + lineAA(abs(dA) - 8.0, 0.08)) * dash(p.y, 12.0, 4.5);
    float zi = abs(dS) - roadS;
    white += step(zi, 4.5) * step(0.5, zi) * step(0.5, fract(dA / 1.1)) * step(abs(dA), roadA - 0.5);   // crosswalk
    white += lineAA(zi - 5.5, 0.2) * step(0.0, dA * sign(dS));   // stop line
    float tr = abs(mod(abs(dA), 4.0) - 2.0);
    asph *= 1.0 - 0.18 * smoothstep(0.9, 0.3, abs(tr - 0.9));
  } else if (onS && !onA) {
    yellow += lineAA(abs(dS) - 0.2, 0.08);
    float xi = abs(dA) - roadA;
    white += step(xi, 4.5) * step(0.5, xi) * step(0.5, fract(dS / 1.1)) * step(abs(dS), roadS - 0.5);
    white += lineAA(xi - 5.5, 0.2) * step(0.0, -dS * sign(dA));
  }
  float wear = 0.55 + 0.45 * vn2(p * 1.3);
  vec3 c = asph;
  c = mix(c, vec3(0.62, 0.6, 0.56), clamp(white, 0.0, 1.0) * wear);
  c = mix(c, vec3(0.6, 0.42, 0.08), clamp(yellow, 0.0, 1.0) * wear);
  // manholes
  vec2 mh = vec2(dA, mod(p.y, 37.0) - 18.5);
  c *= 1.0 - 0.4 * (1.0 - smoothstep(0.55, 0.6, length(mh - vec2(2.0, 0.0)))) * step(abs(dA), 12.0);
  // wet: puddles in low spots
  float puddle = smoothstep(0.55, 0.62, vn2(p * 0.12 + 7.0)) * uWet;
  c *= 1.0 - 0.35 * uWet;
  gRough = mix(0.92, 0.35, uWet) * (1.0 - puddle * 0.9) + puddle * 0.03;
  gEmit += vec3(1.0, 0.66, 0.36) * lampPools(vWPos) * uNight * 0.45 * (1.0 + uWet);
  diffuseColor.rgb = c;
}`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = gRough;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmit;");
  };
  m.customProgramCacheKey = () => "ws-street";
  return m;
}

// ---- water -------------------------------------------------------------------
export function waterNormals(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const waves = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 28; k++) {
    const kx = Math.round((rnd() - 0.5) * 18), ky = Math.round((rnd() - 0.5) * 18);
    if (!kx && !ky) continue;
    waves.push([kx, ky, rnd() * Math.PI * 2, 1 / Math.hypot(kx, ky)]);
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let dx = 0, dy = 0;
    for (const [kx, ky, ph, a] of waves) {
      const s = Math.cos(2 * Math.PI * (kx * x + ky * y) / size + ph) * a;
      dx += s * kx; dy += s * ky;
    }
    const v = new THREE.Vector3(-dx * 0.05, -dy * 0.05, 1).normalize();
    const i = (y * size + x) * 4;
    data[i] = (v.x * 0.5 + 0.5) * 255; data[i + 1] = (v.y * 0.5 + 0.5) * 255; data[i + 2] = (v.z * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export function waterMaterial() {
  const nrm = waterNormals();
  const m = new THREE.MeshStandardMaterial({ color: 0x0a1a20, roughness: 0.05, metalness: 0.0, normalMap: nrm });
  m.normalScale.set(0.35, 0.35);
  m.onBeforeCompile = (shader) => {
    withUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;\nvarying vec4 vReflPos;\nuniform mat4 uReflMat;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvReflPos = uReflMat * vec4(vWPos, 1.0);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uTime;
uniform float uNight;
uniform sampler2D uReflTex;
uniform float uReflOn;
varying vec3 vWPos;
varying vec4 vReflPos;
vec3 gWN = vec3(0.0, 1.0, 0.0);`)
      .replace("#include <normal_fragment_maps>", `{
  vec2 p = vWPos.xz;
  float dist = length(vWPos - cameraPosition);
  vec3 a = texture2D(normalMap, p / 90.0 + vec2(uTime * 0.006, uTime * 0.004)).xyz * 2.0 - 1.0;
  vec3 b = texture2D(normalMap, p / 23.0 - vec2(uTime * 0.011, -uTime * 0.007)).xyz * 2.0 - 1.0;
  vec3 c = texture2D(normalMap, p / 6.0 + vec2(uTime * 0.02, uTime * 0.017)).xyz * 2.0 - 1.0;
  vec2 d = (a.xy * 0.5 + b.xy * 0.35 + c.xy * 0.25 * (1.0 - smoothstep(60.0, 300.0, dist)));
  d *= mix(1.0, 0.35, smoothstep(200.0, 3000.0, dist));
  gWN = normalize(vec3(d.x, 1.0, d.y) * vec3(0.55, 1.0, 0.55));
  normal = normalize((viewMatrix * vec4(gWN, 0.0)).xyz);
}`)
      .replace("#include <lights_fragment_maps>", `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
if (uReflOn > 0.5) {
  vec2 ruv = vReflPos.xy / vReflPos.w + gWN.xz * 0.06;
  vec4 rc = texture2D(uReflTex, ruv);
  radiance = mix(radiance, rc.rgb, rc.a);
}
#endif`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
{
  // deep water tint: a little subsurface colour when looking down
  vec3 V = normalize(cameraPosition - vWPos);
  totalEmissiveRadiance += vec3(0.004, 0.012, 0.014) * (1.0 - uNight * 0.8) * V.y;
}`);
  };
  m.customProgramCacheKey = () => "ws-water";
  return m;
}

// ---- trees ------------------------------------------------------------------
export function treeMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: false });
  m.onBeforeCompile = (shader) => {
    withUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nattribute float aLeaf;\nvarying float vLeaf;\nvarying vec3 vLP;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vLeaf = aLeaf;
vLP = position;
#ifdef USE_INSTANCING
{
  vec3 ip = instanceMatrix[3].xyz;
  float sway = sin(uTime * 1.3 + ip.x * 0.05 + ip.z * 0.07) * 0.12 * aLeaf * max(position.y - 2.0, 0.0) / 6.0;
  transformed.x += sway; transformed.z += sway * 0.6;
}
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vLeaf;\nvarying vec3 vLP;")
      .replace("#include <color_fragment>", `#include <color_fragment>
{
  float n = vn2(vLP.xz * 1.7 + vLP.y * 2.0);
  diffuseColor.rgb *= mix(1.0, 0.6 + 0.7 * n, vLeaf);
  diffuseColor.rgb *= mix(1.0, 0.55 + 0.45 * smoothstep(1.5, 7.0, vLP.y), vLeaf);
}`);
  };
  m.customProgramCacheKey = () => "ws-tree";
  return m;
}

/** Emissive-at-night lamp heads, aircraft lights, car lights. vertex colour = lit colour. */
export function glowMaterial(kind) {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    withUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vIP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n#ifdef USE_INSTANCING\nvIP = instanceMatrix[3].xyz;\n#else\nvIP = vec3(0.0);\n#endif");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;\nuniform float uTime;\nvarying vec3 vIP;")
      .replace("#include <color_fragment>", `#include <color_fragment>
${kind === "blink" ? "diffuseColor.rgb *= 14.0 * (0.25 + 0.75 * uNight) * smoothstep(0.55, 0.6, fract(uTime * 0.7 + h12(vIP.xz) * 0.3));"
    : kind === "lamp" ? "diffuseColor.rgb = mix(vec3(0.5, 0.5, 0.48), diffuseColor.rgb * 9.0, uNight);"
      : "diffuseColor.rgb *= 1.0 + 7.0 * uNight;"}`);
  };
  m.customProgramCacheKey = () => "ws-glow-" + kind;
  return m;
}
