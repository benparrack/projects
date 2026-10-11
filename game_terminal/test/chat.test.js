// Chat + moderation: units, then end to end over WebSockets against the real server
// (dev auth, memory db, ADMIN_UIDS=dev_admin). Run: node test/chat.test.js
'use strict';

const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { createMemoryDb } = require('../server/db');
const { createAccounts } = require('../server/accounts');
const { createChat, toClient, clean, LINK_RE } = require('../server/chat');
const { createModeration } = require('../server/moderation');

async function units() {
  let t = 1e12;
  const now = () => t;
  const db = createMemoryDb();
  const acc = createAccounts(db);
  await acc.claimUsername('a', { username: 'Alice', acceptTerms: true });
  await acc.claimUsername('b', { username: 'Bob', acceptTerms: true });
  const A = await acc.getUser('a');
  const chat = createChat(db, { now });

  assert.strictEqual(clean('  hi‮\n\tthere  '), 'hi there');
  for (const bad of ['go to evil.com now', 'https://x.y', 'www.site', 'join discord.gg/abc', 'free robux at site (dot) com']) assert.ok(LINK_RE.test(bad), bad);
  for (const ok of ['gg wp', 'e.g. that move', 'version 1.5 is out', 'nice.', 'I.O.U. one']) assert.ok(!LINK_RE.test(ok), ok);

  const r1 = await chat.post('a', A, 'global', 'hello   world');
  assert.strictEqual(r1.msg.text, 'hello world');
  assert.ok(!('uid' in toClient(r1.msg)));
  assert.strictEqual((await chat.post('a', A, 'global', '   ')).error, null, 'empty is ignored');
  assert.ok((await chat.post('a', A, 'global', 'x'.repeat(201))).error);
  assert.ok((await chat.post('a', A, 'global', 'see bad.com')).error);
  assert.ok(/\*/.test((await chat.post('a', A, 'global', 'oh shit')).msg.text), 'profanity masked');

  // Rate limit: 5 per 10s.
  t += 60000;
  for (let i = 0; i < 5; i++) assert.ok((await chat.post('a', A, 'room:X', `m${i}`)).msg);
  assert.ok(/too fast/.test((await chat.post('a', A, 'room:X', 'm6')).error));
  t += 10001;
  assert.ok((await chat.post('a', A, 'room:X', 'again')).msg);

  // Slow mode when global is busy: 20 messages in 30s from different people.
  t += 60000;
  for (let i = 0; i < 20; i++) { await chat.post(`u${i}`, { username: `U${i}` }, 'global', 'busy'); }
  assert.ok((await chat.post('a', A, 'global', 'one')).msg);
  t += 1000;
  assert.ok(/Slow mode/.test((await chat.post('a', A, 'global', 'two')).error));

  // Mutes.
  assert.ok(/muted/.test((await chat.post('a', { ...A, mutedUntil: t + 1000 }, 'room:Y', 'hey')).error));

  // History is capped and global survives a restart.
  t += 60000;
  for (let i = 0; i < 120; i++) { t += 3000; await chat.post(`v${i % 9}`, { username: 'V' }, 'global', `n${i}`); }
  assert.strictEqual((await chat.history('global')).length, 100);
  await chat.flush();
  const chat2 = createChat(db, { now });
  const h = await chat2.history('global');
  assert.strictEqual(h.length, 100);
  assert.strictEqual(h[99].text, 'n119');
  assert.deepStrictEqual(await chat2.history('room:X'), [], 'room chat is not persisted');

  // Reports: deduped, must match the author, rate limited.
  const B = { uid: 'b', username: 'Bob' };
  const msg = (await chat.post('a', A, 'room:Z', 'you stink')).msg;
  assert.ok((await chat.report(B, { uid: 'a', username: 'Alice' }, { messageId: msg.id, reason: 'rude' })).ok);
  assert.ok(/already/.test((await chat.report(B, { uid: 'a', username: 'Alice' }, { messageId: msg.id })).error));
  assert.ok((await chat.report(B, { uid: 'b', username: 'Bob' }, {})).error, 'no self reports');
  assert.ok((await chat.report(B, { uid: 'x', username: 'X' }, { messageId: msg.id })).error, 'message must be by the target');
  const [rep] = await db.list('reports');
  assert.strictEqual(rep.message.text, 'you stink');
  assert.strictEqual(rep.status, 'open');
  assert.ok(rep.context.length >= 1);

  // Moderation.
  const mod = createModeration(db, acc, { chat, now });
  const admin = { uid: 'b', username: 'Bob' };
  assert.strictEqual((await mod.reports()).length, 1);
  assert.ok((await mod.act(admin, { action: 'mute', username: 'Alice' })).error, 'mute needs a duration');
  const m = await mod.act(admin, { action: 'mute', username: 'Alice', minutes: 10, reportId: rep.id });
  assert.strictEqual(m.user.mutedUntil, t + 600000);
  assert.strictEqual((await mod.reports()).length, 0, 'acting on a report resolves it');
  assert.strictEqual((await mod.lookup('alice')).mutedUntil, t + 600000);
  await mod.act(admin, { action: 'unmute', username: 'Alice' });
  assert.strictEqual((await mod.lookup('alice')).mutedUntil, null);
  assert.ok((await mod.act(admin, { action: 'ban', username: 'Bob', minutes: 5 })).error, 'not yourself');
  const del = await mod.act(admin, { action: 'deleteMessage', messageId: msg.id });
  assert.strictEqual(del.deleted, msg.id);
  assert.ok(!chat.find(msg.id));
  await db.set('stats/a_chess', { uid: 'a', played: 3 });
  await mod.act(admin, { action: 'resetStats', username: 'Alice' });
  assert.strictEqual(await db.get('stats/a_chess'), null);
  await acc.claimUsername('a', { username: 'Alice2' }, t); // starts a rename cooldown
  const rn = await mod.act(admin, { action: 'rename', username: 'Alice2' });
  assert.ok(/^player_\d{6}$/.test(rn.user.username));
  assert.strictEqual(await acc.uidForUsername('alice2'), null, 'old name freed');
  assert.ok((await acc.claimUsername('a', { username: 'Alice3' }, t)).user, 'user can pick a new name right away');
  assert.ok((await mod.lookup('alice3')).log.some((l) => l.action === 'rename'));

  // Account deletion purges messages, including saved history.
  await chat.post('b', { username: 'Bob' }, 'dm:a_b', 'secret');
  await chat.purgeUser('v1', []);
  assert.ok(!(await chat.history('global')).some((x) => x.uid === 'v1'));
  assert.ok(!((await db.get('chat/global')).messages.some((x) => x.uid === 'v1')));
  await chat.purgeUser('b', ['dm:a_b']);
  assert.strictEqual(await db.get('chat/dm_a_b'), null);
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
    closed: new Promise((r) => ws.on('close', (code) => r(code))),
    open: new Promise((r) => ws.on('open', r)),
    send: (type, payload = {}) => ws.send(JSON.stringify({ type, payload })),
    none(type, pred = () => true) { return !inbox.some((m) => m.type === type && pred(m.payload)); },
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
  const env = { ...process.env, PORT: String(port), NODE_ENV: 'test', ADMIN_UIDS: 'dev_admin1' };
  delete env.FIREBASE_SERVICE_ACCOUNT;
  delete env.RENDER;
  const srv = spawn(process.execPath, [path.join(__dirname, '../server/index.js')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((resolve, reject) => {
      srv.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(); });
      srv.on('exit', () => reject(new Error('server exited')));
    });
    const { ClientMessage: C, ServerMessage: S } = require('../server/protocol');
    const signIn = async (name) => {
      const c = client(port);
      await c.open;
      c.send(C.HELLO, { token: `dev:${name}` });
      await c.wait(S.ACCOUNT_STATE, (p) => p.needsUsername);
      c.send(C.ACCOUNT_CLAIM, { username: name, acceptTerms: true });
      await c.wait(S.WELCOME);
      c.state = await c.wait(S.ACCOUNT_STATE, (p) => p.user);
      return c;
    };
    const alice = await signIn('alice');
    const bob = await signIn('bob');
    const admin = await signIn('admin1');
    assert.ok(admin.state.user.admin, 'ADMIN_UIDS grants admin');
    assert.ok(!alice.state.user.admin);

    // Global chat: anyone can read; posting needs a finished game.
    const guest = client(port);
    await guest.open;
    guest.send(C.HELLO, { nickname: 'g' });
    await guest.wait(S.WELCOME);
    guest.send(C.CHAT_OPEN, { channel: 'global' });
    const gh = await guest.wait(S.CHAT_HISTORY);
    assert.deepStrictEqual([gh.canPost, gh.reason], [false, 'signin']);
    alice.send(C.CHAT_OPEN, { channel: 'global' });
    assert.strictEqual((await alice.wait(S.CHAT_HISTORY)).reason, 'newAccount');
    alice.send(C.CHAT_SEND, { channel: 'global', text: 'hi all' });
    assert.ok(/Finish one game/.test((await alice.wait(S.CHAT_ERROR)).message));

    // Room chat reaches everyone in the room, guests included; guests can't post.
    alice.send(C.ROOM_CREATE, { gameType: 'connect4' });
    const { code } = await alice.wait(S.ROOM_JOINED);
    bob.send(C.ROOM_JOIN, { code });
    await bob.wait(S.ROOM_JOINED);
    guest.send(C.ROOM_JOIN, { code });
    await guest.wait(S.ROOM_JOINED);
    alice.send(C.CHAT_SEND, { channel: 'room', text: 'glhf' });
    for (const c of [alice, bob, guest]) assert.strictEqual((await c.wait(S.CHAT_MESSAGE, (p) => p.channel === 'room')).msg.text, 'glhf');
    guest.send(C.CHAT_SEND, { channel: 'room', text: 'me too' });
    assert.ok(/Sign in/.test((await guest.wait(S.CHAT_ERROR)).message));
    bob.send(C.CHAT_OPEN, { channel: 'room' });
    const bh = await bob.wait(S.CHAT_HISTORY, (p) => p.channel === 'room');
    assert.deepStrictEqual(bh.messages.map((m) => m.text), ['glhf']);
    assert.ok(!JSON.stringify(bh).includes('dev_alice'), 'no uids leak');

    // DMs: friends only, filed under the other person's name on each side.
    alice.send(C.CHAT_SEND, { channel: 'dm', with: 'bob', text: 'psst' });
    assert.ok(/only message friends/.test((await alice.wait(S.CHAT_ERROR)).message));
    alice.send(C.FRIEND_REQUEST, { username: 'bob' });
    await bob.wait(S.SOCIAL_NOTICE, (p) => p.kind === 'request');
    bob.send(C.FRIEND_ACCEPT, { username: 'alice' });
    await alice.wait(S.SOCIAL_NOTICE, (p) => p.kind === 'accepted');
    alice.send(C.CHAT_SEND, { channel: 'dm', with: 'bob', text: 'psst' });
    assert.strictEqual((await bob.wait(S.CHAT_MESSAGE, (p) => p.channel === 'dm')).with, 'alice');
    assert.strictEqual((await alice.wait(S.CHAT_MESSAGE, (p) => p.channel === 'dm')).with, 'bob');
    assert.ok(guest.none(S.CHAT_MESSAGE, (p) => p.channel === 'dm'));

    // Party chat.
    alice.send(C.PARTY_INVITE, { username: 'bob' });
    const pinv = await bob.wait(S.SOCIAL_NOTICE, (p) => p.kind === 'party');
    bob.send(C.PARTY_ACCEPT, { id: pinv.id });
    await alice.wait(S.SOCIAL_STATE, (p) => p.party && p.party.members.length === 2);
    bob.send(C.CHAT_SEND, { channel: 'party', text: 'ready' });
    assert.strictEqual((await alice.wait(S.CHAT_MESSAGE, (p) => p.channel === 'party')).msg.from.username, 'bob');

    // Report → admin queue → mute → bob can't post; delete the message for everyone.
    bob.send(C.CHAT_SEND, { channel: 'room', text: 'you are bad' });
    const bad = (await alice.wait(S.CHAT_MESSAGE, (p) => p.msg.text === 'you are bad')).msg;
    alice.send(C.CHAT_REPORT, { username: 'bob', messageId: bad.id, reason: 'rude' });
    assert.ok(/moderator/.test((await alice.wait(S.SOCIAL_NOTICE, (p) => p.kind === 'ok' && /moderator/.test(p.message))).message));
    alice.send(C.ADMIN_REPORTS, {});
    assert.strictEqual((await alice.wait(S.ADMIN_DATA)).error, 'Admins only.');
    admin.send(C.ADMIN_REPORTS, {});
    const q = await admin.wait(S.ADMIN_DATA, (p) => p.reports);
    assert.strictEqual(q.reports.length, 1);
    admin.send(C.ADMIN_ACTION, { action: 'mute', username: 'bob', minutes: 5, reportId: q.reports[0].id });
    assert.ok(/Muted/.test((await admin.wait(S.ADMIN_DATA, (p) => p.message)).message));
    bob.send(C.CHAT_SEND, { channel: 'room', text: 'still here' });
    assert.ok(/muted/.test((await bob.wait(S.CHAT_ERROR)).message));
    admin.send(C.ADMIN_ACTION, { action: 'deleteMessage', messageId: bad.id });
    for (const c of [alice, guest]) assert.strictEqual((await c.wait(S.CHAT_DELETED)).id, bad.id);

    // Ban kicks every socket and blocks sign-in; the guest is unaffected.
    admin.send(C.ADMIN_ACTION, { action: 'ban', username: 'bob', minutes: 60 });
    assert.ok((await bob.wait(S.ACCOUNT_ERROR, (p) => p.banned)).message.includes('suspended'));
    assert.strictEqual(await bob.closed, 4003);
    const bob2 = client(port);
    await bob2.open;
    bob2.send(C.HELLO, { token: 'dev:bob', nickname: 'bob-as-guest' });
    assert.ok((await bob2.wait(S.ACCOUNT_ERROR)).banned);
    await bob2.wait(S.WELCOME); // falls back to a guest session
    guest.send(C.ROOM_LEAVE);
    guest.send(C.ROOM_CREATE, { gameType: 'connect4' });
    await guest.wait(S.ROOM_JOINED);
    for (const c of [alice, admin, guest, bob2]) c.ws.close();
  } finally {
    srv.kill();
  }
}

(async () => {
  await units();
  console.log('ok - chat + moderation units');
  await e2e();
  console.log('ok - chat end-to-end over ws');
  console.log('all chat tests passed');
})().catch((err) => { console.error(err); process.exit(1); });
