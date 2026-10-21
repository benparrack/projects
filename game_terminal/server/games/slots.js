// Slots: everyone in the room plays their own 3-reel machine, one pay line, straight from their
// casino balance (each spin is its own tiny buy-in and cash-out, so nothing sits at the table).
// Three diamonds pay 500x plus a share of the site-wide progressive that every account's spins feed
// (wallet.js). Two or more ★ anywhere on the line start the pick-a-jackpot bonus: the server picks
// the prize (MINI/MINOR/MAJOR/GRAND) and the reveal order up front, the client just plays it out.
//
// Math (exact, see test/casino-games.test.js): ~93.4% per spin, plus the progressive on top.
// Client: ../../public/games/slots/client.js
'use strict';

const crypto = require('crypto');

const TYPE = 'slots';
const MAX_PLAYERS = 6;
const BETS = [1, 5, 10, 25, 50, 100, 250, 500, 1000]; // same chips as roulette and blackjack
const MAX_BET = BETS[BETS.length - 1];
const SPIN_MS = 1600; // the client's reel animation; no spinning faster than it can show
const JP_FIXED = 500; // x bet for three diamonds, before the progressive share (so it always beats 777)

// One strip, used by all three reels: symbol -> stops.
const REEL = { CH: 4, LE: 6, BE: 5, BA: 4, SE: 2, JP: 1, BL: 5, BN: 2 };
const STOPS = Object.entries(REEL).flatMap(([s, n]) => Array(n).fill(s));
const THREE = { CH: 10, LE: 10, BE: 20, BA: 40, SE: 100 }; // x bet
const CHERRIES = [0, 1, 3]; // x bet for one or two cherries anywhere (three is THREE.CH)
// Bonus prizes: [name, x bet, weight]. Expected 7.69x, and the bonus hits about 1 spin in 73.
const BONUS = [['MINI', 2, 124], ['MINOR', 5, 50], ['MAJOR', 20, 22], ['GRAND', 150, 4]];
const BONUS_WEIGHT = BONUS.reduce((a, b) => a + b[2], 0);
const PICKS = 12; // tiles on the pick board

let rng = (n) => crypto.randomInt(n);
let clock = () => Date.now();

// Multiplier of the bet for a line, 'jackpot' or 'bonus'.
function payFor(reels) {
  const [a, b, c] = reels;
  if (reels.filter((s) => s === 'BN').length >= 2) return 'bonus';
  if (a === b && b === c) return a === 'JP' ? 'jackpot' : THREE[a] || 0;
  return CHERRIES[reels.filter((s) => s === 'CH').length] || 0;
}

// The pick board: 12 tiles, three of the prize and at most two of each other tier, in the order
// the player's clicks will reveal them; the third match is always the last reveal.
function bonusRound() {
  let r = rng(BONUS_WEIGHT);
  const tier = BONUS.findIndex(([, , w]) => (r -= w) < 0);
  const others = [];
  for (let t = 0; t < BONUS.length; t++) if (t !== tier) others.push(t, t);
  for (let i = others.length - 1; i > 0; i--) { const j = rng(i + 1); [others[i], others[j]] = [others[j], others[i]]; }
  const before = others.slice(0, rng(others.length + 1));
  const reveal = [...before, tier, tier];
  for (let i = reveal.length - 1; i > 0; i--) { const j = rng(i + 1); [reveal[i], reveal[j]] = [reveal[j], reveal[i]]; }
  reveal.push(tier);
  const rest = others.slice(before.length).concat(Array(PICKS).fill(tier)).slice(0, PICKS - reveal.length); // the tiles left face down
  return { tier: BONUS[tier][0], x: BONUS[tier][1], reveal: reveal.map((t) => BONUS[t][0]), rest: rest.map((t) => BONUS[t][0]) };
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
  const bonus = pay === 'bonus' ? bonusRound() : null;
  let win = pay === 'jackpot' ? JP_FIXED * bet : bonus ? bonus.x * bet : pay * bet;
  w.cashOut(id, win);
  w.feedJackpot(id, bet);
  if (pay === 'jackpot' && !guest) win += w.hitJackpot(id, bet / MAX_BET);
  w.noteBet(id, bet, win - bet);
  Object.assign(m, { reels, bet, spinNo: m.spinNo + 1, win, jackpot: pay === 'jackpot', bonus, at: now });
  if (win >= bet * 20) st.wins = [{ id, win, jackpot: pay === 'jackpot' }, ...st.wins].slice(0, 5);
  return null;
}

function buildView(room) {
  const st = room.state;
  const w = room.wallet;
  const balances = {};
  if (w) for (const id of Object.keys(st.machines)) balances[id] = w.balance(id);
  return { seq: st.seq, machines: st.machines, balances, wins: st.wins, jackpot: w ? w.jackpot() : 0, bets: BETS, spinMs: SPIN_MS, jpFixed: JP_FIXED, maxBet: MAX_BET, bonusTiers: BONUS.map(([n, x]) => [n, x]) };
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
  _test: { REEL, STOPS, THREE, CHERRIES, BONUS, BONUS_WEIGHT, BETS, MAX_BET, SPIN_MS, JP_FIXED, payFor, bonusRound, setRng(fn) { rng = fn; }, setClock(fn) { clock = fn; } },
};
