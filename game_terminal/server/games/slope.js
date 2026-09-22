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
const BASE_GAP_CHANCE = 0.03;
const GAP_RAMP = 0.0004;
const MAX_GAP_CHANCE = 0.18;
const GAP_SALT_BASE = 1000000; // distinct salt namespace from the i*4+{0..3} salts below

// Speed boosts: a small pickup at a deterministic (segment, lateral) spot. Touching one
// PERMANENTLY raises that player's speed for the rest of the round (see p.speedBonus in
// freshPlayer/stepPlayer) — unlike hazards/gaps this has per-player STATE (which boosts you've
// already collected), not just geometry, so it can't be a pure function of (seed, segment) alone
// on the collection side, only on the "where is it" side.
const BOOST_START_SEG = 20;
const BOOST_CHANCE = 0.035; // flat per-segment chance, not ramped — a steady trickle of rewards
const BOOST_SALT_BASE = 2000000; // distinct namespace from gap (1e6) and hazard-motion (3e6) salts
const BOOST_PICKUP_RADIUS = 0.6;
const BOOST_SPEED_INCREMENT = 0.2;
const MAX_BOOST_BONUS = 2.0; // caps total bonus around 10 boosts' worth

// Hazard motion: most hazards stay static (unchanged behavior/fairness guarantees), but past
// MOVING_HAZARD_START_SEG some become time-based — 'lr' oscillates side to side, 'updown' toggles
// between fully blocking and fully retracted (this game has no real vertical axis for the ball to
// actually go over/under, so "up/down" is expressed as a blink-danger timing window instead of
// true vertical motion). Motion needs a shared elapsed-time-since-race-start clock (st.raceStartedAt
// below) that server and client both read — unlike the rest of the track math, this is NOT purely
// a function of (seed, segment) anymore, it also depends on "when," so both sides must agree on
// what "when" means. Server and client each read their own Date.now(), with no clock-sync
// mechanism between them (same as this hub's existing countdown-timer display) — harmless here
// since the SERVER remains sole collision authority regardless of what the client renders; only
// the client's visual sync with the actual kill moment could drift slightly, not fairness itself.
const MOVING_HAZARD_START_SEG = 40;
const HAZARD_MOTION_SALT_BASE = 3000000;
const HAZARD_OSC_PERIOD_MS = 2200;
const HAZARD_OSC_AMPLITUDE_FRAC = 0.7; // fraction of the old max lateral offset — leaves margin
const HAZARD_TOGGLE_PERIOD_MS = 1800;
const HAZARD_TOGGLE_ACTIVE_FRAC = 0.55; // fraction of each cycle the toggle hazard is dangerous

const BASE_SPEED = 0.6; // distance per tick
const SPEED_RAMP = 0.00004; // extra speed per unit distance traveled
const MAX_SPEED = 2.4; // ramp-only ceiling (no boosts collected)
const MAX_SPEED_WITH_BOOST = 4.2; // hard ceiling once speedBonus is included

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

// Which motion behavior segment i's hazard uses (only consulted for segments at/past
// MOVING_HAZARD_START_SEG — earlier hazards are always 'static'). Independent per-segment roll
// in its own salt namespace so it doesn't correlate with whether a hazard even exists there.
function hazardMotionType(seed, i) {
  if (i < MOVING_HAZARD_START_SEG) return 'static';
  const roll = segRand(seed, HAZARD_MOTION_SALT_BASE + i);
  if (roll < 0.5) return 'static';
  if (roll < 0.75) return 'lr';
  return 'updown';
}

// Returns null (no hazard this segment, or an 'updown' hazard currently retracted) or
// { start, end } — a lateral sub-range (absolute, same coordinate space as
// trackCenters/player lateral position) that kills on contact.
//
// `elapsedMs` is time since the current race started (Math.max(0, ...)-clamped by the caller) —
// only consulted for 'lr'/'updown' hazards; 'static' ones (the majority, and everything before
// MOVING_HAZARD_START_SEG) behave EXACTLY as before, fixed-offset, always leaving at least
// SAFE_GAP of passage. 'lr' oscillates its center via a sine of elapsedMs, amplitude capped at
// HAZARD_OSC_AMPLITUDE_FRAC of the old max offset so it never reaches the track edge even at
// full swing — still leaves SAFE_GAP at every instant, same guarantee, just time-varying instead
// of fixed. 'updown' reuses the exact static-position math but blinks between fully blocking and
// fully absent on a timer (this game has no real vertical axis, so "up/down" reads as a timed
// danger window instead of true vertical motion) — when retracted it's strictly safer than a
// static hazard (no kill-zone at all), so the SAFE_GAP guarantee holds trivially. Each hazard's
// phase is offset by its own per-segment seeded value so multiple moving hazards don't all
// swing/blink in lockstep.
function hazardAt(st, i, elapsedMs) {
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
  const phaseSeed = segRand(st.seed, i * 4 + 3); // reused both as the static offset AND as each
  // moving hazard's own phase/duty-cycle offset — same source, different use per motion type.
  const motion = hazardMotionType(st.seed, i);

  let hazCenter;
  if (motion === 'lr') {
    const amplitude = maxOffset * HAZARD_OSC_AMPLITUDE_FRAC;
    const phase = (elapsedMs / HAZARD_OSC_PERIOD_MS) * 2 * Math.PI + phaseSeed * 2 * Math.PI;
    hazCenter = center + Math.sin(phase) * amplitude;
  } else if (motion === 'updown') {
    const cyclePos = ((elapsedMs + phaseSeed * HAZARD_TOGGLE_PERIOD_MS) % HAZARD_TOGGLE_PERIOD_MS) / HAZARD_TOGGLE_PERIOD_MS;
    if (cyclePos >= HAZARD_TOGGLE_ACTIVE_FRAC) return null; // currently retracted — safe
    const offset = (phaseSeed - 0.5) * 2 * maxOffset;
    hazCenter = center + offset;
  } else {
    const offset = (phaseSeed - 0.5) * 2 * maxOffset;
    hazCenter = center + offset;
  }
  return { start: hazCenter - width / 2, end: hazCenter + width / 2, motion };
}

// Speed boost pickup: null, or a single lateral point { pos } the ball must pass close to
// (BOOST_PICKUP_RADIUS) to collect. Flat per-segment chance (no ramp — a steady trickle, not an
// escalating one like hazards/gaps), independent salt namespace, and deliberately allowed to
// land on a segment that also has a hazard (risk/reward) — a boost is optional to collect, unlike
// a hazard's mandatory-dodge, so it doesn't need hazardAt's SAFE_GAP-style fairness guarantee.
// Never placed on a gap segment (no ground there to stand on while collecting it).
function boostAt(st, i) {
  if (i < BOOST_START_SEG) return null;
  if (gapBlockAt(st.seed, i)) return null;
  const roll = segRand(st.seed, BOOST_SALT_BASE + i);
  if (roll >= BOOST_CHANCE) return null;
  const halfWidth = trackHalfWidthAt(i);
  const center = st.trackCenters[i];
  const offsetFrac = (segRand(st.seed, BOOST_SALT_BASE + i + 500000) - 0.5) * 2; // -1..1
  const pos = center + offsetFrac * Math.max(0, halfWidth - 0.6);
  return { pos };
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
    speedBonus: 0, // permanent speed add-on from collected boosts, see stepPlayer/MAX_SPEED_WITH_BOOST
    boostSegsCollected: new Set(), // segment indices already collected this round — collection
    // has per-player STATE (unlike hazards/gaps' pure geometry), so it can't just be re-derived
    // from (seed, segment) the way everything else on the track is.
  };
}

function startCountdown(st, now) {
  st.phase = 'countdown';
  st.phaseEndsAt = now + COUNTDOWN_MS;
  st.raceStartedAt = now + COUNTDOWN_MS; // moving-hazard clock zeroes exactly when racing begins
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
    p.speedBonus = 0;
    p.boostSegsCollected = new Set();
  }
}

function stepPlayer(st, p, elapsedMs) {
  const speed = Math.min(MAX_SPEED_WITH_BOOST, BASE_SPEED + p.distance * SPEED_RAMP + p.speedBonus);
  p.distance += speed;
  p.lateralSpeed = p.lateralSpeed * LATERAL_FRICTION + p.steerDir * LATERAL_ACCEL;
  if (p.lateralSpeed > MAX_LATERAL_SPEED) p.lateralSpeed = MAX_LATERAL_SPEED;
  if (p.lateralSpeed < -MAX_LATERAL_SPEED) p.lateralSpeed = -MAX_LATERAL_SPEED;
  p.lateralPos += p.lateralSpeed;

  const segIndex = Math.floor(p.distance / SEG_LEN);
  ensureTrack(st, segIndex + 1);
  const halfWidth = trackHalfWidthAt(segIndex);
  const center = st.trackCenters[segIndex];

  const boost = boostAt(st, segIndex);
  if (boost && !p.boostSegsCollected.has(segIndex) && Math.abs(p.lateralPos - boost.pos) <= BOOST_PICKUP_RADIUS) {
    p.boostSegsCollected.add(segIndex);
    p.speedBonus = Math.min(MAX_BOOST_BONUS, p.speedBonus + BOOST_SPEED_INCREMENT);
  }

  let dead = p.lateralPos < center - halfWidth || p.lateralPos > center + halfWidth;
  let deathReason = dead ? 'edge' : null;
  if (!dead) {
    const haz = hazardAt(st, segIndex, elapsedMs);
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
    raceStartedAt: st.raceStartedAt, // shared clock the client uses to render moving hazards in sync
    players: [...st.players.values()].map((p) => ({
      clientId: p.clientId,
      nickname: p.nickname,
      racingThisRound: p.racingThisRound,
      alive: p.alive,
      distance: Math.round(p.distance * 10) / 10,
      lateralPos: Math.round(p.lateralPos * 100) / 100,
      finalDistance: p.finalDistance,
      deathReason: p.deathReason,
      boostCount: p.boostSegsCollected.size,
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
      raceStartedAt: null,
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
      const elapsedMs = Math.max(0, now - st.raceStartedAt);
      const racers = [...st.players.values()].filter((p) => p.racingThisRound);
      for (const p of racers) {
        if (p.alive) stepPlayer(st, p, elapsedMs);
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

  // Exposed for the standalone verification script only — not used by the room/ctx runtime.
  _internal: { hash32, segRand, trackHalfWidthAt, gapBlockAt, hazardAt, hazardMotionType, boostAt, ensureTrack },
};
