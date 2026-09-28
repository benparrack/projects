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
varying vec3 vWPos;
varying vec3 vWNrm;
flat varying int vFlags;
varying float vSeed;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNrm = normal;
vFlags = int(aFlags + 0.5);
vSeed = aSeed;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uNight;
uniform float uSnow;
uniform float uLitShare;
varying vec3 vWPos;
varying vec3 vWNrm;
flat varying int vFlags;
varying float vSeed;
${HASH}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
vec3 bn = normalize(vWNrm);
float winMask = 0.0, winLit = 0.0, winFar = 0.0;
bool glassy = (vFlags & 4) != 0;
diffuseColor.rgb *= 0.9 + 0.2 * vSeed;
if (((vFlags & 2) != 0 || glassy) && abs(bn.y) < 0.35) {
  vec2 t = normalize(vec2(-bn.z, bn.x));
  float u = dot(vWPos.xz, t);
  vec2 cell = vec2(u / (glassy ? 1.6 : 3.1), (vWPos.y + vSeed * 1.7) / (glassy ? 3.6 : 3.2));
  vec2 f = fract(cell);
  vec2 w = fwidth(cell);
  float a0 = glassy ? 0.06 : 0.24, a1 = glassy ? 0.94 : 0.76;
  float b0 = glassy ? 0.1 : 0.32, b1 = glassy ? 0.96 : 0.84;
  float wx = smoothstep(a0 - w.x, a0 + w.x, f.x) * (1.0 - smoothstep(a1 - w.x, a1 + w.x, f.x));
  float wy = smoothstep(b0 - w.y, b0 + w.y, f.y) * (1.0 - smoothstep(b1 - w.y, b1 + w.y, f.y));
  winFar = smoothstep(0.3, 0.8, max(w.x, w.y));   // windows smaller than ~2 px
  float coverage = glassy ? 0.75 : 0.28;
  winMask = mix(wx * wy, coverage, winFar);
  float h = s3dHash(floor(cell) + vSeed * 91.7);
  float lit = step(h, uLitShare) * (0.6 + 0.8 * fract(h * 17.0));
  winLit = mix(lit * wx * wy, coverage * uLitShare * 0.9, winFar);
  vec3 glass = glassy ? vec3(0.05, 0.08, 0.1) : vec3(0.03, 0.04, 0.05);
  diffuseColor.rgb = mix(diffuseColor.rgb, glass, winMask * (glassy ? 0.85 : 1.0));
}
if ((vFlags & 1) != 0 && bn.y > 0.4) {
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.88, 0.92), uSnow * smoothstep(0.4, 0.75, bn.y));
}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.1, winMask);`)
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
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uNight;
uniform float uSnow;`)
      .replace("#include <map_fragment>", `#include <map_fragment>
float glow = 0.0;
#ifdef USE_MAP
glow = sampledDiffuseColor.a;
diffuseColor.a = 1.0;
{
  vec3 c = diffuseColor.rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float notWater = 1.0 - smoothstep(0.03, 0.06, c.b - c.r);
  float green = step(c.r, c.g) * step(c.b, c.g);
  float snowable = notWater * max(smoothstep(0.1, 0.22, lum), green);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.82, 0.86), uSnow * snowable * 0.95);
}
#endif`)
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
