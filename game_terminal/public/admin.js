// /admin — moderation for admins: the reports queue, user lookup and actions (mute, ban,
// rename, reset stats, delete message). The server re-checks admin rights on every request.
import { ClientMessage } from './protocol.js';
import { h, toast, modal, timeAgo, fmtDate } from './ui.js';
import { avatarEl } from './avatars.js';

const MUTES = [['10 minutes', 10], ['1 hour', 60], ['24 hours', 1440], ['7 days', 10080]];
const BANS = [['1 day', 1440], ['7 days', 10080], ['30 days', 43200], ['1 year', 525600]];
const ACTION_LABEL = { mute: 'Muted', unmute: 'Unmuted', ban: 'Banned', unban: 'Unbanned', resetStats: 'Reset stats', rename: 'Renamed', dismiss: 'Dismissed report', resolve: 'Resolved report', deleteMessage: 'Deleted message' };

// Keep in sync with GROUNDS in server/moderation.js. Penalties must name one; the player is told it.
const GROUNDS = [['harassment', 'Harassment, threats or hate speech'], ['sexual', 'Sexual content'], ['cheating', 'Cheating, scripts or exploiting bugs'],
  ['spam', 'Spam, ads or scam links'], ['personal', 'Sharing personal information'], ['impersonation', 'Impersonating someone'],
  ['name', 'Offensive username, avatar or drawing'], ['illegal', 'Illegal content'], ['other', 'Other rule break']];

let view = null; // { send, els, status, user }

const until = (ts) => `until ${fmtDate(ts)} ${new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
const fmtMins = (m) => (m >= 1440 ? `${Math.round(m / 1440)}d` : m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`);

function confirmAction(title, text, label, run) {
  const m = modal(title);
  m.body.append(h('p', text), h('div.row-end',
    h('button', { type: 'button', onclick: () => m.close() }, 'CANCEL'),
    h('button.btn-primary.btn-danger', { type: 'button', onclick: () => { m.close(); run(); } }, label)));
  m.body.querySelector('.btn-danger').focus();
}

function act(payload) { view.send(ClientMessage.ADMIN_ACTION, payload); }
function lookup(username) {
  view.els.lookupInput.value = username;
  view.send(ClientMessage.ADMIN_LOOKUP, { username });
  history.replaceState(null, '', `/admin?user=${encodeURIComponent(username)}`);
}
function loadReports() { view.send(ClientMessage.ADMIN_REPORTS, { status: view.status }); }

// "Which rule, and a note for the player" for one card. take() returns { ground, note } or null
// (after pointing at the empty picker).
function whyPicker() {
  const ground = h('select', { 'aria-label': 'Rule broken' }, h('option', { value: '' }, 'Rule broken…'), GROUNDS.map(([v, t]) => h('option', { value: v }, t)));
  const note = h('input', { type: 'text', maxlength: 200, placeholder: 'Note for the player (optional)', 'aria-label': 'Note for the player' });
  const el = h('div.adm-why', ground, note);
  return { el, take() {
    if (!ground.value) { toast('Pick which rule was broken first. The player is told why.', { kind: 'error' }); ground.focus(); return null; }
    return { ground: ground.value, note: note.value.trim() || undefined };
  } };
}

function durationButtons(label, options, action, username, reportId, why) {
  const select = h('select', { 'aria-label': `${label} duration` }, options.map(([t, m]) => h('option', { value: m }, t)));
  return h('div.adm-dur', select, h(`button.btn-sm${action === 'ban' ? '.danger' : ''}`, { type: 'button', onclick: () => {
    const minutes = Number(select.value);
    const w = why.take();
    if (!w) return;
    const go = () => act({ action, username, minutes, reportId, ...w });
    if (action === 'ban') confirmAction(`BAN ${username.toUpperCase()}?`, `They'll be signed out everywhere and can't sign in for ${select.selectedOptions[0].textContent}. They can still play as a guest.`, 'BAN', go);
    else go();
  } }, label));
}

function userCard(u) {
  const status = [];
  if (u.bannedUntil) status.push(h('span.adm-flag.ban', `BANNED ${until(u.bannedUntil)}`));
  if (u.mutedUntil) status.push(h('span.adm-flag.mute', `MUTED ${until(u.mutedUntil)}`));
  if (!status.length) status.push(h('span.adm-flag.ok', 'IN GOOD STANDING'));
  const name = u.username;
  const why = whyPicker();
  const penalty = (action, title, text, label) => () => { const w = why.take(); if (w) confirmAction(title, text, label, () => act({ action, username: name, ...w })); };
  return h('article.adm-user',
    h('div.adm-user-head', avatarEl(u.avatar, 56),
      h('div',
        h('h2.adm-user-name', h('a', { href: `/u/${encodeURIComponent(name)}`, 'data-link': true }, name), u.role === 'admin' ? h('span.chat-mod', 'MOD') : null),
        h('p.muted', `Level ${u.level} · joined ${fmtDate(u.createdAt)} · ${u.reports} report${u.reports === 1 ? '' : 's'} against`),
        h('div.adm-flags', status))),
    why.el,
    h('div.adm-actions',
      u.mutedUntil ? h('button.btn-sm', { type: 'button', onclick: () => act({ action: 'unmute', username: name }) }, 'UNMUTE') : durationButtons('MUTE', MUTES, 'mute', name, undefined, why),
      u.bannedUntil ? h('button.btn-sm', { type: 'button', onclick: () => act({ action: 'unban', username: name }) }, 'UNBAN') : durationButtons('BAN', BANS, 'ban', name, undefined, why),
      h('button.btn-sm', { type: 'button', onclick: penalty('rename', `RENAME ${name.toUpperCase()}?`, 'Their username becomes player_###### and they\'re free to pick a new one straight away. Use this for offensive names.', 'RENAME') }, 'FORCE RENAME'),
      h('button.btn-sm.danger', { type: 'button', onclick: penalty('resetStats', `RESET ${name.toUpperCase()}'S STATS?`, 'Deletes their per-game stats (wins, streaks, best scores). Match history stays. This can\'t be undone.', 'RESET STATS') }, 'RESET STATS')),
    u.log.length ? h('details.adm-log', h('summary', `Moderation history (${u.log.length})`),
      h('ul', u.log.map((l) => h('li', h('span', `${ACTION_LABEL[l.action] || l.action}${l.minutes ? ` ${fmtMins(l.minutes)}` : ''}`), h('span.muted', ` by ${l.by} · ${timeAgo(l.at)}`), l.reason ? h('span.muted', ` · ${l.reason}`) : null, l.note ? h('span.muted', ` · "${l.note}"`) : null)))) : h('p.muted.adm-nolog', 'No moderation history.'));
}

function reportCard(r) {
  const open = r.status === 'open';
  const target = r.target.username;
  const why = whyPicker();
  return h('li.adm-report',
    h('div.adm-report-head',
      h('button.link-btn.adm-target', { type: 'button', onclick: () => lookup(target) }, target),
      h('span.muted', ` reported by ${r.by.username} · ${timeAgo(r.at)}`),
      r.message ? h('span.fr-tag', r.message.channel.toUpperCase()) : h('span.fr-tag', 'USER')),
    r.reason ? h('p.adm-reason', r.reason) : null,
    r.message ? h('blockquote.report-quote', r.message.text) : null,
    r.context && r.context.length > 1 ? h('details.adm-ctx', h('summary', 'Chat around it'),
      h('ol', r.context.map((c) => h(`li${r.message && c.text === r.message.text && c.username === target ? '.hit' : ''}`, h('b', `${c.username}: `), c.text)))) : null,
    open ? why.el : null,
    open ? h('div.adm-actions',
      r.message ? h('button.btn-sm.danger', { type: 'button', onclick: () => { const w = why.take(); if (w) act({ action: 'deleteMessage', messageId: r.message.id, reportId: r.id, ...w }); } }, 'DELETE MESSAGE') : null,
      durationButtons('MUTE', MUTES, 'mute', target, r.id, why),
      durationButtons('BAN', BANS, 'ban', target, r.id, why),
      h('button.btn-sm', { type: 'button', onclick: () => act({ action: 'resolve', reportId: r.id }) }, 'RESOLVE'),
      h('button.btn-sm.btn-ghost', { type: 'button', onclick: () => act({ action: 'dismiss', reportId: r.id }) }, 'DISMISS'))
      : h('p.muted.adm-handled', `Handled by ${r.handledBy || '—'}${r.handledAt ? ` · ${timeAgo(r.handledAt)}` : ''}`));
}

export function handleAdminData(p) {
  if (!view || !view.els.root.isConnected) return;
  if (p.error) {
    if (p.error === 'Admins only.') { view.els.root.replaceChildren(h('div.notfound', h('p.notfound-code', '403'), h('h1', 'ADMINS ONLY'), h('p.muted', 'This page is for moderators.'), h('a.btn-primary', { href: '/', 'data-link': true }, 'BACK TO GAMES'))); return; }
    toast(p.error, { kind: 'error' });
    return;
  }
  if (p.message) { toast(p.message, { kind: 'ok' }); loadReports(); }
  if (p.user) view.els.userSlot.replaceChildren(userCard(p.user));
  if (p.reports) {
    view.els.count.textContent = view.status === 'open' ? ` (${p.reports.length})` : '';
    view.els.reports.replaceChildren(...(p.reports.length ? p.reports.map(reportCard)
      : [h('li.adm-empty', view.status === 'open' ? '✓ No open reports. All clear.' : 'Nothing resolved yet.')]));
  }
}

export function renderAdmin(mount, { send, account }) {
  if (!account || !account.admin) {
    mount.replaceChildren(h('div.notfound', h('p.notfound-code', '403'), h('h1', 'ADMINS ONLY'), h('p.muted', 'This page is for moderators.'), h('a.btn-primary', { href: '/', 'data-link': true }, 'BACK TO GAMES')));
    return;
  }
  const els = {};
  els.lookupInput = h('input', { type: 'text', placeholder: 'Username', maxLength: 16, autocomplete: 'off', spellcheck: false, 'aria-label': 'Username to look up' });
  els.userSlot = h('div.adm-user-slot');
  els.reports = h('ol.adm-reports', h('li.adm-empty', 'Loading…'));
  els.count = h('span.muted');
  const tab = (status, label) => h('button.adm-tab', { type: 'button', role: 'tab', 'aria-selected': String(status === 'open'), onclick: (e) => {
    view.status = status;
    e.currentTarget.parentNode.querySelectorAll('.adm-tab').forEach((b) => b.setAttribute('aria-selected', String(b === e.currentTarget)));
    loadReports();
  } }, label);
  els.root = h('article.admin',
    h('h1.page-title', 'MODERATION'),
    h('section.profile-section',
      h('h2.panel-title', '> LOOK UP A PLAYER'),
      h('form.fr-add.adm-lookup', { onsubmit: (e) => { e.preventDefault(); if (els.lookupInput.value.trim()) lookup(els.lookupInput.value.trim()); } },
        els.lookupInput, h('button.btn-sm', { type: 'submit' }, 'LOOK UP')),
      els.userSlot),
    h('section.profile-section',
      h('div.adm-reports-head', h('h2.panel-title', '> REPORTS', els.count),
        h('div.adm-tabs', { role: 'tablist' }, tab('open', 'OPEN'), tab('closed', 'RESOLVED'))),
      els.reports));
  mount.replaceChildren(els.root);
  view = { send, els, status: 'open' };
  loadReports();
  const q = new URLSearchParams(location.search).get('user');
  if (q) lookup(q);
}
