// Archery (GamePigeon style) — two archers, one 122 cm target at 70 m. Each end both archers
// shoot three arrows (the end's opener shoots all three first, then the other; the opener
// alternates every end). Arrows score 10..1 by ring, an X (inner ten) scores 10 and is counted
// for the stats; a miss scores 0. Arrows stay in the target until the end is over. Highest total
// after five ends wins; a tie goes to a one-arrow shoot-off, closest to the centre wins (repeated
// if that's tied too).
//
// Shots are server-authoritative: every arrow comes with a fresh seed and a fresh wind (shown to
// everyone). The client sends where the sight was aimed and how long it held at full draw (t, ms);
// the server lands the arrow with the shared sway + wind drift from public/games/archery/sim.js,
// so the sight the archer watched is what gets scored (plus a hair of release jitter and gust
// nobody can see coming). Bots aim off for the wind and scatter by difficulty.

'use strict';

const Sim = require('../../public/games/archery/sim.js');
const { setBotLevel, botLevelOf } = require('./ai/levels');

const TYPE = 'archery';
const BOT = 'BOT';
const SEATS = ['p1', 'p2'];
const MAX_CLIENTS = 12;
const MAX_SHOOTOFFS = 9;
// Arrow flight (ms) and bot pacing; tests shrink these via _internal.timing.
const timing = { flight: 900, first: 1500, next: 1000, jitter: 600, grace: 150 };

const other = (s) => (s === 'p1' ? 'p2' : 'p1');
const newSeed = () => (Math.random() * 0x100000000) >>> 0;

function freshCard() {
  return Array.from({ length: Sim.ENDS }, () => []);
}

function nextArrow(st) {
  st.shotSeed = newSeed();
  st.wind = Sim.randomWind(Math.random);
}

function resetGame(st) {
  st.gameId = (st.gameId || 0) + 1;
  st.end = 1;
  st.opener = 'p1';
  st.turn = 'p1';
  st.shotsInEnd = 0;
  st.endArrows = [];
  st.lastEndArrows = [];
  st.card = { p1: freshCard(), p2: freshCard() };
  st.totals = { p1: 0, p2: 0 };
  st.xs = { p1: 0, p2: 0 };
  st.tens = { p1: 0, p2: 0 };
  st.shootoff = 0;
  st.shootoffLog = []; // [{ round, p1: dist, p2: dist }]
  st.winner = null;
  st.endReason = null;
  st.shotNo = 0;
  st.busyUntil = 0;
  st.callout = null;
  nextArrow(st);
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    players: st.players,
    botLevels: st.botLevels || {},
    ends: Sim.ENDS,
    arrowsPerEnd: Sim.ARROWS_PER_END,
    end: st.end,
    opener: st.opener,
    turn: st.turn,
    shotsInEnd: st.shotsInEnd,
    gameId: st.gameId,
    endArrows: st.endArrows,
    lastEndArrows: st.lastEndArrows,
    card: st.card,
    totals: st.totals,
    xs: st.xs,
    tens: st.tens,
    shootoff: st.shootoff,
    shootoffLog: st.shootoffLog,
    winner: st.winner,
    endReason: st.endReason,
    shotNo: st.shotNo,
    shotSeed: st.shotSeed,
    wind: st.wind,
    callout: st.callout,
  };
}

function broadcastState(room) {
  room.broadcast({ v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'state', ...buildPublicState(room) } } });
}

function setCallout(st, kind, seat, text) {
  st.callout = { kind, seat, seq: st.shotNo, text };
}

const seatLabel = (s) => (s === 'p1' ? 'P1' : 'P2');

function finishShootoffRound(st) {
  const [a, b] = st.endArrows;
  const da = a.seat === 'p1' ? a.dist : b.dist;
  const db = a.seat === 'p1' ? b.dist : a.dist;
  st.shootoffLog.push({ round: st.shootoff, p1: da, p2: db });
  st.lastEndArrows = st.endArrows;
  st.endArrows = [];
  if (da !== db) {
    st.winner = da < db ? 'p1' : 'p2';
    st.phase = 'game_over';
    st.endReason = 'shootoff';
    setCallout(st, 'win', st.winner, `${seatLabel(st.winner)} WINS THE SHOOT-OFF`);
    return;
  }
  if (st.shootoff >= MAX_SHOOTOFFS) {
    st.winner = 'draw';
    st.phase = 'game_over';
    st.endReason = 'shootoff';
    return;
  }
  st.shootoff++;
  st.turn = st.shootoff % 2 ? 'p1' : 'p2';
  setCallout(st, 'shootoff', null, 'DEAD LEVEL — SHOOT AGAIN');
}

function finishEnd(st) {
  const e = st.end;
  const sum = (seat) => st.card[seat][e - 1].reduce((n, l) => n + (l === 'X' ? 10 : l === 'M' ? 0 : Number(l)), 0);
  const a = sum('p1');
  const b = sum('p2');
  st.lastEndArrows = st.endArrows;
  st.endArrows = [];
  st.shotsInEnd = 0;
  if (e >= Sim.ENDS) {
    if (st.totals.p1 !== st.totals.p2) {
      st.winner = st.totals.p1 > st.totals.p2 ? 'p1' : 'p2';
      st.phase = 'game_over';
      st.endReason = 'points';
      setCallout(st, 'win', st.winner, `${seatLabel(st.winner)} WINS ${Math.max(st.totals.p1, st.totals.p2)}–${Math.min(st.totals.p1, st.totals.p2)}`);
      return;
    }
    st.shootoff = 1;
    st.turn = 'p1';
    setCallout(st, 'shootoff', null, `TIED ${st.totals.p1}–${st.totals.p2} · SHOOT-OFF!`);
    return;
  }
  st.end = e + 1;
  st.opener = other(st.opener);
  st.turn = st.opener;
  // A perfect end on the last arrow keeps its own callout; the scorecard shows the end anyway.
  if (!(st.callout && st.callout.seq === st.shotNo)) setCallout(st, 'end', null, `END ${e} · P1 ${a} — P2 ${b}`);
}

// Scores one arrow that landed at (x, y) for the archer to move. Returns the arrow record.
function applyShot(st, x, y, now = Date.now()) {
  const seat = st.turn;
  const hit = Sim.scoreAt(x, y);
  const arrow = {
    n: st.shotNo + 1,
    seat,
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    pts: hit.pts,
    label: hit.label,
    dist: Math.round(Math.hypot(x, y) * 100) / 100,
    wind: { ...st.wind },
    end: st.end,
    so: st.shootoff || 0,
  };
  st.shotNo++;
  st.endArrows.push(arrow);
  st.busyUntil = now + timing.flight;
  nextArrow(st);

  if (st.shootoff) {
    if (st.endArrows.length >= 2) finishShootoffRound(st);
    else st.turn = other(seat);
    return arrow;
  }

  st.totals[seat] += hit.pts;
  if (hit.pts === 10) st.tens[seat]++;
  if (hit.x) st.xs[seat]++;
  const set = st.card[seat][st.end - 1];
  set.push(hit.label);
  st.shotsInEnd++;
  if (set.length === Sim.ARROWS_PER_END && set.every((l) => l === 'X' || l === '10')) {
    setCallout(st, 'perfect', seat, `${seatLabel(seat)} PERFECT END · 30!`);
  }
  if (st.shotsInEnd >= Sim.ARROWS_PER_END * 2) finishEnd(st);
  else if (st.shotsInEnd === Sim.ARROWS_PER_END) st.turn = other(st.opener);
  return arrow;
}

function maybeScheduleBot(room) {
  const st = room.state;
  if (st.phase !== 'playing' || st.players[st.turn] !== BOT) return;
  const { gameId, shotNo, turn } = st;
  const firstOfSet = st.shootoff ? true : st.shotsInEnd % Sim.ARROWS_PER_END === 0;
  const delay = Math.max(0, st.busyUntil - Date.now()) + (firstOfSet ? timing.first : timing.next) + Math.random() * timing.jitter;
  setTimeout(() => {
    const s = room.state;
    if (s !== st || s.gameId !== gameId || s.shotNo !== shotNo || s.phase !== 'playing' || s.turn !== turn || s.players[turn] !== BOT) return;
    const p = Sim.botShot(st.wind, botLevelOf(st, turn), st.shotSeed, Math.random);
    applyShot(st, p.x, p.y);
    broadcastState(room);
    maybeScheduleBot(room);
  }, delay);
}

function seatOf(st, clientId) {
  if (!clientId) return null;
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
    const st = { phase: 'waiting', players: { p1: null, p2: null }, botLevels: {} };
    resetGame(st);
    return st;
  },

  isRoomFull(room) {
    return room.clients.size >= MAX_CLIENTS;
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  onLeave(room, client) {
    const st = room.state;
    const seat = seatOf(st, client && client.clientId);
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

    if (data.kind === 'shoot') {
      if (st.phase !== 'playing') return reject('not_playing');
      const seat = seatOf(st, me);
      if (!seat || seat !== st.turn) return reject('not_your_turn');
      const x = Number(data.x);
      const y = Number(data.y);
      const t = Number(data.t);
      if (![x, y, t].every(Number.isFinite) || Math.abs(x) > 300 || Math.abs(y) > 300 || t < 0 || t > 60000) return reject('invalid');
      // Only with the seed (and wind) the archer was shown: stale double-sends are dropped.
      if (data.seed !== undefined && Number(data.seed) !== st.shotSeed) return reject('stale');
      const now = Date.now();
      if (now < st.busyUntil - timing.grace) return reject('busy');
      const land = Sim.shoot(x, y, st.shotSeed, t, st.wind);
      applyShot(st, land.x, land.y, now);
      broadcastState(room);
      maybeScheduleBot(room);
    }
  },

  _internal: { timing, applyShot, resetGame, MAX_SHOOTOFFS },
};
