// Slope — downhill ball run, raced by everyone in the room on the same seeded track. The track
// and physics live in public/games/slope/sim.js, shared verbatim with the browser: each client
// simulates its own ball at 60fps (so gravity, jumps and landings feel immediate) and reports its
// position; the server runs the round clock, simulates the CPU racers with the very same physics,
// and relays everyone's positions so riders see each other's ghosts.

const Sim = require('../../public/games/slope/sim.js');
const { isBotId, newBot, dropBotsIfAlone } = require('./tickBots');

const TICK_MS = 50;
const COUNTDOWN_MS = 3000;
const RESULTS_MS = 3500;
const STALE_MS = 4000; // a racing human silent this long (closed tab, asleep) is counted out
const BEST_SIZE = 8;
const BOTS_ALONE_MS = 5000; // once every human is out, bots get this long before the round ends
const COLORS = ['#39ff14', '#00eaff', '#ff2fb0', '#ffb000', '#8c52ff', '#ff4d4d', '#ffee58', '#00ffa2'];

function newSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

function playerView(p) {
  return {
    clientId: p.clientId,
    nickname: p.nickname,
    bot: p.bot || undefined,
    color: p.color,
    inRound: p.inRound,
    alive: p.alive,
    s: Math.round(p.s * 100) / 100,
    x: Math.round(p.x * 100) / 100,
    y: Math.round(p.y * 100) / 100,
    score: Math.floor(p.s),
    cause: p.cause || null,
  };
}

function buildView(st) {
  return {
    kind: 'state',
    phase: st.phase,
    seed: st.seed,
    roundId: st.roundId,
    raceStartAt: st.raceStartAt,
    phaseEndsAt: st.phaseEndsAt,
    serverNow: Date.now(),
    players: [...st.players.values()].map(playerView),
    best: st.best,
    results: st.results,
  };
}

function broadcast(room) {
  room.broadcast({ v: 1, type: 'game.event', payload: { gameType: 'slope', data: buildView(room.state) } });
}

function recordBest(st, p) {
  const score = Math.floor(p.s);
  if (score <= 0) return;
  const i = st.best.findIndex((b) => b.nickname === p.nickname);
  if (i !== -1) {
    if (st.best[i].score >= score) return;
    st.best.splice(i, 1);
  }
  st.best.push({ nickname: p.nickname, score, bot: !!p.bot });
  st.best.sort((a, b) => b.score - a.score);
  st.best.length = Math.min(st.best.length, BEST_SIZE);
}

function startCountdown(st, now) {
  st.phase = 'countdown';
  st.humansOutAt = null;
  st.seed = newSeed();
  st.roundId += 1;
  st.raceStartAt = now + COUNTDOWN_MS;
  st.phaseEndsAt = st.raceStartAt;
  st.track = Sim.makeTrack(st.seed);
  for (const p of st.players.values()) {
    const b = Sim.newBall(st.track);
    Object.assign(p, { inRound: true, alive: true, s: b.s, x: b.x, y: b.y, cause: null, lastPosAt: now, ball: p.bot ? b : null, mem: { steer: 0, hold: 0 } });
  }
}

function die(st, p, cause) {
  if (!p.alive) return;
  p.alive = false;
  p.cause = cause || 'fall';
  recordBest(st, p);
}

function endRound(st, now) {
  st.phase = 'results';
  st.phaseEndsAt = now + RESULTS_MS;
  st.results = [...st.players.values()]
    .filter((p) => p.inRound)
    .sort((a, b) => b.s - a.s)
    .map((p) => ({ nickname: p.nickname, score: Math.floor(p.s), bot: !!p.bot }));
}

module.exports = {
  type: 'slope',
  tickIntervalMs: TICK_MS,

  createInitialState() {
    return {
      phase: 'waiting',
      seed: null,
      roundId: 0,
      raceStartAt: null,
      phaseEndsAt: null,
      track: null,
      players: new Map(),
      nextColor: 0,
      best: [],
      results: null,
      tickN: 0,
    };
  },

  serializeSnapshot(room) {
    return buildView(room.state);
  },

  onJoin(room, client) {
    const st = room.state;
    st.players.set(client.clientId, {
      clientId: client.clientId,
      nickname: client.nickname,
      bot: client.bot || null,
      color: COLORS[st.nextColor++ % COLORS.length],
      inRound: false, // joins the next round; spectates the current one
      alive: false,
      s: 0, x: 0, y: 0,
      cause: null,
      lastPosAt: 0,
      ball: null,
      mem: null,
    });
  },

  onLeave(room, client) {
    room.state.players.delete(client.clientId);
    dropBotsIfAlone(room.state.players);
  },

  onMessage(room, client, data, ctx) {
    const st = room.state;
    const p = st.players.get(ctx.senderId);
    if (!p || !data || typeof data.kind !== 'string') return;

    if (data.kind === 'pos' || data.kind === 'died') {
      if (st.phase !== 'racing' || !p.inRound || !p.alive || p.bot) return;
      const now = Date.now();
      const s = Number(data.s); const x = Number(data.x); const y = Number(data.y);
      if (![s, x, y].every(Number.isFinite)) return;
      // Plausibility: nobody outruns the speed curve (generous bound; this is a party game).
      const t = (now - st.raceStartAt) / 1000;
      const maxS = 12 + t * 55;
      p.s = Math.max(p.s, Math.min(s, maxS));
      p.x = x; p.y = y;
      p.lastPosAt = now;
      if (data.kind === 'died') die(st, p, ['fall', 'block', 'wall'].includes(data.cause) ? data.cause : 'fall');
      return;
    }

    if (data.kind === 'addBot') {
      const b = newBot(st.players, data.level);
      if (!b) return;
      module.exports.onJoin(room, { clientId: b.clientId, nickname: b.nickname, bot: b.level });
      broadcast(room);
      return;
    }
    if (data.kind === 'removeBot') {
      if (!isBotId(data.clientId)) return;
      st.players.delete(data.clientId);
      broadcast(room);
    }
  },

  tick(room) {
    const st = room.state;
    const now = Date.now();
    st.tickN++;
    const humans = [...st.players.values()].filter((p) => !p.bot).length;
    const prevPhase = st.phase;

    if (st.phase === 'waiting') {
      if (humans > 0) startCountdown(st, now);
    } else if (st.phase === 'countdown') {
      if (now >= st.raceStartAt) st.phase = 'racing';
    } else if (st.phase === 'racing') {
      const t0 = (now - st.raceStartAt) / 1000;
      const steps = Math.round(TICK_MS / 1000 / Sim.DT);
      for (const p of st.players.values()) {
        if (!p.inRound || !p.alive) continue;
        if (p.bot) {
          const b = p.ball;
          for (let k = 0; k < steps && b.alive; k++) {
            const t = t0 + k * Sim.DT;
            Sim.step(st.track, b, Sim.botSteer(st.track, b, t, p.bot, p.mem), t);
          }
          p.s = b.s; p.x = b.x; p.y = b.y;
          if (!b.alive) die(st, p, b.cause);
        } else if (now - p.lastPosAt > STALE_MS) {
          die(st, p, 'fall');
        }
      }
      const live = [...st.players.values()].filter((p) => p.inRound && p.alive);
      if (live.some((p) => !p.bot)) st.humansOutAt = null;
      else if (!st.humansOutAt) st.humansOutAt = now;
      if (!live.length || (st.humansOutAt && now - st.humansOutAt > BOTS_ALONE_MS)) {
        for (const p of live) recordBest(st, p);
        endRound(st, now);
      }
    } else if (st.phase === 'results') {
      if (now >= st.phaseEndsAt) {
        if (humans > 0) startCountdown(st, now);
        else st.phase = 'waiting';
      }
    }

    // 10Hz is plenty for ghosts (clients interpolate); phase changes go out immediately.
    if (st.phase !== prevPhase || st.tickN % 2 === 0) broadcast(room);
  },
};
