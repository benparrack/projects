// Slope-style 3D endless runner. Shared-track race (see FUTURE.md's "Slope-style ball runner"
// writeup): every player in the room gets their own ball on the SAME seeded procedural track,
// racing to survive longest. Real-time tick-loop game, same `tickIntervalMs`/`tick(room, ctx)`
// hook as slither.js.
//
// IMPORTANT — server/client sync: the track-geometry functions below (hash32/segRand/ensureTrack/
// trackHalfWidthAt/hazardAt and every constant they use) are duplicated VERBATIM in
// public/games/slope/client.js. The server is the collision authority and the client only
// renders — if the two copies ever diverge, "what you see" and "what kills you" disagree. Any
// edit to the track-generation math here must be mirrored there exactly.

const TICK_MS = 50; // 20Hz, matches slither.js

const SEG_LEN = 8; // world units per track segment
const BASE_HALF_WIDTH = 6;
const MIN_HALF_WIDTH = 2.5;
const NARROW_RATE = 0.0025; // half-width lost per segment index
const MAX_CENTER = 40; // track center offset clamp, so the winding path can't drift forever
const MAX_DELTA_PER_SEG = 0.6; // max center-offset change per segment (keeps curves rideable)

const HAZARD_START_SEG = 15; // no hazards for the first ~120 units, a warm-up straight
const BASE_HAZARD_CHANCE = 0.09;
const HAZARD_RAMP = 0.001; // per segment past HAZARD_START_SEG
const MAX_HAZARD_CHANCE = 0.45;
const MIN_HAZARD_W = 1.5;
const SAFE_GAP = 2.4; // guaranteed minimum passage width past any hazard (ball radius ~0.45)

// Gap obstacles: a block of GAP_LEN_SEGS consecutive segments with no ground — the ball must
// glide over them (a purely cosmetic client-side jump arc, see client.js) rather than dodge them
// laterally. Gap blocks are always ground-safe to cross (no new death condition — going off the
// *side* of the track over a gap still kills you the same as anywhere else, same as normal edge
// death below), so this needs no new server-side collision logic at all, just suppressing the
// ordinary lateral hazard on gap segments (see gapBlockAt/hazardAt).
const GAP_START_SEG = 30; // gaps show up after hazards have had a chance to establish
const GAP_LEN_SEGS = 2;
const BASE_GAP_CHANCE = 0.02;
const GAP_RAMP = 0.0003;
const MAX_GAP_CHANCE = 0.14;
const GAP_SALT_BASE = 1000000; // distinct salt namespace from the i*4+{0..3} salts below

const BASE_SPEED = 0.6; // distance per tick
const SPEED_RAMP = 0.00004; // extra speed per unit distance traveled
const MAX_SPEED = 2.4;

// Steering: a gentle glide, not a snap. At 20Hz, holding a direction reaches ~90% of the
// steady-state drift speed (LATERAL_ACCEL / (1 - LATERAL_FRICTION) ~= 1.0) after about 10 ticks
// (~0.5s) — a deliberate ~3x slower ramp than an earlier version that reached its (higher) cap
// within ~4 ticks and read as an instant jump. MAX_LATERAL_SPEED stays a hard safety ceiling
// above the steady-state value, so it's a backstop, not the thing steering normally rides against.
const LATERAL_ACCEL = 0.12;
const MAX_LATERAL_SPEED = 1.4;
const LATERAL_FRICTION = 0.82; // multiplicative decay applied every tick

const COUNTDOWN_MS = 3000;
const RESULTS_PAUSE_MS = 4000;
const LEADERBOARD_SIZE = 8;

// Deterministic 32-bit hash of (seed, i) — avalanches well enough for game-grade randomness
// (not cryptographic). Same seed + same i always produces the same value, on server and client.
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

// Extends st.trackCenters (a running sum of small per-segment deltas, reflected off
// +/-MAX_CENTER so the path can't drift unboundedly) up through index `upto`, inclusive.
function ensureTrack(st, upto) {
  while (st.trackCenters.length <= upto) {
    const i = st.trackCenters.length;
    const prev = i === 0 ? 0 : st.trackCenters[i - 1];
    const delta = (segRand(st.seed, i * 4 + 0) - 0.5) * 2 * MAX_DELTA_PER_SEG;
    let next = prev + delta;
    if (next > MAX_CENTER) next = prev - Math.abs(delta);
    if (next < -MAX_CENTER) next = prev + Math.abs(delta);
    st.trackCenters.push(next);
  }
}

function trackHalfWidthAt(i) {
  return Math.max(MIN_HALF_WIDTH, BASE_HALF_WIDTH - NARROW_RATE * i);
}

// True if segment `i` falls inside a "gap" block — GAP_LEN_SEGS consecutive segments with no
// ground, always block-aligned (block = floor(i / GAP_LEN_SEGS)) so a gap is never split across
// two independent rolls. One roll per block, salted well outside the per-segment salt range used
// elsewhere so it can't correlate with hazard/track-curve randomness.
function gapBlockAt(seed, i) {
  const block = Math.floor(i / GAP_LEN_SEGS);
  const blockStartSeg = block * GAP_LEN_SEGS;
  if (blockStartSeg < GAP_START_SEG) return false;
  const chance = Math.min(MAX_GAP_CHANCE, BASE_GAP_CHANCE + GAP_RAMP * (blockStartSeg - GAP_START_SEG));
  const roll = segRand(seed, GAP_SALT_BASE + block);
  return roll < chance;
}

// Returns null (no hazard this segment) or { start, end } — a lateral sub-range (absolute,
// same coordinate space as trackCenters/player lateral position) that kills on contact. Always
// leaves at least SAFE_GAP of passage within the track's current width, so every segment is
// beatable with correct steering — never a guaranteed-death segment. Gap segments never carry a
// lateral hazard too (the ball's already gliding over them, see gapBlockAt above).
function hazardAt(st, i) {
  if (i < HAZARD_START_SEG) return null;
  if (gapBlockAt(st.seed, i)) return null;
  const chance = Math.min(MAX_HAZARD_CHANCE, BASE_HAZARD_CHANCE + HAZARD_RAMP * (i - HAZARD_START_SEG));
  const roll = segRand(st.seed, i * 4 + 1);
  if (roll >= chance) return null;
  const halfWidth = trackHalfWidthAt(i);
  const center = st.trackCenters[i];
  const maxW = Math.max(MIN_HAZARD_W, halfWidth * 2 - SAFE_GAP);
  const span = Math.max(maxW - MIN_HAZARD_W, 0.001);
  const width = Math.min(maxW, MIN_HAZARD_W + segRand(st.seed, i * 4 + 2) * span);
  const maxOffset = Math.max(0, halfWidth - width / 2);
  const offset = (segRand(st.seed, i * 4 + 3) - 0.5) * 2 * maxOffset;
  const hazCenter = center + offset;
  return { start: hazCenter - width / 2, end: hazCenter + width / 2 };
}

function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

function freshPlayer(clientId, nickname) {
  return {
    clientId,
    nickname,
    racingThisRound: false,
    alive: false,
    distance: 0,
    lateralPos: 0,
    lateralSpeed: 0,
    steerDir: 0,
    finalDistance: null,
    deathReason: null, // 'edge' | 'hazard' | null — lets the client tell "fell off the side"
    // (cosmetic falling animation) apart from "hit an obstacle" (stops in place). No death
    // condition depends on this — it's purely a client-rendering hint.
  };
}

function startCountdown(st, now) {
  st.phase = 'countdown';
  st.phaseEndsAt = now + COUNTDOWN_MS;
  st.seed = randomSeed();
  st.trackCenters = [0];
  for (const p of st.players.values()) {
    p.racingThisRound = true;
    p.alive = true;
    p.distance = 0;
    p.lateralPos = 0;
    p.lateralSpeed = 0;
    p.steerDir = 0;
    p.finalDistance = null;
    p.deathReason = null;
  }
}

function stepPlayer(st, p) {
  const speed = Math.min(MAX_SPEED, BASE_SPEED + p.distance * SPEED_RAMP);
  p.distance += speed;
  p.lateralSpeed = p.lateralSpeed * LATERAL_FRICTION + p.steerDir * LATERAL_ACCEL;
  if (p.lateralSpeed > MAX_LATERAL_SPEED) p.lateralSpeed = MAX_LATERAL_SPEED;
  if (p.lateralSpeed < -MAX_LATERAL_SPEED) p.lateralSpeed = -MAX_LATERAL_SPEED;
  p.lateralPos += p.lateralSpeed;

  const segIndex = Math.floor(p.distance / SEG_LEN);
  ensureTrack(st, segIndex + 1);
  const halfWidth = trackHalfWidthAt(segIndex);
  const center = st.trackCenters[segIndex];

  let dead = p.lateralPos < center - halfWidth || p.lateralPos > center + halfWidth;
  let deathReason = dead ? 'edge' : null;
  if (!dead) {
    const haz = hazardAt(st, segIndex);
    if (haz && p.lateralPos >= haz.start && p.lateralPos <= haz.end) {
      dead = true;
      deathReason = 'hazard';
    }
  }
  if (dead) {
    p.alive = false;
    p.finalDistance = p.distance;
    p.deathReason = deathReason;
  }
}

function buildLeaderboard(st) {
  return [...st.players.values()]
    .filter((p) => p.racingThisRound)
    .map((p) => ({
      clientId: p.clientId,
      nickname: p.nickname,
      alive: p.alive,
      distance: Math.round((p.alive ? p.distance : p.finalDistance) * 10) / 10,
    }))
    .sort((a, b) => b.distance - a.distance)
    .slice(0, LEADERBOARD_SIZE);
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    phaseEndsAt: st.phase === 'countdown' || st.phase === 'results' ? st.phaseEndsAt : null,
    seed: st.seed,
    players: [...st.players.values()].map((p) => ({
      clientId: p.clientId,
      nickname: p.nickname,
      racingThisRound: p.racingThisRound,
      alive: p.alive,
      distance: Math.round(p.distance * 10) / 10,
      lateralPos: Math.round(p.lateralPos * 100) / 100,
      finalDistance: p.finalDistance,
      deathReason: p.deathReason,
    })),
    leaderboard: buildLeaderboard(st),
  };
}

function broadcastState(room, ctx) {
  ctx.broadcast({ v: 1, type: 'game.event', payload: { gameType: 'slope', data: { kind: 'state', ...buildPublicState(room) } } });
}

module.exports = {
  type: 'slope',
  tickIntervalMs: TICK_MS,

  createInitialState() {
    return {
      phase: 'waiting', // 'waiting' | 'countdown' | 'racing' | 'results'
      phaseEndsAt: null,
      seed: randomSeed(),
      trackCenters: [0],
      players: new Map(),
    };
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  onJoin(room, client) {
    room.state.players.set(client.clientId, freshPlayer(client.clientId, client.nickname));
  },

  onLeave(room, client) {
    room.state.players.delete(client.clientId);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    if (data.kind === 'steer') {
      const p = room.state.players.get(ctx.senderId);
      if (!p) return;
      const dir = Number(data.dir);
      p.steerDir = dir > 0 ? 1 : dir < 0 ? -1 : 0;
    }
  },

  tick(room, ctx) {
    const st = room.state;
    const now = Date.now();

    if (st.phase === 'waiting') {
      if (st.players.size > 0) startCountdown(st, now);
    } else if (st.phase === 'countdown') {
      if (now >= st.phaseEndsAt) {
        st.phase = 'racing';
      }
    } else if (st.phase === 'racing') {
      const racers = [...st.players.values()].filter((p) => p.racingThisRound);
      for (const p of racers) {
        if (p.alive) stepPlayer(st, p);
      }
      if (racers.length > 0 && racers.every((p) => !p.alive)) {
        st.phase = 'results';
        st.phaseEndsAt = now + RESULTS_PAUSE_MS;
      }
    } else if (st.phase === 'results') {
      if (now >= st.phaseEndsAt) {
        st.phase = 'waiting';
        st.phaseEndsAt = null;
      }
    }

    broadcastState(room, ctx);
  },
};
