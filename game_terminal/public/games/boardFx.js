// Shared board-game motion helpers. Board clients rebuild their DOM on every update, so a piece is
// "slid" by rendering it at its destination and then animating it in from the source square's
// on-screen position (a FLIP animation), before the first paint of the new DOM.

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Slide `pieceEl` (already placed in its destination) in from `fromEl`'s position. `fromEl` may be
// a function (resolved at animation time, handy when the source cell isn't built yet) or an array
// of waypoint elements for a multi-leg move (e.g. a checkers multi-jump), oldest first.
export function slideFrom(pieceEl, fromEl, { duration = 200, delay = 0 } = {}) {
  if (!pieceEl || !fromEl || reduced()) return;
  requestAnimationFrame(() => {
    if (typeof fromEl === 'function') fromEl = fromEl();
    const stops = (Array.isArray(fromEl) ? fromEl : [fromEl]).filter((e) => e && e.isConnected);
    if (!stops.length || !pieceEl.isConnected) return;
    const b = pieceEl.getBoundingClientRect();
    const frames = stops.map((e) => {
      const a = e.getBoundingClientRect();
      const dx = a.left + a.width / 2 - (b.left + b.width / 2);
      const dy = a.top + a.height / 2 - (b.top + b.height / 2);
      return { transform: `translate(${dx}px, ${dy}px)` };
    });
    frames.push({ transform: 'translate(0, 0)' });
    const prevZ = pieceEl.style.zIndex;
    if (getComputedStyle(pieceEl).position === 'static') pieceEl.style.position = 'relative';
    pieceEl.style.zIndex = '20';
    const anim = pieceEl.animate(frames, {
      duration: duration * stops.length, delay, easing: 'cubic-bezier(.25,.8,.35,1)', fill: 'backwards',
    });
    anim.onfinish = anim.oncancel = () => { pieceEl.style.zIndex = prevZ; };
  });
}

// Drop a piece in from above (Connect 4): `rows` is how many cells it falls.
export function dropIn(pieceEl, rows, cellPx) {
  if (!pieceEl || reduced()) return;
  const dist = (rows + 1) * cellPx;
  pieceEl.animate(
    [
      { transform: `translateY(${-dist}px)`, offset: 0 },
      { transform: 'translateY(0)', offset: 0.7, easing: 'ease-out' },
      { transform: `translateY(${-Math.min(14, cellPx * 0.3)}px)`, offset: 0.85, easing: 'ease-in' },
      { transform: 'translateY(0)', offset: 1 },
    ],
    { duration: 220 + rows * 45, easing: 'ease-in', fill: 'backwards' },
  );
}

// Fade/burst a ghost of a captured piece on `cellEl` (it's already gone from the new board).
// `content` is glyph text or a DOM node (e.g. a disc) to show.
export function captureGhost(cellEl, content, color, { delay = 0 } = {}) {
  if (!cellEl || reduced()) return;
  const g = document.createElement('span');
  if (typeof content === 'string') g.textContent = content;
  else g.appendChild(content);
  Object.assign(g.style, {
    position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center',
    pointerEvents: 'none', color: color || 'inherit', zIndex: '1',
  });
  cellEl.appendChild(g);
  g.animate(
    [{ opacity: 0.9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.6) rotate(20deg)' }],
    { duration: 380, delay, easing: 'ease-out', fill: 'backwards' },
  ).onfinish = () => g.remove();
}

// Highlight colours shared across boards.
export const LAST_MOVE_TINT = 'inset 0 0 0 999px rgba(255,176,0,0.16)';
export const CHECK_GLOW = 'radial-gradient(circle, rgba(255,40,40,0.85) 0%, rgba(255,40,40,0.35) 45%, transparent 75%)';

// Returns true once per distinct `key` (skips the very first call so a page load doesn't animate).
export function changeTracker() {
  let last;
  let first = true;
  return (key) => {
    const changed = !first && key !== last;
    first = false;
    last = key;
    return changed && key != null;
  };
}
