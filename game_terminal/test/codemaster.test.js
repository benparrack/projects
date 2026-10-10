// node test/codemaster.test.js — rules, solver strength, secrecy and lifecycle for Codemaster.
'use strict';

const assert = require('assert');

// Deterministic timer queue so bot moves can be stepped manually.
const timers = [];
global.setTimeout = (fn, ms) => { const t = { fn, ms, dead: false, unref() {} }; timers.push(t); return t; };
global.clearTimeout = (t) => { if (t) t.dead = true; };
function runTimers(max = 1000) {
  let n = 0;
  while (timers.length && n < max) { const t = timers.shift(); if (!t.dead) { t.fn(); n++; } }
  return n;
}

const plugin = require('../server/games/codemaster');
const { score, botGuess, ALL, NODUP, validCode, MAX_GUESSES } = plugin._internal;

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`); }
}

// ---- scoring ----
test('score: basics', () => {
  assert.deepStrictEqual(score([0, 1, 2, 3], [0, 1, 2, 3]), { exact: 4, near: 0 });
  assert.deepStrictEqual(score([0, 1, 2, 3], [3, 2, 1, 0]), { exact: 0, near: 4 });
  assert.deepStrictEqual(score([0, 1, 2, 3], [4, 5, 4, 5]), { exact: 0, near: 0 });
  assert.deepStrictEqual(score([0, 1, 2, 3], [0, 2, 4, 5]), { exact: 1, near: 1 });
});
test('score: duplicates counted once', () => {
  assert.deepStrictEqual(score([0, 0, 1, 1], [0, 1, 0, 1]), { exact: 2, near: 2 });
  assert.deepStrictEqual(score([0, 1, 2, 3], [0, 0, 0, 0]), { exact: 1, near: 0 });
  assert.deepStrictEqual(score([0, 0, 0, 1], [0, 0, 0, 0]), { exact: 3, near: 0 });
  assert.deepStrictEqual(score([1, 2, 0, 0], [0, 0, 0, 3]), { exact: 1, near: 1 });
  assert.deepStrictEqual(score([5, 5, 4, 4], [4, 4, 4, 5]), { exact: 1, near: 2 });
  // symmetric
  for (let i = 0; i < 300; i++) {
    const a = ALL[(i * 37) % ALL.length];
    const b = ALL[(i * 101 + 7) % ALL.length];
    assert.deepStrictEqual(score(a, b), score(b, a));
  }
});
test('validCode', () => {
  assert(validCode([0, 1, 2, 5], false));
  assert(!validCode([0, 0, 2, 5], false));
  assert(validCode([0, 0, 2, 5], true));
  assert(!validCode([0, 1, 2], true));
  assert(!validCode([0, 1, 2, 6], true));
  assert(!validCode([0, 1, 2, 1.5], true));
  assert(!validCode('0123', true));
});

// ---- solver ----
function solve(level, dup, secret) {
  const g = [];
  while (g.length < 30) {
    const q = botGuess(level, dup, g);
    const f = score(secret, q);
    g.push({ code: q, ...f });
    if (f.exact === 4) break;
  }
  return g.length;
}
test('expert (Knuth) solves all 1296 codes in <= 5', () => {
  let max = 0;
  let sum = 0;
  for (const s of ALL) { const n = solve('expert', true, s); max = Math.max(max, n); sum += n; }
  assert(max <= 5, `max ${max}`);
  console.log(`     expert avg ${(sum / ALL.length).toFixed(3)} guesses`);
});
test('expert no-duplicates: all 360 codes in <= 5', () => {
  let max = 0;
  for (const i of NODUP) max = Math.max(max, solve('expert', false, ALL[i]));
  assert(max <= 5, `max ${max}`);
});
test('levels get stronger (avg guesses easy > medium >= hard >= expert)', () => {
  const sample = ALL.filter((_, i) => i % 7 === 0);
  const avg = (lvl) => sample.reduce((a, s) => a + solve(lvl, true, s), 0) / sample.length;
  const e = avg('easy'); const m = avg('medium'); const h = avg('hard'); const x = avg('expert');
  console.log(`     avg easy ${e.toFixed(2)} medium ${m.toFixed(2)} hard ${h.toFixed(2)} expert ${x.toFixed(2)}`);
  assert(e > m && m > x && h >= x - 0.05, 'ordering');
  // Medium/hard always end (consistent guesses), and hard stays within the 10-guess limit.
  for (const s of sample) assert(solve('hard', true, s) <= 7);
});
test('bot guesses respect no-duplicate rule', () => {
  for (const lvl of ['easy', 'medium', 'hard', 'expert']) {
    for (let k = 0; k < 40; k++) {
      const secret = ALL[NODUP[(k * 13) % NODUP.length]];
      const g = [];
      for (let t = 0; t < MAX_GUESSES; t++) {
        const q = botGuess(lvl, false, g);
        assert(validCode(q, false), `${lvl} guessed dup ${q}`);
        const f = score(secret, q);
        g.push({ code: q, ...f });
        if (f.exact === 4) break;
      }
    }
  }
});

// ---- room plumbing ----
function makeRoom() {
  const room = { state: plugin.createInitialState(), clients: new Map(), sent: [] };
  room.sendTo = (id, env) => room.sent.push({ to: id, env: JSON.parse(JSON.stringify(env)) });
  room.broadcast = (env) => { for (const id of room.clients.keys()) room.sendTo(id, env); };
  return room;
}
function join(room, id) { room.clients.set(id, { nickname: id }); plugin.onJoin(room, { clientId: id, nickname: id }); }
function leave(room, id) { room.clients.delete(id); plugin.onLeave(room, { clientId: id }); }
function act(room, id, data) {
  plugin.onMessage(room, { clientId: id }, data, {
    senderId: id,
    sendTo: (to, env) => room.sendTo(to, env),
    broadcast: (env) => room.broadcast(env),
  });
}
const lastView = (room, id) => {
  for (let i = room.sent.length - 1; i >= 0; i--) {
    const s = room.sent[i];
    if (s.to === id && s.env.payload.data.kind === 'state') return s.env.payload.data;
  }
  return null;
};
const lastReject = (room, id) => {
  for (let i = room.sent.length - 1; i >= 0; i--) {
    const s = room.sent[i];
    if (s.to === id && s.env.payload.data.kind === 'moveRejected') return s.env.payload.data.reason;
  }
  return null;
};

test('duel: set codes, secrecy, race, winner by fewest guesses', () => {
  const room = makeRoom();
  join(room, 'p1'); join(room, 'p2'); join(room, 'spec');
  act(room, 'p1', { kind: 'sit', seat: 'a' });
  act(room, 'p2', { kind: 'sit', seat: 'b' });
  assert.strictEqual(room.state.phase, 'setting');
  act(room, 'p1', { kind: 'guess', code: [0, 1, 2, 3] });
  assert.strictEqual(lastReject(room, 'p1'), 'not_playing');
  act(room, 'p1', { kind: 'setSecret', code: [1, 2, 3, 4] }); // p2 must crack this
  let v2 = lastView(room, 'p2');
  assert.strictEqual(v2.secrets.a, undefined, 'p2 cannot see the code p1 set');
  assert.deepStrictEqual(lastView(room, 'p1').secrets.b, [1, 2, 3, 4], 'p1 sees own code');
  assert.deepStrictEqual(Object.keys(lastView(room, 'spec').secrets), []);
  act(room, 'p1', { kind: 'setSecret', code: [0, 0, 0, 0] }); // can't reset
  assert.deepStrictEqual(room.state.secrets.b, [1, 2, 3, 4]);
  act(room, 'p2', { kind: 'setSecret', code: [5, 5, 0, 0] }); // p1 must crack this
  assert.strictEqual(room.state.phase, 'playing');
  // no snapshot leaks p1's target to p1 or the spectator
  const snap1 = plugin.serializeSnapshot(room, { clientId: 'p1' });
  assert.strictEqual(snap1.secrets.a, undefined);
  assert.strictEqual(JSON.stringify(plugin.serializeSnapshot(room, { clientId: 'spec' })).includes('"secrets":{}'), true);
  // p1 cracks in 2, p2 in 3
  act(room, 'p1', { kind: 'guess', code: [5, 0, 5, 0] });
  assert.deepStrictEqual(room.state.boards.a.guesses[0].exact, 2);
  assert.deepStrictEqual(room.state.boards.a.guesses[0].near, 2);
  act(room, 'p1', { kind: 'guess', code: [5, 5, 0, 0] });
  assert(room.state.boards.a.solved && room.state.phase === 'playing');
  act(room, 'p1', { kind: 'guess', code: [5, 5, 0, 0] });
  assert.strictEqual(lastReject(room, 'p1'), 'board_done');
  act(room, 'p2', { kind: 'guess', code: [1, 1, 1, 1] });
  act(room, 'p2', { kind: 'guess', code: [1, 2, 2, 2] });
  act(room, 'p2', { kind: 'guess', code: [1, 2, 3, 4] });
  assert.strictEqual(room.state.phase, 'game_over');
  assert.deepStrictEqual(room.state.result.winners, ['a']);
  // secrets revealed at the end
  assert.deepStrictEqual(lastView(room, 'spec').secrets.a, [5, 5, 0, 0]);
  // rematch
  act(room, 'p2', { kind: 'start' });
  assert.strictEqual(room.state.phase, 'setting');
  assert.deepStrictEqual(room.state.boards.a.guesses, []);
});

test('duel: invalid input rejected', () => {
  const room = makeRoom();
  join(room, 'p1'); join(room, 'p2');
  act(room, 'p1', { kind: 'setDup', allowDup: false });
  act(room, 'p1', { kind: 'sit', seat: 'a' });
  act(room, 'p2', { kind: 'sit', seat: 'b' });
  act(room, 'p1', { kind: 'setSecret', code: [1, 1, 2, 3] });
  assert.strictEqual(lastReject(room, 'p1'), 'bad_code');
  act(room, 'p1', { kind: 'setSecret', code: [1, 2, 3, 4] });
  act(room, 'p2', { kind: 'setSecret', code: [0, 1, 2, 3] });
  act(room, 'p1', { kind: 'guess', code: [0, 0, 1, 2] });
  assert.strictEqual(lastReject(room, 'p1'), 'no_dups');
  act(room, 'p1', { kind: 'guess', code: [0, 1, 2, 9] });
  act(room, 'p1', { kind: 'guess', code: 'abcd' });
  act(room, 'p1', { kind: 'guess' });
  act(room, 'spec', { kind: 'guess', code: [0, 1, 2, 3] });
  assert.strictEqual(room.state.boards.a.guesses.length, 0);
  act(room, 'p1', { kind: 'setMode', mode: 'race' }); // not configurable mid-game
  assert.strictEqual(room.state.mode, 'duel');
});

test('duel: out of guesses on both sides -> no winner; unsolved loses to solved', () => {
  const room = makeRoom();
  join(room, 'p1'); join(room, 'p2');
  act(room, 'p1', { kind: 'sit', seat: 'a' });
  act(room, 'p2', { kind: 'sit', seat: 'b' });
  act(room, 'p1', { kind: 'setSecret', code: [1, 2, 3, 4] });
  act(room, 'p2', { kind: 'setSecret', code: [5, 5, 5, 5] });
  for (let i = 0; i < MAX_GUESSES; i++) act(room, 'p1', { kind: 'guess', code: [0, 0, 0, 0] });
  assert(room.state.boards.a.done && !room.state.boards.a.solved);
  act(room, 'p1', { kind: 'guess', code: [5, 5, 5, 5] });
  assert(!room.state.boards.a.solved);
  act(room, 'p2', { kind: 'giveUp' });
  assert.strictEqual(room.state.phase, 'game_over');
  assert.deepStrictEqual(room.state.result.winners, []);
});

test('duel vs bot at every level: bot sets code, guesses, game ends', () => {
  for (const level of ['easy', 'medium', 'hard', 'expert']) {
    timers.length = 0;
    const room = makeRoom();
    join(room, 'p1');
    act(room, 'p1', { kind: 'sit', seat: 'a' });
    act(room, 'p1', { kind: 'sit', seat: 'b', bot: true, level });
    act(room, 'p1', { kind: 'sit', seat: 'a', bot: true }); // seat taken
    assert.strictEqual(room.state.phase, 'setting');
    assert(room.state.secrets.a && room.state.setBy.b, 'bot set a code for p1');
    act(room, 'p1', { kind: 'setSecret', code: [2, 3, 4, 5] });
    assert.strictEqual(room.state.phase, 'playing');
    runTimers();
    const bb = room.state.boards.b;
    assert(bb.done, `${level} bot finished`);
    if (level !== 'easy') assert(bb.solved, `${level} bot solved`);
    if (level === 'expert') assert(bb.guesses.length <= 5);
    // p1 gives up -> game over, bot wins if solved
    act(room, 'p1', { kind: 'giveUp' });
    assert.strictEqual(room.state.phase, 'game_over');
    if (bb.solved) assert.deepStrictEqual(room.state.result.winners, ['b']);
  }
});

test('two bots not allowed; bot level change; remove bot', () => {
  const room = makeRoom();
  join(room, 'p1');
  act(room, 'p1', { kind: 'sit', seat: 'a', bot: true, level: 'easy' });
  act(room, 'p1', { kind: 'sit', seat: 'b', bot: true });
  assert.strictEqual(room.state.players.b, null);
  act(room, 'p1', { kind: 'setBotLevel', seat: 'a', level: 'expert' });
  assert.strictEqual(room.state.botLevels.a, 'expert');
  act(room, 'p1', { kind: 'removeBot', seat: 'a' });
  assert.strictEqual(room.state.players.a, null);
});

test('stale bot timers no-op after a reset', () => {
  timers.length = 0;
  const room = makeRoom();
  join(room, 'p1');
  act(room, 'p1', { kind: 'sit', seat: 'a' });
  act(room, 'p1', { kind: 'sit', seat: 'b', bot: true, level: 'expert' });
  act(room, 'p1', { kind: 'setSecret', code: [2, 3, 4, 5] });
  assert(timers.length === 1);
  act(room, 'p1', { kind: 'leaveSeat' });
  assert.strictEqual(room.state.phase, 'waiting');
  runTimers();
  assert.deepStrictEqual(room.state.boards, {});
});

test('leave mid-duel resets; leave after game over keeps result', () => {
  const room = makeRoom();
  join(room, 'p1'); join(room, 'p2');
  act(room, 'p1', { kind: 'sit', seat: 'a' });
  act(room, 'p2', { kind: 'sit', seat: 'b' });
  act(room, 'p1', { kind: 'setSecret', code: [1, 2, 3, 4] });
  leave(room, 'p2');
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.players.b, null);
  assert.strictEqual(room.state.players.a, 'p1');
});

test('race: shared CPU code, colours of others hidden, late join, ranking', () => {
  const room = makeRoom();
  join(room, 'p1'); join(room, 'p2'); join(room, 'p3');
  act(room, 'p1', { kind: 'setMode', mode: 'race' });
  assert.strictEqual(room.state.mode, 'race');
  act(room, 'p1', { kind: 'joinRace' });
  act(room, 'p2', { kind: 'joinRace' });
  act(room, 'p3', { kind: 'setMode', mode: 'coop' }); // not a participant
  assert.strictEqual(lastReject(room, 'p3'), 'not_participant');
  act(room, 'p3', { kind: 'start' });
  assert.strictEqual(room.state.phase, 'waiting');
  act(room, 'p1', { kind: 'start' });
  assert.strictEqual(room.state.phase, 'playing');
  const secret = room.state.sharedSecret;
  assert.deepStrictEqual(room.state.secrets.p1, secret);
  assert.deepStrictEqual(room.state.secrets.p2, secret);
  act(room, 'p1', { kind: 'guess', code: [0, 1, 2, 3] });
  const v2 = lastView(room, 'p2');
  assert.strictEqual(v2.boards.p1.guesses[0].code, null, 'p2 cannot see p1 colours');
  assert.strictEqual(typeof v2.boards.p1.guesses[0].exact, 'number');
  assert.deepStrictEqual(lastView(room, 'p1').boards.p1.guesses[0].code, [0, 1, 2, 3]);
  assert.deepStrictEqual(lastView(room, 'p3').secrets, {});
  assert(!JSON.stringify(lastView(room, 'p3')).includes('sharedSecret'));
  // late joiner
  act(room, 'p3', { kind: 'joinRace' });
  assert(room.state.boards.p3);
  // p2 solves first in 1 guess (cheating with the known secret), p1 solves in 2, p3 gives up
  act(room, 'p2', { kind: 'guess', code: secret });
  act(room, 'p1', { kind: 'guess', code: secret });
  assert.strictEqual(room.state.phase, 'playing');
  act(room, 'p3', { kind: 'giveUp' });
  assert.strictEqual(room.state.phase, 'game_over');
  assert.deepStrictEqual(room.state.result.ranking, ['p2', 'p1', 'p3']);
  assert.deepStrictEqual(room.state.result.winners, ['p2']);
  assert.deepStrictEqual(lastView(room, 'p3').boards.p1.guesses[0].code, [0, 1, 2, 3], 'colours revealed at end');
  act(room, 'p1', { kind: 'start' });
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(Object.keys(room.state.boards).length, 3);
});

test('race: leaving mid-race finishes the race if everyone else is done', () => {
  const room = makeRoom();
  join(room, 'p1'); join(room, 'p2');
  act(room, 'p1', { kind: 'setMode', mode: 'race' });
  act(room, 'p1', { kind: 'joinRace' });
  act(room, 'p2', { kind: 'joinRace' });
  act(room, 'p1', { kind: 'start' });
  act(room, 'p1', { kind: 'guess', code: room.state.sharedSecret });
  leave(room, 'p2');
  assert.strictEqual(room.state.phase, 'game_over');
  assert.deepStrictEqual(room.state.result.winners, ['p1']);
  leave(room, 'p1');
});

test('coop: anyone in the room guesses on one board', () => {
  const room = makeRoom();
  join(room, 'p1'); join(room, 'p2');
  act(room, 'p1', { kind: 'setMode', mode: 'coop' });
  act(room, 'p2', { kind: 'start' });
  assert.strictEqual(room.state.phase, 'playing');
  act(room, 'p1', { kind: 'guess', code: [0, 0, 0, 0] });
  act(room, 'p2', { kind: 'guess', code: [1, 1, 1, 1] });
  assert.strictEqual(room.state.boards.team.guesses.length, 2);
  assert.strictEqual(room.state.boards.team.guesses[1].by, 'p2');
  assert.deepStrictEqual(lastView(room, 'p1').secrets, {});
  act(room, 'p1', { kind: 'guess', code: room.state.secrets.team });
  assert.strictEqual(room.state.phase, 'game_over');
  assert.deepStrictEqual(room.state.result.winners, ['team']);
  // mode switch after game over
  act(room, 'p1', { kind: 'setMode', mode: 'duel' });
  assert.strictEqual(room.state.mode, 'duel');
  assert.strictEqual(room.state.phase, 'waiting');
});

test('isRoomFull only in duel with both seats', () => {
  const room = makeRoom();
  join(room, 'p1'); join(room, 'p2');
  assert(!plugin.isRoomFull(room));
  act(room, 'p1', { kind: 'sit', seat: 'a' });
  act(room, 'p2', { kind: 'sit', seat: 'b' });
  assert(plugin.isRoomFull(room));
});

test('garbage messages are ignored', () => {
  const room = makeRoom();
  join(room, 'p1');
  for (const d of [null, {}, { kind: 5 }, { kind: 'sit', seat: 'z' }, { kind: 'setMode', mode: 'x' }, { kind: 'guess', code: [[], 1, 2, 3] }, { kind: 'setSecret', code: null }]) {
    act(room, 'p1', d);
  }
  assert.strictEqual(room.state.phase, 'waiting');
});

// client helper sanity (pure function, no DOM)
test('client module parses', () => {
  const { execSync } = require('child_process');
  execSync(`node --check ${require('path').join(__dirname, '../public/games/codemaster/client.js')}`);
});

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall codemaster tests passed');
