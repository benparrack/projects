// Slots: everyone in the room plays their own 3-reel machine, one pay line, straight from their
// casino balance (each spin is its own tiny buy-in and cash-out, so nothing sits at the table).
// Three diamonds win the site-wide progressive jackpot that every account's spins feed (wallet.js).
//
// Math (exact, see test/slots.test.js): base return 93.1% per spin, plus the jackpot on top.
// Client: ../../public/games/slots/client.js
'use strict';

const crypto = require('crypto');

const TYPE = 'slots';
const MAX_PLAYERS = 6;
const BETS = [1, 2, 5, 10];
const MAX_BET = BETS[BETS.length - 1];
const SPIN_MS = 1600; // the client's reel animation; no spinning faster than it can show
const GUEST_JACKPOT = 200; // x bet: guests play for play money, never the shared pot

// One strip, used by all three reels: symbol -> stops.
const REEL = { CH: 4, LE: 6, BE: 5, BA: 4, SE: 2, JP: 1, BL: 5 };
const STOPS = Object.entries(REEL).flatMap(([s, n]) => Array(n).fill(s));
const THREE = { CH: 10, LE: 10, BE: 20, BA: 40, SE: 100 }; // x bet
const CHERRIES = [0, 1, 3]; // x bet for one or two cherries anywhere (three is THREE.CH)

let rng = (n) => crypto.randomInt(n);
let clock = () => Date.now();

// Multiplier of the bet for a line, or 'jackpot'.
function payFor(reels) {
  const [a, b, c] = reels;
  if (a === b && b === c) return a === 'JP' ? 'jackpot' : THREE[a] || 0;
  return CHERRIES[reels.filter((s) => s === 'CH').length] || 0;
}

function createInitialState() {
  return { machines: {}, wins: [], seq: 0, jackpotSent: null };
}

function machine(st, id) {
  if (!st.machines[id]) st.machines[id] = { reels: ['SE', 'SE', 'SE'], bet: 1, spinNo: 0, win: 0, jackpot: false, at: 0 };
  return st.machines[id];
}

function spin(room, id, bet) {
  const st = room.state;
  const w = room.wallet;
  if (!w) return 'no_wallet';
  if (!BETS.includes(bet)) return 'bad_bet';
  if (!w.ready(id)) return 'wallet_loading';
  const m = machine(st, id);
  const now = clock();
  if (now - m.at < SPIN_MS) return 'too_fast';
  if (w.balance(id) < bet) return 'broke';
  if (w.buyIn(id, bet) !== bet) return 'broke';
  const reels = [0, 1, 2].map(() => STOPS[rng(STOPS.length)]);
  const pay = payFor(reels);
  const guest = w.guest(id);
  let win = pay === 'jackpot' ? (guest ? GUEST_JACKPOT * bet : 0) : pay * bet;
  w.cashOut(id, win);
  w.feedJackpot(id, bet);
  if (pay === 'jackpot' && !guest) win += w.hitJackpot(id, bet / MAX_BET);
  w.noteBet(id, bet, win - bet);
  Object.assign(m, { reels, bet, spinNo: m.spinNo + 1, win, jackpot: pay === 'jackpot', at: now });
  if (win >= bet * 20) st.wins = [{ id, win, jackpot: pay === 'jackpot' }, ...st.wins].slice(0, 5);
  return null;
}

function buildView(room) {
  const st = room.state;
  const w = room.wallet;
  const balances = {};
  if (w) for (const id of Object.keys(st.machines)) balances[id] = w.balance(id);
  return { seq: st.seq, machines: st.machines, balances, wins: st.wins, jackpot: w ? w.jackpot() : 0, bets: BETS, spinMs: SPIN_MS };
}

function broadcast(room) {
  const st = room.state;
  st.seq++;
  st.jackpotSent = room.wallet ? room.wallet.jackpot() : 0;
  room.broadcast({ v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'state', ...buildView(room) } } });
}

module.exports = {
  type: TYPE,
  casino: true,
  stats: { none: true },
  tickIntervalMs: 2000,
  // Other rooms' spins move the shared jackpot; keep this room's meter live.
  tick(room) {
    if (room.wallet && room.clients.size && room.wallet.jackpot() !== room.state.jackpotSent) broadcast(room);
  },
  createInitialState,
  isRoomFull(room) { return room.clients.size >= MAX_PLAYERS; },
  serializeSnapshot(room) { return buildView(room); },
  onJoin(room, client) { machine(room.state, client.clientId); broadcast(room); },
  onLeave(room, client) { delete room.state.machines[client.clientId]; broadcast(room); },
  onMessage(room, client, data, ctx) {
    if (!data || data.kind !== 'spin') return;
    const err = spin(room, ctx.senderId, Number(data.bet));
    if (err) {
      room.sendTo(ctx.senderId, { v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'moveRejected', reason: err } } });
      return;
    }
    broadcast(room);
  },
  _test: { REEL, STOPS, THREE, CHERRIES, BETS, MAX_BET, SPIN_MS, GUEST_JACKPOT, payFor, setRng(fn) { rng = fn; }, setClock(fn) { clock = fn; } },
};
