// Slope-style 3D endless runner client. Renders with Three.js (lazy-loaded, see loadThree()
// below) — a neon ball auto-runs forward along a winding, narrowing procedurally-generated
// track; steer with Arrow keys or A/D to avoid falling off the edge or hitting a red hazard.
//
// IMPORTANT — server/client sync: the track-geometry functions below (hash32/segRand/
// ensureTrack/trackHalfWidthAt/hazardAt and every constant they use) are copied VERBATIM from
// server/games/slope.js. The server is the collision authority; this client only renders what
// the server already decided. If the two copies ever diverge, "what you see" and "what kills
// you" disagree — any change to the track math in slope.js must be mirrored here exactly.

const SEG_LEN = 8;
const BASE_HALF_WIDTH = 6;
const MIN_HALF_WIDTH = 2.5;
const NARROW_RATE = 0.0025;
const MAX_CENTER = 40;
const MAX_DELTA_PER_SEG = 0.6;

const HAZARD_START_SEG = 15;
const BASE_HAZARD_CHANCE = 0.09;
const HAZARD_RAMP = 0.001;
const MAX_HAZARD_CHANCE = 0.45;
const MIN_HAZARD_W = 1.5;
const SAFE_GAP = 2.4;

const GAP_START_SEG = 30;
const GAP_LEN_SEGS = 2;
const BASE_GAP_CHANCE = 0.02;
const GAP_RAMP = 0.0003;
const MAX_GAP_CHANCE = 0.14;
const GAP_SALT_BASE = 1000000;

const TICK_MS = 50; // matches server's tickIntervalMs — used only for render interpolation timing

function hash32(seed, i) {
  let h = (seed ^ 0x9e3779b9) ^ Math.imul(i ^ 0x85ebca6b, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x045d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x045d9f3b);
  h = h ^ (h >>> 16);
  return h >>> 0;
}
function segRand(seed, salt) {
  return hash32(seed, salt) / 4294967296;
}
function ensureTrack(track, upto) {
  while (track.centers.length <= upto) {
    const i = track.centers.length;
    const prev = i === 0 ? 0 : track.centers[i - 1];
    const delta = (segRand(track.seed, i * 4 + 0) - 0.5) * 2 * MAX_DELTA_PER_SEG;
    let next = prev + delta;
    if (next > MAX_CENTER) next = prev - Math.abs(delta);
    if (next < -MAX_CENTER) next = prev + Math.abs(delta);
    track.centers.push(next);
  }
}
function trackHalfWidthAt(i) {
  return Math.max(MIN_HALF_WIDTH, BASE_HALF_WIDTH - NARROW_RATE * i);
}
function gapBlockAt(seed, i) {
  const block = Math.floor(i / GAP_LEN_SEGS);
  const blockStartSeg = block * GAP_LEN_SEGS;
  if (blockStartSeg < GAP_START_SEG) return false;
  const chance = Math.min(MAX_GAP_CHANCE, BASE_GAP_CHANCE + GAP_RAMP * (blockStartSeg - GAP_START_SEG));
  const roll = segRand(seed, GAP_SALT_BASE + block);
  return roll < chance;
}
function hazardAt(track, i) {
  if (i < HAZARD_START_SEG) return null;
  if (gapBlockAt(track.seed, i)) return null;
  const chance = Math.min(MAX_HAZARD_CHANCE, BASE_HAZARD_CHANCE + HAZARD_RAMP * (i - HAZARD_START_SEG));
  const roll = segRand(track.seed, i * 4 + 1);
  if (roll >= chance) return null;
  const halfWidth = trackHalfWidthAt(i);
  const center = track.centers[i];
  const maxW = Math.max(MIN_HAZARD_W, halfWidth * 2 - SAFE_GAP);
  const span = Math.max(maxW - MIN_HAZARD_W, 0.001);
  const width = Math.min(maxW, MIN_HAZARD_W + segRand(track.seed, i * 4 + 2) * span);
  const maxOffset = Math.max(0, halfWidth - width / 2);
  const offset = (segRand(track.seed, i * 4 + 3) - 0.5) * 2 * maxOffset;
  const hazCenter = center + offset;
  return { start: hazCenter - width / 2, end: hazCenter + width / 2 };
}

let threeLoadPromise = null;
function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (threeLoadPromise) return threeLoadPromise;
  threeLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'games/slope/three.min.js';
    script.onload = () => resolve(window.THREE);
    script.onerror = () => reject(new Error('Failed to load three.min.js'));
    document.head.appendChild(script);
  });
  return threeLoadPromise;
}

const VISIBLE_SEGS_AHEAD = 55;
const VISIBLE_SEGS_BEHIND = 2;
const PLAYER_COLOR = 0x39ff14;
const OTHER_COLORS = [0xffb000, 0x00e5ff, 0xff4dd2, 0xc792ff, 0xffee58];

const GROUND_COLOR = 0x113355;
const RAMP_COLOR = 0xffcc33; // ground segment right before a gap, cues "jump coming"
const JUMP_HEIGHT = 2.4; // purely cosmetic arc height over a gap block — server has no Y axis
const FALL_GRAVITY = 9; // purely cosmetic "fell off the edge" drop speed, units/s^2

// Is segment i the ground segment immediately before the start of a gap block? (Used only for
// the ramp color cue — not gameplay.)
function isRampSeg(seed, i) {
  return !gapBlockAt(seed, i) && gapBlockAt(seed, i + 1);
}
// World-distance span of the gap block segment i belongs to, or null if i isn't a gap segment.
function gapSpanAt(seed, i) {
  if (!gapBlockAt(seed, i)) return null;
  const block = Math.floor(i / GAP_LEN_SEGS);
  const start = block * GAP_LEN_SEGS * SEG_LEN;
  return { start, end: start + GAP_LEN_SEGS * SEG_LEN };
}

export function mount(container, api) {
  let view = null; // latest {phase, phaseEndsAt, seed, players, leaderboard}
  let prevView = null;
  let viewReceivedAt = 0;
  let track = { seed: null, centers: [0] };
  let destroyed = false;
  let heldDir = 0; // -1, 0, 1 — last sent steer direction (edge-triggered)

  const root = document.createElement('div');
  root.style.position = 'relative';
  root.style.width = '100%';
  root.style.height = '600px';
  root.style.background = '#000';
  root.style.overflow = 'hidden';
  container.appendChild(root);

  const canvasHost = document.createElement('div');
  canvasHost.style.width = '100%';
  canvasHost.style.height = '100%';
  root.appendChild(canvasHost);

  const hud = document.createElement('div');
  hud.style.position = 'absolute';
  hud.style.top = '8px';
  hud.style.left = '8px';
  hud.style.color = '#39ff14';
  hud.style.fontFamily = 'monospace';
  hud.style.fontSize = '14px';
  hud.style.textShadow = '0 0 4px #000';
  hud.style.pointerEvents = 'none';
  root.appendChild(hud);

  const leaderboardEl = document.createElement('div');
  leaderboardEl.style.position = 'absolute';
  leaderboardEl.style.top = '8px';
  leaderboardEl.style.right = '8px';
  leaderboardEl.style.color = '#ffb000';
  leaderboardEl.style.fontFamily = 'monospace';
  leaderboardEl.style.fontSize = '13px';
  leaderboardEl.style.textShadow = '0 0 4px #000';
  leaderboardEl.style.pointerEvents = 'none';
  leaderboardEl.style.textAlign = 'right';
  root.appendChild(leaderboardEl);

  const centerMsg = document.createElement('div');
  centerMsg.style.position = 'absolute';
  centerMsg.style.top = '50%';
  centerMsg.style.left = '50%';
  centerMsg.style.transform = 'translate(-50%, -50%)';
  centerMsg.style.color = '#fff';
  centerMsg.style.fontFamily = 'monospace';
  centerMsg.style.fontSize = '32px';
  centerMsg.style.textShadow = '0 0 8px #000';
  centerMsg.style.pointerEvents = 'none';
  centerMsg.style.textAlign = 'center';
  root.appendChild(centerMsg);

  const hint = document.createElement('div');
  hint.style.position = 'absolute';
  hint.style.bottom = '8px';
  hint.style.left = '8px';
  hint.style.color = '#888';
  hint.style.fontFamily = 'monospace';
  hint.style.fontSize = '12px';
  hint.textContent = 'STEER: ARROW KEYS or A/D';
  root.appendChild(hint);

  const leaveBtn = document.createElement('button');
  leaveBtn.textContent = 'LEAVE ROOM';
  leaveBtn.style.position = 'absolute';
  leaveBtn.style.bottom = '8px';
  leaveBtn.style.right = '8px';
  leaveBtn.addEventListener('click', () => api.leaveRoom());
  root.appendChild(leaveBtn);

  function nicknameFor(clientId) {
    if (!view) return 'someone';
    const p = view.players.find((pl) => pl.clientId === clientId);
    return p ? p.nickname : 'someone';
  }

  function renderHud() {
    if (!view) {
      hud.textContent = 'Loading...';
      return;
    }
    const me = view.players.find((p) => p.clientId === api.getClientId());
    const dist = me ? Math.round(me.alive ? me.distance : me.finalDistance || 0) : 0;
    hud.textContent = `DISTANCE: ${dist}`;

    if (view.phase === 'waiting') {
      centerMsg.textContent = 'WAITING FOR RACERS...';
    } else if (view.phase === 'countdown') {
      const remaining = Math.max(0, Math.ceil((view.phaseEndsAt - Date.now()) / 1000));
      centerMsg.textContent = remaining > 0 ? String(remaining) : 'GO!';
    } else if (view.phase === 'racing') {
      centerMsg.textContent = me && !me.alive ? `YOU DIED — distance: ${Math.round(me.finalDistance || 0)}` : '';
    } else if (view.phase === 'results') {
      const winner = view.leaderboard[0];
      centerMsg.textContent = winner ? `ROUND OVER\nBest: ${winner.nickname} (${Math.round(winner.distance)})` : 'ROUND OVER';
    }

    leaderboardEl.innerHTML = '';
    const title = document.createElement('div');
    title.textContent = 'LEADERBOARD';
    title.style.marginBottom = '4px';
    leaderboardEl.appendChild(title);
    for (const entry of view.leaderboard || []) {
      const row = document.createElement('div');
      row.textContent = `${entry.alive ? '●' : '×'} ${entry.nickname}: ${Math.round(entry.distance)}`;
      leaderboardEl.appendChild(row);
    }
  }

  // --- input: edge-triggered, only send when the held direction actually changes ---
  function currentDirFromKeys(keys) {
    const left = keys.has('ArrowLeft') || keys.has('a') || keys.has('A');
    const right = keys.has('ArrowRight') || keys.has('d') || keys.has('D');
    if (left && !right) return -1;
    if (right && !left) return 1;
    return 0;
  }
  const heldKeys = new Set();
  function updateSteer() {
    const dir = currentDirFromKeys(heldKeys);
    if (dir !== heldDir) {
      heldDir = dir;
      api.sendAction({ kind: 'steer', dir });
    }
  }
  function onKeyDown(ev) {
    heldKeys.add(ev.key);
    updateSteer();
  }
  function onKeyUp(ev) {
    heldKeys.delete(ev.key);
    updateSteer();
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // --- Three.js scene, built once THREE is loaded ---
  let scene, camera, renderer, rafId;
  const groundPool = [];
  const hazardPool = [];
  const ballMeshes = new Map(); // clientId -> mesh
  const deathAnim = new Map(); // clientId -> { startedAt } — cosmetic edge-fall timing, see below

  function ensurePoolSize(pool, size, factory) {
    while (pool.length < size) pool.push(factory());
    for (let i = size; i < pool.length; i++) pool[i].visible = false;
  }

  function initScene(THREE) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02040a);
    scene.fog = new THREE.Fog(0x02040a, 20, 90);

    camera = new THREE.PerspectiveCamera(70, canvasHost.clientWidth / Math.max(1, canvasHost.clientHeight), 0.1, 200);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(canvasHost.clientWidth, canvasHost.clientHeight || 600);
    canvasHost.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0x8899ff, 0.7);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 12, 8);
    scene.add(dir);

    for (let i = 0; i < VISIBLE_SEGS_AHEAD + VISIBLE_SEGS_BEHIND; i++) {
      const geo = new THREE.PlaneGeometry(1, SEG_LEN * 1.02);
      const mat = new THREE.MeshLambertMaterial({ color: GROUND_COLOR });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      scene.add(mesh);
      groundPool.push(mesh);
    }
    for (let i = 0; i < 20; i++) {
      const geo = new THREE.BoxGeometry(1, 1.2, SEG_LEN * 0.9);
      const mat = new THREE.MeshLambertMaterial({ color: 0xff3333, emissive: 0x660000 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      hazardPool.push(mesh);
    }
  }

  function ballMeshFor(THREE, clientId, isLocal) {
    let mesh = ballMeshes.get(clientId);
    if (!mesh) {
      const color = isLocal ? PLAYER_COLOR : OTHER_COLORS[ballMeshes.size % OTHER_COLORS.length];
      const geo = new THREE.SphereGeometry(0.45, 16, 12);
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 });
      mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      ballMeshes.set(clientId, mesh);
    }
    return mesh;
  }

  // Interpolated (distance, lateralPos) for a player at the current render time, blending
  // between the previous and most recent server broadcasts — avoids the raw-broadcast jitter
  // this hub already hit (and fixed the same way) in slither.js.
  function interpolated(clientId) {
    const cur = view && view.players.find((p) => p.clientId === clientId);
    if (!cur) return null;
    if (!cur.alive) return { distance: cur.finalDistance != null ? cur.finalDistance : cur.distance, lateralPos: cur.lateralPos };
    const prev = prevView && prevView.players.find((p) => p.clientId === clientId);
    if (!prev || !prev.alive) return { distance: cur.distance, lateralPos: cur.lateralPos };
    const t = Math.min(1.5, Math.max(0, (performance.now() - viewReceivedAt) / TICK_MS));
    return {
      distance: prev.distance + (cur.distance - prev.distance) * t,
      lateralPos: prev.lateralPos + (cur.lateralPos - prev.lateralPos) * t,
    };
  }

  function renderFrame() {
    if (destroyed) return;
    rafId = requestAnimationFrame(renderFrame);
    if (!scene || !view) return;

    if (track.seed !== view.seed) {
      track = { seed: view.seed, centers: [0] };
    }

    const me = view.players.find((p) => p.clientId === api.getClientId());
    const myPos = me ? interpolated(me.clientId) : null;
    const camDistance = myPos ? myPos.distance : 0;
    const camLateral = myPos ? myPos.lateralPos : 0;

    const startSeg = Math.max(0, Math.floor(camDistance / SEG_LEN) - VISIBLE_SEGS_BEHIND);
    ensureTrack(track, startSeg + VISIBLE_SEGS_AHEAD + VISIBLE_SEGS_BEHIND + 2);

    let hazardIdx = 0;
    for (let n = 0; n < groundPool.length; n++) {
      const segIndex = startSeg + n;
      const mesh = groundPool[n];
      const center = track.centers[segIndex];
      const halfWidth = trackHalfWidthAt(segIndex);

      // A gap segment has no ground at all — the ball glides over it (cosmetic Y arc below).
      // Going off the SIDE over a gap still kills you the same as anywhere else; this only
      // removes the floor visual, no new death condition.
      if (gapBlockAt(track.seed, segIndex)) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(center, 0, -(segIndex * SEG_LEN + SEG_LEN / 2));
      mesh.scale.x = halfWidth * 2;
      mesh.material.color.setHex(isRampSeg(track.seed, segIndex) ? RAMP_COLOR : GROUND_COLOR);

      const haz = hazardAt(track, segIndex);
      if (haz && hazardIdx < hazardPool.length) {
        const hMesh = hazardPool[hazardIdx++];
        hMesh.visible = true;
        hMesh.position.set((haz.start + haz.end) / 2, 0.6, -(segIndex * SEG_LEN + SEG_LEN / 2));
        hMesh.scale.x = haz.end - haz.start;
      }
    }
    for (let i = hazardIdx; i < hazardPool.length; i++) hazardPool[i].visible = false;

    const seenIds = new Set();
    for (const p of view.players) {
      if (!p.racingThisRound) continue;
      seenIds.add(p.clientId);
      const pos = interpolated(p.clientId);
      if (!pos) continue;
      const THREE = window.THREE;
      const mesh = ballMeshFor(THREE, p.clientId, p.clientId === api.getClientId());
      mesh.visible = true;

      let yOffset = 0;
      if (p.alive) {
        deathAnim.delete(p.clientId);
        const segIndex = Math.floor(pos.distance / SEG_LEN);
        const gap = gapSpanAt(track.seed, segIndex);
        if (gap) {
          const t = Math.min(1, Math.max(0, (pos.distance - gap.start) / (gap.end - gap.start)));
          yOffset = Math.sin(t * Math.PI) * JUMP_HEIGHT;
        }
      } else if (p.deathReason === 'edge') {
        // Cosmetic-only: the ball keeps dropping past the platform edge instead of just
        // freezing/vanishing against the dark background, which used to read as hitting an
        // invisible wall. Server has no Y axis at all — this never affects who's alive.
        if (!deathAnim.has(p.clientId)) deathAnim.set(p.clientId, { startedAt: performance.now() });
        const elapsedSec = (performance.now() - deathAnim.get(p.clientId).startedAt) / 1000;
        yOffset = -0.5 * FALL_GRAVITY * elapsedSec * elapsedSec;
      }

      mesh.position.set(pos.lateralPos, 0.45 + yOffset, -pos.distance);
      mesh.material.opacity = p.alive ? 1 : 0.25;
      mesh.material.transparent = !p.alive;
    }
    for (const [id, mesh] of ballMeshes) {
      if (!seenIds.has(id)) mesh.visible = false;
    }

    camera.position.set(camLateral, 3.2, -camDistance + 7);
    camera.lookAt(camLateral, 0.5, -camDistance - 12);

    if (renderer && canvasHost.clientWidth && renderer.domElement.width !== canvasHost.clientWidth) {
      renderer.setSize(canvasHost.clientWidth, canvasHost.clientHeight || 600);
      camera.aspect = canvasHost.clientWidth / Math.max(1, canvasHost.clientHeight || 600);
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
    renderHud();
  }

  loadThree()
    .then((THREE) => {
      if (destroyed) return;
      initScene(THREE);
      renderFrame();
    })
    .catch((err) => {
      console.error('Slope: failed to load Three.js', err);
      hud.textContent = 'Failed to load 3D renderer.';
    });

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      prevView = snapshot;
      viewReceivedAt = performance.now();
      renderHud();
    },
    applyEvent(data) {
      if (!data || data.kind !== 'state') return;
      prevView = view || data;
      view = data;
      viewReceivedAt = performance.now();
    },
    unmount() {
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (renderer) {
        renderer.dispose();
        if (renderer.domElement && renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      }
      root.remove();
    },
  };
}
