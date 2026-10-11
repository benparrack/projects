// node test/twentyq.test.js — 20 Questions: KB consistency, keyword answering, bot guesser skill
// (Expert solves >80% of KB words within 20), protocol guards, privacy, rounds/scoring, leave/rematch,
// bot-vs-bot never stalls.
'use strict';
const assert = require('assert');
const plugin = require('../server/games/twentyq');
const { timing, kb, MAX_Q, ROUNDS, STUMP_POINTS, botAnswer, botGuesserMove, makeAttrMask, guessMatches, makeSecret, questionTarget } = plugin._internal;

// Speed bot timers up for the async tests.
Object.assign(timing, { pickMin: 1, pickMax: 3, askMin: 1, askMax: 3, answerMin: 1, answerMax: 3, roundPause: 20 });

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeRoom(ids = []) {
  const sent = [];
  const room = { state: plugin.createInitialState(), clients: new Map(), sent };
  room.sendTo = (id, env) => sent.push({ to: id, env });
  room.broadcast = (env) => sent.push({ to: '*', env });
  for (const id of ids) room.clients.set(id, { clientId: id });
  return room;
}
const send = (room, id, data) => plugin.onMessage(room, { clientId: id }, data, { senderId: id });
const lastStateFor = (room, id) => {
  const s = [...room.sent].reverse().find((x) => x.to === id && x.env.payload.data.kind === 'state');
  return s && s.env.payload.data;
};
const lastReject = (room, id) => {
  const s = [...room.sent].reverse().find((x) => x.to === id && x.env.payload.data.kind === 'moveRejected');
  return s && s.env.payload.data.reason;
};
function expectReject(room, id, data, reason) {
  room.sent.length = 0;
  const before = JSON.stringify(room.state);
  send(room, id, data);
  assert.strictEqual(lastReject(room, id), reason, `${JSON.stringify(data)} → ${reason}`);
  assert.strictEqual(JSON.stringify(room.state), before, 'state unchanged after reject');
}
// Two humans seated: A in p1 (picks first), B in p2, spectator S.
function humanRoom() {
  const room = makeRoom(['A', 'B', 'S']);
  send(room, 'A', { kind: 'sit', seat: 'p1' });
  send(room, 'B', { kind: 'sit', seat: 'p2' });
  return room;
}
const pickerId = (room) => room.state.players[room.state.picker];
const guesserId = (room) => room.state.players[room.state.guesser];

// ------------------------------------------------------------------------------------------------
test('KB: size, categories, attributes, values', () => {
  assert.ok(kb.NOUNS.length >= 150, `nouns ${kb.NOUNS.length}`);
  assert.ok(kb.ATTRS.length >= 40, `attrs ${kb.ATTRS.length}`);
  for (const c of kb.CATEGORIES) {
    assert.ok(kb.CATEGORY_LABEL[c], `label ${c}`);
    assert.ok(kb.NOUNS.filter((n) => n.category === c).length >= 15, `category ${c} has enough words`);
  }
  const attrIds = new Set();
  kb.ATTRS.forEach((a) => {
    assert.ok(a.id && !attrIds.has(a.id), `unique attr id ${a.id}`);
    attrIds.add(a.id);
    assert.ok(typeof a.q === 'string' && a.q.endsWith('?'), `attr ${a.id} question`);
    assert.ok(Array.isArray(a.kw) && a.kw.length, `attr ${a.id} keywords`);
  });
  const names = new Set();
  kb.NOUNS.forEach((n, i) => {
    assert.strictEqual(n.id, i);
    assert.ok(kb.CATEGORIES.includes(n.category), `${n.name} category`);
    assert.ok(!names.has(n.name), `duplicate noun ${n.name}`);
    names.add(n.name);
    assert.strictEqual(n.values.length, kb.ATTRS.length, `${n.name} value count`);
    assert.ok(n.values.every((v) => v === 'Y' || v === 'N' || v === 'S'), `${n.name} values`);
    assert.deepStrictEqual(n._badTags || [], [], `${n.name} has unknown tags`);
    // Category attribute agrees with the category.
    const ci = kb.ATTRS.findIndex((a) => a.id === n.category);
    assert.strictEqual(n.values[ci], 'Y', `${n.name} is a ${n.category}`);
    assert.strictEqual(kb.findNoun(n.name), n, `findNoun(${n.name})`);
    for (const a of n.aliases) assert.strictEqual(kb.findNoun(a), n, `alias ${a} → ${n.name}`);
  });
});

test('KB: every pair of words differs on at least one hard (yes vs no) attribute', () => {
  const clash = [];
  for (let i = 0; i < kb.NOUNS.length; i++) {
    for (let j = i + 1; j < kb.NOUNS.length; j++) {
      const a = kb.NOUNS[i].values;
      const b = kb.NOUNS[j].values;
      if (!a.some((v, k) => (v === 'Y' && b[k] === 'N') || (v === 'N' && b[k] === 'Y'))) clash.push(`${kb.NOUNS[i].name}/${kb.NOUNS[j].name}`);
    }
  }
  assert.deepStrictEqual(clash, []);
});

test('KB: spot-check facts', () => {
  const v = (name, id) => kb.NOUNS.find((n) => n.name === name).values[kb.ATTRS.findIndex((a) => a.id === id)];
  assert.strictEqual(v('dog', 'pet'), 'Y');
  assert.strictEqual(v('dog', 'fly'), 'N');
  assert.strictEqual(v('pizza', 'food'), 'Y');
  assert.strictEqual(v('pizza', 'alive'), 'N');
  assert.strictEqual(v('beach', 'place'), 'Y');
});

test('keyword answering: attributes, inversion, named nouns, unknown', () => {
  const dog = kb.findNoun('dog');
  const pizza = kb.findNoun('pizza');
  assert.strictEqual(botAnswer(dog, 'Is it an animal?'), 'yes');
  assert.strictEqual(botAnswer(dog, 'does it have fur'), 'yes');
  assert.strictEqual(botAnswer(dog, 'Can it fly?'), 'no');
  assert.strictEqual(botAnswer(dog, 'Is it alive'), 'yes');
  assert.strictEqual(botAnswer(pizza, 'Can you eat it?'), 'yes');
  assert.strictEqual(botAnswer(pizza, 'is it alive?'), 'no');
  assert.strictEqual(botAnswer(dog, 'Is it a dog?'), 'yes');
  assert.strictEqual(botAnswer(dog, 'is it a cat?'), 'no');
  assert.strictEqual(botAnswer(dog, 'what is the meaning of life'), 'unknown');
  assert.strictEqual(botAnswer(dog, 'blorptastic zingle?'), 'unknown');
  assert.strictEqual(botAnswer(null, 'is it alive?'), 'unknown');
  // Every attribute's own question is understood and answered from the KB.
  for (const n of [dog, pizza, kb.findNoun('beach')]) {
    kb.ATTRS.forEach((a, i) => {
      const m = kb.matchAttribute(a.q);
      assert.ok(m && m.attr === i && !m.invert, `attr question "${a.q}" maps to itself (got ${m && kb.ATTRS[m.attr].id})`);
      assert.strictEqual(botAnswer(n, a.q), kb.ANSWER[n.values[i]], `${n.name}: ${a.q}`);
    });
  }
});

test('guess matching: synonyms, typos, articles; siblings do not count', () => {
  const s = makeSecret('elephant', null);
  assert.strictEqual(s.category, 'animal');
  assert.ok(guessMatches('Elephant', s));
  assert.ok(guessMatches('an elephant', s));
  assert.ok(guessMatches('elephants', s));
  assert.ok(guessMatches('elephnat', s), 'transposition forgiven');
  assert.ok(!guessMatches('giraffe', s));
  const cat = makeSecret('cat', null);
  assert.ok(!guessMatches('bat', cat), 'no typo forgiveness on short words');
  const custom = makeSecret('Eiffel Tower', 'place');
  assert.strictEqual(custom.nounId, null);
  assert.strictEqual(custom.category, 'place');
  assert.ok(guessMatches('the eiffel tower', custom));
  assert.strictEqual(makeSecret('zorbleflux', 'nonsense').category, 'any');
  assert.strictEqual(questionTarget('Is it a giraffe?'), 'giraffe');
  assert.strictEqual(questionTarget('Does it have fur?'), null);
});

// ------------------------------------------------------------------------------------------------
function simulate(noun, level) {
  const history = [];
  const attrMask = makeAttrMask(level);
  for (let used = 0; used < MAX_Q; used++) {
    const mv = botGuesserMove({ history, category: noun.category, level, used, attrMask });
    if (mv.kind === 'guess') {
      if (mv.noun === noun.id) return used + 1;
      history.push({ kind: 'guess', noun: mv.noun, answer: 'no' });
    } else {
      assert.ok(Number.isInteger(mv.attr) && kb.ATTRS[mv.attr], 'bot asks a real attribute');
      history.push({ kind: 'q', attr: mv.attr, answer: kb.ANSWER[noun.values[mv.attr]] });
    }
  }
  return 0;
}
const skill = {};
test('Expert bot guesser finds >80% of KB words within 20 questions', () => {
  let ok = 0;
  let sum = 0;
  for (const n of kb.NOUNS) { const q = simulate(n, 'expert'); if (q) { ok++; sum += q; } }
  skill.expert = { rate: ok / kb.NOUNS.length, avgQ: sum / ok };
  assert.ok(skill.expert.rate > 0.8, `expert success ${(skill.expert.rate * 100).toFixed(1)}%`);
});

test('skill gradient: points per round Easy < Medium < Hard <= Expert', () => {
  for (const level of ['easy', 'medium', 'hard', 'expert']) {
    let ok = 0; let sum = 0; let pts = 0; let N = 0;
    for (let r = 0; r < 2; r++) {
      for (const n of kb.NOUNS) {
        N++;
        const q = simulate(n, level);
        if (q) { ok++; sum += q; pts += MAX_Q + 1 - q; }
      }
    }
    skill[level] = { rate: ok / N, avgQ: sum / ok, pts: pts / N };
  }
  const line = Object.entries(skill).map(([l, s]) => `${l} ${(s.rate * 100).toFixed(0)}% avgQ ${s.avgQ.toFixed(1)} pts ${s.pts.toFixed(1)}`).join(' | ');
  console.log(`    ${line}`);
  assert.ok(skill.easy.pts < skill.medium.pts, 'easy < medium');
  assert.ok(skill.medium.pts < skill.hard.pts, 'medium < hard');
  assert.ok(skill.hard.pts <= skill.expert.pts + 0.3, 'hard <= expert');
  assert.ok(skill.expert.pts - skill.easy.pts > 4, 'clear gap easy→expert');
});

test('bot guesser copes with human UNKNOWN / contradictory answers (never throws, always legal)', () => {
  const rng = () => 0.42;
  for (const level of ['easy', 'medium', 'hard', 'expert']) {
    const history = [];
    for (let used = 0; used < MAX_Q; used++) {
      const mv = botGuesserMove({ history, category: used % 2 ? 'any' : 'food', level, used, attrMask: makeAttrMask(level, rng) });
      assert.ok(mv && (mv.kind === 'q' || mv.kind === 'guess'));
      history.push(mv.kind === 'q' ? { kind: 'q', attr: mv.attr, answer: ['yes', 'no', 'unknown', 'sometimes'][used % 4] } : { kind: 'guess', noun: mv.noun, answer: 'no' });
    }
  }
});

// ------------------------------------------------------------------------------------------------
test('seating starts a match; picker gets suggestions, guesser/spectator never see the word', () => {
  const room = humanRoom();
  const st = room.state;
  assert.strictEqual(st.phase, 'picking');
  assert.strictEqual(st.picker, 'p1');
  const pv = lastStateFor(room, 'A');
  assert.strictEqual(pv.suggestions.length, 3);
  assert.deepStrictEqual(lastStateFor(room, 'B').suggestions, []);
  assert.deepStrictEqual(lastStateFor(room, 'S').suggestions, []);
  send(room, 'A', { kind: 'pick', index: 1 });
  assert.strictEqual(st.phase, 'asking');
  const word = st.secret.word;
  assert.strictEqual(lastStateFor(room, 'A').secretWord, word);
  for (const id of ['B', 'S']) {
    const v = lastStateFor(room, id);
    assert.strictEqual(v.secretWord, null);
    assert.strictEqual(v.inKb, null);
    assert.ok(!JSON.stringify(v).toLowerCase().includes(`"${word.toLowerCase()}"`), `${id} view leaks word`);
    assert.ok(v.category, 'category hint is public');
  }
  assert.strictEqual(plugin.serializeSnapshot(room, { clientId: 'S' }).secretWord, null);
  assert.strictEqual(plugin.serializeSnapshot(room, null).secretWord, null);
});

test('protocol guards: wrong seat, wrong phase, bad input', () => {
  const room = humanRoom();
  expectReject(room, 'B', { kind: 'pick', index: 0 }, 'not_your_turn');
  expectReject(room, 'S', { kind: 'pick', index: 0 }, 'not_your_turn');
  expectReject(room, 'A', { kind: 'ask', text: 'is it alive' }, 'not_playing');
  expectReject(room, 'A', { kind: 'pick', index: 3 }, 'invalid');
  expectReject(room, 'A', { kind: 'pick', index: 1.5 }, 'invalid');
  expectReject(room, 'A', { kind: 'pick', index: -1 }, 'invalid');
  expectReject(room, 'A', { kind: 'pick', word: '!!!' }, 'bad_word');
  expectReject(room, 'A', { kind: 'pick', word: '   ' }, 'bad_word');
  expectReject(room, 'A', { kind: 'pick', word: 'x'.repeat(31) }, 'too_long');
  expectReject(room, 'A', { kind: 'pick', word: 42 }, 'too_long');
  expectReject(room, 'A', { kind: 'pick', word: '<script>' }, 'bad_word');
  expectReject(room, 'B', { kind: 'reroll' }, 'not_your_turn');
  const old = room.state.suggestions.slice();
  send(room, 'A', { kind: 'reroll' });
  assert.ok(room.state.suggestions.every((id) => !old.includes(id)), 'reroll gives fresh words');
  send(room, 'A', { kind: 'pick', word: '  Rubber   duck ', category: 'object' });
  assert.strictEqual(room.state.secret.word, 'Rubber duck');
  assert.strictEqual(room.state.phase, 'asking');
  expectReject(room, 'A', { kind: 'ask', text: 'is it alive' }, 'not_your_turn');
  expectReject(room, 'S', { kind: 'ask', text: 'is it alive' }, 'not_your_turn');
  expectReject(room, 'B', { kind: 'ask', text: '' }, 'empty');
  expectReject(room, 'B', { kind: 'ask', text: '???' }, 'empty');
  expectReject(room, 'B', { kind: 'ask', text: 'a'.repeat(101) }, 'too_long');
  expectReject(room, 'B', { kind: 'ask', text: { evil: 1 } }, 'too_long');
  expectReject(room, 'B', { kind: 'guess', text: 'x'.repeat(31) }, 'too_long');
  expectReject(room, 'A', { kind: 'answer', value: 'yes' }, 'not_playing');
  send(room, 'B', { kind: 'ask', text: 'Is it yellow?' });
  assert.strictEqual(room.state.phase, 'answering');
  expectReject(room, 'B', { kind: 'ask', text: 'another?' }, 'wait_answer');
  expectReject(room, 'B', { kind: 'answer', value: 'yes' }, 'not_your_turn');
  expectReject(room, 'A', { kind: 'answer', value: 'maybe' }, 'bad_answer');
  expectReject(room, 'A', { kind: 'answer', value: null }, 'bad_answer');
  send(room, 'A', { kind: 'answer', value: 'yes' });
  assert.strictEqual(room.state.questions[0].answer, 'yes');
  assert.strictEqual(room.state.phase, 'asking');
  // Guess answers are limited to yes / no / correct.
  send(room, 'B', { kind: 'guess', text: 'banana' });
  expectReject(room, 'A', { kind: 'answer', value: 'sometimes' }, 'bad_answer');
  send(room, 'A', { kind: 'answer', value: 'no' });
  assert.strictEqual(room.state.questions.length, 2);
  // Silent ignores (no seat, no state change): garbage messages never throw.
  const garbage = [null, undefined, 5, 'str', [], {}, { kind: 7 }, { kind: 'sit' }, { kind: 'sit', seat: 'p3' }, { kind: 'sit', seat: '__proto__' },
    { kind: 'sit', seat: 'p1' }, { kind: 'resetGame' }, { kind: 'nextRound' }, { kind: 'removeBot', seat: 'p1' }, { kind: 'setBotLevel', seat: 'p2', level: 'x' },
    { kind: 'nope' }, { kind: 'constructor' }, { kind: 'pick', index: '0' }, { kind: 'answer' }];
  for (const g of garbage) for (const id of ['A', 'B', 'S', null, 'BOT']) assert.doesNotThrow(() => send(room, id, g));
  assert.strictEqual(room.state.phase, 'asking');
  assert.deepStrictEqual(room.state.players, { p1: 'A', p2: 'B' });
});

test('question auto-solves "is it a X?" and correct guesses; points = 21 - n', () => {
  const room = humanRoom();
  send(room, 'A', { kind: 'pick', word: 'giraffe' });
  send(room, 'B', { kind: 'ask', text: 'Does it have four legs?' });
  send(room, 'A', { kind: 'answer', value: 'yes' });
  send(room, 'B', { kind: 'ask', text: 'Is it a giraffe?' });
  const st = room.state;
  assert.strictEqual(st.phase, 'round_over');
  assert.strictEqual(st.result.solved, true);
  assert.strictEqual(st.result.points, 19);
  assert.strictEqual(st.scores.p2, 19);
  assert.strictEqual(st.questions[1].answer, 'correct');
  assert.strictEqual(lastStateFor(room, 'S').secretWord, 'giraffe', 'revealed after the round');
  assert.ok(lastStateFor(room, 'S').nextInMs > 0);
});

test('picker can confirm a near-miss with CORRECT; 20 misses stump the guesser', () => {
  const room = humanRoom();
  send(room, 'A', { kind: 'pick', word: 'rubber duck', category: 'object' });
  send(room, 'B', { kind: 'guess', text: 'duck' });
  send(room, 'A', { kind: 'answer', value: 'yes' }); // "yes" to a guess = correct
  assert.strictEqual(room.state.result.solved, true);
  assert.strictEqual(room.state.scores.p2, 20);
  // Round 2: roles swap, B picks.
  send(room, 'A', { kind: 'nextRound' });
  const st = room.state;
  assert.strictEqual(st.round, 2);
  assert.strictEqual(st.picker, 'p2');
  send(room, 'B', { kind: 'pick', index: 0 });
  for (let i = 0; i < MAX_Q; i++) {
    send(room, 'A', { kind: i % 5 === 4 ? 'guess' : 'ask', text: i % 5 === 4 ? `zzqx${i}` : `Question number ${i}?` });
    assert.strictEqual(st.phase, 'answering');
    send(room, 'B', { kind: 'answer', value: 'no' });
  }
  assert.strictEqual(st.questions.length, MAX_Q);
  assert.strictEqual(st.phase, 'game_over');
  assert.strictEqual(st.result.solved, false);
  assert.strictEqual(st.scores.p2, 20 + STUMP_POINTS);
  assert.strictEqual(st.winner, 'p2');
  assert.strictEqual(st.series.p2, 1);
  assert.strictEqual(st.roundLog.length, ROUNDS);
  // Rematch: only seated players, swaps who picks first, keeps the series.
  send(room, 'S', { kind: 'resetGame' });
  assert.strictEqual(st.phase, 'game_over');
  send(room, 'A', { kind: 'resetGame' });
  assert.strictEqual(room.state.phase, 'picking');
  assert.strictEqual(room.state.picker, 'p2');
  assert.deepStrictEqual(room.state.scores, { p1: 0, p2: 0 });
  assert.strictEqual(room.state.series.p2, 1);
});

test('leaving mid-game resets to waiting and frees the seat; others can sit', () => {
  const room = humanRoom();
  send(room, 'A', { kind: 'pick', index: 0 });
  send(room, 'B', { kind: 'ask', text: 'is it big?' });
  plugin.onLeave(room, { clientId: 'B' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.strictEqual(room.state.players.p2, null);
  assert.strictEqual(room.state.secret, null);
  plugin.onLeave(room, { clientId: 'S' }); // spectator leaving is harmless
  send(room, 'S', { kind: 'sit', seat: 'p2' });
  assert.strictEqual(room.state.phase, 'picking');
  send(room, 'A', { kind: 'leaveSeat' });
  assert.strictEqual(room.state.phase, 'waiting');
  assert.ok(!plugin.isRoomFull(room));
});

// ------------------------------------------------------------------------------------------------
test('bot as picker answers human questions from the KB', async () => {
  const room = makeRoom(['H']);
  send(room, 'H', { kind: 'sit', seat: 'p2' });
  send(room, 'H', { kind: 'sit', seat: 'p1', bot: true, level: 'expert' });
  const st = room.state;
  assert.strictEqual(st.picker, 'p1');
  for (let i = 0; i < 100 && st.phase === 'picking'; i++) await sleep(5);
  assert.strictEqual(st.phase, 'asking');
  assert.ok(st.secret.nounId != null, 'bot picks a KB word');
  const noun = kb.NOUNS[st.secret.nounId];
  assert.strictEqual(lastStateFor(room, 'H').secretWord, null);
  send(room, 'H', { kind: 'ask', text: 'Is it alive?' });
  for (let i = 0; i < 100 && st.phase === 'answering'; i++) await sleep(5);
  assert.strictEqual(st.questions[0].answer, botAnswer(noun, 'Is it alive?'));
  send(room, 'H', { kind: 'ask', text: 'Do you like jazz music on tuesdays' });
  for (let i = 0; i < 100 && st.phase === 'answering'; i++) await sleep(5);
  assert.ok(['unknown', 'yes', 'no', 'sometimes'].includes(st.questions[1].answer));
  send(room, 'H', { kind: 'guess', text: noun.name });
  assert.strictEqual(st.phase, 'round_over');
  assert.strictEqual(st.scores.p2, 18);
});

test('bot as guesser solves a human-picked KB word when answered truthfully', async () => {
  const room = makeRoom(['H']);
  send(room, 'H', { kind: 'sit', seat: 'p1' });
  send(room, 'H', { kind: 'sit', seat: 'p2', bot: true, level: 'expert' });
  send(room, 'H', { kind: 'pick', word: 'penguin' });
  const st = room.state;
  const noun = kb.findNoun('penguin');
  for (let i = 0; i < 400 && st.phase !== 'round_over'; i++) {
    if (st.phase === 'answering') {
      const q = st.questions[st.questions.length - 1];
      const lv = lastStateFor(room, 'H').questions.slice(-1)[0];
      assert.strictEqual(lv.attr, undefined, 'bot internals are not sent');
      send(room, 'H', { kind: 'answer', value: q.kind === 'guess' ? 'no' : botAnswer(noun, q.text) });
    }
    await sleep(3);
  }
  assert.strictEqual(st.phase, 'round_over');
  assert.strictEqual(st.result.solved, true, `solved penguin (${st.questions.length} q)`);
});

test('bot vs bot plays full matches at every level without stalling; level change mid-game is safe', async () => {
  const room = makeRoom(['S']);
  send(room, 'S', { kind: 'sit', seat: 'p1', bot: true, level: 'easy' });
  send(room, 'S', { kind: 'sit', seat: 'p2', bot: true, level: 'expert' });
  const st = room.state;
  let matches = 0;
  const deadline = Date.now() + 15000;
  let changedLevel = false;
  while (matches < 4 && Date.now() < deadline) {
    if (!changedLevel && st.phase === 'asking') { send(room, 'S', { kind: 'setBotLevel', seat: 'p1', level: 'medium' }); changedLevel = true; }
    if (st.phase === 'game_over') {
      matches++;
      assert.strictEqual(st.roundLog.length, ROUNDS);
      // Seated humans only may reset; spectators can't, so emulate a seated reset directly.
      st.firstPicker = st.firstPicker === 'p1' ? 'p2' : 'p1';
      send(room, 'S', { kind: 'removeBot', seat: 'p1' });
      assert.strictEqual(st.phase, 'waiting');
      send(room, 'S', { kind: 'sit', seat: 'p1', bot: true, level: ['easy', 'medium', 'hard', 'expert'][matches % 4] });
    }
    await sleep(2);
  }
  assert.ok(matches >= 4, `completed ${matches} bot-vs-bot matches`);
});

// ------------------------------------------------------------------------------------------------
(async () => {
  const t0 = Date.now();
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}\n     ${e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n     ') : e}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed ? 1 : 0);
})();
