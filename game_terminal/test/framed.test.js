// node test/framed.test.js — Framed: frames unlock one per miss or skip, titles only in the snapshot.
'use strict';

const assert = require('assert');
const framed = require('../server/games/framed');

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

// Framed: one frame to start, one more per miss or skip; titles only in the snapshot.
{
  const room = makeRoom(framed);
  join(framed, room, 'a');
  act(framed, room, 'a', { kind: 'start' });
  const movie = room.state.puzzle.movie;
  const other = framed._internals.MOVIES.find((m) => m !== movie);
  assert.strictEqual(viewOf(framed, room, 'a').frames.length, 1);
  act(framed, room, 'a', { kind: 'guess', guess: 'Not A Real Movie' });
  assert.strictEqual(room.sent.at(-1).env.payload.data.kind, 'error');
  act(framed, room, 'a', { kind: 'guess', guess: other.title.toUpperCase() });
  act(framed, room, 'a', { kind: 'guess', guess: '' });
  const v = viewOf(framed, room, 'a');
  assert.strictEqual(v.frames.length, 3);
  assert.deepStrictEqual(v.myGuesses.map((g) => g.mark), ['miss', 'skip']);
  assert.ok(v.titles.length > 50);
  assert.ok(!room.sent.at(-1).env.payload.data.titles);
  act(framed, room, 'a', { kind: 'guess', guess: movie.title });
  assert.strictEqual(viewOf(framed, room, 'a').phase, 'results');
  assert.strictEqual(viewOf(framed, room, 'a').frames.length, 6);
  assert.ok(framed._internals.MOVIES.every((m) => m.year >= 2000 && m.dir));
}

console.log('framed: all tests passed');
