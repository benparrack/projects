// Small DOM helpers shared by the hub and its pages (no framework in this repo).

// h('div.card#main', { onclick, title }, child, 'text', [moreChildren])
export function h(sel, attrs, ...children) {
  const [, tag = 'div', rest = ''] = /^([a-z0-9]*)(.*)$/i.exec(sel);
  const el = document.createElement(tag || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// Transient notification, bottom-right. kind: 'info' | 'ok' | 'warn' | 'error'.
export function toast(message, { kind = 'info', ms = 4500, action } = {}) {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = h('div#toast-root', { role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(root);
  }
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); };
  const el = h(`div.toast.toast-${kind}`,
    h('span.toast-msg', message),
    action && h('button.toast-action', { type: 'button', onclick: () => { action.run(); close(); } }, action.label),
    h('button.toast-x', { type: 'button', 'aria-label': 'Dismiss', onclick: close }, '×'));
  root.appendChild(el);
  if (ms) setTimeout(close, ms);
  return close;
}

// Accessible modal dialog. Returns { el, body, close }. Esc / backdrop click / × close it.
export function modal(title, { onClose, wide = false, dismissable = true } = {}) {
  const prevFocus = document.activeElement;
  const body = h('div.modal-body');
  const titleId = `m${Math.random().toString(36).slice(2, 8)}`;
  const box = h(`div.modal${wide ? '.modal-wide' : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div.modal-head', h('h2', { id: titleId }, title),
      dismissable && h('button.modal-x', { type: 'button', 'aria-label': 'Close', onclick: () => close() }, '×')),
    body);
  const backdrop = h('div.modal-backdrop', box);
  if (dismissable) backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissable) close();
    if (e.key === 'Tab') trapFocus(box, e);
  };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => {
    const first = box.querySelector('[autofocus], input, button:not(.modal-x), select, textarea, a[href]');
    (first || box).focus();
  });
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    if (!document.querySelector('.modal-backdrop')) document.body.classList.remove('modal-open');
    if (prevFocus && prevFocus.focus) prevFocus.focus();
    if (onClose) onClose();
  }
  return { el: box, body, close };
}

function trapFocus(box, e) {
  const items = [...box.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')];
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
  else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
}

export function timeAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}
