// Basketball (GamePigeon style) — a 2-player shootout. Each player in turn gets a timed run
// (30 s) at a hoop seen from the front: flick up to shoot, as fast as the balls roll in. A make
// is 2 points, a swish 3; every 5th ball of the rack is the money ball (x2) and three makes in a
// row sets you ON FIRE (x2 until you miss). After 5 makes the hoop starts sliding side to side,
// after 12 it speeds up. Highest total after both runs wins; a tie goes to sudden-death overtime
// (15 s runs each, up to 3 rounds, then a draw). Red shoots first; a rematch swaps colours.
//
// Physics + run scoring live in public/games/basketball/sim.js, shared verbatim with the browser:
// the client sends { aim, power, at } (at = its release time on the run clock), the server
// clamps `at` to what it could plausibly be, simulates the shot (authoritative) and broadcasts
// the record with its trajectory frames. Several balls can be in the air at once; the hoop's
// motion schedule only ever changes after every ball already shot has landed, so no shot is
// resolved against a hoop that later moves differently.

'use strict';

const Sim = require('../../public/games/basketball/sim.js');
const { setBotLevel, botLevelOf } = require('./ai/levels');

const TYPE = 'basketball';
const BOT = 'BOT';
const COLORS = ['red', 'blue'];
const MAX_OT = 3;
const AT_BACK_MS = 1200; // how far back a client's release time may claim (latency)
const AT_AHEAD_MS = 200;
// Wall-clock pacing (tests shrink it). runMs/otMs null = the sim's RUN_MS / OT_MS.
const timing = { countdown: 3000, land: 2600, react: [450, 900], runMs: null, otMs: null };

const other = (c) => (c === 'red' ? 'blue' : 'red');

function resetGame(st) {
  st.scores = { red: 0, blue: 0 };
  st.runs = [];
  st.run = null;
  st.otRound = 0;
  st.winner = null;
  st.lastShot = null;
  st.shotSeq = 0;
  st.gameId = (st.gameId || 0) + 1;
}

function publicRun(run) {
  if (!run) return null;
  return {
    idx: run.idx, shooter: run.shooter, ot: run.ot, startAt: run.startAt, endAt: run.endAt, length: run.length,
    score: run.score, makes: run.makes, shots: run.shots, streak: run.streak, bestStreak: run.bestStreak,
    swishes: run.swishes, ballNo: run.ballNo, lastAt: run.lastAt, level: run.level, sched: run.sched,
  };
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    players: st.players,
    botLevels: st.botLevels || {},
    scores: st.scores,
    runs: st.runs,
    run: publicRun(st.run),
    otRound: st.otRound,
    winner: st.winner,
    lastShot: st.lastShot,
    shotSeq: st.shotSeq,
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

// Run idx: 0 = red, 1 = blue, then overtime pairs 2/3, 4/5, ...
function startRun(room, idx) {
  const st = room.state;
  const ot = idx >= 2;
  const length = ot ? (timing.otMs || Sim.OT_MS) : (timing.runMs || Sim.RUN_MS);
  const startAt = Date.now() + timing.countdown;
  st.run = Object.assign(Sim.newRun(length), {
    idx, shooter: COLORS[idx % 2], ot, startAt, endAt: startAt + length,
  });
  const { gameId } = st;
  const run = st.run;
  setTimeout(() => {
    if (room.state !== st || st.gameId !== gameId || st.run !== run || st.phase !== 'playing') return;
    finishRun(room);
  }, Math.max(0, run.endAt + timing.land - Date.now()));
  scheduleBot(room, Math.max(0, startAt - Date.now()) + react());
}

function finishRun(room) {
  const st = room.state;
  const run = st.run;
  st.runs.push({
    shooter: run.shooter, ot: run.ot, score: run.score, makes: run.makes, shots: run.shots,
    bestStreak: run.bestStreak, swishes: run.swishes,
  });
  if (run.idx % 2 === 0) {
    startRun(room, run.idx + 1);
  } else if (st.scores.red !== st.scores.blue) {
    st.phase = 'game_over';
    st.winner = st.scores.red > st.scores.blue ? 'red' : 'blue';
  } else if (st.otRound >= MAX_OT) {
    st.phase = 'game_over';
    st.winner = 'draw';
  } else {
    st.otRound++;
    startRun(room, run.idx + 1);
  }
  broadcastState(room);
}

const react = () => timing.react[0] + Math.random() * (timing.react[1] - timing.react[0]);

// Applies a shot by the current shooter at run time `at`. Returns the record or { error }.
function applyShot(st, input, at) {
  const run = st.run;
  const rec = Sim.shoot(run, input, at);
  if (rec.error) return rec;
  st.scores[run.shooter] += rec.points;
  st.shotSeq++;
  st.lastShot = Object.assign(rec, { seq: st.shotSeq, by: run.shooter, runIdx: run.idx });
  return rec;
}

function scheduleBot(room, delay) {
  const st = room.state;
  const run = st.run;
  if (!run || st.phase !== 'playing' || st.players[run.shooter] !== BOT) return;
  const { gameId } = st;
  setTimeout(() => {
    const s = room.state;
    if (s !== st || s.gameId !== gameId || s.run !== run || s.phase !== 'playing' || s.players[run.shooter] !== BOT) return;
    const at = Date.now() - run.startAt;
    if (at > run.length) return;
    if (at < 0 || at < run.lastAt + Sim.COOLDOWN_MS) { scheduleBot(room, Math.max(-at, run.lastAt + Sim.COOLDOWN_MS - at, 10)); return; }
    const level = botLevelOf(st, run.shooter);
    const rec = applyShot(st, Sim.botShot(run, level, at), at);
    if (!rec.error) broadcastState(room);
    scheduleBot(room, Sim.botGap(level));
  }, delay);
}

function startIfReady(room) {
  const st = room.state;
  if (st.phase === 'waiting' && st.players.red && st.players.blue) {
    resetGame(st);
    st.phase = 'playing';
    startRun(room, 0);
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
      startIfReady(room);
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

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over' || !seatOf(st, me)) return;
      st.players = { red: st.players.blue, blue: st.players.red };
      st.botLevels = { red: (st.botLevels || {}).blue, blue: (st.botLevels || {}).red };
      st.phase = 'waiting';
      resetGame(st);
      startIfReady(room);
      broadcastState(room);
      return;
    }

    if (data.kind === 'shoot') {
      if (st.phase !== 'playing' || !st.run) return reject('not_playing');
      const seat = seatOf(st, me);
      if (!seat || seat !== st.run.shooter) return reject('not_your_turn');
      if (typeof data.aim !== 'number' || typeof data.power !== 'number') return reject('invalid');
      const run = st.run;
      const serverAt = Date.now() - run.startAt;
      if (serverAt < -AT_AHEAD_MS) return reject('not_started');
      if (serverAt > run.length + AT_BACK_MS) return reject('time_up');
      const claimed = Number(data.at);
      const at = Number.isFinite(claimed)
        ? Math.round(Math.min(serverAt + AT_AHEAD_MS, Math.max(serverAt - AT_BACK_MS, claimed)))
        : Math.round(serverAt);
      const rec = applyShot(st, { aim: data.aim, power: data.power }, at);
      if (rec.error) return reject(rec.error);
      broadcastState(room);
    }
  },

  _internal: { timing, applyShot, resetGame, finishRun, MAX_OT },
};
