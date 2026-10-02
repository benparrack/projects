// TRON scoreboard + round flow: node test/tron.test.js (exit 1 on failure).
'use strict';
const assert = require('assert');
const tron = require('../server/games/tron');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('ok  ', name); } catch (e) { failures++; console.log('FAIL', name, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); }
}

function makeRoom() {
  const room = { state: tron.createInitialState() };
  const sent = [];
  const ctx = (senderId) => ({ senderId, broadcast: (m) => sent.push(m), sendTo() {} });
  return { room, sent, ctx };
}
const join = (room, id, nick = id) => tron.onJoin(room, { clientId: id, nickname: nick });
const lastView = (sent) => sent[sent.length - 1].payload.data.view;

// Advance time-gated phases by rewinding the stored timestamps instead of sleeping.
function runToPlaying(room, ctx) {
  tron.tick(room, ctx('x')); // waiting -> countdown
  assert.strictEqual(room.state.phase, 'countdown');
  room.state.countdownEndAt = 0;
  tron.tick(room, ctx('x')); // countdown -> playing
  assert.strictEqual(room.state.phase, 'playing');
}
function runRound(room, ctx, maxTicks = 5000) {
  for (let i = 0; i < maxTicks && room.state.phase === 'playing'; i++) tron.tick(room, ctx('x'));
  assert.strictEqual(room.state.phase, 'round_over');
}
function finishRoundOver(room, ctx) {
  room.state.roundOverAt = 0;
  tron.tick(room, ctx('x'));
  assert.strictEqual(room.state.phase, 'waiting');
}

test('new players start at 0-0 and the summary carries scores', () => {
  const { room, sent, ctx } = makeRoom();
  join(room, 'a'); join(room, 'b');
  tron.tick(room, ctx('a'));
  const v = lastView(sent);
  assert.strictEqual(v.roundsPlayed, 0);
  for (const p of v.players) assert.deepStrictEqual([p.wins, p.draws, p.rounds], [0, 0, 0]);
});

test('survivor gets a win, everyone a round played; persists into the next round', () => {
  const { room, sent, ctx } = makeRoom();
  join(room, 'a'); join(room, 'b');
  runToPlaying(room, ctx);
  // a (top-left, heading right) keeps going; b (bottom-right, heading left) turns down into the wall.
  tron.onMessage(room, null, { kind: 'steer', direction: 'down' }, ctx('b'));
  runRound(room, ctx);
  const st = room.state;
  assert.strictEqual(st.winnerId, 'a');
  assert.strictEqual(st.players.get('a').wins, 1);
  assert.strictEqual(st.players.get('b').wins, 0);
  assert.strictEqual(st.players.get('a').rounds, 1);
  assert.strictEqual(st.players.get('b').rounds, 1);
  assert.strictEqual(lastView(sent).roundsPlayed, 1);
  assert.strictEqual(lastView(sent).roundOver.winnerId, 'a');
  finishRoundOver(room, ctx);
  assert.strictEqual(st.players.get('a').wins, 1, 'score survives the reset between rounds');
  runToPlaying(room, ctx);
  tron.onMessage(room, null, { kind: 'steer', direction: 'up' }, ctx('a'));
  runRound(room, ctx);
  assert.strictEqual(st.winnerId, 'b');
  assert.deepStrictEqual([st.players.get('a').wins, st.players.get('b').wins], [1, 1]);
  assert.strictEqual(st.roundsPlayed, 2);
});

test('simultaneous crash = draw for the cycles alive on the last tick only', () => {
  const { room, ctx } = makeRoom();
  join(room, 'a'); join(room, 'b'); join(room, 'c');
  runToPlaying(room, ctx);
  const st = room.state;
  const [a, b, c] = ['a', 'b', 'c'].map((id) => st.players.get(id));
  // c dies first (straight into the top wall from its corner by turning up).
  c.x = 5; c.y = 0; c.dir = 'up';
  tron.tick(room, ctx('x'));
  assert.strictEqual(c.alive, false);
  // a and b both drive into the same empty cell next tick: head-on.
  a.x = 60; a.y = 50; a.dir = 'right'; a.turnQueue = [];
  b.x = 62; b.y = 50; b.dir = 'left'; b.turnQueue = [];
  tron.tick(room, ctx('x'));
  assert.strictEqual(st.phase, 'round_over');
  assert.strictEqual(st.isDraw, true);
  assert.deepStrictEqual([a.draws, b.draws, c.draws], [1, 1, 0]);
  assert.deepStrictEqual([a.wins, b.wins, c.wins], [0, 0, 0]);
  assert.deepStrictEqual(st.drawIds.sort(), ['a', 'b']);
});

test('leaver loses their record; others keep theirs', () => {
  const { room, ctx } = makeRoom();
  join(room, 'a'); join(room, 'b');
  runToPlaying(room, ctx);
  tron.onMessage(room, null, { kind: 'steer', direction: 'down' }, ctx('b'));
  runRound(room, ctx);
  tron.onLeave(room, { clientId: 'b' });
  assert.ok(!room.state.players.has('b'));
  assert.strictEqual(room.state.players.get('a').wins, 1);
  tron.onLeave(room, { clientId: 'a' });
  assert.strictEqual(room.state.roundsPlayed, 0, 'empty room forgets the round count');
});

test('leaving mid-round awards the remaining player the round', () => {
  const { room, ctx } = makeRoom();
  join(room, 'a'); join(room, 'b'); join(room, 'c');
  runToPlaying(room, ctx);
  tron.onLeave(room, { clientId: 'b' });
  tron.onLeave(room, { clientId: 'c' });
  tron.tick(room, ctx('x'));
  assert.strictEqual(room.state.phase, 'round_over');
  assert.strictEqual(room.state.players.get('a').wins, 1);
});

test('RESET SCORES zeroes everyone; bots cannot trigger it', () => {
  const { room, ctx } = makeRoom();
  join(room, 'a'); join(room, 'b');
  runToPlaying(room, ctx);
  tron.onMessage(room, null, { kind: 'steer', direction: 'down' }, ctx('b'));
  runRound(room, ctx);
  tron.onMessage(room, null, { kind: 'addBot', level: 'easy' }, ctx('a'));
  const botId = [...room.state.players.keys()].find((id) => id.startsWith('bot-'));
  assert.ok(botId);
  tron.onMessage(room, null, { kind: 'resetScores' }, ctx(botId));
  assert.strictEqual(room.state.players.get('a').wins, 1);
  tron.onMessage(room, null, { kind: 'resetScores' }, ctx('b'));
  for (const p of room.state.players.values()) assert.deepStrictEqual([p.wins, p.draws, p.rounds], [0, 0, 0]);
  assert.strictEqual(room.state.roundsPlayed, 0);
  tron.onMessage(room, null, { kind: 'resetScores' }, ctx('nobody')); // unknown sender: ignored, no throw
});

test('bots accumulate scores in bot-only rounds with a human spectating the board', () => {
  const { room, ctx } = makeRoom();
  join(room, 'h');
  for (const lv of ['easy', 'medium', 'hard', 'expert']) tron.onMessage(room, null, { kind: 'addBot', level: lv }, ctx('h'));
  const st = room.state;
  st.players.get('h').x = null;
  let rounds = 0;
  for (let r = 0; r < 3; r++) {
    runToPlaying(room, ctx);
    // the human just drives off the map immediately
    tron.onMessage(room, null, { kind: 'steer', direction: 'up' }, ctx('h'));
    runRound(room, ctx, 20000);
    rounds++;
    finishRoundOver(room, ctx);
  }
  const total = [...st.players.values()].reduce((s, p) => s + p.wins + p.draws, 0);
  assert.ok(total >= rounds, 'each round produced a win or draws');
  assert.strictEqual(st.roundsPlayed, rounds);
  for (const p of st.players.values()) assert.strictEqual(p.rounds, rounds);
});

test('snapshot includes scoreboard fields', () => {
  const { room } = makeRoom();
  join(room, 'a');
  const snap = tron.serializeSnapshot(room);
  assert.strictEqual(snap.roundsPlayed, 0);
  assert.strictEqual(snap.players[0].wins, 0);
});

(async () => {
  // Client helper: standings sort order.
  const { pathToFileURL } = require('url');
  const path = require('path');
  try {
    const mod = await import(pathToFileURL(path.join(__dirname, '../public/games/tron/client.js')).href).catch(() => null);
    if (mod && mod.sortedStandings) {
      test('client sortedStandings: wins, draws, fewer rounds, name', () => {
        const order = mod.sortedStandings([
          { nickname: 'z', wins: 1, draws: 0, rounds: 3 },
          { nickname: 'new', wins: 0, draws: 0, rounds: 0 },
          { nickname: 'y', wins: 2, draws: 0, rounds: 3 },
          { nickname: 'x', wins: 1, draws: 1, rounds: 3 },
          { nickname: 'lost', wins: 0, draws: 0, rounds: 3 },
        ]).map((p) => p.nickname);
        assert.deepStrictEqual(order, ['y', 'x', 'z', 'new', 'lost']);
      });
    } else console.log('skip client import (browser-only module graph)');
  } catch (e) { console.log('skip client import:', e.message); }
  if (failures) { console.log(`${failures} failing`); process.exit(1); }
  console.log('all passed');
})();
