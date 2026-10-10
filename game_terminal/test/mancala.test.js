// Mancala rules, engine and plugin flow: node test/mancala.test.js (exit 1 on failure).
'use strict';
const assert = require('assert');
const E = require('../server/games/ai/mancalaEngine');
const mancala = require('../server/games/mancala');

let failures = 0;
const queue = [];
const test = (name, fn) => queue.push({ name, fn });

const total = (p) => p.reduce((a, b) => a + b, 0);
const board = (gold, goldStore, jade, jadeStore) => [...gold, goldStore, ...jade, jadeStore];

function makeRoom() {
  const room = { state: mancala.createInitialState(), clients: new Map(), sent: [], rejects: [] };
  room.broadcast = (m) => room.sent.push(m);
  room.sendTo = (id, m) => room.sent.push(m);
  const ctx = (senderId) => ({
    senderId,
    broadcast: room.broadcast,
    sendTo: (id, m) => { if (m.payload.data.kind === 'moveRejected') room.rejects.push(m.payload.data.reason); room.sent.push(m); },
  });
  const act = (id, data) => mancala.onMessage(room, { clientId: id }, data, ctx(id));
  for (const id of ['a', 'b', 'c']) room.clients.set(id, { nickname: id });
  return { room, act };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ rules
test('initial board: 4 stones in each of 12 pits, empty stores', () => {
  const p = E.initialPits();
  assert.deepStrictEqual(p, [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
});

test('last stone in own store gives an extra turn', () => {
  const p = E.initialPits();
  const r = E.sow(p, 0, 2, 'capture', []);
  assert.strictEqual(r.extra, true);
  assert.deepStrictEqual(p, [4, 4, 0, 5, 5, 5, 1, 4, 4, 4, 4, 4, 4, 0]);
  const q = E.initialPits();
  assert.strictEqual(E.sow(q, 1, 9, 'capture', []).extra, true);
  assert.strictEqual(q[13], 1);
});

test('sowing skips the opponent store (both sides)', () => {
  const p = board([0, 0, 0, 0, 0, 10], 0, [1, 1, 1, 1, 1, 1], 0);
  const rec = [];
  E.sow(p, 0, 5, 'capture', rec);
  assert.strictEqual(p[13], 0, 'jade store untouched');
  assert.ok(!rec.some((s) => s.t === 'drop' && s.pit === 13));
  assert.ok(rec.some((s) => s.t === 'drop' && s.pit === 6));
  const q = board([1, 1, 1, 1, 1, 1], 0, [0, 0, 0, 0, 0, 10], 0);
  E.sow(q, 1, 12, 'capture', []);
  assert.strictEqual(q[6], 0, 'gold store untouched');
});

test('capture: last stone in own empty pit takes it plus the opposite pit', () => {
  const p = board([0, 1, 0, 3, 3, 3], 0, [3, 3, 3, 5, 3, 3], 0); // pit 2 opposite pit 10 (=5)
  const rec = [];
  const r = E.sow(p, 0, 1, 'capture', rec);
  assert.strictEqual(r.captured, 6);
  assert.strictEqual(p[6], 6);
  assert.strictEqual(p[2], 0);
  assert.strictEqual(p[10], 0);
  assert.strictEqual(r.extra, false);
  assert.ok(rec.some((s) => s.t === 'capture' && s.n === 6));
});

test('no capture when the opposite pit is empty, or the empty pit is the opponent\'s', () => {
  const p = board([0, 1, 0, 3, 3, 3], 0, [3, 3, 3, 0, 3, 3], 0);
  assert.strictEqual(E.sow(p, 0, 1, 'capture', []).captured, 0);
  assert.strictEqual(p[2], 1);
  const q = board([0, 0, 0, 0, 0, 2], 0, [0, 3, 3, 3, 3, 3], 5); // lands in jade's empty pit 7
  assert.strictEqual(E.sow(q, 0, 5, 'capture', []).captured, 0);
});

test('avalanche: landing in a non-empty pit relays; no captures', () => {
  const p = E.initialPits();
  const rec = [];
  const r = E.sow(p, 0, 0, 'avalanche', rec);
  assert.ok(rec.filter((s) => s.t === 'pick').length >= 2, 'relayed at least once');
  assert.strictEqual(total(p), 48);
  assert.strictEqual(r.captured, 0);
  const q = board([0, 1, 0, 3, 3, 3], 0, [3, 3, 3, 5, 3, 3], 0);
  const rr = E.sow(q, 0, 1, 'avalanche', []);
  assert.strictEqual(rr.captured, 0);
  assert.strictEqual(q[2], 1, 'empty pit landing just ends the turn');
});

test('game ends when a row empties; remaining stones go to their owner', () => {
  const p = board([0, 0, 0, 0, 0, 1], 20, [2, 0, 3, 0, 0, 1], 21);
  const rec = [];
  const r = E.sow(p, 0, 5, 'capture', rec);
  assert.strictEqual(r.over, true);
  assert.strictEqual(r.extra, false);
  assert.strictEqual(p[6], 21);
  assert.strictEqual(p[13], 27);
  assert.ok(rec.some((s) => s.t === 'sweep' && s.side === 1 && s.n === 6));
  for (let i = 0; i < 14; i++) if (i !== 6 && i !== 13) assert.strictEqual(p[i], 0);
});

test('random playouts conserve 48 stones and always terminate (both modes)', () => {
  for (const mode of ['capture', 'avalanche']) {
    for (let g = 0; g < 1500; g++) {
      const p = E.initialPits();
      let side = g % 2;
      let moves = 0;
      for (;;) {
        const legal = E.legalMoves(p, side);
        assert.ok(legal.length, 'side to move always has a move until the game ends');
        const r = E.sow(p, side, legal[Math.floor(Math.random() * legal.length)], mode, null);
        assert.strictEqual(total(p), 48);
        assert.ok(p.every((n) => n >= 0));
        moves++;
        assert.ok(moves < 1000);
        if (r.over) break;
        if (!r.extra) side = 1 - side;
      }
    }
  }
});

// ------------------------------------------------------------------ engine
test('every level returns a legal move', () => {
  for (const mode of ['capture', 'avalanche']) {
    for (const level of ['easy', 'medium', 'hard', 'expert']) {
      for (let g = 0; g < 10; g++) {
        const p = E.initialPits();
        for (let k = 0; k < g; k++) {
          const s = k % 2;
          const l = E.legalMoves(p, s);
          if (!l.length) break;
          const r = E.sow(p, s, l[0], mode, null);
          if (r.over) break;
        }
        for (const side of [0, 1]) {
          const legal = E.legalMoves(p, side);
          if (!legal.length) continue;
          const { pit } = E.bestMove({ pits: p, side, mode, level, timeMs: 40 });
          assert.ok(legal.includes(pit), `${mode}/${level} gave ${pit}`);
        }
      }
    }
  }
});

test('hard/expert finish a won endgame', () => {
  for (const level of ['hard', 'expert']) {
    // Gold has 24 banked; pit 5 → store (extra turn) then pit 1 → empty pit 2 captures 7 = win.
    const p = board([0, 1, 0, 0, 0, 1], 24, [0, 0, 0, 6, 0, 2], 14);
    const first = E.bestMove({ pits: p, side: 0, mode: 'capture', level, timeMs: 200 }).pit;
    const q = p.slice();
    const r = E.sow(q, 0, first, 'capture', null);
    if (r.extra) E.sow(q, 0, E.bestMove({ pits: q, side: 0, mode: 'capture', level, timeMs: 200 }).pit, 'capture', null);
    assert.ok(q[6] >= 25 && q[6] > q[13] || q[6] + E.legalMoves(q, 0).reduce((a, i) => a + q[i], 0) > 24, `${level} line ${first}`);
  }
});

function playMatch(levelA, levelB, games, mode, timeMs) {
  let aWins = 0;
  let bWins = 0;
  for (let g = 0; g < games; g++) {
    const p = E.initialPits();
    const aSide = g % 2;
    let side = 0;
    for (;;) {
      const level = side === aSide ? levelA : levelB;
      const { pit } = E.bestMove({ pits: p, side, mode, level, timeMs });
      const r = E.sow(p, side, pit, mode, null);
      if (r.over) break;
      if (!r.extra) side = 1 - side;
    }
    const a = p[E.storeOf(aSide)];
    const b = p[E.storeOf(1 - aSide)];
    if (a > b) aWins++;
    else if (b > a) bWins++;
  }
  return { aWins, bWins };
}

test('strength ladder: expert > medium > easy, hard > easy', () => {
  const r1 = playMatch('expert', 'easy', 12, 'capture', 40);
  assert.ok(r1.aWins >= 10, `expert vs easy ${JSON.stringify(r1)}`);
  const r2 = playMatch('hard', 'easy', 12, 'capture', 40);
  assert.ok(r2.aWins >= 9, `hard vs easy ${JSON.stringify(r2)}`);
  const r3 = playMatch('medium', 'easy', 20, 'capture', 40);
  assert.ok(r3.aWins > r3.bWins, `medium vs easy ${JSON.stringify(r3)}`);
  const r4 = playMatch('expert', 'easy', 8, 'avalanche', 60);
  assert.ok(r4.aWins >= 7, `expert vs easy (avalanche) ${JSON.stringify(r4)}`);
  console.log('     ladder', JSON.stringify({ r1, r2, r3, r4 }));
});

// ------------------------------------------------------------------ plugin
test('two humans sit → playing; gold moves first', () => {
  const { room, act } = makeRoom();
  act('a', { kind: 'sit', seat: 'gold' });
  assert.strictEqual(room.state.phase, 'waiting');
  act('a', { kind: 'sit', seat: 'jade' }); // can't take both seats
  assert.strictEqual(room.state.players.jade, null);
  act('b', { kind: 'sit', seat: 'jade' });
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.turn, 'gold');
  assert.ok(mancala.isRoomFull(room));
});

test('move validation and turn handling (extra turn keeps the turn)', () => {
  const { room, act } = makeRoom();
  act('a', { kind: 'sit', seat: 'gold' });
  act('b', { kind: 'sit', seat: 'jade' });
  act('b', { kind: 'move', pit: 7 });
  assert.deepStrictEqual(room.rejects.pop(), 'not_your_turn');
  act('a', { kind: 'move', pit: 8 });
  assert.deepStrictEqual(room.rejects.pop(), 'not_your_pit');
  for (const bad of [6, -1, 1.5, 'x', null, 99]) {
    act('a', { kind: 'move', pit: bad });
    assert.ok(room.rejects.pop(), `rejected ${bad}`);
  }
  act('c', { kind: 'move', pit: 0 });
  assert.strictEqual(room.rejects.pop(), 'not_seated');
  act('a', { kind: 'move', pit: 2 }); // 4 stones from pit 2 → store: extra turn
  assert.strictEqual(room.state.turn, 'gold');
  assert.strictEqual(room.state.lastMove.extra, true);
  act('a', { kind: 'move', pit: 2 });
  assert.strictEqual(room.rejects.pop(), 'empty_pit');
  act('a', { kind: 'move', pit: 0 });
  assert.strictEqual(room.state.turn, 'jade');
  const lm = room.state.lastMove;
  assert.strictEqual(lm.id, 2);
  assert.strictEqual(lm.steps[0].t, 'pick');
  assert.strictEqual(lm.steps.filter((s) => s.t === 'drop').length, 4);
  assert.strictEqual(total(room.state.pits), 48);
});

test('full game through the plugin ends with a winner and a tally; rematch alternates first mover', () => {
  const { room, act } = makeRoom();
  act('a', { kind: 'sit', seat: 'gold' });
  act('b', { kind: 'sit', seat: 'jade' });
  let guard = 0;
  while (room.state.phase === 'playing' && guard++ < 500) {
    const seat = room.state.turn;
    const side = seat === 'gold' ? 0 : 1;
    const legal = E.legalMoves(room.state.pits, side);
    act(seat === 'gold' ? 'a' : 'b', { kind: 'move', pit: legal[legal.length - 1] });
  }
  assert.strictEqual(room.state.phase, 'game_over');
  const g = room.state.pits[6];
  const j = room.state.pits[13];
  assert.strictEqual(g + j, 48);
  assert.strictEqual(room.state.winner, g > j ? 'gold' : j > g ? 'jade' : 'draw');
  const sc = room.state.score;
  assert.strictEqual(sc.gold + sc.jade + sc.draws, 1);
  act('a', { kind: 'move', pit: 0 });
  assert.strictEqual(room.rejects.pop(), 'not_playing');
  act('c', { kind: 'resetGame' }); // spectators can't restart
  assert.strictEqual(room.state.phase, 'game_over');
  act('b', { kind: 'resetGame' });
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.turn, 'jade');
  assert.strictEqual(room.state.moveCount, 0);
  assert.strictEqual(room.state.score.gold + room.state.score.jade + room.state.score.draws, 1, 'tally survives a rematch');
});

test('mode can only change between games, and only by a seated player', () => {
  const { room, act } = makeRoom();
  act('c', { kind: 'setMode', mode: 'avalanche' }); // nobody seated: anyone may
  assert.strictEqual(room.state.mode, 'avalanche');
  act('a', { kind: 'sit', seat: 'gold' });
  act('c', { kind: 'setMode', mode: 'capture' });
  assert.strictEqual(room.state.mode, 'avalanche', 'spectator blocked once someone sits');
  act('a', { kind: 'setMode', mode: 'nope' });
  assert.strictEqual(room.state.mode, 'avalanche');
  act('a', { kind: 'setMode', mode: 'capture' });
  assert.strictEqual(room.state.mode, 'capture');
  act('b', { kind: 'sit', seat: 'jade' });
  act('a', { kind: 'setMode', mode: 'avalanche' });
  assert.strictEqual(room.state.mode, 'capture', 'locked during play');
});

test('leaving mid-game resets to waiting and clears the tally; snapshot is public state', () => {
  const { room, act } = makeRoom();
  act('a', { kind: 'sit', seat: 'gold' });
  act('b', { kind: 'sit', seat: 'jade' });
  act('a', { kind: 'move', pit: 0 });
  mancala.onLeave(room, { clientId: 'b' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.players.jade, null);
  assert.strictEqual(room.state.players.gold, 'a');
  assert.deepStrictEqual(room.state.pits, E.initialPits());
  const snap = mancala.serializeSnapshot(room);
  assert.ok(snap.pits && snap.players && snap.mode);
  mancala.onLeave(room, { clientId: 'zzz' }); // non-seated leave is a no-op
  assert.strictEqual(room.state.players.gold, 'a');
  act('a', { kind: 'leaveSeat' });
  assert.strictEqual(room.state.players.gold, null);
});

test('bot plays its turns (worker or in-process fallback) and the game runs to the end', async () => {
  const { room, act } = makeRoom();
  act('a', { kind: 'sit', seat: 'jade' });
  act('a', { kind: 'sit', seat: 'gold', bot: true, level: 'easy' }); // seated humans may add a bot
  assert.strictEqual(room.state.players.gold, 'BOT');
  assert.strictEqual(room.state.botLevels.gold, 'easy');
  assert.strictEqual(room.state.phase, 'playing');
  // Bot moves first; wait for it.
  const t0 = Date.now();
  while (room.state.turn === 'gold' && Date.now() - t0 < 8000) await sleep(50);
  assert.strictEqual(room.state.turn, 'jade', 'bot finished its turn(s)');
  assert.ok(room.state.moveCount >= 1);
  assert.strictEqual(total(room.state.pits), 48);
  act('a', { kind: 'setBotLevel', seat: 'gold', level: 'expert' });
  assert.strictEqual(room.state.botLevels.gold, 'expert');
});

test('removing a bot mid-think cancels its move cleanly', async () => {
  const { room, act } = makeRoom();
  act('a', { kind: 'sit', seat: 'jade' });
  act('a', { kind: 'sit', seat: 'gold', bot: true, level: 'hard' });
  act('a', { kind: 'removeBot', seat: 'gold' });
  assert.strictEqual(room.state.phase, 'waiting');
  await sleep(1600);
  assert.strictEqual(room.state.moveCount, 0, 'no stale bot move');
  assert.deepStrictEqual(room.state.pits, E.initialPits());
});

test('bot vs bot game completes without errors', async () => {
  const { room, act } = makeRoom();
  act('c', { kind: 'sit', seat: 'gold', bot: true, level: 'easy' });
  act('c', { kind: 'sit', seat: 'jade', bot: true, level: 'medium' });
  // Speed up: drive the bots' search directly instead of waiting for animation-paced timers.
  let guard = 0;
  while (room.state.phase === 'playing' && guard++ < 400) {
    const seat = room.state.turn;
    const { pit } = E.bestMove({ pits: room.state.pits, side: seat === 'gold' ? 0 : 1, mode: room.state.mode, level: 'easy', timeMs: 10 });
    mancala._internals.applyMove(room.state, seat, pit);
  }
  assert.strictEqual(room.state.phase, 'game_over');
  assert.strictEqual(total(room.state.pits), 48);
  room.state.gen++; // invalidate the real bot timer that was scheduled at sit time
});

test('animMs grows with the number of steps', () => {
  const { animMs } = mancala._internals;
  assert.strictEqual(animMs([]), 0);
  assert.ok(animMs([{ t: 'pick' }, { t: 'drop' }, { t: 'drop' }]) > animMs([{ t: 'pick' }, { t: 'drop' }]));
});

(async () => {
  for (const { name, fn } of queue) {
    try { await fn(); console.log('ok  ', name); } catch (e) { failures++; console.log('FAIL', name, '\n    ', e.stack.split('\n').slice(0, 4).join('\n     ')); }
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
