(() => {
  // ---------- Config ----------
  const ARENA_HALF = 22;
  const EYE_HEIGHT = 1.7;
  const PLAYER_RADIUS = 0.4;
  const ENEMY_RADIUS = 0.45;
  const MOVE_SPEED = 7.5;
  const MOUSE_SENSITIVITY = 0.0022;
  const DASH_SPEED = 26;
  const DASH_DURATION = 180;
  const DASH_COOLDOWN = 2500;

  const WEAPONS = {
    pistol:  { id: 'pistol',  name: 'Pistol',   price: 0,   damage: 22,  cooldown: 330,  magSize: 12, reloadTime: 1100, auto: false, spread: 0.012, pellets: 1, color: 0x9a9a9a },
    smg:     { id: 'smg',     name: 'SMG',      price: 150, damage: 14,  cooldown: 100,  magSize: 30, reloadTime: 1600, auto: true,  spread: 0.032, pellets: 1, color: 0x5599ff },
    shotgun: { id: 'shotgun', name: 'Shotgun',  price: 200, damage: 16,  cooldown: 650,  magSize: 6,  reloadTime: 2200, auto: false, spread: 0.10,  pellets: 8, falloffRange: 14, color: 0xff9933 },
    ak:      { id: 'ak',      name: 'AK-Rifle', price: 320, damage: 30,  cooldown: 160,  magSize: 30, reloadTime: 1900, auto: true,  spread: 0.022, pellets: 1, color: 0xcc4444 },
    sniper:  { id: 'sniper',  name: 'Sniper',   price: 450, damage: 110, cooldown: 1100, magSize: 5,  reloadTime: 2300, auto: false, spread: 0.002, pellets: 1, zoom: true, color: 0x33cc66 },
    knife:   { id: 'knife',   name: 'Knife',    price: 0,   damage: 38,  cooldown: 420,  magSize: Infinity, reloadTime: 0, auto: true, spread: 0, pellets: 1, meleeRange: 2.4, color: 0xd8dee4 },
  };
  const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'ak', 'sniper'];
  const ALL_WEAPON_IDS = [...WEAPON_ORDER, 'knife'];

  const UPGRADE_DEFS = {
    extMag: { name: 'Extended Mag', desc: '+50% magazine size', price: 90 },
    rapid: { name: 'Rapid Fire', desc: '-20% fire cooldown', price: 110 },
    laser: { name: 'Laser Sight', desc: 'Tighter spread + visible laser', price: 80 },
  };

  const PERKS = {
    fastReload: { name: 'Fast Hands', desc: '-30% reload time', price: 150 },
    moreHp: { name: 'Vitality', desc: '+30 max HP (heals same amount)', price: 130 },
    speed: { name: 'Swift Boots', desc: '+20% move speed', price: 140 },
    dash: { name: 'Dash', desc: 'Shift to burst forward (2.5s cooldown)', price: 180 },
  };

  const ARMOR_TIERS = [
    { id: 'armor1', name: '1 Plate Armor', plates: 1, price: 70 },
    { id: 'armor2', name: '2 Plate Armor', plates: 2, price: 130 },
    { id: 'armor3', name: '3 Plate Armor', plates: 3, price: 190 },
  ];
  const HEALTH_POTIONS = [
    { id: 'heal25', name: 'Small Medkit', heal: 25, price: 35 },
    { id: 'heal50', name: 'Medium Medkit', heal: 50, price: 65 },
    { id: 'heal100', name: 'Full Medkit', heal: 100, price: 120 },
  ];

  const SPAWN_POINTS = Array.from({ length: 8 }, (_, i) => {
    const a = i * (Math.PI * 2 / 8);
    return { x: Math.cos(a) * 19, z: Math.sin(a) * 19 };
  });

  const PILLAR_LAYOUT = [
    { x: 8, z: 8 }, { x: -8, z: 8 }, { x: 8, z: -8 }, { x: -8, z: -8 },
    { x: 0, z: 13 }, { x: 0, z: -13 },
  ];

  // ---------- Three.js setup ----------
  const canvas = document.getElementById('gameCanvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0f14);
  scene.fog = new THREE.Fog(0x0d0f14, 20, 55);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);
  const baseFov = 75;

  const pitchObject = new THREE.Object3D();
  pitchObject.add(camera);
  const yawObject = new THREE.Object3D();
  yawObject.position.set(0, EYE_HEIGHT, 8);
  yawObject.add(pitchObject);
  scene.add(yawObject);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Lighting
  scene.add(new THREE.HemisphereLight(0x8899bb, 0x33291f, 0.7));
  const sun = new THREE.DirectionalLight(0xfff2d9, 0.9);
  sun.position.set(15, 25, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  scene.add(sun);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
    new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const gridHelper = new THREE.GridHelper(ARENA_HALF * 2, 22, 0x444a55, 0x22262e);
  gridHelper.position.y = 0.01;
  scene.add(gridHelper);

  // Walls
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.9 });
  const wallHeight = 6;
  [
    { x: 0, z: -ARENA_HALF, w: ARENA_HALF * 2, d: 1 },
    { x: 0, z: ARENA_HALF, w: ARENA_HALF * 2, d: 1 },
    { x: -ARENA_HALF, z: 0, w: 1, d: ARENA_HALF * 2 },
    { x: ARENA_HALF, z: 0, w: 1, d: ARENA_HALF * 2 },
  ].forEach((w) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, wallHeight, w.d), wallMat);
    mesh.position.set(w.x, wallHeight / 2, w.z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    scene.add(mesh);
  });

  // Pillars (cover + collision + LOS blockers)
  const pillars = [];
  const pillarMeshes = [];
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.8 });
  PILLAR_LAYOUT.forEach((p) => {
    const hx = 1.1, hz = 1.1, height = 3.4;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, height, hz * 2), pillarMat);
    mesh.position.set(p.x, height / 2, p.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    pillarMeshes.push(mesh);
    pillars.push({ x: p.x, z: p.z, hx, hz });
  });

  // ---------- Weapon viewmodels ----------
  const darkMat = () => new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.5, metalness: 0.3 });
  const woodMat = () => new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.75 });

  function buildPistol(color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.4 });
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.075, 0.3), mat);
    slide.position.set(0, 0.05, -0.1);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.19, 0.09), darkMat());
    grip.position.set(0, -0.08, 0.05);
    grip.rotation.x = -0.28;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 8), darkMat());
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.05, -0.3);
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.045, 0.018), darkMat());
    trigger.position.set(0, -0.015, -0.02);
    g.add(slide, grip, barrel, trigger);
    g.userData.muzzleZ = -0.35;
    return g;
  }

  function buildSMG(color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.42), mat);
    body.position.set(0, 0.04, -0.12);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.08), darkMat());
    grip.position.set(0, -0.08, 0.02);
    grip.rotation.x = -0.25;
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.06), darkMat());
    mag.position.set(0, -0.1, -0.1);
    mag.rotation.x = 0.15;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 8), darkMat());
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.04, -0.4);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.12), darkMat());
    stock.position.set(0, 0.03, 0.16);
    g.add(body, grip, mag, barrel, stock);
    g.userData.muzzleZ = -0.47;
    return g;
  }

  function buildShotgun(color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.42, 8), mat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.06, -0.22);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.14), darkMat());
    pump.position.set(0, 0.025, -0.2);
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.14), darkMat());
    receiver.position.set(0, 0.035, 0.02);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.16, 0.08), darkMat());
    grip.position.set(0, -0.06, 0.05);
    grip.rotation.x = -0.3;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.2), woodMat());
    stock.position.set(0, 0.02, 0.23);
    g.add(barrel, pump, receiver, grip, stock);
    g.userData.muzzleZ = -0.43;
    return g;
  }

  function buildAK(color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.25 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.55), mat);
    body.position.set(0, 0.05, -0.1);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.07), darkMat());
    grip.position.set(0, -0.06, 0.08);
    grip.rotation.x = -0.3;
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.09), darkMat());
    mag.position.set(0, -0.14, -0.05);
    mag.rotation.x = 0.45;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 8), darkMat());
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.05, -0.48);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.2), woodMat());
    stock.position.set(0, 0.03, 0.29);
    g.add(body, grip, mag, barrel, stock);
    g.userData.muzzleZ = -0.6;
    return g;
  }

  function buildSniper(color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.4 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.6), mat);
    body.position.set(0, 0.04, -0.12);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.32, 8), darkMat());
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.04, -0.58);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 10), darkMat());
    scope.position.set(0, 0.12, -0.15);
    scope.rotation.x = Math.PI / 2;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 0.07), darkMat());
    grip.position.set(0, -0.06, 0.1);
    grip.rotation.x = -0.25;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.22), darkMat());
    stock.position.set(0, 0.03, 0.33);
    g.add(body, barrel, scope, grip, stock);
    g.userData.muzzleZ = -0.74;
    return g;
  }

  function buildKnife(color) {
    const g = new THREE.Group();
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.03, 0.42),
      new THREE.MeshStandardMaterial({ color, roughness: 0.2, metalness: 0.75 })
    );
    blade.position.set(0, 0.02, -0.22);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.18), darkMat());
    handle.position.set(0, -0.01, 0.08);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.03), darkMat());
    guard.position.set(0, 0.02, -0.02);
    g.add(blade, handle, guard);
    g.userData.muzzleZ = -0.4;
    return g;
  }

  const GUN_BUILDERS = { pistol: buildPistol, smg: buildSMG, shotgun: buildShotgun, ak: buildAK, sniper: buildSniper, knife: buildKnife };

  const gunGroup = new THREE.Group();
  gunGroup.position.set(0.32, -0.28, -0.55);
  camera.add(gunGroup);
  const gunModels = {};
  ALL_WEAPON_IDS.forEach((id) => {
    const g = GUN_BUILDERS[id](WEAPONS[id].color);
    g.visible = false;
    gunGroup.add(g);
    gunModels[id] = g;
  });

  const muzzleFlash = new THREE.PointLight(0xffcc66, 0, 4);
  camera.add(muzzleFlash);
  const flashMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.15, 0.15),
    new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0.9 })
  );
  flashMesh.visible = false;
  gunGroup.add(flashMesh);

  // Player laser-sight beam (visible while the equipped weapon has the Laser Sight upgrade)
  const playerLaserLine = createLaserBeam(0xff3333, 0.02);

  // ---------- Helpers ----------
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function resolvePillarCollision(x, z, radius) {
    for (const p of pillars) {
      const closestX = clamp(x, p.x - p.hx, p.x + p.hx);
      const closestZ = clamp(z, p.z - p.hz, p.z + p.hz);
      const dx = x - closestX, dz = z - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq < radius * radius) {
        const dist = Math.sqrt(distSq) || 0.0001;
        const push = radius - dist;
        x += (dx / dist) * push;
        z += (dz / dist) * push;
      }
    }
    const bound = ARENA_HALF - 0.6;
    x = clamp(x, -bound, bound);
    z = clamp(z, -bound, bound);
    return { x, z };
  }

  function hasLineOfSight(fromPos, toPos) {
    const dir = new THREE.Vector3().subVectors(toPos, fromPos);
    const dist = dir.length();
    dir.normalize();
    losRaycaster.set(fromPos, dir);
    losRaycaster.far = dist;
    const hits = losRaycaster.intersectObjects(pillarMeshes, false);
    return hits.length === 0;
  }

  function formatTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  // ---------- Sound (synthesized via Web Audio, no external assets) ----------
  let audioCtx = null;
  function initAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  function playTone({ freq, freqEnd, duration = 0.1, type = 'square', volume = 0.2, delay = 0 }) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + duration);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }
  function playNoise({ duration = 0.12, volume = 0.2, filterFreq = 1500, filterType = 'lowpass', delay = 0 }) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + delay;
    const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    src.connect(filter).connect(gain).connect(audioCtx.destination);
    src.start(t0);
  }
  function sfxShoot(id) {
    switch (id) {
      case 'pistol': playNoise({ duration: 0.08, volume: 0.25, filterFreq: 2200 }); playTone({ freq: 180, freqEnd: 80, duration: 0.06, volume: 0.15 }); break;
      case 'smg': playNoise({ duration: 0.05, volume: 0.18, filterFreq: 2600 }); playTone({ freq: 220, freqEnd: 100, duration: 0.04, volume: 0.12 }); break;
      case 'shotgun': playNoise({ duration: 0.18, volume: 0.3, filterFreq: 1200 }); playTone({ freq: 110, freqEnd: 50, duration: 0.15, volume: 0.2 }); break;
      case 'ak': playNoise({ duration: 0.09, volume: 0.26, filterFreq: 1800 }); playTone({ freq: 150, freqEnd: 70, duration: 0.08, volume: 0.16 }); break;
      case 'sniper': playNoise({ duration: 0.25, volume: 0.32, filterFreq: 900 }); playTone({ freq: 90, freqEnd: 40, duration: 0.22, volume: 0.25 }); break;
      case 'knife': playNoise({ duration: 0.07, volume: 0.15, filterFreq: 4000, filterType: 'highpass' }); break;
    }
  }
  function sfxHit(isHead) { playTone({ freq: isHead ? 900 : 400, freqEnd: isHead ? 500 : 200, duration: 0.06, type: 'triangle', volume: 0.18 }); }
  function sfxEnemyKill() { playTone({ freq: 660, freqEnd: 880, duration: 0.1, type: 'sine', volume: 0.18 }); }
  function sfxKillstreak(streak) {
    const base = 500 + Math.min(streak, 8) * 70;
    playTone({ freq: base, freqEnd: base * 1.5, duration: 0.12, type: 'sine', volume: 0.22 });
  }
  function sfxPlayerHurt() { playNoise({ duration: 0.12, volume: 0.22, filterFreq: 600 }); playTone({ freq: 140, freqEnd: 70, duration: 0.1, volume: 0.15 }); }
  function sfxArmorBlock() { playTone({ freq: 1200, freqEnd: 900, duration: 0.05, volume: 0.15 }); }
  function sfxReloadClick() { playTone({ freq: 700, duration: 0.03, volume: 0.12 }); playTone({ freq: 500, duration: 0.03, volume: 0.12, delay: 0.09 }); }
  function sfxRoundClear() { [520, 660, 780, 1040].forEach((f, i) => playTone({ freq: f, duration: 0.14, type: 'sine', volume: 0.2, delay: i * 0.09 })); }
  function sfxRoundStart() { playTone({ freq: 220, freqEnd: 330, duration: 0.35, type: 'sawtooth', volume: 0.15 }); }
  function sfxBossAppear() { playTone({ freq: 80, duration: 1.0, type: 'sawtooth', volume: 0.28 }); playTone({ freq: 60, duration: 1.0, type: 'sawtooth', volume: 0.2, delay: 0.15 }); }
  function sfxDeath() { playTone({ freq: 300, freqEnd: 60, duration: 0.9, type: 'sawtooth', volume: 0.22 }); }
  function sfxPurchase() { playTone({ freq: 700, duration: 0.05, volume: 0.15 }); playTone({ freq: 1000, duration: 0.08, volume: 0.15, delay: 0.06 }); }
  function sfxDash() { playNoise({ duration: 0.12, volume: 0.15, filterFreq: 3000, filterType: 'highpass' }); }

  let lowHpInterval = null;
  function updateLowHpPulse() {
    const low = gameState === 'ROUND_ACTIVE' && player.hp > 0 && player.hp / player.maxHp < 0.25;
    if (low && !lowHpInterval) {
      lowHpInterval = setInterval(() => {
        playTone({ freq: 90, duration: 0.12, type: 'sine', volume: 0.18 });
        playTone({ freq: 70, duration: 0.15, type: 'sine', volume: 0.14, delay: 0.18 });
      }, 850);
    } else if (!low && lowHpInterval) {
      clearInterval(lowHpInterval);
      lowHpInterval = null;
    }
  }

  // ---------- High score (localStorage) ----------
  function loadHighScore() {
    try {
      const raw = localStorage.getItem('shooter3d_highscore');
      return raw ? JSON.parse(raw) : { bestRound: 0, bestTimeMs: 0, bestGold: 0 };
    } catch (e) { return { bestRound: 0, bestTimeMs: 0, bestGold: 0 }; }
  }
  function saveHighScore(hs) {
    try { localStorage.setItem('shooter3d_highscore', JSON.stringify(hs)); } catch (e) { /* storage unavailable */ }
  }
  let highScore = loadHighScore();

  // ---------- State ----------
  let gameState = 'MENU'; // MENU, ROUND_INTRO, ROUND_ACTIVE, SHOP, GAMEOVER
  let round = 0;
  const keys = {};
  let sniperZoomed = false;
  let runStartTime = 0;
  let elapsedMs = 0;
  let killStreak = 0;
  let lastKillTime = -Infinity;
  let dashActiveUntil = 0;
  let dashCooldownUntil = 0;
  let dashDir = { x: 0, z: -1 };

  const player = {
    hp: 100, maxHp: 100, gold: 0, armor: 0, armorCapacity: 0,
    owned: ['pistol', 'knife'], currentId: 'pistol',
    ammo: { pistol: WEAPONS.pistol.magSize, knife: Infinity },
    reloading: false, lastFire: 0, mouseDown: false, canFireSemi: true,
    upgrades: {}, perks: { fastReload: false, moreHp: false, speed: false, dash: false },
  };

  const enemies = [];
  const enemyHitMeshes = [];
  let pendingSpawns = 0;
  const raycaster = new THREE.Raycaster();
  const losRaycaster = new THREE.Raycaster();
  let messages = [];

  function getWeaponStats(id) {
    const base = WEAPONS[id];
    const up = player.upgrades[id] || {};
    return {
      ...base,
      magSize: up.extMag && isFinite(base.magSize) ? Math.round(base.magSize * 1.5) : base.magSize,
      cooldown: up.rapid ? Math.round(base.cooldown * 0.8) : base.cooldown,
      spread: up.laser ? base.spread * 0.5 : base.spread,
    };
  }

  // ---------- HUD ----------
  const el = (id) => document.getElementById(id);
  function updateHUD() {
    elapsedMs = gameState === 'MENU' ? 0 : performance.now() - runStartTime;
    el('timerVal').textContent = formatTime(elapsedMs);

    el('hpText').textContent = `${Math.max(0, Math.round(player.hp))} / ${player.maxHp}`;
    el('healthBarInner').style.width = `${Math.max(0, player.hp / player.maxHp) * 100}%`;
    el('healthBarInner').style.background = player.hp / player.maxHp < 0.3 ? '#d94b3f' : (player.hp / player.maxHp < 0.6 ? '#e0a030' : '#4caf50');
    const armorOuter = el('armorBarOuter');
    if (player.armorCapacity > 0) {
      armorOuter.style.display = 'block';
      el('armorBarInner').style.width = `${(player.armor / player.armorCapacity) * 100}%`;
      el('armorText').textContent = `${player.armor} / ${player.armorCapacity} armor`;
    } else {
      armorOuter.style.display = 'none';
      el('armorText').textContent = '';
    }

    const w = WEAPONS[player.currentId];
    const ammoVal = player.ammo[player.currentId];
    el('ammoText').textContent = player.reloading ? '...' : (ammoVal === Infinity ? '∞' : (ammoVal ?? 0));
    el('weaponNameInline').textContent = w.name;
    el('reloadText').textContent = player.reloading ? 'Reloading...' : '';
    el('goldVal').textContent = player.gold;
    el('roundVal').textContent = round;
    el('enemiesVal').textContent = enemies.filter(e => !e.dying).length;

    if (player.perks.dash) {
      const remaining = dashCooldownUntil - performance.now();
      el('dashText').textContent = remaining > 0 ? `Dash: ${(remaining / 1000).toFixed(1)}s` : 'Dash: Ready';
      el('dashText').style.display = 'block';
    } else {
      el('dashText').style.display = 'none';
    }

    const boss = enemies.find(e => e.isBoss && !e.dying);
    const bossWrap = el('bossBar');
    if (boss) {
      bossWrap.style.display = 'block';
      el('bossName').textContent = boss.bossName;
      el('bossHpInner').style.width = `${Math.max(0, boss.hp / boss.maxHp) * 100}%`;
    } else {
      bossWrap.style.display = 'none';
    }

    updateLowHpPulse();
  }

  function addMessage(msg) {
    messages.push(msg);
    if (messages.length > 40) messages.shift();
    el('log').innerHTML = messages.slice(-5).map(m => `<div>${m}</div>`).join('');
  }

  let bannerTimeout = null;
  function showBanner(text, duration) {
    const b = el('banner');
    b.textContent = text;
    b.style.opacity = '1';
    clearTimeout(bannerTimeout);
    bannerTimeout = setTimeout(() => { b.style.opacity = '0'; }, duration);
  }

  let vignetteAlpha = 0;
  function flashDamage() { vignetteAlpha = 1; }

  let hitMarkerUntil = 0;
  function showHitMarker(isHead) {
    const hm = el('hitmarker');
    hm.classList.toggle('head', !!isHead);
    hm.style.opacity = '1';
    hitMarkerUntil = performance.now() + 180;
  }

  // ---------- Weapon switching ----------
  function setCurrentWeapon(id) {
    if (!player.owned.includes(id)) return;
    player.currentId = id;
    ALL_WEAPON_IDS.forEach((wid) => { gunModels[wid].visible = wid === id; });
    if (player.ammo[id] === undefined) player.ammo[id] = getWeaponStats(id).magSize;
    player.reloading = false;
    sniperZoomed = false;
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
    updateHUD();
  }
  setCurrentWeapon('pistol');

  function reload() {
    const id = player.currentId;
    const stats = getWeaponStats(id);
    if (!isFinite(stats.magSize)) return;
    if (player.reloading || player.ammo[id] === stats.magSize) return;
    player.reloading = true;
    sfxReloadClick();
    addMessage('Reloading...');
    updateHUD();
    const reloadTime = stats.reloadTime * (player.perks.fastReload ? 0.7 : 1);
    setTimeout(() => {
      player.ammo[id] = stats.magSize;
      if (player.currentId === id) {
        player.reloading = false;
        updateHUD();
      }
    }, reloadTime);
  }

  function triggerGunKick() {
    const g = gunModels[player.currentId];
    g.position.z += 0.06;
    muzzleFlash.intensity = 3;
    muzzleFlash.position.set(gunGroup.position.x, gunGroup.position.y + 0.05, gunGroup.position.z + g.userData.muzzleZ);
    flashMesh.visible = true;
    flashMesh.position.set(0, 0.05, g.userData.muzzleZ - 0.04);
    setTimeout(() => { flashMesh.visible = false; muzzleFlash.intensity = 0; }, 45);
  }

  function performShot() {
    const w = getWeaponStats(player.currentId);
    const pellets = w.pellets || 1;
    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);
    const baseDir = new THREE.Vector3();
    camera.getWorldDirection(baseDir);
    const maxRange = w.meleeRange || 100;

    for (let p = 0; p < pellets; p++) {
      const spread = sniperZoomed ? w.spread * 0.15 : w.spread;
      const dir = baseDir.clone();
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
      raycaster.set(origin, dir);
      raycaster.far = maxRange;
      const enemyHits = raycaster.intersectObjects(enemyHitMeshes, false);
      const blockHits = raycaster.intersectObjects(pillarMeshes, false);
      if (enemyHits.length === 0) continue;
      const hit = enemyHits[0];
      if (blockHits.length && blockHits[0].distance < hit.distance) continue;
      const enemy = hit.object.userData.enemyRef;
      if (!enemy || enemy.dying) continue;
      const isHead = hit.object.userData.part === 'head';
      let dmg = w.damage;
      if (w.falloffRange) dmg *= clamp(1 - hit.distance / (w.falloffRange * 2.2), 0.35, 1);
      if (isHead) dmg *= 2.5;
      damageEnemy(enemy, dmg, isHead);
    }
  }

  function tryFire() {
    if (gameState !== 'ROUND_ACTIVE') return;
    const id = player.currentId;
    const w = getWeaponStats(id);
    const now = performance.now();
    if (player.reloading) return;
    if (!w.auto && !player.canFireSemi) return;
    if (now - player.lastFire < w.cooldown) return;
    if ((player.ammo[id] ?? 0) <= 0) { reload(); return; }

    if (isFinite(player.ammo[id])) player.ammo[id]--;
    player.lastFire = now;
    player.canFireSemi = false;
    performShot();
    triggerGunKick();
    sfxShoot(id);
    updateHUD();
    if (isFinite(player.ammo[id]) && player.ammo[id] <= 0) reload();
  }

  // ---------- Enemies ----------
  const ENEMY_TYPES = {
    melee: { color: 0x4a7fc2, headColor: 0x3a63a0, scale: 1, speed: 3.6, attackRange: 1.9, retreatRange: 0, baseHp: 25, hpPerRound: 5, dmg: [4, 8], gold: [8, 14], attackCooldown: 900, weaponType: 'knife' },
    grunt: { color: 0x3aa25a, headColor: 0x2c8046, scale: 1, speed: 3.2, attackRange: 16, retreatRange: 4, baseHp: 30, hpPerRound: 6, dmg: [5, 10], gold: [8, 14], attackCooldown: 1500, weaponType: 'gun' },
    brute: { color: 0xaa3a3a, headColor: 0x802c2c, scale: 1.35, speed: 2.0, attackRange: 14, retreatRange: 3, baseHp: 95, hpPerRound: 12, dmg: [10, 18], gold: [25, 36], attackCooldown: 1900, weaponType: 'gun' },
    sniper: { color: 0x2e3b2e, headColor: 0x1f291f, scale: 1.05, speed: 2.4, attackRange: 26, retreatRange: 6, baseHp: 45, hpPerRound: 8, dmg: [22, 32], gold: [20, 30], attackCooldown: 3400, weaponType: 'sniper', telegraphDuration: 1500 },
  };
  const ATTACK_VERBS = { melee: 'slashes', grunt: 'shoots', brute: 'blasts', sniper: 'snipes', juggernaut: 'slams', gunner: 'bursts', marksman: 'snipes', swarmer: 'blasts', bruteking: 'crushes' };
  const ENEMY_DISPLAY_NAME = { melee: 'melee attacker', grunt: 'grunt', brute: 'brute', sniper: 'sniper', juggernaut: 'The Juggernaut', gunner: 'The Gunner', marksman: 'The Marksman', swarmer: 'The Swarmer', bruteking: 'The Brute King' };

  const BOSS_TYPES = {
    juggernaut: { name: 'The Juggernaut', color: 0xff6a2e, headColor: 0xcc4f1e, scale: 1.9, speed: 1.7, attackRange: 2.4, baseHp: 950, hpPerCycle: 350, dmg: [15, 22], gold: [160, 230], attackCooldown: 1400, weaponType: 'knife', special: 'charge' },
    gunner: { name: 'The Gunner', color: 0x8a4fd0, headColor: 0x6a35a8, scale: 1.5, speed: 2.3, attackRange: 20, baseHp: 300, hpPerCycle: 110, dmg: [7, 12], gold: [160, 230], attackCooldown: 1700, weaponType: 'gun', special: 'burst' },
    marksman: { name: 'The Marksman', color: 0x2d3b2e, headColor: 0x1c261d, scale: 1.4, speed: 2.1, attackRange: 28, baseHp: 240, hpPerCycle: 95, dmg: [26, 38], gold: [160, 230], attackCooldown: 2800, weaponType: 'sniper', special: 'reposition', telegraphDuration: 1000 },
    swarmer: { name: 'The Swarmer', color: 0xe0c22e, headColor: 0xb89a1c, scale: 1.45, speed: 2.6, attackRange: 18, baseHp: 260, hpPerCycle: 100, dmg: [6, 10], gold: [160, 230], attackCooldown: 1500, weaponType: 'gun', special: 'summon' },
    bruteking: { name: 'The Brute King', color: 0x8a1c1c, headColor: 0x651212, scale: 2.1, speed: 1.5, attackRange: 2.6, baseHp: 460, hpPerCycle: 170, dmg: [16, 24], gold: [160, 230], attackCooldown: 1500, weaponType: 'knife', special: 'slam' },
  };
  const BOSS_ORDER = ['juggernaut', 'gunner', 'marksman', 'swarmer', 'bruteking'];

  // Rounds 1-2 are melee-only so new players can learn movement/aim without ranged pressure.
  // Ranged grunts phase in from round 3, snipers/brutes from round 4-5. Every 5th round is a boss round.
  function roundComposition(n) {
    const total = Math.min(3 + (n - 1) * 2, 22);
    const list = [];
    for (let i = 0; i < total; i++) {
      if (n <= 2) { list.push('melee'); continue; }
      const bruteChance = n >= 4 ? Math.min(0.5, (n - 3) * 0.08) : 0;
      const sniperChance = n >= 5 ? Math.min(0.3, (n - 4) * 0.06) : 0;
      const roll = Math.random();
      if (roll < sniperChance) { list.push('sniper'); continue; }
      if (roll < sniperChance + bruteChance) { list.push('brute'); continue; }
      const rangedChance = Math.min(0.7, (n - 2) * 0.18);
      list.push(Math.random() < rangedChance ? 'grunt' : 'melee');
    }
    return list;
  }

  function buildEnemyGun() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x787c85, roughness: 0.35, metalness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), mat);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.2, 8), mat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.33;
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.07), new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.5 }));
    mag.position.set(0, -0.13, 0.05);
    g.add(body, barrel, mag);
    return g;
  }

  function buildEnemyKnife() {
    const g = new THREE.Group();
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.025, 0.38),
      new THREE.MeshStandardMaterial({ color: 0xe4eaf0, roughness: 0.2, metalness: 0.8 })
    );
    blade.position.z = -0.19;
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.8 })
    );
    handle.position.z = 0.09;
    g.add(blade, handle);
    return g;
  }

  function buildEnemySniperRifle() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x30332f, roughness: 0.35, metalness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.62), mat);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 8), mat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.44;
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.2, 8), darkMat());
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.09, -0.1);
    g.add(body, barrel, scope);
    return g;
  }

  // A real cylinder mesh, not a THREE.Line: WebGL mostly ignores line width across platforms
  // (a longstanding cross-browser limitation), so a "thick line" has to be actual geometry.
  function createLaserBeam(color, radius) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 1, 8, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  }

  function updateLaserBeam(mesh, from, to) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.001) { mesh.visible = false; return; }
    dir.normalize();
    mesh.position.copy(from).addScaledVector(dir, len / 2);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    mesh.scale.set(1, len, 1);
    mesh.visible = true;
  }

  function weaponMeshFor(weaponType) {
    if (weaponType === 'knife') return buildEnemyKnife();
    if (weaponType === 'sniper') return buildEnemySniperRifle();
    return buildEnemyGun();
  }

  function makeEnemyBase(type, def, pos, hp, extra) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 1.3, 0.5),
      new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.7 })
    );
    body.position.y = 0.85;
    body.castShadow = true;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 12, 10),
      new THREE.MeshStandardMaterial({ color: def.headColor, roughness: 0.7 })
    );
    head.position.y = 1.75;
    head.castShadow = true;
    const weaponMesh = weaponMeshFor(def.weaponType);
    weaponMesh.position.set(0.46, 1.0, -0.3);
    weaponMesh.rotation.y = -0.3;
    weaponMesh.castShadow = true;
    group.add(body, head, weaponMesh);
    group.scale.setScalar(def.scale);
    group.position.set(pos.x, 0, pos.z);
    scene.add(group);

    const enemy = Object.assign({
      type, group, body, head, hp, maxHp: hp, baseScale: def.scale,
      speed: def.speed, attackRange: def.attackRange, retreatRange: def.retreatRange || 0,
      dmg: def.dmg, gold: def.gold, attackCooldown: def.attackCooldown, weaponType: def.weaponType,
      lastAttack: -Infinity, hitFlashUntil: 0, dying: false, deathStart: 0,
      baseBodyColor: def.color, baseHeadColor: def.headColor,
      sniperState: 'idle', aimStart: 0, telegraphDuration: def.telegraphDuration || 900,
      laserLine: null, isBoss: false,
    }, extra || {});

    if (def.weaponType === 'sniper') enemy.laserLine = createLaserBeam(0xff2222, 0.09);

    body.userData = { enemyRef: enemy, part: 'body' };
    head.userData = { enemyRef: enemy, part: 'head' };
    enemies.push(enemy);
    enemyHitMeshes.push(body, head);
    return enemy;
  }

  function spawnEnemy(type, pos) {
    const def = ENEMY_TYPES[type];
    const hp = def.baseHp + def.hpPerRound * (round - 1);
    return makeEnemyBase(type, def, pos, hp, null);
  }

  function spawnBoss(bossKey, pos) {
    const def = BOSS_TYPES[bossKey];
    const cycle = Math.floor((round - 1) / 5);
    const hp = def.baseHp + def.hpPerCycle * cycle;
    const enemy = makeEnemyBase(bossKey, def, pos, hp, {
      isBoss: true, bossName: def.name, special: def.special,
      specialLastUsed: -Infinity, specialState: 'idle', specialStart: 0,
      chargeDir: { x: 0, z: -1 }, chargeHit: false, slamRing: null,
    });
    enemy.group.scale.setScalar(def.scale * 1.15); // bosses read slightly bigger than their listed scale for silhouette clarity
    enemy.baseScale = def.scale * 1.15;
    sfxBossAppear();
    return enemy;
  }

  function spawnRoundEnemies(n) {
    if (n % 5 === 0) {
      pendingSpawns = 1;
      setTimeout(() => {
        if (gameState !== 'ROUND_ACTIVE') { pendingSpawns = 0; return; }
        const bossIndex = Math.floor(n / 5 - 1) % BOSS_ORDER.length;
        const bossKey = BOSS_ORDER[bossIndex];
        spawnBoss(bossKey, { x: 0, z: -18 });
        addMessage(`${BOSS_TYPES[bossKey].name} appears!`);
        pendingSpawns = 0;
      }, 500);
      return;
    }
    const comp = roundComposition(n);
    pendingSpawns = comp.length;
    comp.forEach((type, i) => {
      setTimeout(() => {
        if (gameState !== 'ROUND_ACTIVE') { pendingSpawns = 0; return; }
        const sp = SPAWN_POINTS[randInt(0, SPAWN_POINTS.length - 1)];
        spawnEnemy(type, sp);
        pendingSpawns--;
      }, i * 350);
    });
  }

  function damageEnemy(enemy, dmg, isHead) {
    enemy.hp -= dmg;
    enemy.hitFlashUntil = performance.now() + 90;
    showHitMarker(isHead);
    sfxHit(isHead);
    if (enemy.hp <= 0 && !enemy.dying) {
      enemy.dying = true;
      enemy.deathStart = performance.now();
      const reward = randInt(enemy.gold[0], enemy.gold[1]);
      player.gold += reward;
      const now = performance.now();
      if (now - lastKillTime < 2200) killStreak++; else killStreak = 1;
      lastKillTime = now;
      sfxEnemyKill();
      if (killStreak >= 2) { sfxKillstreak(killStreak); addMessage(`Kill streak x${killStreak}!`); }
      const label = enemy.isBoss ? enemy.bossName : ENEMY_DISPLAY_NAME[enemy.type];
      addMessage(`${isHead ? 'Headshot! ' : ''}Killed ${enemy.isBoss ? '' : 'a '}${label}. +${reward} gold`);
      updateHUD();
    }
  }

  function removeEnemy(enemy) {
    scene.remove(enemy.group);
    if (enemy.laserLine) { scene.remove(enemy.laserLine); enemy.laserLine.geometry.dispose(); enemy.laserLine.material.dispose(); }
    if (enemy.slamRing) { scene.remove(enemy.slamRing); enemy.slamRing = null; }
    const idx = enemies.indexOf(enemy);
    if (idx !== -1) enemies.splice(idx, 1);
    [enemy.body, enemy.head].forEach((m) => {
      const hi = enemyHitMeshes.indexOf(m);
      if (hi !== -1) enemyHitMeshes.splice(hi, 1);
    });
  }

  function playerPos() {
    return new THREE.Vector3(yawObject.position.x, EYE_HEIGHT, yawObject.position.z);
  }

  function spawnEnemyTracer(from, to, color) {
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    setTimeout(() => { scene.remove(line); geometry.dispose(); material.dispose(); }, 130);

    const flash = new THREE.PointLight(color, 3, 5);
    flash.position.copy(from);
    scene.add(flash);
    setTimeout(() => scene.remove(flash), 90);
  }

  function damagePlayer(dmg, attackerType) {
    if (player.armor > 0) {
      player.armor--;
      sfxArmorBlock();
      addMessage(`Armor plate absorbs the hit! (${player.armor} left)`);
      updateHUD();
      return;
    }
    player.hp -= dmg;
    flashDamage();
    sfxPlayerHurt();
    if (attackerType) {
      const label = ENEMY_DISPLAY_NAME[attackerType] || attackerType;
      const subject = BOSS_TYPES[attackerType] ? label : `A ${label}`;
      addMessage(`${subject} ${ATTACK_VERBS[attackerType] || 'hits'} you for ${dmg}.`);
    }
    if (player.hp <= 0 && gameState !== 'GAMEOVER') {
      player.hp = 0;
      endGame();
    }
    updateHUD();
  }

  // ---------- Projectiles (dodgeable ranged attacks) ----------
  const PROJECTILE_SPEED = 24;
  const PROJECTILE_HIT_RADIUS = 0.55;
  const PROJECTILE_MAX_LIFE = 3;
  const projectiles = [];

  function spawnProjectile(from, to, dmg, ownerType) {
    const dir = new THREE.Vector3().subVectors(to, from).normalize();
    const color = ownerType === 'brute' ? 0xff5533 : 0xffcc44;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 6, 6),
      new THREE.MeshBasicMaterial({ color })
    );
    mesh.position.copy(from);
    scene.add(mesh);
    projectiles.push({ mesh, pos: from.clone(), dir, dmg, ownerType, life: 0 });
  }

  function removeProjectile(p) {
    scene.remove(p.mesh);
    const i = projectiles.indexOf(p);
    if (i !== -1) projectiles.splice(i, 1);
  }

  function updateProjectiles(dt) {
    const pPos = playerPos();
    for (const p of [...projectiles]) {
      p.life += dt;
      p.pos.addScaledVector(p.dir, PROJECTILE_SPEED * dt);
      p.mesh.position.copy(p.pos);

      if (p.pos.distanceTo(pPos) < PROJECTILE_HIT_RADIUS) {
        damagePlayer(p.dmg, p.ownerType);
        removeProjectile(p);
        continue;
      }
      let blocked = false;
      for (const pillar of pillars) {
        const closestX = clamp(p.pos.x, pillar.x - pillar.hx, pillar.x + pillar.hx);
        const closestZ = clamp(p.pos.z, pillar.z - pillar.hz, pillar.z + pillar.hz);
        const dx = p.pos.x - closestX, dz = p.pos.z - closestZ;
        if (dx * dx + dz * dz < 0.05 && p.pos.y < 3.4) { blocked = true; break; }
      }
      if (blocked || p.life > PROJECTILE_MAX_LIFE) removeProjectile(p);
    }
  }

  // ---------- Sniper attack (shared by regular sniper enemies and the Marksman boss) ----------
  function updateSniperAttack(enemy, ex, ez, dist, pPos, now) {
    const eyePos = new THREE.Vector3(ex, 1.6, ez);
    if (enemy.sniperState === 'aiming') {
      const visible = hasLineOfSight(eyePos, pPos);
      updateLaserBeam(enemy.laserLine, eyePos, pPos);
      const telegraphElapsed = now - enemy.aimStart;
      const pulse = 0.5 + 0.5 * Math.sin(telegraphElapsed * 0.03);
      enemy.laserLine.material.opacity = visible ? 0.5 + pulse * 0.5 : 0.2;
      if (telegraphElapsed > enemy.telegraphDuration) {
        enemy.sniperState = 'idle';
        enemy.laserLine.visible = false;
        enemy.lastAttack = now;
        if (hasLineOfSight(eyePos, pPos)) {
          const dmg = randInt(enemy.dmg[0], enemy.dmg[1]);
          damagePlayer(dmg, enemy.type);
          spawnEnemyTracer(eyePos, pPos.clone(), 0xff2222);
        } else {
          addMessage(`${enemy.isBoss ? enemy.bossName + "'s" : "The sniper's"} shot goes wide!`);
        }
      }
      return;
    }
    if (dist <= enemy.attackRange && now - enemy.lastAttack > enemy.attackCooldown && hasLineOfSight(eyePos, pPos)) {
      enemy.sniperState = 'aiming';
      enemy.aimStart = now;
      enemy.laserLine.visible = true;
    }
  }

  // ---------- Boss special attacks ----------
  function updateBossSpecial(enemy, dt, now, pPos) {
    if (enemy.special === 'charge') {
      if (enemy.specialState === 'idle') {
        const d = Math.hypot(pPos.x - enemy.group.position.x, pPos.z - enemy.group.position.z);
        if (now - enemy.specialLastUsed > 5500 && d > 5 && d < 18 &&
            hasLineOfSight(new THREE.Vector3(enemy.group.position.x, 1.2, enemy.group.position.z), pPos)) {
          enemy.specialState = 'telegraph';
          enemy.specialStart = now;
          enemy.body.material.color.setHex(0xffdd55);
        }
      } else if (enemy.specialState === 'telegraph') {
        if (now - enemy.specialStart > 550) {
          enemy.specialState = 'charging';
          enemy.specialStart = now;
          const dx = pPos.x - enemy.group.position.x, dz = pPos.z - enemy.group.position.z;
          const d = Math.hypot(dx, dz) || 1;
          enemy.chargeDir = { x: dx / d, z: dz / d };
          enemy.chargeHit = false;
        }
      } else if (enemy.specialState === 'charging') {
        const speed = 15;
        const nx = enemy.group.position.x + enemy.chargeDir.x * speed * dt;
        const nz = enemy.group.position.z + enemy.chargeDir.z * speed * dt;
        const resolved = resolvePillarCollision(nx, nz, ENEMY_RADIUS * 1.3);
        const hitWall = Math.abs(resolved.x - nx) > 0.05 || Math.abs(resolved.z - nz) > 0.05;
        enemy.group.position.x = resolved.x;
        enemy.group.position.z = resolved.z;
        const pd = Math.hypot(pPos.x - resolved.x, pPos.z - resolved.z);
        if (!enemy.chargeHit && pd < 1.4) {
          enemy.chargeHit = true;
          const dmg = randInt(enemy.dmg[0] + 10, enemy.dmg[1] + 16);
          damagePlayer(dmg, enemy.type);
        }
        if (hitWall || now - enemy.specialStart > 1100) {
          enemy.specialState = 'recover';
          enemy.specialStart = now;
        }
      } else if (enemy.specialState === 'recover') {
        enemy.body.material.color.setHex(enemy.baseBodyColor);
        if (now - enemy.specialStart > 700) {
          enemy.specialState = 'idle';
          enemy.specialLastUsed = now;
        }
      }
    } else if (enemy.special === 'reposition') {
      if (enemy.sniperState !== 'aiming' && now - enemy.specialLastUsed > 7000) {
        const sp = SPAWN_POINTS[randInt(0, SPAWN_POINTS.length - 1)];
        enemy.group.position.set(sp.x, 0, sp.z);
        enemy.specialLastUsed = now;
        addMessage(`${enemy.bossName} repositions!`);
      }
    } else if (enemy.special === 'summon') {
      if (now - enemy.specialLastUsed > 8000) {
        enemy.specialLastUsed = now;
        for (let i = 0; i < 2; i++) {
          const angle = Math.random() * Math.PI * 2;
          spawnEnemy('melee', { x: enemy.group.position.x + Math.cos(angle) * 2, z: enemy.group.position.z + Math.sin(angle) * 2 });
        }
        addMessage(`${enemy.bossName} summons reinforcements!`);
      }
    } else if (enemy.special === 'slam') {
      const d = Math.hypot(pPos.x - enemy.group.position.x, pPos.z - enemy.group.position.z);
      if (enemy.specialState === 'idle' && now - enemy.specialLastUsed > 6000 && d < 8) {
        enemy.specialState = 'telegraph';
        enemy.specialStart = now;
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(4.6, 5, 32),
          new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(enemy.group.position.x, 0.05, enemy.group.position.z);
        scene.add(ring);
        enemy.slamRing = ring;
      } else if (enemy.specialState === 'telegraph' && now - enemy.specialStart > 700) {
        enemy.specialState = 'idle';
        enemy.specialLastUsed = now;
        if (enemy.slamRing) { scene.remove(enemy.slamRing); enemy.slamRing = null; }
        if (d < 5) {
          const dmg = randInt(enemy.dmg[0] + 8, enemy.dmg[1] + 14);
          damagePlayer(dmg, enemy.type);
          addMessage(`${enemy.bossName} slams the ground!`);
        }
      }
    }
  }

  function updateEnemies(dt) {
    const pPos = playerPos();
    const now = performance.now();
    for (const enemy of [...enemies]) {
      if (enemy.dying) {
        const t = (now - enemy.deathStart) / 450;
        if (t >= 1) { removeEnemy(enemy); continue; }
        const ease = t * t;
        enemy.group.scale.setScalar(enemy.baseScale * (1 - ease * 0.7));
        enemy.group.position.y = -ease * 0.6;
        enemy.group.rotation.x = ease * (Math.PI / 2.2);
        continue;
      }

      const isChargeActive = enemy.isBoss && enemy.special === 'charge' && enemy.specialState !== 'idle';
      const skipMovement = enemy.sniperState === 'aiming' || isChargeActive;

      const ex = enemy.group.position.x, ez = enemy.group.position.z;
      const dx = pPos.x - ex, dz = pPos.z - ez;
      const dist = Math.hypot(dx, dz);

      if (!skipMovement) {
        let moveX = 0, moveZ = 0;
        if (dist > enemy.attackRange * 0.8) {
          moveX = dx / dist; moveZ = dz / dist;
        } else if (dist < enemy.retreatRange) {
          moveX = -dx / dist; moveZ = -dz / dist;
        }
        for (const other of enemies) {
          if (other === enemy || other.dying) continue;
          const odx = ex - other.group.position.x, odz = ez - other.group.position.z;
          const od = Math.hypot(odx, odz);
          if (od > 0 && od < 1.1) { moveX += odx / od * 0.5; moveZ += odz / od * 0.5; }
        }
        const mlen = Math.hypot(moveX, moveZ);
        if (mlen > 0.001) {
          moveX /= mlen; moveZ /= mlen;
          const nx = ex + moveX * enemy.speed * dt;
          const nz = ez + moveZ * enemy.speed * dt;
          const resolved = resolvePillarCollision(nx, nz, ENEMY_RADIUS);
          enemy.group.position.x = resolved.x;
          enemy.group.position.z = resolved.z;
          enemy.group.rotation.y = Math.atan2(-dx, -dz);
        }
      }

      if (enemy.weaponType === 'sniper') {
        updateSniperAttack(enemy, ex, ez, dist, pPos, now);
      } else if (!isChargeActive && dist <= enemy.attackRange && now - enemy.lastAttack > enemy.attackCooldown) {
        const enemyHead = new THREE.Vector3(ex, 1.6, ez);
        if (hasLineOfSight(enemyHead, pPos)) {
          enemy.lastAttack = now;
          const dmg = randInt(enemy.dmg[0], enemy.dmg[1]);
          if (enemy.weaponType === 'gun') {
            if (enemy.isBoss && enemy.special === 'burst') {
              for (let i = 0; i < 3; i++) {
                setTimeout(() => {
                  if (enemy.dying) return;
                  const mz = new THREE.Vector3(enemy.group.position.x, 1.1, enemy.group.position.z);
                  spawnProjectile(mz, playerPos(), dmg, enemy.type);
                }, i * 130);
              }
            } else {
              const muzzle = new THREE.Vector3(ex, 1.1, ez);
              spawnProjectile(muzzle, pPos.clone(), dmg, enemy.type);
            }
          } else {
            const contact = new THREE.Vector3(ex, 1.1, ez);
            spawnEnemyTracer(contact, pPos.clone(), 0xeeeeee);
            damagePlayer(dmg, enemy.type);
          }
        }
      }

      if (enemy.isBoss) updateBossSpecial(enemy, dt, now, pPos);

      const flashColor = now < enemy.hitFlashUntil;
      enemy.body.material.color.setHex(flashColor ? 0xffffff : enemy.baseBodyColor);
      enemy.head.material.color.setHex(flashColor ? 0xffffff : enemy.baseHeadColor);
    }
  }

  // ---------- Round flow ----------
  function startRound(n) {
    round = n;
    gameState = 'ROUND_INTRO';
    player.armor = player.armorCapacity;
    killStreak = 0;
    lastKillTime = -Infinity;
    updateHUD();
    showBanner(n % 5 === 0 ? `Round ${n} — Boss!` : `Round ${n}`, 1800);
    if (n % 5 === 0) sfxBossAppear(); else sfxRoundStart();
    setTimeout(() => {
      if (gameState !== 'ROUND_INTRO') return;
      gameState = 'ROUND_ACTIVE';
      spawnRoundEnemies(n);
      addMessage(`Round ${n} begins.`);
      updateHUD();
    }, 1900);
  }

  function checkRoundComplete() {
    if (gameState !== 'ROUND_ACTIVE') return;
    if (pendingSpawns === 0 && enemies.length === 0) {
      const bonus = 20 + round * 5;
      player.gold += bonus;
      addMessage(`Round ${round} cleared! +${bonus} gold bonus`);
      sfxRoundClear();
      gameState = 'SHOP';
      openShop();
    }
  }

  // ---------- Shop ----------
  function renderShop() {
    el('shopGold').textContent = `Gold: ${player.gold}`;
    el('shopStatus').textContent = `HP: ${Math.round(player.hp)}/${player.maxHp}   Armor: ${player.armorCapacity > 0 ? `${player.armor}/${player.armorCapacity}` : 'none'}`;

    const grid = el('shopGrid');
    grid.innerHTML = '';
    WEAPON_ORDER.filter(id => id !== 'pistol').forEach((id) => {
      const w = WEAPONS[id];
      const owned = player.owned.includes(id);
      const card = document.createElement('div');
      card.className = 'weaponCard' + (owned ? ' owned' : '');
      card.innerHTML = `
        <h3>${w.name}</h3>
        <div class="stat">Damage: ${w.damage}${w.pellets > 1 ? ' x' + w.pellets : ''}</div>
        <div class="stat">Fire rate: ${w.auto ? 'auto' : 'semi'} (${w.cooldown}ms)</div>
        <div class="stat">Magazine: ${w.magSize}</div>
        <div class="stat">Price: ${w.price} gold</div>
      `;
      const btn = document.createElement('button');
      if (owned) {
        btn.textContent = 'Owned';
        btn.disabled = true;
      } else {
        btn.textContent = 'Buy';
        btn.disabled = player.gold < w.price;
        btn.onclick = () => buyWeapon(id);
      }
      card.appendChild(btn);
      grid.appendChild(card);
    });

    const armorGrid = el('armorGrid');
    armorGrid.innerHTML = '';
    ARMOR_TIERS.forEach((tier) => {
      const owned = player.armorCapacity >= tier.plates;
      const card = document.createElement('div');
      card.className = 'weaponCard' + (owned ? ' owned' : '');
      card.innerHTML = `
        <h3>${tier.name}</h3>
        <div class="stat">Blocks ${tier.plates} hit${tier.plates > 1 ? 's' : ''} before HP loss</div>
        <div class="stat">Refills free each round</div>
        <div class="stat">Price: ${tier.price} gold</div>
      `;
      const btn = document.createElement('button');
      if (owned) {
        btn.textContent = 'Owned';
        btn.disabled = true;
      } else {
        btn.textContent = 'Buy';
        btn.disabled = player.gold < tier.price;
        btn.onclick = () => buyArmor(tier.id);
      }
      card.appendChild(btn);
      armorGrid.appendChild(card);
    });

    const medkitGrid = el('medkitGrid');
    medkitGrid.innerHTML = '';
    HEALTH_POTIONS.forEach((potion) => {
      const full = player.hp >= player.maxHp;
      const card = document.createElement('div');
      card.className = 'weaponCard';
      card.innerHTML = `
        <h3>${potion.name}</h3>
        <div class="stat">Heals ${potion.heal} HP instantly</div>
        <div class="stat">Price: ${potion.price} gold</div>
      `;
      const btn = document.createElement('button');
      btn.textContent = 'Use';
      btn.disabled = full || player.gold < potion.price;
      btn.onclick = () => buyPotion(potion.id);
      card.appendChild(btn);
      medkitGrid.appendChild(card);
    });

    const perkGrid = el('perkGrid');
    perkGrid.innerHTML = '';
    Object.keys(PERKS).forEach((id) => {
      const perk = PERKS[id];
      const owned = player.perks[id];
      const card = document.createElement('div');
      card.className = 'weaponCard' + (owned ? ' owned' : '');
      card.innerHTML = `<h3>${perk.name}</h3><div class="stat">${perk.desc}</div><div class="stat">Price: ${perk.price} gold</div>`;
      const btn = document.createElement('button');
      if (owned) {
        btn.textContent = 'Owned';
        btn.disabled = true;
      } else {
        btn.textContent = 'Buy';
        btn.disabled = player.gold < perk.price;
        btn.onclick = () => buyPerk(id);
      }
      card.appendChild(btn);
      perkGrid.appendChild(card);
    });

    const upgradeList = el('upgradeList');
    upgradeList.innerHTML = '';
    player.owned.filter(id => id !== 'knife').forEach((id) => {
      if (!player.upgrades[id]) player.upgrades[id] = { extMag: false, rapid: false, laser: false };
      const owned = player.upgrades[id];
      const row = document.createElement('div');
      row.className = 'upgradeRow';
      const label = document.createElement('div');
      label.className = 'upgradeLabel';
      label.textContent = WEAPONS[id].name;
      row.appendChild(label);
      Object.keys(UPGRADE_DEFS).forEach((upId) => {
        const def = UPGRADE_DEFS[upId];
        const btn = document.createElement('button');
        if (owned[upId]) {
          btn.textContent = `${def.name} ✓`;
          btn.disabled = true;
          btn.className = 'upgradeOwned';
        } else {
          btn.textContent = `${def.name} (${def.price}g)`;
          btn.disabled = player.gold < def.price;
          btn.onclick = () => buyUpgrade(id, upId);
        }
        row.appendChild(btn);
      });
      upgradeList.appendChild(row);
    });
  }

  function buyWeapon(id) {
    const w = WEAPONS[id];
    if (player.owned.includes(id) || player.gold < w.price) return;
    player.gold -= w.price;
    player.owned.push(id);
    player.ammo[id] = getWeaponStats(id).magSize;
    sfxPurchase();
    addMessage(`Bought ${w.name}.`);
    renderShop();
    updateHUD();
  }

  function buyArmor(id) {
    const tier = ARMOR_TIERS.find(t => t.id === id);
    if (!tier || player.armorCapacity >= tier.plates || player.gold < tier.price) return;
    player.gold -= tier.price;
    player.armorCapacity = tier.plates;
    player.armor = tier.plates;
    sfxPurchase();
    addMessage(`Bought ${tier.name}.`);
    renderShop();
    updateHUD();
  }

  function buyPotion(id) {
    const potion = HEALTH_POTIONS.find(p => p.id === id);
    if (!potion || player.hp >= player.maxHp || player.gold < potion.price) return;
    player.gold -= potion.price;
    player.hp = Math.min(player.maxHp, player.hp + potion.heal);
    sfxPurchase();
    addMessage(`Used ${potion.name}. +${potion.heal} HP.`);
    renderShop();
    updateHUD();
  }

  function buyPerk(id) {
    const perk = PERKS[id];
    if (!perk || player.perks[id] || player.gold < perk.price) return;
    player.gold -= perk.price;
    player.perks[id] = true;
    if (id === 'moreHp') { player.maxHp += 30; player.hp += 30; }
    sfxPurchase();
    addMessage(`Perk acquired: ${perk.name}.`);
    renderShop();
    updateHUD();
  }

  function buyUpgrade(weaponId, upgradeId) {
    const def = UPGRADE_DEFS[upgradeId];
    if (!player.upgrades[weaponId]) player.upgrades[weaponId] = { extMag: false, rapid: false, laser: false };
    if (player.upgrades[weaponId][upgradeId] || player.gold < def.price) return;
    player.gold -= def.price;
    player.upgrades[weaponId][upgradeId] = true;
    if (upgradeId === 'extMag') {
      const stats = getWeaponStats(weaponId);
      player.ammo[weaponId] = stats.magSize;
    }
    sfxPurchase();
    addMessage(`${WEAPONS[weaponId].name}: ${def.name} installed.`);
    renderShop();
    updateHUD();
  }

  function openShop() {
    exitPointerLockIfLocked();
    renderShop();
    el('shop').style.display = 'flex';
  }

  function closeShopAndContinue() {
    el('shop').style.display = 'none';
    requestPointerLock();
    startRound(round + 1);
  }
  el('shopContinue').addEventListener('click', closeShopAndContinue);

  // ---------- Game over / restart ----------
  function endGame() {
    gameState = 'GAMEOVER';
    exitPointerLockIfLocked();
    sfxDeath();
    const timeStr = formatTime(elapsedMs);
    let bestMsg = '';
    if (round > highScore.bestRound || (round === highScore.bestRound && elapsedMs > highScore.bestTimeMs)) {
      highScore = { bestRound: round, bestTimeMs: elapsedMs, bestGold: player.gold };
      saveHighScore(highScore);
      bestMsg = ' New best!';
    }
    el('gameOverText').textContent = `You reached round ${round} with ${player.gold} gold in ${timeStr}.${bestMsg}`;
    el('gameOverOverlay').style.display = 'flex';
    addMessage('You died.');
  }

  function resetGame() {
    for (const e of [...enemies]) removeEnemy(e);
    for (const p of [...projectiles]) removeProjectile(p);
    player.hp = 100;
    player.maxHp = 100;
    player.gold = 0;
    player.armor = 0;
    player.armorCapacity = 0;
    player.owned = ['pistol', 'knife'];
    player.ammo = { pistol: WEAPONS.pistol.magSize, knife: Infinity };
    player.reloading = false;
    player.upgrades = {};
    player.perks = { fastReload: false, moreHp: false, speed: false, dash: false };
    dashCooldownUntil = 0;
    dashActiveUntil = 0;
    setCurrentWeapon('pistol');
    yawObject.position.set(0, EYE_HEIGHT, 8);
    yawObject.rotation.y = 0;
    pitchObject.rotation.x = 0;
    runStartTime = performance.now();
    if (highScore.bestRound > 0) {
      el('bestScoreText').textContent = `Best so far: Round ${highScore.bestRound} (${formatTime(highScore.bestTimeMs)})`;
    }
    updateHUD();
  }
  if (highScore.bestRound > 0) {
    el('bestScoreText').textContent = `Best so far: Round ${highScore.bestRound} (${formatTime(highScore.bestTimeMs)})`;
  }

  el('restartBtn').addEventListener('click', () => {
    initAudio();
    el('gameOverOverlay').style.display = 'none';
    resetGame();
    requestPointerLock();
    startRound(1);
  });

  el('startBtn').addEventListener('click', () => {
    initAudio();
    el('startOverlay').style.display = 'none';
    resetGame();
    requestPointerLock();
    startRound(1);
  });

  // ---------- Input ----------
  const isFirefox = /firefox/i.test(navigator.userAgent);
  function lockPointer() {
    // unadjustedMovement disables OS mouse acceleration/smoothing for pointer-lock deltas.
    // Firefox doesn't support this option; passing it is harmless (Firefox ignores unknown options).
    const p = canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => canvas.requestPointerLock());
  }
  function requestPointerLock() {
    // On some Linux browser+compositor combos, pointer lock doesn't fully decouple from the real
    // OS cursor, which can get pinned at the actual screen edge. Going fullscreen first helps on
    // Chromium. Firefox+X11 has its own separate history of fullscreen+pointer-lock interaction
    // bugs though, so skip forcing fullscreen there and use plain windowed pointer lock instead —
    // isolates whether the fullscreen combo is actually making things worse specifically on Firefox.
    // Fullscreen a common ancestor of the canvas AND the HUD/shop overlay divs (documentElement),
    // not the canvas alone — the Fullscreen API hides everything outside the fullscreen element's
    // subtree, and the HUD divs are siblings of <canvas>, not descendants of it.
    const fsRoot = document.documentElement;
    if (!isFirefox && !document.fullscreenElement && fsRoot.requestFullscreen) {
      fsRoot.requestFullscreen().then(lockPointer, lockPointer);
    } else {
      lockPointer();
    }
  }
  function exitPointerLockIfLocked() { if (document.pointerLockElement === canvas) document.exitPointerLock(); }

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (!locked && (gameState === 'ROUND_ACTIVE' || gameState === 'ROUND_INTRO')) {
      el('paused').style.display = 'flex';
    } else {
      el('paused').style.display = 'none';
    }
  });

  el('paused').addEventListener('click', () => requestPointerLock());

  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    // Defensive clamp: some browser/driver combinations occasionally report a single anomalous
    // huge movementX/Y value under pointer lock, which would otherwise snap the view hard against
    // the pitch limit in one frame and make it feel "stuck" until the opposite direction is pressed.
    const mx = clamp(e.movementX, -100, 100);
    const my = clamp(e.movementY, -100, 100);
    yawObject.rotation.y -= mx * MOUSE_SENSITIVITY;
    pitchObject.rotation.x -= my * MOUSE_SENSITIVITY;
    pitchObject.rotation.x = clamp(pitchObject.rotation.x, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
  });

  canvas.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== canvas) { requestPointerLock(); return; }
    if (e.button === 0) { player.mouseDown = true; tryFire(); }
    if (e.button === 2 && WEAPONS[player.currentId].zoom) {
      sniperZoomed = true;
      camera.fov = baseFov * 0.35;
      camera.updateProjectionMatrix();
    }
  });
  canvas.addEventListener('mouseup', (e) => {
    if (e.button === 0) { player.mouseDown = false; player.canFireSemi = true; }
    if (e.button === 2) {
      sniperZoomed = false;
      camera.fov = baseFov;
      camera.updateProjectionMatrix();
    }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function tryDash() {
    if (!player.perks.dash || gameState !== 'ROUND_ACTIVE') return;
    const now = performance.now();
    if (now < dashCooldownUntil) return;
    let mx = 0, mz = 0;
    if (keys['KeyW']) mz -= 1;
    if (keys['KeyS']) mz += 1;
    if (keys['KeyA']) mx -= 1;
    if (keys['KeyD']) mx += 1;
    if (mx === 0 && mz === 0) mz = -1;
    const len = Math.hypot(mx, mz) || 1;
    mx /= len; mz /= len;
    const yaw = yawObject.rotation.y;
    const forward = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    dashDir = { x: forward.x * -mz + right.x * mx, z: forward.z * -mz + right.z * mx };
    dashActiveUntil = now + DASH_DURATION;
    dashCooldownUntil = now + DASH_COOLDOWN;
    sfxDash();
  }

  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'KeyR') reload();
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') tryDash();
    const numMap = { Digit1: 'pistol', Digit2: 'smg', Digit3: 'shotgun', Digit4: 'ak', Digit5: 'sniper', Digit6: 'knife' };
    if (numMap[e.code]) setCurrentWeapon(numMap[e.code]);
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  // ---------- Movement ----------
  function updatePlayerMovement(dt) {
    const now = performance.now();
    let worldDx, worldDz;
    if (now < dashActiveUntil) {
      worldDx = dashDir.x * DASH_SPEED * dt;
      worldDz = dashDir.z * DASH_SPEED * dt;
    } else {
      let moveX = 0, moveZ = 0;
      if (keys['KeyW']) moveZ -= 1;
      if (keys['KeyS']) moveZ += 1;
      if (keys['KeyA']) moveX -= 1;
      if (keys['KeyD']) moveX += 1;
      if (moveX === 0 && moveZ === 0) return;
      const len = Math.hypot(moveX, moveZ);
      moveX /= len; moveZ /= len;
      const yaw = yawObject.rotation.y;
      const forward = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
      const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
      const speed = MOVE_SPEED * (player.perks.speed ? 1.2 : 1);
      worldDx = (forward.x * -moveZ + right.x * moveX) * speed * dt;
      worldDz = (forward.z * -moveZ + right.z * moveX) * speed * dt;
    }
    const resolved = resolvePillarCollision(yawObject.position.x + worldDx, yawObject.position.z + worldDz, PLAYER_RADIUS);
    yawObject.position.x = resolved.x;
    yawObject.position.z = resolved.z;
  }

  // ---------- Main loop ----------
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    if (gameState === 'ROUND_ACTIVE' || gameState === 'ROUND_INTRO') {
      updatePlayerMovement(dt);
    }
    if (gameState === 'ROUND_ACTIVE') {
      if (player.mouseDown && WEAPONS[player.currentId].auto) tryFire();
      updateEnemies(dt);
      updateProjectiles(dt);
      checkRoundComplete();

      const upg = player.upgrades[player.currentId];
      if (upg && upg.laser) {
        const origin = new THREE.Vector3();
        camera.getWorldPosition(origin);
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        raycaster.set(origin, dir);
        raycaster.far = 60;
        const hits = raycaster.intersectObjects([...pillarMeshes, ...enemyHitMeshes], false);
        const endPoint = hits.length ? hits[0].point : origin.clone().addScaledVector(dir, 60);
        updateLaserBeam(playerLaserLine, origin, endPoint);
      } else {
        playerLaserLine.visible = false;
      }
    } else {
      playerLaserLine.visible = false;
    }

    updateHUD();

    const g = gunModels[player.currentId];
    if (g) g.position.z += (0 - g.position.z) * Math.min(1, dt * 14);

    if (vignetteAlpha > 0) {
      vignetteAlpha = Math.max(0, vignetteAlpha - dt * 2.2);
      el('vignette').style.opacity = String(vignetteAlpha * 0.8);
    }
    if (performance.now() > hitMarkerUntil) el('hitmarker').style.opacity = '0';

    renderer.render(scene, camera);
  }
  animate();
})();
