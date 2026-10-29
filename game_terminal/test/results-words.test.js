// End-of-match result reporting (server/report.js) for the word games: each finished match calls
// room.onResult exactly once with the right placements; resets / give-ups report nothing.
// Run: node test/results-words.test.js
'use strict';

const assert = require('assert');
const G = (t) => require(`../server/games/${t}`);

let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function makeRoom(type, ids) {
  const plugin = G(type);
  const room = {
    state: plugin.createInitialState(),
    clients: new Map(ids.map((id) => [id, { clientId: id, nickname: id }])),
    broadcast: () => {},
    sendTo: () => {},
    results: [],
  };
  room.onResult = (r) => room.results.push(r);
  room.act = (id, data) => plugin.onMessage(room, { clientId: id }, data, { senderId: id, broadcast: room.broadcast, sendTo: room.sendTo });
  return room;
}
const join = (type, room) => { for (const c of room.clients.values()) G(type).onJoin(room, c); };
// Runs fn with setTimeout captured: nothing fires on its own, the callbacks are returned in order.
function captureTimers(fn) {
  const real = global.setTimeout;
  const cbs = [];
  global.setTimeout = (cb) => { cbs.push(cb); return real(() => {}, 0); };
  try { fn(); } finally { global.setTimeout = real; }
  return cbs;
}
const only = (room) => { assert.strictEqual(room.results.length, 1, `expected 1 report, got ${room.results.length}`); return room.results[0]; };

for (const type of ['anagrams', 'wordhunt', 'wordbites']) {
  test(`${type}: points race ranks by score, ties share, bot -> BOT + level`, () => {
    const room = makeRoom(type, ['A', 'B']);
    join(type, room);
    const timers = captureTimers(() => { room.act('A', { kind: 'addBot', level: 'easy' }); room.act('A', { kind: 'start' }); });
    const st = room.state;
    const bot = [...st.players.values()].find((p) => p.bot);
    st.players.get('A').score = 500; st.players.get('B').score = 100; bot.score = 500;
    timers[0](); // the round timer
    if (type !== 'anagrams') G(type)._internals.endRound(room); // a second end is a no-op
    timers[0]();
    const r = only(room);
    assert.deepStrictEqual(r.placements, [['A', 'BOT'], ['B']]);
    assert.deepStrictEqual(r.scores, { A: 500, B: 100 });
    assert.strictEqual(r.botLevel, 'easy');
    assert.deepStrictEqual(G(type).stats, { rated: true, score: { label: 'Points', better: 'high', format: 'pts' } });
  });
}

test('wordsearch: claiming every word ends and reports once', () => {
  const room = makeRoom('wordsearch', ['A', 'B']);
  join('wordsearch', room);
  captureTimers(() => room.act('A', { kind: 'start', size: 10, theme: 'animals' }));
  const st = room.state;
  st.startedAt = Date.now() - 1;
  const endOf = (w) => ({ r2: w.r + w.dr * (w.word.length - 1), c2: w.c + w.dc * (w.word.length - 1) });
  st.words.forEach((w, i) => room.act(i ? 'A' : 'B', { kind: 'claim', r1: w.r, c1: w.c, ...endOf(w) }));
  assert.strictEqual(st.phase, 'results');
  const r = only(room);
  assert.deepStrictEqual(r.placements, [['A'], ['B']]);
  assert.strictEqual(r.scores.A, st.players.get('A').score);
});

test('solo wordhunt: one place, one human, with a score', () => {
  const room = makeRoom('wordhunt', ['A']);
  join('wordhunt', room);
  captureTimers(() => room.act('A', { kind: 'start' }));
  room.state.players.get('A').score = 1200;
  G('wordhunt')._internals.endRound(room);
  assert.deepStrictEqual(only(room), { placements: [['A']], scores: { A: 1200 } });
});

const CW = G('crossword')._test;
CW.BOT_CFG.countdownMs = 0;
const fillAll = (room, id) => {
  for (const w of room.state.puzzle.words) CW.wordCells(w).forEach(([r, c], i) => room.act(id, { kind: 'fill', r, c, l: w.answer[i] }));
};
test('crossword race: finisher first with solve time, rest by words solved', () => {
  const room = makeRoom('crossword', ['A', 'B']);
  join('crossword', room);
  room.act('A', { kind: 'start', size: 'mini', mode: 'race' });
  fillAll(room, 'A');
  const r = only(room);
  assert.deepStrictEqual(r.placements, [['A'], ['B']]);
  assert.deepStrictEqual(Object.keys(r.scores), ['A']);
  assert.ok(r.scores.A >= 0);
});
test('crossword co-op: everyone shares one place; giving up reports nothing', () => {
  const room = makeRoom('crossword', ['A', 'B']);
  join('crossword', room);
  room.act('A', { kind: 'start', size: 'mini', mode: 'coop' });
  room.act('B', { kind: 'giveUp' });
  assert.strictEqual(room.results.length, 0);
  room.act('A', { kind: 'start', size: 'mini', mode: 'coop' });
  fillAll(room, 'A');
  assert.deepStrictEqual(only(room).placements, [['A', 'B']]);
});

const WS = G('wordscapes')._test;
WS.BOT_CFG.countdownMs = 0;
test('wordscapes race: finisher first, then by words found; next level reports again', () => {
  const room = makeRoom('wordscapes', ['A', 'B']);
  join('wordscapes', room);
  room.act('A', { kind: 'setMode', mode: 'race' });
  const slots = room.state.puzzle.slots;
  room.act('B', { kind: 'submit', word: slots[0].word });
  for (const s of slots) room.act('A', { kind: 'submit', word: s.word });
  assert.strictEqual(room.state.phase, 'complete');
  const r = only(room);
  assert.deepStrictEqual(r.placements, [['A'], ['B']]);
  assert.deepStrictEqual(Object.keys(r.scores), ['A']);
  room.act('A', { kind: 'setMode', mode: 'coop' });
  for (const s of room.state.puzzle.slots) room.act('B', { kind: 'submit', word: s.word });
  assert.strictEqual(room.results.length, 2);
  assert.deepStrictEqual(room.results[1].placements, [['A', 'B']]);
});

test('hangman race: first solver, then picker, then the rest; picker wins when all hang', () => {
  const room = makeRoom('hangman', ['A', 'B', 'C']);
  join('hangman', room);
  room.act('A', { kind: 'setWord', word: 'cat' });
  for (const l of 'CAT') room.act('B', { kind: 'guessLetter', letter: l });
  assert.deepStrictEqual(only(room).placements, [['B'], ['A'], ['C']]);
  room.act('A', { kind: 'nextRound' }); // B picks
  room.act('B', { kind: 'setWord', word: 'dog' });
  for (const id of ['C', 'A']) for (const l of 'QWERTY') room.act(id, { kind: 'guessLetter', letter: l });
  assert.strictEqual(room.results.length, 2);
  assert.deepStrictEqual(room.results[1].placements, [['B'], ['A', 'C']]);
  clearTimeout(room.state._botTimer);
});

function trailsRoom(ids) {
  const room = makeRoom('wordtrails', ids);
  join('wordtrails', room);
  room.act(ids[0], { kind: 'start', lives: 1 });
  room.state.startsAt = 0;
  G('wordtrails').tick(room); // countdown -> playing
  return room;
}
let clock = Date.now();
function timeOut(room, id) {
  const st = room.state;
  const t = (clock += 1000);
  const realNow = Date.now;
  Date.now = () => t; // knock-outs a second apart, like real play
  st.pauseUntil = 0;
  st.turnIdx = st.order.indexOf(id);
  st.turnEndsAt = t - 1;
  try { G('wordtrails').tick(room); } finally { Date.now = realNow; }
}
test('wordtrails: last standing first, reverse knock-out order, leavers count as knocked out', () => {
  const room = trailsRoom(['A', 'B', 'C', 'D']);
  room.clients.delete('D');
  G('wordtrails').onLeave(room, { clientId: 'D' });
  timeOut(room, 'B');
  assert.strictEqual(room.results.length, 0);
  timeOut(room, 'C');
  const r = only(room);
  assert.deepStrictEqual(r.placements, [['A'], ['C'], ['B'], ['D']]);
  assert.deepStrictEqual(r.scores, { A: 0, B: 0, C: 0, D: 0 });
});
test('wordtrails solo: one place', () => {
  const room = trailsRoom(['A']);
  timeOut(room, 'A');
  assert.deepStrictEqual(only(room).placements, [['A']]);
});

test('twentyq: two-round match ranked by match points; a draw shares the place', () => {
  const { timing } = G('twentyq')._internal;
  timing.roundPause = 1;
  const room = makeRoom('twentyq', ['A', 'B']);
  room.act('A', { kind: 'sit', seat: 'p1' });
  room.act('B', { kind: 'sit', seat: 'p2' });
  room.act('A', { kind: 'pick', word: 'rubber duck', category: 'object' });
  room.act('B', { kind: 'guess', text: 'rubber duck' }); // B: 20
  room.act('A', { kind: 'nextRound' });
  room.act('B', { kind: 'pick', word: 'banana', category: 'food' });
  room.act('A', { kind: 'ask', text: 'is it yellow' });
  room.act('B', { kind: 'answer', value: 'yes' });
  room.act('A', { kind: 'guess', text: 'banana' }); // A: 19
  assert.strictEqual(room.state.phase, 'game_over');
  room.act('A', { kind: 'nextRound' }); // ignored, no second report
  assert.deepStrictEqual(only(room), { placements: [['B'], ['A']], scores: { B: 20, A: 19 } });
  // Rematch, both solve on the first question: draw.
  room.act('A', { kind: 'resetGame' });
  const st = room.state;
  for (let k = 0; k < 2; k++) {
    const picker = st.players[st.picker];
    const guesser = st.players[st.guesser];
    room.act(picker, { kind: 'pick', word: k ? 'apple' : 'piano', category: 'object' });
    room.act(guesser, { kind: 'guess', text: k ? 'apple' : 'piano' });
    if (!k) room.act(picker, { kind: 'nextRound' });
  }
  assert.strictEqual(room.results.length, 2);
  assert.strictEqual(room.results[1].placements.length, 1);
});
test('twentyq vs bot: BOT + level, no bot score', () => {
  const room = makeRoom('twentyq', ['A']);
  room.act('A', { kind: 'sit', seat: 'p1' });
  room.act('A', { kind: 'sit', seat: 'p2', bot: true, level: 'medium' });
  const { makeSecret } = G('twentyq')._internal;
  // Jump to the last round with the bot picking, then solve it.
  Object.assign(room.state, { round: 2, picker: 'p2', guesser: 'p1', secret: makeSecret('banana', 'food'), phase: 'asking', scores: { p1: 0, p2: 30 } });
  room.act('A', { kind: 'guess', text: 'banana' });
  room.act('A', { kind: 'removeBot', seat: 'p2' });
  assert.deepStrictEqual(only(room), { placements: [['BOT'], ['A']], scores: { A: 20 }, botLevel: 'medium' });
});

function scrabbleRoom() {
  const room = makeRoom('scrabble', ['A', 'B', 'C']);
  room.act('A', { kind: 'sit' });
  room.act('B', { kind: 'sit' });
  room.act('A', { kind: 'startGame' });
  return room;
}
test('scrabble: six scoreless turns end the game, ranked by final score', () => {
  const room = scrabbleRoom();
  const st = room.state;
  st.racks = [['e'], ['e']]; // rack value 1 each
  st.scores = [10, 30];
  st.scorelessStreak = 5;
  room.act(st.seats[st.turnIdx], { kind: 'pass' });
  assert.strictEqual(st.phase, 'game_over');
  room.act('C', { kind: 'sit' }); // another broadcast: no second report
  const r = only(room);
  assert.deepStrictEqual(r.placements, [[st.seats[1]], [st.seats[0]]]);
  assert.deepStrictEqual(r.scores, { [st.seats[0]]: 9, [st.seats[1]]: 29 });
});
test('scrabble: resigning is a forfeit loss; a bot win carries botLevel', () => {
  const room = scrabbleRoom();
  room.act('A', { kind: 'resign' });
  assert.deepStrictEqual(only(room).placements, [['B'], ['A']]);
  const room2 = makeRoom('scrabble', ['A']);
  room2.act('A', { kind: 'sit' });
  room2.act('A', { kind: 'addBot', level: 'expert' });
  room2.act('A', { kind: 'startGame' });
  room2.act('A', { kind: 'resign' });
  const r = only(room2);
  assert.deepStrictEqual(r.placements, [['BOT'], ['A']]);
  assert.strictEqual(r.botLevel, 'expert');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); console.log('ok  ', name); } catch (e) { failures++; console.log('FAIL', name, '\n  ', e.stack); }
  }
  console.log(failures ? `\n${failures} failing` : '\nall passing');
  process.exit(failures ? 1 : 0);
})();
