// Arena Duel catch-up perks test: `node test/shooter-perks.test.js` (exit 1 on failure).
'use strict';
const assert = require('assert');
const sh = require('../server/games/shooter');
const { startRoundIntro, beginRound, reloadMs } = sh._test;

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('ok  ', name); } catch (e) { failures++; console.log('FAIL', name, '\n  ', e.message); }
}

function makeRoom(b = 'p2') {
  const room = { state: sh.createInitialState(), clients: new Map() };
  room.state.seats = { a: 'p1', b };
  beginRound(room.state);
  return room;
}
const ctx = (id) => ({ senderId: id, broadcast() {} });
const act = (room, id, data) => sh.onMessage(room, { clientId: id }, data, ctx(id));

test('loser picks a perk during the longer intro; it applies next round', () => {
  const room = makeRoom();
  const st = room.state;
  startRoundIntro(st, 'b');
  assert.strictEqual(st.perkPick, 'b');
  act(room, 'p1', { kind: 'pickPerk', perk: 'armor' }); // winner can't pick
  assert.deepStrictEqual(st.perks.a, []);
  act(room, 'p2', { kind: 'pickPerk', perk: 'armor' });
  act(room, 'p2', { kind: 'pickPerk', perk: 'reload' }); // only one pick per intro
  assert.deepStrictEqual(st.perks.b, ['armor']);
  beginRound(st);
  assert.strictEqual(st.players.b.maxHp, 125);
  assert.strictEqual(st.players.b.hp, 125);
  assert.strictEqual(st.players.a.maxHp, 100);
});

test('no pick in time gets a random unowned perk; reload perk shortens reloads', () => {
  const room = makeRoom();
  const st = room.state;
  st.perks.a = ['doublejump'];
  startRoundIntro(st, 'a');
  beginRound(st);
  assert.strictEqual(st.perks.a.length, 2);
  assert.notStrictEqual(st.perks.a[1], 'doublejump');
  st.players.a.perks = ['reload'];
  assert.ok(reloadMs(st.players.a, 'pistol') < reloadMs(st.players.b, 'pistol'));
});

test('bot loser picks instantly; double jump allows exactly one air jump', () => {
  const room = makeRoom('BOT');
  const st = room.state;
  startRoundIntro(st, 'b');
  assert.strictEqual(st.perkPick, null);
  assert.strictEqual(st.perks.b.length, 1);
  st.perks.a = ['doublejump'];
  beginRound(st);
  const p = st.players.a;
  act(room, 'p1', { kind: 'jump' });
  p.y = 1; p.velY = 1;
  act(room, 'p1', { kind: 'jump' });
  assert.strictEqual(p.velY, 6.5);
  p.velY = 1;
  act(room, 'p1', { kind: 'jump' });
  assert.strictEqual(p.velY, 1);
});

test('resetMatch clears perks', () => {
  const room = makeRoom();
  room.state.perks.a = ['armor'];
  room.state.phase = 'game_over';
  act(room, 'p1', { kind: 'resetGame' });
  assert.deepStrictEqual(room.state.perks, { a: [], b: [] });
});

if (failures) process.exit(1);
