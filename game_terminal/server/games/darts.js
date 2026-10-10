// Darts — two seats (p1 throws first; a rematch swaps the seats so the opener alternates).
// Modes: 501 double-out, 301 straight-out (quicker: any exact finish), and Cricket (15-20 + bull,
// three marks to close, extra marks score while the opponent still has the number open).
// Three darts a turn. 01 bust (below zero, left on 1 in double-out, or zero without a double)
// reverts the turn's score and ends the turn. Both modes stop after MAX_ROUNDS rounds (lowest
// remaining / most points wins) so a game can't drag on forever.
//
// Throws are server-authoritative: the client sends where it aimed and how long it held (t, ms);
// the server lands the dart with the shared wobble from public/games/darts/sim.js using the per-dart
// seed it handed out, so the reticle the thrower watched is exactly what gets scored (plus a small
// release jitter nobody can see coming). Bots aim at sensible targets (checkout planner / cricket
// strategy) and scatter by difficulty.

'use strict';

const Sim = require('../../public/games/darts/sim.js');
const { setBotLevel, botLevelOf } = require('./ai/levels');

const TYPE = 'darts';
const BOT = 'BOT';
const SEATS = ['p1', 'p2'];
const MODES = ['501', '301', 'cricket'];
const MAX_ROUNDS = 20;
const DARTS_PER_TURN = 3;
const MAX_CLIENTS = 12;
// Bot pacing (tests shrink these via _internal.timing).
const timing = { firstDart: 1300, nextDart: 950, jitter: 400 };

const other = (s) => (s === 'p1' ? 'p2' : 'p1');
const newSeed = () => (Math.random() * 0x100000000) >>> 0;
const startScore = (mode) => (mode === '301' ? 301 : 501);
const doubleOut = (mode) => mode === '501';

function freshCricket() {
  const marks = {};
  for (const n of Sim.CRICKET_NUMS) marks[n] = 0;
  return { marks, points: 0 };
}

function resetGame(st) {
  st.gameId = (st.gameId || 0) + 1;
  st.turn = 'p1';
  st.round = 1;
  st.scores = { p1: startScore(st.mode), p2: startScore(st.mode) };
  st.turnStart = st.scores.p1;
  st.turnDarts = [];
  st.prevTurn = null;
  st.cricket = { p1: freshCricket(), p2: freshCricket() };
  st.stats = { p1: { darts: 0, scored: 0, best: 0 }, p2: { darts: 0, scored: 0, best: 0 } };
  st.winner = null;
  st.endReason = null;
  st.throwNo = 0;
  st.dartSeed = newSeed();
  st.callout = null; // { kind: 'bust'|'180'|'ton'|'checkout'|'closed', seat, seq, text }
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    mode: st.mode,
    players: st.players,
    botLevels: st.botLevels || {},
    turn: st.turn,
    round: st.round,
    maxRounds: MAX_ROUNDS,
    scores: st.scores,
    turnStart: st.turnStart,
    turnDarts: st.turnDarts,
    prevTurn: st.prevTurn,
    cricket: st.cricket,
    stats: st.stats,
    winner: st.winner,
    endReason: st.endReason,
    throwNo: st.throwNo,
    dartSeed: st.dartSeed,
    callout: st.callout,
  };
}

function broadcastState(room) {
  room.broadcast({ v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'state', ...buildPublicState(room) } } });
}

function setCallout(st, kind, seat, text) {
  st.callout = { kind, seat, seq: st.throwNo, text };
}

// Hands the board to the other player (or ends the game at the round cap).
function endTurn(st) {
  const seat = st.turn;
  const total = st.turnDarts.reduce((n, d) => n + (d.bust ? 0 : d.scored), 0);
  const bust = st.turnDarts.some((d) => d.bust);
  st.prevTurn = { seat, darts: st.turnDarts, total: bust ? 0 : total, bust };
  if (!bust && st.mode !== 'cricket') {
    st.stats[seat].best = Math.max(st.stats[seat].best, total);
    if (total === 180) setCallout(st, '180', seat, 'ONE HUNDRED AND EIGHTY!');
    else if (total >= 100 && !st.winner) setCallout(st, 'ton', seat, `TON${total >= 140 ? '-FORTY' : ''}! ${total}`);
  }
  st.turnDarts = [];
  if (st.winner) return;
  st.turn = other(seat);
  if (st.turn === 'p1') st.round++;
  if (st.round > MAX_ROUNDS) return finishByCap(st);
  st.turnStart = st.scores[st.turn];
}

function finishByCap(st) {
  st.round = MAX_ROUNDS;
  st.phase = 'game_over';
  st.endReason = 'rounds';
  if (st.mode === 'cricket') {
    const a = st.cricket.p1;
    const b = st.cricket.p2;
    const marks = (p) => Sim.CRICKET_NUMS.reduce((n, k) => n + Math.min(3, p.marks[k]), 0);
    st.winner = a.points !== b.points ? (a.points > b.points ? 'p1' : 'p2')
      : marks(a) !== marks(b) ? (marks(a) > marks(b) ? 'p1' : 'p2') : 'draw';
  } else {
    const { p1, p2 } = st.scores;
    st.winner = p1 === p2 ? 'draw' : p1 < p2 ? 'p1' : 'p2';
  }
}

// Scores one dart that landed at (x, y) for the player to move. Returns the dart record.
function applyDart(st, x, y) {
  const seat = st.turn;
  const hit = Sim.scoreAt(x, y);
  const dart = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, label: hit.label, ring: hit.ring, num: hit.num, mult: hit.mult, value: hit.value, scored: 0, bust: false, n: st.throwNo + 1 };
  st.throwNo++;
  st.dartSeed = newSeed();
  st.stats[seat].darts++;
  st.turnDarts.push(dart);

  if (st.mode === 'cricket') {
    const me = st.cricket[seat];
    const opp = st.cricket[other(seat)];
    if (Sim.CRICKET_NUMS.includes(hit.num) && hit.mult > 0) {
      const before = me.marks[hit.num];
      const marksNeeded = Math.max(0, 3 - before);
      const extra = Math.max(0, hit.mult - marksNeeded);
      me.marks[hit.num] = before + hit.mult;
      dart.marks = hit.mult;
      if (extra && opp.marks[hit.num] < 3) {
        dart.scored = extra * hit.num;
        me.points += dart.scored;
        st.stats[seat].scored += dart.scored;
      }
      if (before < 3 && me.marks[hit.num] >= 3) setCallout(st, 'closed', seat, `${hit.num === 25 ? 'BULL' : hit.num} CLOSED`);
      const allClosed = Sim.CRICKET_NUMS.every((n) => me.marks[n] >= 3);
      if (allClosed && me.points >= opp.points) {
        st.winner = seat;
        st.phase = 'game_over';
        st.endReason = 'closed';
        endTurn(st);
        return dart;
      }
    } else {
      dart.marks = 0;
    }
    if (st.turnDarts.length >= DARTS_PER_TURN) endTurn(st);
    return dart;
  }

  const rem = st.scores[seat] - hit.value;
  const dOut = doubleOut(st.mode);
  const finishedOk = rem === 0 && (!dOut || hit.mult === 2);
  if (rem < 0 || (dOut && rem === 1) || (rem === 0 && !finishedOk)) {
    dart.bust = true;
    // Undo everything this turn scored.
    st.stats[seat].scored -= st.turnStart - st.scores[seat];
    st.scores[seat] = st.turnStart;
    setCallout(st, 'bust', seat, 'BUST!');
    endTurn(st);
    return dart;
  }
  dart.scored = hit.value;
  st.scores[seat] = rem;
  st.stats[seat].scored += hit.value;
  if (rem === 0) {
    st.winner = seat;
    st.phase = 'game_over';
    st.endReason = 'checkout';
    const out = st.turnStart;
    endTurn(st);
    setCallout(st, 'checkout', seat, `GAME SHOT! ${out} CHECKOUT`);
    return dart;
  }
  if (st.turnDarts.length >= DARTS_PER_TURN) endTurn(st);
  return dart;
}

function botTarget(st, seat) {
  const level = botLevelOf(st, seat);
  const dartsLeft = DARTS_PER_TURN - st.turnDarts.length;
  if (st.mode === 'cricket') {
    return Sim.chooseTargetCricket(st.cricket[seat], st.cricket[other(seat)], level !== 'easy');
  }
  const rem = st.scores[seat];
  // Easy doesn't plan set-ups: it just goes for 20s until it's on a double.
  if (level === 'easy') {
    const one = Sim.planCheckout(rem, 1, doubleOut(st.mode));
    if (one) return one[0];
    if (rem > 60) return 'T20';
    return Sim.chooseTarget01(rem, 1, doubleOut(st.mode));
  }
  return Sim.chooseTarget01(rem, dartsLeft, doubleOut(st.mode));
}

function maybeScheduleBot(room) {
  const st = room.state;
  if (st.phase !== 'playing' || st.players[st.turn] !== BOT) return;
  const { gameId, throwNo, turn } = st;
  const delay = (st.turnDarts.length ? timing.nextDart : timing.firstDart) + Math.random() * timing.jitter;
  setTimeout(() => {
    const s = room.state;
    if (s !== st || s.gameId !== gameId || s.throwNo !== throwNo || s.phase !== 'playing' || s.turn !== turn || s.players[turn] !== BOT) return;
    const label = botTarget(st, turn);
    const p = Sim.botThrow(label, botLevelOf(st, turn), Math.random);
    const dart = applyDart(st, p.x, p.y);
    dart.aim = label;
    broadcastState(room);
    maybeScheduleBot(room);
  }, delay);
}

function seatOf(st, clientId) {
  return st.players.p1 === clientId ? 'p1' : st.players.p2 === clientId ? 'p2' : null;
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

  createInitialState() {
    const st = { phase: 'waiting', mode: '501', players: { p1: null, p2: null }, botLevels: {} };
    resetGame(st);
    return st;
  },

  // Two throwers, but darts is fun to watch — let a few spectators in before splitting rooms.
  isRoomFull(room) {
    return room.clients.size >= MAX_CLIENTS;
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
    if (!data || typeof data.kind !== 'string') return;
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

    if (data.kind === 'setMode') {
      // Only between games, by someone seated (or anyone while nobody is).
      if (!MODES.includes(data.mode) || st.phase === 'playing') return;
      const seated = seatOf(st, me);
      const humans = SEATS.filter((s) => st.players[s] && st.players[s] !== BOT);
      if (!seated && humans.length) return;
      st.mode = data.mode;
      resetGame(st);
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

    if (data.kind === 'throw') {
      if (st.phase !== 'playing') return reject('not_playing');
      const seat = seatOf(st, me);
      if (!seat || seat !== st.turn) return reject('not_your_turn');
      const x = Number(data.x);
      const y = Number(data.y);
      const t = Number(data.t);
      if (![x, y, t].every(Number.isFinite) || Math.abs(x) > 400 || Math.abs(y) > 400 || t < 0 || t > 60000) return reject('invalid');
      // The client may only throw with the seed it was shown (stale double-sends are dropped).
      if (data.seed !== undefined && Number(data.seed) !== st.dartSeed) return reject('stale');
      const land = Sim.landing(x, y, st.dartSeed, t);
      applyDart(st, land.x, land.y);
      broadcastState(room);
      maybeScheduleBot(room);
    }
  },

  _internal: { timing, applyDart, resetGame, botTarget, MAX_ROUNDS },
};
