// Scrabble: move validation/scoring, protocol guards, and full bot-vs-bot games at every level.
// Run: node test/scrabble.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/scrabble');
const { DICT_LIST } = require('../server/games/words');

const T = plugin._test;
const LEVELS = ['easy', 'medium', 'hard', 'expert'];
let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function makeRoom(ids = ['A', 'B', 'C']) {
  const sent = [];
  const room = {
    state: plugin.createInitialState(),
    clients: new Map(ids.map((id) => [id, { nickname: id }])),
    broadcast: (m) => sent.push({ to: '*', m }),
    sendTo: (id, m) => sent.push({ to: id, m }),
  };
  room.sent = sent;
  return room;
}
const act = (room, id, data) => plugin.onMessage(room, { clientId: id }, data, { senderId: id, broadcast: room.broadcast, sendTo: room.sendTo });
const lastFor = (room, id, kind) => {
  const s = [...room.sent].reverse().find((x) => x.to === id && x.m.payload.data.kind === kind);
  return s && s.m.payload.data;
};
const tileCount = (st) => st.bag.length + st.racks.reduce((n, r) => n + r.length, 0)
  + st.board.flat().filter(Boolean).length;
const across = (word, r, c) => [...word].map((letter, k) => ({ r, c: c + k, letter, blank: false }));

test('first move must cover the centre; scoring uses DW on the star', () => {
  const b = T.emptyBoard();
  assert.strictEqual(T.evaluateMove(b, across('cat', 0, 0)).reason, 'center');
  const ev = T.evaluateMove(b, across('cat', 7, 6));
  assert.ok(ev.ok);
  assert.strictEqual(ev.score, (3 + 1 + 1) * 2);
});

test('invalid words, gaps and single-tile first moves are rejected', () => {
  const b = T.emptyBoard();
  assert.strictEqual(T.evaluateMove(b, across('qzx', 7, 6)).ok, false);
  assert.strictEqual(T.evaluateMove(b, [{ r: 7, c: 6, letter: 'a' }, { r: 7, c: 8, letter: 't' }]).ok, false);
  assert.strictEqual(T.evaluateMove(b, [{ r: 7, c: 7, letter: 'a' }]).ok, false);
});

test('bag holds the standard 100 tiles', () => {
  assert.strictEqual(T.newBag().length, 100);
});

test('protocol: seats, start guard, turn guard, hidden racks', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'startGame' });
  assert.strictEqual(room.state.phase, 'waiting');
  act(room, 'A', { kind: 'sit' });
  act(room, 'B', { kind: 'sit' });
  act(room, 'C', { kind: 'startGame' }); // spectator can't start
  assert.strictEqual(room.state.phase, 'waiting');
  act(room, 'A', { kind: 'startGame' });
  assert.strictEqual(room.state.phase, 'playing');
  const st = room.state;
  const notTurn = st.seats[1 - st.turnIdx];
  act(room, notTurn, { kind: 'pass' });
  assert.strictEqual(lastFor(room, notTurn, 'moveRejected').reason, 'not_your_turn');
  const viewC = plugin.serializeSnapshot(room, { clientId: 'C' });
  assert.deepStrictEqual(viewC.myRack, []);
  assert.ok(!JSON.stringify(viewC).includes('"racks"'));
  // garbage tiles are rejected without throwing
  const turn = st.seats[st.turnIdx];
  act(room, turn, { kind: 'play', tiles: [{ i: 99, r: 7, c: 7 }] });
  assert.strictEqual(lastFor(room, turn, 'moveRejected').reason, 'bad_tiles');
  act(room, turn, { kind: 'play', tiles: 'nope' });
  assert.strictEqual(tileCount(st), 100);
});

test('six scoreless turns end the game', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit' });
  act(room, 'B', { kind: 'sit' });
  act(room, 'A', { kind: 'startGame' });
  for (let k = 0; k < 6; k++) act(room, room.state.seats[room.state.turnIdx], { kind: 'pass' });
  assert.strictEqual(room.state.phase, 'game_over');
});

test('bot-vs-bot games at every level finish with valid words and conserved tiles', () => {
  const words = DICT_LIST.filter((w) => w.length >= 2 && w.length <= 15 && !T.SHORT_JUNK.has(w)).sort();
  const trie = T.buildTrie(words);
  for (const level of LEVELS) {
    const st = plugin.createInitialState();
    st.seats = ['bot-1', 'bot-2'];
    st.botLevels = { 'bot-1': level, 'bot-2': 'hard' };
    T.startGame(st);
    let turns = 0;
    while (st.phase === 'playing' && turns < 200) {
      const i = st.turnIdx;
      const action = T.chooseBotAction(trie, st.board, st.racks[i].slice(), st.botLevels[st.seats[i]], st.bag.length);
      if (action && action.kind === 'play') {
        const ev = T.evaluateMove(st.board, action.tiles);
        assert.ok(ev.ok, `${level}: bot produced an illegal play (${ev.reason})`);
        for (const w of ev.words) assert.ok(T.isScrabbleWord(w.word), `${level}: not a word ${w.word}`);
        T.applyPlay(st, i, action.tiles, ev);
      } else {
        // a bot exchange is simplified to a pass here, sent through the real handler
        const fake = { state: st, clients: new Map(), broadcast() {}, sendTo() {} };
        plugin.onMessage(fake, { clientId: st.seats[i] }, { kind: 'pass' }, { senderId: st.seats[i] });
      }
      turns++;
      assert.strictEqual(tileCount(st), 100, `${level}: tiles not conserved`);
    }
    assert.strictEqual(st.phase, 'game_over', `${level}: game did not finish`);
    console.log(`  ${level} vs hard: ${st.scores.join('-')} in ${turns} turns`);
  }
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok   ${name}`); } catch (err) { failures++; console.log(`FAIL ${name}\n     ${err.stack.split('\n').slice(0, 3).join('\n     ')}`); }
  }
  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
