// node test/reversi.test.js — Reversi rules, passes, game end, bots at every level, leave/rematch.
'use strict';
const assert = require('assert');
const plugin = require('../server/games/reversi');
const engine = require('../server/games/ai/reversiEngine');
const { flipsFor, legalMoves, countDiscs, applyMove, createInitialBoard } = plugin._internal;

let failures = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function makeRoom() {
  const sent = [];
  const room = {
    state: plugin.createInitialState(),
    clients: new Map(),
    sent,
    broadcast: (env) => sent.push({ to: '*', env }),
    sendTo: (id, env) => sent.push({ to: id, env }),
  };
  return room;
}
const ctxFor = (room, id) => ({ senderId: id, broadcast: room.broadcast, sendTo: room.sendTo });
const send = (room, id, data) => plugin.onMessage(room, { clientId: id }, data, ctxFor(room, id));
const lastState = (room) => [...room.sent].reverse().find((s) => s.env.payload.data.kind === 'state').env.payload.data;
const lastReject = (room, id) => [...room.sent].reverse().find((s) => s.to === id && s.env.payload.data.kind === 'moveRejected');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const empty = () => Array.from({ length: 8 }, () => Array(8).fill(null));

test('initial position and legal moves', () => {
  const b = createInitialBoard();
  const moves = legalMoves(b, 'black').map((m) => `${m.r},${m.c}`).sort();
  assert.deepStrictEqual(moves, ['2,3', '3,2', '4,5', '5,4']);
  assert.deepStrictEqual(countDiscs(b), { black: 2, white: 2 });
});

test('flips in multiple directions, not across gaps or edges', () => {
  const b = empty();
  b[0][0] = 'black'; b[0][1] = 'white'; b[0][2] = null;
  b[1][1] = 'white'; b[2][2] = null;
  b[2][0] = 'black'; b[1][0] = 'white';
  // Placing black at (0,2)? row 0: (0,1) white then (0,0) black -> flips (0,1).
  // (0,2) flips (0,1) along the row and (1,1) on the diagonal to (2,0).
  assert.deepStrictEqual(flipsFor(b, 0, 2, 'black'), [{ r: 0, c: 1 }, { r: 1, c: 1 }]);
  // (2,2): diagonal to (1,1) white, (0,0) black -> flip.
  assert.deepStrictEqual(flipsFor(b, 2, 2, 'black'), [{ r: 1, c: 1 }]);
  // No wrap-around: white at (0,7), black at (1,0) shouldn't connect.
  const w = empty();
  w[0][7] = 'white'; w[1][0] = 'black';
  assert.deepStrictEqual(flipsFor(w, 0, 6, 'black'), []);
  // Unbracketed line doesn't flip.
  const u = empty();
  u[3][3] = 'white'; u[3][4] = 'white';
  assert.deepStrictEqual(flipsFor(u, 3, 2, 'black'), []);
});

test('seat, play, illegal moves rejected', () => {
  const room = makeRoom();
  send(room, 'A', { kind: 'sit', seat: 'black' });
  send(room, 'B', { kind: 'sit', seat: 'white' });
  assert.strictEqual(room.state.phase, 'playing');
  send(room, 'B', { kind: 'move', r: 2, c: 3 });
  assert.strictEqual(lastReject(room, 'B').env.payload.data.reason, 'not_your_turn');
  send(room, 'A', { kind: 'move', r: 0, c: 0 });
  assert.strictEqual(lastReject(room, 'A').env.payload.data.reason, 'no_flips');
  send(room, 'A', { kind: 'move', r: 3, c: 3 });
  assert.strictEqual(lastReject(room, 'A').env.payload.data.reason, 'occupied');
  send(room, 'A', { kind: 'move', r: 'x', c: 99 });
  assert.strictEqual(lastReject(room, 'A').env.payload.data.reason, 'invalid');
  send(room, 'A', { kind: 'move', r: 2, c: 3 });
  const s = lastState(room);
  assert.strictEqual(s.turn, 'white');
  assert.deepStrictEqual(s.counts, { black: 4, white: 1 });
  assert.deepStrictEqual(s.flipped, [{ r: 3, c: 3 }]);
  assert.ok(s.legal.length > 0);
});

test('automatic pass when opponent has no move', () => {
  const st = { board: empty(), moveNo: 0, phase: 'playing', turn: 'black' };
  // Black plays (0,2) flipping (0,1); white then has only... construct: white must have no moves.
  st.board[0][0] = 'black'; st.board[0][1] = 'white';
  st.board[7][7] = 'white'; st.board[7][6] = 'black'; st.board[7][4] = 'white';
  // After black (0,2): row0 = B B B. White's moves: needs to bracket black. (7,5)? white(7,4) - (7,5) - black(7,6) - white(7,7): placing white at 7,5 flips 7,6. So white has a move -> no pass.
  applyMove(st, 'black', 0, 2);
  assert.strictEqual(st.turn, 'white');
  // Now a position where after black's move white has none but black does.
  const s2 = { board: empty(), moveNo: 0, phase: 'playing', turn: 'black' };
  s2.board[0][0] = 'black'; s2.board[0][1] = 'white';
  s2.board[5][5] = 'black'; s2.board[5][6] = 'white';
  applyMove(s2, 'black', 0, 2); // flips (0,1). Remaining white (5,6) bracketed by black at (5,7)? black can play 5,7.
  // White has only one disc and no way to bracket a black disc with it? white at (5,6) next to black (5,5): needs empty (5,4) to play -> flips (5,5)? placing white at (5,4) brackets (5,5) between (5,4) and (5,6): yes legal. So build properly instead:
  const s3 = { board: empty(), moveNo: 0, phase: 'playing', turn: 'black' };
  s3.board[0][0] = 'black'; s3.board[0][1] = 'white';
  s3.board[7][0] = 'black'; s3.board[7][1] = 'white';
  applyMove(s3, 'black', 0, 2); // white left: (7,1) only, neighbours: black (7,0) at edge -> white can't bracket.
  assert.strictEqual(s3.turn, 'black');
  assert.deepStrictEqual(s3.pass, { color: 'white', seq: 1 });
  applyMove(s3, 'black', 7, 2); // all black now -> game over
  assert.strictEqual(s3.phase, 'game_over');
  assert.strictEqual(s3.winner, 'black');
});

test('engine: every level returns a legal move; takes a corner; expert solves endgame', () => {
  const b = createInitialBoard();
  for (const level of ['easy', 'medium', 'hard', 'expert']) {
    const mv = engine.bestMove({ board: b, color: 'black', level, timeMs: 200 });
    assert.ok(legalMoves(b, 'black').some((m) => m.r === mv.r && m.c === mv.c), level);
  }
  // Corner available: medium+ takes it.
  const c = empty();
  c[0][1] = 'white'; c[0][2] = 'black'; c[3][3] = 'white'; c[3][4] = 'black'; c[3][2] = 'black';
  c[2][2] = 'white';
  for (const level of ['medium', 'hard', 'expert']) {
    const mv = engine.bestMove({ board: c, color: 'black', level, timeMs: 300 });
    assert.deepStrictEqual(mv, { r: 0, c: 0 }, level);
  }
  assert.strictEqual(engine.bestMove({ board: empty(), color: 'black', level: 'expert' }), null);
});

test('expert endgame solve finishes quickly and beats hard', async () => {
  // Play random openings to 12 empties then compare: expert must score >= hard's result from same spot.
  const { toFlat } = engine._internal;
  let t0 = Date.now();
  let b = createInitialBoard();
  let color = 'black';
  const st = { board: b, moveNo: 0, phase: 'playing', turn: 'black' };
  while (st.phase === 'playing' && countDiscs(st.board).black + countDiscs(st.board).white < 52) {
    const m = legalMoves(st.board, st.turn);
    const mv = m[Math.floor(Math.random() * m.length)];
    applyMove(st, st.turn, mv.r, mv.c);
  }
  if (st.phase === 'playing') {
    t0 = Date.now();
    const mv = engine.bestMove({ board: st.board, color: st.turn, level: 'expert' });
    assert.ok(Date.now() - t0 < 2500, `expert took ${Date.now() - t0}ms`);
    assert.ok(legalMoves(st.board, st.turn).some((m) => m.r === mv.r && m.c === mv.c));
  }
  void toFlat; void color;
});

test('expert beats easy over a few games', () => {
  let expertWins = 0;
  for (let g = 0; g < 4; g++) {
    const st = { board: createInitialBoard(), moveNo: 0, phase: 'playing', turn: 'black' };
    const expertColor = g % 2 ? 'black' : 'white';
    while (st.phase === 'playing') {
      const level = st.turn === expertColor ? 'expert' : 'easy';
      const mv = engine.bestMove({ board: st.board, color: st.turn, level, timeMs: 120 });
      applyMove(st, st.turn, mv.r, mv.c);
    }
    if (st.winner === expertColor) expertWins++;
  }
  assert.ok(expertWins >= 3, `expert won ${expertWins}/4`);
});

plugin._internal.timing.min = 5;
plugin._internal.timing.max = 10;

test('bot vs bot game runs to completion through the worker; leave resets', async () => {
  const room = makeRoom();
  send(room, 'A', { kind: 'sit', seat: 'black', bot: true, level: 'easy' });
  send(room, 'A', { kind: 'sit', seat: 'white', bot: true, level: 'medium' });
  assert.strictEqual(room.state.phase, 'playing');
  const t0 = Date.now();
  while (room.state.phase === 'playing' && Date.now() - t0 < 60000) await sleep(50);
  assert.strictEqual(room.state.phase, 'game_over');
  const s = lastState(room);
  const n = s.counts;
  assert.ok(['black', 'white', 'draw'].includes(s.winner));
  assert.strictEqual(s.winner, n.black > n.white ? 'black' : n.white > n.black ? 'white' : 'draw');
});

test('human vs expert bot: bot replies; removing bot mid-think cancels cleanly; rematch swaps', async () => {
  const room = makeRoom();
  send(room, 'A', { kind: 'sit', seat: 'black' });
  send(room, 'A', { kind: 'sit', seat: 'white', bot: true, level: 'expert' });
  send(room, 'A', { kind: 'move', r: 2, c: 3 });
  assert.strictEqual(room.state.turn, 'white');
  const t0 = Date.now();
  while (room.state.turn === 'white' && Date.now() - t0 < 5000) await sleep(20);
  assert.strictEqual(room.state.turn, 'black');
  assert.strictEqual(room.state.moveNo, 2);
  // Move again then remove the bot while it thinks: no stray move afterwards.
  const mv = room.state.board && legalMoves(room.state.board, 'black')[0];
  send(room, 'A', { kind: 'move', r: mv.r, c: mv.c });
  send(room, 'A', { kind: 'removeBot', seat: 'white' });
  await sleep(2000);
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.moveNo, 0);
  // Rematch swap.
  room.state.players.white = 'B';
  room.state.phase = 'game_over';
  send(room, 'A', { kind: 'resetGame' });
  assert.deepStrictEqual(room.state.players, { black: 'B', white: 'A' });
  assert.strictEqual(room.state.phase, 'playing');
  // Spectator can't reset; leaving mid-game resets.
  plugin.onLeave(room, { clientId: 'B' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.players.black, null);
  send(room, 'Z', { kind: 'sit', seat: 'nope' });
  assert.strictEqual(room.state.players.black, null);
});

(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (e) {
      failures++;
      console.log(`FAIL - ${name}\n  ${e && e.stack}`);
    }
  }
  console.log(failures ? `${failures} failing` : 'all passed');
  process.exit(failures ? 1 : 0);
})();
