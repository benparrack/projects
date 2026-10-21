// Mines: a 5x5 grid hiding 1-24 mines. Every gem you turn over raises the multiplier; cash out any
// time, hit a mine and the bet is gone. The multiplier after k gems is the fair odds of surviving k
// picks, less the edge: (1 - edge) * C(25, k) / C(25 - mines, k).
//
// Mines are placed when the game starts, from the player's provably fair floats: mine i is the
// floor(f[i] * (25 - i))th of the tiles still free (in order). AUTO sends a whole bet at once, the
// stake, the mine count and the tiles to turn, and it's settled in one go.
// Client: ../../public/games/mines/client.js
'use strict';

const { kit, parseBet, payout, round2, EDGE } = require('../casino/originals');

const TYPE = 'mines';
const MAX_PLAYERS = 8;
const TILES = 25;

const { send, broadcast, reject, draw, publicSeeds, rotate, stake, settle, limits } = kit(TYPE);

function multiplier(mines, k) {
  let m = 1 - EDGE;
  for (let i = 0; i < k; i++) m *= (TILES - i) / (TILES - mines - i);
  return round2(m);
}

function placeMines(f, mines) {
  const free = Array.from({ length: TILES }, (_, i) => i);
  const out = [];
  for (let i = 0; i < mines; i++) out.push(free.splice(Math.floor(f[i] * (TILES - i)), 1)[0]);
  return out;
}

function createInitialState() {
  return { games: {}, feed: [], seeds: {} };
}

// What the player sees of their game: the mines only once it's over.
function publicGame(g) {
  if (!g) return null;
  const mult = multiplier(g.mines, g.picks.length);
  return { bet: g.bet, mines: g.mines, picks: g.picks, over: g.over, hit: g.hit, mult, win: g.win,
    next: g.picks.length < TILES - g.mines ? multiplier(g.mines, g.picks.length + 1) : null,
    mineTiles: g.over ? g.mineTiles : null, fair: g.fair, auto: !!g.auto };
}

function start(room, id, data) {
  const st = room.state;
  if (st.games[id] && !st.games[id].over) return 'game_active';
  const bet = parseBet(data.bet);
  const mines = Number(data.mines);
  if (!Number.isInteger(mines) || mines < 1 || mines > TILES - 1) return 'bad_bet';
  const err = stake(room, id, bet);
  if (err) return err;
  const { f, fair } = draw(room, id, mines);
  st.games[id] = { bet, mines, mineTiles: placeMines(f, mines), picks: [], over: false, hit: null, win: 0, fair };
  return null;
}

function finish(room, id, g, won) {
  g.over = true;
  const mult = won ? multiplier(g.mines, g.picks.length) : 0;
  g.win = won ? payout(g.bet, mult) : 0;
  settle(room, id, g.bet, g.win, mult);
}

function pick(room, id, tile) {
  const g = room.state.games[id];
  if (!g || g.over) return 'no_game';
  if (!Number.isInteger(tile) || tile < 0 || tile >= TILES || g.picks.includes(tile)) return 'bad_tile';
  if (g.mineTiles.includes(tile)) { g.hit = tile; finish(room, id, g, false); return null; }
  g.picks.push(tile);
  if (g.picks.length === TILES - g.mines) finish(room, id, g, true); // every gem found
  return null;
}

function cashout(room, id) {
  const g = room.state.games[id];
  if (!g || g.over) return 'no_game';
  if (!g.picks.length) return 'no_picks';
  finish(room, id, g, true);
  return null;
}

// One whole auto bet: start, turn the chosen tiles in order, cash out if they were all gems.
function auto(room, id, data) {
  const tiles = Array.isArray(data.tiles) ? data.tiles : [];
  const mines = Number(data.mines);
  if (!tiles.length || tiles.length > TILES - mines || new Set(tiles).size !== tiles.length || !tiles.every((t) => Number.isInteger(t) && t >= 0 && t < TILES)) return 'bad_tiles';
  const err = start(room, id, data);
  if (err) return err;
  const g = room.state.games[id];
  g.auto = true;
  for (const t of tiles) { pick(room, id, t); if (g.over) break; }
  if (!g.over) finish(room, id, g, true);
  return null;
}

const view = (room, id) => ({ kind: 'state', limits, feed: room.state.feed, seeds: id ? publicSeeds(room, id) : null, game: id ? publicGame(room.state.games[id]) : null, balance: id && room.wallet ? room.wallet.balance(id) : 0 });

module.exports = {
  type: TYPE,
  casino: true,
  stats: { none: true },
  createInitialState,
  isRoomFull(room) { return room.clients.size >= MAX_PLAYERS; },
  serializeSnapshot(room, viewer) { return view(room, viewer && viewer.clientId); },
  onJoin(room, client) { send(room, client.clientId, view(room, client.clientId)); },
  // Walking away mid-game takes what's on the board (or the stake back if nothing was turned yet).
  onLeave(room, client) {
    const id = client.clientId;
    const g = room.state.games[id];
    if (g && !g.over) {
      if (g.picks.length) finish(room, id, g, true);
      else room.wallet.cashOut(id, g.bet);
      broadcast(room, { kind: 'feed', feed: room.state.feed });
    }
    delete room.state.games[id];
    delete room.state.seeds[id];
  },
  onMessage(room, client, data, ctx) {
    const id = ctx.senderId;
    if (!data) return;
    let err;
    if (data.kind === 'start') err = start(room, id, data);
    else if (data.kind === 'pick') err = pick(room, id, Number(data.tile));
    else if (data.kind === 'cashout') err = cashout(room, id);
    else if (data.kind === 'auto') err = auto(room, id, data);
    else if (data.kind === 'seed') {
      // A live game's mines come from the current seed: revealing it now would give them away.
      if (room.state.games[id] && !room.state.games[id].over) { reject(room, id, 'game_active'); return; }
      const r = rotate(room, id, data.client);
      if (r.err) reject(room, id, r.err);
      else send(room, id, { kind: 'seeds', prev: r.prev, seeds: publicSeeds(room, id) });
      return;
    } else return;
    if (err) { reject(room, id, err); return; }
    const g = room.state.games[id];
    send(room, id, { kind: 'game', game: publicGame(g), balance: room.wallet.balance(id), seeds: publicSeeds(room, id), tile: data.tile });
    if (g.over) broadcast(room, { kind: 'feed', feed: room.state.feed });
  },
  _test: { multiplier, placeMines, TILES },
};
