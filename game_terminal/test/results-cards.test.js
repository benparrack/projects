// End-of-match result reporting (server/report.js) for the card games + minesweeper, filler,
// sea battle: each finished match reports exactly once, with the right placements.
// Run: node test/results-cards.test.js
'use strict';

const assert = require('assert');
const { installCardBots } = require('../server/games/cardBots');
const war = require('../server/games/war');
const crazyeights = require('../server/games/crazyeights');
const bs = require('../server/games/bs');
const poker = require('../server/games/poker');
const spades = require('../server/games/spades');
const hearts = require('../server/games/hearts');
const blackjack = require('../server/games/blackjack');
const minesweeper = require('../server/games/minesweeper');
const filler = require('../server/games/filler');
const seabattle = require('../server/games/seabattle');
const E = require('../server/games/ai/fillerEngine');

installCardBots({ war });

let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function makeRoom(plugin, ids = ['A', 'B', 'C', 'D']) {
  const room = {
    state: plugin.createInitialState(),
    clients: new Map(ids.map((id) => [id, { clientId: id }])),
    broadcast: () => {},
    sendTo: () => {},
    results: [],
  };
  room.onResult = (r) => room.results.push(r);
  room.act = (id, data) => plugin.onMessage(room, { clientId: id }, data, { senderId: id, broadcast: room.broadcast, sendTo: room.sendTo });
  return room;
}
const c = (rank, suit) => ({ rank: String(rank), suit });
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await wait(50);
  }
}

test('stats metadata', () => {
  assert.deepStrictEqual(war.stats, { rated: false });
  assert.deepStrictEqual(blackjack.stats.rated, false);
  for (const p of [crazyeights, bs, poker, spades, hearts, minesweeper, filler, seabattle]) assert.strictEqual(p.stats.rated, true, p.type);
  assert.strictEqual(hearts.stats.score.better, 'low');
  assert.strictEqual(filler.stats.score.better, 'high');
});

test('war: last card taken ends it, one report; a rematch reset adds none', async () => {
  const room = makeRoom(war);
  room.act('A', { kind: 'sit' });
  room.act('B', { kind: 'sit' });
  room.state.hands = [[c('K', 'S')], [c(2, 'S')]];
  room.act('A', { kind: 'flip' });
  room.act('B', { kind: 'flip' });
  await waitFor(() => room.state.phase === 'game_over');
  assert.deepStrictEqual(room.results, [{ placements: [['A'], ['B']] }]);
  room.act('A', { kind: 'resetGame' });
  assert.strictEqual(room.results.length, 1);
});

test('war vs a real bot: bot seat reports as BOT, no level (war bots have none)', async () => {
  const room = makeRoom(war);
  room.act('A', { kind: 'sit' });
  room.act('A', { kind: 'addBot' });
  room.state.hands = [[c(2, 'S')], [c('A', 'S')]];
  room.act('A', { kind: 'flip' });
  await waitFor(() => room.results.length > 0);
  assert.deepStrictEqual(room.results, [{ placements: [['BOT'], ['A']] }]);
  room.act('A', { kind: 'leaveSeat' });
});

test('crazy eights: winner first, everyone else shares second', () => {
  const room = makeRoom(crazyeights);
  for (const id of ['A', 'B', 'C']) room.act(id, { kind: 'sit' });
  room.act('A', { kind: 'startGame' });
  const st = room.state;
  st.hands[0] = [c(8, 'H')];
  room.act('A', { kind: 'play', cardIndex: 0, declaredSuit: 'S' });
  assert.strictEqual(st.phase, 'game_over');
  assert.deepStrictEqual(room.results, [{ placements: [['A'], ['B', 'C']] }]);
  room.act('A', { kind: 'resetGame' });
  assert.strictEqual(room.results.length, 1);
});

test('bs: a final play that stands wins; a bot seat id maps to BOT with its level', () => {
  const room = makeRoom(bs);
  room.act('A', { kind: 'sit' });
  room.act('bot-Ace~expert', { kind: 'sit' });
  room.act('A', { kind: 'startGame' });
  const st = room.state;
  st.hands[0] = [c('A', 'S')];
  room.act('A', { kind: 'play', cardIndices: [0] });
  assert.strictEqual(room.results.length, 0);
  room.act('bot-Ace~expert', { kind: 'passChallenge' });
  assert.deepStrictEqual(room.results, [{ placements: [['A'], ['BOT']], botLevel: 'expert' }]);
});

test('poker: last stack standing wins; players busted in the same hand tie', () => {
  const room = makeRoom(poker);
  for (const id of ['A', 'B', 'C']) room.act(id, { kind: 'sit' });
  room.state.chips = [1000, 10, 20]; // B and C are all-in on the blinds
  room.act('A', { kind: 'startGame' });
  const h = room.state.hand;
  h.holeCards = [[c('A', 'S'), c('A', 'H')], [c(7, 'C'), c(2, 'D')], [c(8, 'C'), c(3, 'D')]];
  h.deck = [c('J', 'S'), c('Q', 'D'), c('Q', 'C'), c('K', 'H'), c('K', 'S')]; // board K K Q Q J
  room.act('A', { kind: 'call' });
  assert.strictEqual(room.state.phase, 'game_over');
  assert.deepStrictEqual(room.results, [{ placements: [['A'], ['B', 'C']] }]);
  room.act('A', { kind: 'resetGame' });
  assert.strictEqual(room.results.length, 1);
});

test('spades: partners share a place; team score per player', () => {
  const room = makeRoom(spades);
  ['A', 'B', 'C', 'bot-Dot~easy'].forEach((id, seat) => room.act(id, { kind: 'sit', seat }));
  room.act('A', { kind: 'startGame' });
  const st = room.state;
  Object.assign(st, {
    phase: 'playing', bids: [3, 3, 3, 3], tricksWon: [3, 3, 3, 3], teamScores: [450, 100], teamBags: [0, 0],
    hands: [[c('A', 'S')], [c(2, 'H')], [c(3, 'H')], [c(4, 'H')]],
    currentTrick: [], leadSeatIdx: 0, turnIdx: 0, spadesBroken: true,
  });
  ['A', 'B', 'C', 'bot-Dot~easy'].forEach((id) => room.act(id, { kind: 'play', cardIndex: 0 }));
  assert.strictEqual(st.phase, 'game_over');
  assert.deepStrictEqual(room.results, [{
    placements: [['A', 'C'], ['B', 'BOT']],
    scores: { A: 511, B: 160, C: 511 },
    botLevel: 'easy',
  }]);
});

test('hearts: lowest first, equal scores tie', () => {
  const room = makeRoom(hearts);
  ['A', 'B', 'C', 'D'].forEach((id, seatIdx) => room.act(id, { kind: 'sit', seatIdx }));
  room.act('A', { kind: 'startGame' });
  const st = room.state;
  const hearts12 = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].map((r) => c(r, 'H'));
  Object.assign(st, {
    phase: 'playing', scores: [90, 20, 30, 20],
    hands: [[c(2, 'C')], [c(3, 'C')], [c(4, 'C')], [c(5, 'C')]],
    tricksTaken: [hearts12, [], [], []], currentTrick: [], turnSeat: 0, trickLeaderSeat: 0, firstTrick: false, heartsBroken: true,
  });
  ['A', 'B', 'C', 'D'].forEach((id) => room.act(id, { kind: 'play', cardIndex: 0 }));
  assert.strictEqual(st.phase, 'game_over');
  assert.deepStrictEqual(room.results, [{
    placements: [['B', 'D'], ['C'], ['A']],
    scores: { A: 102, B: 20, C: 30, D: 20 },
  }]);
});

test('blackjack: one single-player result per human at the end of a shoe', () => {
  const T = blackjack._test;
  let now = 1e9;
  T.setClock(() => now);
  const room = makeRoom(blackjack);
  const tick = (ms) => { const end = now + ms; while (now < end) { now += 100; blackjack.tick(room); } };
  room.act('A', { kind: 'sit' });
  room.act('A', { kind: 'addBot', level: 'hard' });
  const st = room.state;
  st.shoe = st.shoe.slice(-st.cutAt); // the cut card is already out: this round ends the shoe
  for (let i = 0; i < 300 && st.phase !== 'shoe_over'; i++) {
    if (st.phase === 'betting' && !st.players.A.ready) { room.act('A', { kind: 'bet', amount: 100 }); room.act('A', { kind: 'deal' }); }
    if (st.phase === 'insurance') room.act('A', { kind: 'insurance', take: false });
    if (st.phase === 'playing') room.act('A', { kind: 'stand' });
    tick(500);
  }
  assert.strictEqual(st.phase, 'shoe_over');
  assert.deepStrictEqual(room.results, [{ placements: [['A']], scores: { A: st.players.A.shoeNet } }]);
  tick(1000);
  room.act('A', { kind: 'continue' });
  assert.strictEqual(room.results.length, 1);
});

test('minesweeper: first to clear wins, vs bot carries its level', async () => {
  const room = makeRoom(minesweeper);
  room.act('A', { kind: 'sit', seat: 'p1' });
  room.act('A', { kind: 'sit', seat: 'p2', bot: true, level: 'easy' });
  const st = room.state;
  const L = st.layout;
  const b = st.boards.p1;
  const i = b.cell.findIndex((v, j) => v === 0 && !L.mine[j]);
  b.opened = L.cols * L.rows - L.mines - 1;
  room.act('A', { kind: 'reveal', i });
  assert.strictEqual(st.phase, 'game_over');
  assert.deepStrictEqual(room.results, [{ placements: [['A'], ['BOT']], botLevel: 'easy' }]);
  await wait(1000); // the bot's pending timer sees game_over and stops
  assert.strictEqual(room.results.length, 1);
});

test('filler: a played-out game reports once with cell counts', () => {
  const room = makeRoom(filler);
  room.act('A', { kind: 'sit', seat: 'p1' });
  room.act('B', { kind: 'sit', seat: 'p2' });
  const st = room.state;
  while (st.phase === 'playing') {
    const color = E.legalColors(st.colors, st.turn === 'p1' ? 1 : 2)[0];
    room.act(st.players[st.turn], { kind: 'move', color });
  }
  const n = E.counts(st.owner);
  const want = st.winner === 'draw' ? [['A', 'B']] : st.winner === 'p1' ? [['A'], ['B']] : [['B'], ['A']];
  assert.deepStrictEqual(room.results, [{ placements: want, scores: { A: n[1], B: n[2] } }]);
});

test('sea battle: sinking the whole fleet wins', () => {
  const room = makeRoom(seabattle);
  room.act('A', { kind: 'sit', seat: 'p1' });
  room.act('B', { kind: 'sit', seat: 'p2' });
  const { randomFleet, shipCells } = seabattle._internal;
  room.act('A', { kind: 'placeFleet', ships: randomFleet() });
  room.act('B', { kind: 'placeFleet', ships: randomFleet() });
  const st = room.state;
  assert.strictEqual(st.turn, 'p1');
  for (const [r, cc] of st.fleets.p2.flatMap(shipCells)) room.act('A', { kind: 'fire', r, c: cc });
  assert.strictEqual(st.phase, 'game_over');
  assert.deepStrictEqual(room.results, [{ placements: [['A'], ['B']] }]);
  room.act('A', { kind: 'resetGame' });
  assert.strictEqual(room.results.length, 1);
});

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (err) {
      failures++;
      console.log(`FAIL - ${name}\n     ${err.stack.split('\n').slice(0, 4).join('\n     ')}`);
    }
  }
  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
