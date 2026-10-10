// Gomoku: rules, protocol validation, seats/bots/rematch, and engine tactics at every level.
// Run: node test/gomoku.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/gomoku');
const engine = require('../server/games/ai/gomokuEngine');

const N = 15;
const LEVELS = ['easy', 'medium', 'hard', 'expert'];
let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function makeRoom() {
  const sent = [];
  const room = {
    state: plugin.createInitialState(),
    clients: new Map([['A', {}], ['B', {}], ['C', {}]]),
    broadcast: (m) => sent.push({ to: '*', m }),
    sendTo: (id, m) => sent.push({ to: id, m }),
  };
  room.sent = sent;
  return room;
}
const ctxFor = (room, id) => ({ senderId: id, broadcast: room.broadcast, sendTo: room.sendTo });
const act = (room, id, data) => plugin.onMessage(room, { clientId: id }, data, ctxFor(room, id));
const lastState = (room) => [...room.sent].reverse().find((s) => s.m.payload.data.kind === 'state').m.payload.data;
const lastReject = (room, id) => {
  const s = [...room.sent].reverse().find((x) => x.to === id && x.m.payload.data.kind === 'moveRejected');
  return s && s.m.payload.data.reason;
};
const emptyBoard = () => Array.from({ length: N }, () => Array(N).fill(null));
function boardFrom(rows) {
  // rows: array of strings (15 chars, 'x' black, 'o' white, '.' empty), padded with empty rows.
  const b = emptyBoard();
  rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === 'x') b[r][c] = 'black'; if (ch === 'o') b[r][c] = 'white'; }));
  return b;
}
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

// ---- rules -------------------------------------------------------------------------------------
test('two humans sit, alternate, five wins and highlights the line', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'black' });
  assert.strictEqual(room.state.phase, 'waiting');
  act(room, 'B', { kind: 'sit', seat: 'white' });
  assert.strictEqual(room.state.phase, 'playing');
  for (let i = 0; i < 4; i++) {
    act(room, 'A', { kind: 'move', r: 7, c: 3 + i });
    act(room, 'B', { kind: 'move', r: 9, c: 3 + i });
  }
  act(room, 'A', { kind: 'move', r: 7, c: 7 });
  const st = lastState(room);
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.winner, 'black');
  assert.strictEqual(st.winLine.length, 5);
  assert.deepStrictEqual(st.score, { black: 1, white: 0 });
});

test('six in a row also wins (freestyle) and diagonals count', () => {
  const b = emptyBoard();
  for (let i = 0; i < 6; i++) if (i !== 3) b[2 + i][2 + i] = 'white';
  b[5][5] = 'white';
  const line = plugin._internal.winningLine(b, 5, 5, 'white');
  assert.ok(line && line.length === 6);
  const b2 = emptyBoard();
  for (let i = 0; i < 4; i++) b2[i][10 - i] = 'black';
  assert.strictEqual(plugin._internal.winningLine(b2, 3, 7, 'black'), null);
  b2[4][6] = 'black';
  assert.strictEqual(plugin._internal.winningLine(b2, 4, 6, 'black').length, 5);
});

test('illegal moves are rejected with reasons', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'black' });
  act(room, 'B', { kind: 'sit', seat: 'white' });
  act(room, 'B', { kind: 'move', r: 7, c: 7 });
  assert.strictEqual(lastReject(room, 'B'), 'not_your_turn');
  act(room, 'C', { kind: 'move', r: 7, c: 7 });
  assert.strictEqual(lastReject(room, 'C'), 'not_seated');
  act(room, 'A', { kind: 'move', r: 15, c: 0 });
  assert.strictEqual(lastReject(room, 'A'), 'invalid');
  act(room, 'A', { kind: 'move', r: '1.5', c: 0 });
  assert.strictEqual(lastReject(room, 'A'), 'invalid');
  act(room, 'A', { kind: 'move', r: 7, c: 7 });
  act(room, 'B', { kind: 'move', r: 7, c: 7 });
  assert.strictEqual(lastReject(room, 'B'), 'occupied');
  act(room, 'A', { kind: 'sit', seat: 'white' }); // occupied seat
  assert.strictEqual(room.state.players.white, 'B');
  act(room, 'C', { kind: 'nonsense' });
  plugin.onMessage(room, { clientId: 'C' }, null, ctxFor(room, 'C'));
  assert.strictEqual(room.state.moveCount, 1);
});

test('full board without five is a draw', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'black' });
  act(room, 'B', { kind: 'sit', seat: 'white' });
  // Pattern with no five anywhere: colour by ((c + 2r) mod 4) < 2 — runs of at most 2 in every direction.
  const st = room.state;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) st.board[r][c] = ((c + 2 * r) % 4) < 2 ? 'black' : 'white';
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) assert.strictEqual(plugin._internal.winningLine(st.board, r, c, st.board[r][c]), null);
  st.board[14][14] = null;
  st.moveCount = N * N - 1;
  const need = ((14 + 28) % 4) < 2 ? 'black' : 'white';
  st.turn = need;
  act(room, need === 'black' ? 'A' : 'B', { kind: 'move', r: 14, c: 14 });
  assert.strictEqual(lastState(room).winner, 'draw');
  assert.strictEqual(lastState(room).phase, 'game_over');
});

test('rematch swaps colours (score follows the player); leaving resets', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'black' });
  act(room, 'B', { kind: 'sit', seat: 'white' });
  act(room, 'A', { kind: 'resetGame' }); // not over yet: ignored
  assert.strictEqual(room.state.players.black, 'A');
  for (let i = 0; i < 4; i++) { act(room, 'A', { kind: 'move', r: 0, c: i }); act(room, 'B', { kind: 'move', r: 5, c: i }); }
  act(room, 'A', { kind: 'move', r: 0, c: 4 });
  act(room, 'C', { kind: 'resetGame' }); // spectator can't
  assert.strictEqual(room.state.phase, 'game_over');
  act(room, 'B', { kind: 'resetGame' });
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.players.black, 'B');
  assert.strictEqual(room.state.players.white, 'A');
  assert.deepStrictEqual(room.state.score, { black: 0, white: 1 });
  assert.strictEqual(room.state.moveCount, 0);
  plugin.onLeave(room, { clientId: 'A' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.players.white, null);
  assert.deepStrictEqual(room.state.score, { black: 0, white: 0 });
  assert.ok(plugin.isRoomFull(room) === false);
});

test('serializeSnapshot exposes the public state', () => {
  const room = makeRoom();
  const snap = plugin.serializeSnapshot(room);
  assert.strictEqual(snap.board.length, N);
  assert.strictEqual(snap.phase, 'waiting');
});

// ---- engine tactics ----------------------------------------------------------------------------
const pos = (rows, color) => ({ board: boardFrom(rows), color });
const at = (mv) => `${mv.r},${mv.c}`;

test('every level completes its own five', () => {
  const { board } = pos(['', '', '', '', '', '', '', '...xxxx.....o..', '....ooo.o......']);
  for (const level of LEVELS) for (let k = 0; k < 5; k++) {
    const mv = engine.bestMove({ board, color: 'black', level });
    assert.ok(['7,2', '7,7'].includes(at(mv)), `${level} played ${at(mv)}`);
  }
});

test('every level blocks a four (single five-point)', () => {
  // White has a broken four o o _ o o on row 4; black (to move) has nothing urgent.
  const { board } = pos(['', '', '', '', '...oo.oo.......', '', '.....x.x.......', '......x........']);
  for (const level of LEVELS) for (let k = 0; k < 5; k++) {
    const mv = engine.bestMove({ board, color: 'black', level });
    assert.strictEqual(at(mv), '4,5', `${level} played ${at(mv)}`);
  }
});

test('versus an open four, the bot still takes one end (or wins)', () => {
  const { board } = pos(['', '', '', '', '', '', '', '....oooo.......', '...x.x.x.......']);
  for (const level of LEVELS) {
    const mv = engine.bestMove({ board, color: 'black', level });
    assert.ok(['7,3', '7,8'].includes(at(mv)), `${level} played ${at(mv)}`);
  }
});

test('medium+ blocks an open three (or answers with a four)', () => {
  // White open three on row 7 (cols 5-7, both sides wide open); black has two scattered stones.
  const { board } = pos(['', '', '', '', '', '', '', '.....ooo.......', '', '...x...........', '..........x....']);
  const okPoints = ['7,4', '7,8', '7,3', '7,9'];
  for (const level of ['medium', 'hard', 'expert']) for (let k = 0; k < 4; k++) {
    const mv = engine.bestMove({ board, color: 'black', level });
    assert.ok(okPoints.includes(at(mv)), `${level} played ${at(mv)}`);
  }
});

test('hard/expert find a four-three win', () => {
  // Black to move: (7,7) makes a four on row 7 (x x x _ x pattern) plus open three on the column.
  const { board } = pos([
    '', '', '', '',
    '...............',
    '.......x.......',
    '.......x.......',
    '....xxx........',
    '...............',
    '.o.o.o.o.o.....',
  ]);
  for (const level of ['hard', 'expert']) {
    const mv = engine.bestMove({ board, color: 'black', level });
    // (7,7): row 7 becomes ....xxxx (open four) — an immediate winning threat.
    assert.ok(['7,7', '7,3', '3,7'].includes(at(mv)), `${level} played ${at(mv)}`);
  }
});

test('expert finds a VCF (continuous fours) win', () => {
  // Black: two broken threes that chain into fours, white has blocked the open ends so no single
  // open-four exists — only a forcing sequence of fours wins.
  const { board } = pos([
    '', '', '',
    '......o........',
    '.......x.......',
    '.......x.......',
    '.......x.......',
    '...ox.x.x......',
    '.......o.......',
    '........x......',
    '.........x.....',
    '...............',
    '..o.o.o.o......',
  ]);
  const mv = engine.bestMove({ board, color: 'black', level: 'expert' });
  // Any winning first move is fine; verify by self-play that black wins quickly against expert defence.
  const b = board.map((row) => row.slice());
  b[mv.r][mv.c] = 'black';
  let turn = 'white';
  let winner = null;
  for (let ply = 0; ply < 20 && !winner; ply++) {
    const m = engine.bestMove({ board: b, color: turn, level: 'expert', timeMs: 300 });
    b[m.r][m.c] = turn;
    if (plugin._internal.winningLine(b, m.r, m.c, turn)) winner = turn;
    turn = turn === 'black' ? 'white' : 'black';
  }
  assert.strictEqual(winner, 'black');
});

test('engine respects time budget on a busy board', () => {
  const b = emptyBoard();
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 40; k++) {
    const r = 4 + Math.floor(rnd() * 7), c = 4 + Math.floor(rnd() * 7);
    if (!b[r][c]) b[r][c] = k % 2 ? 'white' : 'black';
  }
  for (const level of LEVELS) {
    const t = Date.now();
    const mv = engine.bestMove({ board: b, color: 'black', level });
    const dt = Date.now() - t;
    assert.ok(!b[mv.r][mv.c], 'move on empty point');
    assert.ok(dt < 1500, `${level} took ${dt}ms`);
  }
});

test('empty board opens in the centre', () => {
  assert.strictEqual(at(engine.bestMove({ board: emptyBoard(), color: 'black', level: 'expert' })), '7,7');
});

// Stronger levels should beat weaker ones in self-play.
function playGame(blackLevel, whiteLevel, timeMs) {
  const b = emptyBoard();
  let turn = 'black';
  for (let ply = 0; ply < N * N; ply++) {
    const lv = turn === 'black' ? blackLevel : whiteLevel;
    const m = engine.bestMove({ board: b, color: turn, level: lv, timeMs });
    assert.ok(!b[m.r][m.c]);
    b[m.r][m.c] = turn;
    if (plugin._internal.winningLine(b, m.r, m.c, turn)) return turn;
    turn = turn === 'black' ? 'white' : 'black';
  }
  return 'draw';
}
test('level ladder: stronger level wins most games', () => {
  const pairs = [['medium', 'easy', 4], ['hard', 'medium', 4], ['expert', 'medium', 2]];
  for (const [strong, weak, games] of pairs) {
    let wins = 0;
    for (let g = 0; g < games; g++) {
      const strongBlack = g % 2 === 0;
      const w = strongBlack ? playGame(strong, weak, 250) : playGame(weak, strong, 250);
      if (w === (strongBlack ? 'black' : 'white')) wins++;
    }
    console.log(`  ${strong} vs ${weak}: ${wins}/${games}`);
    assert.ok(wins >= games - 1, `${strong} only won ${wins}/${games} vs ${weak}`);
  }
});

// ---- bots through the plugin --------------------------------------------------------------------
test('bot seat plays at every level, and a reset mid-think is harmless', async () => {
  for (const level of LEVELS) {
    const room = makeRoom();
    act(room, 'A', { kind: 'sit', seat: 'white' });
    act(room, 'A', { kind: 'sit', seat: 'black', bot: true, level });
    assert.strictEqual(room.state.botLevels.black, level);
    await wait(2200);
    assert.strictEqual(room.state.moveCount, 1, `${level} bot moved`);
    assert.strictEqual(room.state.turn, 'white');
    act(room, 'A', { kind: 'move', r: 0, c: 0 });
    // Remove the bot while it's thinking: must not move into the reset board.
    act(room, 'A', { kind: 'removeBot', seat: 'black' });
    await wait(2200);
    assert.strictEqual(room.state.moveCount, 0);
    assert.strictEqual(room.state.phase, 'waiting');
  }
});

test('bot vs bot game runs to completion and rematch swaps', async () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'black', bot: true, level: 'medium' });
  act(room, 'A', { kind: 'sit', seat: 'white', bot: true, level: 'easy' });
  for (let t = 0; t < 120 && room.state.phase === 'playing'; t++) await wait(250);
  assert.strictEqual(room.state.phase, 'game_over');
  assert.ok(room.state.winLine || room.state.winner === 'draw');
  act(room, 'A', { kind: 'setBotLevel', seat: 'white', level: 'expert' });
  assert.strictEqual(room.state.botLevels.white, 'expert');
});

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (err) {
      failures++;
      console.log(`FAIL - ${name}\n  ${err && err.message}`);
    }
  }
  console.log(failures ? `${failures} failed` : 'all passed');
  process.exit(failures ? 1 : 0);
})();
