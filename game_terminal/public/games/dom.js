// Small DOM helpers shared by the game clients.

const injected = new Set();
// Adds a <style> with `css` to <head> once per page, however many times a game mounts.
export function injectStyle(css) {
  if (injected.has(css)) return;
  injected.add(css);
  const tag = document.createElement('style');
  tag.textContent = css;
  document.head.appendChild(tag);
}

export const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// 75000 -> "1:15"
export function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
