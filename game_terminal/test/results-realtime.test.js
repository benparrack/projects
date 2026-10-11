// End-of-match result reports (server/report.js) for the real-time / party games:
// node test/results-realtime.test.js (exit 1 on failure).
'use strict';
const assert = require('assert');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('ok  ', name); } catch (e) { failures++; console.log('FAIL', name, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); }
}

function makeRoom(plugin, ids = []) {
  const results = [];
  const room = {
    state: plugin.createInitialState(),
    clients: new Map(ids.map((id) => [id, { clientId: id, nickname: id }])),
    sendTo() {},
    broadcast() {},
    onResult: (r) => results.push(r),
  };
  const ctx = (senderId) => ({ senderId, broadcast() {}, sendTo() {} });
  return { room, results, ctx };
}

test('stats metadata on every plugin', () => {
  for (const t of ['drawing', 'gameboy', 'garticphone']) assert.deepStrictEqual(require(`../server/games/${t}`).stats, { none: true });
  for (const t of ['tron', 'shooter']) assert.strictEqual(require(`../server/games/${t}`).stats.rated, true);
  assert.strictEqual(require('../server/games/mazedash').stats.score.better, 'low');
  for (const t of ['slither', 'slope', 'pictionary']) assert.strictEqual(require(`../server/games/${t}`).stats.rated, false);
});

test('tron: one report per round, survivor first then by crash order, bots as BOT', () => {
  const tron = require('../server/games/tron');
  const { room, results, ctx } = makeRoom(tron);
  for (const id of ['a', 'b', 'c']) tron.onJoin(room, { clientId: id, nickname: id });
  tron.onMessage(room, null, { kind: 'addBot', level: 'medium' }, ctx('a'));
  tron.tick(room, ctx('x'));
  room.state.countdownEndAt = 0;
  tron.tick(room, ctx('x'));
  const st = room.state;
  const bot = [...st.players.values()].find((p) => p.bot);
  // b and the bot crash together on the first tick, c a tick later; a survives.
  const b = st.players.get('b');
  Object.assign(b, { x: 0, y: 50, dir: 'left', turnQueue: [] });
  // Box the bot into the top-left corner so every move it can pick is fatal.
  Object.assign(bot, { x: 0, y: 0, dir: 'left', turnQueue: [], trail: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] });
  tron.tick(room, ctx('x'));
  const c = st.players.get('c'); c.x = 0; c.y = 60; c.dir = 'left'; c.turnQueue = [];
  for (let i = 0; i < 5 && st.phase === 'playing'; i++) tron.tick(room, ctx('x'));
  assert.strictEqual(st.phase, 'round_over');
  for (let i = 0; i < 3; i++) tron.tick(room, ctx('x'));
  assert.strictEqual(results.length, 1);
  assert.deepStrictEqual(results[0].placements, [['a'], ['c'], ['b', 'BOT']]);
  assert.strictEqual(results[0].botLevel, 'medium');
});

test('shooter: report once when a player reaches the round target, and on a forfeit', () => {
  const shooter = require('../server/games/shooter');
  const { room, results, ctx } = makeRoom(shooter, ['a', 'b']);
  shooter.onMessage(room, null, { kind: 'sit', seat: 'a' }, ctx('a'));
  shooter.onMessage(room, null, { kind: 'sit', seat: 'b' }, ctx('b'));
  const st = room.state;
  st.wins.a = 2;
  st.players.b.hp = 1;
  shooter.onMessage(room, null, { kind: 'fire', yaw: 0, pitch: 0 }, ctx('a'));
  assert.strictEqual(st.phase, 'game_over');
  shooter.onLeave(room, { clientId: 'b' }); // after game_over: no second report
  assert.deepStrictEqual(results, [{ placements: [['a'], ['b']] }]);

  const r2 = makeRoom(shooter, ['h']);
  r2.room.state = shooter.createInitialState();
  shooter.onMessage(r2.room, null, { kind: 'sit', seat: 'a' }, r2.ctx('h'));
  shooter.onMessage(r2.room, null, { kind: 'sit', seat: 'b', bot: true, level: 'expert' }, r2.ctx('h'));
  r2.room.clients.delete('h');
  shooter.onLeave(r2.room, { clientId: 'h' });
  assert.deepStrictEqual(r2.results, [{ placements: [['BOT'], ['h']], botLevel: 'expert' }]);
});

test('shooter: leaving a seat before the match ends reports nothing', () => {
  const shooter = require('../server/games/shooter');
  const { room, results, ctx } = makeRoom(shooter, ['a', 'b']);
  shooter.onMessage(room, null, { kind: 'sit', seat: 'a' }, ctx('a'));
  shooter.onMessage(room, null, { kind: 'sit', seat: 'b' }, ctx('b'));
  shooter.onMessage(room, null, { kind: 'leaveSeat' }, ctx('b'));
  assert.strictEqual(results.length, 0);
});

test('slope: one report per round, by distance, AFK humans left out', () => {
  const slope = require('../server/games/slope');
  const { room, results } = makeRoom(slope);
  for (const id of ['a', 'b', 'afk']) slope.onJoin(room, { clientId: id, nickname: id });
  slope.onJoin(room, { clientId: 'bot-Ace', nickname: 'Ace', bot: 'hard' });
  slope.tick(room);
  const st = room.state;
  st.raceStartAt = 0;
  slope.tick(room);
  assert.strictEqual(st.phase, 'racing');
  const P = (id) => st.players.get(id);
  Object.assign(P('a'), { s: 300.4, alive: false });
  Object.assign(P('b'), { s: 120, alive: false });
  P('afk').alive = false;
  P('bot-Ace').ball.alive = false; P('bot-Ace').ball.s = 120.7;
  slope.tick(room);
  assert.strictEqual(st.phase, 'results');
  slope.tick(room);
  assert.strictEqual(results.length, 1);
  assert.deepStrictEqual(results[0], { placements: [['a'], ['BOT', 'b']], botLevel: 'hard', scores: { a: 300, b: 120 } });
});

test('mazedash: report once at race end, finishers by time then the rest', () => {
  const maze = require('../server/games/mazedash');
  const { room, results, ctx } = makeRoom(maze, ['a', 'b', 'c']);
  for (const id of ['a', 'b', 'c']) maze.onJoin(room, { clientId: id, nickname: id });
  maze.onMessage(room, null, { kind: 'startRace' }, ctx('a'));
  const st = room.state;
  st.roundStartedAt = Date.now() - 5000;
  // Put a racer next to the exit with an open wall and step in.
  const DIRS = { up: [-1, 0, 'down'], down: [1, 0, 'up'], left: [0, -1, 'right'], right: [0, 1, 'left'] };
  const exitR = st.maze.length - 1; const exitC = st.maze[0].length - 1;
  const [name, [dr, dc, opp]] = Object.entries(DIRS).find(([n]) => st.maze[exitR][exitC][n]);
  const finish = (id) => { Object.assign(st.players.get(id), { r: exitR + dr, c: exitC + dc }); maze.onMessage(room, null, { kind: 'move', direction: opp }, ctx(id)); };
  finish('b');
  st.players.get('b').finishMs = 1000;
  finish('a');
  st.players.get('a').finishMs = 2000;
  assert.strictEqual(results.length, 0);
  room.clients.delete('c');
  maze.onLeave(room, { clientId: 'c' }); // last unfinished racer leaves -> race ends
  maze.onMessage(room, null, { kind: 'move', direction: name }, ctx('a'));
  assert.strictEqual(st.phase, 'results');
  assert.deepStrictEqual(results, [{ placements: [['b'], ['a']], scores: { b: 1000, a: 2000 } }]);
});

test('slither: a long human life reports its peak length; short lives and bots do not', () => {
  const slither = require('../server/games/slither');
  const { room, results, ctx } = makeRoom(slither);
  slither.onJoin(room, { clientId: 'h', nickname: 'h' });
  slither.onJoin(room, { clientId: 'q', nickname: 'q' });
  slither.onJoin(room, { clientId: 'bot-Ace', nickname: 'Ace', bot: 'hard' });
  const st = room.state;
  const out = (s) => { s.points[0].x = -50; };
  const h = st.snakes.get('h');
  h.bornAt = 0; h.peak = 777.6; h.length = 500;
  out(h); out(st.snakes.get('q')); out(st.snakes.get('bot-Ace'));
  st.snakes.get('bot-Ace').bornAt = 0;
  // Freeze movement so the heads stay out of bounds this tick.
  for (const s of st.snakes.values()) { s.angle = Math.PI; s.targetAngle = Math.PI; s.points.forEach((p) => { p.x = -50; }); }
  slither.tick(room, ctx('x'));
  slither.tick(room, ctx('x'));
  assert.deepStrictEqual(results, [{ placements: [['h']], scores: { h: 778 } }]);
});

test('pictionary: a full drawer rotation reports the points earned in it', () => {
  const pic = require('../server/games/pictionary');
  const { room, results, ctx } = makeRoom(pic, ['a', 'b', 'c']);
  for (const id of ['a', 'b', 'c']) pic.onJoin(room, { clientId: id, nickname: id });
  const st = room.state;
  st.scores = { a: 50 }; // earlier rotations don't count
  st.rotationBaseScores = { a: 50 };
  const play = (guessers) => {
    pic.onMessage(room, null, { kind: 'chooseWord', word: st.wordOptions[0] }, ctx(st.drawerClientId));
    for (const g of guessers) pic.onMessage(room, room.clients.get(g), { kind: 'guess', text: st.word }, ctx(g));
    pic._test.startNewRound(room);
  };
  assert.strictEqual(st.drawerClientId, 'a');
  play(['b']); // b +3, a +2
  play(['a', 'c']); // a +3, c +1, b +2
  assert.strictEqual(results.length, 0);
  play([]); // c draws, nobody guesses; next round starts a new rotation
  assert.strictEqual(results.length, 1);
  assert.deepStrictEqual(results[0], { placements: [['a', 'b'], ['c']], scores: { a: 5, b: 5, c: 1 } });
});

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
