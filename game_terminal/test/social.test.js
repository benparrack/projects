// Friends, blocks, recent players, parties — unit tests plus an end-to-end run against the real
// server over WebSockets (dev auth, memory db). Run: node test/social.test.js
'use strict';

const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { createMemoryDb } = require('../server/db');
const { createAccounts } = require('../server/accounts');
const { createSocial } = require('../server/social');
const { Parties } = require('../server/party');

async function units() {
  const db = createMemoryDb();
  const acc = createAccounts(db);
  for (const [uid, username] of [['a', 'Alice'], ['b', 'Bob'], ['c', 'Cyd']]) await acc.claimUsername(uid, { username, acceptTerms: true });
  const s = createSocial(db, acc);

  assert.ok((await s.request('a', 'alice')).error, 'cannot friend yourself');
  assert.ok((await s.request('a', 'nobody')).error);
  const r = await s.request('a', 'bob');
  assert.strictEqual(r.notify, 'b');
  assert.ok((await s.request('a', 'Bob')).error, 'no duplicate request');
  let vb = await s.view('b');
  assert.deepStrictEqual(vb.incoming.map((x) => x.username), ['Alice']);
  assert.ok(!JSON.stringify(vb).includes('"a"'), 'no uids in the view');
  await s.accept('b', 'alice');
  assert.ok(await s.areFriends('a', 'b'));
  vb = await s.view('b', (u) => ({ online: u === 'a' }));
  assert.strictEqual(vb.friends[0].online, true);
  assert.strictEqual(vb.incoming.length, 0);

  // Mutual requests resolve into a friendship.
  await s.request('c', 'alice');
  await s.request('a', 'cyd');
  assert.ok(await s.areFriends('a', 'c'));

  // Blocking drops the friendship and stops requests in both directions.
  await s.block('b', 'alice');
  assert.ok(!(await s.areFriends('a', 'b')));
  assert.ok((await s.request('a', 'bob')).error);
  assert.ok((await s.request('b', 'alice')).error);
  assert.ok(await s.isBlocked('a', 'b'));
  await s.block('b', 'alice', false);
  assert.ok(!(await s.isBlocked('a', 'b')));

  // Recent players: newest first, deduped, capped.
  await s.noteRecent(['a', 'b', null], 'chess');
  await s.noteRecent(['a', 'c'], 'connect4');
  await s.noteRecent(['a', 'b'], 'reversi');
  const va = await s.view('a');
  assert.deepStrictEqual(va.recent.map((x) => [x.username, x.gameType]), [['Bob', 'reversi'], ['Cyd', 'connect4']]);
  assert.strictEqual(va.recent[1].friend, true);

  // Forget (account deletion) removes every trace from other people's docs.
  await s.forget('a');
  assert.ok(![...db._docs].some(([k, v]) => k === 'social/a' || /"a"/.test(JSON.stringify(v.friends || {})) || (v.recent || []).some((x) => x.uid === 'a')));

  // Parties.
  const p = new Parties();
  assert.ok(p.accept('b', 'nope').error);
  const inv = p.invite('a', 'b');
  assert.ok(p.accept('b', inv.party.id).party);
  assert.deepStrictEqual(p.followers('a'), ['b']);
  assert.deepStrictEqual(p.followers('b'), []);
  assert.ok(p.invite('b', 'c').error, 'only the leader invites');
  assert.ok(p.accept('c', inv.party.id).error, 'uninvited cannot join');
  const left = p.leave('a');
  assert.strictEqual(left.party, null, 'two-person party disbands when one leaves');
  assert.strictEqual(p.get('b'), null);
  const big = p.invite('L', 'm0').party;
  for (let i = 0; i < 7; i++) { p.invite('L', `m${i}`); assert.ok(p.accept(`m${i}`, big.id).party); }
  assert.ok(p.invite('L', 'm9').error, 'party cap 8');
  assert.strictEqual(p.leave('L').party.leader, 'm0', 'leadership passes on');
}

// ---- end to end ----
function client(port) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  return {
    ws,
    open: new Promise((r) => ws.on('open', r)),
    send: (type, payload = {}) => ws.send(JSON.stringify({ type, payload })),
    wait(type, pred = () => true, ms = 3000) {
      const hit = inbox.find((m) => m.type === type && pred(m.payload));
      if (hit) { inbox.splice(inbox.indexOf(hit), 1); return Promise.resolve(hit.payload); }
      return new Promise((resolve, reject) => {
        const w = { pred: (m) => m.type === type && pred(m.payload), resolve: (m) => { inbox.splice(inbox.indexOf(m), 1); clearTimeout(t); resolve(m.payload); } };
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`timeout waiting for ${type}`)); }, ms);
        waiters.push(w);
      });
    },
  };
}

async function e2e() {
  const port = 3300 + Math.floor(Math.random() * 500);
  const env = { ...process.env, PORT: String(port), NODE_ENV: 'test' };
  delete env.FIREBASE_SERVICE_ACCOUNT;
  delete env.RENDER;
  const srv = spawn(process.execPath, [path.join(__dirname, '../server/index.js')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((resolve, reject) => {
      srv.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(); });
      srv.on('exit', () => reject(new Error('server exited')));
    });
    const P = require('../server/protocol');
    const C = P.ClientMessage;
    const S = P.ServerMessage;
    const signIn = async (name) => {
      const c = client(port);
      await c.open;
      c.send(C.HELLO, { token: `dev:${name}` });
      await c.wait(S.ACCOUNT_STATE, (p) => p.needsUsername);
      c.send(C.ACCOUNT_CLAIM, { username: name, acceptTerms: true });
      await c.wait(S.WELCOME);
      return c;
    };
    const alice = await signIn('alice');
    const bob = await signIn('bob');

    alice.send(C.FRIEND_REQUEST, { username: 'bob' });
    const req = await bob.wait(S.SOCIAL_NOTICE, (p) => p.kind === 'request');
    assert.strictEqual(req.from.username, 'alice');
    bob.send(C.FRIEND_ACCEPT, { username: 'alice' });
    await alice.wait(S.SOCIAL_NOTICE, (p) => p.kind === 'accepted');
    const st = await alice.wait(S.SOCIAL_STATE, (p) => p.friends.length === 1 && p.friends[0].online);
    assert.strictEqual(st.friends[0].username, 'bob');

    // Presence shows the room; inviting a friend sends them a JOIN-able code.
    alice.send(C.ROOM_CREATE, { gameType: 'connect4' });
    const joined = await alice.wait(S.ROOM_JOINED);
    await bob.wait(S.SOCIAL_STATE, (p) => p.friends[0] && p.friends[0].playing && p.friends[0].playing.code === joined.code);
    alice.send(C.ROOM_INVITE, { username: 'bob' });
    const inv = await bob.wait(S.SOCIAL_NOTICE, (p) => p.kind === 'invite');
    assert.strictEqual(inv.code, joined.code);
    alice.send(C.ROOM_INVITE, { username: 'bob' });
    await alice.wait(S.SOCIAL_NOTICE, (p) => p.kind === 'error' && /moment/.test(p.message));

    // Party: bob joins alice's party and is pulled into her current room, then follows her next one.
    alice.send(C.PARTY_INVITE, { username: 'bob' });
    const pinv = await bob.wait(S.SOCIAL_NOTICE, (p) => p.kind === 'party');
    bob.send(C.PARTY_ACCEPT, { id: pinv.id });
    assert.strictEqual((await bob.wait(S.ROOM_JOINED)).code, joined.code);
    await alice.wait(S.SOCIAL_STATE, (p) => p.party && p.party.members.length === 2 && p.party.leader);
    alice.send(C.ROOM_CREATE, { gameType: 'reversi' });
    const r2 = await alice.wait(S.ROOM_JOINED, (p) => p.gameType === 'reversi');
    assert.strictEqual((await bob.wait(S.ROOM_JOINED, (p) => p.gameType === 'reversi')).code, r2.code);
    await bob.wait(S.SOCIAL_NOTICE, (p) => p.kind === 'follow');

    // Guests can't use any of it and nothing breaks for them.
    const guest = client(port);
    await guest.open;
    guest.send(C.HELLO, { nickname: 'g' });
    await guest.wait(S.WELCOME);
    guest.send(C.FRIEND_REQUEST, { username: 'alice' });
    guest.send(C.ROOM_CREATE, { gameType: 'connect4' });
    await guest.wait(S.ROOM_JOINED);

    // ONLINE NOW: every signed-in player but you, friends first; only public rooms expose a code;
    // blocks hide players both ways; guests are a count.
    const carol = await signIn('carol');
    const dave = await signIn('dave');
    carol.send(C.ROOM_JOIN, { code: P.publicRoomCode('connect4') });
    await carol.wait(S.ROOM_JOINED);
    dave.send(C.USER_BLOCK, { username: 'alice', on: true });
    await dave.wait(S.SOCIAL_STATE, (p) => p.blocked.length === 1);
    alice.send(C.ONLINE_GET);
    const on = await alice.wait(S.ONLINE);
    assert.deepStrictEqual(on.players.map((x) => x.username), ['bob', 'carol']);
    assert.ok(on.players[0].friend && on.players[0].playing.gameType === 'reversi' && !on.players[0].playing.code, 'private room: no code');
    assert.strictEqual(on.players[1].playing.code, P.publicRoomCode('connect4'));
    assert.strictEqual(on.guests, 1);
    assert.ok(!JSON.stringify(on).includes('dev_'), 'no uids');
    carol.ws.close();
    dave.ws.close();

    // Bob goes offline: alice sees it.
    bob.ws.close();
    await alice.wait(S.SOCIAL_STATE, (p) => p.friends[0] && !p.friends[0].online);
    alice.ws.close();
    guest.ws.close();
  } finally {
    srv.kill();
  }
}

(async () => {
  await units();
  console.log('ok - social + party units');
  await e2e();
  console.log('ok - social end-to-end over ws');
  console.log('all social tests passed');
})().catch((err) => { console.error(err); process.exit(1); });
