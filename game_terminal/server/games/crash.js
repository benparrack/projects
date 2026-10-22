// Crash: one rocket for the whole room. Bets go in during a short countdown, then the multiplier
// climbs from 1.00x (m = e^(K t)) until the round's crash point; anyone still riding loses their
// bet, anyone who cashed out (by hand, or at their auto cash-out target) is paid bet x multiplier.
//
// Each round's crash point comes from a fresh secret seed whose sha256 is shown before any bet:
// f = the first provably fair float of HMAC(seed, 'crash:0:0'), point = floor(100 (1 - edge) / (1 - f)) / 100,
// at least 1.00 (an instant bust, about 3% of rounds). So P(point >= x) = (1 - edge) / x: cashing
// out at any target returns 98%. The seed is revealed when the round crashes.
// Client: ../../public/games/crash/client.js
'use strict';

const { kit, parseBet, payout, floats, sha256, round2, EDGE, MAX_WIN } = require('../casino/originals');
const crypto = require('crypto');

const TYPE = 'crash';
const MAX_PLAYERS = 12;
const K = 0.00006; // growth per ms: 2x at 11.6s, 10x at 38s, 100x at 77s
const BET_MS = 7000;
const CRASHED_MS = 3500;
const SOLO_CRASHED_MS = 1500;
const MAX_CRASH = 10000;
const MIN_AUTO = 1.01;
const HISTORY = 30;

const { send, broadcast, reject, settle, limits } = kit(TYPE);
let clock = () => Date.now();
let forcePoint = null; // tests

const growth = (t) => Math.floor(100 * Math.exp(K * Math.max(0, t))) / 100;
const timeFor = (m) => Math.log(m) / K;
function pointFrom(seed) {
  const f = floats(seed, 'crash', 0, 1)[0];
  return Math.min(MAX_CRASH, Math.max(1, Math.floor((100 * (1 - EDGE)) / (1 - f)) / 100));
}

function newRound(st) {
  const seed = crypto.randomBytes(32).toString('hex');
  Object.assign(st, { phase: 'betting', round: st.round + 1, phaseAt: clock(), seed, hash: sha256(seed), point: forcePoint || pointFrom(seed), bets: {} });
}

function createInitialState() {
  const st = { phase: 'betting', round: 0, phaseAt: 0, seed: null, hash: null, point: 1, bets: {}, history: [], feed: [] };
  newRound(st);
  return st;
}

function cashOut(room, id, b, mult) {
  b.out = mult;
  b.win = payout(b.bet, mult);
  settle(room, id, b.bet, b.win, mult);
}

// Advances the round to `now`; true if anything changed.
// Alone in the room it fast-forwards: launch as soon as you bet, skip to the crash once nothing is riding.
function step(room, now = clock()) {
  const st = room.state;
  const solo = room.clients.size === 1;
  if (st.phase === 'betting' && (now >= st.phaseAt + BET_MS || (solo && Object.keys(st.bets).length))) {
    st.phase = 'running';
    st.phaseAt = now;
    return true;
  }
  if (st.phase === 'running') {
    const el = now - st.phaseAt;
    let changed = false;
    for (const [id, b] of Object.entries(st.bets)) {
      if (b.out == null && b.auto && b.auto <= st.point && el >= timeFor(b.auto)) { cashOut(room, id, b, b.auto); changed = true; }
    }
    if (el >= timeFor(st.point) || (solo && !Object.values(st.bets).some((b) => b.out == null))) {
      for (const [id, b] of Object.entries(st.bets)) if (b.out == null) settle(room, id, b.bet, 0, 0);
      st.phase = 'crashed';
      st.phaseAt = now;
      st.history = [{ round: st.round, point: st.point, hash: st.hash, seed: st.seed }, ...st.history].slice(0, HISTORY);
      return true;
    }
    return changed;
  }
  if (st.phase === 'crashed' && now >= st.phaseAt + (solo ? SOLO_CRASHED_MS : CRASHED_MS)) {
    newRound(st);
    return true;
  }
  return false;
}

function bet(room, id, data) {
  const st = room.state;
  if (st.phase !== 'betting') return 'not_betting';
  if (st.bets[id]) return 'already_bet';
  const amount = parseBet(data.bet);
  let auto = data.auto == null || data.auto === '' ? null : round2(Number(data.auto));
  if (auto != null && !(auto >= MIN_AUTO && auto <= MAX_CRASH)) return 'bad_auto';
  const w = room.wallet;
  if (!w) return 'no_wallet';
  if (amount == null) return 'bad_bet';
  if (!w.ready(id)) return 'wallet_loading';
  if (w.balance(id) < amount || w.buyIn(id, amount) !== amount) return 'broke';
  // Past the payout cap there's nothing left to ride for: cash out there at the latest.
  const cap = Math.floor((MAX_WIN / amount) * 100) / 100;
  if (cap < MAX_CRASH) auto = Math.min(auto || cap, cap);
  st.bets[id] = { bet: amount, auto, out: null, win: 0 };
  return null;
}

function cancel(room, id) {
  const st = room.state;
  const b = st.bets[id];
  if (st.phase !== 'betting' || !b) return 'no_bet';
  room.wallet.cashOut(id, b.bet);
  delete st.bets[id];
  return null;
}

function manualCashout(room, id) {
  const st = room.state;
  step(room);
  const b = st.bets[id];
  if (st.phase !== 'running' || !b || b.out != null) return 'too_late';
  cashOut(room, id, b, Math.min(growth(clock() - st.phaseAt), st.point));
  return null;
}

function buildView(room) {
  const st = room.state;
  const w = room.wallet;
  const balances = {};
  if (w) for (const id of room.clients.keys()) balances[id] = w.balance(id);
  const names = {};
  for (const id of Object.keys(st.bets)) { const c = room.clients.get(id) || room.seen.get(id); names[id] = `${(c && c.nickname) || 'player'}${w && w.flair(id) ? ` ${w.flair(id)}` : ''}`; }
  const crashed = st.phase === 'crashed';
  return { kind: 'state', phase: st.phase, round: st.round, phaseAt: st.phaseAt, now: clock(), betMs: BET_MS, crashedMs: CRASHED_MS, k: K,
    hash: st.hash, point: crashed ? st.point : null, seed: crashed ? st.seed : null,
    bets: Object.entries(st.bets).map(([id, b]) => ({ id, name: names[id], ...b })), history: st.history, feed: st.feed, balances, limits: { ...limits, maxCrash: MAX_CRASH, minAuto: MIN_AUTO } };
}
const push = (room) => broadcast(room, buildView(room));

module.exports = {
  type: TYPE,
  casino: true,
  stats: { none: true },
  tickIntervalMs: 50,
  tick(room) { if (step(room)) push(room); },
  createInitialState,
  isRoomFull(room) { return room.clients.size >= MAX_PLAYERS; },
  serializeSnapshot(room) { return buildView(room); },
  onJoin(room) { step(room); push(room); },
  // Leaving takes your bet back before the launch, or cashes it out where the rocket is now.
  onLeave(room, client) {
    const id = client.clientId;
    const st = room.state;
    step(room);
    const b = st.bets[id];
    if (b && st.phase === 'betting') cancel(room, id);
    else if (b && st.phase === 'running' && b.out == null) cashOut(room, id, b, Math.min(growth(clock() - st.phaseAt), st.point));
    push(room);
  },
  onMessage(room, client, data, ctx) {
    const id = ctx.senderId;
    if (!data) return;
    const fn = { bet: () => bet(room, id, data), cancel: () => cancel(room, id), cashout: () => manualCashout(room, id) }[data.kind];
    if (!fn) return;
    const err = fn();
    if (err) { reject(room, id, err); return; }
    push(room);
  },
  _test: { growth, timeFor, pointFrom, step, K, BET_MS, CRASHED_MS, SOLO_CRASHED_MS, setClock(fn) { clock = fn; }, forcePoint(p) { forcePoint = p; } },
};
