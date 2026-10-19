// node test/wordle.test.js — Wordle marking and the shared guessRace round flow
// (server/games/guessRace.js).
'use strict';

const assert = require('assert');
const wordle = require('../server/games/wordle');

const { markGuess, ANSWERS, VALID } = wordle._internals;

function makeRoom(plugin) {
  const room = { state: plugin.createInitialState(), clients: new Map(), sent: [] };
  room.sendTo = (id, env) => room.sent.push({ id, env });
  return room;
}
function join(plugin, room, id) {
  room.clients.set(id, {});
  plugin.onJoin(room, { clientId: id, nickname: id });
}
const act = (plugin, room, id, data) => plugin.onMessage(room, {}, data, { senderId: id, sendTo: room.sendTo });
const viewOf = (plugin, room, id) => plugin.serializeSnapshot(room, { clientId: id });

// Wordle marking, including repeated letters.
assert.strictEqual(markGuess('crane', 'crane'), 'ggggg');
assert.strictEqual(markGuess('speed', 'abide'), 'xxyxy'); // one E in the answer: only one E marked
assert.strictEqual(markGuess('eerie', 'there'), 'yxyxg'); // the green E uses up one, one yellow left
assert.strictEqual(markGuess('lolly', 'hello'), 'xyggx');
assert.ok(ANSWERS.length > 500 && ANSWERS.every((w) => VALID.has(w)));

// Round flow: wrong guesses, an invalid word, a solve, and the reveal.
{
  const room = makeRoom(wordle);
  join(wordle, room, 'a');
  join(wordle, room, 'b');
  act(wordle, room, 'a', { kind: 'start' });
  const answer = room.state.puzzle.answer;
  const wrong = ANSWERS.find((w) => w !== answer);
  act(wordle, room, 'a', { kind: 'guess', guess: 'zzzzz' });
  assert.strictEqual(room.sent.at(-1).env.payload.data.kind, 'error');
  act(wordle, room, 'a', { kind: 'guess', guess: wrong });
  act(wordle, room, 'a', { kind: 'guess', guess: answer });
  let va = viewOf(wordle, room, 'a');
  const vb = viewOf(wordle, room, 'b');
  assert.strictEqual(va.answer, null);
  assert.strictEqual(vb.players.find((p) => p.clientId === 'a').guesses[0].guess, undefined); // letters hidden mid-round
  assert.ok(va.players.find((p) => p.clientId === 'a').solved);
  for (let i = 0; i < 6; i++) act(wordle, room, 'b', { kind: 'guess', guess: wrong });
  assert.strictEqual(room.state.players.get('b').guesses.length, 6);
  va = viewOf(wordle, room, 'a');
  assert.strictEqual(va.phase, 'results');
  assert.strictEqual(va.answer, answer);
  assert.strictEqual(room.state.players.get('a').wins, 1);
}

console.log('wordle: all tests passed');
