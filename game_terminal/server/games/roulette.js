// Roulette: one shared European (single zero) wheel for everyone in the room. Betting opens with
// the room; the first chip on the felt starts a countdown, then the wheel spins for all. Each chip
// is bought in from the casino balance as it's placed and every bet settles when the ball lands.
// Client: ../../public/games/roulette/client.js
'use strict';

const crypto = require('crypto');

const TYPE = 'roulette';
const MAX_PLAYERS = 8;
const CHIPS = [1, 5, 10, 25, 50, 100, 250, 500, 1000];
const MAX_SPOT = 1000; // per spot per round
const MAX_ROUND = 2500; // per player per round
const BET_MS = 20000; // from the first chip down
const SPIN_MS = 6000;
const RESULT_MS = 4000;
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

let rng = (n) => crypto.randomInt(n);
let clock = () => Date.now();

// spot -> [does n win it, payout x bet]. Straight-ups are 'n:0'..'n:36'.
function spotRule(spot) {
  const m = /^n:(\d{1,2})$/.exec(spot);
  if (m) { const k = Number(m[1]); return k <= 36 ? [(n) => n === k, 35] : null; }
  const outside = {
    red: [(n) => REDS.has(n), 1], black: [(n) => n > 0 && !REDS.has(n), 1],
    odd: [(n) => n % 2 === 1, 1], even: [(n) => n > 0 && n % 2 === 0, 1],
    low: [(n) => n >= 1 && n <= 18, 1], high: [(n) => n >= 19, 1],
    d1: [(n) => n >= 1 && n <= 12, 2], d2: [(n) => n >= 13 && n <= 24, 2], d3: [(n) => n >= 25, 2],
    c1: [(n) => n > 0 && n % 3 === 1, 2], c2: [(n) => n > 0 && n % 3 === 2, 2], c3: [(n) => n > 0 && n % 3 === 0, 2],
  };
  return outside[spot] || null;
}

function createInitialState() {
  return { phase: 'betting', deadline: null, bets: {}, lastBets: {}, ready: {}, result: null, history: [], seq: 0 };
}

const total = (bets) => (bets || []).reduce((a, b) => a + b.amount, 0);

function placeBet(room, id, spot, amount) {
  const st = room.state;
  const w = room.wallet;
  if (!w) return 'no_wallet';
  if (st.phase !== 'betting') return 'not_betting';
  if (!spotRule(spot)) return 'bad_spot';
  if (!CHIPS.includes(amount)) return 'bad_amount';
  if (!w.ready(id)) return 'wallet_loading';
  const mine = st.bets[id] || [];
  const onSpot = mine.filter((b) => b.spot === spot).reduce((a, b) => a + b.amount, 0);
  if (onSpot + amount > MAX_SPOT) return 'spot_max';
  if (total(mine) + amount > MAX_ROUND) return 'round_max';
  if (w.balance(id) < amount || w.buyIn(id, amount) !== amount) return 'broke';
  const same = mine.find((b) => b.spot === spot);
  if (same) same.amount += amount; else mine.push({ spot, amount });
  st.bets[id] = mine;
  delete st.ready[id];
  if (st.deadline == null) st.deadline = clock() + BET_MS;
  return null;
}

function clearBets(room, id) {
  const st = room.state;
  if (st.phase !== 'betting' || !st.bets[id]) return 'nothing';
  room.wallet.cashOut(id, total(st.bets[id]));
  delete st.bets[id];
  delete st.ready[id];
  if (!Object.keys(st.bets).length) st.deadline = null;
  return null;
}

function rebet(room, id) {
  const last = room.state.lastBets[id];
  if (!last || room.state.bets[id]) return 'nothing';
  for (const b of last) {
    for (let left = b.amount; left > 0;) {
      const chip = [...CHIPS].reverse().find((c) => c <= left);
      const err = placeBet(room, id, b.spot, chip);
      if (err) return err;
      left -= chip;
    }
  }
  return null;
}

// The ball lands: settle everyone now (so leaving mid-spin can't lose a win), show it after the spin.
function spin(room, now) {
  const st = room.state;
  const n = rng(37);
  const payouts = {};
  for (const [id, bets] of Object.entries(st.bets)) {
    let won = 0;
    for (const b of bets) {
      const [wins, x] = spotRule(b.spot);
      if (wins(n)) won += b.amount * (x + 1);
    }
    const staked = total(bets);
    room.wallet.cashOut(id, won);
    room.wallet.noteBet(id, staked, won - staked);
    payouts[id] = { staked, won };
  }
  st.lastBets = st.bets;
  st.bets = {};
  st.ready = {};
  st.result = { n, payouts };
  st.phase = 'spinning';
  st.deadline = now + SPIN_MS;
}

function step(room, now) {
  const st = room.state;
  if (st.phase === 'betting') {
    const bettors = Object.keys(st.bets);
    const allReady = bettors.length && bettors.every((id) => st.ready[id]);
    if (st.deadline != null && (now >= st.deadline || allReady)) { spin(room, now); return true; }
  } else if (st.phase === 'spinning' && now >= st.deadline) {
    st.history = [st.result.n, ...st.history].slice(0, 15);
    st.phase = 'result';
    st.deadline = now + RESULT_MS;
    return true;
  } else if (st.phase === 'result' && now >= st.deadline) {
    st.phase = 'betting';
    st.deadline = null;
    st.result = null;
    return true;
  }
  return false;
}

function buildView(room) {
  const st = room.state;
  const balances = {};
  if (room.wallet) for (const id of room.clients.keys()) balances[id] = room.wallet.balance(id);
  return {
    seq: st.seq, phase: st.phase, deadline: st.deadline, now: clock(), bets: st.bets, ready: st.ready, result: st.result,
    history: st.history, balances, rebet: Object.keys(st.lastBets), chips: CHIPS, maxSpot: MAX_SPOT, maxRound: MAX_ROUND,
  };
}

function broadcast(room) {
  room.state.seq++;
  room.broadcast({ v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'state', ...buildView(room) } } });
}

module.exports = {
  type: TYPE,
  casino: true,
  stats: { none: true },
  tickIntervalMs: 250,
  tick(room) { if (step(room, clock())) broadcast(room); },
  createInitialState,
  isRoomFull(room) { return room.clients.size >= MAX_PLAYERS; },
  serializeSnapshot(room) { return buildView(room); },
  onJoin(room) { broadcast(room); },
  onLeave(room, client) {
    const st = room.state;
    if (st.bets[client.clientId]) clearBets(room, client.clientId); // betting phase only; later ones already settled
    broadcast(room);
  },
  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const id = ctx.senderId;
    let err = 'unknown';
    if (data.kind === 'bet') err = placeBet(room, id, String(data.spot), Number(data.amount));
    else if (data.kind === 'clear') err = clearBets(room, id);
    else if (data.kind === 'rebet') err = rebet(room, id);
    else if (data.kind === 'ready') err = room.state.bets[id] && room.state.phase === 'betting' ? (room.state.ready[id] = true, null) : 'nothing';
    if (err) {
      room.sendTo(id, { v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'moveRejected', reason: err } } });
      return;
    }
    step(room, clock());
    broadcast(room);
  },
  _test: { spotRule, REDS, CHIPS, BET_MS, SPIN_MS, RESULT_MS, MAX_SPOT, MAX_ROUND, step, setRng(fn) { rng = fn; }, setClock(fn) { clock = fn; } },
};
