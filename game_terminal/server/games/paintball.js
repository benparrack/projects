// Paintball (GamePigeon style) — a shooting-gallery duel. Two seats, red and blue. Each player in
// turn plays one timed run (45 s) through the same gallery: cardboard bandits pop up from behind
// three rows of barricades or slide along them, civilians mixed in (hitting one costs points), a
// few golden stars zip by. Limited clip, manual reload. Highest score after both runs wins.
//
// The target schedule is a pure function of the game's seed (public/games/paintball/sim.js,
// shared verbatim with the browser), so both runs face exactly the same targets. During a run the
// shooter's client sends each shot { t, x, y } / reload { t } as it happens (t = ms into the run
// by the synced server clock); the server checks it against its own clock (no shots from the
// future, nothing older than the lag allowance), replays it through the shared gun rules (clip,
// reload time, max fire rate) and scores it against the schedule. Accepted events are broadcast
// so spectators watch the run live. Bots plan their whole run up front on the same schedule and
// their events are released by the tick as they come due.

'use strict';

const Sim = require('../../public/games/paintball/sim.js');
const { setBotLevel, botLevelOf } = require('./ai/levels');
const { reportDuel } = require('./duelResult');

const TYPE = 'paintball';
const BOT = 'BOT';
const COLORS = ['red', 'blue'];
// Tests swap `now` for a fake clock.
const timing = {
  countdown: 3000, // 3-2-1 before the run's clock starts
  botPause: 1800, // bot "steps up to the counter" before its countdown
  readyMs: 30000, // a human who never presses START is started anyway
  endGrace: 1200, // late shots (network lag) are still accepted this long after time's up
  lagBack: 2500, // oldest a shot's timestamp may be relative to the server's run clock
  lagAhead: 300, // clock-skew allowance for shots stamped slightly in the server's future
  now: () => Date.now(),
};

const opponent = (c) => (c === 'red' ? 'blue' : 'red');
const blankStats = () => ({ shots: 0, hits: 0, heads: 0, civs: 0, golds: 0, reloads: 0 });

function resetGame(st) {
  st.seed = (Math.random() * 0x7fffffff) >>> 0;
  st.scores = { red: null, blue: null };
  st.stats = { red: blankStats(), blue: blankStats() };
  st.turn = null;
  st.runStart = null;
  st.readyDeadline = null;
  st.run = null; // { seat, events: [{ type, t, x, y, hit, pts, head }] }
  st.runSeq = (st.runSeq || 0) + 1;
  st.winner = null;
  st.gameId = (st.gameId || 0) + 1;
  st.priv = { sim: null, plan: null, planIdx: 0 };
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    players: st.players,
    botLevels: st.botLevels || {},
    seed: st.seed,
    turn: st.turn,
    runStart: st.runStart,
    readyDeadline: st.readyDeadline,
    runSeq: st.runSeq,
    run: st.run,
    score: st.priv && st.priv.sim ? st.priv.sim.score : 0,
    scores: st.scores,
    stats: st.stats,
    winner: st.winner,
    gameId: st.gameId,
    runMs: Sim.RUN_MS,
    serverNow: timing.now(),
  };
}

const envelope = (data) => ({ v: 1, type: 'game.event', payload: { gameType: TYPE, data } });
function broadcastState(room) {
  reportDuel(room, (s) => room.state.scores[s]); // no-op unless a game just ended
  room.broadcast(envelope({ kind: 'state', ...buildPublicState(room) }));
}

function seatOf(st, clientId) {
  return st.players.red === clientId ? 'red' : st.players.blue === clientId ? 'blue' : null;
}

// The next seat steps up: a human gets a READY prompt, a bot starts after a short pause.
function beginTurn(st, seat, now) {
  st.turn = seat;
  st.runSeq++;
  st.run = { seat, events: [] };
  st.priv.sim = Sim.newRun(st.seed);
  st.priv.plan = null;
  st.priv.planIdx = 0;
  if (st.players[seat] === BOT) {
    st.priv.plan = Sim.botPlan(st.seed, botLevelOf(st, seat), Math.random);
    st.runStart = now + timing.botPause + timing.countdown;
    st.readyDeadline = null;
  } else {
    st.runStart = null;
    st.readyDeadline = now + timing.readyMs;
  }
}

function startRun(st, now) {
  st.runStart = now + timing.countdown;
  st.readyDeadline = null;
}

function finishRun(st) {
  const seat = st.turn;
  const sim = st.priv.sim;
  st.scores[seat] = sim.score;
  st.stats[seat] = { ...sim.stats };
  const other = opponent(seat);
  if (st.scores[other] == null) {
    beginTurn(st, other, timing.now());
    return;
  }
  st.phase = 'game_over';
  st.turn = null;
  st.runStart = null;
  st.readyDeadline = null;
  st.winner = st.scores.red === st.scores.blue ? 'draw' : st.scores.red > st.scores.blue ? 'red' : 'blue';
}

// Validates one event from the seat on turn against the server's run clock and the gun rules.
// Returns { ok, rec } or { ok: false, reason }.
function applyRunEvent(st, raw, now, trusted) {
  if (st.phase !== 'playing' || !st.run) return { ok: false, reason: 'not_playing' };
  if (st.runStart == null) return { ok: false, reason: 'not_started' };
  const elapsed = now - st.runStart;
  if (elapsed < 0) return { ok: false, reason: 'not_started' };
  const ev = Sim.normEvent(raw);
  if (!ev) return { ok: false, reason: 'invalid' };
  if (!trusted && (ev.t > elapsed + timing.lagAhead || ev.t < elapsed - timing.lagBack)) return { ok: false, reason: 'bad_time' };
  const r = Sim.applyEvent(st.priv.sim, ev);
  if (!r.ok) return r;
  const rec = { type: r.ev.type, t: r.ev.t };
  if (r.ev.type === 'shot') {
    rec.x = r.ev.x;
    rec.y = r.ev.y;
    if (r.res) {
      rec.hit = r.res.id;
      rec.pts = r.res.pts;
      if (r.res.head) rec.head = true;
    }
  }
  st.run.events.push(rec);
  return { ok: true, rec };
}

function broadcastEvents(room, from, events) {
  const st = room.state;
  room.broadcast(envelope({
    kind: 'shots', runSeq: st.runSeq, seat: st.run.seat, from, events, score: st.priv.sim.score, serverNow: timing.now(),
  }));
}

// Time-driven progress: auto-start an idle human, release due bot events, end the run.
function advance(room) {
  const st = room.state;
  if (st.phase !== 'playing' || !st.turn) return;
  const now = timing.now();
  if (st.runStart == null) {
    if (st.readyDeadline != null && now >= st.readyDeadline) {
      startRun(st, now);
      broadcastState(room);
    }
    return;
  }
  const elapsed = now - st.runStart;
  const { plan } = st.priv;
  if (plan && st.priv.planIdx < plan.length && elapsed >= 0) {
    const from = st.run.events.length;
    const out = [];
    while (st.priv.planIdx < plan.length && plan[st.priv.planIdx].t <= elapsed) {
      const r = applyRunEvent(st, plan[st.priv.planIdx++], now, true);
      if (r.ok) out.push(r.rec);
    }
    if (out.length) broadcastEvents(room, from, out);
  }
  if (elapsed >= Sim.RUN_MS + timing.endGrace) {
    finishRun(st);
    broadcastState(room);
  }
}

function startIfReady(st) {
  if (st.players.red && st.players.blue) {
    resetGame(st);
    st.phase = 'playing';
    beginTurn(st, 'red', timing.now());
  }
}

function vacate(st, seat) {
  st.players[seat] = null;
  st.phase = 'waiting';
  resetGame(st);
}

module.exports = {
  type: TYPE,
  stats: { rated: true, score: { label: 'Points', better: 'high', format: 'pts' } },
  tickIntervalMs: 50,

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

  tick(room) {
    try {
      advance(room);
    } catch (e) {
      // never let a bad state take the room's interval down
      console.error('[paintball] tick error', e);
    }
  },

  onLeave(room, client) {
    const st = room.state;
    const seat = seatOf(st, client.clientId);
    if (!seat) return;
    vacate(st, seat);
    broadcastState(room);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data !== 'object' || typeof data.kind !== 'string') return;
    const st = room.state;
    const me = ctx.senderId;
    const reject = (reason, extra) => ctx.sendTo(me, envelope({ kind: 'moveRejected', reason, ...extra }));
    const seatArg = COLORS.includes(data.seat) ? data.seat : null;
    advance(room); // settle anything time has already decided before handling the message

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
      resetGame(st);
      st.phase = st.players.red && st.players.blue ? 'playing' : 'waiting';
      if (st.phase === 'playing') beginTurn(st, 'red', timing.now());
      broadcastState(room);
      return;
    }

    if (data.kind === 'start') {
      if (st.phase !== 'playing') return reject('not_playing');
      const seat = seatOf(st, me);
      if (!seat || seat !== st.turn) return reject('not_your_turn');
      if (st.runStart != null) return; // already counting down / running
      startRun(st, timing.now());
      broadcastState(room);
      return;
    }

    if (data.kind === 'shot' || data.kind === 'reload') {
      const t = Number(data.t);
      const echo = Number.isFinite(t) ? { t: Math.round(t) } : {};
      if (st.phase !== 'playing') return reject('not_playing', echo);
      const seat = seatOf(st, me);
      if (!seat || seat !== st.turn) return reject('not_your_turn', echo);
      const from = st.run.events.length;
      const r = applyRunEvent(st, { type: data.kind, t: data.t, x: data.x, y: data.y }, timing.now(), false);
      if (!r.ok) return reject(r.reason, echo);
      broadcastEvents(room, from, [r.rec]);
    }
  },

  _internal: { timing, advance, beginTurn, finishRun, applyRunEvent, resetGame },
};
