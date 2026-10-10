// Crossword: puzzle generation validity, answer secrecy, fill/solve/hint/give-up protocol,
// co-op vs race boards, and bots at every level finishing a puzzle.
// Run: node test/crossword.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/crossword');

const T = plugin._test;
T.BOT_CFG.countdownMs = 0;
const LEVELS = ['easy', 'medium', 'hard', 'expert'];
let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeRoom(ids = ['A', 'B']) {
  const sent = [];
  const room = {
    state: plugin.createInitialState(),
    clients: new Map(ids.map((id) => [id, { nickname: id }])),
    sendTo: (id, m) => sent.push({ to: id, m }),
    broadcast: (m) => sent.push({ to: '*', m }),
  };
  room.sent = sent;
  for (const id of ids) plugin.onJoin(room, { clientId: id, nickname: id });
  return room;
}
const act = (room, id, data) => plugin.onMessage(room, { clientId: id }, data, { senderId: id, broadcast: room.broadcast, sendTo: room.sendTo });
const lastFor = (room, id, kind) => {
  const s = [...room.sent].reverse().find((x) => x.to === id && x.m.payload.data.kind === kind);
  return s && s.m.payload.data;
};
const view = (room, id) => plugin.serializeSnapshot(room, { clientId: id });
const fillWord = (room, id, w, answer = w.answer) => T.wordCells(w).forEach(([r, c], i) => act(room, id, { kind: 'fill', r, c, l: answer[i] }));
// Every string value in the view (keys excluded), to check no answer word leaks.
function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

test('generated puzzles are valid across many seeds and every size', () => {
  for (const size of Object.keys(T.SIZES)) {
    const cfg = T.SIZES[size];
    for (let seed = 1; seed <= 40; seed++) {
      const pz = T.makePuzzle(size, seed * 7919);
      assert.strictEqual(T.validateLayout(pz), '', `${size}/${seed}: ${T.validateLayout(pz)}`);
      assert.ok(pz.words.length >= cfg.words[0] && pz.words.length <= cfg.words[1], `${size}/${seed}: ${pz.words.length} words`);
      assert.ok(pz.rows <= cfg.maxDim && pz.cols <= cfg.maxDim);
      for (const w of pz.words) assert.ok(!new RegExp(`\\b${w.answer}\\b`, 'i').test(w.clue), `clue gives away ${w.answer}: ${w.clue}`);
    }
  }
});

test('snapshot never leaks answers while playing; reveals them in results', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'start', size: 'medium', mode: 'coop' });
  const st = room.state;
  const v = view(room, 'B');
  assert.strictEqual(v.phase, 'playing');
  const strs = new Set(strings(v).map((s) => s.toLowerCase()));
  for (const w of st.puzzle.words) {
    assert.ok(!strs.has(w.answer), `answer ${w.answer} leaked`);
    assert.strictEqual(v.clues[w.id].answer, undefined);
  }
  assert.ok(!JSON.stringify(v).includes('solution'));
  act(room, 'A', { kind: 'giveUp' });
  const v2 = view(room, 'B');
  assert.strictEqual(v2.phase, 'results');
  assert.strictEqual(v2.endReason, 'revealed');
  for (const w of st.puzzle.words) assert.strictEqual(v2.clues[w.id].answer, w.answer);
});

test('co-op: filling a word solves it, credits the filler, locks cells, wrong words are flagged', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'start', size: 'mini', mode: 'coop' });
  const st = room.state;
  const [w0, w1] = st.puzzle.words;
  const wrong = w1.answer.split('').map((ch) => (ch === 'z' ? 'q' : 'z')).join('');
  // Fill w1 wrong (cells shared with w0 are left as w0 needs them so only w1 is wrong).
  fillWord(room, 'B', w1, wrong);
  const wr = lastFor(room, 'B', 'wrong');
  assert.ok(wr && wr.ids.includes(w1.id), 'wrong word flagged');
  assert.ok(!st.board.solved.has(w1.id));
  // Clear and solve w0 by A.
  fillWord(room, 'A', w0);
  assert.strictEqual(st.board.solved.get(w0.id), 'A');
  const a = st.players.get('A');
  assert.strictEqual(a.solved >= 1, true);
  assert.ok(a.score >= w0.len);
  // Locked cells can't be changed by anyone.
  const [r, c] = T.wordCells(w0)[0];
  act(room, 'B', { kind: 'fill', r, c, l: '' });
  assert.strictEqual(st.board.entries.get(`${r},${c}`).l, w0.answer[0]);
  // Both players see the same shared board.
  assert.deepStrictEqual(view(room, 'A').board, view(room, 'B').board);
});

test('co-op: completing every word ends the round and awards the top scorer', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'start', size: 'mini', mode: 'coop' });
  const st = room.state;
  st.puzzle.words.forEach((w, i) => fillWord(room, i % 2 ? 'B' : 'A', w));
  assert.strictEqual(st.phase, 'results');
  assert.strictEqual(st.endReason, 'complete');
  const ps = [...st.players.values()];
  const top = Math.max(...ps.map((p) => p.score));
  for (const p of ps) assert.strictEqual(p.wins, p.score === top ? 1 : 0);
  // Fills after the round are ignored.
  const [r, c] = T.wordCells(st.puzzle.words[0])[0];
  act(room, 'A', { kind: 'fill', r, c, l: 'x' });
  assert.notStrictEqual(st.board.entries.get(`${r},${c}`).l, 'x');
});

test('race: boards are separate, first to finish wins', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'start', size: 'mini', mode: 'race' });
  const st = room.state;
  const w0 = st.puzzle.words[0];
  fillWord(room, 'B', w0);
  assert.ok(st.players.get('B').board.solved.has(w0.id));
  assert.ok(!st.players.get('A').board.solved.has(w0.id));
  assert.strictEqual(view(room, 'A').board.entries.length, 0, 'A must not see B\'s letters');
  const vA = view(room, 'A');
  assert.ok(vA.players.find((p) => p.clientId === 'B').filled >= w0.len);
  for (const w of st.puzzle.words) fillWord(room, 'A', w);
  assert.strictEqual(st.phase, 'results');
  assert.strictEqual(st.winner, 'A');
  assert.strictEqual(st.players.get('A').wins, 1);
  assert.strictEqual(st.players.get('B').wins, 0);
});

test('race: giving up waits for every human, then reveals', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'start', size: 'mini', mode: 'race' });
  act(room, 'A', { kind: 'giveUp' });
  assert.strictEqual(room.state.phase, 'playing');
  const w0 = room.state.puzzle.words[0];
  fillWord(room, 'A', w0);
  assert.ok(!room.state.players.get('A').board.solved.has(w0.id), 'gave-up player can no longer fill');
  act(room, 'B', { kind: 'giveUp' });
  assert.strictEqual(room.state.phase, 'results');
  assert.strictEqual(room.state.endReason, 'revealed');
  for (const p of room.state.players.values()) assert.strictEqual(p.wins, 0);
});

test('hints reveal one correct locked letter, cost a point, and run out', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'start', size: 'large', mode: 'coop' });
  const st = room.state;
  const a = st.players.get('A');
  const w = st.puzzle.words.find((x) => x.len >= 5);
  const [r0, c0] = T.wordCells(w)[0];
  act(room, 'A', { kind: 'fill', r: r0, c: c0, l: w.answer[0] === 'x' ? 'y' : 'x' }); // wrong first letter
  act(room, 'A', { kind: 'hint', id: w.id });
  const e = st.board.entries.get(`${r0},${c0}`);
  assert.strictEqual(e.l, w.answer[0], 'hint corrects the wrong letter');
  assert.strictEqual(e.lock, 2);
  assert.strictEqual(a.score, -1);
  assert.strictEqual(a.hintsLeft, 2);
  act(room, 'A', { kind: 'hint', id: w.id });
  act(room, 'A', { kind: 'hint', id: w.id });
  assert.strictEqual(a.hintsLeft, 0);
  const before = st.board.entries.size;
  act(room, 'A', { kind: 'hint', id: w.id });
  assert.strictEqual(lastFor(room, 'A', 'rejected').reason, 'no_hints');
  assert.strictEqual(st.board.entries.size, before);
  // Hint letters are locked.
  act(room, 'B', { kind: 'fill', r: r0, c: c0, l: '' });
  assert.strictEqual(st.board.entries.get(`${r0},${c0}`).l, w.answer[0]);
});

test('fills during the countdown are rejected', () => {
  T.BOT_CFG.countdownMs = 5000;
  try {
    const room = makeRoom();
    act(room, 'A', { kind: 'start', size: 'mini', mode: 'coop' });
    const [r, c] = T.wordCells(room.state.puzzle.words[0])[0];
    act(room, 'A', { kind: 'fill', r, c, l: 'a' });
    assert.strictEqual(lastFor(room, 'A', 'rejected').reason, 'countdown');
    assert.strictEqual(room.state.board.entries.size, 0);
  } finally { T.BOT_CFG.countdownMs = 0; }
});

test('bad input is ignored without throwing', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'fill', r: 0, c: 0, l: 'a' }); // before any round
  act(room, 'A', null);
  act(room, 'A', { kind: 42 });
  act(room, 'A', { kind: 'start', size: 'galactic', mode: 'chaos' });
  const st = room.state;
  assert.strictEqual(st.size, 'medium');
  assert.strictEqual(st.mode, 'coop');
  act(room, 'B', { kind: 'start', size: 'mini' }); // already playing → ignored
  assert.strictEqual(st.size, 'medium');
  const n = st.board.entries.size;
  for (const bad of [{ r: -1, c: 0, l: 'a' }, { r: 999, c: 0, l: 'a' }, { r: '0', c: 0, l: 'a' }, { r: 0.5, c: 0, l: 'a' }]) act(room, 'A', { kind: 'fill', ...bad });
  const [r, c] = T.wordCells(st.puzzle.words[0])[0];
  for (const l of ['ab', '1', 'é', '<', 7, null]) act(room, 'A', { kind: 'fill', r, c, l });
  assert.ok(st.board.entries.size <= n + 1);
  const e = st.board.entries.get(`${r},${c}`);
  assert.ok(!e || /^[a-z]$/.test(e.l));
  // Block cells are not fillable.
  outer: for (let rr = 0; rr < st.puzzle.rows; rr++) for (let cc = 0; cc < st.puzzle.cols; cc++) {
    if (!st.puzzle.solution[rr][cc]) { act(room, 'A', { kind: 'fill', r: rr, c: cc, l: 'a' }); assert.ok(!st.board.entries.has(`${rr},${cc}`)); break outer; }
  }
  act(room, 'A', { kind: 'hint', id: 'nope' });
  act(room, 'A', { kind: 'cursor', id: 9999 });
  assert.strictEqual(st.players.get('A').cursor, null);
  act(room, 'A', { kind: 'removeBot', clientId: 'B' }); // can't kick humans
  assert.ok(st.players.has('B'));
  act(room, 'Z', { kind: 'start' }); // unknown sender
});

test('co-op cursors are shared; race cursors are hidden', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'start', size: 'mini', mode: 'coop' });
  act(room, 'A', { kind: 'cursor', id: 2 });
  assert.strictEqual(view(room, 'B').players.find((p) => p.clientId === 'A').cursor, 2);
  act(room, 'A', { kind: 'giveUp' });
  act(room, 'A', { kind: 'start', size: 'mini', mode: 'race' });
  act(room, 'A', { kind: 'cursor', id: 2 });
  assert.strictEqual(view(room, 'B').players.find((p) => p.clientId === 'A').cursor, null);
});

test('bots at every level solve a puzzle (co-op and race)', async () => {
  T.BOT_CFG.speedK = 0.0005;
  try {
    for (const mode of ['coop', 'race']) {
      for (const level of LEVELS) {
        const room = makeRoom(['A']);
        act(room, 'A', { kind: 'addBot', level });
        const bot = [...room.state.players.values()].find((p) => p.bot);
        assert.ok(bot && bot.bot === level, `bot added at ${level}`);
        act(room, 'A', { kind: 'start', size: 'mini', mode });
        for (let i = 0; i < 400 && room.state.phase === 'playing'; i++) await sleep(5);
        assert.strictEqual(room.state.phase, 'results', `${mode}/${level}: bot didn't finish`);
        if (mode === 'race') assert.strictEqual(room.state.winner, bot.clientId);
        else assert.strictEqual(bot.solved, room.state.puzzle.words.length);
        // Bot leaves with the last human.
        plugin.onLeave(room, { clientId: 'A' });
        assert.strictEqual(room.state.players.size, 0);
      }
    }
  } finally { T.BOT_CFG.speedK = 1; }
});

test('bot speeds get faster with level', () => {
  const avg = (lv) => (T.BOT_SPEED[lv].ms[0] + T.BOT_SPEED[lv].ms[1]) / 2;
  for (let i = 1; i < LEVELS.length; i++) assert.ok(avg(LEVELS[i]) < avg(LEVELS[i - 1]));
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok   ${name}`); } catch (err) { failures++; console.log(`FAIL ${name}\n     ${err.stack.split('\n').slice(0, 3).join('\n     ')}`); }
  }
  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
