// 1v1 arena duel — round-based FPS with server-authoritative movement/hit-detection.
// Real-time tick loop like slither.js, combined with the two-seat/phase lifecycle from
// chess.js/checkers.js/connect4.js. Movement/camera/arena/weapon constants are ported from
// the single-player prototype at 3dgames/shooter/game.js (see IDEAS.md #0); the PvE
// enemy/economy code there is not reused. No Three.js needed here — pillar/hit geometry is
// plain-JS AABB/sphere math mirroring the source's resolvePillarCollision.

const TICK_MS = 33; // ~30Hz — hit-detection staleness matters more here than slither's 20Hz
const ARENA_HALF = 22;
const ARENA_BOUND = ARENA_HALF - 0.6;
const EYE_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;
// Bumped from the source prototype's 7.5 (playtest feedback: base movement felt too slow for a
// PvP duel where dodging matters, vs. the source's PvE wave-shooter pacing).
const MOVE_SPEED = 10.5;
const CROUCH_SPEED_MULT = 0.5;
const CROUCH_EYE_HEIGHT = 1.0;
const CROUCH_BODY_HITBOX_Y = 0.65;
const JUMP_VELOCITY = 6.5;
const GRAVITY = 18;
// Horizontal movement is velocity-based with exponential smoothing toward the input-driven
// target speed, rather than snapping straight to full speed each tick — gives real ramp-up/
// ramp-down (momentum) instead of feeling instantly-on/instantly-off. Separate accel/decel rates
// (rather than one shared rate) so starting a direction and coming to a stop can each be tuned —
// both bumped up from an initial pass that played too sluggish/floaty end-to-end.
const ACCEL_RATE = 16; // 1/s blend rate while actively holding a direction
const DECEL_RATE = 22; // 1/s blend rate coasting to a stop with no input — snappier than accel
const AIR_DECEL_RATE = 1.5; // much gentler than DECEL_RATE — real air control, not an air brake
const SLIDE_SPEED = 15;
const SLIDE_STEER_RATE = 6; // 1/s rate the slide's direction (not speed) can be redirected
// Velocity holds exactly at SLIDE_SPEED for the whole slide (no in-slide decay) — playtest
// feedback: continuous friction during the slide itself read as "the character slows down,"
// which fought against the point of a slide. Momentum still isn't an instant cutoff afterward:
// once SLIDE_DURATION_MS elapses, `sliding` just clears and the normal ACCEL_RATE/DECEL_RATE
// blend (above) picks up from whatever velocity the slide left it at, smoothly carrying it back
// toward the input-driven target speed instead of snapping.
const SLIDE_DURATION_MS = 500;
const SLIDE_COOLDOWN_MS = 1100;
const SNIPER_ZOOM_SPREAD_MULT = 0.15; // matches source's sniperZoomed spread reduction
const MAX_HP = 100;
const HEADSHOT_MULT = 2.5;
const BODY_HITBOX_RADIUS = 0.45;
const BODY_HITBOX_Y = 1.0;
const HEAD_HITBOX_RADIUS = 0.22;
const WINS_NEEDED = 3;
const ROUND_INTRO_MS = 3000;

// Pillar layout ported verbatim from 3dgames/shooter/game.js PILLAR_LAYOUT.
const PILLARS = [
  { x: 8, z: 8, hx: 1.1, hz: 1.1, height: 3.4 },
  { x: -8, z: 8, hx: 1.1, hz: 1.1, height: 3.4 },
  { x: 8, z: -8, hx: 1.1, hz: 1.1, height: 3.4 },
  { x: -8, z: -8, hx: 1.1, hz: 1.1, height: 3.4 },
  { x: 0, z: 13, hx: 1.1, hz: 1.1, height: 3.4 },
  { x: 0, z: -13, hx: 1.1, hz: 1.1, height: 3.4 },
];

// Pistol/shotgun stats ported verbatim from the source WEAPONS table (PvE-balanced already fine
// for PvP). Sniper damage retuned 110 -> 70: at 110 a single body shot deletes ~all of a fresh
// 100-HP opponent, which was fine against disposable PvE grunts but defeats the point of giving
// a 1v1 duel real per-round health bars. Headshot multiplier (2.5x, universal) still makes a
// sniper headshot a 175-damage instant kill, preserving its high-risk/high-reward identity.
const WEAPONS = {
  pistol: { damage: 22, cooldown: 330, magSize: 12, reloadTime: 1100, spread: 0.012, pellets: 1 },
  shotgun: { damage: 16, cooldown: 650, magSize: 6, reloadTime: 2200, spread: 0.10, pellets: 8, falloffRange: 14 },
  sniper: { damage: 70, cooldown: 1100, magSize: 5, reloadTime: 2300, spread: 0.002, pellets: 1 },
};
const WEAPON_IDS = ['pistol', 'shotgun', 'sniper'];

const SEATS = ['a', 'b'];
const SPAWNS = { a: { x: 0, z: 8, yaw: 0 }, b: { x: 0, z: -8, yaw: Math.PI } };

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function otherSeat(seat) {
  return seat === 'a' ? 'b' : 'a';
}

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

// Ray-vs-AABB (slab method) against a pillar's box, y in [0, height]. Returns the entry distance
// along the ray, or null if it misses.
function rayIntersectsPillar(ox, oy, oz, dx, dy, dz, pillar) {
  const minX = pillar.x - pillar.hx, maxX = pillar.x + pillar.hx;
  const minZ = pillar.z - pillar.hz, maxZ = pillar.z + pillar.hz;
  const minY = 0, maxY = pillar.height;
  let tMin = -Infinity, tMax = Infinity;

  for (const [o, d, lo, hi] of [[ox, dx, minX, maxX], [oy, dy, minY, maxY], [oz, dz, minZ, maxZ]]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  if (tMax < 0) return null;
  return tMin >= 0 ? tMin : tMax;
}

// Ray-vs-sphere. Returns the nearest positive entry distance, or null if it misses.
function rayIntersectsSphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, radius) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = 2 * (dx * lx + dy * ly + dz * lz);
  const c = lx * lx + ly * ly + lz * lz - radius * radius;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b - sqrtDisc) / 2;
  const t2 = (-b + sqrtDisc) / 2;
  if (t1 >= 0) return t1;
  if (t2 >= 0) return t2;
  return null;
}

function freshPlayer(spawn) {
  const ammo = {};
  const reloadEndsAt = {};
  for (const id of WEAPON_IDS) {
    ammo[id] = WEAPONS[id].magSize;
    reloadEndsAt[id] = null;
  }
  return {
    x: spawn.x, z: spawn.z, y: 0, yaw: spawn.yaw, pitch: 0,
    velX: 0, velZ: 0, velY: 0,
    crouching: false,
    sliding: false, slideStartedAt: 0, lastSlideAt: 0,
    zoomed: false,
    hp: MAX_HP, alive: true,
    weapon: 'pistol',
    ammo,
    // Per-weapon, not a single scalar: a reload keeps counting down even while a different
    // weapon is equipped, so switching away and back doesn't grant a free instant reload.
    reloadEndsAt,
    lastFireAt: 0,
    moveInput: { fwd: 0, strafe: 0 },
  };
}

function aimVector(yaw, pitch) {
  // Matches THREE's camera.getWorldDirection() for this rig: yaw rotates around Y, pitch tilts
  // the look vector up/down, with the source's convention of yaw=0 facing -Z.
  const cosPitch = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  };
}

function buildStatePayload(room) {
  const st = room.state;
  const players = {};
  for (const seat of SEATS) {
    const p = st.players[seat];
    const clientId = st.seats[seat];
    const nickname = clientId && room.clients.has(clientId) ? room.clients.get(clientId).nickname : null;
    players[seat] = p ? {
      clientId, nickname,
      x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      velX: p.velX, velZ: p.velZ,
      crouching: p.crouching, sliding: p.sliding, zoomed: p.zoomed,
      hp: p.hp, maxHp: MAX_HP, alive: p.alive,
      weapon: p.weapon, ammo: p.ammo, magSize: WEAPONS[p.weapon].magSize,
      // Reload status shown to the client is just for the currently-equipped weapon, even though
      // reloadEndsAt is tracked per-weapon server-side (see freshPlayer).
      reloading: p.reloadEndsAt[p.weapon] !== null,
      reloadEndsAt: p.reloadEndsAt[p.weapon],
    } : null;
  }
  return {
    kind: 'state',
    phase: st.phase,
    round: st.round,
    winsNeeded: WINS_NEEDED,
    wins: st.wins,
    seats: st.seats,
    lastRoundWinnerSeat: st.lastRoundWinnerSeat,
    matchWinner: st.matchWinner,
    matchWinReason: st.matchWinReason,
    roundEndsAt: st.roundEndsAt,
    players,
  };
}

function broadcastState(room, ctx) {
  ctx.broadcast({ v: 1, type: 'game.event', payload: { gameType: 'shooter', data: buildStatePayload(room) } });
}

function sendStateTo(room, clientId) {
  room.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'shooter', data: buildStatePayload(room) } });
}

function startRoundIntro(st) {
  st.phase = 'round_intro';
  st.roundEndsAt = Date.now() + ROUND_INTRO_MS;
}

function beginRound(st) {
  st.players.a = freshPlayer(SPAWNS.a);
  st.players.b = freshPlayer(SPAWNS.b);
  st.phase = 'playing';
  st.roundEndsAt = null;
}

function resetMatch(st) {
  st.round = 1;
  st.wins = { a: 0, b: 0 };
  st.lastRoundWinnerSeat = null;
  st.matchWinner = null;
  st.matchWinReason = null;
  st.players = { a: null, b: null };
}

module.exports = {
  type: 'shooter',
  tickIntervalMs: TICK_MS,

  createInitialState() {
    const st = { phase: 'waiting', seats: { a: null, b: null } };
    resetMatch(st);
    return st;
  },

  serializeSnapshot(room) {
    return buildStatePayload(room);
  },

  onLeave(room, client) {
    const st = room.state;
    let seat = null;
    for (const s of SEATS) if (st.seats[s] === client.clientId) seat = s;
    if (!seat) return;
    st.seats[seat] = null;

    const matchWasLive = st.phase === 'playing' || st.phase === 'round_intro';
    if (matchWasLive) {
      // A health-bar duel has real round-wins stakes a leaving player could grief away by
      // disconnecting right before losing — forfeit to the remaining player rather than
      // resetting to 'waiting' (the abort-and-lose-all-progress pattern chess/checkers/connect4
      // use for their zero-stakes-on-disconnect board games doesn't fit here).
      st.phase = 'game_over';
      st.matchWinner = otherSeat(seat);
      st.matchWinReason = 'opponent_disconnected';
    } else if (st.phase === 'game_over') {
      // Nothing to forfeit further; leave the finished result in place.
    } else {
      st.phase = 'waiting';
      resetMatch(st);
    }

    for (const clientId of room.clients.keys()) sendStateTo(room, clientId);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;
    const senderId = ctx.senderId;

    if (data.kind === 'sit') {
      const seat = data.seat === 'a' || data.seat === 'b' ? data.seat : null;
      if (!seat) return;
      if (st.seats[seat]) return;
      if (st.seats.a === senderId || st.seats.b === senderId) return;
      st.seats[seat] = senderId;
      if (st.seats.a && st.seats.b) {
        resetMatch(st);
        beginRound(st);
      }
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'leaveSeat') {
      let changed = false;
      for (const s of SEATS) {
        if (st.seats[s] === senderId) {
          st.seats[s] = null;
          changed = true;
        }
      }
      if (changed) {
        st.phase = 'waiting';
        resetMatch(st);
        broadcastState(room, ctx);
      }
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over') return;
      resetMatch(st);
      st.phase = st.seats.a && st.seats.b ? 'playing' : 'waiting';
      if (st.phase === 'playing') beginRound(st);
      broadcastState(room, ctx);
      return;
    }

    const seat = st.seats.a === senderId ? 'a' : st.seats.b === senderId ? 'b' : null;
    if (!seat || st.phase !== 'playing') return;
    const player = st.players[seat];
    if (!player || !player.alive) return;

    if (data.kind === 'move') {
      const fwd = clamp(Number(data.fwd) || 0, -1, 1);
      const strafe = clamp(Number(data.strafe) || 0, -1, 1);
      player.moveInput = { fwd, strafe };
      return;
    }

    if (data.kind === 'look') {
      const yaw = Number(data.yaw);
      const pitch = Number(data.pitch);
      if (Number.isFinite(yaw)) player.yaw = yaw;
      if (Number.isFinite(pitch)) player.pitch = clamp(pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
      return;
    }

    if (data.kind === 'switchWeapon') {
      if (WEAPON_IDS.includes(data.weapon)) player.weapon = data.weapon;
      return;
    }

    if (data.kind === 'jump') {
      if (player.y <= 0.001 && player.velY <= 0) player.velY = JUMP_VELOCITY;
      return;
    }

    if (data.kind === 'crouch') {
      player.crouching = !!data.on;
      return;
    }

    if (data.kind === 'slide') {
      const now = Date.now();
      if (player.sliding || player.y > 0.001) return;
      if (now - player.lastSlideAt < SLIDE_COOLDOWN_MS) return;
      const { fwd, strafe } = player.moveInput;
      const len = Math.hypot(fwd, strafe);
      // No held movement input: slide straight along the current facing direction instead of
      // refusing the action outright — matches most FPS games' "slide always goes somewhere".
      const nFwd = len > 0 ? fwd / len : 1;
      const nStrafe = len > 0 ? strafe / len : 0;
      const forward = { x: -Math.sin(player.yaw), z: -Math.cos(player.yaw) };
      const right = { x: Math.cos(player.yaw), z: -Math.sin(player.yaw) };
      player.velX = (forward.x * nFwd + right.x * nStrafe) * SLIDE_SPEED;
      player.velZ = (forward.z * nFwd + right.z * nStrafe) * SLIDE_SPEED;
      player.sliding = true;
      player.slideStartedAt = now;
      player.lastSlideAt = now;
      return;
    }

    if (data.kind === 'aimZoom') {
      player.zoomed = !!data.on;
      return;
    }

    if (data.kind === 'reload') {
      const id = player.weapon;
      const w = WEAPONS[id];
      if (player.reloadEndsAt[id] !== null || player.ammo[id] >= w.magSize) return;
      player.reloadEndsAt[id] = Date.now() + w.reloadTime;
      return;
    }

    if (data.kind === 'fire') {
      // Aim direction rides along with the fire action itself rather than relying solely on the
      // separately-throttled 'look' stream (sent at most every ~70ms) — otherwise a shot fired
      // the instant the player finishes tracking a target onto their crosshair could resolve
      // against aim data up to 70ms stale, which reads as "shots land below the cursor" whenever
      // the player was still moving the mouse upward onto a target at the moment of firing. Only
      // trusted as fresh input, clamped exactly like 'look' — never used to grant more than the
      // player's own most recent aim.
      const fireYaw = Number(data.yaw);
      const firePitch = Number(data.pitch);
      if (Number.isFinite(fireYaw)) player.yaw = fireYaw;
      if (Number.isFinite(firePitch)) player.pitch = clamp(firePitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
      resolveFire(room, ctx, seat, player);
      return;
    }
  },

  tick(room, ctx) {
    const st = room.state;
    const now = Date.now();

    if (st.phase === 'round_intro' && st.roundEndsAt !== null && now >= st.roundEndsAt) {
      beginRound(st);
    } else if (st.phase === 'playing') {
      for (const seat of SEATS) {
        const p = st.players[seat];
        if (!p || !p.alive) continue;
        // Checked for every weapon, not just the equipped one: a reload keeps counting down in
        // the background after switching away (see freshPlayer's reloadEndsAt comment).
        for (const id of WEAPON_IDS) {
          if (p.reloadEndsAt[id] !== null && now >= p.reloadEndsAt[id]) {
            p.ammo[id] = WEAPONS[id].magSize;
            p.reloadEndsAt[id] = null;
          }
        }
        const dtSec = TICK_MS / 1000;

        if (p.sliding && now - p.slideStartedAt >= SLIDE_DURATION_MS) {
          p.sliding = false;
        }
        if (p.sliding) {
          // Steerable slide: held input gradually redirects the slide's velocity DIRECTION
          // (dodging left/right, e.g. to evade fire) without changing its SPEED — holding nothing
          // keeps coasting straight in whatever direction it's currently facing. This is a
          // rotation of the existing velocity vector, not a blend toward a target velocity like
          // normal movement below, so it can't be used to speed up or brake the slide.
          const { fwd, strafe } = p.moveInput;
          const len = Math.hypot(fwd, strafe);
          if (len > 0) {
            const nFwd = fwd / len, nStrafe = strafe / len;
            const forward = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
            const right = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
            const desiredX = forward.x * nFwd + right.x * nStrafe;
            const desiredZ = forward.z * nFwd + right.z * nStrafe;
            const speed = Math.hypot(p.velX, p.velZ) || SLIDE_SPEED;
            const curDirX = p.velX / speed, curDirZ = p.velZ / speed;
            const steerBlend = 1 - Math.exp(-SLIDE_STEER_RATE * dtSec);
            let newDirX = curDirX + (desiredX - curDirX) * steerBlend;
            let newDirZ = curDirZ + (desiredZ - curDirZ) * steerBlend;
            const newDirLen = Math.hypot(newDirX, newDirZ) || 1;
            p.velX = (newDirX / newDirLen) * speed;
            p.velZ = (newDirZ / newDirLen) * speed;
          }
        } else {
          const { fwd, strafe } = p.moveInput;
          const len = Math.hypot(fwd, strafe);
          let targetX = 0, targetZ = 0;
          if (len > 0) {
            const nFwd = fwd / len, nStrafe = strafe / len;
            const forward = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
            const right = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
            const speed = MOVE_SPEED * (p.crouching ? CROUCH_SPEED_MULT : 1);
            targetX = (forward.x * nFwd + right.x * nStrafe) * speed;
            targetZ = (forward.z * nFwd + right.z * nStrafe) * speed;
          }
          // Exponential blend toward the target velocity — real ramp-up when starting/changing
          // direction and real ramp-down (coasting) when releasing input, instead of snapping
          // straight to full speed or an instant stop. Decelerating (no input) uses its own,
          // snappier rate so releasing a key doesn't feel like sliding on ice — but only while
          // grounded: applying that same snappy rate in mid-air (e.g. jumping out of a slide)
          // was an abrupt "air brake" the instant the slide's timer ran out while still airborne,
          // so airborne coasting decays much more gently, closer to real momentum preservation.
          const grounded = p.y <= 0.001;
          const rate = len > 0 ? ACCEL_RATE : (grounded ? DECEL_RATE : AIR_DECEL_RATE);
          const blend = 1 - Math.exp(-rate * dtSec);
          p.velX += (targetX - p.velX) * blend;
          p.velZ += (targetZ - p.velZ) * blend;
        }

        const resolved = resolvePillarCollision(p.x + p.velX * dtSec, p.z + p.velZ * dtSec, PLAYER_RADIUS);
        p.x = resolved.x;
        p.z = resolved.z;

        // Vertical physics (jump arc + gravity), independent of horizontal movement/sliding —
        // horizontal velocity is never touched here, so a jump preserves whatever momentum the
        // player already had (no artificial mid-air braking).
        p.velY -= GRAVITY * dtSec;
        p.y += p.velY * dtSec;
        if (p.y <= 0) {
          p.y = 0;
          p.velY = 0;
        }
      }
    }

    if (room.clients.size > 0) broadcastState(room, ctx);
  },
};

function resolveFire(room, ctx, seat, shooter) {
  const st = room.state;
  const id = shooter.weapon;
  const w = WEAPONS[id];
  const now = Date.now();
  if (shooter.reloadEndsAt[id] !== null) return;
  if (now - shooter.lastFireAt < w.cooldown) return;
  if (shooter.ammo[id] <= 0) return;

  shooter.ammo[id] -= 1;
  shooter.lastFireAt = now;
  if (shooter.ammo[id] <= 0) {
    shooter.reloadEndsAt[id] = now + w.reloadTime;
  }

  const targetSeat = otherSeat(seat);
  const target = st.players[targetSeat];
  const originX = shooter.x, originZ = shooter.z;
  // Sliding gives the same low profile as crouching (a fast-moving player should also be a
  // harder target, matching the "slide should make you crouch a little" request) — for both the
  // shooter's own eye height and a target's hitbox height.
  const shooterLow = shooter.crouching || shooter.sliding;
  const originY = shooter.y + (shooterLow ? CROUCH_EYE_HEIGHT : EYE_HEIGHT);

  // Sniper scope tightens spread when actively zoomed (matches source's sniperZoomed reduction);
  // meaningless for other weapons, so gate on both the flag and the equipped weapon.
  const spread = shooter.zoomed && id === 'sniper' ? w.spread * SNIPER_ZOOM_SPREAD_MULT : w.spread;

  // Per-pellet direction + travel distance, collected so the client can draw a real tracer per
  // pellet (matching what actually happened, e.g. the shotgun's spread) instead of just one line
  // — previously only ever one tracer was sent regardless of pellet count, so the shotgun's 8
  // pellets all visually looked like one hitscan shot rather than a spread.
  const pelletVisuals = [];
  const MAX_VISUAL_DIST = 40;

  let bestHit = null; // { dist, headshot }
  for (let i = 0; i < w.pellets; i++) {
    const base = aimVector(shooter.yaw, shooter.pitch);
    let dx = base.x + (Math.random() - 0.5) * spread;
    let dy = base.y + (Math.random() - 0.5) * spread;
    let dz = base.z + (Math.random() - 0.5) * spread;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;

    let pillarDist = Infinity;
    for (const p of PILLARS) {
      const d = rayIntersectsPillar(originX, originY, originZ, dx, dy, dz, p);
      if (d !== null && d < pillarDist) pillarDist = d;
    }

    let hitDist = null;
    let headshot = false;
    if (target && target.alive) {
      const targetLow = target.crouching || target.sliding;
      const targetBodyY = target.y + (targetLow ? CROUCH_BODY_HITBOX_Y : BODY_HITBOX_Y);
      const targetHeadY = target.y + (targetLow ? CROUCH_EYE_HEIGHT : EYE_HEIGHT);
      const bodyDist = rayIntersectsSphere(originX, originY, originZ, dx, dy, dz, target.x, targetBodyY, target.z, BODY_HITBOX_RADIUS);
      const headDist = rayIntersectsSphere(originX, originY, originZ, dx, dy, dz, target.x, targetHeadY, target.z, HEAD_HITBOX_RADIUS);
      if (headDist !== null && (bodyDist === null || headDist <= bodyDist)) {
        hitDist = headDist;
        headshot = true;
      } else if (bodyDist !== null) {
        hitDist = bodyDist;
        headshot = false;
      }
    }

    if (hitDist !== null && hitDist < pillarDist) {
      if (!bestHit || hitDist < bestHit.dist) bestHit = { dist: hitDist, headshot };
      pelletVisuals.push({ x: dx, y: dy, z: dz, dist: hitDist });
    } else {
      pelletVisuals.push({ x: dx, y: dy, z: dz, dist: Math.min(pillarDist, MAX_VISUAL_DIST) });
    }
  }

  let damage = 0;
  let hitLanded = false;
  if (bestHit) {
    hitLanded = true;
    damage = w.damage;
    if (w.falloffRange) damage *= clamp(1 - bestHit.dist / (w.falloffRange * 2.2), 0.35, 1);
    if (bestHit.headshot) damage *= HEADSHOT_MULT;
    target.hp = Math.max(0, target.hp - damage);
  }

  ctx.broadcast({
    v: 1, type: 'game.event', payload: { gameType: 'shooter', data: {
      kind: 'shot', shooterSeat: seat, weapon: shooter.weapon,
      origin: { x: originX, y: originY, z: originZ },
      yaw: shooter.yaw, pitch: shooter.pitch, pellets: pelletVisuals,
      hit: hitLanded, hitSeat: hitLanded ? targetSeat : null,
      headshot: hitLanded ? bestHit.headshot : false, damage: hitLanded ? Math.round(damage) : 0,
    } },
  });

  if (target && target.alive && target.hp <= 0) {
    target.alive = false;
    st.wins[seat] += 1;
    st.lastRoundWinnerSeat = seat;
    if (st.wins[seat] >= WINS_NEEDED) {
      st.phase = 'game_over';
      st.matchWinner = seat;
      st.matchWinReason = 'rounds';
    } else {
      st.round += 1;
      startRoundIntro(st);
    }
    broadcastState(room, ctx);
  }
}
