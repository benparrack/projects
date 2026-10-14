// End-of-match result reports + replays for the board games (chess, checkers, connect4, reversi,
// gomoku, mancala, dotsboxes, blockade, backgammon, codemaster): exactly one report per finished
// match with the right placements/scores/botLevel, and replayFrames(replay) rebuilding the match.
// Run: node test/results-board.test.js (exit 1 on failure). Bot games run on real timers (~30s).
'use strict';

const assert = require('assert');

let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function makeRoom(plugin, ids = ['A', 'B', 'S']) {
  const room = { state: plugin.createInitialState(), clients: new Map(), results: [] };
  for (const id of ids) room.clients.set(id, { clientId: id, nickname: id });
  room.sendTo = () => {};
  room.broadcast = () => {};
  room.onResult = (r) => room.results.push(r);
  const send = (id, data) => plugin.onMessage(room, room.clients.get(id), data, { senderId: id, broadcast: room.broadcast, sendTo: room.sendTo });
  return { room, send, st: () => room.state };
}

async function waitFor(fn, ms = 60000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

// One report; frames = moves + 1 (setup header, if any, counted via `header`); the last frame
// agrees with the live spectator snapshot on `keys`.
function checkReplay(plugin, room, keys, header = 0) {
  assert.strictEqual(room.results.length, 1, 'exactly one report');
  const { replay } = room.results[0];
  const frames = plugin.replayFrames(replay);
  assert.strictEqual(frames.length, replay.length - header + 1, 'one frame per move + the start');
  const live = JSON.parse(JSON.stringify(plugin.serializeSnapshot(room, null)));
  const last = frames[frames.length - 1];
  for (const k of keys) assert.deepStrictEqual(last[k], live[k], `last frame ${k}`);
  return frames;
}

// ---- chess ----
{
  const chess = require('../server/games/chess');
  const sq = (n) => ({ r: 8 - Number(n[1]), c: n.charCodeAt(0) - 97 });
  const play = (t, moves) => moves.forEach((m, i) => t.send(i % 2 ? 'B' : 'A', { kind: 'move', from: sq(m.slice(0, 2)), to: sq(m.slice(2, 4)) }));
  const seated = () => {
    const t = makeRoom(chess);
    t.send('A', { kind: 'sit', seat: 'white' });
    t.send('B', { kind: 'sit', seat: 'black' });
    return t;
  };
  const KEYS = ['board', 'turn', 'winner', 'winReason', 'moveHistory', 'inCheck', 'phase'];

  test('chess: checkmate -> winner first, UCI replay, frames rebuild the game', () => {
    const t = seated();
    play(t, ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']);
    assert.deepStrictEqual(t.room.results[0].placements, [['A'], ['B']]);
    assert.deepStrictEqual(t.room.results[0].replay, ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']);
    assert.strictEqual(t.room.results[0].botLevel, undefined);
    checkReplay(chess, t.room, KEYS);
    t.send('A', { kind: 'resign' }); // game over already: no second report
    assert.strictEqual(t.room.results.length, 1);
    assert.deepStrictEqual(chess.stats, { rated: true });
  });

  test('chess: stalemate is a shared place; rematch reports again; abort does not', () => {
    const t = seated();
    play(t, ['e2e3', 'a7a5', 'd1h5', 'a8a6', 'h5a5', 'h7h5', 'h2h4', 'a6h6', 'a5c7', 'f7f6', 'c7d7', 'e8f7', 'd7b7', 'd8d3', 'b7b8', 'd3h7', 'b8c8', 'f7g6', 'c8e6']);
    assert.strictEqual(t.st().winReason, 'stalemate');
    assert.deepStrictEqual(t.room.results[0].placements, [['A', 'B']]);
    checkReplay(chess, t.room, KEYS);
    t.send('A', { kind: 'resetGame' });
    t.send('A', { kind: 'resign' });
    assert.strictEqual(t.room.results.length, 2);
    assert.deepStrictEqual(t.room.results[1].placements, [['B'], ['A']]);
    t.send('A', { kind: 'resetGame' });
    play(t, ['e2e4']);
    chess.onLeave(t.room, t.room.clients.get('B'));
    assert.strictEqual(t.room.results.length, 2, 'leaving mid-game resets without a result');
  });

  test('chess: promotion survives the replay', () => {
    const t = seated();
    play(t, ['a2a4', 'b7b5', 'a4b5', 'a7a6', 'b5a6', 'c8b7', 'a6b7', 'g8f6']);
    t.send('A', { kind: 'move', from: sq('b7'), to: sq('a8'), promotion: 'knight' });
    t.send('A', { kind: 'resign' });
    assert.strictEqual(t.room.results[0].replay[8], 'b7a8n');
    const frames = checkReplay(chess, t.room, ['board', 'moveHistory']);
    assert.strictEqual(frames[9].board[0][0].type, 'knight');
  });
}

// ---- checkers ----
{
  const checkers = require('../server/games/checkers');
  test('checkers: last capture wins; replay legs rebuild the board', () => {
    const t = makeRoom(checkers);
    t.send('A', { kind: 'sit', seat: 'black' });
    t.send('B', { kind: 'sit', seat: 'red' });
    const st = t.st();
    // A few real moves first (replayable from the start position)...
    t.send('A', { kind: 'move', from: { r: 2, c: 1 }, to: { r: 3, c: 0 } });
    t.send('B', { kind: 'move', from: { r: 5, c: 0 }, to: { r: 4, c: 1 } });
    assert.strictEqual(st.moves.length, 2, 'moves accepted');
    const frames = checkers.replayFrames(st.moves);
    assert.strictEqual(frames.length, 3);
    assert.deepStrictEqual(frames[2].board, JSON.parse(JSON.stringify(st.board)));
    // ...then a contrived endgame: black jumps red's only piece.
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) st.board[r][c] = null;
    st.board[3][2] = { color: 'black', king: false };
    st.board[4][3] = { color: 'red', king: false };
    st.turn = 'black';
    t.send('A', { kind: 'move', from: { r: 3, c: 2 }, to: { r: 5, c: 4 } });
    assert.strictEqual(st.phase, 'game_over');
    assert.strictEqual(t.room.results.length, 1);
    assert.deepStrictEqual(t.room.results[0].placements, [['A'], ['B']]);
    assert.deepStrictEqual(t.room.results[0].replay.length, 3);
    t.send('A', { kind: 'resetGame' });
    assert.deepStrictEqual(st.moves, []);
  });
}

// ---- connect4 ----
{
  const c4 = require('../server/games/connect4');
  const KEYS = ['board', 'turn', 'winner', 'lastMove', 'phase'];
  const seated = () => {
    const t = makeRoom(c4);
    t.send('A', { kind: 'sit', seat: 'red' });
    t.send('B', { kind: 'sit', seat: 'yellow' });
    return t;
  };
  const drop = (t, col) => t.send(t.st().players[t.st().turn], { kind: 'move', col });

  test('connect4: vertical four wins; replay [first, ...cols]', () => {
    const t = seated();
    for (const c of [0, 1, 0, 1, 0, 1, 0]) drop(t, c);
    assert.deepStrictEqual(t.room.results[0].placements, [['A'], ['B']]);
    assert.deepStrictEqual(t.room.results[0].replay, ['red', 0, 1, 0, 1, 0, 1, 0]);
    checkReplay(c4, t.room, KEYS, 1);
    // Rematch flips the opener; the replay records it.
    t.send('A', { kind: 'resetGame' });
    for (const c of [3, 4, 3, 4, 3, 4, 3]) drop(t, c);
    assert.strictEqual(t.room.results.length, 2);
    assert.deepStrictEqual(t.room.results[1].placements, [['B'], ['A']]);
    assert.strictEqual(t.room.results[1].replay[0], 'yellow');
    t.room.results.shift();
    checkReplay(c4, t.room, KEYS, 1);
  });

  test('connect4: full board draw', () => {
    const t = seated();
    for (const c of [5, 2, 2, 6, 4, 5, 3, 0, 3, 4, 1, 0, 5, 2, 4, 4, 0, 0, 1, 3, 3, 3, 6, 2, 1, 5, 3, 1, 1, 6, 5, 1, 2, 2, 4, 6, 6, 4, 5, 0, 6, 0]) drop(t, c);
    assert.strictEqual(t.st().phase, 'game_over');
    assert.deepStrictEqual(t.room.results[0].placements, [['A', 'B']]);
    checkReplay(c4, t.room, KEYS, 1);
  });

  test('connect4: bot game reports BOT + level', async () => {
    const t = makeRoom(c4);
    t.send('A', { kind: 'sit', seat: 'red' });
    t.send('A', { kind: 'sit', seat: 'yellow', bot: true, level: 'easy' });
    const st = t.st();
    while (st.phase === 'playing') {
      await waitFor(() => st.phase !== 'playing' || st.turn === 'red');
      if (st.phase !== 'playing') break;
      drop(t, [0, 1, 2, 3, 4, 5, 6].find((c) => st.board[0][c] === null));
    }
    const r = t.room.results[0];
    assert.strictEqual(r.botLevel, 'easy');
    assert.ok(r.placements.flat().includes('BOT') && r.placements.flat().includes('A'));
    checkReplay(c4, t.room, KEYS, 1);
  });
}

// ---- reversi ----
{
  const rv = require('../server/games/reversi');
  rv._internal.timing.min = 5;
  rv._internal.timing.max = 10;
  test('reversi: bot game to the end, disc scores, replay', async () => {
    const t = makeRoom(rv);
    t.send('A', { kind: 'sit', seat: 'black' });
    t.send('A', { kind: 'sit', seat: 'white', bot: true, level: 'medium' });
    const st = t.st();
    while (st.phase === 'playing') {
      await waitFor(() => st.phase !== 'playing' || st.turn === 'black');
      if (st.phase !== 'playing') break;
      const m = rv._internal.legalMoves(st.board, 'black')[0];
      t.send('A', { kind: 'move', r: m.r, c: m.c });
    }
    const r = t.room.results[0];
    const n = rv._internal.countDiscs(st.board);
    assert.deepStrictEqual(r.scores, { A: n.black, BOT: n.white });
    assert.strictEqual(r.botLevel, 'medium');
    const want = st.winner === 'draw' ? [['A', 'BOT']] : st.winner === 'black' ? [['A'], ['BOT']] : [['BOT'], ['A']];
    assert.deepStrictEqual(r.placements, want);
    checkReplay(rv, t.room, ['board', 'winner', 'counts', 'moveNo', 'lastMove', 'phase']);
    assert.deepStrictEqual(rv.stats.score, { label: 'DISCS', better: 'high', format: 'int' });
  });
}

// ---- gomoku ----
{
  const gm = require('../server/games/gomoku');
  test('gomoku: five in a row; replay r*15+c', () => {
    const t = makeRoom(gm);
    t.send('A', { kind: 'sit', seat: 'black' });
    t.send('B', { kind: 'sit', seat: 'white' });
    for (let i = 0; i < 5; i++) {
      t.send('A', { kind: 'move', r: 7, c: i });
      if (i < 4) t.send('B', { kind: 'move', r: 8, c: i });
    }
    assert.deepStrictEqual(t.room.results[0].placements, [['A'], ['B']]);
    assert.strictEqual(t.room.results[0].replay.length, 9);
    checkReplay(gm, t.room, ['board', 'winner', 'winLine', 'lastMove', 'moveCount', 'phase']);
    t.send('A', { kind: 'resetGame' }); // colours swap: B is black now
    for (let i = 0; i < 5; i++) {
      t.send('B', { kind: 'move', r: 0, c: i });
      if (i < 4) t.send('A', { kind: 'move', r: 1, c: i });
    }
    assert.deepStrictEqual(t.room.results[1].placements, [['B'], ['A']]);
  });
}

// ---- mancala ----
{
  const mc = require('../server/games/mancala');
  const E = require('../server/games/ai/mancalaEngine');
  for (const mode of ['capture', 'avalanche']) {
    test(`mancala (${mode}): full game, store scores, replay [mode, ...pits]`, () => {
      const t = makeRoom(mc);
      t.send('A', { kind: 'setMode', mode });
      t.send('A', { kind: 'sit', seat: 'gold' });
      t.send('B', { kind: 'sit', seat: 'jade' });
      const st = t.st();
      for (let i = 0; st.phase === 'playing' && i < 500; i++) {
        const side = st.turn === 'gold' ? 0 : 1;
        const legal = E.legalMoves(st.pits, side);
        t.send(st.players[st.turn], { kind: 'move', pit: legal[i % legal.length] });
      }
      const r = t.room.results[0];
      assert.strictEqual(r.scores.A + r.scores.B, 48);
      assert.strictEqual(r.replay[0], mode);
      const want = r.scores.A === r.scores.B ? [['A', 'B']] : r.scores.A > r.scores.B ? [['A'], ['B']] : [['B'], ['A']];
      assert.deepStrictEqual(r.placements, want);
      checkReplay(mc, t.room, ['pits', 'winner', 'turn', 'moveCount', 'lastMove', 'mode', 'phase'], 1);
    });
  }
}

// ---- dots and boxes ----
{
  const db = require('../server/games/dotsboxes');
  const { geometry, edgeCoords } = db._internal;
  const KEYS = ['lines', 'boxes', 'scores', 'winners', 'turnIdx', 'lastLine', 'moveCount', 'phase', 'seats'];
  test('dotsboxes: 3 players, places by boxes, replay', () => {
    const t = makeRoom(db, ['A', 'B', 'C', 'S']);
    t.send('A', { kind: 'setSize', size: 4 }); // ignored: not seated yet
    for (const id of ['A', 'B', 'C']) t.send(id, { kind: 'sit' });
    t.send('A', { kind: 'setSize', size: 4 });
    t.send('A', { kind: 'startGame' });
    const st = t.st();
    const g = geometry(4);
    while (st.phase === 'playing') {
      const e = st.edges.indexOf(0);
      t.send(st.seats[st.turnIdx], { kind: 'move', ...edgeCoords(g, e) });
    }
    const r = t.room.results[0];
    assert.deepStrictEqual(r.scores, { A: st.scores[0], B: st.scores[1], C: st.scores[2] });
    const flat = r.placements.flat();
    assert.deepStrictEqual(flat.slice().sort(), ['A', 'B', 'C']);
    for (let i = 1; i < r.placements.length; i++) assert.ok(r.scores[r.placements[i - 1][0]] > r.scores[r.placements[i][0]]);
    assert.deepStrictEqual(r.replay[0], { size: 4, seats: ['A', 'B', 'C'], first: 0 });
    checkReplay(db, t.room, KEYS, 1);
  });

  test('dotsboxes: vs bot reports BOT + level', async () => {
    const t = makeRoom(db);
    t.send('A', { kind: 'sit' });
    t.send('A', { kind: 'setSize', size: 4 });
    t.send('A', { kind: 'addBot', level: 'expert' });
    t.send('A', { kind: 'startGame' });
    const st = t.st();
    const g = geometry(4);
    while (st.phase === 'playing') {
      await waitFor(() => st.phase !== 'playing' || st.seats[st.turnIdx] === 'A');
      if (st.phase !== 'playing') break;
      t.send('A', { kind: 'move', ...edgeCoords(g, st.edges.indexOf(0)) });
    }
    const r = t.room.results[0];
    assert.strictEqual(r.botLevel, 'expert');
    assert.deepStrictEqual(r.placements.flat().sort(), ['A', 'BOT']);
    checkReplay(db, t.room, KEYS, 1);
  });
}

// ---- blockade ----
{
  const bk = require('../server/games/blockade');
  const E = require('../server/games/ai/blockadeEngine');
  test('blockade: race to goal with walls; replay rebuilds walls + pawns', () => {
    const t = makeRoom(bk);
    t.send('A', { kind: 'sit', seat: 'p1' });
    t.send('B', { kind: 'sit', seat: 'p2' });
    const st = t.st();
    for (let i = 0; st.phase === 'playing' && i < 400; i++) {
      const seat = st.turn;
      const plan = E.bestTurn({ pawns: st.pawns, walls: st.walls, left: st.left }, seat, 'easy');
      if (st.step === 'move') t.send(st.players[seat], { kind: 'move', pawn: plan.move.pawn, to: plan.move.to });
      if (st.phase === 'playing' && st.step === 'wall' && st.turn === seat) {
        let w = plan.wall && st.left[seat][plan.wall.o] && E.wallLegal(st.walls, st.pawns, plan.wall.o, plan.wall.r, plan.wall.c) ? plan.wall : null;
        for (let r = 0; !w && r < E.ROWS - 1; r++) for (let c = 0; !w && c < E.WC; c++) if (st.left[seat].h && E.wallLegal(st.walls, st.pawns, 'h', r, c)) w = { o: 'h', r, c };
        t.send(st.players[seat], { kind: 'wall', ...w });
      }
    }
    const r = t.room.results[0];
    assert.deepStrictEqual(r.placements, st.winner === 'p1' ? [['A'], ['B']] : [['B'], ['A']]);
    assert.ok(r.replay.some((a) => typeof a[0] === 'string'), 'walls recorded');
    checkReplay(bk, t.room, ['pawns', 'H', 'V', 'wallOwner', 'left', 'turn', 'step', 'winner', 'lastMove', 'lastWall', 'moveCount', 'phase'], 1);
  });
}

// ---- backgammon ----
{
  const bg = require('../server/games/backgammon');
  test('backgammon: full game with recorded dice; replay is deterministic', () => {
    const t = makeRoom(bg);
    t.send('A', { kind: 'sit', seat: 'white' });
    t.send('B', { kind: 'sit', seat: 'black' });
    const st = t.st();
    const froms = ['bar', ...Array.from({ length: 24 }, (_, i) => (st.turn === 'white' ? 24 - i : i + 1))];
    for (let i = 0; st.phase === 'playing' && i < 5000; i++) {
      const id = st.players[st.turn];
      if (!st.dice.length) { t.send(id, { kind: 'rollDice' }); continue; }
      const before = JSON.stringify(st.lastMove);
      const order = st.turn === 'white' ? froms.slice(0, 1).concat(froms.slice(1).reverse()) : froms;
      outer: for (const from of order) {
        for (const die of [...new Set(st.dice)]) {
          t.send(id, { kind: 'move', from, die });
          if (JSON.stringify(st.lastMove) !== before) break outer;
        }
      }
    }
    assert.strictEqual(st.phase, 'game_over');
    const r = t.room.results[0];
    assert.deepStrictEqual(r.placements, st.winner === 'white' ? [['A'], ['B']] : [['B'], ['A']]);
    assert.ok(Array.isArray(r.replay[0]) && r.replay.some((a) => typeof a === 'string'), 'dice recorded');
    checkReplay(bg, t.room, ['points', 'bar', 'borneOff', 'turn', 'dice', 'lastRoll', 'winner', 'lastMove', 'phase'], 1);
  });
}

// ---- codemaster ----
{
  const cm = require('../server/games/codemaster');
  const KEYS = ['boards', 'secrets', 'result', 'phase', 'mode', 'players'];
  const strip = (v) => { for (const b of Object.values(v.boards)) { delete b.startedAt; delete b.finishedAt; } return v; };
  const check = (room, header = 1) => {
    // Board times are relative in replays, absolute live: compare everything else.
    const { replay } = room.results[0];
    const frames = cm.replayFrames(replay);
    assert.strictEqual(frames.length, replay.length - header + 1);
    const live = strip(JSON.parse(JSON.stringify(cm.serializeSnapshot(room, null))));
    const last = strip(frames[frames.length - 1]);
    for (const k of KEYS) assert.deepStrictEqual(last[k], live[k], `last frame ${k}`);
  };

  test('codemaster duel: solver beats non-solver; guesses as score; secrets in the replay', () => {
    const t = makeRoom(cm);
    t.send('A', { kind: 'sit', seat: 'a' });
    t.send('B', { kind: 'sit', seat: 'b' });
    t.send('A', { kind: 'setSecret', code: [0, 1, 2, 3] }); // B cracks this
    t.send('B', { kind: 'setSecret', code: [5, 5, 4, 4] }); // A cracks this
    t.send('A', { kind: 'guess', code: [0, 0, 0, 0] });
    t.send('A', { kind: 'guess', code: [5, 5, 4, 4] });
    t.send('B', { kind: 'giveUp' });
    const r = t.room.results[0];
    assert.deepStrictEqual(r.placements, [['A'], ['B']]);
    assert.deepStrictEqual(r.scores, { A: 2 });
    assert.deepStrictEqual(r.replay[0].secrets, { a: [5, 5, 4, 4], b: [0, 1, 2, 3] });
    check(t.room);
    t.send('A', { kind: 'giveUp' });
    assert.strictEqual(t.room.results.length, 1);
  });

  test('codemaster duel: neither solves -> shared place', () => {
    const t = makeRoom(cm);
    t.send('A', { kind: 'sit', seat: 'a' });
    t.send('B', { kind: 'sit', seat: 'b' });
    t.send('A', { kind: 'setSecret', code: [0, 1, 2, 3] });
    t.send('B', { kind: 'setSecret', code: [5, 5, 4, 4] });
    t.send('A', { kind: 'giveUp' });
    t.send('B', { kind: 'giveUp' });
    assert.deepStrictEqual(t.room.results[0].placements, [['A', 'B']]);
    check(t.room);
  });

  test('codemaster race: late joiner + leaver, ranking by guesses', () => {
    const t = makeRoom(cm, ['A', 'B', 'C', 'S']);
    t.send('A', { kind: 'setMode', mode: 'race' });
    t.send('A', { kind: 'joinRace' });
    t.send('B', { kind: 'joinRace' });
    t.send('S', { kind: 'joinRace' });
    t.send('A', { kind: 'start' });
    const code = t.st().sharedSecret;
    t.send('C', { kind: 'joinRace' });
    t.send('S', { kind: 'leaveRace' });
    t.send('B', { kind: 'guess', code });
    t.send('A', { kind: 'guess', code: code.map((c) => (c + 1) % 6) });
    t.send('A', { kind: 'guess', code });
    t.send('C', { kind: 'giveUp' });
    const r = t.room.results[0];
    assert.deepStrictEqual(r.placements, [['B'], ['A'], ['C']]);
    assert.deepStrictEqual(r.scores, { B: 1, A: 2 });
    check(t.room);
  });

  test('codemaster coop: one shared place for everyone who guessed', () => {
    const t = makeRoom(cm, ['A', 'B', 'S']);
    t.send('A', { kind: 'setMode', mode: 'coop' });
    t.send('A', { kind: 'start' });
    const code = t.st().sharedSecret;
    t.send('A', { kind: 'guess', code: code.map((c) => (c + 1) % 6) });
    t.send('B', { kind: 'guess', code });
    assert.deepStrictEqual(t.room.results[0].placements, [['A', 'B']]);
    assert.deepStrictEqual(t.room.results[0].scores, { A: 2, B: 2 });
    check(t.room);
  });
}

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (err) {
      failures++;
      console.log(`FAIL ${name}\n     ${err && err.stack}`);
    }
  }
  console.log(failures ? `\n${failures} failing` : `\nall ${tests.length} passing`);
  process.exit(failures ? 1 : 0);
})();
