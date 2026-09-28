// Shader patches on top of MeshStandardMaterial: procedural windows (lit at
// night), roof snow, street-light glow on the ground, seasonal tree colours.
import * as THREE from "three";

export const shared = {
  uNight: { value: 0 },      // 0 day .. 1 full night (windows/streetlights)
  uSnow: { value: 0 },       // 0 .. 1 snow cover
  uTime: { value: 0 },
  uLitShare: { value: 0.5 }, // share of windows lit at night (drops late)
};

const HASH = /* glsl */`
float s3dHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float s3dNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(s3dHash(i), s3dHash(i + vec2(1.0, 0.0)), f.x),
             mix(s3dHash(i + vec2(0.0, 1.0)), s3dHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// anti-aliased 1 inside [a, b] (w = filter width in the same units)
float s3dBox(float x, float a, float b, float w) {
  return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x));
}`;

function srgbColors(shader) {
  shader.vertexShader = shader.vertexShader.replace("#include <color_vertex>",
    "#include <color_vertex>\n#if defined(USE_COLOR)\n vColor.rgb = pow(vColor.rgb, vec3(2.2));\n#endif");
}

export function buildingMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.0, flatShading: false });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    srgbColors(shader);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute float aFlags;
attribute float aSeed;
attribute vec2 aBase;
varying vec3 vWPos;
varying vec3 vWNrm;
varying vec2 vBase;
flat varying int vFlags;
varying float vSeed;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNrm = normal;
vBase = aBase;
vFlags = int(aFlags + 0.5);
vSeed = aSeed;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uNight;
uniform float uSnow;
uniform float uLitShare;
varying vec3 vWPos;
varying vec3 vWNrm;
varying vec2 vBase;
flat varying int vFlags;
varying float vSeed;
${HASH}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
vec3 bn = normalize(vWNrm);
float winMask = 0.0, winLit = 0.0, winFar = 0.0;
bool glassy = (vFlags & 4) != 0;
bool wall = abs(bn.y) < 0.35;
float hy = vWPos.y - vBase.x;          // height above the building's base
bool grounded = vBase.y > 0.5;          // base sits on the terrain (not a raised part)
float pxm = length(fwidth(vWPos));      // metres per pixel
diffuseColor.rgb *= 0.9 + 0.2 * vSeed;
vec2 tng = normalize(vec2(-bn.z, bn.x) + 1e-6);
float u = dot(vWPos.xz, tng);
if (wall) {
  // plaster blotches and rain streaks, only where they resolve
  float det = 1.0 - smoothstep(0.15, 1.2, pxm);
  if (det > 0.0) {
  float streak = s3dNoise(vec2(u * 1.3, vWPos.y * 0.06 + vSeed * 40.0));
  float blot = s3dNoise(vec2(u, vWPos.y) * 0.45 + vSeed * 13.0);
  diffuseColor.rgb *= 1.0 + det * ((streak - 0.5) * 0.14 + (blot - 0.5) * 0.12);
  }
  if (grounded) {
    diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(0.0, 2.2, hy));          // contact shadow
    diffuseColor.rgb *= 1.0 - 0.3 * (1.0 - smoothstep(0.55 - pxm, 0.55 + pxm, hy)); // plinth
  }
}
if (((vFlags & 2) != 0 || glassy) && wall) {
  float cw = glassy ? 1.6 : 2.7 + 0.9 * fract(vSeed * 7.13);   // bay width per building
  float fh = glassy ? 3.6 : 3.2;
  float gf = (grounded && !glassy) ? 4.2 : 0.0;                  // taller ground floor
  vec2 cell = vec2(u / cw, (hy - gf) / fh);
  vec2 f = fract(cell);
  vec2 w = fwidth(cell);
  winFar = smoothstep(0.3, 0.8, max(w.x, w.y));   // windows smaller than ~2 px
  float h = s3dHash(floor(cell) + vSeed * 91.7);
  float coverage = glassy ? 0.75 : 0.28;
  vec3 glass = glassy ? vec3(0.05, 0.08, 0.1) : vec3(0.025, 0.032, 0.04);
  float lit = step(h, uLitShare) * (0.6 + 0.8 * fract(h * 17.0));
  if (winFar > 0.999) {
    // windows below pixel size: average coverage only
    winMask = coverage;
    winLit = coverage * uLitShare * 0.9;
    diffuseColor.rgb = mix(diffuseColor.rgb, glass, coverage * (glassy ? 0.85 : 1.0));
  } else if (glassy) {
    float wx = s3dBox(f.x, 0.06, 0.94, w.x), wy = s3dBox(f.y, 0.1, 0.96, w.y);
    winMask = mix(wx * wy, coverage, winFar);
    winLit = mix(lit * wx * wy, coverage * uLitShare * 0.9, winFar);
    diffuseColor.rgb = mix(diffuseColor.rgb, glass, winMask * 0.85);
  } else if (hy >= gf) {
    float hw = 0.19 + 0.06 * fract(vSeed * 3.7);       // half window width (cell units)
    float x0 = 0.5 - hw, x1 = 0.5 + hw, y0 = 0.27, y1 = 0.8;
    float fx = 0.035, fy = 0.03;                        // frame thickness
    float wx = s3dBox(f.x, x0, x1, w.x), wy = s3dBox(f.y, y0, y1, w.y);
    float gx = s3dBox(f.x, x0 + fx, x1 - fx, w.x), gy = s3dBox(f.y, y0 + fy, y1 - fy, w.y);
    float bars = max(1.0 - s3dBox(abs(f.x - 0.5), 0.012, 1.0, w.x), 1.0 - s3dBox(abs(f.y - 0.64), 0.012, 1.0, w.y));
    float pane = gx * gy * (1.0 - bars * (1.0 - winFar));
    float frame = wx * wy - pane;
    float sill = s3dBox(f.x, x0 - 0.03, x1 + 0.03, w.x) * s3dBox(f.y, y0 - 0.035, y0, w.y);
    float under = s3dBox(f.x, x0 - 0.03, x1 + 0.03, w.x) * s3dBox(f.y, y0 - 0.075, y0 - 0.035, w.y);
    // per-window interior: dark room, curtains, half-lowered blinds
    float blind = step(0.8, fract(h * 7.7)) * s3dBox(f.y, y1 - 0.18 - 0.2 * fract(h * 3.1), y1, w.y);
    vec3 inside = mix(glass, vec3(0.09, 0.075, 0.06), step(0.55, fract(h * 5.3)) * 0.8);
    inside = mix(inside, vec3(0.42, 0.4, 0.36), blind);
    vec3 c = diffuseColor.rgb;
    c = mix(c, c * 0.6, under);
    c = mix(c, vec3(0.62, 0.61, 0.58), max(frame, sill) * (1.0 - winFar));
    c = mix(c, inside, pane);
    diffuseColor.rgb = mix(c, mix(diffuseColor.rgb, glass, coverage), winFar);
    winMask = mix(pane * (1.0 - blind), coverage, winFar);
    winLit = mix(lit * pane, coverage * uLitShare * 0.9, winFar);
  } else {
    // ground floor: shop windows, doors or plain small windows, cornice band on top
    float kind = fract(h * 11.3);
    bool shops = fract(vSeed * 37.0) < 0.7;
    float wy = hy;
    float ww = fwidth(u / cw);
    float wh = fwidth(hy);
    float pane = 0.0;
    vec3 c = diffuseColor.rgb;
    if (shops && kind < 0.75) {
      pane = s3dBox(f.x, 0.1, 0.9, ww) * s3dBox(wy, 0.6, 3.3, wh);
      float fr = s3dBox(f.x, 0.07, 0.93, ww) * s3dBox(wy, 0.55, 3.36, wh) - pane;
      c = mix(c, vec3(0.12, 0.12, 0.13), fr);
    } else if (kind < 0.85) {
      pane = s3dBox(f.x, 0.32, 0.68, ww) * s3dBox(wy, 0.0, 2.4, wh);
      c = mix(c, vec3(0.16, 0.11, 0.08), pane);
      pane *= 0.3;
    } else {
      pane = s3dBox(f.x, 0.33, 0.67, ww) * s3dBox(wy, 1.3, 3.0, wh);
    }
    float band = s3dBox(hy, gf - 0.35, gf - 0.05, wh);
    c = mix(c, c * 1.18, band);
    float far = smoothstep(0.3, 0.8, ww);
    c = mix(c, glass * 1.4, pane);
    diffuseColor.rgb = mix(c, mix(diffuseColor.rgb, glass, 0.3), far);
    winMask = mix(pane, 0.3, far);
    float shopLit = step(fract(h * 23.0), 0.75) * (shops ? 1.3 : lit);
    winLit = mix(pane * shopLit, 0.3 * 0.7, far);
  }
}
if ((vFlags & 1) != 0 && bn.y > 0.4) {
  float det = 1.0 - smoothstep(0.05, 0.4, pxm);
  if (bn.y < 0.97) {
    // standing-seam sheet metal: seams run down the slope
    vec2 dn = normalize(bn.xz + 1e-6);
    float s = dot(vWPos.xz, vec2(-dn.y, dn.x)) / 0.6;
    float seam = 1.0 - s3dBox(fract(s), 0.06, 1.0, fwidth(s));
    diffuseColor.rgb *= 1.0 - det * (seam * 0.3 - (s3dNoise(vec2(s * 0.5, 0.0)) - 0.5) * 0.08);
  } else {
    float g = s3dNoise(vWPos.xz * 0.35) * 0.6 + s3dNoise(vWPos.xz * 2.0) * 0.4;
    diffuseColor.rgb *= 1.0 + (g - 0.5) * 0.22 * (1.0 - smoothstep(0.3, 2.0, pxm));
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.88, 0.92), uSnow * smoothstep(0.4, 0.75, bn.y));
}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.08, winMask);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.66, 0.36) * winLit * uNight * 1.6;`);
  };
  m.customProgramCacheKey = () => "s3d-building";
  return m;
}

export function terrainMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGPos = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uNight;
uniform float uSnow;
varying vec2 vGPos;
${HASH}`)
      .replace("#include <map_fragment>", `#include <map_fragment>
float glow = 0.0;
float gRough = 0.95;
#ifdef USE_MAP
glow = sampledDiffuseColor.a;
diffuseColor.a = 1.0;
{
  vec3 c = diffuseColor.rgb;
  vec3 cs = sqrt(c);
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float lumS = dot(cs, vec3(0.2126, 0.7152, 0.0722));
  float sat = max(cs.r, max(cs.g, cs.b)) - min(cs.r, min(cs.g, cs.b));
  float notWater = 1.0 - smoothstep(0.03, 0.06, c.b - c.r);
  float gr = smoothstep(0.0, 0.03, c.g - max(c.r, c.b)) * notWater;
  float hard = (1.0 - gr) * notWater;
  float wAsph = hard * (1.0 - smoothstep(0.4, 0.46, lumS));
  float wPave = hard * smoothstep(0.52, 0.6, lumS) * (1.0 - smoothstep(0.8, 0.85, lumS)) * (1.0 - smoothstep(0.1, 0.15, sat));
  float wGrav = hard * smoothstep(0.12, 0.17, sat);
  // world-space detail, faded out as it drops below pixel size
  vec2 wp = vGPos;
  float pxm = length(fwidth(wp));
  float f1 = 1.0 - smoothstep(0.02, 0.08, pxm);
  float f2 = 1.0 - smoothstep(0.08, 0.3, pxm);
  float f3 = 1.0 - smoothstep(1.0, 5.0, pxm);
  float mul = 1.0, fine = 0.5, joint = 0.0, mac = 0.5;
  if (f3 > 0.0) {
    mac = s3dNoise(wp * 0.13) * 0.6 + s3dNoise(wp * 0.55) * 0.4;
    mul += (mac - 0.5) * 0.24 * f3 * notWater;
    mul -= wAsph * 0.1 * smoothstep(0.62, 0.68, s3dNoise(wp * 0.09 + 17.0)) * f3;  // patched repairs
  }
  if (f2 > 0.0) {
    if (f1 > 0.0) fine = s3dNoise(wp * 30.0) * 0.5 + s3dNoise(wp * 71.0) * 0.5;
    mul += wAsph * (fine - 0.5) * 0.3 * f1;
    if (wPave > 0.01) {
      vec2 sg = wp / vec2(0.7, 0.5);
      vec2 sf = fract(sg), sw = fwidth(sg);
      joint = 1.0 - s3dBox(sf.x, 0.02, 0.98, sw.x) * s3dBox(sf.y, 0.03, 0.97, sw.y);
      mul += wPave * f2 * ((s3dHash(floor(sg)) - 0.5) * 0.14 - joint * 0.28 + (fine - 0.5) * 0.12 * f1);
    }
    if (wGrav > 0.01) mul += wGrav * ((s3dHash(floor(wp * 40.0)) - 0.5) * 0.35 * f1 + (s3dNoise(wp * 3.0) - 0.5) * 0.15 * f2);
    if (gr > 0.01) {
      float blades = f1 > 0.0 ? s3dNoise(wp * 9.0) * 0.6 + s3dNoise(wp * 37.0) * 0.4 : 0.5;
      mul += gr * ((s3dNoise(wp * 1.4) - 0.5) * 0.3 * f2 + (blades - 0.5) * 0.35 * f1);
    }
  }
  c *= mul;
  c = mix(c, c * vec3(1.18, 1.06, 0.62), gr * f3 * smoothstep(0.55, 0.85, mac) * 0.55);  // dry patches
  gRough = mix(0.95, 0.82, wAsph);
  float snowable = notWater * max(smoothstep(0.1, 0.22, lum), step(c.r, c.g) * step(c.b, c.g));
  diffuseColor.rgb = mix(c, vec3(0.8, 0.82, 0.86) * (0.96 + 0.08 * fine * f1), uSnow * snowable * 0.95);
}
#endif`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = gRough;`)
      // rough ground barely mirrors the sky; three's split-sum Fresnel makes it
      // go milky white at grazing angles in walk mode
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
reflectedLight.indirectSpecular *= 0.3;`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.62, 0.3) * glow * glow * uNight * 0.035;`);
  };
  m.customProgramCacheKey = () => "s3d-terrain";
  return m;
}

export function treeMaterial(conifer) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true });
  m.userData.leaf = { value: new THREE.Color(conifer ? 0x2f4a2a : 0x4c6e32) };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, { uLeaf: m.userData.leaf });
    srgbColors(shader);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aCrown;\nvarying float vCrown;\nvarying float vUp;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCrown = aCrown;\nvUp = normal.y;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uLeaf;\nuniform float uSnow;\nvarying float vCrown;\nvarying float vUp;")
      .replace("#include <color_fragment>", `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uLeaf * 2.2, vCrown);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.87, 0.9), uSnow * vCrown * smoothstep(0.1, 0.6, vUp) * 0.8);`);
  };
  m.customProgramCacheKey = () => "s3d-tree" + (conifer ? "c" : "b");
  return m;
}

/** Tiling normal map for the water (sum of a few random waves). */
export function waterNormals(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const waves = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 24; k++) {
    // integer wave vectors keep it seamless
    const kx = Math.round((rnd() - 0.5) * 16), ky = Math.round((rnd() - 0.5) * 16);
    if (!kx && !ky) continue;
    waves.push([kx, ky, rnd() * Math.PI * 2, 1 / Math.hypot(kx, ky)]);
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let dx = 0, dy = 0;
    for (const [kx, ky, ph, a] of waves) {
      const s = Math.cos(2 * Math.PI * (kx * x + ky * y) / size + ph) * a;
      dx += s * kx; dy += s * ky;
    }
    const n = new THREE.Vector3(-dx * 0.05, -dy * 0.05, 1).normalize();
    const i = (y * size + x) * 4;
    data[i] = (n.x * 0.5 + 0.5) * 255; data[i + 1] = (n.y * 0.5 + 0.5) * 255; data[i + 2] = (n.z * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
