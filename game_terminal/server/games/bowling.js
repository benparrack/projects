// Bowling (GamePigeon style) — two seats (p1 bowls first; a rematch swaps seats so the opener
// alternates). Ten-pin, ten frames each, players alternate whole frames. Standard scoring: a
// strike scores 10 + the next two balls, a spare 10 + the next ball; the 10th frame gives a bonus
// ball (or two) for a spare (or strike), each on a fresh rack. Highest total wins (tie = draw).
//
// Physics live in public/games/bowling/sim.js, shared verbatim with the browser: the client sends
// a roll input { x, aim, power, spin }, the server simulates it against the standing pins
// (authoritative) and broadcasts the input, the ball + pin frames and the result. A roll is only
// accepted once the previous one has finished playing out (`busyUntil`), so everyone sees it.

'use strict';

const Sim = require('../../public/games/bowling/sim.js');
const { setBotLevel, botLevelOf } = require('./ai/levels');
const { reportDuel } = require('./duelResult');

const TYPE = 'bowling';
const BOT = 'BOT';
const SEATS = ['p1', 'p2'];
const MAX_CLIENTS = 12;
const FRAME_MS = 1000 / Sim.FPS;
// After the pins settle: the sweep (+ re-rack) plays before the next ball. Bot "lining up" delay
// on top. Tests shrink these via _internal.timing.
const timing = { after: 1500, min: 900, max: 1700 };

const other = (s) => (s === 'p1' ? 'p2' : 'p1');
const emptyCard = () => Array.from({ length: 10 }, () => []);

function resetGame(st) {
  st.rolls = { p1: emptyCard(), p2: emptyCard() };
  st.turn = 'p1';
  st.frame = 0;
  st.pins = Sim.rack();
  st.winner = null;
  st.lastThrow = null;
  st.throwSeq = 0;
  st.busyUntil = 0;
  st.stats = { p1: newStats(), p2: newStats() };
  st.gameId = (st.gameId || 0) + 1;
}
const newStats = () => ({ strikes: 0, spares: 0, gutters: 0, splits: 0, balls: 0 });

function totals(st) {
  return { p1: Sim.knownTotal(st.rolls.p1), p2: Sim.knownTotal(st.rolls.p2) };
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    players: st.players,
    botLevels: st.botLevels || {},
    rolls: st.rolls,
    totals: totals(st),
    turn: st.turn,
    frame: st.frame,
    ball: st.rolls[st.turn][st.frame] ? st.rolls[st.turn][st.frame].length : 0,
    pins: st.pins,
    winner: st.winner,
    lastThrow: st.lastThrow,
    throwSeq: st.throwSeq,
    busyUntil: st.busyUntil,
    stats: st.stats,
    gameId: st.gameId,
    serverNow: Date.now(),
  };
}

function broadcastState(room) {
  reportDuel(room, (s) => totals(room.state)[s]); // no-op unless a game just ended
  room.broadcast({ v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'state', ...buildPublicState(room) } } });
}

function seatOf(st, clientId) {
  return st.players.p1 === clientId ? 'p1' : st.players.p2 === clientId ? 'p2' : null;
}

// Validated roll by `seat` at the standing pins. Returns the throw record or null.
function applyRoll(st, seat, rawInput, now) {
  const before = st.pins.map((p) => ({ ...p }));
  const res = Sim.simulate(before, rawInput);
  if (!res) return null;
  const f = st.frame;
  const r = st.rolls[seat][f];
  const ballNo = r.length;
  const fresh = Sim.nextIsFresh(r, f); // first ball at a full rack (incl. 10th-frame bonus racks)
  const n = res.knocked.length;
  r.push(n);
  const stats = st.stats[seat];
  stats.balls++;
  if (res.gutter) stats.gutters++;
  // what this ball was, for callouts and stats
  let mark = null;
  if (fresh && n === 10) { mark = 'strike'; stats.strikes++; } else if (!fresh && res.standing.length === 0) { mark = 'spare'; stats.spares++; } else if (res.gutter && n === 0) mark = 'gutter';
  let split = false;
  if (fresh && n < 10 && Sim.isSplit(res.standing.map((p) => p.id))) { split = true; stats.splits++; }

  st.throwSeq++;
  const rec = {
    seq: st.throwSeq,
    by: seat,
    frame: f,
    ball: ballNo,
    input: res.input,
    before,
    frames: res.frames,
    pinFx: res.pins,
    events: res.events,
    knocked: res.knocked,
    count: n,
    gutter: res.gutter,
    mark,
    split,
    turnOver: false,
    freshNext: false,
  };

  if (Sim.frameDone(st.rolls[seat], f)) {
    rec.turnOver = true;
    if (seat === 'p2' && f === 9) {
      st.phase = 'game_over';
      const t = totals(st);
      st.winner = t.p1 === t.p2 ? 'draw' : t.p1 > t.p2 ? 'p1' : 'p2';
    } else {
      if (seat === 'p2') st.frame++;
      st.turn = other(seat);
    }
    st.pins = Sim.rack();
    rec.freshNext = true;
  } else if (Sim.nextIsFresh(r, f)) {
    st.pins = Sim.rack();
    rec.freshNext = true;
  } else {
    st.pins = res.standing;
  }
  rec.pinsAfter = st.pins;
  rec.rollsAfter = { p1: st.rolls.p1.map((x) => x.slice()), p2: st.rolls.p2.map((x) => x.slice()) };
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
    let input;
    try {
      input = Sim.botRoll(st.pins, botLevelOf(st, turn));
    } catch (e) {
      input = null;
    }
    // never stall: fall back to a plain straight ball
    if (!input || !applyRoll(st, turn, input, Date.now())) applyRoll(st, turn, { x: 0, aim: 0, power: 0.6, spin: 0 }, Date.now());
    broadcastState(room);
    maybeScheduleBot(room);
  }, wait);
}

function startIfReady(st) {
  if (st.players.p1 && st.players.p2) {
    resetGame(st);
    st.phase = 'playing';
  }
}

function backToWaiting(st) {
  st.phase = 'waiting';
  resetGame(st);
}

module.exports = {
  type: TYPE,
  stats: { rated: true, score: { label: 'Pins', better: 'high', format: 'int' } },

  createInitialState() {
    const st = { phase: 'waiting', players: { p1: null, p2: null }, botLevels: {} };
    resetGame(st);
    return st;
  },

  // Two bowlers plus a few spectators.
  isRoomFull(room) {
    return !!(room && room.clients && room.clients.size >= MAX_CLIENTS);
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  onLeave(room, client) {
    const st = room.state;
    const seat = seatOf(st, client.clientId);
    if (!seat) return;
    st.players[seat] = null;
    backToWaiting(st);
    broadcastState(room);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data !== 'object' || typeof data.kind !== 'string') return;
    const st = room.state;
    const me = ctx.senderId;
    const reject = (reason) => ctx.sendTo(me, { v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'moveRejected', reason } } });
    const seatArg = SEATS.includes(data.seat) ? data.seat : null;

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
      st.players[seat] = null;
      backToWaiting(st);
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
      st.players[seatArg] = null;
      backToWaiting(st);
      broadcastState(room);
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over' || !seatOf(st, me)) return;
      st.players = { p1: st.players.p2, p2: st.players.p1 };
      st.botLevels = { p1: (st.botLevels || {}).p2, p2: (st.botLevels || {}).p1 };
      resetGame(st);
      st.phase = st.players.p1 && st.players.p2 ? 'playing' : 'waiting';
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
      const input = { x: data.x, aim: data.aim, power: data.power, spin: data.spin };
      if (!Sim.normInput(input)) return reject('invalid');
      if (!applyRoll(st, seat, input, now)) return reject('invalid');
      broadcastState(room);
      maybeScheduleBot(room);
    }
  },

  _internal: { timing, applyRoll, resetGame, FRAME_MS },
};
