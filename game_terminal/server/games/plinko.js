// Plinko: drop a ball through 8-16 rows of pegs into a row of multiplier buckets. Each peg sends it
// left or right 50/50 (a provably fair float < .5 is left), so the bucket is binomial and the edges
// are rare. Every drop is its own instant bet, like a slot spin; the client animates the path.
//
// Payout tables: generated, not typed. Per rows and risk there's an edge prize and a centre prize
// (the classic ones: low 5.6x-16x around 0.5x, medium 13x-110x, high 29x-1000x around 0.2x); the
// buckets in between follow centre * (edge/centre)^(d^p), d the distance from the middle, with p
// picked so the rounded table returns about 98%, then the centre fixed to the cent (test/casino-games.test.js).
// Client: ../../public/games/plinko/client.js
'use strict';

const { kit, parseBet, payout, EDGE } = require('../casino/originals');

const TYPE = 'plinko';
const MAX_PLAYERS = 8;
const ROWS = [8, 9, 10, 11, 12, 13, 14, 15, 16];
const RISKS = { low: [5.6, 16, 0.5], medium: [13, 110, 0.3], high: [29, 1000, 0.2] }; // edge at 8 rows, at 16, centre
const GAP_MS = 60; // fastest drop rate per player

const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
const nice = (v) => (v < 10 ? Math.round(v * 10) / 10 : v < 100 ? Math.round(v) : Number(v.toPrecision(2)));
const rtp = (n, t) => t.reduce((a, m, k) => a + (m * choose(n, k)) / 2 ** n, 0);

function table(n, risk) {
  const [e8, e16, c] = RISKS[risk];
  const e = e8 * (e16 / e8) ** ((n - 8) / 8);
  const shape = (p) => Array.from({ length: n + 1 }, (_, k) => nice(c * (e / c) ** ((Math.abs(k - n / 2) / (n / 2)) ** p)));
  let best = null;
  for (let p = 0.3; p < 12; p += 0.005) {
    const t = shape(p);
    const err = Math.abs(rtp(n, t) - (1 - EDGE));
    if (!best || err < best.err) best = { t, err };
  }
  // Rounding leaves the return a percent or two off: the centre bucket(s) take up the slack, to the cent.
  const t = best.t;
  const mid = n % 2 ? [(n - 1) / 2, (n + 1) / 2] : [n / 2];
  const pMid = mid.reduce((a, k) => a + choose(n, k) / 2 ** n, 0);
  const c2 = Math.round((t[mid[0]] + (1 - EDGE - rtp(n, t)) / pMid) * 100) / 100;
  for (const k of mid) t[k] = c2;
  return t;
}
const TABLES = {};
for (const risk of Object.keys(RISKS)) { TABLES[risk] = {}; for (const n of ROWS) TABLES[risk][n] = table(n, risk); }

const { send, broadcast, reject, draw, publicSeeds, rotate, stake, settle, limits } = kit(TYPE);

function createInitialState() {
  return { last: {}, feed: [], seeds: {} };
}

function drop(room, id, data) {
  const bet = parseBet(data.bet);
  const rows = Number(data.rows);
  const risk = String(data.risk);
  if (bet == null || !ROWS.includes(rows) || !TABLES[risk]) return 'bad_bet';
  const now = Date.now();
  if (now - (room.state.last[id] || 0) < GAP_MS) return 'too_fast';
  const err = stake(room, id, bet);
  if (err) return err;
  room.state.last[id] = now;
  const { f, fair } = draw(room, id, rows);
  const path = f.map((x) => (x < 0.5 ? 0 : 1));
  const slot = path.reduce((a, b) => a + b, 0);
  const mult = TABLES[risk][rows][slot];
  const win = payout(bet, mult);
  settle(room, id, bet, win, mult);
  send(room, id, { kind: 'drop', ball: data.ball, bet, rows, risk, path, slot, mult, win, balance: room.wallet.balance(id), fair });
  return null;
}

const view = (room, id) => ({ kind: 'state', tables: TABLES, rows: ROWS, limits, feed: room.state.feed, seeds: id ? publicSeeds(room, id) : null, balance: id && room.wallet ? room.wallet.balance(id) : 0 });

module.exports = {
  type: TYPE,
  casino: true,
  stats: { none: true },
  createInitialState,
  isRoomFull(room) { return room.clients.size >= MAX_PLAYERS; },
  serializeSnapshot(room, viewer) { return view(room, viewer && viewer.clientId); },
  onJoin(room, client) { send(room, client.clientId, view(room, client.clientId)); },
  onLeave(room, client) { delete room.state.seeds[client.clientId]; delete room.state.last[client.clientId]; },
  onMessage(room, client, data, ctx) {
    const id = ctx.senderId;
    if (!data) return;
    if (data.kind === 'drop') {
      const err = drop(room, id, data);
      if (err) { reject(room, id, err); send(room, id, { kind: 'dropFailed', ball: data.ball }); return; }
      broadcast(room, { kind: 'feed', feed: room.state.feed });
    } else if (data.kind === 'seed') {
      const r = rotate(room, id, data.client);
      if (r.err) reject(room, id, r.err);
      else send(room, id, { kind: 'seeds', prev: r.prev, seeds: publicSeeds(room, id) });
    }
  },
  _test: { TABLES, ROWS, RISKS, rtp, choose },
};
