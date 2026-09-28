// Sky dome, sun/moon light, stars, fog and image-based lighting for a given
// sun position.
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { siderealDeg } from "./sun.js";
import { shared } from "./materials.js";

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Atmosphere {
  constructor(renderer, scene, lat, lon) {
    this.renderer = renderer;
    this.scene = scene;
    this.lat = lat;
    this.lon = lon;
    this.sky = new Sky();
    this.sky.scale.setScalar(45000);
    this.sky.frustumCulled = false;
    const u = this.sky.material.uniforms;
    u.turbidity.value = 3.5;
    u.rayleigh.value = 1.2;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    u.cloudCoverage.value = 0.25;
    u.cloudDensity.value = 0.35;
    scene.add(this.sky);

    this.envScene = new THREE.Scene();
    this.envSky = new THREE.Mesh(this.sky.geometry, this.sky.material);
    this.envSky.scale.setScalar(50);
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.lastEnvSun = new THREE.Vector3(0, -2, 0);
    this.lastEnvTime = -1e9;

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 12000;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a4438, 0.4);
    scene.add(this.hemi);

    this.stars = makeStars();
    scene.add(this.stars);
    scene.fog = new THREE.Fog(0xb4c4d4, 2500, 22000);
    this.dir = new THREE.Vector3();
    this.elevation = 0;
  }

  /** azimuth/elevation in degrees (azimuth clockwise from north; -z is north). */
  update(pos, ms, camera, focus, viewDist) {
    const az = pos.azimuth * Math.PI / 180, el = pos.elevation * Math.PI / 180;
    this.elevation = pos.elevation;
    const d = this.dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    this.sky.material.uniforms.sunPosition.value.copy(d);
    this.sky.position.copy(camera.position);

    const day = smooth(-4, 6, pos.elevation);        // direct sun
    const twilight = smooth(-14, 0, pos.elevation);  // sky still glowing
    const night = 1 - smooth(-9, 2, pos.elevation);
    shared.uNight.value = night;

    // sun (or a dim moon-ish light from the opposite side at night)
    const warm = smooth(0, 25, pos.elevation);
    const lightDir = day > 0.02 ? d : this.moonDir(ms);
    this.sun.color.setRGB(1, 0.62 + 0.36 * warm, 0.38 + 0.56 * warm);
    this.sun.intensity = day > 0.02 ? 3.2 * day : 0.25;
    if (day <= 0.02) this.sun.color.setRGB(0.55, 0.65, 0.95);
    // shadow box follows the focus point, sized by how far we're looking
    const S = THREE.MathUtils.clamp(viewDist * 0.9, 250, 3000);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -S; cam.right = cam.top = S;
    cam.updateProjectionMatrix();
    const texel = (2 * S) / this.sun.shadow.mapSize.x;
    const f = focus.clone();
    f.x = Math.round(f.x / texel) * texel; f.z = Math.round(f.z / texel) * texel;
    this.sun.target.position.copy(f);
    this.sun.position.copy(f).addScaledVector(lightDir, 5000);
    this.sun.target.updateMatrixWorld();
    // The 4096 shadow map is the most expensive pass: only re-render it when the
    // sun or the shadow box moved noticeably, or scene content changed.
    const sm = this.renderer.shadowMap;
    sm.autoUpdate = false;
    if (this.shadowDirty || !this.shadowAt || this.shadowAt.distanceTo(f) > S * 0.06
        || Math.abs(this.shadowS - S) > S * 0.04 || this.shadowDir.angleTo(lightDir) > 0.0015) {
      sm.needsUpdate = true;
      this.shadowDirty = false;
      this.shadowAt = f.clone();
      this.shadowS = S;
      this.shadowDir = lightDir.clone();
    }

    this.hemi.intensity = 0.1 + 0.55 * twilight;
    this.hemi.color.setRGB(0.55 + 0.2 * day, 0.62 + 0.18 * day, 0.85);

    // exposure: bright days, adapted eyes at night
    this.renderer.toneMappingExposure = 0.36 + 0.96 * (1 - twilight) + 0.12 * (1 - day);
    this.sky.material.uniforms.showSunDisc.value = pos.elevation > -1 ? 1 : 0;

    // fog colour follows the horizon
    const dayFog = new THREE.Color(0.64, 0.74, 0.86);
    const duskFog = new THREE.Color(0.75, 0.52, 0.4);
    const nightFog = new THREE.Color(0.012, 0.018, 0.035);
    const fc = nightFog.clone().lerp(duskFog, twilight).lerp(dayFog, smooth(2, 18, pos.elevation));
    this.scene.fog.color.copy(fc);
    this.scene.fog.near = 2500 + 6000 * (1 - twilight);

    // stars
    this.stars.material.opacity = smooth(0.35, 1, night);
    this.stars.visible = this.stars.material.opacity > 0.01;
    this.stars.position.copy(camera.position);
    this.stars.quaternion.copy(this.starQuat(ms));

    // IBL: re-bake the sky probe when the sun moved noticeably
    if (this.lastEnvSun.distanceTo(d) > 0.01 || performance.now() - this.lastEnvTime > 8000) {
      this.lastEnvSun.copy(d);
      this.lastEnvTime = performance.now();
      const fogBefore = this.scene.fog;
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
      this.scene.fog = fogBefore;
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = 0.35 + 0.65 * twilight;
    }
    return { day, night, twilight };
  }

  moonDir() { return new THREE.Vector3(0.3, 0.8, 0.5).normalize(); }

  // stars turn around the celestial pole (altitude = latitude, due north)
  starQuat(ms) {
    const lat = this.lat * Math.PI / 180;
    const axis = new THREE.Vector3(0, Math.sin(lat), -Math.cos(lat));
    const qTilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    const qSpin = new THREE.Quaternion().setFromAxisAngle(axis, -siderealDeg(ms, this.lon) * Math.PI / 180);
    return qSpin.multiply(qTilt);
  }
}

function makeStars() {
  const n = 4500, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    pos.set([r * Math.cos(th) * 30000, u * 30000, r * Math.sin(th) * 30000], i * 3);
    const b = Math.pow(rnd(), 3) * 0.9 + 0.1, t = rnd();
    col.set([b * (0.85 + 0.15 * t), b * 0.9, b * (1.05 - 0.15 * t)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true,
    depthWrite: false, fog: false, opacity: 0 });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = -1;
  return p;
}
