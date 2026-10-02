// Chess notation + post-game review (RECAP): node test/chess.test.js (exit 1 on failure).
// Runs the real engine worker for the analysis tests (~10s).
'use strict';
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const chess = require('../server/games/chess');

const { sanOf, fenOf } = chess._internals;

let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function makeRoom() {
  const room = { state: chess.createInitialState(), clients: new Map() };
  const inbox = new Map(); // clientId -> [data]
  const push = (id, env) => { if (!inbox.has(id)) inbox.set(id, []); inbox.get(id).push(env.payload.data); };
  room.sendTo = (id, env) => push(id, env);
  room.broadcast = (env) => { for (const id of room.clients.keys()) push(id, env); };
  const ctx = (senderId) => ({ senderId, broadcast: room.broadcast, sendTo: room.sendTo });
  const join = (id) => room.clients.set(id, { clientId: id, nickname: id });
  const send = (id, data) => chess.onMessage(room, room.clients.get(id), data, ctx(id));
  const msgs = (id, kind) => (inbox.get(id) || []).filter((d) => !kind || d.kind === kind);
  return { room, join, send, msgs, inbox };
}

const sq = (name) => ({ r: 8 - Number(name[1]), c: name.charCodeAt(0) - 97 });
const mv = (a, b, promotion) => ({ kind: 'move', from: sq(a), to: sq(b), promotion });

function seated() {
  const t = makeRoom();
  t.join('w'); t.join('b'); t.join('spec');
  t.send('w', { kind: 'sit', seat: 'white' });
  t.send('b', { kind: 'sit', seat: 'black' });
  assert.strictEqual(t.room.state.phase, 'playing');
  return t;
}

function play(t, moves) {
  moves.forEach(([a, b, p], i) => {
    const before = t.room.state.moveHistory.length;
    t.send(i % 2 === 0 ? 'w' : 'b', mv(a, b, p));
    assert.strictEqual(t.room.state.moveHistory.length, before + 1, `move ${a}-${b} rejected`);
  });
}

const SCHOLAR = [['e2', 'e4'], ['e7', 'e5'], ['f1', 'c4'], ['b8', 'c6'], ['d1', 'h5'], ['g8', 'f6'], ['h5', 'f7']];

async function waitFor(fn, ms = 40000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

function emptyPos(pieces, turn = 'white') {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const [name, color, type] of pieces) { const s = sq(name); board[s.r][s.c] = { color, type }; }
  return { board, turn, castlingRights: { white: { kingSide: false, queenSide: false }, black: { kingSide: false, queenSide: false } }, enPassantTarget: null };
}
const legal = (pos, a, b) => chess._internals.getLegalMoves(pos.board, pos.turn, pos).find((m) => m.from.r === sq(a).r && m.from.c === sq(a).c && m.to.r === sq(b).r && m.to.c === sq(b).c);

test('SAN for a game: pawn moves, piece moves, capture + mate suffix', () => {
  const t = seated();
  play(t, SCHOLAR);
  assert.deepStrictEqual(t.room.state.moveHistory.map((m) => m.san), ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']);
  assert.strictEqual(t.room.state.phase, 'game_over');
  assert.strictEqual(t.room.state.winReason, 'checkmate');
});

test('FENs: start, after e4 (ep square), counters', () => {
  const t = seated();
  play(t, [['e2', 'e4'], ['g8', 'f6'], ['g1', 'f3']]);
  const fens = t.room.state.positions.map((p) => p.fen);
  assert.strictEqual(fens[0], 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.strictEqual(fens[1], 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
  assert.strictEqual(fens[2], 'rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2');
  assert.strictEqual(fens[3], 'rnbqkb1r/pppppppp/5n2/8/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 2 2');
});

test('SAN disambiguation, castling, promotion', () => {
  let pos = emptyPos([['e1', 'white', 'king'], ['e8', 'black', 'king'], ['b1', 'white', 'knight'], ['f3', 'white', 'knight']]);
  assert.strictEqual(sanOf(pos, legal(pos, 'b1', 'd2')), 'Nbd2');
  pos = emptyPos([['h1', 'white', 'king'], ['h8', 'black', 'king'], ['a1', 'white', 'rook'], ['a5', 'white', 'rook']]);
  assert.strictEqual(sanOf(pos, legal(pos, 'a1', 'a3')), 'R1a3');
  pos = emptyPos([['h1', 'white', 'king'], ['h7', 'black', 'king'], ['b2', 'white', 'queen'], ['d2', 'white', 'queen'], ['b4', 'white', 'queen']]);
  assert.strictEqual(sanOf(pos, legal(pos, 'b2', 'd4')), 'Qb2d4');
  pos = emptyPos([['e1', 'white', 'king'], ['h1', 'white', 'rook'], ['a8', 'black', 'king']]);
  pos.castlingRights.white.kingSide = true;
  assert.strictEqual(sanOf(pos, legal(pos, 'e1', 'g1')), 'O-O');
  pos = emptyPos([['a1', 'white', 'king'], ['e7', 'white', 'pawn'], ['h8', 'black', 'king']]);
  assert.strictEqual(sanOf(pos, legal(pos, 'e7', 'e8'), 'queen'), 'e8=Q+');
  assert.strictEqual(sanOf(pos, legal(pos, 'e7', 'e8'), 'knight'), 'e8=N');
  assert.ok(fenOf(pos, 0, 1).startsWith('7k/4P3/8/8/8/8/8/K7 w - -'));
});

test('no review before a game has ended', () => {
  const t = seated();
  assert.strictEqual(chess.serializeSnapshot(t.room).review, null);
  t.send('spec', { kind: 'reviewRequest' });
  assert.strictEqual(t.msgs('spec', 'reviewUnavailable').length, 1);
});

test('review: archive, streamed analysis, best move + mate evals', async () => {
  const t = seated();
  play(t, SCHOLAR);
  const snap = chess.serializeSnapshot(t.room);
  assert.deepStrictEqual(snap.review, { gameId: snap.gameId, plies: 7 });
  t.send('spec', { kind: 'reviewRequest', gameId: snap.gameId });
  const [data] = t.msgs('spec', 'reviewData');
  assert.ok(data, 'reviewData sent');
  assert.strictEqual(data.moves.length, 7);
  assert.strictEqual(data.fens.length, 8);
  assert.strictEqual(data.moves[6].san, 'Qxf7#');
  // Only the requester gets the review stream.
  assert.strictEqual(t.msgs('w', 'reviewData').length, 0);
  await waitFor(() => t.msgs('spec', 'reviewAnalysis').length === 8);
  const entries = t.msgs('spec', 'reviewAnalysis').map((d) => d.entry);
  assert.deepStrictEqual(entries.map((e) => e.index), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepStrictEqual(entries[7].eval, { mate: 0, winner: 'white' });
  // After 3...Nf6?? White mates in one with Qxf7#.
  assert.strictEqual(entries[6].best.san, 'Qxf7#');
  assert.deepStrictEqual(entries[6].eval, { mate: 1 });
  for (const e of entries.slice(0, 7)) assert.ok(e.eval && e.best && e.best.san, `entry ${e.index} has eval + best`);
  // A second viewer gets the cached analysis immediately, with no re-run.
  t.send('w', { kind: 'reviewRequest', gameId: snap.gameId });
  const [d2] = t.msgs('w', 'reviewData');
  assert.strictEqual(d2.analysis.filter(Boolean).length, 8);
  assert.strictEqual(d2.done, true);

  // Client-side classification of the same data.
  const rv = await import(pathToFileURL(path.join(__dirname, '../public/games/chess/review.js')).href);
  const analysis = entries;
  assert.strictEqual(rv.classifyMove(data.moves[6], analysis[6], analysis[7]), 'best');
  assert.strictEqual(rv.classifyMove(data.moves[5], analysis[5], analysis[6]), 'blunder', 'Nf6 allows mate');
  assert.strictEqual(rv.formatEval({ mate: 1 }), '+M1');
  assert.strictEqual(rv.formatEval({ mate: 0, winner: 'white' }), '1-0');
  assert.strictEqual(rv.formatEval({ cp: -125 }), '−1.3');
  // FEN round trip with the server's board.
  assert.deepStrictEqual(rv.fenToBoard(data.fens[7]), t.room.state.board);
  assert.strictEqual(rv.fenTurn(data.fens[7]), 'black');
  assert.strictEqual(rv.clampIndex(99, 7), 7);
  assert.strictEqual(rv.clampIndex(-3, 7), 0);
});

test('classification thresholds', async () => {
  const rv = await import(pathToFileURL(path.join(__dirname, '../public/games/chess/review.js')).href);
  const m = { color: 'white', from: sq('e2'), to: sq('e4') };
  const best = { from: sq('d2'), to: sq('d4') };
  const at = (cp) => ({ eval: { cp }, best });
  assert.strictEqual(rv.classifyMove(m, { eval: { cp: 30 }, best: { from: sq('e2'), to: sq('e4') } }, at(0)), 'best');
  assert.strictEqual(rv.classifyMove(m, at(30), at(25)), 'best');
  assert.strictEqual(rv.classifyMove(m, at(30), at(-10)), 'good');
  assert.strictEqual(rv.classifyMove(m, at(30), at(-90)), 'inaccuracy');
  assert.strictEqual(rv.classifyMove(m, at(30), at(-200)), 'mistake');
  assert.strictEqual(rv.classifyMove(m, at(30), at(-600)), 'blunder');
  // Black's point of view flips.
  assert.strictEqual(rv.classifyMove({ ...m, color: 'black' }, at(-30), at(600)), 'blunder');
  assert.strictEqual(rv.classifyMove(m, at(30), null), null);
  // Already totally winning: dropping from +15 to +9 is not a blunder.
  assert.strictEqual(rv.classifyMove(m, at(1500), at(900)), 'good');
});

test('review survives the opponent leaving, ends when a new game starts', async () => {
  const t = seated();
  play(t, [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]);
  assert.strictEqual(t.room.state.winReason, 'checkmate');
  const gameId = t.room.state.gameId;
  t.send('spec', { kind: 'reviewRequest', gameId });
  // Black leaves: board resets to waiting but the last game stays reviewable.
  t.room.clients.delete('b');
  chess.onLeave(t.room, { clientId: 'b' });
  assert.strictEqual(t.room.state.phase, 'waiting');
  assert.strictEqual(chess.serializeSnapshot(t.room).review.gameId, gameId);
  // A new game starts (bot sits): the archive is dropped and analysis stops streaming.
  t.send('w', { kind: 'sit', seat: 'black', bot: true, level: 'easy' });
  assert.strictEqual(t.room.state.phase, 'playing');
  assert.strictEqual(chess.serializeSnapshot(t.room).review, null);
  const n = t.msgs('spec', 'reviewAnalysis').length;
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(t.msgs('spec', 'reviewAnalysis').length <= n + 1, 'at most the in-flight entry is dropped, nothing more streams');
  for (const d of t.msgs('spec', 'reviewAnalysis').slice(n)) assert.notStrictEqual(t.room.state.lastGame, d);
  t.send('spec', { kind: 'reviewRequest', gameId });
  assert.strictEqual(t.msgs('spec', 'reviewUnavailable').length, 1);
});

test('rematch (resetGame) drops the review; stale gameId requests are refused', () => {
  const t = seated();
  play(t, SCHOLAR);
  const old = t.room.state.gameId;
  t.send('b', { kind: 'resetGame' });
  assert.strictEqual(t.room.state.phase, 'playing');
  assert.notStrictEqual(t.room.state.gameId, old);
  assert.strictEqual(chess.serializeSnapshot(t.room).review, null);
  t.send('spec', { kind: 'reviewRequest', gameId: old });
  assert.strictEqual(t.msgs('spec', 'reviewUnavailable').length, 1);
});

test('resignation and the bot path also archive the game', async () => {
  const t = seated();
  play(t, [['e2', 'e4']]);
  t.send('b', { kind: 'resign' });
  const snap = chess.serializeSnapshot(t.room);
  assert.deepStrictEqual(snap.review, { gameId: snap.gameId, plies: 1 });
  // Bot game ending: white bot vs black bot would run long — instead check the bot's moves carry SAN.
  const u = makeRoom();
  u.join('h');
  u.send('h', { kind: 'sit', seat: 'black' });
  u.send('h', { kind: 'sit', seat: 'white', bot: true, level: 'easy' });
  await waitFor(() => u.room.state.moveHistory.length === 1, 10000);
  assert.ok(/^[a-hNBRQKO]/.test(u.room.state.moveHistory[0].san), 'bot move has SAN');
  assert.strictEqual(u.room.state.positions.length, 2);
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); console.log('ok  ', name); } catch (e) { failures++; console.log('FAIL', name, '\n    ', e.stack.split('\n').slice(0, 4).join('\n     ')); }
  }
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})();
