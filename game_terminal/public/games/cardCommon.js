// Shared rendering helper for the standard-52-card games (War, Crazy Eights, BS, Poker, Hearts,
// Spades) — one DOM building block so they all share the same card face, back and animations.
// Styles live in an injected stylesheet; callers may still set inline cursor/outline/opacity/
// transform on the returned element for selection and playability.

export const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED_SUITS = new Set(['H', 'D']);
const FACES = new Set(['J', 'Q', 'K']);

const CSS = `
.gt-card {
  position: relative; flex-shrink: 0; box-sizing: border-box; border-radius: 6px;
  width: 52px; height: 74px; font-family: Georgia, 'Times New Roman', serif; font-weight: bold;
  user-select: none; outline-offset: 1px;
  box-shadow: 0 2px 4px rgba(0,0,0,.5), 0 0 0 1px rgba(0,0,0,.25);
  transition: translate .12s ease, box-shadow .12s ease, opacity .15s;
}
.gt-card.small { width: 38px; height: 54px; border-radius: 5px; }
.gt-card.face {
  background: linear-gradient(160deg, #ffffff 0%, #f1efe8 60%, #e4e0d4 100%);
  border: 1px solid #b9b4a6; color: #1a1a1a;
}
.gt-card.red { color: #c1121f; }
.gt-card .ix {
  position: absolute; display: flex; flex-direction: column; align-items: center;
  line-height: .9; font-size: 13px; letter-spacing: -1px;
}
.gt-card .ix span:last-child { font-size: 11px; letter-spacing: 0; }
.gt-card .ix.tl { top: 3px; left: 4px; }
.gt-card .ix.br { bottom: 3px; right: 4px; transform: rotate(180deg); }
.gt-card .pip {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 26px;
}
.gt-card.ace .pip { font-size: 36px; }
.gt-card .court {
  position: absolute; inset: 14px 9px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; line-height: 1;
  border: 1px solid currentColor; border-radius: 3px; font-size: 18px;
  background: repeating-linear-gradient(135deg, transparent 0 3px, rgba(193,18,31,.07) 3px 5px);
}
.gt-card:not(.red) .court {
  background: repeating-linear-gradient(135deg, transparent 0 3px, rgba(0,0,0,.06) 3px 5px);
}
.gt-card .court span:last-child { font-size: 14px; }
.gt-card.small .ix { font-size: 10px; top: 2px; left: 3px; }
.gt-card.small .ix span:last-child { font-size: 9px; }
.gt-card.small .ix.br { display: none; }
.gt-card.small .pip { font-size: 18px; padding: 8px 0 0 6px; }
.gt-card.small.ace .pip { font-size: 24px; }
.gt-card.small .court { inset: 12px 5px 5px 8px; font-size: 13px; }
.gt-card.small .court span:last-child { font-size: 10px; }
.gt-card.back {
  border: 2px solid #e8e8e8;
  background:
    radial-gradient(circle at 50% 50%, rgba(57,255,20,.35) 0 18%, transparent 19%),
    repeating-linear-gradient(45deg, rgba(57,255,20,.18) 0 2px, transparent 2px 7px),
    repeating-linear-gradient(-45deg, rgba(57,255,20,.18) 0 2px, transparent 2px 7px),
    linear-gradient(160deg, #145c0a, #06240a);
}
.gt-card.back::after {
  content: ''; position: absolute; inset: 3px; border: 1px solid rgba(57,255,20,.45); border-radius: 3px;
}
.gt-card.face[style*="cursor: pointer"]:hover {
  translate: 0 -8px; box-shadow: 0 8px 14px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.25);
}
.gt-card.gt-card-in { animation: gt-card-in .28s cubic-bezier(.2,.9,.3,1.25) backwards; }
@keyframes gt-card-in {
  from { opacity: 0; transform: translateY(-14px) scale(.85) rotate(-4deg); }
}
.gt-card.back.gt-card-in { animation-name: gt-card-flip; }
@keyframes gt-card-flip { from { opacity: 0; transform: scaleX(.2); } }
@media (prefers-reduced-motion: reduce) {
  .gt-card, .gt-card.gt-card-in { animation: none; transition: none; }
}
`;

let styled = false;
function ensureStyles() {
  if (styled) return;
  styled = true;
  const tag = document.createElement('style');
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

// Card clients rebuild their whole DOM on every update, so an entry animation must only play for
// cards that are genuinely new. Each render batch records "card + where it sits"; at the next
// animation frame (before paint) any card whose key wasn't in the previous batch animates in.
let prevKeys = new Set();
let pending = [];
function slotPath(node) {
  const parts = [];
  for (let i = 0; i < 3 && node && node.parentElement; i++) {
    parts.push(Array.prototype.indexOf.call(node.parentElement.children, node));
    node = node.parentElement;
  }
  return parts.join('.');
}
function commitBatch() {
  const keys = new Set();
  const counts = {};
  for (const { el, id } of pending) {
    if (!el.isConnected) continue;
    let key = `${id}@${slotPath(el.parentElement)}`;
    // Face-down cards share an id, so number them within their slot.
    counts[key] = (counts[key] || 0) + 1;
    key += `#${counts[key]}`;
    keys.add(key);
    if (!prevKeys.has(key)) el.classList.add('gt-card-in');
  }
  pending = [];
  if (keys.size) prevKeys = keys;
}
function track(el, id) {
  if (!pending.length) requestAnimationFrame(commitBatch);
  pending.push({ el, id });
}

function span(text) {
  const s = document.createElement('span');
  s.textContent = text;
  return s;
}

export function renderCard(card, { faceDown = false, small = false } = {}) {
  ensureStyles();
  const el = document.createElement('div');
  el.className = 'gt-card';
  if (small) el.classList.add('small');
  if (faceDown || !card) {
    el.classList.add('back');
    track(el, `back${small ? 's' : ''}`);
    return el;
  }
  const glyph = SUIT_GLYPH[card.suit];
  el.classList.add('face');
  if (RED_SUITS.has(card.suit)) el.classList.add('red');
  if (card.rank === 'A') el.classList.add('ace');
  el.title = `${card.rank}${glyph}`;
  for (const pos of ['tl', 'br']) {
    const ix = document.createElement('div');
    ix.className = `ix ${pos}`;
    ix.append(span(card.rank), span(glyph));
    el.appendChild(ix);
  }
  if (FACES.has(card.rank)) {
    const court = document.createElement('div');
    court.className = 'court';
    court.append(span(card.rank), span(glyph));
    el.appendChild(court);
  } else {
    const pip = document.createElement('div');
    pip.className = 'pip';
    pip.textContent = glyph;
    el.appendChild(pip);
  }
  track(el, `${card.rank}${card.suit}${small ? 's' : ''}`);
  return el;
}

export function renderHand(cards, opts) {
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '4px';
  row.style.flexWrap = 'wrap';
  for (const card of cards) row.appendChild(renderCard(card, opts));
  return row;
}
