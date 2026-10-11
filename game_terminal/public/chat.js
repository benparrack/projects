// Chat UI: one chat box component used for the global dock, room chat, party chat and DMs.
// Boxes register by key ("global", "room", "party", "dm|<name>"); CHAT_* messages are routed here
// from hub.js. Blocked players' messages are hidden client-side (the server never DMs them).
import { ClientMessage } from './protocol.js';
import { h, toast, modal, timeAgo } from './ui.js';
import { avatarEl, nameColor } from './avatars.js';
import { getSocial } from './friends.js';

const MAX_LEN = 200;
const GROUP_MS = 2 * 60 * 1000; // consecutive messages by one person within this window are grouped
const DOCK_KEY = 'gt.chatDock';

let ctx = null; // { send, signIn(), isAdmin(), signedIn(), openConversation(kind, name) }
const boxes = new Map(); // key -> Set<box>
const unread = new Map(); // key -> count, for party/DM chats that aren't open
const unreadSubs = new Set();
const lc = (s) => String(s || '').toLowerCase();
const keyOf = (channel, withName) => (channel === 'dm' ? `dm|${lc(withName)}` : channel);

export function initChat(options) { ctx = options; }

function live(key) {
  const set = boxes.get(key);
  if (!set) return [];
  for (const b of set) if (!b.el.isConnected && b.mounted) set.delete(b);
  return [...set];
}

const isBlocked = (name) => {
  const s = getSocial();
  return !!(s && s.blocked.some((b) => lc(b.username) === lc(name)));
};

export function unreadCount(key) { return unread.get(key) || 0; }
export function onUnread(fn) { unreadSubs.add(fn); return () => unreadSubs.delete(fn); }
function bumpUnread(key, n) {
  if (n) unread.set(key, (unread.get(key) || 0) + n); else unread.delete(key);
  for (const f of unreadSubs) f();
}

// ---- routing from hub.js ----
export function handleChatHistory(p) {
  for (const b of live(keyOf(p.channel, p.with))) b.setHistory(p);
}

export function handleChatMessage(p) {
  const key = keyOf(p.channel, p.with);
  if (isBlocked(p.msg.from.username)) return;
  const open = live(key);
  for (const b of open) b.add(p.msg);
  const mine = ctx.me && lc(p.msg.from.username) === lc(ctx.me());
  if (mine || open.some((b) => b.visible())) return;
  if (p.channel === 'dm' || p.channel === 'party') {
    bumpUnread(key, 1);
    if (p.channel === 'dm') {
      toast(`${p.msg.from.username}: ${p.msg.text}`, { ms: 8000, action: { label: 'REPLY', run: () => ctx.openConversation('dm', p.with) } });
    }
  }
}

export function handleChatDeleted(p) {
  document.querySelectorAll(`.chat-msg[data-id="${CSS.escape(p.id)}"]`).forEach((el) => el.remove());
  for (const set of boxes.values()) for (const b of set) b.forget(p.id);
}

export function handleChatError(p) {
  const open = live(keyOf(p.channel, p.with));
  if (open.length) for (const b of open) b.error(p.message);
  else toast(p.message, { kind: 'error' });
}

// After a reconnect the server has forgotten what we had open.
export function reopenChats() {
  for (const set of boxes.values()) for (const b of set) if (b.el.isConnected) b.open(); else if (b.mounted) set.delete(b);
}

// ---- report dialog ----
const REASONS = ['Harassment or bullying', 'Hate speech', 'Spam or advertising', 'Cheating', 'Inappropriate username', 'Something else'];
export function openReport(username, msg) {
  const m = modal(`REPORT ${username.toUpperCase()}`);
  const select = h('select', { id: 'report-reason' }, REASONS.map((r) => h('option', { value: r }, r)));
  const details = h('textarea', { id: 'report-details', rows: 3, maxLength: 160, placeholder: 'Anything a moderator should know (optional)' });
  m.body.append(
    msg ? h('blockquote.report-quote', h('span.muted', `${username}: `), msg.text) : null,
    h('label.field', h('span', 'Reason'), select),
    h('label.field', h('span', 'Details'), details),
    h('p.set-hint', 'Reports are private: they never learn who reported them. A moderator sees the message and the chat around it.'),
    h('div.row-end',
      h('button', { type: 'button', onclick: () => m.close() }, 'CANCEL'),
      h('button.btn-primary', { type: 'button', onclick: () => {
        const reason = select.value + (details.value.trim() ? ` — ${details.value.trim()}` : '');
        ctx.send(ClientMessage.CHAT_REPORT, { username, messageId: msg ? msg.id : undefined, reason });
        m.close();
      } }, 'SEND REPORT')));
  select.focus();
}

// ---- the chat box ----
// opts: { channel, with?, title?, placeholder?, emptyText?, className? }
export function chatBox(opts) {
  const key = keyOf(opts.channel, opts.with);
  const log = h('ol.chat-log', { 'aria-live': 'polite', 'aria-relevant': 'additions', tabindex: 0, 'aria-label': opts.title || 'Chat messages' });
  const empty = h('p.chat-empty', opts.emptyText || 'No messages yet. Say hi!');
  const jump = h('button.chat-jump', { type: 'button', hidden: true, onclick: () => { scrollEnd(); } }, '↓ New messages');
  const err = h('p.chat-err', { role: 'alert', hidden: true });
  const foot = h('div.chat-foot');
  const el = h(`div.chat${opts.className ? '.' + opts.className : ''}`, h('div.chat-scroll', log, empty), jump, err, foot);
  const msgs = [];
  let errTimer = null;

  const nearEnd = () => log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  function scrollEnd() { log.scrollTop = log.scrollHeight; jump.hidden = true; }
  log.addEventListener('scroll', () => { if (nearEnd()) jump.hidden = true; });

  function row(msg, prev) {
    const grouped = prev && lc(prev.from.username) === lc(msg.from.username) && msg.at - prev.at < GROUP_MS;
    const name = msg.from.username;
    const mine = ctx.me && lc(name) === lc(ctx.me());
    const actions = [];
    if (!mine && ctx.signedIn()) actions.push(['Report', () => openReport(name, msg)]);
    if (ctx.isAdmin()) actions.push(['Delete message', () => ctx.send(ClientMessage.ADMIN_ACTION, { action: 'deleteMessage', messageId: msg.id }), '.danger']);
    if (ctx.isAdmin() && !mine) actions.push(['Moderate…', () => ctx.navigate(`/admin?user=${encodeURIComponent(name)}`)]);
    const time = new Date(msg.at);
    return h(`li.chat-msg${grouped ? '.grouped' : ''}${mine ? '.mine' : ''}`, { 'data-id': msg.id },
      grouped ? h('span.chat-gutter', { title: time.toLocaleString() }, time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : avatarEl(msg.from.avatar, 24, msg.from.cosmetics),
      h('div.chat-main',
        grouped ? null : h('div.chat-meta',
          h('a.chat-name', { href: `/u/${encodeURIComponent(name)}`, 'data-link': true, class: nameColor(msg.from.cosmetics) }, name),
          msg.from.role === 'admin' ? h('span.chat-mod', { title: 'Moderator' }, 'MOD') : h('span.chat-lv', `LV${msg.from.level || 1}`),
          h('time.chat-time', { dateTime: time.toISOString(), title: time.toLocaleString() }, timeAgo(msg.at))),
        h('p.chat-text', msg.text)),
      actions.length ? h('div.chat-acts', actions.map(([label, run, cls]) => h(`button.chat-act${cls || ''}`, { type: 'button', title: label, 'aria-label': `${label} (${name})`, onclick: run }, label === 'Report' ? '⚑' : label === 'Delete message' ? '✕' : '⚙'))) : null);
  }

  function renderAll() {
    const shown = msgs.filter((m) => !isBlocked(m.from.username));
    log.replaceChildren(...shown.map((m, i) => row(m, shown[i - 1])));
    empty.hidden = shown.length > 0;
    scrollEnd();
  }

  function composer(canPost, reason) {
    if (!canPost) {
      if (reason === 'signin') foot.replaceChildren(h('p.chat-locked', h('button.link-btn', { type: 'button', onclick: () => ctx.signIn() }, 'Sign in'), ' to chat.'));
      else if (reason === 'newAccount') foot.replaceChildren(h('p.chat-locked', 'Finish one game to unlock global chat.'));
      else foot.replaceChildren();
      return;
    }
    const input = h('input.chat-input', { type: 'text', maxLength: MAX_LEN, autocomplete: 'off', placeholder: opts.placeholder || 'Message', 'aria-label': opts.placeholder || 'Message', enterKeyHint: 'send' });
    const count = h('span.chat-count', { hidden: true, 'aria-hidden': 'true' });
    input.addEventListener('input', () => {
      const left = MAX_LEN - input.value.length;
      count.hidden = left > 40;
      count.textContent = left;
    });
    const form = h('form.chat-form', { onsubmit: (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      ctx.send(ClientMessage.CHAT_SEND, { channel: opts.channel, with: opts.with, text });
      input.value = '';
      count.hidden = true;
    } }, input, count, h('button.btn-sm.chat-send', { type: 'submit', 'aria-label': 'Send' }, 'SEND'));
    foot.replaceChildren(form);
  }

  const box = {
    el,
    mounted: false,
    open() { ctx.send(ClientMessage.CHAT_OPEN, { channel: opts.channel, with: opts.with }); },
    visible: () => el.isConnected && el.offsetParent !== null && !document.hidden,
    setHistory(p) {
      msgs.splice(0, msgs.length, ...p.messages);
      renderAll();
      composer(p.canPost, p.reason);
      bumpUnread(key, 0);
    },
    add(msg) {
      if (msgs.some((m) => m.id === msg.id)) return;
      const stick = nearEnd();
      msgs.push(msg);
      if (msgs.length > 150) msgs.splice(0, msgs.length - 150);
      if (log.children.length > 150) log.firstChild.remove();
      log.append(row(msg, msgs[msgs.length - 2]));
      empty.hidden = true;
      if (stick || (ctx.me && lc(msg.from.username) === lc(ctx.me()))) scrollEnd(); else jump.hidden = false;
    },
    forget(id) { const i = msgs.findIndex((m) => m.id === id); if (i >= 0) msgs.splice(i, 1); empty.hidden = msgs.length > 0; },
    error(message) {
      err.textContent = message;
      err.hidden = false;
      clearTimeout(errTimer);
      errTimer = setTimeout(() => { err.hidden = true; }, 5000);
    },
    focus() { const i = foot.querySelector('input'); if (i) i.focus(); },
    rerender: renderAll,
  };
  if (!boxes.has(key)) boxes.set(key, new Set());
  boxes.get(key).add(box);
  // Open once it's in the document (the caller appends it right after creating it).
  queueMicrotask(() => { box.mounted = true; if (el.isConnected) box.open(); });
  return box;
}

// Re-render boxes when the blocked list changes.
export function refreshBlocked() { for (const set of boxes.values()) for (const b of set) if (b.el.isConnected) b.rerender(); }

// ---- global chat dock (CoC style: a tab on the left edge that slides a panel out) ----
const dock = {};
export function initGlobalDock() {
  dock.box = null;
  dock.body = h('div.dock-body');
  dock.panel = h('aside.dock', { id: 'global-chat', 'aria-label': 'Global chat', hidden: true },
    h('div.drawer-head', h('h2', 'GLOBAL CHAT'), h('button.modal-x', { type: 'button', 'aria-label': 'Close global chat', onclick: () => toggleDock(false) }, '×')),
    h('p.dock-rules', 'Be nice. No links, no spam. ', h('a', { href: '/rules', 'data-link': true }, 'Chat rules')),
    dock.body);
  dock.tab = h('button.dock-tab', { type: 'button', 'aria-controls': 'global-chat', 'aria-expanded': 'false', hidden: true, onclick: () => toggleDock() },
    h('span.dock-tab-label', 'CHAT'));
  document.body.append(dock.tab, dock.panel);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dock.panel.hidden && !document.querySelector('.modal-backdrop') && dock.panel.contains(document.activeElement)) { toggleDock(false); dock.tab.focus(); } });
}

function toggleDock(open = dock.panel.hidden) {
  dock.panel.hidden = !open;
  dock.tab.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('dock-open', open);
  try { localStorage.setItem(DOCK_KEY, open ? '1' : '0'); } catch { /* storage blocked: not important */ }
  if (open) {
    if (!dock.box || !dock.box.el.isConnected) {
      dock.box = chatBox({ channel: 'global', title: 'Global chat', placeholder: 'Say something to everyone', emptyText: 'It\'s quiet in here. Start the conversation!' });
      dock.body.replaceChildren(dock.box.el);
    } else dock.box.open();
    setTimeout(() => dock.box && dock.box.focus(), 50);
  } else {
    ctx.send(ClientMessage.CHAT_CLOSE, { channel: 'global' });
  }
}

// The dock is offered on the menu and info pages (rooms have their own chat), and only when
// accounts exist on this deployment.
export function setDockAvailable(on) {
  if (!dock.tab) return;
  dock.tab.hidden = !on;
  if (!on && !dock.panel.hidden) { dock.panel.hidden = true; document.body.classList.remove('dock-open'); dock.tab.setAttribute('aria-expanded', 'false'); ctx.send(ClientMessage.CHAT_CLOSE, { channel: 'global' }); return; }
  if (on && dock.panel.hidden && dock.wanted === undefined) {
    let saved = null;
    try { saved = localStorage.getItem(DOCK_KEY); } catch { /* ignore */ }
    dock.wanted = saved === '1' && window.innerWidth >= 1400;
    if (dock.wanted) toggleDock(true);
  }
}
