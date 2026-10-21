// Shared plumbing for the crypto-casino style "originals" (crash, plinko, mines): bet parsing, the
// stake/payout wallet moves, the room's recent-bets feed, and provably fair seeds.
//
// Provably fair, the usual scheme: each player has a seed pair per room, a secret server seed whose
// sha256 they see up front, their own client seed, and a nonce that counts their bets. A bet's random
// floats are HMAC-SHA256(server, `${client}:${nonce}:${cursor}`), 4 bytes per float, 8 per hash.
// Rotating the pair reveals the old server seed, so every bet made with it can be re-derived
// (public/games/originals.js does that in the browser).
'use strict';

const crypto = require('crypto');
const { ORIGINALS } = require('./economy');

const { MIN_BET, MAX_BET, EDGE, MAX_WIN } = ORIGINALS;
const FEED = 25;
const round2 = (n) => Math.round(n * 100) / 100;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randHex = (n) => crypto.randomBytes(n).toString('hex');
const CLIENT_SEED = /^[\w-]{1,32}$/;

// A typed bet rounded to cents, or null if it's outside the limits.
function parseBet(x) {
  const n = round2(Number(x));
  return Number.isFinite(n) && n >= MIN_BET && n <= MAX_BET ? n : null;
}
const payout = (bet, mult) => round2(Math.min(bet * mult, MAX_WIN));

function floats(server, client, nonce, count) {
  const out = [];
  for (let cursor = 0; out.length < count; cursor++) {
    const h = crypto.createHmac('sha256', server).update(`${client}:${nonce}:${cursor}`).digest();
    for (let i = 0; i < 32 && out.length < count; i += 4) out.push(h[i] / 256 + h[i + 1] / 256 ** 2 + h[i + 2] / 256 ** 3 + h[i + 3] / 256 ** 4);
  }
  return out;
}
const newPair = (client = randHex(6)) => { const server = randHex(32); return { server, hash: sha256(server), client, nonce: 0 }; };

function kit(TYPE) {
  const envelope = (data) => ({ v: 1, type: 'game.event', payload: { gameType: TYPE, data } });
  const send = (room, id, data) => room.sendTo(id, envelope(data));
  const broadcast = (room, data) => room.broadcast(envelope(data));
  const reject = (room, id, reason) => send(room, id, { kind: 'moveRejected', reason });

  const seeds = (room, id) => {
    const st = room.state;
    if (!st.seeds) st.seeds = {};
    if (!st.seeds[id]) st.seeds[id] = newPair();
    return st.seeds[id];
  };
  // The next bet's floats; bumps the nonce.
  function draw(room, id, count) {
    const p = seeds(room, id);
    const f = floats(p.server, p.client, p.nonce, count);
    const nonce = p.nonce++;
    return { f, fair: { hash: p.hash, client: p.client, nonce } };
  }
  const publicSeeds = (room, id) => { const p = seeds(room, id); return { hash: p.hash, client: p.client, nonce: p.nonce }; };
  // New pair (optionally with the player's own client seed); returns the old one, server seed revealed.
  function rotate(room, id, client) {
    if (client != null && !CLIENT_SEED.test(client)) return { err: 'bad_seed' };
    const prev = seeds(room, id);
    room.state.seeds[id] = newPair(client || undefined);
    return { prev: { server: prev.server, hash: prev.hash, client: prev.client, nonces: prev.nonce } };
  }

  // Takes the stake off the balance onto this table. Returns an error code, or null.
  function stake(room, id, bet) {
    const w = room.wallet;
    if (!w) return 'no_wallet';
    if (bet == null) return 'bad_bet';
    if (!w.ready(id)) return 'wallet_loading';
    if (w.balance(id) < bet || w.buyIn(id, bet) !== bet) return 'broke';
    return null;
  }
  // Settles a staked bet: pays `win` (0 on a loss) and logs it for tiers and the feed.
  function settle(room, id, bet, win, mult) {
    const w = room.wallet;
    w.cashOut(id, win);
    w.noteBet(id, bet, win - bet);
    const c = room.clients.get(id) || room.seen.get(id);
    const st = room.state;
    st.feed = [{ id, name: `${(c && c.nickname) || 'player'}${w.flair(id) ? ` ${w.flair(id)}` : ''}`, bet, mult: round2(mult), win, at: Date.now() }, ...(st.feed || [])].slice(0, FEED);
  }
  const limits = { min: MIN_BET, max: MAX_BET, maxWin: MAX_WIN, edge: EDGE };

  return { send, broadcast, reject, draw, publicSeeds, rotate, stake, settle, limits };
}

module.exports = { kit, parseBet, payout, floats, sha256, newPair, round2, MIN_BET, MAX_BET, EDGE, MAX_WIN };
