// Filler (GamePigeon-style): two seats, p1 starts bottom-left and p2 top-right on an 8x7 board of
// six colours. On your turn pick a colour that neither player currently is; your region turns
// that colour and swallows every touching cell of it. Own more than half the board to win.
// Rules + search live in ./ai/fillerEngine.js. Each move is broadcast with the absorbed cells and
// their wave distance so clients can ripple them in.

'use strict';

const E = require('./ai/fillerEngine');
const { think } = require('./ai');
const { setBotLevel, botLevelOf } = require('./ai/levels');
const { report } = require('../report');

const TYPE = 'filler';
const BOT = 'BOT';
const SEATS = ['p1', 'p2'];
const numOf = (seat) => (seat === 'p1' ? 1 : 2);
const seatOfNum = (n) => (n === 1 ? 'p1' : 'p2');

// Client ripple pacing (keep in sync with WAVE_MS in public/games/filler/client.js): bots wait
// for the previous move's ripple to land before "thinking".
const WAVE_MS = 70;
const BOT_THINK_MS_MIN = 550;
const BOT_THINK_MS_MAX = 1000;

function publicCounts(owner) {
  const n = E.counts(owner);
  return { p1: n[1], p2: n[2] };
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    players: st.players,
    botLevels: st.botLevels || {},
    cols: E.COLS,
    rows: E.ROWS,
    colors: st.colors,
    owner: st.owner,
    turn: st.turn,
    current: { p1: E.colorOf(st.colors, 1), p2: E.colorOf(st.colors, 2) },
    counts: publicCounts(st.owner),
    winner: st.winner,
    lastMove: st.lastMove,
    moveCount: st.moveCount,
    score: st.score,
  };
}

// Every game_over is followed by a broadcast, so report there — once: the flag re-arms on the
// next broadcast outside game_over (a new game).
function reportIfOver(room) {
  const st = room.state;
  if (st.phase !== 'game_over') { st.reported = false; return; }
  if (st.reported) return;
  st.reported = true;
  const n = publicCounts(st.owner);
  const { p1, p2 } = st.players;
  const placements = st.winner === 'draw' ? [[p1, p2]] : st.winner === 'p1' ? [[p1], [p2]] : [[p2], [p1]];
  const result = { placements, scores: {} };
  for (const s of SEATS) if (st.players[s] !== BOT) result.scores[st.players[s]] = n[s];
  const bot = SEATS.find((s) => st.players[s] === BOT);
  if (bot) result.botLevel = botLevelOf(st, bot);
  report(room, result);
}

function broadcastState(room) {
  reportIfOver(room);
  room.broadcast({ v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'state', ...buildPublicState(room) } } });
}

function resetBoard(st, firstMover) {
  st.colors = E.randomBoard();
  st.owner = E.initialOwner();
  st.turn = firstMover || 'p1';
  st.winner = null;
  st.lastMove = null;
  st.moveCount = 0;
  st.gen = (st.gen || 0) + 1; // invalidates any bot timer from the previous board
}

function startNewGame(st) {
  const first = st.nextFirstMover || 'p1';
  resetBoard(st, first);
  st.nextFirstMover = first === 'p1' ? 'p2' : 'p1';
}

// Applies a validated colour pick. Returns false if the colour isn't legal for this seat.
function applyMove(st, seat, color) {
  const p = numOf(seat);
  if (!E.legalColors(st.colors, p).includes(color)) return false;
  const gained = E.applyColor(st.colors, st.owner, p, color);
  st.moveCount++;
  st.lastMove = { id: st.moveCount, seat, color, gained };
  if (E.isOver(st.owner, st.moveCount)) {
    st.phase = 'game_over';
    const w = E.winnerOf(st.owner);
    st.winner = w ? seatOfNum(w) : 'draw';
    if (st.winner !== 'draw') st.score[st.winner]++;
    else st.score.draws++;
  } else {
    st.turn = seat === 'p1' ? 'p2' : 'p1';
  }
  return true;
}

function rippleMs(lastMove) {
  if (!lastMove || !lastMove.gained.length) return 0;
  return Math.max(...lastMove.gained.map((g) => g.d)) * WAVE_MS + 250;
}

function maybeScheduleBotMove(room) {
  const st = room.state;
  if (st.phase !== 'playing' || st.players[st.turn] !== BOT) return;
  const gen = st.gen;
  const moveId = st.moveCount;
  const wait = rippleMs(st.lastMove) + BOT_THINK_MS_MIN + Math.random() * (BOT_THINK_MS_MAX - BOT_THINK_MS_MIN);
  const stillOn = () => {
    const s = room.state;
    return s === st && s.gen === gen && s.moveCount === moveId && s.phase === 'playing' && s.players[s.turn] === BOT;
  };
  setTimeout(() => {
    if (!stillOn()) return;
    const seat = st.turn;
    const input = { colors: st.colors.slice(), owner: st.owner.slice(), player: numOf(seat), level: botLevelOf(st, seat) };
    const finish = (color) => {
      if (!stillOn() || st.turn !== seat) return;
      const legal = E.legalColors(st.colors, numOf(seat));
      if (!legal.includes(color)) color = legal[Math.floor(Math.random() * legal.length)];
      applyMove(st, seat, color);
      broadcastState(room);
      maybeScheduleBotMove(room);
    };
    // The shared AI worker runs the search off the main thread; if it doesn't know this engine
    // (or dies), fall back to a short in-process search.
    think(TYPE, input).then(
      (r) => finish(r && r.color),
      () => finish(E.bestMove({ ...input, timeMs: 250 }).color),
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

const freshScore = () => ({ p1: 0, p2: 0, draws: 0 });

module.exports = {
  type: TYPE,
  stats: { rated: true, score: { label: 'Cells', better: 'high', format: 'int' } },

  createInitialState() {
    const st = {
      phase: 'waiting',
      players: { p1: null, p2: null },
      botLevels: {},
      score: freshScore(),
      nextFirstMover: 'p1',
    };
    resetBoard(st);
    return st;
  },

  isRoomFull(room) {
    return !!(room.state.players.p1 && room.state.players.p2);
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  onLeave(room, client) {
    const st = room.state;
    const seat = seatFor(st, client.clientId);
    if (!seat) return;
    clearSeat(room, seat);
    st.score = freshScore(); // a fresh opponent shouldn't inherit the old tally
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
        st.score = freshScore();
        if (st.players.p1 && st.players.p2) {
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
        st.score = freshScore();
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
        st.score = freshScore();
        broadcastState(room);
        return;
      }
      case 'resetGame': {
        if (st.phase !== 'game_over' || !seatFor(st, ctx.senderId)) return;
        startNewGame(st);
        st.phase = st.players.p1 && st.players.p2 ? 'playing' : 'waiting';
        broadcastState(room);
        maybeScheduleBotMove(room);
        return;
      }
      case 'move': {
        if (st.phase !== 'playing') return reject('not_playing');
        const seat = seatFor(st, ctx.senderId);
        if (!seat) return reject('not_seated');
        if (seat !== st.turn) return reject('not_your_turn');
        const color = data.color;
        if (typeof color !== 'number' || !Number.isInteger(color) || color < 0 || color >= E.NCOLORS) return reject('invalid');
        if (!applyMove(st, seat, color)) return reject('color_taken');
        broadcastState(room);
        maybeScheduleBotMove(room);
        return;
      }
      default:
    }
  },
};

module.exports._internals = { applyMove, rippleMs, SEATS, WAVE_MS };
