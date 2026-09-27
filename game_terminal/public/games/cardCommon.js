import { preferredLevel, levelSelect, levelLabel } from './botLevel.js';
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
  position: absolute; inset: 5px 15px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; line-height: 1;
  border: 1px solid currentColor; border-radius: 3px; font-size: 17px;
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
.gt-card.small .court { inset: 4px 4px 4px 13px; font-size: 13px; }
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
.gt-bot-add {
  border: 1px dashed #3ad7ff; color: #3ad7ff; background: rgba(58,215,255,0.06);
  animation: gt-bot-glow 2.4s ease-in-out infinite;
}
.gt-bot-add:hover { background: rgba(58,215,255,0.16); }
.gt-bot-rm { border-color: #ff5a5a; color: #ff8a8a; font-size: .8em; padding: 2px 8px; }
@keyframes gt-bot-glow { 50% { box-shadow: 0 0 10px rgba(58,215,255,.45); } }
.gt-bot-new { animation: gt-bot-pop .45s cubic-bezier(.3,1.6,.5,1); }
@keyframes gt-bot-pop { from { transform: scale(.4); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .gt-card, .gt-card.gt-card-in, .gt-bot-add, .gt-bot-new { animation: none; transition: none; }
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

// --- CPU players (see server/games/cardBots.js): a bot's seat id is 'bot-<Name>~<level>'. ---
export const isBot = (id) => typeof id === 'string' && id.startsWith('bot-');
export const botName = (id) => {
  const [name, level] = id.slice(4).split('~');
  return level ? `🤖 ${name} (${levelLabel(level)})` : `🤖 ${name}`;
};

// "+ ADD BOT" (optionally for a specific seat) — glowing dashed button.
// Comes with a difficulty picker (remembered per browser) unless `withLevel` is false.
export function addBotButton(api, seat, label = '+ ADD BOT', withLevel = true) {
  ensureStyles();
  const b = document.createElement('button');
  b.className = 'gt-bot-add';
  b.textContent = label;
  b.title = 'Fill this seat with a computer player';
  b.addEventListener('click', () => api.sendAction({ kind: 'addBot', level: preferredLevel(), ...(seat === undefined ? {} : { seat }) }));
  if (!withLevel) return b;
  const wrap = document.createElement('span');
  wrap.style.cssText = 'display:inline-flex;gap:4px;align-items:center;flex-wrap:wrap';
  const sel = levelSelect(preferredLevel(), () => {
    // Keep every other picker on the page in sync with the new preference.
    for (const o of document.querySelectorAll('select.gt-bot-level')) o.value = sel.value;
  });
  sel.style.fontSize = '.8em';
  wrap.append(b, sel);
  return wrap;
}

export function removeBotButton(api, seat, label = '✕') {
  ensureStyles();
  const b = document.createElement('button');
  b.className = 'gt-bot-rm';
  b.textContent = label;
  b.title = 'Remove this bot';
  b.addEventListener('click', () => api.sendAction({ kind: 'removeBot', seat }));
  return b;
}

// Seat-list games (War, Crazy Eights, BS, Poker): one add button plus a remove chip per bot.
// Bots can join only before a game starts; they can be removed between games too.
export function botSeatControls(api, seats, maxSeats, phase, withLevel = true) {
  const frag = document.createDocumentFragment();
  if (phase !== 'waiting' && phase !== 'game_over') return frag;
  seats.forEach((id, i) => {
    if (isBot(id)) frag.appendChild(removeBotButton(api, i, `✕ ${botName(id)}`));
  });
  if (phase === 'waiting' && seats.length < maxSeats) frag.appendChild(addBotButton(api, undefined, '+ ADD BOT', withLevel));
  return frag;
}

// Pop a seat element in the first time a given bot shows up in it.
const seenBots = new Set();
export function markBotSeat(el, id, seat) {
  if (!isBot(id)) return;
  const k = `${id}@${seat}`;
  if (seenBots.has(k)) return;
  seenBots.add(k);
  ensureStyles();
  el.classList.add('gt-bot-new');
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
