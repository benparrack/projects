// Mancala (Kalah, GamePigeon-style): two seats (gold / jade), 6 pits a side with 4 stones each.
// Rules and the search engine live in ./ai/mancalaEngine.js (shared with the AI worker). Two modes,
// picked before a game: 'capture' (standard Kalah) and 'avalanche' (relay sowing, no captures).
// Every move is broadcast with its recorded sowing steps so clients can animate stone by stone.

'use strict';

const E = require('./ai/mancalaEngine');
const { think } = require('./ai');
const { setBotLevel, botLevelOf } = require('./ai/levels');

const TYPE = 'mancala';
const BOT = 'BOT';
const SEATS = ['gold', 'jade'];
const MODES = ['capture', 'avalanche'];
const sideOf = (seat) => (seat === 'gold' ? 0 : 1);
const seatOf = (side) => SEATS[side];

// Client animation pacing (keep in sync with STEP_MS etc. in public/games/mancala/client.js) — bots
// wait for the previous move's animation to finish before "thinking", so a bot never moves while
// the stones of the last move are still flying.
const STEP_MS = 150;
const PICK_MS = 260;
const CAPTURE_MS = 650;
function animMs(steps) {
  let ms = 0;
  for (const s of steps || []) ms += s.t === 'drop' ? STEP_MS : s.t === 'pick' ? PICK_MS : CAPTURE_MS;
  return ms;
}
const BOT_THINK_MS_MIN = 450;
const BOT_THINK_MS_MAX = 900;

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    mode: st.mode,
    players: st.players,
    botLevels: st.botLevels || {},
    pits: st.pits,
    turn: st.turn,
    winner: st.winner,
    lastMove: st.lastMove,
    moveCount: st.moveCount,
    score: st.score,
  };
}

function broadcastState(room) {
  room.broadcast({ v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'state', ...buildPublicState(room) } } });
}

function resetBoard(st, firstMover) {
  st.pits = E.initialPits();
  st.turn = firstMover || 'gold';
  st.winner = null;
  st.lastMove = null;
  st.moveCount = 0;
  st.gen = (st.gen || 0) + 1; // invalidates any bot timer from the previous board
}

function startNewGame(st) {
  const first = st.nextFirstMover || 'gold';
  resetBoard(st, first);
  st.nextFirstMover = first === 'gold' ? 'jade' : 'gold';
}

// Applies a validated move. Returns false if the pit isn't playable.
function applyMove(st, seat, pit) {
  const side = sideOf(seat);
  if (E.sideOfPit(pit) !== side || !(st.pits[pit] > 0)) return false;
  const before = st.pits.slice();
  const steps = [];
  const r = E.sow(st.pits, side, pit, st.mode, steps);
  st.moveCount++;
  st.lastMove = { id: st.moveCount, seat, pit, before, steps, extra: r.extra, captured: r.captured };
  if (r.over) {
    st.phase = 'game_over';
    const g = st.pits[E.storeOf(0)];
    const j = st.pits[E.storeOf(1)];
    st.winner = g > j ? 'gold' : j > g ? 'jade' : 'draw';
    if (st.winner !== 'draw') st.score[st.winner]++;
    else st.score.draws++;
  } else if (!r.extra) {
    st.turn = seat === 'gold' ? 'jade' : 'gold';
  }
  return true;
}

function maybeScheduleBotMove(room) {
  const st = room.state;
  if (st.phase !== 'playing' || st.players[st.turn] !== BOT) return;
  const gen = st.gen;
  const moveId = st.moveCount;
  const wait = animMs(st.lastMove && st.lastMove.steps) + BOT_THINK_MS_MIN + Math.random() * (BOT_THINK_MS_MAX - BOT_THINK_MS_MIN);
  const stillOn = () => {
    const s = room.state;
    return s === st && s.gen === gen && s.moveCount === moveId && s.phase === 'playing' && s.players[s.turn] === BOT;
  };
  setTimeout(() => {
    if (!stillOn()) return;
    const seat = st.turn;
    const input = { pits: st.pits.slice(), side: sideOf(seat), mode: st.mode, level: botLevelOf(st, seat) };
    const finish = (pit) => {
      if (!stillOn() || st.turn !== seat) return;
      const legal = E.legalMoves(st.pits, sideOf(seat));
      if (!legal.length) return;
      if (!legal.includes(pit)) pit = legal[Math.floor(Math.random() * legal.length)];
      applyMove(st, seat, pit);
      broadcastState(room);
      maybeScheduleBotMove(room);
    };
    // The shared AI worker runs the search off the main thread; if it doesn't know this engine
    // (or dies), fall back to a short in-process search.
    think(TYPE, input).then(
      (r) => finish(r && r.pit),
      () => finish(E.bestMove({ ...input, timeMs: 120 }).pit),
    );
  }, wait);
}

function seatFor(st, clientId) {
  return SEATS.find((s) => st.players[s] === clientId) || null;
}

function clearSeat(room, seat) {
  const st = room.state;
  st.players[seat] = null;
  st.phase = 'waiting';
  resetBoard(st);
}

module.exports = {
  type: TYPE,

  createInitialState() {
    const st = {
      phase: 'waiting',
      mode: 'capture',
      players: { gold: null, jade: null },
      botLevels: {},
      score: { gold: 0, jade: 0, draws: 0 },
      nextFirstMover: 'gold',
    };
    resetBoard(st);
    return st;
  },

  isRoomFull(room) {
    return !!(room.state.players.gold && room.state.players.jade);
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  onLeave(room, client) {
    const st = room.state;
    const seat = seatFor(st, client.clientId);
    if (!seat) return;
    clearSeat(room, seat);
    // A fresh opponent shouldn't inherit the old head-to-head tally.
    st.score = { gold: 0, jade: 0, draws: 0 };
    broadcastState(room);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;
    const reject = (reason) => ctx.sendTo(ctx.senderId, { v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'moveRejected', reason } } });
    const validSeat = (s) => (SEATS.includes(s) ? s : null);

    switch (data.kind) {
      case 'sit': {
        const seat = validSeat(data.seat);
        if (!seat || st.players[seat]) return;
        if (data.bot) {
          st.players[seat] = BOT;
          setBotLevel(st, seat, data.level);
        } else {
          if (seatFor(st, ctx.senderId)) return;
          st.players[seat] = ctx.senderId;
        }
        st.score = { gold: 0, jade: 0, draws: 0 };
        if (st.players.gold && st.players.jade) {
          startNewGame(st);
          st.phase = 'playing';
        }
        broadcastState(room);
        maybeScheduleBotMove(room);
        return;
      }
      case 'leaveSeat': {
        const seat = seatFor(st, ctx.senderId);
        if (!seat) return;
        clearSeat(room, seat);
        st.score = { gold: 0, jade: 0, draws: 0 };
        broadcastState(room);
        return;
      }
      case 'setBotLevel': {
        const seat = validSeat(data.seat);
        if (!seat || st.players[seat] !== BOT) return;
        setBotLevel(st, seat, data.level);
        broadcastState(room);
        return;
      }
      case 'removeBot': {
        const seat = validSeat(data.seat);
        if (!seat || st.players[seat] !== BOT) return;
        clearSeat(room, seat);
        st.score = { gold: 0, jade: 0, draws: 0 };
        broadcastState(room);
        return;
      }
      case 'setMode': {
        // Only between games, and only by a seated player (or anyone while nobody is seated).
        if (!MODES.includes(data.mode) || st.phase === 'playing') return;
        const anyHuman = SEATS.some((s) => st.players[s] && st.players[s] !== BOT);
        if (anyHuman && !seatFor(st, ctx.senderId)) return;
        if (st.mode === data.mode) return;
        st.mode = data.mode;
        if (st.phase === 'game_over') {
          // Switching rules after a game starts the next one in the new mode right away.
          startNewGame(st);
          st.phase = st.players.gold && st.players.jade ? 'playing' : 'waiting';
        }
        broadcastState(room);
        maybeScheduleBotMove(room);
        return;
      }
      case 'resetGame': {
        if (st.phase !== 'game_over') return;
        if (!seatFor(st, ctx.senderId)) return;
        startNewGame(st);
        st.phase = st.players.gold && st.players.jade ? 'playing' : 'waiting';
        broadcastState(room);
        maybeScheduleBotMove(room);
        return;
      }
      case 'move': {
        if (st.phase !== 'playing') return reject('not_playing');
        const seat = seatFor(st, ctx.senderId);
        if (!seat) return reject('not_seated');
        if (seat !== st.turn) return reject('not_your_turn');
        const pit = data.pit;
        if (typeof pit !== 'number' || !Number.isInteger(pit) || E.sideOfPit(pit) !== sideOf(seat)) return reject('not_your_pit');
        if (!(st.pits[pit] > 0)) return reject('empty_pit');
        applyMove(st, seat, pit);
        broadcastState(room);
        maybeScheduleBotMove(room);
        return;
      }
      default:
    }
  },
};

module.exports._internals = { animMs, applyMove, SEATS };
