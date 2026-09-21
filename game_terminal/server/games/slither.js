// Slither.io-style real-time game. Unlike the event-driven games (drawing/hangman/checkers/
// chess), the world advances on its own schedule via the `tick`/`tickIntervalMs` hook that
// RoomManager calls on an interval — see FUTURE.md for the design writeup this implements.

const TICK_MS = 50; // 20Hz
const ARENA_SIZE = 3000;
const BASE_SPEED = 3.3; // world units per tick — bumped from 2.6, playtest feedback: "go faster naturally"
const BOOST_MULT = 2.0;
const TURN_RATE = 0.15; // max radians the heading can change per tick
const START_LENGTH = 120;
const MAX_LENGTH = 3000;
const POINT_SPACING = 6; // approx distance between stored path points
const BASE_SNAKE_RADIUS = 9;
// Girth grows alongside length, not just the tail getting longer — playtest feedback: "make width
// difference at lots of points bigger", so a long snake reads as visibly thicker, not just longer.
const MAX_SNAKE_RADIUS = 26;
const RADIUS_GROWTH_LENGTH = 2400; // length gained (beyond START_LENGTH) to reach MAX_SNAKE_RADIUS
const FOOD_RADIUS = 6;
const FOOD_COUNT = 220;
const FOOD_VALUE = 14;
const FOOD_REFILL_PER_TICK = 5;
const BOOST_DRAIN_PER_TICK = 0.7; // halved from 1.4 — playtest feedback: "make boost eat up less"
const MIN_BOOST_LENGTH = 60; // below START_LENGTH so a fresh spawn can boost immediately
const RESPAWN_MS = 1200;
const DEATH_FOOD_STRIDE = 4; // drop one food pellet every N corpse points
const LEADERBOARD_SIZE = 5;
const SPAWN_MARGIN = 300; // keep spawns away from arena walls
const SPAWN_SAFE_RADIUS = 150; // keep new spawns clear of other snakes' heads by roughly this much
const SPAWN_ATTEMPTS = 8;

// Drives collision distance (below) and food-eating range — gameplay-critical, so this stays
// conservative even though public/games/slither/client.js's own computeRadius (used only for
// the rendered stroke width) now grows much more dramatically per playtest feedback ("make width
// difference at lots of points bigger"). The two intentionally no longer match 1:1: widening
// this one too would silently make big snakes easier to hit and able to eat food from farther
// away, not just look better.
function radiusFor(snake) {
  const t = Math.min(1, Math.max(0, (snake.length - START_LENGTH) / RADIUS_GROWTH_LENGTH));
  return BASE_SNAKE_RADIUS + (MAX_SNAKE_RADIUS - BASE_SNAKE_RADIUS) * t;
}

const COLOR_PALETTE = ['#39ff14', '#ffb000', '#00e5ff', '#ff4dd2', '#ff4d4d', '#c792ff', '#ffee58'];

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function randomFood(st) {
  return {
    id: st.nextFoodId++,
    x: Math.random() * st.arenaSize,
    y: Math.random() * st.arenaSize,
    value: FOOD_VALUE,
  };
}

// Picks a spawn point clear of other live snakes' heads where possible (checking heads only,
// not full bodies, as a cheap approximation — good enough to avoid the common "respawned
// straight into someone" case without walking every snake's whole path on every spawn).
// Falls back to the last attempt if the arena is too crowded to find a fully clear spot.
function pickSpawnPoint(st) {
  let candidate = { x: st.arenaSize / 2, y: st.arenaSize / 2 };
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
    const x = SPAWN_MARGIN + Math.random() * (st.arenaSize - SPAWN_MARGIN * 2);
    const y = SPAWN_MARGIN + Math.random() * (st.arenaSize - SPAWN_MARGIN * 2);
    candidate = { x, y };
    let clear = true;
    for (const s of st.snakes.values()) {
      if (!s.alive) continue;
      const head = s.points[0];
      if (Math.hypot(head.x - x, head.y - y) < SPAWN_SAFE_RADIUS) {
        clear = false;
        break;
      }
    }
    if (clear) return candidate;
  }
  return candidate;
}

function spawnSnake(clientId, nickname, st) {
  const angle = Math.random() * Math.PI * 2;
  const { x, y } = pickSpawnPoint(st);
  const pointCount = Math.ceil(START_LENGTH / POINT_SPACING);
  const points = [];
  for (let i = 0; i < pointCount; i++) {
    points.push({ x: x - Math.cos(angle) * i * POINT_SPACING, y: y - Math.sin(angle) * i * POINT_SPACING });
  }
  return {
    clientId,
    nickname,
    alive: true,
    angle,
    targetAngle: angle,
    boosting: false,
    length: START_LENGTH,
    points,
    respawnAt: null,
  };
}

function respawn(snake, st) {
  const fresh = spawnSnake(snake.clientId, snake.nickname, st);
  snake.alive = true;
  snake.angle = fresh.angle;
  snake.targetAngle = fresh.angle;
  // Deliberately NOT resetting snake.boosting here: it mirrors the client's actual held input
  // (see onMessage's 'boost' handler), and the client only resends that message when the input
  // *changes* (see client.js's sendBoost — edge-triggered). If we forced it false on every
  // respawn, a player still holding boost across a death would have boost silently stop working
  // until they released and re-pressed it, since from the client's perspective nothing changed.
  snake.length = fresh.length;
  snake.points = fresh.points;
  snake.respawnAt = null;
}

function trimToLength(snake) {
  let dist = 0;
  for (let i = 1; i < snake.points.length; i++) {
    const a = snake.points[i - 1];
    const b = snake.points[i];
    dist += Math.hypot(b.x - a.x, b.y - a.y);
    if (dist >= snake.length) {
      snake.points.length = i + 1;
      return;
    }
  }
}

function stepSnake(snake) {
  let diff = normalizeAngle(snake.targetAngle - snake.angle);
  if (diff > TURN_RATE) diff = TURN_RATE;
  if (diff < -TURN_RATE) diff = -TURN_RATE;
  snake.angle = normalizeAngle(snake.angle + diff);

  const boosting = snake.boosting && snake.length > MIN_BOOST_LENGTH;
  const speed = BASE_SPEED * (boosting ? BOOST_MULT : 1);
  const head = snake.points[0];
  snake.points.unshift({
    x: head.x + Math.cos(snake.angle) * speed,
    y: head.y + Math.sin(snake.angle) * speed,
  });

  if (boosting) snake.length = Math.max(MIN_BOOST_LENGTH, snake.length - BOOST_DRAIN_PER_TICK);
  trimToLength(snake);
}

function killSnake(st, snake) {
  snake.alive = false;
  snake.respawnAt = Date.now() + RESPAWN_MS;
  for (let i = 0; i < snake.points.length; i += DEATH_FOOD_STRIDE) {
    const p = snake.points[i];
    const item = { id: st.nextFoodId++, x: p.x, y: p.y, value: FOOD_VALUE };
    st.food.push(item);
    st.tickFoodAdded.push(item);
  }
  const cap = FOOD_COUNT * 2;
  if (st.food.length > cap) {
    const removed = st.food.splice(0, st.food.length - cap);
    for (const r of removed) st.tickFoodRemoved.push(r.id);
  }
}

// Rounded to whole world units for the wire — sub-pixel precision doesn't matter visually
// (snakes/food render at a several-unit radius) and shrinking the numbers cuts payload size,
// which matters since this broadcasts to every client 20x/second.
function roundPoint(p) {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

function buildSnakesView(st) {
  const snakes = [];
  for (const s of st.snakes.values()) {
    snakes.push({
      clientId: s.clientId,
      nickname: s.nickname,
      color: s.color,
      alive: s.alive,
      length: Math.round(s.length),
      respawnAt: s.alive ? null : s.respawnAt,
      points: s.points.map(roundPoint),
    });
  }
  return snakes;
}

function buildLeaderboard(snakes) {
  return [...snakes]
    .sort((a, b) => b.length - a.length)
    .filter((s) => s.alive)
    .slice(0, LEADERBOARD_SIZE)
    .map((s) => ({ clientId: s.clientId, nickname: s.nickname, length: s.length }));
}

// Full state for a client that just joined — includes the complete food list so the client can
// build its local copy from scratch. Recurring tick broadcasts (broadcastTick below) send only
// food add/remove deltas instead, since resending all ~200+ food items 20x/second is by far the
// biggest chunk of this game's bandwidth.
function buildSnapshot(room) {
  const st = room.state;
  const snakes = buildSnakesView(st);
  return {
    arenaSize: st.arenaSize,
    snakes,
    food: st.food.map((f) => ({ id: f.id, ...roundPoint(f), value: f.value })),
    leaderboard: buildLeaderboard(snakes),
  };
}

function broadcastTick(room, ctx) {
  const st = room.state;
  const snakes = buildSnakesView(st);
  const view = {
    arenaSize: st.arenaSize,
    snakes,
    foodAdded: st.tickFoodAdded.map((f) => ({ id: f.id, ...roundPoint(f), value: f.value })),
    foodRemoved: st.tickFoodRemoved,
    leaderboard: buildLeaderboard(snakes),
  };
  ctx.broadcast({ v: 1, type: 'game.event', payload: { gameType: 'slither', data: { kind: 'state', view } } });
}

module.exports = {
  type: 'slither',
  tickIntervalMs: TICK_MS,

  createInitialState() {
    const st = {
      arenaSize: ARENA_SIZE,
      snakes: new Map(),
      food: [],
      nextFoodId: 1,
      nextColorIdx: 0,
      tickFoodAdded: [],
      tickFoodRemoved: [],
    };
    for (let i = 0; i < FOOD_COUNT; i++) st.food.push(randomFood(st));
    return st;
  },

  serializeSnapshot(room) {
    return buildSnapshot(room);
  },

  onJoin(room, client) {
    const st = room.state;
    const snake = spawnSnake(client.clientId, client.nickname, st);
    snake.color = COLOR_PALETTE[st.nextColorIdx++ % COLOR_PALETTE.length];
    st.snakes.set(client.clientId, snake);
  },

  onLeave(room, client) {
    room.state.snakes.delete(client.clientId);
  },

  onMessage(room, client, data, ctx) {
    const snake = room.state.snakes.get(ctx.senderId);
    if (!snake || !data || typeof data.kind !== 'string') return;

    if (data.kind === 'steer') {
      const angle = Number(data.angle);
      if (Number.isFinite(angle)) snake.targetAngle = angle;
      return;
    }

    if (data.kind === 'boost') {
      snake.boosting = !!data.on;
    }
  },

  tick(room, ctx) {
    const st = room.state;
    const now = Date.now();
    st.tickFoodAdded = [];
    st.tickFoodRemoved = [];

    for (const snake of st.snakes.values()) {
      if (!snake.alive) {
        if (snake.respawnAt && now >= snake.respawnAt) respawn(snake, st);
        continue;
      }
      stepSnake(snake);
      const head = snake.points[0];
      if (head.x < 0 || head.x > st.arenaSize || head.y < 0 || head.y > st.arenaSize) {
        killSnake(st, snake);
      }
    }

    for (const a of st.snakes.values()) {
      if (!a.alive) continue;
      const head = a.points[0];
      const aRadius = radiusFor(a);
      let died = false;

      outer: for (const b of st.snakes.values()) {
        if (a === b || !b.alive) continue;
        // Collision distance scales with both snakes' current girth (matches the old fixed
        // SNAKE_RADIUS*1.6 exactly when both are still at BASE_SNAKE_RADIUS).
        const collideDistSq = ((aRadius + radiusFor(b)) * 0.8) ** 2;
        for (let i = 0; i < b.points.length; i += 2) {
          const p = b.points[i];
          const dx = head.x - p.x;
          const dy = head.y - p.y;
          if (dx * dx + dy * dy < collideDistSq) {
            died = true;
            break outer;
          }
        }
      }

      if (died) killSnake(st, a);
    }

    for (const snake of st.snakes.values()) {
      if (!snake.alive) continue;
      const head = snake.points[0];
      const eatDistSq = (radiusFor(snake) + FOOD_RADIUS) ** 2;
      for (let i = st.food.length - 1; i >= 0; i--) {
        const f = st.food[i];
        const dx = head.x - f.x;
        const dy = head.y - f.y;
        if (dx * dx + dy * dy < eatDistSq) {
          snake.length = Math.min(MAX_LENGTH, snake.length + f.value);
          st.food.splice(i, 1);
          st.tickFoodRemoved.push(f.id);
        }
      }
    }

    for (let i = 0; i < FOOD_REFILL_PER_TICK && st.food.length < FOOD_COUNT; i++) {
      const item = randomFood(st);
      st.food.push(item);
      st.tickFoodAdded.push(item);
    }

    broadcastTick(room, ctx);
  },
};
