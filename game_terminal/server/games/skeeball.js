// Skee-Ball (GamePigeon style) — 2 seats, red vs blue, one shared lane. Each player rolls 9 balls
// in three rounds of three (red's 3, blue's 3, ...). Rings score 10–50, the two corner pockets 100,
// anything else is a gutter for 0. Highest total wins; a tie goes to sudden death (one ball each,
// up to MAX_SUDDEN times, then it's a draw). Red rolls first; a rematch swaps colours.
//
// Physics live in public/games/skeeball/sim.js, shared verbatim with the browser: the client sends
// a roll input { aim, power }, the server simulates it (authoritative) and broadcasts the input,
// the trajectory frames and the result. Rolls are accepted only once the previous ball has
// finished (`busyUntil`), so everyone sees each roll play out.

'use strict';

const Sim = require('../../public/games/skeeball/sim.js');
const { setBotLevel, botLevelOf } = require('./ai/levels');

const TYPE = 'skeeball';
const BOT = 'BOT';
const COLORS = ['red', 'blue'];
const BALLS = 9;
const PER_TURN = 3;
const MAX_SUDDEN = 3;
const FRAME_MS = 1000 / 60;
// Bot "lining up" delay after the lane is free, and the pause after a ball drops (tests shrink these).
const timing = { min: 650, max: 1300, after: 900 };

// Who rolls ball number `n` (0-based, across both players).
function shooterOf(n) {
  if (n < BALLS * 2) return Math.floor(n / PER_TURN) % 2 === 0 ? 'red' : 'blue';
  return (n - BALLS * 2) % 2 === 0 ? 'red' : 'blue';
}
const total = (list) => list.reduce((a, b) => a + b, 0);

function resetGame(st) {
  st.balls = { red: [], blue: [] }; // points per ball rolled
  st.rollNo = 0;
  st.turn = 'red';
  st.sudden = 0; // sudden-death rounds started
  st.winner = null;
  st.lastRoll = null;
  st.rollSeq = 0;
  st.busyUntil = 0;
  st.gameId = (st.gameId || 0) + 1;
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    players: st.players,
    botLevels: st.botLevels || {},
    balls: st.balls,
    totals: { red: total(st.balls.red), blue: total(st.balls.blue) },
    perGame: BALLS,
    perTurn: PER_TURN,
    rollNo: st.rollNo,
    turn: st.turn,
    sudden: st.sudden,
    winner: st.winner,
    lastRoll: st.lastRoll,
    rollSeq: st.rollSeq,
    busyUntil: st.busyUntil,
    gameId: st.gameId,
    serverNow: Date.now(),
  };
}

function broadcastState(room) {
  room.broadcast({ v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'state', ...buildPublicState(room) } } });
}

function seatOf(st, clientId) {
  return st.players.red === clientId ? 'red' : st.players.blue === clientId ? 'blue' : null;
}

// After a ball: end the game or move on. Regulation ends after 18 balls; sudden death after each pair.
function advance(st) {
  st.rollNo++;
  const n = st.rollNo;
  if (n >= BALLS * 2 && (n - BALLS * 2) % 2 === 0) {
    const r = total(st.balls.red);
    const b = total(st.balls.blue);
    if (r !== b) { st.phase = 'game_over'; st.winner = r > b ? 'red' : 'blue'; return; }
    if (st.sudden >= MAX_SUDDEN) { st.phase = 'game_over'; st.winner = 'draw'; return; }
    st.sudden++;
  }
  st.turn = shooterOf(n);
}

// Validated roll by `color`. Returns the roll record or null.
function applyRoll(st, color, rawInput, now) {
  const res = Sim.simulate(rawInput);
  if (!res) return null;
  st.rollSeq++;
  st.balls[color].push(res.points);
  const rec = {
    seq: st.rollSeq,
    by: color,
    ball: st.balls[color].length, // 1-based ball number for this player
    input: res.input,
    frames: res.frames,
    events: res.events,
    dropFrame: res.dropFrame,
    outcome: res.outcome,
    points: res.points,
    hole: res.hole,
    reason: res.reason,
    turnOver: false,
  };
  advance(st);
  rec.turnOver = st.phase !== 'playing' || st.turn !== color;
  st.lastRoll = rec;
  st.busyUntil = now + Math.round(res.frames.length * FRAME_MS) + timing.after;
  return rec;
}

function maybeScheduleBot(room) {
  const st = room.state;
  if (st.phase !== 'playing' || st.players[st.turn] !== BOT) return;
  const { gameId, rollSeq, turn } = st;
  const stillValid = () => {
    const s = room.state;
    return s === st && s.phase === 'playing' && s.gameId === gameId && s.rollSeq === rollSeq
      && s.turn === turn && s.players[turn] === BOT;
  };
  const wait = Math.max(0, st.busyUntil - Date.now()) + timing.min + Math.random() * (timing.max - timing.min);
  setTimeout(() => {
    if (!stillValid()) return;
    if (!applyRoll(st, turn, Sim.botRoll(botLevelOf(st, turn)), Date.now())) return;
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
    const seat = seatOf(st, client.clientId);
    if (!seat) return;
    vacate(st, seat);
    broadcastState(room);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
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

    if (data.kind === 'roll') {
      if (st.phase !== 'playing') return reject('not_playing');
      const seat = seatOf(st, me);
      if (!seat || seat !== st.turn) return reject('not_your_turn');
      const now = Date.now();
      if (now < st.busyUntil - 150) return reject('busy'); // small grace for clock jitter
      if (!applyRoll(st, seat, { aim: data.aim, power: data.power }, now)) return reject('invalid');
      broadcastState(room);
      maybeScheduleBot(room);
    }
  },

  _internal: { timing, applyRoll, resetGame, shooterOf, FRAME_MS },
};
