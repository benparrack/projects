// Cup Pong (GamePigeon style) — 2 seats, red vs blue, 10 cups each racked in a triangle at your
// own end of the table. On your turn you get two throws at the opponent's cups; a sunk cup is
// removed. Make both throws and you get "balls back" (two more). Optional automatic re-racks
// tighten the formation when a side is down to 6, 3, 2 or 1 cups. Clear all the opponent's cups
// to win. Red throws first; a rematch swaps colours so the opener alternates.
//
// Physics live in public/games/cuppong/sim.js, shared verbatim with the browser: the client sends
// a throw input { aim, power }, the server simulates it against the target cups (authoritative)
// and broadcasts the input, the trajectory frames and the result. Throws are accepted only once
// the previous ball has finished flying (`busyUntil`), so everyone sees each throw play out.

'use strict';

const Sim = require('../../public/games/cuppong/sim.js');
const { setBotLevel, botLevelOf } = require('./ai/levels');

const TYPE = 'cuppong';
const BOT = 'BOT';
const COLORS = ['red', 'blue'];
const FRAME_MS = 1000 / 60;
const AFTER_MS = 650; // pause after the ball stops before the next throw
// Bot "lining up the shot" delay after the table is free (tests shrink it via _internal.timing).
const timing = { min: 700, max: 1400, after: AFTER_MS };

const opponent = (c) => (c === 'red' ? 'blue' : 'red');

function resetGame(st) {
  st.cups = { red: Sim.fullRack(), blue: Sim.fullRack() };
  st.turn = 'red';
  st.throwsLeft = 2;
  st.madeThisTurn = 0;
  st.winner = null;
  st.lastThrow = null;
  st.throwSeq = 0;
  st.busyUntil = 0;
  st.reracked = { red: [], blue: [] }; // cup counts each side has already been re-racked at
  st.stats = { red: { throws: 0, made: 0 }, blue: { throws: 0, made: 0 } };
  st.gameId = (st.gameId || 0) + 1;
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    players: st.players,
    botLevels: st.botLevels || {},
    cups: st.cups,
    turn: st.turn,
    throwsLeft: st.throwsLeft,
    madeThisTurn: st.madeThisTurn,
    winner: st.winner,
    lastThrow: st.lastThrow,
    throwSeq: st.throwSeq,
    busyUntil: st.busyUntil,
    rerackOn: st.rerackOn,
    stats: st.stats,
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

function maybeRerack(st, side) {
  if (!st.rerackOn) return false;
  const n = st.cups[side].length;
  if (![6, 3, 2, 1].includes(n) || st.reracked[side].includes(n)) return false;
  st.reracked[side].push(n);
  const before = JSON.stringify(st.cups[side]);
  st.cups[side] = Sim.rerack(st.cups[side]);
  return JSON.stringify(st.cups[side]) !== before;
}

// Validated throw by `color` at the opponent's cups. Returns the throw record or null.
function applyThrow(st, color, rawInput, now) {
  const target = opponent(color);
  const before = st.cups[target].map((c) => ({ ...c }));
  const res = Sim.simulate(before, rawInput);
  if (!res) return null;
  st.throwSeq++;
  st.stats[color].throws++;
  const rec = {
    seq: st.throwSeq,
    by: color,
    target,
    input: res.input,
    frames: res.frames,
    events: res.events,
    sinkFrame: res.sinkFrame,
    outcome: res.outcome,
    cupId: res.cupId,
    before,
    ballsBack: false,
    rerack: false,
    turnOver: false,
  };
  if (res.outcome === 'sink') {
    st.cups[target] = st.cups[target].filter((c) => c.id !== res.cupId);
    st.madeThisTurn++;
    st.stats[color].made++;
  }
  st.throwsLeft--;
  if (!st.cups[target].length) {
    st.phase = 'game_over';
    st.winner = color;
  } else if (st.throwsLeft === 0) {
    if (st.madeThisTurn === 2) {
      rec.ballsBack = true;
      st.throwsLeft = 2;
      st.madeThisTurn = 0;
      rec.rerack = maybeRerack(st, target);
    } else {
      rec.turnOver = true;
      rec.rerack = maybeRerack(st, target);
      st.turn = target;
      st.throwsLeft = 2;
      st.madeThisTurn = 0;
    }
  }
  st.lastThrow = rec;
  st.busyUntil = now + Math.round(res.frames.length * FRAME_MS) + timing.after;
  return rec;
}

function maybeScheduleBot(room) {
  const st = room.state;
  if (st.phase !== 'playing' || st.players[st.turn] !== BOT) return;
  const { gameId, throwSeq, turn } = st;
  const stillValid = () => {
    const s = room.state;
    return s === st && s.phase === 'playing' && s.gameId === gameId && s.throwSeq === throwSeq
      && s.turn === turn && s.players[turn] === BOT;
  };
  const wait = Math.max(0, st.busyUntil - Date.now()) + timing.min + Math.random() * (timing.max - timing.min);
  setTimeout(() => {
    if (!stillValid()) return;
    const input = Sim.botThrow(st.cups[opponent(turn)], botLevelOf(st, turn));
    if (!applyThrow(st, turn, input, Date.now())) return;
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
    const st = { phase: 'waiting', players: { red: null, blue: null }, botLevels: {}, rerackOn: true };
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

    if (data.kind === 'setRerack') {
      if (st.phase === 'playing') return;
      if (!seatOf(st, me) && st.players.red && st.players.blue) return;
      st.rerackOn = !!data.on;
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

    if (data.kind === 'throw') {
      if (st.phase !== 'playing') return reject('not_playing');
      const seat = seatOf(st, me);
      if (!seat || seat !== st.turn) return reject('not_your_turn');
      const now = Date.now();
      if (now < st.busyUntil - 150) return reject('busy'); // small grace for clock jitter
      if (!applyThrow(st, seat, { aim: data.aim, power: data.power }, now)) return reject('invalid');
      broadcastState(room);
      maybeScheduleBot(room);
    }
  },

  _internal: { timing, applyThrow, resetGame, maybeRerack, FRAME_MS },
};
