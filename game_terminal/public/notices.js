// Moderation notices: what was done, which rule, until when, and how to appeal (the DSA "statement
// of reasons"). Shown once per notice to the player (server/moderation.js), and on a banned sign-in.
import { h, modal } from './ui.js';
import { CONTACT_EMAIL } from './pages.js';

const when = (ts) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

function what(n) {
  switch (n.action) {
    case 'mute': return `You're muted in chat until ${when(n.until)}.`;
    case 'ban': return `Your account is suspended until ${when(n.until)}. You can still play as a guest.`;
    case 'rename': return `Your username${n.oldName ? ` "${n.oldName}"` : ''} was changed. You can pick a new one in Settings.`;
    case 'resetStats': return 'Your game stats (wins, streaks, best scores) were reset.';
    case 'deleteMessage': return `A chat message of yours was removed${n.text ? `: "${n.text}"` : '.'}`;
    default: return 'A moderator took action on your account.';
  }
}

function noticeEl(n) {
  return h('section.mod-notice',
    h('p.mod-notice-what', what(n)),
    h('dl.mod-notice-facts',
      h('dt', 'Rule'), h('dd', n.reason || 'Community Guidelines'),
      n.note ? [h('dt', 'Note'), h('dd', n.note)] : null,
      h('dt', 'Decided'), h('dd', `${when(n.at)}, by a person on our team`)));
}

function appealEl() {
  return h('p.muted.mod-notice-appeal',
    'Think we got it wrong? Email ', h('a', { href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Moderation appeal')}` }, CONTACT_EMAIL),
    ' within 6 months with your username and we\'ll look at it again. See the ', h('a', { href: '/rules', target: '_blank' }, 'Community Guidelines'), '.');
}

let open = false;
export function showModNotices(notices, onSeen) {
  if (open || !notices || !notices.length) return;
  open = true;
  const m = modal(notices.length > 1 ? 'MODERATION NOTICES' : 'MODERATION NOTICE', { dismissable: false });
  m.body.append(...notices.map(noticeEl), appealEl(),
    h('div.row-end', h('button.btn-primary', { type: 'button', onclick: () => { open = false; m.close(); onSeen(notices.map((n) => n.id)); } }, 'I UNDERSTAND')));
  m.body.querySelector('.btn-primary').focus();
}

export function showSuspended(payload) {
  const m = modal('ACCOUNT SUSPENDED');
  m.body.append(payload.notice ? noticeEl({ ...payload.notice, until: payload.until }) : h('p', payload.message), appealEl(),
    h('div.row-end', h('button.btn-primary', { type: 'button', onclick: () => m.close() }, 'OK')));
}
