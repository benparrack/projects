// Dots and Boxes plugin tests: node test/dotsboxes.test.js
'use strict';

const assert = require('assert');
const plugin = require('../server/games/dotsboxes');
const { geometry, edgeIndex, sidesOf, capturingEdges, safeEdges, components, controlValue, chooseMove, applyLine, giveaway } = plugin._internal;

let failures = 0;
const results = [];
function test(name, fn) {
  try { fn(); results.push(`  ok  ${name}`); } catch (e) { failures++; results.push(`  FAIL ${name}\n      ${e.stack.split('\n').slice(0, 3).join('\n      ')}`); }
}

// ---- fake room ------------------------------------------------------------------------------
function makeRoom() {
  const sent = [];
  const room = {
    state: plugin.createInitialState(),
    clients: new Map(),
    broadcast: (env) => sent.push({ to: '*', env }),
    sendTo: (id, env) => sent.push({ to: id, env }),
    sent,
  };
  room.join = (id, nickname = id) => { room.clients.set(id, { nickname }); };
  room.act = (id, data) => plugin.onMessage(room, { clientId: id, nickname: id }, data, {
    senderId: id, broadcast: room.broadcast, sendTo: (to, env) => room.sendTo(to, env),
  });
  room.last = () => { for (let i = sent.length - 1; i >= 0; i--) if (sent[i].env.payload.data.kind === 'state') return sent[i].env.payload.data; return null; };
  room.rejects = (id) => sent.filter((s) => s.to === id && s.env.payload.data.kind === 'moveRejected').map((s) => s.env.payload.data.reason);
  return room;
}
const clearTimers = (room) => { if (room._dbBotTimer) clearTimeout(room._dbBotTimer); room._dbBotTimer = null; };

function drawAll(st, g, list) {
  for (const [o, r, c] of list) {
    const e = edgeIndex(g, o, r, c);
    st.edges[e] = 1;
  }
}

// ---- geometry -----------------------------------------------------------------------------
test('geometry: edge and box counts', () => {
  for (const n of [4, 5, 6]) {
    const g = geometry(n);
    assert.strictEqual(g.E, 2 * n * (n + 1));
    assert.strictEqual(g.boxEdges.length, n * n);
    const hist = [0, 0, 0];
    g.edgeBoxes.forEach((bs) => hist[bs.length]++);
    assert.strictEqual(hist[1], 4 * n); // border edges
    assert.strictEqual(hist[2], g.E - 4 * n);
  }
});

test('edgeIndex validates coordinates', () => {
  const g = geometry(4);
  assert.strictEqual(edgeIndex(g, 'h', 4, 3) >= 0, true);
  assert.strictEqual(edgeIndex(g, 'h', 5, 0), -1);
  assert.strictEqual(edgeIndex(g, 'h', 0, 4), -1);
  assert.strictEqual(edgeIndex(g, 'v', 3, 4) >= 0, true);
  assert.strictEqual(edgeIndex(g, 'v', 4, 0), -1);
  assert.strictEqual(edgeIndex(g, 'x', 0, 0), -1);
  assert.strictEqual(edgeIndex(g, 'h', 0.5, 0), -1);
  assert.strictEqual(edgeIndex(g, 'h', -1, 0), -1);
});

// ---- room flow ----------------------------------------------------------------------------
test('seating, size, start, turn order, extra move on box', () => {
  const room = makeRoom();
  room.join('a'); room.join('b');
  room.act('a', { kind: 'sit' });
  room.act('a', { kind: 'startGame' });
  assert.strictEqual(room.state.phase, 'waiting', 'cannot start alone');
  room.act('b', { kind: 'sit' });
  room.act('x', { kind: 'setSize', size: 4 }); // spectator: ignored
  assert.strictEqual(room.state.size, 5);
  room.act('a', { kind: 'setSize', size: 4 });
  room.act('a', { kind: 'setSize', size: 9 });
  assert.strictEqual(room.state.size, 4);
  room.act('a', { kind: 'startGame' });
  const st = room.state;
  assert.strictEqual(st.phase, 'playing');
  assert.strictEqual(st.turnIdx, 0);
  room.act('b', { kind: 'move', o: 'h', r: 0, c: 0 });
  assert.deepStrictEqual(room.rejects('b'), ['not_your_turn']);
  room.act('a', { kind: 'move', o: 'h', r: 0, c: 0 }); // top of box 0
  assert.strictEqual(st.turnIdx, 1);
  room.act('b', { kind: 'move', o: 'h', r: 0, c: 0 });
  assert.deepStrictEqual(room.rejects('b').slice(-1), ['taken']);
  room.act('b', { kind: 'move', o: 'q', r: 0, c: 0 });
  room.act('b', { kind: 'move', o: 'h', r: 99, c: 0 });
  assert.deepStrictEqual(room.rejects('b').slice(-2), ['invalid', 'invalid']);
  room.act('b', { kind: 'move', o: 'v', r: 0, c: 0 }); // left
  room.act('a', { kind: 'move', o: 'h', r: 1, c: 0 }); // bottom (3rd side)
  room.act('b', { kind: 'move', o: 'v', r: 0, c: 1 }); // right -> completes box 0 for b
  assert.strictEqual(st.boxes[0], 1);
  assert.strictEqual(st.scores[1], 1);
  assert.strictEqual(st.turnIdx, 1, 'completing a box grants another move');
  const s = room.last();
  assert.strictEqual(s.lastLine.made, 1);
  assert.strictEqual(s.lines.length, 4);
});

test('full game to the end: scores add up, winners, rematch alternates starter', () => {
  const room = makeRoom();
  room.join('a'); room.join('b');
  room.act('a', { kind: 'sit' }); room.act('b', { kind: 'sit' });
  room.act('a', { kind: 'setSize', size: 4 });
  room.act('a', { kind: 'startGame' });
  const st = room.state;
  const g = geometry(4);
  let guard = 0;
  while (st.phase === 'playing' && guard++ < 1000) {
    const who = st.seats[st.turnIdx];
    const e = chooseMove(g, st.edges, 'medium');
    const { o, r, c } = plugin._internal.edgeCoords(g, e);
    room.act(who, { kind: 'move', o, r, c });
  }
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.scores[0] + st.scores[1], 16);
  const top = Math.max(...st.scores);
  assert.deepStrictEqual(st.winners, st.scores.map((x, i) => (x === top ? i : -1)).filter((i) => i >= 0));
  room.act('a', { kind: 'move', o: 'h', r: 0, c: 0 }); // after game over: ignored
  room.act('a', { kind: 'resetGame' });
  assert.strictEqual(st.phase, 'playing');
  assert.strictEqual(st.turnIdx, 1, 'second game starts with the other player');
  assert.strictEqual(st.scores.join(), '0,0');
  assert.strictEqual(st.edges.every((x) => !x), true);
});

async function botGame() {
  const room = makeRoom();
  room.join('a');
  room.act('a', { kind: 'addBot', level: 'hard' });
  assert.strictEqual(room.state.seats.length, 0, 'spectator cannot add bots');
  room.act('a', { kind: 'sit' });
  room.act('a', { kind: 'addBot', level: 'expert' });
  room.act('a', { kind: 'addBot', level: 'nonsense' });
  assert.strictEqual(room.state.seats.length, 3);
  assert.match(room.state.seats[1], /^bot-\w+~expert$/);
  assert.match(room.state.seats[2], /^bot-\w+~hard$/);
  assert.notStrictEqual(room.state.seats[1].split('~')[0], room.state.seats[2].split('~')[0], 'bots get distinct names');
  room.act('a', { kind: 'removeBot', seat: 2 });
  room.act('a', { kind: 'removeBot', seat: 0 }); // not a bot: ignored
  assert.strictEqual(room.state.seats.length, 2);
  room.act('a', { kind: 'setBotLevel', seat: 1, level: 'easy' });
  assert.match(room.state.seats[1], /~easy$/);
  room.act('a', { kind: 'setSize', size: 4 });
  room.act('a', { kind: 'startGame' });
  // Human plays randomly-safe; the bot replies via its timer.
  const st = room.state;
  const g = geometry(4);
  const deadline = Date.now() + 30000;
  while (st.phase === 'playing' && Date.now() < deadline) {
    if (st.seats[st.turnIdx] === 'a') {
      const e = chooseMove(g, st.edges, 'medium');
      const { o, r, c } = plugin._internal.edgeCoords(g, e);
      room.act('a', { kind: 'move', o, r, c });
    } else {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.scores[0] + st.scores[1], 16);
  clearTimers(room);
}

async function leaveMidGame() {
  // Two humans + a bot: one human leaves mid-game -> bot takes over; game continues.
  const room = makeRoom();
  room.join('a'); room.join('b');
  room.act('a', { kind: 'sit' }); room.act('b', { kind: 'sit' });
  room.act('a', { kind: 'startGame' });
  room.act('a', { kind: 'move', o: 'h', r: 0, c: 0 });
  assert.strictEqual(room.state.turnIdx, 1);
  room.clients.delete('b');
  plugin.onLeave(room, { clientId: 'b', nickname: 'Bea' });
  assert.strictEqual(room.state.phase, 'playing');
  assert.match(room.state.seats[1], /^bot-/);
  assert.match(room.state.note, /Bea left/);
  // The bot now moves on its own.
  await new Promise((r) => setTimeout(r, 900));
  assert.strictEqual(room.state.turnIdx === 0 || room.state.moveCount > 1, true);
  assert.ok(room.state.moveCount >= 2, 'bot replaced the leaver and moved');
  // Last human leaves -> table empties and goes back to waiting; no stray timers move.
  room.clients.delete('a');
  plugin.onLeave(room, { clientId: 'a', nickname: 'a' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.deepStrictEqual(room.state.seats, []);
  const mc = room.state.moveCount;
  await new Promise((r) => setTimeout(r, 900));
  assert.strictEqual(room.state.moveCount, mc);
  assert.strictEqual(room._dbBotTimer, null);
}

async function leaveTwoPlayer() {
  // A 2-human game where one leaves: remaining human keeps playing vs a bot.
  const room = makeRoom();
  room.join('a'); room.join('b');
  room.act('a', { kind: 'sit' }); room.act('b', { kind: 'sit' });
  room.act('a', { kind: 'startGame' });
  room.act('b', { kind: 'leaveSeat' });
  assert.strictEqual(room.state.phase, 'playing');
  assert.match(room.state.seats[1], /^bot-/);
  clearTimers(room);
  // Waiting-phase leave just removes the seat.
  const r2 = makeRoom();
  r2.join('a'); r2.join('b');
  r2.act('a', { kind: 'sit' }); r2.act('b', { kind: 'sit' });
  r2.act('b', { kind: 'leaveSeat' });
  assert.deepStrictEqual(r2.state.seats, ['a']);
  assert.strictEqual(r2.state.phase, 'waiting');
}

// ---- engine -------------------------------------------------------------------------------
test('capturing and safe edges', () => {
  const g = geometry(4);
  const ed = new Array(g.E).fill(0);
  drawAll({ edges: ed }, g, [['h', 0, 0], ['v', 0, 0], ['h', 1, 0]]);
  assert.strictEqual(sidesOf(g, ed, 0), 3);
  assert.deepStrictEqual(capturingEdges(g, ed), [edgeIndex(g, 'v', 0, 1)]);
  const safe = safeEdges(g, ed);
  assert.ok(!safe.includes(edgeIndex(g, 'v', 0, 1)));
  assert.ok(!safe.includes(edgeIndex(g, 'h', 1, 1)) || sidesOf(g, ed, 1) <= 1);
});

test('components: chains and cycles; controlValue', () => {
  const g = geometry(4);
  // Build a 2x2 cycle in the top-left corner: draw its outer boundary only.
  const ed = new Array(g.E).fill(0);
  drawAll({ edges: ed }, g, [['h', 0, 0], ['h', 0, 1], ['v', 0, 0], ['v', 1, 0], ['h', 2, 0], ['h', 2, 1], ['v', 0, 2], ['v', 1, 2]]);
  const comps = components(g, ed).filter((c) => c.boxes.some((b) => [0, 1, 4, 5].includes(b)));
  assert.strictEqual(comps.length, 1);
  assert.strictEqual(comps[0].cycle, true);
  assert.strictEqual(comps[0].len, 4);
  // Values: single 3-chain -> controller takes all 3. Two 3-chains: controller double-deals the
  // first (1 - 2... ) -> f([3,3]) = max(3 - 3, 3 - 4 + 3) = 2.
  assert.strictEqual(controlValue([{ len: 3, cycle: false }]), 3);
  assert.strictEqual(controlValue([{ len: 3, cycle: false }, { len: 3, cycle: false }]), 2);
  assert.strictEqual(controlValue([{ len: 1, cycle: false }, { len: 1, cycle: false }]), 0);
  // Cycle 4 + chain 5: mover opens the cycle first (controller nets max(4-5, 4-8+5) = 1).
  assert.strictEqual(controlValue([{ len: 4, cycle: true }, { len: 5, cycle: false }]), 1);
});

test('chain components in a corridor', () => {
  const g = geometry(4);
  const ed = new Array(g.E).fill(0);
  // Top row as a corridor of 4 boxes: draw all horizontal lines of row 0 (top & bottom), leave verticals.
  drawAll({ edges: ed }, g, [['h', 0, 0], ['h', 0, 1], ['h', 0, 2], ['h', 0, 3], ['h', 1, 0], ['h', 1, 1], ['h', 1, 2], ['h', 1, 3]]);
  const c = components(g, ed).find((x) => x.boxes.includes(0));
  assert.strictEqual(c.len, 4);
  assert.strictEqual(c.cycle, false);
  assert.deepStrictEqual(c.boxes, [0, 1, 2, 3].slice().sort((a, b) => (c.boxes[0] === 0 ? a - b : b - a)));
  // Opening it gives away all 4.
  assert.strictEqual(giveaway(g, ed, edgeIndex(g, 'v', 0, 0)), 4);
});

test('medium never gives a 3rd side when a safe line exists; takes free boxes', () => {
  const g = geometry(5);
  for (let trial = 0; trial < 200; trial++) {
    const ed = new Array(g.E).fill(0);
    // Random partial position.
    const k = Math.floor(Math.random() * 30);
    for (let i = 0; i < k; i++) ed[Math.floor(Math.random() * g.E)] = 1;
    for (const lvl of ['medium', 'hard', 'expert']) {
      const e = chooseMove(g, ed, lvl);
      assert.strictEqual(ed[e], 0, 'legal line');
      const caps = capturingEdges(g, ed);
      const safe = safeEdges(g, ed);
      if (!caps.length && safe.length) assert.ok(safe.includes(e), `${lvl} played unsafe with safe available`);
      if (caps.length && lvl !== 'expert') assert.ok(caps.includes(e), `${lvl} skipped a free box`);
    }
    const e = chooseMove(g, ed, 'easy');
    assert.strictEqual(ed[e], 0);
  }
});

test('hard sacrifices the smallest chain when forced', () => {
  // Everything drawn except a lone box (15) and a 3-box corridor (boxes 0-1-2).
  const g = geometry(4);
  const ed = new Array(g.E).fill(1);
  const open = (o, r, c) => { ed[edgeIndex(g, o, r, c)] = 0; };
  open('v', 3, 4); open('h', 4, 3);
  open('v', 0, 0); open('v', 0, 1); open('v', 0, 2); open('h', 0, 2);
  assert.strictEqual(capturingEdges(g, ed).length, 0);
  assert.strictEqual(safeEdges(g, ed).length, 0);
  const comps = components(g, ed);
  assert.deepStrictEqual(comps.map((c) => c.len).sort(), [1, 3]);
  for (let i = 0; i < 20; i++) {
    const e = chooseMove(g, ed, 'hard');
    assert.strictEqual(giveaway(g, ed, e), 1);
    // Expert also opens the lone box first (f = 1 - 3 = -2 vs opening the 3-chain: 3 - 1 = 2).
    assert.strictEqual(giveaway(g, ed, chooseMove(g, ed, 'expert')), 1);
  }
});

test('expert double-deals to keep control', () => {
  // Two separate 3-chains left (row 0 corridor and row 3 corridor), all else full. Opponent has
  // opened row 0 at the end; Expert should take 1, then decline the last 2 (double-deal), because
  // the other 3-chain is still to come: takeAll = 3 - 3 = 0 vs double-deal = 1 - 2 + 3 = 2.
  const g = geometry(4);
  const ed = new Array(g.E).fill(1);
  const open = (o, r, c) => { ed[edgeIndex(g, o, r, c)] = 0; };
  // Row 0 boxes 0,1,2 as a corridor ending at the left border; box 3 fully drawn.
  open('v', 0, 1); open('v', 0, 2); // inner links 0-1, 1-2
  // box 0 left edge v(0,0) is DRAWN (the opponent's opening) -> box0 has 3 sides.
  // box 2's other end: v(0,3) shared with box 3 — box 3 must be "owned": treat box3 as fully drawn already.
  open('v', 0, 3);
  ed[edgeIndex(g, 'v', 0, 3)] = 1;
  // Make chain end at border instead: re-open top of box 2 (h(0,2)) as the border end.
  open('h', 0, 2);
  // Row 3 corridor boxes 12,13,14: links v(3,1), v(3,2), end h(4,14->c=2) border, other end v(3,0) border.
  open('v', 3, 0); open('v', 3, 1); open('v', 3, 2);
  // box 14's right v(3,3) drawn; box 14 open: v(3,2), and we need 2 open -> open h(4,2).
  open('h', 4, 2);
  // box 12: open v(3,0), v(3,1) (2 open). box 13: v(3,1), v(3,2). box 14: v(3,2), h(4,2). OK.
  // box 0: open v(0,1) only -> 3 sides (capturable). box 1: v(0,1), v(0,2). box 2: v(0,2), h(0,2).
  assert.strictEqual(sidesOf(g, ed, 0), 3);
  assert.strictEqual(sidesOf(g, ed, 1), 2);
  assert.strictEqual(sidesOf(g, ed, 2), 2);
  // Expert should capture box 0 first (3 boxes remain in reach > domino).
  let e = chooseMove(g, ed, 'expert');
  assert.strictEqual(e, edgeIndex(g, 'v', 0, 1), 'takes the first box');
  ed[e] = 1;
  // Now box 1 is 3-sided, box 2 2-sided ending at border: domino. Expert declines by drawing h(0,2).
  e = chooseMove(g, ed, 'expert');
  assert.strictEqual(e, edgeIndex(g, 'h', 0, 2), 'double-deals the last two');
  // Hard just takes.
  assert.strictEqual(chooseMove(g, ed, 'hard'), edgeIndex(g, 'v', 0, 2));
});

test('expert takes everything from the last chain', () => {
  const g = geometry(4);
  const ed = new Array(g.E).fill(1);
  const open = (o, r, c) => { ed[edgeIndex(g, o, r, c)] = 0; };
  open('v', 0, 2); open('h', 0, 2); // box1 3-sided (v(0,2) open), box2 links to border
  assert.strictEqual(sidesOf(g, ed, 1), 3);
  assert.strictEqual(chooseMove(g, ed, 'expert'), edgeIndex(g, 'v', 0, 2));
});

function playGame(levels, n) {
  const g = geometry(n);
  const st = { size: n, seats: levels.map((l, i) => `bot-${i}~${l}`), turnIdx: 0, phase: 'playing', moveCount: 0 };
  st.edges = new Array(g.E).fill(0);
  st.edgeOwner = new Array(g.E).fill(null);
  st.boxes = new Array(g.B).fill(null);
  st.scores = levels.map(() => 0);
  let guard = 0;
  while (st.phase === 'playing' && guard++ < 500) {
    const e = chooseMove(g, st.edges, levels[st.turnIdx]);
    assert.ok(applyLine(st, e) >= 0, 'bot played an illegal line');
  }
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.scores.reduce((a, b) => a + b, 0), n * n);
  return st.scores;
}

function winRate(a, b, games, n) {
  let wins = 0; let losses = 0;
  for (let i = 0; i < games; i++) {
    const swap = i % 2 === 1;
    const s = playGame(swap ? [b, a] : [a, b], n);
    const mine = swap ? s[1] : s[0];
    const theirs = swap ? s[0] : s[1];
    if (mine > theirs) wins++; else if (mine < theirs) losses++;
  }
  return { wins, losses, games };
}

test('3- and 4-player bot games finish cleanly', () => {
  for (let i = 0; i < 10; i++) playGame(['easy', 'medium', 'hard', 'expert'], 5);
  for (let i = 0; i < 10; i++) playGame(['expert', 'expert', 'hard'], 6);
});

const strength = {};
test('expert beats medium most of the time (5x5)', () => {
  const t = Date.now();
  const r = winRate('expert', 'medium', 60, 5);
  strength.expertVsMedium = { ...r, ms: Date.now() - t };
  assert.ok(r.wins >= 0.75 * r.games, `expert won ${r.wins}/${r.games}`);
});
test('expert beats hard more often than not (5x5)', () => {
  const r = winRate('expert', 'hard', 60, 5);
  strength.expertVsHard = r;
  assert.ok(r.wins > r.losses, `expert ${r.wins}-${r.losses} vs hard`);
});
test('hard beats medium, medium beats easy', () => {
  const hm = winRate('hard', 'medium', 60, 5);
  const me = winRate('medium', 'easy', 60, 5);
  strength.hardVsMedium = hm; strength.mediumVsEasy = me;
  assert.ok(hm.wins > hm.losses, `hard ${hm.wins}-${hm.losses}`);
  assert.ok(me.wins > me.losses * 2, `medium ${me.wins}-${me.losses}`);
});
test('expert move time stays small on 6x6', () => {
  const g = geometry(6);
  let worst = 0;
  for (let i = 0; i < 6; i++) {
    const st = { size: 6, seats: ['x', 'y'], turnIdx: 0, phase: 'playing', moveCount: 0, edges: new Array(g.E).fill(0), edgeOwner: new Array(g.E).fill(null), boxes: new Array(g.B).fill(null), scores: [0, 0] };
    while (st.phase === 'playing') {
      const t = process.hrtime.bigint();
      const e = chooseMove(g, st.edges, 'expert');
      worst = Math.max(worst, Number(process.hrtime.bigint() - t) / 1e6);
      applyLine(st, e);
    }
  }
  strength.worstExpertMs6x6 = Math.round(worst);
  assert.ok(worst < 400, `slowest expert move ${worst.toFixed(0)}ms`);
});

(async () => {
  for (const [name, fn] of [['bot plays a whole game vs a human', botGame], ['leave mid-game (3 seats)', leaveMidGame], ['leave mid-game (2 seats) and while waiting', leaveTwoPlayer]]) {
    try { await fn(); results.push(`  ok  ${name}`); } catch (e) { failures++; results.push(`  FAIL ${name}\n      ${e.stack.split('\n').slice(0, 3).join('\n      ')}`); }
  }
  console.log(results.join('\n'));
  console.log('strength:', JSON.stringify(strength));
  if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
  console.log('all passed');
  process.exit(0);
})();
