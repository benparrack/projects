// Pool — 8-Ball (solids/stripes, pot your group then the 8) and 9-Ball (always hit the lowest ball
// first; whoever legally pots the 9 wins). Two seats { p1, p2 }; either can be a bot.
//
// Shots are simulated here, authoritatively, with the shared deterministic physics in
// public/games/pool/sim.js. The state carries the table before the shot plus the shot input
// (`lastShot`), and every client re-runs the same sim to animate it — the result matches exactly,
// and `balls` (the table after the shot) is always the source of truth.
//
// Casual rules: no called pockets, no push-out, no three-foul rule. Any foul (scratch, no ball
// hit, wrong ball first, no cushion after contact when nothing drops) gives the opponent ball in
// hand anywhere. The break is played from behind the head string; 8-Ball: an 8 on the break is
// re-spotted and the table stays open; groups are set by the first ball legally potted after it.
// Potting the 8 early or on a foul loses. 9-Ball: a 9 potted on the break or on a foul is re-spotted (breaker
// keeps shooting if it was a clean break).
//
// Bots (Easy..Expert) run in a worker thread (this same file): they generate ghost-ball shots at
// every legal ball/pocket pair (placing the cue ball first when they have ball in hand), simulate
// each at a few powers (Expert also tries spin), score the outcome with the real rules, then play
// the best one with aim/power noise that shrinks with the level.

'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const Sim = require('../../public/games/pool/sim.js');
const { setBotLevel, botLevelOf } = require('./ai/levels');

const TYPE = 'pool';
const BOT = 'BOT';
const SEATS = ['p1', 'p2'];
const MODES = ['8ball', '9ball'];
const { R, L, W, HEAD_X, POCKETS } = Sim;
// Bot pacing (tests shrink it via _internal.timing): wait for the shot animation, then "think".
const timing = { think: 900, perStepMs: 1000 / 480 };

const other = (s) => (s === 'p1' ? 'p2' : 'p1');
const groupOf = (n) => (n >= 1 && n <= 7 ? 'solids' : n >= 9 && n <= 15 ? 'stripes' : null);

function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 8-Ball: 8 in the middle of the third row, one solid and one stripe on the back corners.
function rack8() {
  const order = new Array(15).fill(0);
  order[4] = 8;
  const solid = 1 + Math.floor(Math.random() * 7);
  const stripe = 9 + Math.floor(Math.random() * 7);
  const [c1, c2] = Math.random() < 0.5 ? [solid, stripe] : [stripe, solid];
  order[10] = c1;
  order[14] = c2;
  const rest = shuffle([1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15].filter((n) => n !== solid && n !== stripe));
  for (let i = 0; i < 15; i++) if (!order[i]) order[i] = rest.pop();
  return Sim.rack(order, Sim.RACK8);
}

// 9-Ball: diamond with the 1 on the apex and the 9 in the middle.
function rack9() {
  const order = new Array(9).fill(0);
  order[0] = 1;
  order[4] = 9;
  const rest = shuffle([2, 3, 4, 5, 6, 7, 8]);
  for (let i = 0; i < 9; i++) if (!order[i]) order[i] = rest.pop();
  return Sim.rack(order, Sim.RACK9);
}

const cloneBalls = (balls) => balls.map((b) => ({ n: b.n, x: b.x, y: b.y }));

// Somewhere legal to put the cue ball for display after a scratch (the shooter can move it).
function defaultCueSpot(balls, kitchen) {
  const tries = [[HEAD_X - 20, W / 2]];
  for (let x = HEAD_X - 20; x > R; x -= 6) for (let y = W / 2; y > R && y < W - R; y += (y >= W / 2 ? 6 : -6)) tries.push([x, y]);
  for (let x = R + 1; x < L - R; x += 5) for (let y = R + 1; y < W - R; y += 5) tries.push([x, y]);
  const rest = balls.filter((b) => b.n !== 0);
  for (const [x, y] of tries) if (Sim.validCueSpot(rest, x, y, kitchen)) return { x, y };
  return { x: R + 1, y: R + 1 };
}

function newRack(st) {
  st.balls = st.mode === '9ball' ? rack9() : rack8();
  st.turn = st.breaker;
  st.groups = { p1: null, p2: null };
  st.ballInHand = true;
  st.kitchen = true;
  st.breakShot = true;
  st.lastShot = null;
  st.winner = null;
  st.winReason = null;
  st.gameId = (st.gameId || 0) + 1;
}

// Applies a validated shot to `st` (also used on clones by the bot). Returns the result summary.
function applyShot(st, seat, shot, cuePos) {
  const opp = other(seat);
  if (st.ballInHand && cuePos) {
    const cue = st.balls.find((b) => b.n === 0);
    cue.x = cuePos.x;
    cue.y = cuePos.y;
  }
  const start = cloneBalls(st.balls);
  const res = Sim.simulate(start, shot);
  const pots = res.summary.pots.map((p) => p.n);
  const scratch = pots.includes(0);
  const obj = pots.filter((n) => n !== 0);
  const first = res.summary.firstHit;
  const wasBreak = st.breakShot;
  let balls = res.balls;
  let foul = null;
  let keep = false;
  let winner = null;
  let winReason = null;
  const notes = [];

  if (scratch) foul = 'scratch';
  else if (first === null) foul = 'no_hit';

  if (st.mode === '9ball') {
    const lowest = Math.min(...start.filter((b) => b.n !== 0).map((b) => b.n));
    if (!foul && first !== lowest) foul = 'wrong_ball';
    if (!foul && !wasBreak && !res.summary.railAfterContact && !obj.length) foul = 'no_rail';
    if (obj.includes(9)) {
      if (foul || wasBreak) {
        Sim.spotBall(balls, 9);
        notes.push(wasBreak ? '9 on the break — re-spotted' : '9 re-spotted');
      } else {
        winner = seat;
        winReason = 'nine';
      }
    }
    if (!winner && !foul) keep = obj.length > 0;
  } else {
    const mine = st.groups[seat];
    const ownLeftAtStart = mine ? start.filter((b) => groupOf(b.n) === mine).length : null;
    const onEight = !!mine && ownLeftAtStart === 0;
    if (!foul && !wasBreak) {
      if (mine) { if (onEight ? first !== 8 : groupOf(first) !== mine) foul = 'wrong_ball'; }
      else if (first === 8) foul = 'wrong_ball';
    }
    if (!foul && !wasBreak && !res.summary.railAfterContact && !obj.length) foul = 'no_rail';
    const objNo8 = obj.filter((n) => n !== 8);
    if (obj.includes(8)) {
      if (wasBreak) {
        Sim.spotBall(balls, 8);
        notes.push('8 on the break — re-spotted');
      } else if (!foul && onEight) {
        winner = seat;
        winReason = 'eight';
      } else {
        winner = opp;
        winReason = foul ? 'eight_foul' : 'eight_early';
      }
    }
    if (!winner && !foul) {
      if (!mine && !wasBreak && objNo8.length) {
        const g = groupOf(objNo8[0]);
        st.groups[seat] = g;
        st.groups[opp] = g === 'solids' ? 'stripes' : 'solids';
        notes.push(`groups set: ${g}`);
      }
      const now = st.groups[seat];
      keep = wasBreak || !now ? objNo8.length > 0 : objNo8.some((n) => groupOf(n) === now);
    }
  }

  // a scratched cue ball comes back where the next shooter can move it from
  if (scratch) balls = balls.concat([{ n: 0, ...defaultCueSpot(balls, false) }]);
  balls.sort((a, b) => a.n - b.n);
  st.balls = balls;
  st.breakShot = false;
  st.kitchen = false;
  if (winner) {
    st.winner = winner;
    st.winReason = winReason;
    st.phase = 'game_over';
    st.ballInHand = false;
  } else if (foul) {
    st.turn = opp;
    st.ballInHand = true;
  } else {
    st.turn = keep ? seat : opp;
    st.ballInHand = false;
  }
  return { start, pots, first, foul, keep, winner, winReason, notes, steps: res.summary.steps };
}

// ---- bot ------------------------------------------------------------------------------------

const LEVEL_CFG = {
  easy: { aim: 0.03, power: 0.16, pick: 4, cands: 6, powers: [0.35, 0.6], spins: [0], lookahead: false },
  medium: { aim: 0.012, power: 0.08, pick: 2, cands: 8, powers: [0.3, 0.5, 0.75], spins: [0], lookahead: false },
  hard: { aim: 0.005, power: 0.04, pick: 1, cands: 10, powers: [0.25, 0.4, 0.6, 0.85], spins: [0, -0.6], lookahead: true },
  expert: { aim: 0.0018, power: 0.02, pick: 1, cands: 12, powers: [0.22, 0.35, 0.5, 0.7, 0.9], spins: [0, -0.6, 0.6], lookahead: true },
};

// Ball numbers this seat may legally hit first.
function legalTargets(st, seat) {
  const objs = st.balls.filter((b) => b.n !== 0).map((b) => b.n);
  if (st.mode === '9ball') return [Math.min(...objs)];
  const mine = st.groups[seat];
  if (!mine) return objs.filter((n) => n !== 8);
  const own = objs.filter((n) => groupOf(n) === mine);
  return own.length ? own : [8];
}

function segClear(balls, ax, ay, bx, by, skip, rad) {
  const sx = bx - ax;
  const sy = by - ay;
  const len2 = sx * sx + sy * sy || 1;
  for (const b of balls) {
    if (skip.includes(b.n)) continue;
    let u = ((b.x - ax) * sx + (b.y - ay) * sy) / len2;
    u = Math.max(0, Math.min(1, u));
    const dx = ax + sx * u - b.x;
    const dy = ay + sy * u - b.y;
    if (dx * dx + dy * dy < rad * rad) return false;
  }
  return true;
}

// Ghost-ball pot candidates from cue position (cx, cy): [{ t, pocket, dx, dy, q }] best first.
function potCandidates(balls, targets, cx, cy) {
  const out = [];
  for (const n of targets) {
    const t = balls.find((b) => b.n === n);
    if (!t) continue;
    for (let p = 0; p < POCKETS.length; p++) {
      const pk = POCKETS[p];
      let px = pk.aimX - t.x;
      let py = pk.aimY - t.y;
      const pd = Math.sqrt(px * px + py * py);
      if (pd < 1) continue;
      px /= pd;
      py /= pd;
      // side pockets refuse very shallow approaches
      if ((p === 1 || p === 4) && Math.abs(py) < 0.35) continue;
      const gx = t.x - px * 2 * R;
      const gy = t.y - py * 2 * R;
      let dx = gx - cx;
      let dy = gy - cy;
      const cd = Math.sqrt(dx * dx + dy * dy);
      if (cd < 0.5) continue;
      dx /= cd;
      dy /= cd;
      const cut = dx * px + dy * py;
      if (cut < 0.26) continue;
      if (!segClear(balls, cx, cy, gx, gy, [0, n], 2 * R - 0.05)) continue;
      if (!segClear(balls, t.x, t.y, pk.aimX, pk.aimY, [0, n], 2 * R - 0.05)) continue;
      const q = cut * cut / (1 + (cd + pd) / 180);
      out.push({ t: n, pocket: p, dx, dy, q, dist: cd + pd, cut });
    }
  }
  return out.sort((a, b) => b.q - a.q);
}

// How good the position is for `seat` to shoot next (best easy pot quality).
function positionValue(st, seat) {
  const cue = st.balls.find((b) => b.n === 0);
  if (!cue) return 0;
  const c = potCandidates(st.balls, legalTargets(st, seat), cue.x, cue.y);
  return c.length ? c[0].q : 0;
}

function cloneState(st) {
  return { ...st, balls: cloneBalls(st.balls), groups: { ...st.groups } };
}

function scoreOutcome(st, seat, after, res, lookahead) {
  if (res.winner) return res.winner === seat ? 10000 : -10000;
  let v = 0;
  if (res.foul) v -= 150;
  if (after.turn === seat) {
    v += 200;
    if (lookahead) v += 120 * positionValue(after, seat);
  } else if (!res.foul && lookahead) {
    v -= 60 * positionValue(after, other(seat));
  }
  // 8-ball: every own ball off the table is progress, every opponent ball potted helps them
  if (st.mode === '8ball') {
    const mine = after.groups[seat];
    for (const n of res.pots) {
      if (!groupOf(n)) continue;
      if (!mine || groupOf(n) === mine) v += 25; else v -= 15;
    }
  } else {
    v += 10 * res.pots.filter((n) => n !== 0).length;
  }
  return v;
}

// Candidate cue placements for ball in hand: straight behind each pot line.
function cuePlacements(st, seat) {
  const balls = st.balls.filter((b) => b.n !== 0);
  const spots = [];
  for (const n of legalTargets(st, seat)) {
    const t = balls.find((b) => b.n === n);
    for (const pk of POCKETS) {
      let px = pk.aimX - t.x;
      let py = pk.aimY - t.y;
      const pd = Math.sqrt(px * px + py * py);
      px /= pd;
      py /= pd;
      for (const back of [18, 32, 48]) {
        for (const off of [0, 0.25, -0.25]) {
          // a little off-straight leaves a natural angle for position
          const bx = -px + -py * off;
          const by = -py + px * off;
          const bm = Math.sqrt(bx * bx + by * by);
          const x = t.x - px * 2 * R + (bx / bm) * back;
          const y = t.y - py * 2 * R + (by / bm) * back;
          if (Sim.validCueSpot(balls, x, y, st.kitchen)) spots.push({ x, y });
        }
      }
    }
  }
  if (!spots.length) spots.push(defaultCueSpot(st.balls, st.kitchen));
  return spots;
}

function gauss(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// Picks a shot for `seat`: returns { shot: { dx, dy, power, spinX, spinY }, cue: {x,y}|null }.
function chooseBotShot(st, seat, level, rand = Math.random) {
  const cfg = LEVEL_CFG[level] || LEVEL_CFG.hard;
  const cue0 = st.balls.find((b) => b.n === 0);

  if (st.breakShot) {
    // break from off-centre (like a real side break) so the rack spreads differently each time
    const side = (rand() < 0.5 ? -1 : 1) * (15 + rand() * 20);
    const cue = st.ballInHand ? { x: HEAD_X - 22, y: W / 2 + side } : { x: cue0.x, y: cue0.y };
    const apex = { x: Sim.FOOT.x, y: Sim.FOOT.y };
    const aimOff = (rand() - 0.5) * 1.2;
    const shot = { dx: apex.x - cue.x, dy: apex.y + aimOff - cue.y, power: level === 'easy' ? 0.8 : 0.95 + rand() * 0.05, spinX: 0, spinY: 0 };
    return { shot, cue: st.ballInHand ? cue : null };
  }

  const placements = st.ballInHand ? cuePlacements(st, seat) : [{ x: cue0.x, y: cue0.y }];
  const targets = legalTargets(st, seat);
  let pool = [];
  for (const pos of placements) {
    for (const c of potCandidates(st.balls, targets, pos.x, pos.y)) pool.push({ ...c, cue: pos });
  }
  pool.sort((a, b) => b.q - a.q);
  pool = pool.slice(0, cfg.cands);

  const tried = [];
  const evalShot = (cue, shot) => {
    const clone = cloneState(st);
    const res = applyShot(clone, seat, shot, st.ballInHand ? cue : null);
    return scoreOutcome(st, seat, clone, res, cfg.lookahead);
  };
  for (const c of pool) {
    // a rough power floor so the object ball can reach the pocket, then the level's ladder
    for (const p of cfg.powers) {
      for (const s of cfg.spins) {
        const shot = { dx: c.dx, dy: c.dy, power: p, spinX: 0, spinY: s };
        tried.push({ cue: c.cue, shot, v: evalShot(c.cue, shot) + c.q * 20 });
      }
    }
  }
  // Safeties / fallbacks: hit each legal ball full at a few speeds.
  if (!tried.length || tried.every((t) => t.v < 100)) {
    for (const pos of placements.slice(0, 4)) {
      for (const n of targets) {
        const t = st.balls.find((b) => b.n === n);
        if (!t) continue;
        for (const off of [0, R * 0.9, -R * 0.9]) {
          let dx = t.x - pos.x;
          let dy = t.y - pos.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          dx /= d;
          dy /= d;
          const shot = { dx: dx * d - dy * off, dy: dy * d + dx * off, power: 0.3, spinX: 0, spinY: 0 };
          for (const p of [0.25, 0.45]) {
            const s2 = { ...shot, power: p };
            tried.push({ cue: pos, shot: s2, v: evalShot(pos, s2) });
          }
        }
      }
    }
  }
  if (!tried.length) {
    const shot = { dx: rand() - 0.5, dy: rand() - 0.5, power: 0.4, spinX: 0, spinY: 0 };
    return { shot, cue: st.ballInHand ? placements[0] : null };
  }
  tried.sort((a, b) => b.v - a.v);
  const pick = tried[Math.floor(rand() * Math.min(cfg.pick, tried.length))];
  // execution noise
  const ang = gauss(rand) * cfg.aim;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const m = Math.sqrt(pick.shot.dx * pick.shot.dx + pick.shot.dy * pick.shot.dy);
  const ux = pick.shot.dx / m;
  const uy = pick.shot.dy / m;
  const power = Math.max(Sim.MIN_POWER, Math.min(1, pick.shot.power * (1 + gauss(rand) * cfg.power)));
  return {
    shot: { dx: ux * ca - uy * sa, dy: ux * sa + uy * ca, power, spinX: pick.shot.spinX, spinY: pick.shot.spinY },
    cue: st.ballInHand ? pick.cue : null,
  };
}

// Worker side: same file, so the rules and the sim are exactly the server's.
if (!isMainThread && workerData && workerData.poolWorker) {
  parentPort.on('message', ({ id, st, seat, level }) => {
    try { parentPort.postMessage({ id, result: chooseBotShot(st, seat, level) }); }
    catch (err) { parentPort.postMessage({ id, error: String((err && err.stack) || err) }); }
  });
}

let worker = null;
let nextReq = 1;
const pendingReq = new Map();
function botThink(input) {
  return new Promise((resolve, reject) => {
    if (!worker) {
      worker = new Worker(__filename, { workerData: { poolWorker: true } });
      worker.unref();
      worker.on('message', ({ id, result, error }) => {
        const p = pendingReq.get(id);
        if (!p) return;
        pendingReq.delete(id);
        if (error) p.reject(new Error(error)); else p.resolve(result);
      });
      const fail = (err) => {
        worker = null;
        for (const p of pendingReq.values()) p.reject(err || new Error('pool worker exited'));
        pendingReq.clear();
      };
      worker.on('error', fail);
      worker.on('exit', () => fail());
    }
    const id = nextReq++;
    pendingReq.set(id, { resolve, reject });
    worker.postMessage({ id, ...input });
  });
}

// ---- room plugin ----------------------------------------------------------------------------

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    mode: st.mode,
    players: st.players,
    botLevels: st.botLevels || {},
    balls: st.balls,
    turn: st.turn,
    groups: st.groups,
    ballInHand: st.ballInHand,
    kitchen: st.kitchen,
    breakShot: st.breakShot,
    breaker: st.breaker,
    shotNo: st.shotNo,
    lastShot: st.lastShot,
    winner: st.winner,
    winReason: st.winReason,
    score: st.score,
    gameId: st.gameId,
  };
}

function broadcastState(room) {
  room.broadcast({ v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'state', ...buildPublicState(room) } } });
}

function seatOf(st, clientId) {
  return SEATS.find((s) => st.players[s] === clientId) || null;
}

function resetTable(st, { clearScore } = {}) {
  if (clearScore) st.score = { p1: 0, p2: 0 };
  newRack(st);
  st.phase = st.players.p1 && st.players.p2 ? 'playing' : 'waiting';
}

function doShot(room, seat, rawShot, cuePos) {
  const st = room.state;
  const shot = Sim.normShot(rawShot);
  if (!shot) return 'invalid';
  let cue = null;
  if (st.ballInHand && cuePos && typeof cuePos === 'object') {
    cue = { x: Number(cuePos.x), y: Number(cuePos.y) };
    const rest = st.balls.filter((b) => b.n !== 0);
    if (!Sim.validCueSpot(rest, cue.x, cue.y, st.kitchen)) return 'bad_spot';
  }
  const res = applyShot(st, seat, shot, cue);
  st.shotNo++;
  st.lastShot = {
    shotNo: st.shotNo,
    by: seat,
    start: res.start,
    shot,
    pots: res.pots,
    first: res.first,
    foul: res.foul,
    keep: res.keep,
    notes: res.notes,
    steps: res.steps,
    groups: { ...st.groups },
  };
  if (st.winner) st.score[st.winner]++;
  return null;
}

function maybeScheduleBot(room, afterSteps = 0) {
  const st = room.state;
  if (st.phase !== 'playing' || st.players[st.turn] !== BOT) return;
  const seat = st.turn;
  const key = `${st.gameId}:${st.shotNo}`;
  const stillValid = () => room.state === st && st.phase === 'playing' && `${st.gameId}:${st.shotNo}` === key
    && st.turn === seat && st.players[seat] === BOT;
  const started = Date.now();
  const wait = afterSteps * timing.perStepMs + timing.think;
  const input = { st: { ...st, players: undefined, lastShot: null }, seat, level: botLevelOf(st, seat) };
  const finish = (pick) => {
    if (!stillValid()) return;
    let err = pick ? doShot(room, seat, pick.shot, pick.cue) : 'invalid';
    if (err) {
      // never stall: fall back to a plain shot at a legal ball from wherever the cue sits
      const cue = st.balls.find((b) => b.n === 0);
      const t = st.balls.find((b) => b.n === legalTargets(st, seat)[0]);
      err = doShot(room, seat, { dx: t.x - cue.x, dy: t.y - cue.y, power: 0.4 }, null);
      if (err) return;
    }
    broadcastState(room);
    maybeScheduleBot(room, st.lastShot ? st.lastShot.steps : 0);
  };
  botThink(input).then(
    (pick) => setTimeout(() => finish(pick), Math.max(0, wait - (Date.now() - started))),
    () => setTimeout(() => finish(null), Math.max(0, wait - (Date.now() - started))),
  );
}

module.exports = {
  type: TYPE,

  createInitialState() {
    const st = {
      phase: 'waiting', mode: '8ball', players: { p1: null, p2: null }, botLevels: {},
      breaker: 'p1', shotNo: 0, score: { p1: 0, p2: 0 },
    };
    newRack(st);
    return st;
  },

  isRoomFull(room) {
    return room.clients.size >= 12; // two seats, everyone else spectates
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  onLeave(room, client) {
    const st = room.state;
    const seat = seatOf(st, client.clientId);
    if (!seat) return;
    st.players[seat] = null;
    resetTable(st, { clearScore: true });
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
      resetTable(st, { clearScore: true });
      broadcastState(room);
      maybeScheduleBot(room);
      return;
    }

    if (data.kind === 'leaveSeat') {
      const seat = seatOf(st, me);
      if (!seat) return;
      st.players[seat] = null;
      resetTable(st, { clearScore: true });
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
      resetTable(st, { clearScore: true });
      broadcastState(room);
      return;
    }

    if (data.kind === 'setMode') {
      // Only between games; a seated player (or anyone at an empty table) may switch.
      if (!MODES.includes(data.mode) || st.phase === 'playing' || data.mode === st.mode) return;
      if (!seatOf(st, me) && (st.players.p1 || st.players.p2)) return;
      st.mode = data.mode;
      newRack(st);
      broadcastState(room);
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over' || !seatOf(st, me)) return;
      st.breaker = other(st.breaker); // alternate breaks
      resetTable(st);
      broadcastState(room);
      maybeScheduleBot(room);
      return;
    }

    if (data.kind === 'aim') {
      // Live cue preview for the other player and spectators (not stored).
      const seat = seatOf(st, me);
      if (st.phase !== 'playing' || seat !== st.turn) return;
      const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 1000) / 1000 : 0);
      const aim = { kind: 'aim', seat, shotNo: st.shotNo, dx: num(data.dx), dy: num(data.dy), power: num(data.power) };
      if (st.ballInHand && data.cue && typeof data.cue === 'object') aim.cue = { x: num(data.cue.x), y: num(data.cue.y) };
      room.broadcast({ v: 1, type: 'game.event', payload: { gameType: TYPE, data: aim } }, me);
      return;
    }

    if (data.kind === 'shoot') {
      if (st.phase !== 'playing') return reject('not_playing');
      const seat = seatOf(st, me);
      if (!seat || seat !== st.turn) return reject('not_your_turn');
      const err = doShot(room, seat, data, data.cue);
      if (err) return reject(err);
      broadcastState(room);
      maybeScheduleBot(room, st.lastShot.steps);
    }
  },

  _internal: { timing, applyShot, chooseBotShot, legalTargets, potCandidates, newRack, rack8, rack9, groupOf, defaultCueSpot },
};
