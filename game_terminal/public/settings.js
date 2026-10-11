// /settings: preferences (local for guests, synced to the account when signed in), profile
// basics, and the GDPR controls (download my data, delete account).
import { h, modal, toast } from './ui.js';
import { avatarEl } from './avatars.js';
import { sfx } from './games/sfx.js';
import { LEVELS, preferredLevel } from './games/botLevel.js';

const BOT_KEY = 'gt-bot-level';
const MOTION_KEY = 'gt.motion';
const RENAME_COOLDOWN_MS = 30 * 86400000;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

// Current preferences, in the account settings shape.
export function currentPrefs() {
  return { muted: sfx.muted, volume: sfx.volume, reducedMotion: store.get(MOTION_KEY) === 'reduce', botLevel: preferredLevel() };
}

// Apply preferences locally (from the settings form or from the account on sign-in).
export function applyPrefs(p = {}) {
  if (typeof p.muted === 'boolean' && p.muted !== sfx.muted) sfx.setMuted(p.muted);
  if (typeof p.volume === 'number') sfx.setVolume(p.volume);
  if (typeof p.reducedMotion === 'boolean') {
    store.set(MOTION_KEY, p.reducedMotion ? 'reduce' : '');
    document.documentElement.toggleAttribute('data-reduce-motion', p.reducedMotion);
  }
  if (p.botLevel) store.set(BOT_KEY, p.botLevel);
}

// Called once at startup so a guest's saved motion preference applies before anything animates.
export function initPrefs() {
  document.documentElement.toggleAttribute('data-reduce-motion', store.get(MOTION_KEY) === 'reduce');
  // Games ask matchMedia('(prefers-reduced-motion: reduce)') directly; make the site setting count too.
  const mm = window.matchMedia && window.matchMedia.bind(window);
  if (!mm) return;
  window.matchMedia = (q) => {
    const res = mm(q);
    if (!/prefers-reduced-motion:\s*reduce/.test(q) || !document.documentElement.hasAttribute('data-reduce-motion')) return res;
    const bind = (k) => (res[k] ? res[k].bind(res) : () => {});
    return { matches: true, media: res.media, onchange: null, addEventListener: bind('addEventListener'), removeEventListener: bind('removeEventListener'), addListener: bind('addListener'), removeListener: bind('removeListener') };
  };
}

function row(label, hint, control, id) {
  return h('div.set-row',
    h('div.set-label', h('label', { htmlFor: id }, label), hint ? h('p.set-hint', hint) : null),
    h('div.set-control', control));
}

function toggle(id, checked, onChange) {
  return h('input.switch', { type: 'checkbox', id, role: 'switch', checked, onchange: (e) => onChange(e.target.checked) });
}

export function renderSettings(mount, ctx) {
  const { account, authUser, mode } = ctx;
  const prefs = currentPrefs();
  const save = (patch) => {
    applyPrefs(patch);
    if (account) ctx.saveSettings(patch);
    flash();
  };
  const savedNote = h('span.set-saved', { 'aria-live': 'polite' });
  let flashTimer = null;
  function flash() {
    savedNote.textContent = account ? '✓ Saved to your account' : '✓ Saved on this device';
    savedNote.classList.add('on');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => savedNote.classList.remove('on'), 1600);
  }

  const vol = h('input.set-range', {
    type: 'range', id: 'set-volume', min: 0, max: 100, step: 5, value: Math.round(prefs.volume * 100),
    'aria-valuetext': `${Math.round(prefs.volume * 100)}%`,
  });
  const volOut = h('output.set-out', { htmlFor: 'set-volume' }, `${Math.round(prefs.volume * 100)}%`);
  vol.addEventListener('input', () => { volOut.textContent = `${vol.value}%`; vol.setAttribute('aria-valuetext', `${vol.value}%`); sfx.setVolume(vol.value / 100); });
  vol.addEventListener('change', () => { save({ volume: vol.value / 100 }); sfx.play('blip'); });

  const bot = h('select.set-select', { id: 'set-bot', onchange: (e) => save({ botLevel: e.target.value }) },
    LEVELS.map(([v, label]) => h('option', { value: v, selected: v === prefs.botLevel }, label)));

  const sections = [
    h('section.set-section',
      h('h2.panel-title', '> PREFERENCES'),
      row('Sound effects', null, toggle('set-sound', !prefs.muted, (on) => save({ muted: !on })), 'set-sound'),
      row('Volume', null, h('div.set-inline', vol, volOut), 'set-volume'),
      row('Reduce motion', 'Turns off screen shake, confetti and most animations. Your system setting is always respected too.',
        toggle('set-motion', prefs.reducedMotion, (on) => save({ reducedMotion: on })), 'set-motion'),
      row('Default bot difficulty', 'Used when you add a bot to a game.', bot, 'set-bot'),
      h('p.set-foot', account ? 'These follow your account to any device.' : 'Guests\' preferences stay on this device. Sign in to sync them.', ' ', savedNote)),
  ];

  if (account) {
    const nameInput = h('input', { id: 'set-name', type: 'text', value: account.username, maxLength: 16, autocomplete: 'off', spellcheck: false });
    const left = account.renamedAt ? RENAME_COOLDOWN_MS - (Date.now() - account.renamedAt) : 0;
    const canRename = left <= 0;
    const renameBtn = h('button', { type: 'submit', disabled: !canRename }, 'RENAME');
    nameInput.disabled = !canRename;
    sections.unshift(h('section.set-section',
      h('h2.panel-title', '> PROFILE'),
      h('div.set-profile',
        avatarEl(account.avatar, 56),
        h('div',
          h('p.set-name', account.username),
          h('p.set-hint', authUser && authUser.email ? `Signed in as ${authUser.email}` : 'Signed in'),
          h('div.set-links',
            h('a', { href: `/u/${encodeURIComponent(account.username)}`, 'data-link': true }, 'View public profile'),
            h('button.link-btn', { type: 'button', onclick: ctx.changeAvatar }, 'Change avatar')))),
      row('Username', canRename
        ? '3–16 letters, numbers or _. After a rename you have to wait 30 days to change it again.'
        : `You can rename again in ${Math.ceil(left / 86400000)} days.`,
      h('form.set-inline', { onsubmit: (e) => { e.preventDefault(); if (nameInput.value.trim() !== account.username) ctx.rename(nameInput.value.trim()); } }, nameInput, renameBtn), 'set-name')));

    sections.push(h('section.set-section',
      h('h2.panel-title', '> YOUR DATA'),
      row('Download my data', 'A JSON file with your account, stats and match history.',
        h('button', { type: 'button', onclick: ctx.exportData }, 'DOWNLOAD'), null),
      row('Sign out', null, h('button', { type: 'button', onclick: ctx.signOut }, 'SIGN OUT'), null)),
    h('section.set-section.set-danger',
      h('h2.panel-title', '> DANGER ZONE'),
      row('Delete account', 'Permanently deletes your account, stats and history. Your name is replaced with "deleted player" in other people\'s match history. This can\'t be undone.',
        h('button.btn-danger', { type: 'button', onclick: () => confirmDelete(account, ctx.deleteAccount) }, 'DELETE ACCOUNT'), null)));
  } else if (mode !== 'off') {
    sections.push(h('section.set-section',
      h('h2.panel-title', '> ACCOUNT'),
      h('p.muted', 'You\'re playing as a guest. Sign in to keep stats, show up on leaderboards and add friends.'),
      h('div', h('button.btn-primary', { type: 'button', onclick: ctx.signIn }, 'SIGN IN / CREATE ACCOUNT'))));
  }

  mount.replaceChildren(h('div.settings', h('h1.page-title', 'SETTINGS'), ...sections));
}

function confirmDelete(account, onConfirm) {
  const m = modal('Delete account?');
  const input = h('input', { type: 'text', autocomplete: 'off', spellcheck: false, 'aria-describedby': 'del-help' });
  const go = h('button.btn-danger', { type: 'submit', disabled: true }, 'DELETE FOREVER');
  input.addEventListener('input', () => { go.disabled = input.value.trim().toLowerCase() !== account.username.toLowerCase(); });
  m.body.append(h('form.stack', { onsubmit: (e) => { e.preventDefault(); if (go.disabled) return; go.disabled = true; go.textContent = 'DELETING…'; onConfirm(input.value.trim(), m.close); } },
    h('p', 'This permanently deletes ', h('strong', account.username), ', all your stats and your match history.'),
    h('label.field', h('span', { id: 'del-help' }, `Type ${account.username} to confirm`), input),
    h('div.row-end', h('button', { type: 'button', onclick: () => m.close() }, 'CANCEL'), go)));
}

export function downloadJson(data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Your data download has started.', { kind: 'ok' });
}
