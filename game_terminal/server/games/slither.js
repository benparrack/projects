// Slither.io-style real-time game. Unlike the event-driven games (drawing/hangman/checkers/
// chess), the world advances on its own schedule via the `tick`/`tickIntervalMs` hook that
// RoomManager calls on an interval — see FUTURE.md for the design writeup this implements.

const TICK_MS = 50; // 20Hz
const ARENA_SIZE = 3000;
const BASE_SPEED = 2.6; // world units per tick
const BOOST_MULT = 2.0;
const TURN_RATE = 0.15; // max radians the heading can change per tick
const START_LENGTH = 120;
const MAX_LENGTH = 3000;
const POINT_SPACING = 6; // approx distance between stored path points
const SNAKE_RADIUS = 9;
const FOOD_RADIUS = 6;
const FOOD_COUNT = 220;
const FOOD_VALUE = 14;
const FOOD_REFILL_PER_TICK = 5;
const BOOST_DRAIN_PER_TICK = 1.4;
const MIN_BOOST_LENGTH = 60; // below START_LENGTH so a fresh spawn can boost immediately
const RESPAWN_MS = 1200;
const DEATH_FOOD_STRIDE = 4; // drop one food pellet every N corpse points
const LEADERBOARD_SIZE = 5;
// Path-length (not point count) ignored near the head for self-collision — points end up
// spaced by however far the snake moves per tick (BASE_SPEED, faster while boosting), not by
// POINT_SPACING (which only describes the initial spawn tail), so the buffer has to be
// distance-based to give a consistent grace radius regardless of speed.
const SELF_COLLISION_SKIP_DIST = SNAKE_RADIUS * 4;
const COLLIDE_DIST_SQ = (SNAKE_RADIUS * 1.6) ** 2;
const EAT_DIST_SQ = (SNAKE_RADIUS + FOOD_RADIUS) ** 2;

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

function spawnSnake(clientId, nickname) {
  const angle = Math.random() * Math.PI * 2;
  const margin = 300;
  const x = margin + Math.random() * (ARENA_SIZE - margin * 2);
  const y = margin + Math.random() * (ARENA_SIZE - margin * 2);
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

function respawn(snake) {
  const fresh = spawnSnake(snake.clientId, snake.nickname);
  snake.alive = true;
  snake.angle = fresh.angle;
  snake.targetAngle = fresh.angle;
  snake.boosting = false;
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

// First point index at least SELF_COLLISION_SKIP_DIST of path length away from the head —
// everything before it is exempt from self-collision.
function selfCollisionStartIndex(points) {
  let dist = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    dist += Math.hypot(b.x - a.x, b.y - a.y);
    if (dist >= SELF_COLLISION_SKIP_DIST) return i;
  }
  return points.length;
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
    st.food.push({ id: st.nextFoodId++, x: p.x, y: p.y, value: FOOD_VALUE });
  }
  const cap = FOOD_COUNT * 2;
  if (st.food.length > cap) st.food.splice(0, st.food.length - cap);
}

function buildView(room) {
  const st = room.state;
  const snakes = [];
  for (const s of st.snakes.values()) {
    snakes.push({
      clientId: s.clientId,
      nickname: s.nickname,
      color: s.color,
      alive: s.alive,
      length: Math.round(s.length),
      points: s.points,
    });
  }
  snakes.sort((a, b) => b.length - a.length);
  const leaderboard = snakes
    .filter((s) => s.alive)
    .slice(0, LEADERBOARD_SIZE)
    .map((s) => ({ clientId: s.clientId, nickname: s.nickname, length: s.length }));
  return { arenaSize: st.arenaSize, snakes, food: st.food, leaderboard };
}

function broadcastState(room, ctx) {
  ctx.broadcast({ v: 1, type: 'game.event', payload: { gameType: 'slither', data: { kind: 'state', view: buildView(room) } } });
}

module.exports = {
  type: 'slither',
  tickIntervalMs: TICK_MS,

  createInitialState() {
    const st = { arenaSize: ARENA_SIZE, snakes: new Map(), food: [], nextFoodId: 1, nextColorIdx: 0 };
    for (let i = 0; i < FOOD_COUNT; i++) st.food.push(randomFood(st));
    return st;
  },

  serializeSnapshot(room) {
    return buildView(room);
  },

  onJoin(room, client) {
    const st = room.state;
    const snake = spawnSnake(client.clientId, client.nickname);
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

    for (const snake of st.snakes.values()) {
      if (!snake.alive) {
        if (snake.respawnAt && now >= snake.respawnAt) respawn(snake);
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
      let died = false;

      // Self-collision: skip a buffer of points near the head so a normal turn (bounded by
      // TURN_RATE anyway) never clips your own neck — only a tight loop back into your own
      // body further back kills you.
      const selfSkipIdx = selfCollisionStartIndex(a.points);
      for (let i = selfSkipIdx; i < a.points.length; i += 2) {
        const p = a.points[i];
        const dx = head.x - p.x;
        const dy = head.y - p.y;
        if (dx * dx + dy * dy < COLLIDE_DIST_SQ) {
          died = true;
          break;
        }
      }

      if (!died) {
        outer: for (const b of st.snakes.values()) {
          if (a === b || !b.alive) continue;
          for (let i = 0; i < b.points.length; i += 2) {
            const p = b.points[i];
            const dx = head.x - p.x;
            const dy = head.y - p.y;
            if (dx * dx + dy * dy < COLLIDE_DIST_SQ) {
              died = true;
              break outer;
            }
          }
        }
      }

      if (died) killSnake(st, a);
    }

    for (const snake of st.snakes.values()) {
      if (!snake.alive) continue;
      const head = snake.points[0];
      for (let i = st.food.length - 1; i >= 0; i--) {
        const f = st.food[i];
        const dx = head.x - f.x;
        const dy = head.y - f.y;
        if (dx * dx + dy * dy < EAT_DIST_SQ) {
          snake.length = Math.min(MAX_LENGTH, snake.length + f.value);
          st.food.splice(i, 1);
        }
      }
    }

    for (let i = 0; i < FOOD_REFILL_PER_TICK && st.food.length < FOOD_COUNT; i++) {
      st.food.push(randomFood(st));
    }

    broadcastState(room, ctx);
  },
};
