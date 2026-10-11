// Sea Battle: fleet validation, placement/battle flow, secrecy of hidden fleets, hit-again rule,
// bot strength ordering, and bot games end to end. Run: node test/seabattle.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/seabattle');

const { N, FLEET, POWERS, shipCells, normalizeFleet, randomFleet, chooseShot, fire, usePower, botMove, powerLeft } = plugin._internal;
let failures = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function makeRoom(ids = ['A', 'B', 'C']) {
  const sent = [];
  const room = {
    state: plugin.createInitialState(),
    clients: new Map(ids.map((id) => [id, {}])),
    broadcast: (m) => sent.push({ to: '*', m }),
    sendTo: (id, m) => sent.push({ to: id, m }),
  };
  room.sent = sent;
  return room;
}
const act = (room, id, data) => plugin.onMessage(room, { clientId: id }, data, { senderId: id, broadcast: room.broadcast, sendTo: room.sendTo });
const lastFor = (room, id, kind) => {
  const s = [...room.sent].reverse().find((x) => x.to === id && x.m.payload.data.kind === kind);
  return s && s.m.payload.data;
};
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

// Every ship in its own row, starting at column 0: carrier row 0 ... destroyer row 4.
const ROWS_FLEET = FLEET.map((s, i) => ({ id: s.id, r: i * 2, c: 0, dir: 'h' }));

function seatTwo(room) {
  act(room, 'A', { kind: 'sit', seat: 'p1' });
  act(room, 'B', { kind: 'sit', seat: 'p2' });
}

// ---- validation --------------------------------------------------------------------------------
test('normalizeFleet accepts a legal fleet and rejects overlaps, out-of-bounds, dupes, junk', () => {
  assert.ok(normalizeFleet(ROWS_FLEET));
  assert.strictEqual(normalizeFleet(ROWS_FLEET.slice(1)), null);
  assert.strictEqual(normalizeFleet([...ROWS_FLEET.slice(1), { ...ROWS_FLEET[1] }]), null);
  const overlap = ROWS_FLEET.map((s) => ({ ...s }));
  overlap[1] = { id: 'battleship', r: 0, c: 3, dir: 'v' };
  assert.strictEqual(normalizeFleet(overlap), null);
  const oob = ROWS_FLEET.map((s) => ({ ...s }));
  oob[0] = { id: 'carrier', r: 0, c: 6, dir: 'h' };
  assert.strictEqual(normalizeFleet(oob), null);
  assert.strictEqual(normalizeFleet('x'), null);
  assert.strictEqual(normalizeFleet([null, 1, 2, 3, 4]), null);
  const badDir = ROWS_FLEET.map((s) => ({ ...s, dir: 'd' }));
  assert.strictEqual(normalizeFleet(badDir), null);
});

test('randomFleet is always legal (and spaced fleets never touch)', () => {
  for (let k = 0; k < 300; k++) {
    const f = randomFleet(Math.random, k % 2 === 0);
    assert.ok(normalizeFleet(f), 'random fleet illegal');
    if (k % 2 === 0) {
      for (const a of f) for (const b of f) {
        if (a === b) continue;
        for (const [r1, c1] of shipCells(a)) for (const [r2, c2] of shipCells(b)) {
          assert.ok(Math.abs(r1 - r2) > 1 || Math.abs(c1 - c2) > 1, 'spaced ships touch');
        }
      }
    }
  }
});

// ---- flow --------------------------------------------------------------------------------------
test('seating -> placing; battle starts only when both fleets are in', () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'p1' });
  assert.strictEqual(room.state.phase, 'waiting');
  act(room, 'A', { kind: 'sit', seat: 'p2' }); // can't take both seats
  assert.strictEqual(room.state.players.p2, null);
  act(room, 'B', { kind: 'sit', seat: 'p2' });
  assert.strictEqual(room.state.phase, 'placing');
  act(room, 'A', { kind: 'fire', r: 0, c: 0 });
  assert.strictEqual(lastFor(room, 'A', 'moveRejected').reason, 'not_playing');
  act(room, 'A', { kind: 'placeFleet', ships: [{ id: 'carrier' }] });
  assert.strictEqual(lastFor(room, 'A', 'moveRejected').reason, 'bad_fleet');
  act(room, 'C', { kind: 'placeFleet', ships: ROWS_FLEET });
  assert.strictEqual(lastFor(room, 'C', 'moveRejected').reason, 'not_seated');
  act(room, 'A', { kind: 'placeFleet', ships: ROWS_FLEET });
  assert.strictEqual(room.state.phase, 'placing');
  act(room, 'A', { kind: 'unready' });
  assert.strictEqual(room.state.ready.p1, false);
  act(room, 'A', { kind: 'placeFleet', ships: ROWS_FLEET });
  act(room, 'B', { kind: 'placeFleet', ships: ROWS_FLEET });
  assert.strictEqual(room.state.phase, 'playing');
  assert.strictEqual(room.state.turn, 'p1');
});

test('hidden fleets never reach the opponent or spectators until game over', () => {
  const room = makeRoom();
  seatTwo(room);
  act(room, 'A', { kind: 'placeFleet', ships: ROWS_FLEET });
  act(room, 'B', { kind: 'placeFleet', ships: randomFleet() });
  const vA = lastFor(room, 'A', 'state');
  const vB = lastFor(room, 'B', 'state');
  const vC = lastFor(room, 'C', 'state');
  assert.ok(vA.fleets.p1 && vA.fleets.p2 === null);
  assert.ok(vB.fleets.p2 && vB.fleets.p1 === null);
  assert.ok(vC.fleets.p1 === null && vC.fleets.p2 === null);
  assert.strictEqual(vC.mySeat, null);
  const snapC = plugin.serializeSnapshot(room, { clientId: 'C' });
  assert.ok(snapC.fleets.p1 === null && snapC.fleets.p2 === null);
});

test('miss passes the turn, hit shoots again, sinking reveals the ship, full sink wins', () => {
  const room = makeRoom();
  seatTwo(room);
  act(room, 'A', { kind: 'placeFleet', ships: ROWS_FLEET });
  act(room, 'B', { kind: 'placeFleet', ships: ROWS_FLEET });
  act(room, 'B', { kind: 'fire', r: 0, c: 0 });
  assert.strictEqual(lastFor(room, 'B', 'moveRejected').reason, 'not_your_turn');
  act(room, 'A', { kind: 'fire', r: 1, c: 0 }); // miss (odd rows are empty)
  assert.strictEqual(room.state.turn, 'p2');
  assert.strictEqual(room.state.lastShot.result, 'miss');
  act(room, 'B', { kind: 'fire', r: 9, c: 9 }); // miss
  act(room, 'A', { kind: 'fire', r: 1, c: 0 });
  assert.strictEqual(lastFor(room, 'A', 'moveRejected').reason, 'already_shot');
  act(room, 'A', { kind: 'fire', r: 8, c: 0 }); // destroyer hit
  assert.strictEqual(room.state.turn, 'p1');
  assert.strictEqual(room.state.lastShot.result, 'hit');
  act(room, 'A', { kind: 'fire', r: 8, c: 1 }); // destroyer sunk
  assert.strictEqual(room.state.lastShot.result, 'sunk');
  const vC = lastFor(room, 'C', 'state');
  assert.deepStrictEqual(vC.sunk.p1.map((s) => s.id), ['destroyer']);
  assert.strictEqual(vC.fleets.p2, null);
  // Sink everything else.
  for (const s of ROWS_FLEET) for (const [r, c] of shipCells(s)) if (!room.state.shots.p1[r][c]) act(room, 'A', { kind: 'fire', r, c });
  assert.strictEqual(room.state.phase, 'game_over');
  assert.strictEqual(room.state.winner, 'p1');
  assert.deepStrictEqual(room.state.score, { p1: 1, p2: 0 });
  const over = lastFor(room, 'C', 'state');
  assert.ok(over.fleets.p1 && over.fleets.p2, 'fleets revealed at game over');
  // Rematch: back to placing, other player shoots first next time.
  act(room, 'C', { kind: 'resetGame' });
  assert.strictEqual(room.state.phase, 'game_over');
  act(room, 'B', { kind: 'resetGame' });
  assert.strictEqual(room.state.phase, 'placing');
  act(room, 'A', { kind: 'placeFleet', ships: ROWS_FLEET });
  act(room, 'B', { kind: 'placeFleet', ships: ROWS_FLEET });
  assert.strictEqual(room.state.turn, 'p2');
  assert.deepStrictEqual(room.state.score, { p1: 1, p2: 0 });
});

test('bad fire input is rejected without throwing', () => {
  const room = makeRoom();
  seatTwo(room);
  act(room, 'A', { kind: 'placeFleet', ships: ROWS_FLEET });
  act(room, 'B', { kind: 'placeFleet', ships: ROWS_FLEET });
  for (const bad of [{ r: -1, c: 0 }, { r: 0, c: 10 }, { r: 'x', c: 1 }, { r: 1.5, c: 1 }, {}]) {
    act(room, 'A', { kind: 'fire', ...bad });
    assert.strictEqual(lastFor(room, 'A', 'moveRejected').reason, 'invalid');
  }
  act(room, 'A', null);
  act(room, 'A', { kind: 42 });
});

test('leaving mid-game resets to waiting and clears scores', () => {
  const room = makeRoom();
  seatTwo(room);
  act(room, 'A', { kind: 'placeFleet', ships: ROWS_FLEET });
  act(room, 'B', { kind: 'placeFleet', ships: ROWS_FLEET });
  plugin.onLeave(room, { clientId: 'B' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.players.p2, null);
  assert.strictEqual(room.state.fleets.p1, null);
});

// ---- bots --------------------------------------------------------------------------------------
function shotsToSink(level, seed) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const st = plugin.createInitialState();
  st.fleets.p2 = randomFleet(rand);
  st.fleets.p1 = randomFleet(rand);
  st.phase = 'playing';
  st.turn = 'p1';
  let n = 0;
  while (st.phase === 'playing') {
    const mv = chooseShot(st.shots.p1, st.sunk.p1, level, rand);
    assert.ok(mv, 'bot had no move');
    assert.strictEqual(st.shots.p1[mv[0]][mv[1]], null, `${level} fired at an already-shot cell`);
    fire(st, 'p1', mv[0], mv[1]);
    st.turn = 'p1'; // single-sided: only measure how fast p1 clears the board
    n++;
    assert.ok(n <= N * N);
  }
  return n;
}

test('bot strength: easy > medium > hard > expert shots-to-win on average', () => {
  const avg = {};
  for (const level of ['easy', 'medium', 'hard', 'expert']) {
    let total = 0;
    const games = 60;
    for (let g = 0; g < games; g++) total += shotsToSink(level, 1000 + g * 7919);
    avg[level] = total / games;
  }
  console.log('     avg shots to sink a fleet:', JSON.stringify(Object.fromEntries(Object.entries(avg).map(([k, v]) => [k, +v.toFixed(1)]))));
  assert.ok(avg.easy > avg.medium, 'medium should beat easy');
  assert.ok(avg.medium > avg.hard, 'hard should beat medium');
  assert.ok(avg.hard > avg.expert, 'expert should beat hard');
  assert.ok(avg.expert < 60, 'expert should be strong');
});

test('human vs bot: bot fleet is ready instantly, bot fires back, leaving cancels cleanly', async () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'p1' });
  act(room, 'A', { kind: 'sit', seat: 'p2', bot: true, level: 'expert' });
  assert.strictEqual(room.state.phase, 'placing');
  assert.strictEqual(room.state.ready.p2, true);
  assert.ok(normalizeFleet(room.state.fleets.p2));
  assert.strictEqual(room.state.botLevels.p2, 'expert');
  act(room, 'A', { kind: 'sit', seat: 'p1', bot: true }); // seat taken
  act(room, 'A', { kind: 'placeFleet', ships: ROWS_FLEET });
  assert.strictEqual(room.state.phase, 'playing');
  // Find a guaranteed miss for A so the bot gets the turn.
  const occ = new Set(room.state.fleets.p2.flatMap((s) => shipCells(s).map(([r, c]) => r * N + c)));
  let missCell = 0;
  while (occ.has(missCell)) missCell++;
  act(room, 'A', { kind: 'fire', r: Math.floor(missCell / N), c: missCell % N });
  assert.strictEqual(room.state.turn, 'p2');
  await wait(1200);
  const botShots = room.state.shotCount.p2;
  assert.ok(botShots >= 1, 'bot fired');
  act(room, 'A', { kind: 'setBotLevel', seat: 'p2', level: 'easy' });
  assert.strictEqual(room.state.botLevels.p2, 'easy');
  act(room, 'A', { kind: 'removeBot', seat: 'p2' });
  assert.strictEqual(room.state.phase, 'waiting');
  await wait(1100);
  assert.strictEqual(room.state.shotCount.p2, 0, 'no stray bot shot after removal');
});

test('bot plays a whole game against a scripted human to the end', async () => {
  const room = makeRoom();
  act(room, 'A', { kind: 'sit', seat: 'p1' });
  act(room, 'A', { kind: 'sit', seat: 'p2', bot: true, level: 'expert' });
  act(room, 'A', { kind: 'placeFleet', ships: ROWS_FLEET });
  const order = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) order.push([r, c]);
  const deadline = Date.now() + 120000;
  while (room.state.phase === 'playing' && Date.now() < deadline) {
    if (room.state.turn === 'p1') {
      // A fires in reading order (slow on purpose, so the bot gets plenty of turns).
      const [r, c] = order.find(([rr, cc]) => !room.state.shots.p1[rr][cc]);
      act(room, 'A', { kind: 'fire', r, c });
    } else {
      await wait(50);
    }
  }
  assert.strictEqual(room.state.phase, 'game_over');
  assert.ok(room.state.winner === 'p1' || room.state.winner === 'p2');
});

// ---- powers ------------------------------------------------------------------------------------
function poweredBattle() {
  const room = makeRoom();
  seatTwo(room);
  act(room, 'A', { kind: 'setPowers', on: true });
  act(room, 'A', { kind: 'placeFleet', ships: ROWS_FLEET });
  act(room, 'B', { kind: 'placeFleet', ships: ROWS_FLEET });
  return room;
}
// Burn turns with misses (odd rows of ROWS_FLEET are empty) until `seat` has taken `n` turns.
function burnTurns(room, n) {
  const misses = [];
  for (let r = 1; r < N; r += 2) for (let c = 0; c < N; c++) misses.push([r, c]);
  const ids = { p1: 'A', p2: 'B' };
  while (room.state.turnsTaken.p1 < n || room.state.turnsTaken.p2 < n || room.state.turn !== 'p1') {
    const seat = room.state.turn;
    const [r, c] = misses.find(([rr, cc]) => !room.state.shots[seat][rr][cc]);
    act(room, ids[seat], { kind: 'fire', r, c });
  }
}

test('powers toggle: default off, seated-only, pre-game only, un-readies humans, rejected when off', () => {
  const room = makeRoom();
  assert.strictEqual(room.state.powers, false);
  act(room, 'C', { kind: 'setPowers', on: true }); // spectator
  assert.strictEqual(room.state.powers, false);
  seatTwo(room);
  act(room, 'A', { kind: 'setPowers', on: 'yes' });
  assert.strictEqual(room.state.powers, false);
  act(room, 'A', { kind: 'placeFleet', ships: ROWS_FLEET });
  act(room, 'B', { kind: 'setPowers', on: true });
  assert.strictEqual(room.state.powers, true);
  assert.strictEqual(room.state.ready.p1, false, 'rule change un-readies');
  assert.strictEqual(lastFor(room, 'C', 'state').powers, true, 'everyone sees the rule');
  act(room, 'B', { kind: 'setPowers', on: false });
  act(room, 'A', { kind: 'placeFleet', ships: ROWS_FLEET });
  act(room, 'B', { kind: 'placeFleet', ships: ROWS_FLEET });
  act(room, 'A', { kind: 'setPowers', on: true }); // too late
  assert.strictEqual(room.state.powers, false);
  act(room, 'A', { kind: 'power', power: 'radar', r: 0, c: 0 });
  assert.strictEqual(lastFor(room, 'A', 'moveRejected').reason, 'powers_off');
});

test('powers: validation and cooldowns counted in own turns', () => {
  const room = poweredBattle();
  act(room, 'A', { kind: 'power', power: 'radar', r: 0, c: 0 });
  assert.strictEqual(lastFor(room, 'A', 'moveRejected').reason, 'power_cooldown');
  burnTurns(room, POWERS.barrage.first);
  assert.strictEqual(powerLeft(room.state, 'p1', 'barrage'), 0);
  for (const bad of [{ power: 'nuke' }, { power: 'radar', r: 9, c: 0 }, { power: 'radar', r: -1, c: 0 }, { power: 'radar', r: 1.5, c: 0 },
    { power: 'barrage', axis: 'diag', i: 0 }, { power: 'barrage', axis: 'row', i: 10 }, { power: 'barrage', axis: 'row' }, { power: '__proto__' }]) {
    act(room, 'A', { kind: 'power', ...bad });
    assert.strictEqual(lastFor(room, 'A', 'moveRejected').reason, 'invalid', JSON.stringify(bad));
  }
  act(room, 'B', { kind: 'power', power: 'radar', r: 0, c: 0 });
  assert.strictEqual(lastFor(room, 'B', 'moveRejected').reason, 'not_your_turn');
  act(room, 'A', { kind: 'power', power: 'barrage', axis: 'row', i: 1 }); // row 1 is all burned misses
  assert.strictEqual(lastFor(room, 'A', 'moveRejected').reason, 'nothing_left');
  const t = room.state.turnsTaken.p1;
  act(room, 'A', { kind: 'power', power: 'radar', r: 2, c: 2 });
  assert.strictEqual(room.state.turn, 'p2', 'a power ends the turn');
  assert.strictEqual(powerLeft(room.state, 'p1', 'radar'), POWERS.radar.cooldown);
  assert.strictEqual(room.state.powerAt.p1.radar, t + POWERS.radar.cooldown);
  assert.strictEqual(powerLeft(room.state, 'p1', 'barrage'), 0, 'cooldowns are per power');
});

test('barrage fires a whole line (skipping shot cells), can sink and win; radar reads a 2x2', () => {
  const room = poweredBattle();
  burnTurns(room, POWERS.barrage.first);
  act(room, 'A', { kind: 'fire', r: 0, c: 0 }); // hit, keeps the turn
  act(room, 'A', { kind: 'power', power: 'barrage', axis: 'row', i: 0 }); // carrier row: 5 hits + misses
  const ls = room.state.lastShot;
  assert.strictEqual(ls.power, 'barrage');
  assert.strictEqual(ls.cells.length, 9, 'already-shot (0,0) skipped');
  assert.strictEqual(ls.result, 'sunk');
  assert.ok(room.state.sunk.p1.some((s) => s.id === 'carrier'));
  assert.strictEqual(room.state.turn, 'p2');
  // B scans the battleship row: cells (2,0),(2,1) ship, (3,0),(3,1) empty.
  const before = room.state.shotCount.p2;
  act(room, 'B', { kind: 'power', power: 'radar', r: 2, c: 0 });
  assert.deepStrictEqual([room.state.radar.p2[2][0], room.state.radar.p2[2][1], room.state.radar.p2[3][0], room.state.radar.p2[3][1]], ['ship', 'ship', 'empty', 'empty']);
  assert.strictEqual(room.state.shotCount.p2, before, 'radar fires no shells');
  assert.strictEqual(room.state.turn, 'p1');
  // Barrage that finishes the fleet ends the game mid-line.
  const st = room.state;
  for (const s of ROWS_FLEET.slice(1, 4)) for (const [r, c] of shipCells(s)) st.shots.p1[r][c] = 'hit';
  st.shots.p1[8][0] = 'hit'; // destroyer (8,0)-(8,1): column 1 finishes it
  st.sunk.p1 = ROWS_FLEET.slice(0, 4).map((s) => ({ ...s }));
  st.turn = 'p1';
  st.powerAt.p1.barrage = 0;
  act(room, 'A', { kind: 'power', power: 'barrage', axis: 'col', i: 1 });
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.winner, 'p1');
});

test('powers never leak the hidden fleet or radar readings to the opponent / spectators', () => {
  const room = poweredBattle();
  burnTurns(room, POWERS.radar.first);
  act(room, 'A', { kind: 'power', power: 'radar', r: 0, c: 0 });
  const vA = lastFor(room, 'A', 'state');
  const vB = lastFor(room, 'B', 'state');
  const vC = lastFor(room, 'C', 'state');
  assert.strictEqual(vA.radar.p1[0][0], 'ship');
  assert.strictEqual(vB.radar.p1, null, 'opponent does not get the reading');
  assert.strictEqual(vC.radar.p1, null, 'spectator does not get the reading');
  assert.deepStrictEqual(vB.radarAreas.p1, [{ r: 0, c: 0 }], 'but everyone sees where the scan was');
  assert.strictEqual(vB.lastShot.power, 'radar');
  assert.ok(!('cells' in vB.lastShot), 'radar lastShot has no results');
  assert.strictEqual(vA.fleets.p2, null);
  assert.strictEqual(vC.fleets.p1, null);
  assert.strictEqual(vB.fleets.p1, null);
  assert.strictEqual(vC.fleets.p2, null);
  // A plain hit doesn't name the ship to anyone.
  act(room, 'B', { kind: 'fire', r: 0, c: 0 });
  assert.strictEqual(lastFor(room, 'A', 'state').lastShot.ship, null);
});

test('bots use powers at every level when on, never when off, and never stall', () => {
  for (const level of ['easy', 'medium', 'hard', 'expert']) {
    let used = 0;
    for (let g = 0; g < 20; g++) {
      const st = plugin.createInitialState();
      st.powers = g % 4 !== 0;
      st.fleets.p1 = randomFleet();
      st.fleets.p2 = randomFleet();
      st.phase = 'playing';
      st.turn = 'p1';
      st.turnsTaken.p1 = 1;
      let n = 0;
      while (st.phase === 'playing') {
        const seat = st.turn;
        const mv = botMove(st, seat, level);
        assert.ok(mv, `${level} bot had no move`);
        if (mv.kind === 'power') {
          assert.ok(st.powers, 'power used while off');
          assert.strictEqual(usePower(st, seat, mv), null, `${level} made an illegal power move`);
          used++;
        } else {
          assert.ok(fire(st, seat, mv.r, mv.c), `${level} fired at a shot cell`);
        }
        assert.ok(++n < 400, `${level} stalled`);
      }
    }
    assert.ok(used > 0, `${level} never used a power`);
  }
});

test('expert with powers beats expert without', () => {
  const play = (powers, seed) => {
    let s = seed;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const st = plugin.createInitialState();
    st.powers = powers;
    st.fleets.p2 = randomFleet(rand);
    st.fleets.p1 = randomFleet(rand);
    st.phase = 'playing';
    st.turn = 'p1';
    let turns = 0;
    while (st.phase === 'playing') {
      st.turn = 'p1';
      st.turnsTaken.p1++;
      turns++;
      for (;;) {
        const mv = botMove(st, 'p1', 'expert', rand);
        if (mv.kind === 'power') { usePower(st, 'p1', mv); break; }
        if (fire(st, 'p1', mv.r, mv.c).result === 'miss' || st.phase !== 'playing') break;
      }
    }
    return turns;
  };
  let a = 0;
  let b = 0;
  for (let g = 0; g < 40; g++) { a += play(false, 77 + g * 131); b += play(true, 77 + g * 131); }
  console.log(`     expert turns to win: plain ${(a / 40).toFixed(1)}, powers ${(b / 40).toFixed(1)}`);
  assert.ok(b < a, 'powers should help expert');
});

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (err) {
      failures++;
      console.log(`FAIL ${name}\n     ${err.stack.split('\n').slice(0, 3).join('\n     ')}`);
    }
  }
  console.log(failures ? `\n${failures} failing` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
