// Friends drawer, social notices (requests, room invites, party invites) and the friend/block
// buttons on profiles. State arrives as SOCIAL_STATE over the socket (accounts only).
import { ClientMessage } from './protocol.js';
import { h, toast, timeAgo } from './ui.js';
import { avatarEl } from './avatars.js';

let social = null;
let ctx = null; // { send, gameLabel, currentRoom(), join(code), navigate(href) }
const subs = new Set();
const els = {};

const send = (type, payload = {}) => ctx.send(type, payload);
const sameName = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

export function initFriends(options) {
  ctx = options;
  els.btn = document.getElementById('btn-friends');
  els.badge = h('span.badge', { hidden: true });
  els.btn.append(els.badge);
  els.list = h('div.drawer-body');
  els.close = h('button.modal-x', { type: 'button', 'aria-label': 'Close friends', onclick: () => toggle(false) }, '×');
  els.drawer = h('aside.drawer', { id: 'friends-drawer', 'aria-label': 'Friends', hidden: true, tabindex: -1 },
    h('div.drawer-head', h('h2', 'FRIENDS'), els.close), els.list);
  document.body.append(els.drawer);
  els.btn.setAttribute('aria-controls', 'friends-drawer');
  els.btn.addEventListener('click', () => toggle());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.drawer.hidden && !document.querySelector('.modal-backdrop')) { toggle(false); els.btn.focus(); } });
  document.addEventListener('mousedown', (e) => {
    if (!els.drawer.hidden && !els.drawer.contains(e.target) && !els.btn.contains(e.target) && !e.target.closest('#toast-root, .modal-backdrop')) toggle(false);
  });
}

function toggle(open = els.drawer.hidden) {
  els.drawer.hidden = !open;
  els.btn.setAttribute('aria-expanded', String(open));
  if (open) { render(); els.drawer.focus(); }
}
export const openFriends = () => toggle(true);

// Signed out: hide everything and forget the state.
export function setSignedIn(on) {
  els.btn.hidden = !on;
  if (!on) { social = null; toggle(false); subs.forEach((f) => f()); }
}

export function getSocial() { return social; }

export function handleSocialState(p) {
  social = p;
  const pending = p.incoming.length;
  els.badge.hidden = !pending;
  els.badge.textContent = pending;
  const online = p.friends.filter((f) => f.online).length;
  els.btn.querySelector('.btn-friends-count').textContent = online ? ` ${online}` : '';
  els.btn.setAttribute('aria-label', `Friends: ${online} online${pending ? `, ${pending} request${pending > 1 ? 's' : ''}` : ''}`);
  if (!els.drawer.hidden) render();
  for (const f of subs) f();
}

export function handleSocialNotice(p) {
  const who = p.from && p.from.username;
  switch (p.kind) {
    case 'request':
      toast(`${who} sent you a friend request.`, { ms: 10000, action: { label: 'VIEW', run: openFriends } });
      break;
    case 'accepted':
      toast(`${who} accepted your friend request.`, { kind: 'ok' });
      break;
    case 'invite':
      toast(`${who} invited you to ${ctx.gameLabel(p.gameType)}.`, { ms: 20000, action: { label: 'JOIN', run: () => ctx.join(p.code) } });
      break;
    case 'party':
      toast(`${who} invited you to their party.`, { ms: 30000, action: { label: 'JOIN PARTY', run: () => send(ClientMessage.PARTY_ACCEPT, { id: p.id }) } });
      break;
    case 'follow':
      toast(`Following ${who} into ${ctx.gameLabel(p.gameType)}.`, { kind: 'ok' });
      break;
    case 'error':
      toast(p.message, { kind: 'error' });
      break;
    default:
      if (p.message) toast(p.message, { kind: 'ok' });
  }
}

// ---- drawer ----
function nameLink(username) {
  return h('a.fr-name', { href: `/u/${encodeURIComponent(username)}`, 'data-link': true, onclick: () => toggle(false) }, username);
}

function statusOf(f) {
  if (f.playing) return h('span.fr-status.on', `● Playing ${ctx.gameLabel(f.playing.gameType)}`);
  if (f.online) return h('span.fr-status.on', '● Online');
  return h('span.fr-status', 'Offline');
}

function menu(items) {
  const list = h('div.fr-menu', { role: 'menu', hidden: true }, items.map(([label, run, cls]) =>
    h(`button${cls || ''}`, { type: 'button', role: 'menuitem', onclick: () => { list.hidden = true; run(); } }, label)));
  const btn = h('button.fr-more', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'More actions', onclick: (e) => {
    e.stopPropagation();
    document.querySelectorAll('.fr-menu').forEach((m) => { if (m !== list) m.hidden = true; });
    list.hidden = !list.hidden;
    if (!list.hidden) list.querySelector('button').focus();
  } }, '⋯');
  list.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); list.hidden = true; btn.focus(); } });
  return h('div.fr-more-wrap', btn, list);
}

function friendRow(f) {
  const room = ctx.currentRoom();
  const party = social.party;
  const inParty = party && party.members.some((m) => sameName(m.username, f.username));
  const canParty = f.online && !inParty && (!party || party.leader);
  let primary = null;
  if (f.playing && (!room || room.code !== f.playing.code)) primary = h('button.btn-sm', { type: 'button', onclick: () => { toggle(false); ctx.join(f.playing.code); } }, 'JOIN');
  else if (room && f.online && !(f.playing && f.playing.code === room.code)) primary = h('button.btn-sm', { type: 'button', onclick: () => send(ClientMessage.ROOM_INVITE, { username: f.username }) }, 'INVITE');
  return h('li.fr-row',
    avatarEl(f.avatar, 36),
    h('div.fr-id', nameLink(f.username), statusOf(f)),
    h('div.fr-actions', primary, menu([
      ['View profile', () => { toggle(false); ctx.navigate(`/u/${encodeURIComponent(f.username)}`); }],
      ...(canParty ? [['Invite to party', () => send(ClientMessage.PARTY_INVITE, { username: f.username })]] : []),
      ['Remove friend', () => send(ClientMessage.FRIEND_REMOVE, { username: f.username }), '.danger'],
      ['Block', () => send(ClientMessage.USER_BLOCK, { username: f.username, on: true }), '.danger'],
    ])));
}

function section(title, count, body) {
  return h('section.fr-section', h('h3.fr-title', title, count != null ? h('span.muted', ` (${count})`) : null), body);
}

function render() {
  if (!social) { els.list.replaceChildren(h('p.muted.fr-empty', 'Loading…')); return; }
  const input = h('input', { type: 'text', placeholder: 'Username', maxLength: 16, autocomplete: 'off', spellcheck: false, 'aria-label': 'Username to add' });
  const add = h('form.fr-add', { onsubmit: (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    send(ClientMessage.FRIEND_REQUEST, { username: name });
    input.value = '';
  } }, input, h('button.btn-sm', { type: 'submit' }, 'ADD'));

  const parts = [add];
  const { party } = social;
  if (party) {
    parts.push(section('PARTY', `${party.members.length}/8`, h('div',
      h('ul.fr-list', party.members.map((m) => h('li.fr-row',
        avatarEl(m.avatar, 28),
        h('div.fr-id', nameLink(m.username), h(`span.fr-status${m.online ? '.on' : ''}`, m.leader ? '★ Leader' : m.online ? '● Online' : 'Reconnecting…')),
        party.leader && !m.leader ? h('button.btn-sm.btn-ghost', { type: 'button', 'aria-label': `Remove ${m.username} from party`, onclick: () => send(ClientMessage.PARTY_KICK, { username: m.username }) }, 'KICK') : null))),
      h('p.fr-hint', party.leader ? 'Your party follows you into any room you join.' : 'You\'ll follow the leader into their rooms.'),
      h('button.btn-sm.btn-ghost', { type: 'button', onclick: () => send(ClientMessage.PARTY_LEAVE) }, party.members.length > 1 ? 'LEAVE PARTY' : 'CANCEL PARTY'))));
  }
  if (social.incoming.length || social.outgoing.length) {
    parts.push(section('REQUESTS', social.incoming.length || null, h('ul.fr-list',
      social.incoming.map((r) => h('li.fr-row', avatarEl(r.avatar, 36), h('div.fr-id', nameLink(r.username), h('span.fr-status', { title: `Sent ${timeAgo(r.since)}` }, 'wants to be friends')),
        h('div.fr-actions',
          h('button.btn-sm', { type: 'button', onclick: () => send(ClientMessage.FRIEND_ACCEPT, { username: r.username }) }, 'ACCEPT'),
          h('button.btn-sm.btn-ghost', { type: 'button', 'aria-label': `Decline ${r.username}`, onclick: () => send(ClientMessage.FRIEND_REMOVE, { username: r.username }) }, '✕')))),
      social.outgoing.map((r) => h('li.fr-row.fr-pending', avatarEl(r.avatar, 36), h('div.fr-id', nameLink(r.username), h('span.fr-status', 'request sent')),
        h('div.fr-actions', h('button.btn-sm.btn-ghost', { type: 'button', onclick: () => send(ClientMessage.FRIEND_REMOVE, { username: r.username }) }, 'CANCEL')))))));
  }
  const online = social.friends.filter((f) => f.online).length;
  parts.push(section('FRIENDS', social.friends.length ? `${online} online` : null, social.friends.length
    ? h('ul.fr-list', social.friends.map(friendRow))
    : h('p.muted.fr-empty', 'No friends yet. Add someone by username above, or from your recent players below.')));
  const recent = social.recent;
  parts.push(section('RECENT PLAYERS', null, recent.length
    ? h('ul.fr-list', recent.map((r) => h('li.fr-row', avatarEl(r.avatar, 28),
      h('div.fr-id', nameLink(r.username), h('span.fr-status', `${ctx.gameLabel(r.gameType)} · ${timeAgo(r.at)}`)),
      h('div.fr-actions', r.friend ? h('span.fr-tag', 'FRIEND') : r.pending ? h('span.fr-tag', 'SENT')
        : social.incoming.some((x) => sameName(x.username, r.username)) ? h('button.btn-sm', { type: 'button', onclick: () => send(ClientMessage.FRIEND_ACCEPT, { username: r.username }) }, 'ACCEPT')
        : h('button.btn-sm', { type: 'button', 'aria-label': `Add ${r.username} as a friend`, onclick: () => send(ClientMessage.FRIEND_REQUEST, { username: r.username }) }, '+ ADD')))))
    : h('p.muted.fr-empty', 'People with accounts you finish a game with show up here.')));
  els.list.replaceChildren(...parts);
}

// ---- profile buttons: Add friend / Accept / Friends ✓ / Block, kept live with SOCIAL_STATE ----
export function relationButtons(username) {
  const box = h('div.profile-actions');
  const draw = () => {
    if (!box.isConnected && box.dataset.drawn) { subs.delete(draw); return; }
    box.dataset.drawn = '1';
    if (!social) { box.replaceChildren(); return; }
    const has = (list) => list.some((x) => sameName(x.username, username));
    const btn = (label, type, payload, cls = '') => h(`button.btn-sm${cls}`, { type: 'button', onclick: () => send(type, { username, ...payload }) }, label);
    if (has(social.blocked)) { box.replaceChildren(h('span.fr-tag', 'BLOCKED'), btn('UNBLOCK', ClientMessage.USER_BLOCK, { on: false }, '.btn-ghost')); return; }
    const main = has(social.friends) ? h('span.fr-tag.fr-tag-on', '✓ FRIENDS')
      : has(social.incoming) ? btn('ACCEPT FRIEND REQUEST', ClientMessage.FRIEND_ACCEPT)
        : has(social.outgoing) ? btn('CANCEL REQUEST', ClientMessage.FRIEND_REMOVE, {}, '.btn-ghost')
          : btn('+ ADD FRIEND', ClientMessage.FRIEND_REQUEST);
    box.replaceChildren(main, btn('BLOCK', ClientMessage.USER_BLOCK, { on: true }, '.btn-ghost.danger'));
  };
  subs.add(draw);
  draw();
  return box;
}

// Settings: the blocked list with unblock buttons.
export function blockedList() {
  if (!social) return null;
  if (!social.blocked.length) return h('p.set-hint', 'You haven\'t blocked anyone.');
  return h('ul.fr-list', social.blocked.map((b) => h('li.fr-row', avatarEl(b.avatar, 28), h('div.fr-id', h('span', b.username)),
    h('button.btn-sm.btn-ghost', { type: 'button', onclick: () => send(ClientMessage.USER_BLOCK, { username: b.username, on: false }) }, 'UNBLOCK'))));
}

export function onSocialChange(fn) { subs.add(fn); return () => subs.delete(fn); }
