// Account UI: sign-in dialog, first-time username setup, terms re-acceptance and the top-bar
// account chip. hub.js owns the socket; everything here talks to it through callbacks.
import { h, modal, toast } from './ui.js';
import { AVATARS, avatarEl } from './avatars.js';

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/; // mirrors server/accounts.js (the server re-validates)

export function openSignIn(auth) {
  const m = modal('SIGN IN');
  const err = h('p.form-error', { role: 'alert', hidden: true });
  const fail = (e) => {
    const msg = auth.friendly(e);
    err.hidden = !msg;
    err.textContent = msg || '';
  };
  const busy = (form, on) => form.querySelectorAll('button, input').forEach((el) => { el.disabled = on; });

  if (auth.mode === 'dev') {
    const input = h('input', { type: 'text', placeholder: 'any name', autocomplete: 'off', maxLength: 24, required: true, autofocus: true });
    const form = h('form.stack',
      h('p.muted', 'Local development mode: no Firebase project is configured, so any name signs in as a test account.'),
      h('label.field', h('span', 'Dev account name'), input),
      err,
      h('button.btn-primary', { type: 'submit' }, 'SIGN IN'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await auth.signInDev(input.value); m.close(); } catch (ex) { fail(ex); }
    });
    m.body.append(form);
    return m;
  }

  let mode = 'signin'; // 'signin' | 'signup' | 'reset'
  const email = h('input', { type: 'email', autocomplete: 'email', required: true, placeholder: 'you@example.com' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', minLength: 6, required: true });
  const pwField = h('label.field', h('span', 'Password'), password);
  const submit = h('button.btn-primary', { type: 'submit' });
  const forgot = h('button.link-btn', { type: 'button', onclick: () => setMode('reset') }, 'Forgot password?');
  const switcher = h('p.muted.center');
  const form = h('form.stack', h('label.field', h('span', 'Email'), email), pwField, forgot, err, submit);

  function setMode(next) {
    mode = next;
    err.hidden = true;
    pwField.hidden = mode === 'reset';
    password.required = mode !== 'reset';
    password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    forgot.hidden = mode !== 'signin';
    submit.textContent = { signin: 'SIGN IN', signup: 'CREATE ACCOUNT', reset: 'SEND RESET LINK' }[mode];
    const [q, label, target] = {
      signin: ['New here?', 'Create an account', 'signup'],
      signup: ['Already have an account?', 'Sign in', 'signin'],
      reset: ['Remembered it?', 'Back to sign in', 'signin'],
    }[mode];
    switcher.replaceChildren(`${q} `, h('button.link-btn', { type: 'button', onclick: () => setMode(target) }, label));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    busy(form, true);
    try {
      if (mode === 'reset') {
        await auth.resetPassword(email.value.trim());
        toast('If that email has an account, a reset link is on its way.', { kind: 'ok' });
        setMode('signin');
      } else {
        await (mode === 'signup' ? auth.signUpEmail : auth.signInEmail)(email.value.trim(), password.value);
        m.close();
      }
    } catch (ex) { fail(ex); }
    busy(form, false);
  });

  const google = h('button.btn-google', {
    type: 'button',
    onclick: async () => {
      try { await auth.signInGoogle(); m.close(); } catch (ex) { fail(ex); }
    },
  }, googleMark(), 'Continue with Google');

  m.body.append(google, h('div.divider', h('span', 'or use email')), form, switcher);
  setMode('signin');
  return m;
}

function googleMark() {
  const span = h('span.g-mark', { 'aria-hidden': 'true' });
  span.innerHTML = '<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  return span;
}

// Pick-one avatar grid. Returns { el, value() }.
export function avatarPicker(initial = AVATARS[0].id) {
  let value = initial;
  const grid = h('div.avatar-grid', { role: 'radiogroup', 'aria-label': 'Avatar' });
  const buttons = AVATARS.map((a) => {
    const b = h('button.avatar-opt', {
      type: 'button', role: 'radio', title: a.label, 'aria-label': a.label,
      onclick: () => select(a.id),
      onkeydown: (e) => {
        const i = AVATARS.findIndex((x) => x.id === value);
        const step = { ArrowRight: 1, ArrowDown: 6, ArrowLeft: -1, ArrowUp: -6 }[e.key];
        if (!step) return;
        e.preventDefault();
        select(AVATARS[(i + step + AVATARS.length) % AVATARS.length].id, true);
      },
    }, avatarEl(a.id, 40));
    b.dataset.id = a.id;
    grid.append(b);
    return b;
  });
  function select(id, focus) {
    value = id;
    for (const b of buttons) {
      const on = b.dataset.id === id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
  }
  select(value);
  return { el: grid, value: () => value };
}

// First-time setup after signing in: pick a public username + avatar, accept the terms.
// onSubmit({username, avatar, acceptTerms}) sends account.claim; the hub calls showError()
// on account.error and close() once account.state arrives with a username.
export function openUsernameSetup({ suggested, onSubmit, onSignOut }) {
  const m = modal('CREATE YOUR PLAYER', { dismissable: false, wide: true });
  const input = h('input', {
    type: 'text', value: (suggested || '').slice(0, 16), maxLength: 16, autocomplete: 'off',
    spellcheck: false, required: true, autofocus: true, 'aria-describedby': 'uname-hint',
  });
  const hint = h('p.field-hint#uname-hint');
  const preview = h('span.setup-preview-name');
  const previewAvatar = h('span.setup-preview-avatar');
  const err = h('p.form-error', { role: 'alert', hidden: true });
  const terms = h('input', { type: 'checkbox', required: true });
  const submit = h('button.btn-primary', { type: 'submit' }, 'START PLAYING');
  const picker = avatarPicker();

  const refresh = () => {
    const v = input.value.trim();
    const ok = USERNAME_RE.test(v);
    hint.textContent = !v ? '3–16 characters: letters, numbers and _'
      : ok ? 'Looks good. This is your public name on leaderboards and in chat.'
        : v.length < 3 ? 'Too short: at least 3 characters.'
          : 'Only letters, numbers and _ (no spaces).';
    hint.classList.toggle('ok', ok);
    hint.classList.toggle('bad', !!v && !ok);
    input.setAttribute('aria-invalid', String(!!v && !ok));
    preview.textContent = v || 'your_name';
    previewAvatar.replaceChildren(avatarEl(picker.value(), 48));
    submit.disabled = !ok || !terms.checked;
  };
  input.addEventListener('input', () => { err.hidden = true; refresh(); });
  terms.addEventListener('change', refresh);
  picker.el.addEventListener('click', refresh);
  picker.el.addEventListener('keyup', refresh);

  const form = h('form.stack',
    h('div.setup-preview', previewAvatar, h('div', preview, h('span.muted.small', 'Level 1'))),
    h('label.field', h('span', 'Username'), input), hint,
    h('div.field', h('span', 'Avatar'), picker.el),
    h('label.check', terms, h('span', 'I am 13 or older and agree to the ',
      h('a', { href: '/terms', target: '_blank' }, 'Terms of Service'), ' and ',
      h('a', { href: '/privacy', target: '_blank' }, 'Privacy Policy'), '.')),
    err,
    h('div.row-between',
      h('button.link-btn', { type: 'button', onclick: onSignOut }, 'Cancel and sign out'),
      submit));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit.disabled = true;
    onSubmit({ username: input.value.trim(), avatar: picker.value(), acceptTerms: true });
  });
  m.body.append(form);
  refresh();
  return {
    close: m.close,
    showError(msg) { err.textContent = msg; err.hidden = false; refresh(); input.focus(); },
  };
}

// Shown when the terms changed since the user last accepted them.
export function openTermsUpdate({ onAccept, onSignOut }) {
  const m = modal('UPDATED TERMS', { dismissable: false });
  m.body.append(
    h('p', 'We\'ve updated our ', h('a', { href: '/terms', target: '_blank' }, 'Terms of Service'), ' and ',
      h('a', { href: '/privacy', target: '_blank' }, 'Privacy Policy'), '. Please review and accept them to keep using your account.'),
    h('div.row-between',
      h('button.link-btn', { type: 'button', onclick: () => { m.close(); onSignOut(); } }, 'Sign out instead'),
      h('button.btn-primary', { type: 'button', onclick: () => { m.close(); onAccept(); } }, 'I ACCEPT')));
  return m;
}

let closeChipMenu = () => {};
document.addEventListener('click', () => closeChipMenu());

// Top-bar chip: SIGN IN button for guests, avatar + name + menu for accounts.
export function renderAccountChip(slot, { mode, user, onSignIn, onSignOut, onChangeAvatar }) {
  slot.replaceChildren();
  if (mode === 'off') return;
  if (!user) {
    slot.append(h('button.btn-signin', { type: 'button', onclick: onSignIn }, 'SIGN IN'));
    return;
  }
  const menu = h('div.chip-menu', { role: 'menu', hidden: true },
    h('a', { role: 'menuitem', href: `/u/${encodeURIComponent(user.username)}`, 'data-link': true }, 'My profile'),
    h('button', { role: 'menuitem', type: 'button', onclick: () => { close(); onChangeAvatar(); } }, 'Change avatar'),
    h('a', { role: 'menuitem', href: '/leaderboards', 'data-link': true }, 'Leaderboards'),
    h('a', { role: 'menuitem', href: '/settings', 'data-link': true }, 'Settings'),
    user.admin ? h('a', { role: 'menuitem', href: '/admin', 'data-link': true }, 'Moderation') : null,
    h('button', { role: 'menuitem', type: 'button', onclick: () => { close(); onSignOut(); } }, 'Sign out'));
  const chip = h('button.chip', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
    avatarEl(user.avatar, 24), h('span.chip-name', user.username), h('span.chip-level', `LV ${user.level || 1}`));
  const close = () => { menu.hidden = true; chip.setAttribute('aria-expanded', 'false'); };
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    chip.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) menu.querySelector('a, button').focus();
  });
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); chip.focus(); } });
  closeChipMenu = close;
  slot.append(h('div.chip-wrap', chip, menu));
}

export function openAvatarChange(current, onSave) {
  const m = modal('CHANGE AVATAR');
  const picker = avatarPicker(current);
  m.body.append(picker.el, h('div.row-end',
    h('button.btn-primary', { type: 'button', onclick: () => { onSave(picker.value()); m.close(); } }, 'SAVE')));
}
