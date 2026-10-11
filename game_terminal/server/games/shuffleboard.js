// Shuffleboard (GamePigeon style table shuffleboard) — 2 seats, red vs blue. Each round both
// players alternate sliding 4 pucks down the table (the round's leader shoots first, the other
// player has the "hammer" — the last shot). Pucks collide, get knocked into the gutters or off the
// far end, and any puck resting short of the foul line is removed. When all 8 are down, only the
// player with the furthest puck scores: 1/2/3 per puck by zone, 4 for a hanger, counting each of
// their pucks beyond the opponent's furthest. First to the target (15 or 21) wins. The round's
// scorer leads the next round (with no score the lead alternates). A rematch swaps colours.
//
// Physics live in public/games/shuffleboard/sim.js, shared verbatim with the browser: the client
// sends a shot input { x, aim, power }, the server simulates it against the resting pucks
// (authoritative) and broadcasts the input, the 30 fps frames and the result. Shots are accepted
// only once the previous one has finished playing (`busyUntil`).

'use strict';

const Sim = require('../../public/games/shuffleboard/sim.js');
const { setBotLevel, botLevelOf } = require('./ai/levels');
const { reportDuel } = require('./duelResult');

const TYPE = 'shuffleboard';
const BOT = 'BOT';
const COLORS = ['red', 'blue'];
const TARGETS = [15, 21];
// Pause after the pucks stop / extra pause to read the round tally; bot "lining up" delay.
// Tests shrink these via _internal.timing.
const timing = { min: 650, max: 1300, after: 700, tally: 2600 };

const opponent = (c) => (c === 'red' ? 'blue' : 'red');

function newRound(st, lead) {
  st.pucks = [];
  st.lead = lead;
  st.turn = lead;
  st.left = { red: Sim.PUCKS_PER_ROUND, blue: Sim.PUCKS_PER_ROUND };
}

function resetGame(st) {
  st.scores = { red: 0, blue: 0 };
  st.round = 1;
  st.winner = null;
  st.lastShot = null;
  st.shotSeq = 0;
  st.nextId = 1;
  st.busyUntil = 0;
  st.history = []; // [{ round, scorer, points }]
  st.stats = { red: { shots: 0, knockoffs: 0, hangers: 0 }, blue: { shots: 0, knockoffs: 0, hangers: 0 } };
  st.gameId = (st.gameId || 0) + 1;
  newRound(st, 'red');
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    players: st.players,
    botLevels: st.botLevels || {},
    target: st.target,
    pucks: st.pucks,
    scores: st.scores,
    round: st.round,
    lead: st.lead,
    turn: st.turn,
    left: st.left,
    winner: st.winner,
    lastShot: st.lastShot,
    shotSeq: st.shotSeq,
    nextId: st.nextId,
    busyUntil: st.busyUntil,
    history: st.history,
    stats: st.stats,
    gameId: st.gameId,
    serverNow: Date.now(),
  };
}

function broadcastState(room) {
  reportDuel(room); // no-op unless a game just ended
  room.broadcast({ v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'state', ...buildPublicState(room) } } });
}

function seatOf(st, clientId) {
  return st.players.red === clientId ? 'red' : st.players.blue === clientId ? 'blue' : null;
}

// Validated shot by `color`. Returns the shot record or null.
function applyShot(st, color, rawInput, now) {
  if (st.left[color] <= 0) return null;
  const before = st.pucks.map((p) => ({ ...p }));
  const shotId = st.nextId;
  const res = Sim.simulate(before, rawInput, color, shotId);
  if (!res) return null;
  st.nextId++;
  st.shotSeq++;
  st.left[color]--;
  st.stats[color].shots++;
  for (const r of res.removed) if (r.owner !== color && r.why !== 'short') st.stats[color].knockoffs++;
  const rec = {
    seq: st.shotSeq,
    by: color,
    round: st.round,
    shotId,
    input: res.input,
    order: res.order,
    owners: res.owners,
    frames: res.frames,
    events: res.events,
    before,
    after: res.after,
    removed: res.removed,
    roundEnd: null,
  };
  st.pucks = res.after;
  let busy = Math.round(res.frames.length * Sim.FRAME_MS) + timing.after;
  if (st.left.red === 0 && st.left.blue === 0) {
    const sc = Sim.scoreRound(st.pucks);
    for (const c of sc.counted) if (c.value === 4) st.stats[sc.scorer].hangers++;
    if (sc.scorer) st.scores[sc.scorer] += sc.points;
    rec.roundEnd = { scorer: sc.scorer, points: sc.points, counted: sc.counted, leader: sc.leader || null, scores: { ...st.scores } };
    st.history.push({ round: st.round, scorer: sc.scorer, points: sc.points });
    const win = COLORS.find((c) => st.scores[c] >= st.target);
    if (win) {
      st.phase = 'game_over';
      st.winner = win;
    } else {
      st.round++;
      newRound(st, sc.scorer || opponent(st.lead));
    }
    busy += timing.tally;
  } else {
    const o = opponent(color);
    st.turn = st.left[o] > 0 ? o : color;
  }
  st.lastShot = rec;
  st.busyUntil = now + busy;
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
    let input;
    try {
      input = Sim.botShot(st.pucks, turn, botLevelOf(st, turn), { left: st.left });
    } catch (e) {
      input = { x: 0, aim: 0, power: Sim.powerFor(92) }; // never stall the game
    }
    if (!applyShot(st, turn, input, Date.now())) return;
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
  stats: { rated: true },

  createInitialState() {
    const st = { phase: 'waiting', players: { red: null, blue: null }, botLevels: {}, target: 15 };
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

    if (data.kind === 'setTarget') {
      if (st.phase === 'playing') return;
      if (!seatOf(st, me) && st.players.red && st.players.blue) return;
      const t = Number(data.target);
      if (!TARGETS.includes(t)) return;
      st.target = t;
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

    if (data.kind === 'shoot') {
      if (st.phase !== 'playing') return reject('not_playing');
      const seat = seatOf(st, me);
      if (!seat || seat !== st.turn) return reject('not_your_turn');
      const now = Date.now();
      if (now < st.busyUntil - 150) return reject('busy'); // small grace for clock jitter
      if (!applyShot(st, seat, { x: data.x, aim: data.aim, power: data.power }, now)) return reject('invalid');
      broadcastState(room);
      maybeScheduleBot(room);
    }
  },

  _internal: { timing, applyShot, resetGame, newRound },
};
