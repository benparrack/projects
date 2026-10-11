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

'use strict';

const Sim = require('../../public/games/minigolf/sim.js');
const { setBotLevel, botLevelOf } = require('./ai/levels');

const TYPE = 'minigolf';
const BOT = 'BOT';
const COLORS = ['red', 'blue'];
const FRAME_MS = 1000 / 60;
const NUM_HOLES = Sim.HOLES.length;
// after-roll pause, extra pause for the hole summary, accepted client clock skew for t0, and the
// bot's "lining up" delay (tests shrink these via _internal.timing).
const timing = { after: 500, holePause: 2600, t0Past: 700, t0Future: 150, min: 650, max: 1300 };

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

// Validated putt by `color`. Returns the shot record or null.
function applyShot(st, color, raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const input = Sim.normInput(raw);
  if (!input || input.power < Sim.MIN_POWER) return null;
  const ball = st.balls[color];
  if (!ball || ball.done) return null;
  let t0 = Number(raw.t0);
  t0 = Number.isFinite(t0) && t0 >= now - timing.t0Past && t0 <= now + timing.t0Future ? Math.round(t0) : now;
  const phaseMs = t0 % 60000;
  const res = Sim.simulate(st.hole, { x: ball.x, y: ball.y }, input, phaseMs);
  if (!res) return null;
  const pre = snap(st);
  const hi = st.hole;
  st.shotSeq++;
  const penalty = res.outcome === 'water' ? 1 : 0;
  st.strokes[color] += 1 + penalty;
  ball.x = res.end.x;
  ball.y = res.end.y;
  let pickedUp = false;
  if (res.outcome === 'sink') {
    ball.done = true;
    ball.sunk = true;
    st.scores[color][hi] = Math.min(st.strokes[color], Sim.PICKUP_SCORE);
  } else if (st.strokes[color] >= Sim.MAX_STROKES) {
    ball.done = true;
    pickedUp = true;
    st.scores[color][hi] = Sim.PICKUP_SCORE;
  }
  const post = snap(st);
  const other = opponent(color);
  let holeEnd = false;
  if (!st.balls[other].done) st.turn = other;
  else if (!ball.done) st.turn = color;
  else {
    holeEnd = true;
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
  }
  const rec = {
    seq: st.shotSeq,
    by: color,
    hole: hi,
    t0,
    phaseMs,
    input: res.input,
    frames: res.frames,
    events: res.events,
    outcome: res.outcome,
    end: res.end,
    penalty,
    pickedUp,
    holeEnd,
    gameOver: st.phase === 'game_over',
    nextTurn: st.phase === 'game_over' ? null : st.turn,
    pre,
    post,
  };
  st.lastShot = rec;
  st.busyUntil = now + Math.round(res.frames.length * FRAME_MS) + timing.after + (holeEnd ? timing.holePause : 0);
  return rec;
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
    broadcastState(room);
    maybeScheduleBot(room);
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
      broadcastState(room);
      maybeScheduleBot(room);
    }
  },

  _internal: { timing, applyShot, resetGame, total, FRAME_MS },
};
