// Mini Golf (GamePigeon style) — 2 seats, red vs blue, 9 handcrafted top-down holes (rails, angled
// bank bumpers, posts, pop bumpers, sand, water, slopes, a funnel, spinning windmills, sliding
// blockers). Both balls play the same hole at once and are both visible; putts alternate
// stroke-by-stroke, and once one ball is down the other keeps putting until it's in. Water costs
// a penalty stroke and puts the ball back where it was hit from. 6 strokes max per hole — miss
// the 6th and you're picked up with a 7. Lowest total after 9 holes wins (ties are a draw). Red
// tees off on hole 1; after that the lower score on the previous hole has the honour. A rematch
// swaps colours so the opener alternates.
//
// Physics live in public/games/minigolf/sim.js, shared verbatim with the browser: the client sends
// { angle, power, t0 } (t0 = its server-clock estimate of when it hit, which fixes the phase of
// the moving obstacles), the server checks t0 is recent, simulates authoritatively and broadcasts
// the frames + result. Putts are accepted only once the previous ball has finished rolling
// (`busyUntil`), so everyone sees every putt play out.
//
// Moving obstacles always hit resting balls too: the server owns both balls over time. A shot record
// also carries the other ball's knocks during the roll (`side`), and between shots a timer fires
// just before a mover reaches a resting ball and broadcasts a `push` record (same sim, no stroke;
// knocked into water = dropped at the nearest spot clear of every mover, knocked in = holed).

'use strict';

const Sim = require('../../public/games/minigolf/sim.js');
const { setBotLevel, botLevelOf } = require('./ai/levels');
const { reportDuel } = require('./duelResult');

const TYPE = 'minigolf';
const BOT = 'BOT';
const COLORS = ['red', 'blue'];
const FRAME_MS = 1000 / 60;
const NUM_HOLES = Sim.HOLES.length;
// after-roll pause, extra pause for the hole summary, accepted client clock skew for t0, and the
// bot's "lining up" delay (tests shrink these via _internal.timing).
// `lead`: how early a knock is announced so clients can start it on time (putts are busy-rejected).
const timing = { after: 500, holePause: 2600, t0Past: 700, t0Future: 150, min: 650, max: 1300, lead: 300 };
const MAX_KNOCKS = 12; // per ball per record; a ball pinned that long is dropped clear

const opponent = (c) => (c === 'red' ? 'blue' : 'red');

function teeBalls(hi) {
  const [x, y] = Sim.HOLES[hi].tee;
  return { red: { x, y, done: false, sunk: false }, blue: { x, y, done: false, sunk: false } };
}

function resetGame(st) {
  st.hole = 0;
  st.balls = teeBalls(0);
  st.strokes = { red: 0, blue: 0 };
  st.scores = { red: Array(NUM_HOLES).fill(null), blue: Array(NUM_HOLES).fill(null) };
  st.turn = 'red';
  st.first = 'red';
  st.winner = null;
  st.lastShot = null;
  st.shotSeq = 0;
  st.busyUntil = 0;
  st.settledAt = 0; // server ms when the last record's balls all came to rest
  st.gameId = (st.gameId || 0) + 1;
}

const total = (arr) => arr.reduce((s, v) => s + (v || 0), 0);

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    players: st.players,
    botLevels: st.botLevels || {},
    hole: st.hole,
    balls: st.balls,
    strokes: st.strokes,
    scores: st.scores,
    turn: st.turn,
    winner: st.winner,
    lastShot: st.lastShot,
    shotSeq: st.shotSeq,
    busyUntil: st.busyUntil,
    gameId: st.gameId,
    serverNow: Date.now(),
  };
}

function broadcastState(room) {
  reportDuel(room, (s) => total(room.state.scores[s])); // no-op unless a game just ended
  room.broadcast({ v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'state', ...buildPublicState(room) } } });
}

function seatOf(st, clientId) {
  if (!clientId) return null;
  return st.players.red === clientId ? 'red' : st.players.blue === clientId ? 'blue' : null;
}

const snap = (st) => ({
  hole: st.hole,
  balls: { red: { ...st.balls.red }, blue: { ...st.balls.blue } },
  strokes: { ...st.strokes },
  scores: { red: st.scores.red.slice(), blue: st.scores.blue.slice() },
});

// A ball's motion over one record: frames from `startMs` at 60 fps; `t` = ms it is at rest from.
function newPath(x, y, startMs) {
  return { x, y, startMs, t: startMs, frames: [[x, y]], events: [], out: null, knocks: 0 };
}

// Play every mover knock on resting path `p` that starts before `untilMs`. Returns true if any.
function knock(hi, p, untilMs) {
  let any = false;
  while (!p.out) {
    const c = Sim.nextContact(hi, p, p.t, untilMs);
    if (c < 0) break;
    any = true;
    const off = Math.max(p.frames.length - 1, Math.round((c - p.startMs) / FRAME_MS));
    while (p.frames.length <= off) p.frames.push([p.x, p.y]);
    if (++p.knocks > MAX_KNOCKS) {
      const s = Sim.safeSpot(hi, p.x, p.y);
      p.x = s.x;
      p.y = s.y;
      p.frames.push([p.x, p.y]);
      p.t = c + FRAME_MS;
      continue;
    }
    const res = Sim.simulate(hi, { x: p.x, y: p.y }, { angle: 0, power: 0 }, c % 60000);
    for (let i = 1; i < res.frames.length; i++) p.frames.push(res.frames[i]);
    for (const ev of res.events) p.events.push({ ...ev, f: ev.f + off, knock: true });
    p.t = c + Math.max(1, res.frames.length - 1) * FRAME_MS;
    if (res.outcome === 'water') {
      const s = Sim.safeSpot(hi, p.x, p.y); // no stroke: drop clear of the movers, near the knock
      p.x = s.x;
      p.y = s.y;
      p.out = 'water';
    } else {
      p.x = res.end.x;
      p.y = res.end.y;
      if (res.outcome === 'sink') p.out = 'sink';
    }
  }
  return any;
}

// Knock both paths until neither is touched before the later one comes to rest.
function settle(hi, paths) {
  let end;
  do end = Math.max(...paths.map((p) => p.t)); while (paths.map((p) => knock(hi, p, end)).some(Boolean));
  return end;
}

// Turn order / hole end after a record. `prefer` = who should putt next if their ball is live.
function advance(st, hi, prefer) {
  if (!st.balls[prefer].done) st.turn = prefer;
  else if (!st.balls[opponent(prefer)].done) st.turn = opponent(prefer);
  else {
    if (hi === NUM_HOLES - 1) {
      st.phase = 'game_over';
      const r = total(st.scores.red);
      const b = total(st.scores.blue);
      st.winner = r < b ? 'red' : b < r ? 'blue' : 'draw';
    } else {
      const sr = st.scores.red[hi];
      const sb = st.scores.blue[hi];
      st.first = sr < sb ? 'red' : sb < sr ? 'blue' : st.first;
      st.turn = st.first;
      st.hole = hi + 1;
      st.balls = teeBalls(st.hole);
      st.strokes = { red: 0, blue: 0 };
    }
    return true;
  }
  return false;
}

// Shared tail of shots and pushes: knock the other (resting) ball, apply both paths, build the record.
function finishRecord(st, by, main, t0, now, extra) {
  const hi = st.hole;
  const pre = extra.pre;
  const other = opponent(by);
  const side = st.balls[other].done ? null : newPath(st.balls[other].x, st.balls[other].y, t0);
  const end = settle(hi, side ? [main, side] : [main]);
  for (const [c, p] of side ? [[by, main], [other, side]] : [[by, main]]) {
    const ball = st.balls[c];
    ball.x = p.x;
    ball.y = p.y;
    if (p.out === 'sink') {
      ball.done = true;
      ball.sunk = true;
      st.scores[c][hi] = Math.min(Math.max(1, st.strokes[c]), Sim.PICKUP_SCORE);
    }
  }
  let pickedUp = false;
  if (extra.shot && !st.balls[by].done && st.strokes[by] >= Sim.MAX_STROKES) {
    st.balls[by].done = true;
    pickedUp = true;
    st.scores[by][hi] = Sim.PICKUP_SCORE;
  }
  const post = snap(st);
  const holeEnd = advance(st, hi, extra.shot ? other : st.turn);
  st.shotSeq++;
  const rec = {
    seq: st.shotSeq,
    by,
    hole: hi,
    t0,
    phaseMs: t0 % 60000,
    push: !extra.shot,
    input: extra.input || null,
    frames: main.frames,
    events: main.events,
    side: side && side.frames.length > 1 ? { color: other, frames: side.frames, events: side.events, outcome: side.out || 'rest' } : null,
    outcome: main.out || 'rest',
    end: { x: main.x, y: main.y },
    penalty: extra.penalty || 0,
    pickedUp,
    holeEnd,
    gameOver: st.phase === 'game_over',
    nextTurn: st.phase === 'game_over' ? null : st.turn,
    pre,
    post,
  };
  st.lastShot = rec;
  st.settledAt = end;
  st.busyUntil = Math.max(now, t0) + Math.round(end - t0) + timing.after + (holeEnd ? timing.holePause : 0);
  return rec;
}

// Validated putt by `color`. Returns the shot record or null.
function applyShot(st, color, raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const input = Sim.normInput(raw);
  if (!input || input.power < Sim.MIN_POWER) return null;
  const ball = st.balls[color];
  if (!ball || ball.done) return null;
  let t0 = Number(raw.t0);
  t0 = Number.isFinite(t0) && t0 >= now - timing.t0Past && t0 <= now + timing.t0Future ? Math.round(t0) : now;
  t0 = Math.max(t0, Math.ceil(st.settledAt || 0)); // the ball only sits here since the last knock
  const res = Sim.simulate(st.hole, { x: ball.x, y: ball.y }, input, t0 % 60000);
  if (!res) return null;
  const pre = snap(st);
  const penalty = res.outcome === 'water' ? 1 : 0;
  st.strokes[color] += 1 + penalty;
  const main = newPath(res.end.x, res.end.y, t0);
  main.frames = res.frames;
  main.events = res.events;
  main.t = t0 + (res.frames.length - 1) * FRAME_MS;
  if (res.outcome !== 'rest') main.out = res.outcome; // water: back where it was hit, no knocks this record
  return finishRecord(st, color, main, t0, now, { shot: true, input: res.input, penalty, pre });
}

// A mover reaches a resting ball at ms `c`: knock it (no stroke). Returns the record or null.
function applyPush(st, color, c, now) {
  const ball = st.balls[color];
  if (!ball || ball.done) return null;
  const pre = snap(st);
  const main = newPath(ball.x, ball.y, c);
  if (!knock(st.hole, main, c + 1)) return null;
  return finishRecord(st, color, main, c, now, { pre });
}

// Earliest upcoming knock on a resting ball: { color, at } or null.
function nextKnock(st) {
  let best = null;
  for (const c of COLORS) {
    const b = st.balls[c];
    if (b.done) continue;
    const at = Sim.nextContact(st.hole, b, st.settledAt, st.settledAt + 60000);
    if (at >= 0 && (!best || at < best.at)) best = { color: c, at };
  }
  return best;
}

function scheduleKnock(room) {
  const st = room.state;
  if (st.phase !== 'playing') return;
  const k = nextKnock(st);
  if (!k) return;
  const { gameId, shotSeq } = st;
  setTimeout(() => {
    const s = room.state;
    if (s !== st || s.phase !== 'playing' || s.gameId !== gameId || s.shotSeq !== shotSeq) return;
    if (!applyPush(st, k.color, k.at, Date.now())) return;
    afterRecord(room);
  }, Math.max(0, k.at - timing.lead - Date.now()));
}

function afterRecord(room) {
  broadcastState(room);
  scheduleKnock(room);
  maybeScheduleBot(room);
}

function maybeScheduleBot(room) {
  const st = room.state;
  if (st.phase !== 'playing' || st.players[st.turn] !== BOT) return;
  const { gameId, shotSeq, turn } = st;
  const stillValid = () => {
    const s = room.state;
    return s === st && s.phase === 'playing' && s.gameId === gameId && s.shotSeq === shotSeq
      && s.turn === turn && s.players[turn] === BOT;
  };
  const wait = Math.max(0, st.busyUntil - Date.now()) + timing.min + Math.random() * (timing.max - timing.min);
  setTimeout(() => {
    if (!stillValid()) return;
    const now = Date.now();
    const ball = st.balls[turn];
    let rec = null;
    try {
      const inp = Sim.botPutt(st.hole, { x: ball.x, y: ball.y }, now % 60000, botLevelOf(st, turn));
      rec = applyShot(st, turn, { ...inp, t0: now }, now);
    } catch (e) {
      rec = null;
    }
    // never stall: fall back to a plain putt toward the cup
    if (!rec && stillValid()) {
      const h = Sim.HOLES[st.hole];
      rec = applyShot(st, turn, { angle: Math.atan2(h.cup[1] - ball.y, h.cup[0] - ball.x), power: 0.3, t0: now }, now);
    }
    if (!rec) return;
    afterRecord(room);
  }, wait);
}

function startIfReady(st) {
  if (st.players.red && st.players.blue) {
    resetGame(st);
    st.phase = 'playing';
  }
}

function vacate(st, seat) {
  st.players[seat] = null;
  st.phase = 'waiting';
  resetGame(st);
}

module.exports = {
  type: TYPE,
  stats: { rated: true, score: { label: 'Strokes', better: 'low', format: 'int' } },

  createInitialState() {
    const st = { phase: 'waiting', players: { red: null, blue: null }, botLevels: {} };
    resetGame(st);
    return st;
  },

  isRoomFull() {
    return false; // spectators welcome
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  onLeave(room, client) {
    const st = room.state;
    const seat = seatOf(st, client && client.clientId);
    if (!seat) return;
    vacate(st, seat);
    broadcastState(room);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data !== 'object' || typeof data.kind !== 'string') return;
    const st = room.state;
    const me = ctx.senderId;
    const reject = (reason) => ctx.sendTo(me, { v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'moveRejected', reason } } });
    const seatArg = COLORS.includes(data.seat) ? data.seat : null;

    if (data.kind === 'sit') {
      if (!seatArg || st.players[seatArg]) return;
      if (data.bot) {
        st.players[seatArg] = BOT;
        setBotLevel(st, seatArg, data.level);
      } else {
        if (seatOf(st, me)) return;
        st.players[seatArg] = me;
      }
      startIfReady(st);
      broadcastState(room);
      maybeScheduleBot(room);
      return;
    }

    if (data.kind === 'leaveSeat') {
      const seat = seatOf(st, me);
      if (!seat) return;
      vacate(st, seat);
      broadcastState(room);
      return;
    }

    if (data.kind === 'setBotLevel') {
      if (!seatArg || st.players[seatArg] !== BOT) return;
      setBotLevel(st, seatArg, data.level);
      broadcastState(room);
      return;
    }

    if (data.kind === 'removeBot') {
      if (!seatArg || st.players[seatArg] !== BOT) return;
      vacate(st, seatArg);
      broadcastState(room);
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over' || !seatOf(st, me)) return;
      st.players = { red: st.players.blue, blue: st.players.red };
      st.botLevels = { red: (st.botLevels || {}).blue, blue: (st.botLevels || {}).red };
      resetGame(st);
      st.phase = st.players.red && st.players.blue ? 'playing' : 'waiting';
      broadcastState(room);
      maybeScheduleBot(room);
      return;
    }

    if (data.kind === 'putt') {
      if (st.phase !== 'playing') return reject('not_playing');
      const seat = seatOf(st, me);
      if (!seat || seat !== st.turn) return reject('not_your_turn');
      const now = Date.now();
      if (now < st.busyUntil - 150) return reject('busy'); // small grace for clock jitter
      if (!applyShot(st, seat, { angle: data.angle, power: data.power, t0: data.t0 }, now)) return reject('invalid');
      afterRecord(room);
    }
  },

  _internal: { timing, applyShot, applyPush, nextKnock, scheduleKnock, resetGame, total, FRAME_MS },
};
