// 1v1 arena duel — real-time tick-loop game like slither (see server/games/shooter.js), but
// with server-authoritative movement + hit detection instead of slither's angle-only steering.
// Camera rig / arena / pointer-lock math ported from 3dgames/shooter/game.js (see IDEAS.md #0);
// the vendored non-module three.min.js there is reused as-is (see vendor/three.min.js) since it
// can't be `import`ed as an ES module — it's injected as a classic <script> tag on first mount.
//
// Two sub-views: a lobby view (seat picker + scoreboard, inside the hub's normal boxed
// .game-mount) and a full-viewport arena view (this game's new precedent in the hub — every
// other game stays inside the boxed layout) shown only while the local player is seated and a
// round is live/just-decided.

// Kept in sync by hand with server/games/shooter.js constants (no shared module in this repo,
// same convention as slither's SERVER_TICK_MS/START_LENGTH).
const SERVER_TICK_MS = 33;
const ARENA_HALF = 22;
const ARENA_BOUND = ARENA_HALF - 0.6;
const EYE_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;
const MOVE_SPEED = 10.5;
const CROUCH_SPEED_MULT = 0.5;
const CROUCH_EYE_HEIGHT = 1.0;
const CROUCH_BODY_HITBOX_Y = 0.65;
// 1/s blend rate for the crouch/slide low-profile visual transition (eye height + avatar pose) —
// purely cosmetic smoothing, not the underlying hit-test which stays an instant boolean. Fast
// enough to reach ~95% of the target in ~100ms: still visibly smoothed (not an instant snap) but
// short enough that firing mid-transition — when the rendered eye height and the server's
// discrete height can briefly disagree — only ever has a small, brief window to cause a mismatch,
// rather than the ~300ms window the original slower rate left open (measured contributor to
// "first-person accuracy feels slightly off").
const LOW_PROFILE_TRANSITION_RATE = 30;
const JUMP_VELOCITY = 6.5;
const GRAVITY = 18;
const ACCEL_RATE = 16;
const DECEL_RATE = 22;
const AIR_DECEL_RATE = 1.5;
const SLIDE_SPEED = 15;
const SLIDE_STEER_RATE = 6;
const SLIDE_DURATION_MS = 500;
const SLIDE_COOLDOWN_MS = 1100;
const BASE_FOV = 75;
const SNIPER_ZOOM_FOV_MULT = 0.35;
const WALL_HEIGHT = 6;
const THIRDPERSON_CAMERA_OFFSET = { y: 0.55, z: 3.4 };
const PILLARS = [
  { x: 8, z: 8, hx: 1.1, hz: 1.1, height: 3.4 },
  { x: -8, z: 8, hx: 1.1, hz: 1.1, height: 3.4 },
  { x: 8, z: -8, hx: 1.1, hz: 1.1, height: 3.4 },
  { x: -8, z: -8, hx: 1.1, hz: 1.1, height: 3.4 },
  { x: 0, z: 13, hx: 1.1, hz: 1.1, height: 3.4 },
  { x: 0, z: -13, hx: 1.1, hz: 1.1, height: 3.4 },
];
const BODY_HITBOX_RADIUS = 0.45;
const BODY_HITBOX_Y = 1.0;
const HEAD_HITBOX_RADIUS = 0.22;

const LOOK_SEND_MS = 70;
const LOOK_EPSILON = 0.01;
const RECONCILE_EPSILON_SQ = 0.2 * 0.2;
const TELEPORT_RECONCILE_DIST_SQ = 2 * 2;
const RECONCILE_SMOOTH_RATE = 0.25; // fraction of the remaining gap corrected per state broadcast
const TELEPORT_DIST_SQ = 3 * 3;

const WEAPON_IDS = ['pistol', 'shotgun', 'sniper'];
const WEAPON_KEYS = { Digit1: 'pistol', Digit2: 'shotgun', Digit3: 'sniper' };
const WEAPON_LABELS = { pistol: 'PISTOL', shotgun: 'SHOTGUN', sniper: 'SNIPER' };
const WEAPON_COLORS = { pistol: 0x9a9a9a, shotgun: 0xff9933, sniper: 0x33cc66 };

// Per-browser player preferences (sensitivity + keybinds) — local to this device/browser, not
// server state, so localStorage is the right place (matches this hub's general convention of
// sessionStorage/localStorage for client-only preferences vs. server-authoritative game state).
const SETTINGS_KEY = 'shooter.settings.v1';
const REBINDABLE_ACTIONS = [
  { id: 'jump', label: 'JUMP' },
  { id: 'crouch', label: 'CROUCH' },
  { id: 'slide', label: 'SLIDE' },
  { id: 'reload', label: 'RELOAD' },
  { id: 'thirdPerson', label: 'TOGGLE 3RD PERSON' },
  { id: 'weapon1', label: 'WEAPON: PISTOL' },
  { id: 'weapon2', label: 'WEAPON: SHOTGUN' },
  { id: 'weapon3', label: 'WEAPON: SNIPER' },
];
const DEFAULT_SETTINGS = {
  sensitivity: 0.0022,
  // Defaults to roughly the sniper scope's FOV ratio (0.35x) so the physical-mouse-to-screen-
  // degrees mapping feels consistent when zooming in, while still being independently adjustable.
  scopedSensitivity: 0.00077,
  keybinds: {
    jump: 'Space', crouch: 'KeyC', slide: 'ShiftLeft', reload: 'KeyR', thirdPerson: 'KeyV',
    weapon1: 'Digit1', weapon2: 'Digit2', weapon3: 'Digit3',
  },
};
function cloneSettings(s) {
  return { ...s, keybinds: { ...s.keybinds } };
}
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return cloneSettings(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    return {
      ...cloneSettings(DEFAULT_SETTINGS),
      ...parsed,
      keybinds: { ...DEFAULT_SETTINGS.keybinds, ...(parsed.keybinds || {}) },
    };
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}
function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable (private browsing, etc.) — settings just won't persist, not fatal.
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Human-readable label for a KeyboardEvent.code, for displaying current keybinds.
function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const specials = {
    Space: 'SPACE', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT',
    ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', AltLeft: 'L-ALT', AltRight: 'R-ALT',
  };
  return specials[code] || code.toUpperCase();
}

// Primitive-based weapon models ported from 3dgames/shooter/game.js's viewmodel builders
// (buildPistol/buildShotgun/buildSniper — smg/ak/knife dropped, not in this game's weapon set).
// Reused for three purposes: the local first-person viewmodel (attached to the camera), the
// opponent's held weapon (attached to their avatar), and the local third-person avatar's held
// weapon — same geometry, different parent/scale/position per use site.
function darkMat(THREE) {
  return new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.5, metalness: 0.3 });
}
function buildPistolMesh(THREE, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.4 });
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.075, 0.3), mat);
  slide.position.set(0, 0.05, -0.1);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.19, 0.09), darkMat(THREE));
  grip.position.set(0, -0.08, 0.05);
  grip.rotation.x = -0.28;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 8), darkMat(THREE));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.05, -0.3);
  g.add(slide, grip, barrel);
  g.userData.muzzleZ = -0.35;
  return g;
}
function buildShotgunMesh(THREE, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.42, 8), mat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.06, -0.22);
  const pump = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.14), darkMat(THREE));
  pump.position.set(0, 0.025, -0.2);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.16, 0.08), darkMat(THREE));
  grip.position.set(0, -0.06, 0.05);
  grip.rotation.x = -0.3;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.2), new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.75 }));
  stock.position.set(0, 0.02, 0.23);
  g.add(barrel, pump, grip, stock);
  g.userData.muzzleZ = -0.43;
  return g;
}
function buildSniperMesh(THREE, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.6), mat);
  body.position.set(0, 0.04, -0.12);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.32, 8), darkMat(THREE));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.04, -0.58);
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 10), darkMat(THREE));
  scope.position.set(0, 0.12, -0.15);
  scope.rotation.x = Math.PI / 2;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 0.07), darkMat(THREE));
  grip.position.set(0, -0.06, 0.1);
  grip.rotation.x = -0.25;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.22), darkMat(THREE));
  stock.position.set(0, 0.03, 0.33);
  g.add(body, barrel, scope, grip, stock);
  g.userData.muzzleZ = -0.74;
  return g;
}
const GUN_BUILDERS = { pistol: buildPistolMesh, shotgun: buildShotgunMesh, sniper: buildSniperMesh };

// Builds a held-weapon rig: one Group per weapon id (only the equipped one visible at a time)
// plus a shared muzzle flash (PointLight + billboard plane), parented under `parent` at `offset`.
// Used for the local first-person viewmodel (parent = camera), the opponent's held weapon
// (parent = opponent avatar group), and the local third-person avatar's held weapon.
function buildHeldGunRig(THREE, parent, offset, scale) {
  const rig = new THREE.Group();
  rig.position.set(offset.x, offset.y, offset.z);
  if (scale) rig.scale.setScalar(scale);
  parent.add(rig);

  const models = {};
  for (const id of WEAPON_IDS) {
    const g = GUN_BUILDERS[id](THREE, WEAPON_COLORS[id]);
    g.visible = false;
    rig.add(g);
    models[id] = g;
  }

  const flashLight = new THREE.PointLight(0xffcc66, 0, 4);
  rig.add(flashLight);
  const flashMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.15, 0.15),
    new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0.9 })
  );
  flashMesh.visible = false;
  rig.add(flashMesh);

  let currentWeapon = null;
  let flashOffAt = 0;

  return {
    rig, models, flashLight, flashMesh,
    setWeapon(id) {
      if (id === currentWeapon) return;
      if (currentWeapon && models[currentWeapon]) models[currentWeapon].visible = false;
      if (models[id]) models[id].visible = true;
      currentWeapon = id;
    },
    kick() {
      const g = models[currentWeapon];
      if (!g) return;
      g.position.z += 0.06;
      flashLight.intensity = 3;
      flashLight.position.set(0, 0.05, g.userData.muzzleZ);
      flashMesh.visible = true;
      flashMesh.position.set(0, 0.05, g.userData.muzzleZ - 0.04);
      flashOffAt = performance.now() + 45;
    },
    update(dt) {
      const g = models[currentWeapon];
      if (g) g.position.z += (0 - g.position.z) * Math.min(1, dt * 14);
      if (flashMesh.visible && performance.now() > flashOffAt) {
        flashMesh.visible = false;
        flashLight.intensity = 0;
      }
    },
  };
}

// Ported verbatim from 3dgames/shooter/game.js — used for local movement prediction so the
// client's guess matches what the server will compute for the same input.
function resolvePillarCollision(x, z, radius) {
  for (const p of PILLARS) {
    const closestX = clamp(x, p.x - p.hx, p.x + p.hx);
    const closestZ = clamp(z, p.z - p.hz, p.z + p.hz);
    const dx = x - closestX;
    const dz = z - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < radius * radius) {
      const dist = Math.sqrt(distSq) || 0.0001;
      const push = radius - dist;
      x += (dx / dist) * push;
      z += (dz / dist) * push;
    }
  }
  x = clamp(x, -ARENA_BOUND, ARENA_BOUND);
  z = clamp(z, -ARENA_BOUND, ARENA_BOUND);
  return { x, z };
}

let threeLoadPromise = null;
function loadThreeOnce() {
  if (window.THREE) return Promise.resolve();
  if (threeLoadPromise) return threeLoadPromise;
  threeLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'games/shooter/vendor/three.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load vendored three.min.js'));
    document.head.appendChild(s);
  });
  return threeLoadPromise;
}

const HUD_STYLE = `
.shooter-overlay { position: fixed; inset: 0; z-index: 10000; background: #05070a; font-family: monospace; color: #d7ffe0; }
.shooter-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: crosshair; }
.shooter-crosshair { position: absolute; top: 50%; left: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px; pointer-events: none; }
.shooter-crosshair::before, .shooter-crosshair::after { content: ''; position: absolute; background: #39ff14; }
.shooter-crosshair::before { left: 8px; top: 0; width: 2px; height: 18px; }
.shooter-crosshair::after { top: 8px; left: 0; height: 2px; width: 18px; }
.shooter-hud-top { position: absolute; top: 12px; left: 0; right: 0; display: flex; justify-content: center; gap: 24px; pointer-events: none; font-size: 14px; }
.shooter-scorepill { background: rgba(0,0,0,0.55); border: 1px solid #2a2f36; padding: 4px 14px; border-radius: 4px; }
.shooter-healthbars { position: absolute; bottom: 16px; left: 0; right: 0; display: flex; justify-content: space-between; padding: 0 20px; pointer-events: none; }
.shooter-hpwrap { width: 220px; }
.shooter-hpwrap.me { text-align: left; }
.shooter-hpwrap.opp { text-align: right; }
.shooter-hpbar-bg { height: 14px; background: #1a1e24; border: 1px solid #333; }
.shooter-hpbar-fill { height: 100%; background: #39ff14; transition: width 0.1s linear; }
.shooter-hpbar-fill.low { background: #ff4d4d; }
.shooter-ammo { position: absolute; bottom: 58px; right: 20px; text-align: right; pointer-events: none; font-size: 13px; opacity: 0.9; }
.shooter-weapons { position: absolute; bottom: 58px; left: 20px; display: flex; gap: 8px; pointer-events: none; font-size: 12px; }
.shooter-wslot { padding: 3px 8px; border: 1px solid #333; background: rgba(0,0,0,0.4); opacity: 0.6; }
.shooter-wslot.active { opacity: 1; border-color: #39ff14; color: #39ff14; }
.shooter-banner { position: absolute; top: 40%; left: 0; right: 0; text-align: center; font-size: 28px; pointer-events: none; text-shadow: 0 0 8px #000; }
.shooter-banner .sub { font-size: 15px; opacity: 0.85; margin-top: 6px; }
.shooter-hitmarker { position: absolute; top: 50%; left: 50%; width: 26px; height: 26px; margin: -13px 0 0 -13px; pointer-events: none; opacity: 0; }
.shooter-hitmarker.show { opacity: 1; transition: opacity 0.05s linear; }
.shooter-hitmarker.fade { opacity: 0; transition: opacity 0.35s ease-out; }
.shooter-hitmarker::before, .shooter-hitmarker::after { content: ''; position: absolute; background: #ff4d4d; }
.shooter-hitmarker::before { left: 0; top: 0; width: 26px; height: 3px; transform: rotate(45deg); transform-origin: center; }
.shooter-hitmarker::after { left: 0; top: 0; width: 26px; height: 3px; transform: rotate(-45deg); transform-origin: center; }
.shooter-controls { position: absolute; top: 12px; right: 16px; display: flex; gap: 8px; }
.shooter-controls button { font-family: monospace; background: rgba(0,0,0,0.55); color: #d7ffe0; border: 1px solid #444; padding: 5px 10px; cursor: pointer; }
.shooter-unlock-hint { position: absolute; bottom: 50%; left: 0; right: 0; text-align: center; pointer-events: none; opacity: 0.85; font-size: 14px; }
.shooter-scope { position: absolute; inset: 0; pointer-events: none; display: none; }
.shooter-scope.show { display: block; }
.shooter-scope-mask { position: absolute; inset: 0; background: #000; -webkit-mask: radial-gradient(circle at center, transparent 0, transparent 39.5vmin, #000 40vmin); mask: radial-gradient(circle at center, transparent 0, transparent 39.5vmin, #000 40vmin); }
.shooter-scope-ring { position: absolute; top: 50%; left: 50%; width: 79vmin; height: 79vmin; margin: -39.5vmin 0 0 -39.5vmin; border-radius: 50%; border: 2px solid #0a0a0a; box-sizing: border-box; }
.shooter-scope-reticle { position: absolute; top: 50%; left: 50%; width: 2px; height: 2px; }
.shooter-scope-reticle::before, .shooter-scope-reticle::after { content: ''; position: absolute; background: #111; }
.shooter-scope-reticle::before { left: -20vmin; top: -0.75px; width: 40vmin; height: 1.5px; }
.shooter-scope-reticle::after { top: -20vmin; left: -0.75px; height: 40vmin; width: 1.5px; }
.shooter-scope-dot { position: absolute; top: 50%; left: 50%; width: 4px; height: 4px; margin: -2px 0 0 -2px; border-radius: 50%; background: #111; }
.shooter-damage-flash { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at center, transparent 40%, rgba(255,0,0,0.35) 100%); opacity: 0; }
.shooter-damage-flash.show { opacity: 1; transition: opacity 0.05s linear; }
.shooter-damage-flash.fade { opacity: 0; transition: opacity 0.4s ease-out; }
.shooter-rematch-btn { margin-top: 12px; pointer-events: auto; font-family: monospace; background: rgba(0,0,0,0.6); color: #39ff14; border: 1px solid #39ff14; padding: 8px 18px; cursor: pointer; font-size: 14px; }
.shooter-settings-overlay { position: fixed; inset: 0; z-index: 20000; background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center; font-family: monospace; color: #d7ffe0; }
.shooter-settings-panel { background: #0b0f10; border: 1px solid #2a2f36; padding: 20px 24px; width: min(440px, 90vw); max-height: 85vh; overflow-y: auto; }
.shooter-settings-panel h2 { margin: 0 0 14px; font-size: 16px; color: #39ff14; }
.shooter-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; font-size: 13px; }
.shooter-settings-row label { flex: 1 1 auto; }
.shooter-settings-row input[type="range"] { width: 130px; }
.shooter-settings-row .shooter-settings-val { width: 44px; text-align: right; opacity: 0.8; font-size: 12px; }
.shooter-settings-sep { border: none; border-top: 1px solid #2a2f36; margin: 14px 0; }
.shooter-rebind-btn { font-family: monospace; background: rgba(255,255,255,0.06); color: #d7ffe0; border: 1px solid #444; padding: 4px 10px; cursor: pointer; min-width: 90px; }
.shooter-rebind-btn.listening { color: #ffe066; border-color: #ffe066; }
.shooter-settings-actions { display: flex; justify-content: space-between; margin-top: 16px; gap: 10px; }
.shooter-settings-actions button { font-family: monospace; padding: 6px 14px; cursor: pointer; }
`;

export function mount(container, api) {
  const styleEl = document.createElement('style');
  styleEl.id = 'shooter-styles';
  styleEl.textContent = HUD_STYLE;
  document.head.appendChild(styleEl);

  let settings = loadSettings();

  const lobby = document.createElement('div');
  lobby.style.display = 'flex';
  lobby.style.flexDirection = 'column';
  lobby.style.gap = '10px';
  lobby.style.alignItems = 'flex-start';
  container.appendChild(lobby);

  const hint = document.createElement('p');
  hint.style.margin = '0';
  hint.style.fontSize = '0.85em';
  hint.style.opacity = '0.8';
  hint.textContent = 'ROUND-BASED 1V1 DUEL — HEALTH BARS, NO RESPAWNS MID-ROUND. FIRST TO 3 ROUND WINS TAKES THE MATCH.';
  lobby.appendChild(hint);

  const scoreLine = document.createElement('p');
  scoreLine.style.margin = '0';
  lobby.appendChild(scoreLine);

  const seatRow = document.createElement('div');
  seatRow.style.display = 'flex';
  seatRow.style.gap = '10px';
  const seatABtn = document.createElement('button');
  const seatBBtn = document.createElement('button');
  const leaveSeatBtn = document.createElement('button');
  leaveSeatBtn.textContent = 'LEAVE SEAT';
  const rematchBtn = document.createElement('button');
  rematchBtn.textContent = 'REMATCH';
  rematchBtn.hidden = true;
  const lobbySettingsBtn = document.createElement('button');
  lobbySettingsBtn.textContent = 'SETTINGS';
  seatRow.appendChild(seatABtn);
  seatRow.appendChild(seatBBtn);
  seatRow.appendChild(leaveSeatBtn);
  seatRow.appendChild(rematchBtn);
  seatRow.appendChild(lobbySettingsBtn);
  lobby.appendChild(seatRow);

  const resultLine = document.createElement('p');
  resultLine.style.margin = '0';
  resultLine.style.opacity = '0.9';
  lobby.appendChild(resultLine);

  seatABtn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: 'a' }));
  seatBBtn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: 'b' }));
  leaveSeatBtn.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
  rematchBtn.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
  lobbySettingsBtn.addEventListener('click', () => openSettingsPanel());

  let mySeat = null;
  let latestState = null;
  let arena = null; // set once the full-viewport arena is mounted
  let arenaMounting = false;
  let arenaFailed = false; // set if entering the arena threw (e.g. no WebGL) — stop retrying every tick

  function myClientId() {
    return api.getClientId();
  }

  function computeMySeat(st) {
    if (!st) return null;
    if (st.seats.a === myClientId()) return 'a';
    if (st.seats.b === myClientId()) return 'b';
    return null;
  }

  function shouldShowArena(st) {
    return !!mySeat && (st.phase === 'playing' || st.phase === 'round_intro' || st.phase === 'game_over');
  }

  function renderLobby(st) {
    scoreLine.textContent = `ROUND ${st.round} — WINS: A ${st.wins.a} / B ${st.wins.b} (FIRST TO ${st.winsNeeded})`;
    seatABtn.textContent = st.seats.a ? `SEAT A: ${nicknameFor(st, 'a')}` : 'SIT — SEAT A';
    seatBBtn.textContent = st.seats.b ? `SEAT B: ${nicknameFor(st, 'b')}` : 'SIT — SEAT B';
    seatABtn.disabled = !!st.seats.a;
    seatBBtn.disabled = !!st.seats.b;
    leaveSeatBtn.hidden = !mySeat;
    rematchBtn.hidden = !(st.phase === 'game_over' && mySeat);

    if (st.phase === 'game_over') {
      if (st.matchWinReason === 'opponent_disconnected') {
        resultLine.textContent = `MATCH OVER — SEAT ${st.matchWinner.toUpperCase()} WINS (OPPONENT DISCONNECTED)`;
      } else {
        resultLine.textContent = `MATCH OVER — SEAT ${st.matchWinner.toUpperCase()} WINS ${Math.max(st.wins.a, st.wins.b)}-${Math.min(st.wins.a, st.wins.b)}`;
      }
    } else if (st.phase === 'waiting') {
      resultLine.textContent = 'WAITING FOR BOTH SEATS TO FILL…';
    } else {
      resultLine.textContent = '';
    }
    lobby.hidden = !!arena;
  }

  function nicknameFor(st, seat) {
    const p = st.players[seat];
    return (p && p.nickname) || '(empty)';
  }

  // --- Settings panel (sensitivity + keybinds, persisted to localStorage) ---

  function openSettingsPanel() {
    // Exiting pointer lock before showing the modal means the browser cursor is visible to
    // actually interact with it; the player just clicks the canvas again to resume aiming.
    if (document.pointerLockElement) document.exitPointerLock();
    settingsOpen = true;

    const draft = cloneSettings(settings);
    const overlay = document.createElement('div');
    overlay.className = 'shooter-settings-overlay';
    const panel = document.createElement('div');
    panel.className = 'shooter-settings-panel';
    overlay.appendChild(panel);

    const title = document.createElement('h2');
    title.textContent = 'SETTINGS';
    panel.appendChild(title);

    function addSlider(labelText, key, min, max, step) {
      const row = document.createElement('div');
      row.className = 'shooter-settings-row';
      const label = document.createElement('label');
      label.textContent = labelText;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(draft[key]);
      const val = document.createElement('span');
      val.className = 'shooter-settings-val';
      val.textContent = draft[key].toFixed(4);
      input.addEventListener('input', () => {
        draft[key] = Number(input.value);
        val.textContent = draft[key].toFixed(4);
      });
      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(val);
      panel.appendChild(row);
    }
    addSlider('MOUSE SENSITIVITY', 'sensitivity', 0.0004, 0.006, 0.0001);
    addSlider('SCOPED SENSITIVITY (SNIPER)', 'scopedSensitivity', 0.0001, 0.003, 0.00005);

    const sep = document.createElement('hr');
    sep.className = 'shooter-settings-sep';
    panel.appendChild(sep);

    let listeningFor = null;
    let listenerAttached = null;
    function stopListening() {
      if (listenerAttached) window.removeEventListener('keydown', listenerAttached, true);
      listenerAttached = null;
      listeningFor = null;
    }

    for (const action of REBINDABLE_ACTIONS) {
      const row = document.createElement('div');
      row.className = 'shooter-settings-row';
      const label = document.createElement('label');
      label.textContent = action.label;
      const btn = document.createElement('button');
      btn.className = 'shooter-rebind-btn';
      btn.textContent = keyLabel(draft.keybinds[action.id]);
      btn.addEventListener('click', () => {
        if (listeningFor) stopListening();
        listeningFor = action.id;
        btn.textContent = 'PRESS A KEY…';
        btn.classList.add('listening');
        listenerAttached = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (ev.code !== 'Escape') draft.keybinds[action.id] = ev.code;
          btn.textContent = keyLabel(draft.keybinds[action.id]);
          btn.classList.remove('listening');
          stopListening();
        };
        window.addEventListener('keydown', listenerAttached, true);
      });
      row.appendChild(label);
      row.appendChild(btn);
      panel.appendChild(row);
    }

    const actionsRow = document.createElement('div');
    actionsRow.className = 'shooter-settings-actions';
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'RESET TO DEFAULTS';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'SAVE & CLOSE';
    actionsRow.appendChild(resetBtn);
    actionsRow.appendChild(closeBtn);
    panel.appendChild(actionsRow);

    resetBtn.addEventListener('click', () => {
      draft.sensitivity = DEFAULT_SETTINGS.sensitivity;
      draft.scopedSensitivity = DEFAULT_SETTINGS.scopedSensitivity;
      draft.keybinds = { ...DEFAULT_SETTINGS.keybinds };
      settings = cloneSettings(draft);
      saveSettings(settings);
      close();
      openSettingsPanel();
    });

    function close() {
      stopListening();
      overlay.remove();
      settingsOpen = false;
    }
    closeBtn.addEventListener('click', () => {
      settings = cloneSettings(draft);
      saveSettings(settings);
      close();
    });

    document.body.appendChild(overlay);
  }

  // --- Arena (full-viewport) ---

  function createArena() {
    const THREE = window.THREE;
    const overlayRoot = document.createElement('div');
    overlayRoot.className = 'shooter-overlay';

    const canvas = document.createElement('canvas');
    canvas.className = 'shooter-canvas';
    overlayRoot.appendChild(canvas);

    const crosshair = document.createElement('div');
    crosshair.className = 'shooter-crosshair';
    overlayRoot.appendChild(crosshair);

    // Sniper scope: a black mask with a circular window cut out (CSS mask, not clip-path, so it
    // works regardless of aspect ratio) plus a simple reticle — shown instead of the FOV zoom
    // alone reading as "just zoomed in" rather than looking through an actual scope.
    const scope = document.createElement('div');
    scope.className = 'shooter-scope';
    const scopeMask = document.createElement('div');
    scopeMask.className = 'shooter-scope-mask';
    const scopeRing = document.createElement('div');
    scopeRing.className = 'shooter-scope-ring';
    const scopeReticle = document.createElement('div');
    scopeReticle.className = 'shooter-scope-reticle';
    const scopeDot = document.createElement('div');
    scopeDot.className = 'shooter-scope-dot';
    scope.appendChild(scopeMask);
    scope.appendChild(scopeRing);
    scope.appendChild(scopeReticle);
    scope.appendChild(scopeDot);
    overlayRoot.appendChild(scope);

    const hitmarker = document.createElement('div');
    hitmarker.className = 'shooter-hitmarker';
    overlayRoot.appendChild(hitmarker);

    const damageFlash = document.createElement('div');
    damageFlash.className = 'shooter-damage-flash';
    overlayRoot.appendChild(damageFlash);

    const hudTop = document.createElement('div');
    hudTop.className = 'shooter-hud-top';
    const scorePill = document.createElement('div');
    scorePill.className = 'shooter-scorepill';
    hudTop.appendChild(scorePill);
    overlayRoot.appendChild(hudTop);

    const banner = document.createElement('div');
    banner.className = 'shooter-banner';
    banner.hidden = true;
    const bannerText = document.createElement('div');
    banner.appendChild(bannerText);
    const rematchBtn = document.createElement('button');
    rematchBtn.className = 'shooter-rematch-btn';
    rematchBtn.textContent = 'REMATCH';
    rematchBtn.hidden = true;
    rematchBtn.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
    banner.appendChild(rematchBtn);
    overlayRoot.appendChild(banner);

    const unlockHint = document.createElement('div');
    unlockHint.className = 'shooter-unlock-hint';
    unlockHint.textContent = 'CLICK TO AIM';
    overlayRoot.appendChild(unlockHint);

    const healthRow = document.createElement('div');
    healthRow.className = 'shooter-healthbars';
    const meWrap = document.createElement('div');
    meWrap.className = 'shooter-hpwrap me';
    const meBarBg = document.createElement('div');
    meBarBg.className = 'shooter-hpbar-bg';
    const meBarFill = document.createElement('div');
    meBarFill.className = 'shooter-hpbar-fill';
    meBarBg.appendChild(meBarFill);
    const meLabel = document.createElement('div');
    meWrap.appendChild(meLabel);
    meWrap.appendChild(meBarBg);
    const oppWrap = document.createElement('div');
    oppWrap.className = 'shooter-hpwrap opp';
    const oppBarBg = document.createElement('div');
    oppBarBg.className = 'shooter-hpbar-bg';
    const oppBarFill = document.createElement('div');
    oppBarFill.className = 'shooter-hpbar-fill';
    oppBarBg.appendChild(oppBarFill);
    const oppLabel = document.createElement('div');
    oppWrap.appendChild(oppLabel);
    oppWrap.appendChild(oppBarBg);
    healthRow.appendChild(meWrap);
    healthRow.appendChild(oppWrap);
    overlayRoot.appendChild(healthRow);

    const ammoEl = document.createElement('div');
    ammoEl.className = 'shooter-ammo';
    overlayRoot.appendChild(ammoEl);

    const weaponsRow = document.createElement('div');
    weaponsRow.className = 'shooter-weapons';
    const wslots = {};
    for (const id of ['pistol', 'shotgun', 'sniper']) {
      const slot = document.createElement('div');
      slot.className = 'shooter-wslot';
      slot.textContent = WEAPON_LABELS[id];
      weaponsRow.appendChild(slot);
      wslots[id] = slot;
    }
    overlayRoot.appendChild(weaponsRow);

    const controls = document.createElement('div');
    controls.className = 'shooter-controls';
    const settingsArenaBtn = document.createElement('button');
    settingsArenaBtn.textContent = 'SETTINGS';
    const leaveSeatArenaBtn = document.createElement('button');
    leaveSeatArenaBtn.textContent = 'LEAVE SEAT';
    const leaveRoomArenaBtn = document.createElement('button');
    leaveRoomArenaBtn.textContent = '◀ LEAVE ROOM';
    controls.appendChild(settingsArenaBtn);
    controls.appendChild(leaveSeatArenaBtn);
    controls.appendChild(leaveRoomArenaBtn);
    overlayRoot.appendChild(controls);
    settingsArenaBtn.addEventListener('click', () => openSettingsPanel());
    leaveSeatArenaBtn.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
    leaveRoomArenaBtn.addEventListener('click', () => {
      if (typeof api.leaveRoom === 'function') api.leaveRoom();
    });

    document.body.appendChild(overlayRoot);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0f14);
    scene.fog = new THREE.Fog(0x0d0f14, 20, 55);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);
    const pitchObject = new THREE.Object3D();
    pitchObject.add(camera);
    const yawObject = new THREE.Object3D();
    yawObject.position.set(0, EYE_HEIGHT, 8);
    yawObject.add(pitchObject);
    scene.add(yawObject);

    scene.add(new THREE.HemisphereLight(0x8899bb, 0x33291f, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2d9, 0.8);
    sun.position.set(15, 25, 10);
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
      new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const gridHelper = new THREE.GridHelper(ARENA_HALF * 2, 22, 0x444a55, 0x22262e);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // Collected for the third-person aim-convergence raycast (see computeEffectiveAim) — a purely
    // client-side visual aid, not a substitute for the server's own authoritative hit geometry.
    const raycastTargets = [ground];

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.9 });
    [
      { x: 0, z: -ARENA_HALF, w: ARENA_HALF * 2, d: 1 },
      { x: 0, z: ARENA_HALF, w: ARENA_HALF * 2, d: 1 },
      { x: -ARENA_HALF, z: 0, w: 1, d: ARENA_HALF * 2 },
      { x: ARENA_HALF, z: 0, w: 1, d: ARENA_HALF * 2 },
    ].forEach((w) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, WALL_HEIGHT, w.d), wallMat);
      mesh.position.set(w.x, WALL_HEIGHT / 2, w.z);
      scene.add(mesh);
      raycastTargets.push(mesh);
    });

    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.8 });
    for (const p of PILLARS) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.hx * 2, p.height, p.hz * 2), pillarMat);
      mesh.position.set(p.x, p.height / 2, p.z);
      scene.add(mesh);
      raycastTargets.push(mesh);
    }

    // Builds an avatar: two spheres matching the server's hit-test spheres exactly (body/head Y
    // smoothly lerped between standing/low-profile each frame — see updateAvatarPose), plus a
    // small "visor" box offset forward so facing direction reads visually.
    function buildAvatar(bodyColor, headColor) {
      const group = new THREE.Object3D();
      const body = new THREE.Mesh(new THREE.SphereGeometry(BODY_HITBOX_RADIUS, 16, 12), new THREE.MeshStandardMaterial({ color: bodyColor }));
      body.position.y = BODY_HITBOX_Y;
      const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_HITBOX_RADIUS, 12, 10), new THREE.MeshStandardMaterial({ color: headColor }));
      head.position.y = EYE_HEIGHT;
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.08), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
      visor.position.set(0, EYE_HEIGHT, -0.22);
      group.add(body, head, visor);
      return { group, body, head, visor };
    }

    // Lerps an avatar's body/head local Y between standing and the server's crouch-adjusted
    // hitbox positions (CROUCH_BODY_HITBOX_Y/CROUCH_EYE_HEIGHT) by `amount` (0=standing,
    // 1=fully low profile) — purely a visual smoothing pass (playtest feedback: instantly
    // snapping height on crouch/slide transitions read as janky); the server's own hit-test still
    // treats crouching/sliding as an instant boolean, so this never desyncs from actual hit-reg,
    // it just softens how the transition *looks*.
    function updateAvatarPose(avatar, amount) {
      avatar.body.position.y = lerp(BODY_HITBOX_Y, CROUCH_BODY_HITBOX_Y, amount);
      avatar.head.position.y = lerp(EYE_HEIGHT, CROUCH_EYE_HEIGHT, amount);
      avatar.visor.position.y = avatar.head.position.y;
    }

    const opponent = buildAvatar(0xff4d4d, 0xff8a8a);
    scene.add(opponent.group);
    const oppGunRig = buildHeldGunRig(THREE, opponent.group, { x: 0.28, y: 1.05, z: -0.15 }, 1);

    // Local third-person avatar: hidden by default (first-person mode), shown when the player
    // toggles third person (KeyV) so they can see their own character.
    const self = buildAvatar(0x39a0ff, 0x7fc4ff);
    self.group.visible = false;
    scene.add(self.group);
    const selfGunRig = buildHeldGunRig(THREE, self.group, { x: 0.28, y: 1.05, z: -0.15 }, 1);

    // First-person viewmodel: attached to the camera itself (camera-relative offset ported from
    // source's gunGroup.position), only shown while NOT in third-person mode.
    const viewmodelGunRig = buildHeldGunRig(THREE, camera, { x: 0.32, y: -0.28, z: -0.55 }, 1);

    // A thin cylinder rather than a THREE.Line — most WebGL implementations ignore Line's
    // `linewidth` entirely, which made the original hairline tracer hard to actually see fire
    // (playtest feedback: "would be great to see the bullets when they're fired"). A unit-length
    // cylinder along +Y gets scaled/rotated per shot to stretch between the two endpoints.
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.85 });
    // Pool sized to the highest pellet count of any weapon (shotgun: 8) so every pellet from a
    // single shotgun blast gets its own visible tracer instead of them all sharing one mesh.
    const TRACER_POOL_SIZE = 8;
    const tracerPool = [];
    for (let i = 0; i < TRACER_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 6), tracerMat);
      mesh.visible = false;
      scene.add(mesh);
      tracerPool.push({ mesh, hideAt: 0 });
    }

    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener('resize', onResize);

    return {
      overlayRoot, canvas, renderer, scene, camera, yawObject, pitchObject, raycastTargets,
      oppGroup: opponent.group, oppAvatar: opponent, selfAvatar: self, updateAvatarPose,
      oppGunRig, selfGunRig, viewmodelGunRig,
      tracerPool,
      crosshair, scope, hitmarker, damageFlash, scorePill, banner, bannerText, rematchBtn, unlockHint,
      meBarFill, meLabel, oppBarFill, oppLabel, ammoEl, wslots,
      onResize,
    };
  }

  function destroyArena(a) {
    window.removeEventListener('resize', a.onResize);
    a.renderer.dispose();
    if (document.pointerLockElement === a.canvas) document.exitPointerLock();
    a.overlayRoot.remove();
  }

  // Local player predicted transform + input state, live only while arena is mounted. velX/velZ
  // mirror the server's momentum model (server/games/shooter.js) so local prediction ramps up
  // and coasts to a stop the same way the authoritative simulation does, instead of snapping.
  let predicted = {
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    velX: 0, velZ: 0, velY: 0,
    crouching: false, sliding: false, slideStartedAt: 0,
    lowProfileAmount: 0, // smoothed 0..1 toward crouching/sliding — see updateAvatarPose
  };
  let oppLowProfileAmount = 0; // same smoothing, tracked separately since it's not part of `predicted`
  let lastSlideAt = 0;
  let thirdPerson = false;
  let settingsOpen = false;
  let keysDown = new Set();
  let lastSentMove = { fwd: 0, strafe: 0 };
  let lastSentLook = { yaw: null, pitch: null };
  let rafHandle = null;
  let lookIntervalHandle = null;
  let hitmarkerTimeout = null;
  let damageFlashTimeout = null;
  let lastFrameTime = 0;

  function currentMoveInput() {
    let fwd = 0, strafe = 0;
    if (keysDown.has('KeyW')) fwd += 1;
    if (keysDown.has('KeyS')) fwd -= 1;
    if (keysDown.has('KeyD')) strafe += 1;
    if (keysDown.has('KeyA')) strafe -= 1;
    return { fwd, strafe };
  }

  function sendMoveIfChanged() {
    const m = currentMoveInput();
    if (m.fwd !== lastSentMove.fwd || m.strafe !== lastSentMove.strafe) {
      lastSentMove = m;
      api.sendAction({ kind: 'move', fwd: m.fwd, strafe: m.strafe });
    }
  }

  function startSlide() {
    const now = performance.now();
    // No local groundedness check here (unlike the server's authoritative one) — predicted.y can
    // drift slightly from the server's true value without ever being corrected, since
    // reconciliation only snaps on divergence past RECONCILE_EPSILON_SQ (0.2 units), a much
    // looser tolerance than "grounded." A tight local check here could permanently block sliding
    // from a perfectly valid grounded state. Optimistically predict and let the server reject it
    // (self-corrected on the next state broadcast) if it disagrees — same pattern jump already
    // uses.
    if (predicted.sliding) return;
    if (now - lastSlideAt < SLIDE_COOLDOWN_MS) return;
    const m = currentMoveInput();
    const len = Math.hypot(m.fwd, m.strafe);
    const nFwd = len > 0 ? m.fwd / len : 1;
    const nStrafe = len > 0 ? m.strafe / len : 0;
    const forward = { x: -Math.sin(predicted.yaw), z: -Math.cos(predicted.yaw) };
    const right = { x: Math.cos(predicted.yaw), z: -Math.sin(predicted.yaw) };
    predicted.velX = (forward.x * nFwd + right.x * nStrafe) * SLIDE_SPEED;
    predicted.velZ = (forward.z * nFwd + right.z * nStrafe) * SLIDE_SPEED;
    predicted.sliding = true;
    predicted.slideStartedAt = now;
    lastSlideAt = now;
    api.sendAction({ kind: 'slide' });
  }

  function onKeyDown(ev) {
    if (settingsOpen) return;
    const kb = settings.keybinds;
    if (ev.code === kb.weapon1 || ev.code === kb.weapon2 || ev.code === kb.weapon3) {
      const weapon = ev.code === kb.weapon1 ? 'pistol' : ev.code === kb.weapon2 ? 'shotgun' : 'sniper';
      if (weapon !== 'sniper' && zoomed) setZoomed(false);
      api.sendAction({ kind: 'switchWeapon', weapon });
      return;
    }
    if (ev.code === kb.reload) {
      api.sendAction({ kind: 'reload' });
      return;
    }
    if (ev.code === kb.thirdPerson && !ev.repeat) {
      thirdPerson = !thirdPerson;
      applyViewMode();
      return;
    }
    if (ev.code === kb.jump && !ev.repeat) {
      // Predict the jump impulse locally for immediate feedback; the server independently
      // validates groundedness and is authoritative for the actual result.
      if (predicted.y <= 0.001 && predicted.velY <= 0) predicted.velY = JUMP_VELOCITY;
      api.sendAction({ kind: 'jump' });
      return;
    }
    if (ev.code === kb.crouch) {
      if (!predicted.crouching) {
        predicted.crouching = true;
        api.sendAction({ kind: 'crouch', on: true });
      }
      return;
    }
    if (ev.code === kb.slide && !ev.repeat) {
      startSlide();
      return;
    }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(ev.code)) {
      keysDown.add(ev.code);
      sendMoveIfChanged();
    }
  }
  function onKeyUp(ev) {
    if (settingsOpen) return;
    if (ev.code === settings.keybinds.crouch) {
      predicted.crouching = false;
      api.sendAction({ kind: 'crouch', on: false });
      return;
    }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(ev.code)) {
      keysDown.delete(ev.code);
      sendMoveIfChanged();
    }
  }

  function onMouseMove(ev) {
    if (!arena || document.pointerLockElement !== arena.canvas) return;
    const sensitivity = zoomed ? settings.scopedSensitivity : settings.sensitivity;
    // Process every coalesced sub-event, not just the final movementX/Y — the browser can batch
    // several raw high-frequency mouse samples into one dispatched 'mousemove' event, and reading
    // only the coalesced total (identical here, since it's just the sum) still means a fast flick
    // renders as one big jump between animation frames rather than a smooth sweep; replaying each
    // sample's own delta in order is the standard fix for pointer-lock FPS controls feeling like
    // the view has to "catch up" after a fast flick, since it restores the actual sample timing.
    const events = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
    const samples = events.length ? events : [ev];
    for (const sample of samples) {
      predicted.yaw -= sample.movementX * sensitivity;
      predicted.pitch -= sample.movementY * sensitivity;
    }
    predicted.pitch = clamp(predicted.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    arena.yawObject.rotation.y = predicted.yaw;
    arena.pitchObject.rotation.x = predicted.pitch;
  }

  function lockPointer() {
    // Some Linux/GPU driver combos reject the whole request when unadjustedMovement is
    // unsupported rather than silently ignoring it (ported from 3dgames/shooter/game.js's
    // lockPointer, which hit exactly this on this machine) — retry without it on rejection.
    const p = arena.canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => arena.canvas.requestPointerLock());
  }

  let zoomed = false;
  let lastZoomChangeAt = 0;
  function setZoomed(on) {
    const nextOn = on && currentView && currentView.players[mySeat] && currentView.players[mySeat].weapon === 'sniper';
    if (nextOn === zoomed) return;
    zoomed = nextOn;
    lastZoomChangeAt = performance.now();
    if (arena) {
      arena.camera.fov = zoomed ? BASE_FOV * SNIPER_ZOOM_FOV_MULT : BASE_FOV;
      arena.camera.updateProjectionMatrix();
      // A scope overlay rather than just a narrower FOV — "actually looking through a scope"
      // instead of "the world just zoomed in". Swap in the scope's own reticle for the normal
      // crosshair while looking through it.
      arena.scope.classList.toggle('show', zoomed);
      arena.crosshair.hidden = zoomed;
    }
    api.sendAction({ kind: 'aimZoom', on: zoomed });
  }

  function onCanvasMouseDown(ev) {
    if (!arena) return;
    if (document.pointerLockElement !== arena.canvas) {
      lockPointer();
      return;
    }
    if (ev.button === 0) {
      // Send the exact current aim with the fire action itself rather than relying solely on the
      // separately-throttled 'look' stream (sent at most every ~70ms) — otherwise a shot fired
      // right as the mouse finishes tracking a target onto the crosshair can resolve against aim
      // data up to 70ms stale, which reads as "shots land below the cursor" whenever the mouse
      // was still moving upward onto a target at the moment of the click. In third person this is
      // additionally corrected for camera/eye offset — see computeEffectiveAim.
      const aim = computeEffectiveAim();
      // Also send our own current predicted position: the server's tracked x/z only advances on
      // its own tick loop, so while actively moving it's always a bit behind what's actually
      // being rendered here (client-side prediction). Resolving the shot from the server's stale
      // position while aiming from our own ahead-of-server position caused shots to visibly land
      // left/right of the crosshair during movement — the server clamps how far this can be
      // trusted, this just avoids using its own known-stale fallback whenever we have something
      // fresher to offer.
      api.sendAction({ kind: 'fire', yaw: aim.yaw, pitch: aim.pitch, x: predicted.x, z: predicted.z });
    } else if (ev.button === 2) {
      setZoomed(true);
    }
  }
  function onCanvasMouseUp(ev) {
    if (ev.button === 2) setZoomed(false);
  }
  function onContextMenu(ev) {
    if (arena && document.pointerLockElement === arena.canvas) ev.preventDefault();
  }

  function onPointerLockChange() {
    if (!arena) return;
    const locked = document.pointerLockElement === arena.canvas;
    arena.unlockHint.hidden = locked;
    if (!locked) setZoomed(false);
  }

  function applyViewMode() {
    if (!arena) return;
    arena.camera.position.set(0, thirdPerson ? THIRDPERSON_CAMERA_OFFSET.y : 0, thirdPerson ? THIRDPERSON_CAMERA_OFFSET.z : 0);
    arena.selfAvatar.group.visible = thirdPerson;
    arena.viewmodelGunRig.rig.visible = !thirdPerson;
  }

  // In first person the camera sits exactly at the player's eye (local offset (0,0,0)), so the
  // crosshair (screen center) and the actual shot origin/direction (the player's eye + yaw/pitch)
  // are the same ray — no correction needed. In third person the camera is physically pulled back
  // and up (see THIRDPERSON_CAMERA_OFFSET), so a ray from the camera through screen-center and a
  // ray from the eye at the same yaw/pitch are merely parallel, not the same line — they never
  // meet, which is exactly why the crosshair didn't line up with the actual bullet path. The fix
  // (standard "reticle convergence" in third-person shooters): raycast from the real camera
  // through the crosshair to find what it's actually pointing at, then aim from the eye toward
  // that same world point instead of reusing the camera's raw angle.
  function computeEffectiveAim() {
    if (!thirdPerson || !arena) return { yaw: predicted.yaw, pitch: predicted.pitch };
    const THREE = window.THREE;
    // getWorldPosition/getWorldDirection/the raycast below all read cached world matrices, which
    // Three.js normally refreshes once per render — but this can run (e.g. on a fire click)
    // between animation frames, or before any frame has rendered at all, so force the static
    // geometry's world matrices fresh here rather than risk reading a stale transform left over
    // from whenever something was last actually rendered.
    arena.scene.updateMatrixWorld(true);
    const camPos = new THREE.Vector3();
    arena.camera.getWorldPosition(camPos);
    const camDir = new THREE.Vector3();
    arena.camera.getWorldDirection(camDir);

    const raycaster = new THREE.Raycaster(camPos, camDir, 0.05, 40);
    let bestDist = Infinity;
    let targetPoint = null;

    const hits = raycaster.intersectObjects(arena.raycastTargets, false);
    if (hits.length) {
      bestDist = hits[0].distance;
      targetPoint = hits[0].point;
    }

    // Tested directly against a sphere built fresh from the current server-known opponent
    // position (currentView), not the opponent avatar mesh's own cached world transform — that
    // mesh is only repositioned inside the rAF render loop, so testing against it directly could
    // use a stale (even if only by one frame) position right as the player enters third person or
    // fires. Also converges on the sphere's actual CENTER rather than the surface point the ray
    // happens to poke through: on a target this small (body radius 0.45, head 0.22) the surface
    // offset alone measured out to a real 0.1-0.4 unit miss even with the crosshair dead-on.
    const opp = currentView ? currentView.players[opponentSeat()] : null;
    if (opp && opp.alive) {
      const oppLow = opp.crouching || opp.sliding;
      const bodyCenter = new THREE.Vector3(opp.x, opp.y + (oppLow ? CROUCH_BODY_HITBOX_Y : BODY_HITBOX_Y), opp.z);
      const headCenter = new THREE.Vector3(opp.x, opp.y + (oppLow ? CROUCH_EYE_HEIGHT : EYE_HEIGHT), opp.z);
      const hitPoint = new THREE.Vector3();
      for (const [center, radius] of [[headCenter, HEAD_HITBOX_RADIUS], [bodyCenter, BODY_HITBOX_RADIUS]]) {
        if (raycaster.ray.intersectSphere(new THREE.Sphere(center, radius), hitPoint)) {
          const dist = camPos.distanceTo(hitPoint);
          if (dist < bestDist) {
            bestDist = dist;
            targetPoint = center;
          }
        }
      }
    }

    if (!targetPoint) targetPoint = camPos.clone().addScaledVector(camDir, 40);

    const eyeY = predicted.y + lerp(EYE_HEIGHT, CROUCH_EYE_HEIGHT, predicted.lowProfileAmount);
    const eyePos = new THREE.Vector3(predicted.x, eyeY, predicted.z);
    const dir = targetPoint.clone().sub(eyePos).normalize();
    // Inverse of aimVector (server/games/shooter.js): recover yaw/pitch from a direction vector.
    const pitch = Math.asin(clamp(dir.y, -1, 1));
    const yaw = Math.atan2(-dir.x, -dir.z);
    return { yaw, pitch };
  }

  function opponentSeat() {
    return mySeat === 'a' ? 'b' : 'a';
  }

  function flashHitmarker(headshot) {
    if (!arena) return;
    clearTimeout(hitmarkerTimeout);
    arena.hitmarker.classList.remove('fade');
    arena.hitmarker.classList.add('show');
    arena.hitmarker.style.background = headshot ? '#ffe066' : '';
    hitmarkerTimeout = setTimeout(() => {
      arena.hitmarker.classList.remove('show');
      arena.hitmarker.classList.add('fade');
    }, 90);
  }

  function showTracer(shotData) {
    if (!arena) return;
    const THREE = window.THREE;
    const origin = new THREE.Vector3(shotData.origin.x, shotData.origin.y, shotData.origin.z);
    // Server sends one real per-pellet direction+distance (`pellets`), so a shotgun blast draws
    // its actual 8-way spread instead of a single straight line through the aim center.
    const pellets = Array.isArray(shotData.pellets) && shotData.pellets.length ? shotData.pellets : null;
    let dirs;
    if (pellets) {
      dirs = pellets.map((p) => ({ dir: new THREE.Vector3(p.x, p.y, p.z), dist: Math.max(0.2, p.dist || 30) }));
    } else {
      const cosPitch = Math.cos(shotData.pitch);
      const dir = new THREE.Vector3(-Math.sin(shotData.yaw) * cosPitch, Math.sin(shotData.pitch), -Math.cos(shotData.yaw) * cosPitch);
      dirs = [{ dir, dist: Math.max(0.2, shotData.impactDist || 30) }];
    }
    const now = performance.now();
    const count = Math.min(dirs.length, arena.tracerPool.length);
    for (let i = 0; i < count; i++) {
      const { dir, dist } = dirs[i];
      const end = origin.clone().add(dir.clone().multiplyScalar(dist));
      const mid = origin.clone().add(end).multiplyScalar(0.5);
      const slot = arena.tracerPool[i];
      slot.mesh.position.copy(mid);
      slot.mesh.scale.set(1, dist, 1);
      // Cylinder's default axis is +Y; rotate it to point along `dir` instead.
      slot.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      slot.mesh.visible = true;
      slot.hideAt = now + 120;
    }
  }

  // --- rendering / interpolation of opponent state between ticks ---
  let previousView = null;
  let currentView = null;
  let lastTickAt = 0;

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function opponentRenderPose() {
    if (!currentView) return null;
    const seat = opponentSeat();
    const cur = currentView.players[seat];
    if (!cur) return null;
    if (!previousView || previousView === currentView) return cur;
    const prev = previousView.players[seat];
    if (!prev || !prev.alive || !cur.alive) return cur;
    const dx = cur.x - prev.x, dz = cur.z - prev.z;
    if (dx * dx + dz * dz > TELEPORT_DIST_SQ) return cur;
    const t = clamp((performance.now() - lastTickAt) / SERVER_TICK_MS, 0, 1);
    return {
      ...cur,
      x: lerp(prev.x, cur.x, t), y: lerp(prev.y, cur.y, t), z: lerp(prev.z, cur.z, t),
      yaw: lerp(prev.yaw, cur.yaw, t), pitch: lerp(prev.pitch, cur.pitch, t),
    };
  }

  function updateHud() {
    if (!arena || !currentView) return;
    const me = currentView.players[mySeat];
    const opp = currentView.players[opponentSeat()];
    if (me) {
      const pct = clamp((me.hp / me.maxHp) * 100, 0, 100);
      arena.meBarFill.style.width = `${pct}%`;
      arena.meBarFill.classList.toggle('low', pct <= 30);
      arena.meLabel.textContent = `YOU — ${Math.round(me.hp)}/${me.maxHp}`;
      arena.ammoEl.textContent = me.reloading ? 'RELOADING…' : `${me.ammo[me.weapon]} / ${me.magSize}`;
      for (const id of Object.keys(arena.wslots)) arena.wslots[id].classList.toggle('active', id === me.weapon);
    }
    if (opp) {
      const pct = clamp((opp.hp / opp.maxHp) * 100, 0, 100);
      arena.oppBarFill.style.width = `${pct}%`;
      arena.oppBarFill.classList.toggle('low', pct <= 30);
      arena.oppLabel.textContent = `${opp.nickname || 'OPPONENT'} — ${Math.round(opp.hp)}/${opp.maxHp}`;
    }
    arena.scorePill.textContent = `ROUND ${currentView.round} — WINS: A ${currentView.wins.a} / B ${currentView.wins.b} (TO ${currentView.winsNeeded})`;

    if (currentView.phase === 'round_intro') {
      const secs = Math.max(0, Math.ceil((currentView.roundEndsAt - Date.now()) / 1000));
      arena.banner.hidden = false;
      arena.rematchBtn.hidden = true;
      const winnerNote = currentView.lastRoundWinnerSeat ? `SEAT ${currentView.lastRoundWinnerSeat.toUpperCase()} WON THE ROUND` : '';
      arena.bannerText.innerHTML = `${winnerNote}<div class="sub">NEXT ROUND IN ${secs}…</div>`;
    } else if (currentView.phase === 'game_over') {
      arena.banner.hidden = false;
      arena.rematchBtn.hidden = false;
      const won = currentView.matchWinner === mySeat;
      const reasonNote = currentView.matchWinReason === 'opponent_disconnected' ? ' (OPPONENT DISCONNECTED)' : '';
      arena.bannerText.innerHTML = `${won ? 'YOU WIN THE MATCH' : 'YOU LOSE THE MATCH'}${reasonNote}`;
    } else {
      arena.banner.hidden = true;
      arena.rematchBtn.hidden = true;
    }
  }

  function renderFrame(now) {
    if (!arena) return;
    const dt = lastFrameTime ? Math.min(0.05, (now - lastFrameTime) / 1000) : 0;
    lastFrameTime = now;

    if (currentView && currentView.phase === 'playing') {
      // Mirrors server/games/shooter.js's tick() movement exactly — velocity-based with
      // exponential smoothing toward the input-driven target, not snapping straight to speed.
      // Sliding holds velocity exactly at SLIDE_SPEED for its whole duration (no in-slide decay —
      // "the character slows down" during a slide was the actual complaint), then hands off to
      // the normal accel/decel blend below once it ends, so momentum carries smoothly afterward.
      if (predicted.sliding && performance.now() - predicted.slideStartedAt >= SLIDE_DURATION_MS) {
        predicted.sliding = false;
      }
      if (predicted.sliding) {
        // Steerable slide: held input redirects DIRECTION only, never speed — mirrors server tick().
        const m = currentMoveInput();
        const len = Math.hypot(m.fwd, m.strafe);
        if (len > 0) {
          const nFwd = m.fwd / len, nStrafe = m.strafe / len;
          const forward = { x: -Math.sin(predicted.yaw), z: -Math.cos(predicted.yaw) };
          const right = { x: Math.cos(predicted.yaw), z: -Math.sin(predicted.yaw) };
          const desiredX = forward.x * nFwd + right.x * nStrafe;
          const desiredZ = forward.z * nFwd + right.z * nStrafe;
          const speed = Math.hypot(predicted.velX, predicted.velZ) || SLIDE_SPEED;
          const curDirX = predicted.velX / speed, curDirZ = predicted.velZ / speed;
          const steerBlend = 1 - Math.exp(-SLIDE_STEER_RATE * dt);
          let newDirX = curDirX + (desiredX - curDirX) * steerBlend;
          let newDirZ = curDirZ + (desiredZ - curDirZ) * steerBlend;
          const newDirLen = Math.hypot(newDirX, newDirZ) || 1;
          predicted.velX = (newDirX / newDirLen) * speed;
          predicted.velZ = (newDirZ / newDirLen) * speed;
        }
      } else {
        const m = currentMoveInput();
        const len = Math.hypot(m.fwd, m.strafe);
        let targetX = 0, targetZ = 0;
        if (len > 0) {
          const nFwd = m.fwd / len, nStrafe = m.strafe / len;
          const forward = { x: -Math.sin(predicted.yaw), z: -Math.cos(predicted.yaw) };
          const right = { x: Math.cos(predicted.yaw), z: -Math.sin(predicted.yaw) };
          const speed = MOVE_SPEED * (predicted.crouching ? CROUCH_SPEED_MULT : 1);
          targetX = (forward.x * nFwd + right.x * nStrafe) * speed;
          targetZ = (forward.z * nFwd + right.z * nStrafe) * speed;
        }
        const grounded = predicted.y <= 0.001;
        const rate = len > 0 ? ACCEL_RATE : (grounded ? DECEL_RATE : AIR_DECEL_RATE);
        const blend = 1 - Math.exp(-rate * dt);
        predicted.velX += (targetX - predicted.velX) * blend;
        predicted.velZ += (targetZ - predicted.velZ) * blend;
      }

      const resolved = resolvePillarCollision(predicted.x + predicted.velX * dt, predicted.z + predicted.velZ * dt, PLAYER_RADIUS);
      predicted.x = resolved.x;
      predicted.z = resolved.z;

      predicted.velY -= GRAVITY * dt;
      predicted.y += predicted.velY * dt;
      if (predicted.y <= 0) {
        predicted.y = 0;
        predicted.velY = 0;
      }
    }

    // Sliding gives the same low profile as crouching (see server's shooterLow/targetLow), for
    // both the local player and the opponent — smoothed toward the target amount rather than
    // snapping instantly (playtest feedback: instant crouch/slide/jump transitions read as
    // janky). Purely visual: the server's actual hit-test still treats it as an instant boolean.
    const selfLowTarget = predicted.crouching || predicted.sliding ? 1 : 0;
    const lowProfileBlend = 1 - Math.exp(-LOW_PROFILE_TRANSITION_RATE * dt);
    predicted.lowProfileAmount += (selfLowTarget - predicted.lowProfileAmount) * lowProfileBlend;
    const eyeY = predicted.y + lerp(EYE_HEIGHT, CROUCH_EYE_HEIGHT, predicted.lowProfileAmount);
    arena.yawObject.position.set(predicted.x, eyeY, predicted.z);
    arena.updateAvatarPose(arena.selfAvatar, predicted.lowProfileAmount);
    if (thirdPerson) {
      arena.selfAvatar.group.position.set(predicted.x, predicted.y, predicted.z);
      arena.selfAvatar.group.rotation.y = predicted.yaw;
    }

    const oppPose = opponentRenderPose();
    if (oppPose) {
      arena.oppGroup.visible = oppPose.alive;
      arena.oppGroup.position.set(oppPose.x, oppPose.y, oppPose.z);
      arena.oppGroup.rotation.y = oppPose.yaw;
      const oppLowTarget = oppPose.crouching || oppPose.sliding ? 1 : 0;
      oppLowProfileAmount += (oppLowTarget - oppLowProfileAmount) * lowProfileBlend;
      arena.updateAvatarPose(arena.oppAvatar, oppLowProfileAmount);
      arena.oppGunRig.setWeapon(oppPose.weapon);
    } else {
      arena.oppGroup.visible = false;
    }

    const me = currentView ? currentView.players[mySeat] : null;
    if (me) {
      arena.viewmodelGunRig.setWeapon(me.weapon);
      arena.selfGunRig.setWeapon(me.weapon);
    }
    arena.viewmodelGunRig.update(dt);
    arena.selfGunRig.update(dt);
    arena.oppGunRig.update(dt);

    {
      const now = performance.now();
      for (const slot of arena.tracerPool) {
        if (slot.mesh.visible && now > slot.hideAt) slot.mesh.visible = false;
      }
    }

    updateHud();
    arena.renderer.render(arena.scene, arena.camera);
    rafHandle = requestAnimationFrame(renderFrame);
  }

  async function enterArena(st) {
    if (arenaMounting || arena) return;
    arenaMounting = true;
    try {
      await loadThreeOnce();
      arena = createArena();
    } finally {
      arenaMounting = false;
    }

    const me = st.players[mySeat];
    predicted = {
      x: me ? me.x : 0, y: me ? me.y : 0, z: me ? me.z : 0, yaw: me ? me.yaw : 0, pitch: 0,
      velX: 0, velZ: 0, velY: 0, crouching: false, sliding: false, slideStartedAt: 0,
      lowProfileAmount: 0,
    };
    oppLowProfileAmount = 0;
    lastSlideAt = 0;
    thirdPerson = false;
    zoomed = false;
    arena.yawObject.rotation.y = predicted.yaw;
    arena.pitchObject.rotation.x = predicted.pitch;
    arena.camera.fov = BASE_FOV;
    arena.camera.updateProjectionMatrix();
    applyViewMode();
    keysDown = new Set();
    lastSentMove = { fwd: 0, strafe: 0 };
    lastSentLook = { yaw: null, pitch: null };
    previousView = st;
    currentView = st;
    lastTickAt = performance.now();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    arena.canvas.addEventListener('mousedown', onCanvasMouseDown);
    arena.canvas.addEventListener('mouseup', onCanvasMouseUp);
    arena.canvas.addEventListener('contextmenu', onContextMenu);

    lookIntervalHandle = setInterval(() => {
      const yawChanged = lastSentLook.yaw === null || Math.abs(predicted.yaw - lastSentLook.yaw) > LOOK_EPSILON;
      const pitchChanged = lastSentLook.pitch === null || Math.abs(predicted.pitch - lastSentLook.pitch) > LOOK_EPSILON;
      if (yawChanged || pitchChanged) {
        lastSentLook = { yaw: predicted.yaw, pitch: predicted.pitch };
        api.sendAction({ kind: 'look', yaw: predicted.yaw, pitch: predicted.pitch });
      }
    }, LOOK_SEND_MS);

    renderLobby(st);
    rafHandle = requestAnimationFrame(renderFrame);
  }

  function exitArena() {
    if (!arena) return;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('pointerlockchange', onPointerLockChange);
    arena.canvas.removeEventListener('mousedown', onCanvasMouseDown);
    arena.canvas.removeEventListener('mouseup', onCanvasMouseUp);
    arena.canvas.removeEventListener('contextmenu', onContextMenu);
    clearInterval(lookIntervalHandle);
    cancelAnimationFrame(rafHandle);
    clearTimeout(hitmarkerTimeout);
    clearTimeout(damageFlashTimeout);
    destroyArena(arena);
    arena = null;
    lastFrameTime = 0;
  }

  function applyState(st) {
    latestState = st;
    mySeat = computeMySeat(st);

    // Reconcile local prediction against the server's authoritative position for our own seat.
    // `move` is only sent on keydown/keyup edges, so there's an inherent ~1-network-hop window
    // right when a key is pressed/released where the client has already started accelerating or
    // coasting locally but the server hasn't heard about the input change yet — a small, normal
    // divergence, not a bug. Hard-snapping on any divergence past a threshold (the original
    // approach) turned that routine gap into a jarring "stop moving, snap into place" the instant
    // you released a key. Blend gradually toward the server's truth instead for anything in normal
    // range, and reserve an immediate hard snap for genuinely large jumps (a round reset teleport,
    // or a long stall) where visibly drifting into place would look worse than a clean cut.
    if (arena && mySeat) {
      const me = st.players[mySeat];
      if (me) {
        const dx = me.x - predicted.x, dy = me.y - predicted.y, dz = me.z - predicted.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq > TELEPORT_RECONCILE_DIST_SQ) {
          predicted.x = me.x;
          predicted.y = me.y;
          predicted.z = me.z;
          predicted.velX = me.velX;
          predicted.velZ = me.velZ;
        } else if (distSq > RECONCILE_EPSILON_SQ) {
          predicted.x += dx * RECONCILE_SMOOTH_RATE;
          predicted.y += dy * RECONCILE_SMOOTH_RATE;
          predicted.z += dz * RECONCILE_SMOOTH_RATE;
          predicted.velX += (me.velX - predicted.velX) * RECONCILE_SMOOTH_RATE;
          predicted.velZ += (me.velZ - predicted.velZ) * RECONCILE_SMOOTH_RATE;
        }
        // Safety valve for predicted.sliding: it's cleared only inside the rAF render loop, which
        // real Chrome throttles hard (sometimes to a full stop) for a backgrounded tab — if the
        // player alt-tabs mid-slide, that would otherwise leave it stuck true forever, silently
        // blocking every future slide attempt. This runs off incoming WebSocket messages instead,
        // which keep arriving regardless of tab visibility, so it self-heals independent of rAF.
        // The 150ms floor avoids trusting a stale "not sliding" broadcast that predates the
        // server having processed our slide-start message yet (which would cancel a just-started
        // optimistic slide out from under the player before it even began).
        if (predicted.sliding && !me.sliding && performance.now() - predicted.slideStartedAt >= 150) {
          predicted.sliding = false;
        }
        // Safety net for the sniper scope overlay: `zoomed` only changes in response to a mouse
        // button event, so if a round ends (server resets everyone's zoomed to false) while the
        // player still has the right mouse button physically held down, there's no event to
        // trigger the corresponding client-side un-zoom — only correcting false-positive "still
        // zoomed" here, never forcing a zoom on, to avoid fighting an in-progress zoom-in.
        // The 300ms floor (matching the slide safety valve above) avoids trusting a stale
        // "not zoomed yet" broadcast that predates the server having processed our own aimZoom
        // message — under real network latency this raced constantly and instantly snapped the
        // scope back off right after zooming in ("sniper keeps unscoping" playtest report).
        if (zoomed && !me.zoomed && performance.now() - lastZoomChangeAt >= 300) setZoomed(false);
      }
    }

    previousView = currentView || st;
    currentView = st;
    lastTickAt = performance.now();

    if (!shouldShowArena(st)) arenaFailed = false; // give a future attempt a clean slate
    if (shouldShowArena(st) && !arena && !arenaFailed) {
      enterArena(st).catch((err) => {
        console.error('Failed to enter shooter arena', err);
        arenaFailed = true;
      });
    } else if (!shouldShowArena(st) && arena) {
      exitArena();
    }
    // Read `arena` only after the enter/exit above so a same-tick exit is reflected immediately
    // instead of leaving the lobby hidden for one extra state broadcast.
    renderLobby(st);
  }

  function flashDamage() {
    if (!arena) return;
    clearTimeout(damageFlashTimeout);
    arena.damageFlash.classList.remove('fade');
    arena.damageFlash.classList.add('show');
    damageFlashTimeout = setTimeout(() => {
      arena.damageFlash.classList.remove('show');
      arena.damageFlash.classList.add('fade');
    }, 60);
  }

  function applyShot(data) {
    if (!arena || !mySeat) return;
    // Tracer + muzzle flash render for BOTH shooters, not just the local player — previously
    // only the local player's own shots got any visual feedback at all, so an opponent firing
    // was completely invisible to both sides (no gun models means the tracer/flash IS the only
    // shot feedback there is).
    showTracer(data);
    if (data.shooterSeat === mySeat) {
      arena.viewmodelGunRig.kick();
      arena.selfGunRig.kick();
      if (data.hit) flashHitmarker(data.headshot);
    } else {
      arena.oppGunRig.kick();
      if (data.hitSeat === mySeat) flashDamage();
    }
  }

  window.__shooterDebug = {
    getState: () => latestState,
    getMySeat: () => mySeat,
    getPredicted: () => ({ ...predicted }),
    isArenaMounted: () => !!arena,
    isThirdPerson: () => thirdPerson,
    isZoomed: () => zoomed,
    getCameraFov: () => (arena ? arena.camera.fov : null),
    isTracerVisible: () => (arena ? arena.tracerPool.some((s) => s.mesh.visible) : false),
    isViewmodelVisible: () => (arena ? arena.viewmodelGunRig.rig.visible : null),
    isSelfAvatarVisible: () => (arena ? arena.selfAvatar.group.visible : null),
    // Pointer lock can't be reliably exercised by automated browser testing (headless Chrome has
    // no real display to lock a cursor to, and synthetic/untrusted clicks can't request it even
    // where it is supported) — this bypasses that gate to let tests still exercise the fire path.
    debugFire: () => api.sendAction({ kind: 'fire' }),
    debugSetZoomed: (on) => setZoomed(on),
    getEffectiveAim: () => computeEffectiveAim(),
    getLowProfileAmount: () => predicted.lowProfileAmount,
    debugGetCameraRay: () => {
      if (!arena) return null;
      const THREE = window.THREE;
      arena.scene.updateMatrixWorld(true);
      const pos = new THREE.Vector3();
      arena.camera.getWorldPosition(pos);
      const dir = new THREE.Vector3();
      arena.camera.getWorldDirection(dir);
      return { pos: pos.toArray(), dir: dir.toArray() };
    },
    debugSetPose: (pose) => {
      Object.assign(predicted, pose);
      if (arena) {
        arena.yawObject.rotation.y = predicted.yaw;
        arena.pitchObject.rotation.x = predicted.pitch;
        arena.yawObject.position.set(predicted.x, predicted.y + EYE_HEIGHT, predicted.z);
      }
    },
    getSettings: () => cloneSettings(settings),
    openSettings: () => openSettingsPanel(),
    isSettingsOpen: () => settingsOpen,
  };

  return {
    applySnapshot(snapshot) {
      if (snapshot && snapshot.kind === 'state') applyState(snapshot);
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') applyState(data);
      else if (data.kind === 'shot') applyShot(data);
    },
    unmount() {
      exitArena();
      delete window.__shooterDebug;
      styleEl.remove();
      container.innerHTML = '';
    },
  };
}
