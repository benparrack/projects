// Blockade: two seats race a pair of pawns to the opponent's home squares while dropping walls
// to lengthen each other's path. A turn is two messages: `move` (pawn 0/1 to a cell), then
// `wall` (o 'h'|'v', r, c) if you have walls left. Rules + bot in ./ai/blockadeEngine.js.

'use strict';

const E = require('./ai/blockadeEngine');
const { setBotLevel, botLevelOf } = require('./ai/levels');
const { reportDuel, frameOf } = require('./boardResult');

const TYPE = 'blockade';
const BOT = 'BOT';
const SEATS = ['p1', 'p2'];
const BOT_THINK_MS = [650, 1100];
const BOT_WALL_MS = 550;

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    players: st.players,
    botLevels: st.botLevels || {},
    cols: E.COLS,
    rows: E.ROWS,
    start: E.START,
    pawns: st.pawns,
    H: st.walls.H,
    V: st.walls.V,
    wallOwner: st.wallOwner,
    left: st.left,
    turn: st.turn,
    step: st.step,
    winner: st.winner,
    lastMove: st.lastMove,
    lastWall: st.lastWall,
    moveCount: st.moveCount,
    score: st.score,
  };
}

function broadcastState(room) {
  room.broadcast({ v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'state', ...buildPublicState(room) } } });
}

function resetBoard(st, first) {
  st.pawns = { p1: E.START.p1.slice(), p2: E.START.p2.slice() };
  st.walls = E.emptyWalls();
  st.wallOwner = {}; // "h12" -> seat, for colouring
  st.left = { p1: { h: E.WALLS_EACH, v: E.WALLS_EACH }, p2: { h: E.WALLS_EACH, v: E.WALLS_EACH } };
  st.turn = first || 'p1';
  st.step = 'move';
  st.winner = null;
  st.lastMove = null;
  st.lastWall = null;
  st.moveCount = 0;
  st.gen = (st.gen || 0) + 1;
  // Replay: [firstMover, ...actions]; an action is [pawn, to], [o, r, c] (a wall), or the bot
  // safety nets 's' (no pawn move: straight to walls) / 'p' (no wall: pass).
  st.moves = [st.turn];
  st.reported = false;
}

function startNewGame(st) {
  const first = st.nextFirstMover || 'p1';
  resetBoard(st, first);
  st.nextFirstMover = E.other(first);
  st.phase = 'playing';
}

const hasLegalWall = (st, seat) => {
  const l = st.left[seat];
  for (const o of ['h', 'v']) {
    if (!l[o]) continue;
    for (let r = 0; r < E.ROWS - 1; r++) for (let c = 0; c < E.WC; c++) if (E.wallLegal(st.walls, st.pawns, o, r, c)) return true;
  }
  return false;
};

const anyPawnMove = (st, seat) => [0, 1].some((i) => E.pawnTargets(st.walls, st.pawns, seat, i).length);

function endTurn(st) {
  st.moveCount++;
  st.turn = E.other(st.turn);
  if (anyPawnMove(st, st.turn)) st.step = 'move';
  else if (hasLegalWall(st, st.turn)) st.step = 'wall';
  else st.turn = E.other(st.turn); // boxed in by pawns with nothing to place: pass
}

// Returns false if illegal.
function applyMove(st, seat, pawn, to) {
  if (pawn !== 0 && pawn !== 1 || !E.pawnTargets(st.walls, st.pawns, seat, pawn).includes(to)) return false;
  const from = st.pawns[seat][pawn];
  st.pawns[seat][pawn] = to;
  st.moves.push([pawn, to]);
  st.lastMove = { id: st.moveCount, seat, pawn, from, to };
  if (E.isGoal(seat, to)) {
    st.phase = 'game_over';
    st.winner = seat;
    st.score[seat]++;
    st.gen++;
    return true;
  }
  if (hasLegalWall(st, seat)) st.step = 'wall';
  else endTurn(st);
  return true;
}

function applyWall(st, seat, o, r, c) {
  if ((o !== 'h' && o !== 'v') || !st.left[seat][o] || !E.wallLegal(st.walls, st.pawns, o, r, c)) return false;
  st.walls[o === 'h' ? 'H' : 'V'][r * E.WC + c] = 1;
  st.wallOwner[`${o}${r * E.WC + c}`] = seat;
  st.left[seat][o]--;
  st.moves.push([o, r, c]);
  st.lastWall = { id: st.moveCount, seat, o, r, c };
  endTurn(st);
  return true;
}

function randomLegalWall(st, seat) {
  const opts = [];
  for (const o of ['h', 'v']) {
    if (!st.left[seat][o]) continue;
    for (let r = 0; r < E.ROWS - 1; r++) for (let c = 0; c < E.WC; c++) if (E.wallLegal(st.walls, st.pawns, o, r, c)) opts.push({ o, r, c });
  }
  return opts[Math.floor(Math.random() * opts.length)] || null;
}

// A pawn reaching a goal square is the only way a match ends.
function reportIfOver(room) {
  const st = room.state;
  if (st.phase === 'game_over') reportDuel(room, SEATS, st.winner, { replay: st.moves });
}

function maybeScheduleBot(room) {
  const st = room.state;
  if (st.phase !== 'playing' || st.players[st.turn] !== BOT) return;
  const gen = st.gen;
  const seat = st.turn;
  const moveId = st.moveCount;
  const stillOn = () => {
    const s = room.state;
    return s === st && s.gen === gen && s.moveCount === moveId && s.phase === 'playing' && s.turn === seat && s.players[seat] === BOT;
  };
  setTimeout(() => {
    if (!stillOn()) return;
    const plan = E.bestTurn({ pawns: st.pawns, walls: st.walls, left: st.left }, seat, botLevelOf(st, seat));
    if (st.step === 'move') {
      let mv = plan.move;
      if (!mv || !applyMove(st, seat, mv.pawn, mv.to)) {
        // Safety net: any legal step so a bot never stalls.
        const idx = [0, 1].find((i) => E.pawnTargets(st.walls, st.pawns, seat, i).length);
        if (idx == null) { st.step = 'wall'; st.moves.push('s'); }
        else applyMove(st, seat, idx, E.pawnTargets(st.walls, st.pawns, seat, idx)[0]);
      }
      reportIfOver(room);
      broadcastState(room);
    }
    if (st.phase !== 'playing' || st.step !== 'wall' || st.turn !== seat) return maybeScheduleBot(room);
    setTimeout(() => {
      if (!stillOn() || st.step !== 'wall') return;
      const w = plan.wall && E.wallLegal(st.walls, st.pawns, plan.wall.o, plan.wall.r, plan.wall.c) && st.left[seat][plan.wall.o] ? plan.wall : randomLegalWall(st, seat);
      if (!w || !applyWall(st, seat, w.o, w.r, w.c)) { endTurn(st); st.moves.push('p'); }
      broadcastState(room);
      maybeScheduleBot(room);
    }, BOT_WALL_MS);
  }, BOT_THINK_MS[0] + Math.random() * (BOT_THINK_MS[1] - BOT_THINK_MS[0]));
}

function seatFor(st, clientId) {
  return SEATS.find((s) => st.players[s] === clientId) || null;
}

function clearSeat(st, seat) {
  st.players[seat] = null;
  st.phase = 'waiting';
  resetBoard(st);
}

const freshScore = () => ({ p1: 0, p2: 0 });

module.exports = {
  type: TYPE,

  createInitialState() {
    const st = { phase: 'waiting', players: { p1: null, p2: null }, botLevels: {}, score: freshScore(), nextFirstMover: 'p1' };
    resetBoard(st);
    return st;
  },

  isRoomFull(room) {
    return !!(room.state.players.p1 && room.state.players.p2);
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  stats: { rated: true },

  // Re-plays [firstMover, ...actions] on a fresh board; one spectator snapshot per action (a pawn
  // step and its wall are separate frames). (`score` in the frames is the replay's own tally.)
  replayFrames(replay) {
    const room = { state: module.exports.createInitialState() };
    const st = room.state;
    resetBoard(st, replay[0]);
    st.phase = 'playing';
    const frames = [frameOf(buildPublicState(room))];
    for (const a of replay.slice(1)) {
      const seat = st.turn;
      if (a === 's') { st.step = 'wall'; st.moves.push('s'); }
      else if (a === 'p') { endTurn(st); st.moves.push('p'); }
      else if (!(a.length === 2 ? applyMove(st, seat, a[0], a[1]) : applyWall(st, seat, a[0], a[1], a[2]))) break;
      frames.push(frameOf(buildPublicState(room)));
    }
    return frames;
  },

  onLeave(room, client) {
    const st = room.state;
    const seat = seatFor(st, client.clientId);
    if (!seat) return;
    clearSeat(st, seat);
    st.score = freshScore();
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
        if (st.players.p1 && st.players.p2) startNewGame(st);
        broadcastState(room);
        maybeScheduleBot(room);
        return;
      }
      case 'leaveSeat': {
        const seat = seatFor(st, ctx.senderId);
        if (!seat) return;
        clearSeat(st, seat);
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
        clearSeat(st, seat);
        st.score = freshScore();
        broadcastState(room);
        return;
      }
      case 'resetGame': {
        if (st.phase !== 'game_over' || !seatFor(st, ctx.senderId)) return;
        startNewGame(st);
        broadcastState(room);
        maybeScheduleBot(room);
        return;
      }
      case 'move':
      case 'wall': {
        if (st.phase !== 'playing') return reject('not_playing');
        const seat = seatFor(st, ctx.senderId);
        if (!seat) return reject('not_seated');
        if (seat !== st.turn) return reject('not_your_turn');
        if (data.kind !== st.step) return reject(st.step === 'wall' ? 'place_wall' : 'move_first');
        const ok = data.kind === 'move' ? applyMove(st, seat, data.pawn, data.to) : applyWall(st, seat, data.o, data.r, data.c);
        if (!ok) return reject(data.kind === 'move' ? 'bad_move' : 'bad_wall');
        reportIfOver(room);
        broadcastState(room);
        maybeScheduleBot(room);
        return;
      }
      default:
    }
  },
};

module.exports._internals = { applyMove, applyWall, SEATS };
