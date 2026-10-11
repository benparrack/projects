// Knockout (GamePigeon style) — 2 seats, red vs blue, 4 (or 5) penguins each on a square ice floe.
// Every round is simultaneous: both players secretly drag an arrow (direction + power) from each
// of their alive penguins and lock in before the round timer runs out (unset arrows = stay put;
// an unlocked draft still counts at the buzzer). Then the server slides every penguin at once with
// the shared deterministic sim (public/games/knockout/sim.js) and broadcasts the frames so
// everyone watches the same resolution. Penguins knocked off the floe are out. Every 2nd round the
// floe shrinks and anything left on the cracked-off rim falls in. Last side with penguins wins;
// both wiped out in the same round = draw. After MAX_ROUNDS the side with more penguins wins.
//
// Hidden information: a player's pending arrows live in st.pending (never serialized); the public
// state only says whether each side has locked in. The arrows are revealed in lastRound.moves.

'use strict';

const Sim = require('../../public/games/knockout/sim.js');
const { setBotLevel, botLevelOf } = require('./ai/levels');

const TYPE = 'knockout';
const BOT = 'BOT';
const COLORS = ['red', 'blue'];
const MAX_ROUNDS = 24;
// ms knobs (tests shrink them through _internal.timing)
const timing = {
  roundMs: 20000, // planning time per round
  reveal: 1000, // both sides' arrows shown before everything launches
  hold: 1100, // after the slide: splash-downs settle
  shrink: 1300, // floe-shrink animation
  botMin: 1500, // bot "thinking" delay after planning opens
  botMax: 4500,
};

const opponent = (c) => (c === 'red' ? 'blue' : 'red');

function resetGame(st) {
  st.penguins = Sim.startPositions(st.count);
  st.H = Sim.H0;
  st.round = 1;
  st.planFrom = 0;
  st.deadline = 0;
  st.locked = { red: false, blue: false };
  st.pending = { red: {}, blue: {} }; // PRIVATE — never serialized
  st.botAt = { red: 0, blue: 0 }; // PRIVATE
  st.winner = null;
  st.endReason = null;
  st.lastRound = null;
  st.roundSeq = 0;
  st.stats = { red: { ko: 0, lost: 0 }, blue: { ko: 0, lost: 0 } };
  st.gameId = (st.gameId || 0) + 1;
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    players: st.players,
    botLevels: st.botLevels || {},
    count: st.count,
    roundMs: timing.roundMs,
    penguins: st.penguins,
    H: st.H,
    nextH: Sim.nextH(st.H, st.round),
    round: st.round,
    maxRounds: MAX_ROUNDS,
    planFrom: st.planFrom,
    deadline: st.deadline,
    locked: st.locked,
    winner: st.winner,
    endReason: st.endReason,
    lastRound: st.lastRound,
    roundSeq: st.roundSeq,
    stats: st.stats,
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

const aliveOf = (st, side) => st.penguins.filter((p) => p.side === side).length;

function openPlanning(st, from) {
  st.planFrom = from;
  st.deadline = from + timing.roundMs;
  st.locked = { red: false, blue: false };
  st.pending = { red: {}, blue: {} };
  for (const c of COLORS) {
    st.botAt[c] = from + timing.botMin + Math.random() * (timing.botMax - timing.botMin);
  }
}

// Validates a raw moves object for `side`. Returns a clean {id: {a, p}} or null.
function cleanMoves(st, side, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length > 5) return null;
  const mine = new Set(st.penguins.filter((p) => p.side === side).map((p) => p.id));
  const out = {};
  for (const k of keys) {
    if (!mine.has(k)) return null;
    const m = Sim.normMove(raw[k]);
    if (!m) return null;
    out[k] = m;
  }
  return out;
}

// Resolve the round: simulate everything at once, apply the shrink, check for a winner.
function resolveRound(st, now) {
  const moves = Object.assign({}, st.pending.red, st.pending.blue);
  const before = st.penguins.map((p) => ({ ...p }));
  const res = Sim.simulate(before, moves, st.H);
  const H = st.H;
  const Hn = Sim.nextH(H, st.round);
  const survivors = res.end.filter((b) => !b.out);
  const fell = Hn < H ? survivors.filter((b) => !Sim.onIce(b.x, b.y, Hn)).map((b) => b.id) : [];
  st.penguins = survivors.filter((b) => !fell.includes(b.id)).map((b) => ({ id: b.id, side: b.side, x: b.x, y: b.y, face: b.face }));
  const lostIds = [...res.outs.map((o) => o.id), ...fell];
  for (const id of lostIds) {
    const side = id[0] === 'r' ? 'red' : 'blue';
    st.stats[side].lost++;
    st.stats[opponent(side)].ko++;
  }
  st.roundSeq++;
  const slideMs = Math.round(res.frames.length * Sim.FRAME_DT * 1000);
  const durMs = timing.reveal + slideMs + timing.hold + (Hn < H ? timing.shrink : 0);
  st.lastRound = {
    seq: st.roundSeq,
    round: st.round,
    before,
    moves, // revealed now that both sides are committed
    ids: res.ids,
    frames: res.frames,
    events: res.events,
    outs: res.outs,
    H,
    nextH: Hn,
    fell,
    revealMs: timing.reveal,
    holdMs: timing.hold,
    shrinkMs: Hn < H ? timing.shrink : 0,
    durMs,
  };
  st.H = Hn;
  const r = aliveOf(st, 'red');
  const b = aliveOf(st, 'blue');
  if (!r || !b || st.round >= MAX_ROUNDS) {
    st.phase = 'game_over';
    st.winner = !r && !b ? 'draw' : !r ? 'blue' : !b ? 'red' : r > b ? 'red' : b > r ? 'blue' : 'draw';
    st.endReason = !r || !b ? 'knockout' : 'rounds';
    st.locked = { red: false, blue: false };
    st.pending = { red: {}, blue: {} };
    st.planFrom = 0;
    st.deadline = 0;
    return;
  }
  st.round++;
  openPlanning(st, now + durMs);
}

// Time-driven progress: bots lock in, the buzzer resolves the round. Returns true if state changed.
function advance(room, now) {
  const st = room.state;
  if (st.phase !== 'playing') return false;
  let changed = false;
  if (now < st.planFrom) return false;
  for (const c of COLORS) {
    if (st.players[c] === BOT && !st.locked[c] && now >= st.botAt[c]) {
      st.pending[c] = cleanMoves(st, c, Sim.botMoves(st.penguins, c, st.H, st.round, botLevelOf(st, c))) || {};
      st.locked[c] = true;
      changed = true;
    }
  }
  if ((st.locked.red && st.locked.blue) || now >= st.deadline) {
    resolveRound(st, now);
    changed = true;
  }
  return changed;
}

function startIfReady(st, now) {
  if (st.players.red && st.players.blue) {
    resetGame(st);
    st.phase = 'playing';
    openPlanning(st, now + 600);
  }
}

function vacate(st, seat) {
  st.players[seat] = null;
  st.phase = 'waiting';
  resetGame(st);
}

module.exports = {
  type: TYPE,
  tickIntervalMs: 200,

  createInitialState() {
    const st = { phase: 'waiting', players: { red: null, blue: null }, botLevels: {}, count: 4 };
    resetGame(st);
    return st;
  },

  isRoomFull() {
    return false; // spectators welcome
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  tick(room) {
    try {
      if (advance(room, Date.now())) broadcastState(room);
    } catch (e) {
      console.error('[knockout] tick failed', e);
    }
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
    const now = Date.now();

    if (data.kind === 'sit') {
      if (!seatArg || st.players[seatArg]) return;
      if (data.bot) {
        st.players[seatArg] = BOT;
        setBotLevel(st, seatArg, data.level);
      } else {
        if (seatOf(st, me)) return;
        st.players[seatArg] = me;
      }
      startIfReady(st, now);
      broadcastState(room);
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

    if (data.kind === 'setCount') {
      if (st.phase === 'playing') return;
      if (data.count !== 4 && data.count !== 5) return;
      if (!seatOf(st, me) && st.players.red && st.players.blue) return;
      st.count = data.count;
      if (st.phase === 'waiting') resetGame(st); // after a game it applies from the rematch
      broadcastState(room);
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over' || !seatOf(st, me)) return;
      st.players = { red: st.players.blue, blue: st.players.red };
      st.botLevels = { red: (st.botLevels || {}).blue, blue: (st.botLevels || {}).red };
      for (const c of COLORS) if (!st.botLevels[c]) delete st.botLevels[c];
      st.phase = 'waiting';
      startIfReady(st, now); // both seats are filled after a game, so this resets + starts
      broadcastState(room);
      return;
    }

    if (data.kind === 'submit') {
      if (st.phase !== 'playing') return reject('not_playing');
      const seat = seatOf(st, me);
      if (!seat) return reject('not_seated');
      if (now < st.planFrom - 150) return reject('busy');
      if (st.locked[seat]) return reject('locked');
      const moves = cleanMoves(st, seat, data.moves);
      if (!moves) return reject('invalid');
      st.pending[seat] = moves;
      if (data.lock === true) {
        st.locked[seat] = true;
        advance(room, Math.max(now, st.planFrom));
        broadcastState(room);
      }
      // a draft (lock false) changes nothing public
    }
  },

  _internal: { timing, advance, resolveRound, resetGame, cleanMoves, MAX_ROUNDS },
};
