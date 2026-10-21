// Mancala (Kalah, GamePigeon-style) — a wooden board with real pebbles. Click (or press 1-6) one
// of your pits to sow its stones counter-clockwise; every move is animated stone by stone from the
// steps the server records. The board is drawn from the viewer's side: your pits along the bottom,
// your store on the right. Hovering a playable pit previews where its last stone will land.
import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect, levelLabel } from '../botLevel.js';
import { createResults } from '../resultsPanel.js';

const SEATS = ['gold', 'jade'];
const SEAT_COLOR = { gold: '#ffc94a', jade: '#3ee6a8' };
const SEAT_LABEL = { gold: 'GOLD', jade: 'JADE' };
const MODE_INFO = {
  capture: { label: 'CAPTURE', blurb: 'Last stone in your own empty pit captures it and the stones across from it.' },
  avalanche: { label: 'AVALANCHE', blurb: 'Last stone in a non-empty pit scoops that pit up and keeps sowing. No captures.' },
};

// Animation pacing — keep in sync with STEP_MS/PICK_MS/CAPTURE_MS in server/games/mancala.js.
const STEP_MS = 150;
const PICK_MS = 260;
const CAPTURE_MS = 650;

const REJECT_MESSAGES = {
  not_your_turn: "It's not your turn",
  not_your_pit: 'Pick one of your own pits',
  empty_pit: 'That pit is empty',
  not_playing: 'The game has not started',
  not_seated: 'Take a seat to play',
};

const PALETTE = [
  ['#ff7a90', '#a3122f'], ['#7cc0ff', '#1f4fa3'], ['#7af5b0', '#118a4a'], ['#ffd76e', '#b8780f'],
  ['#d7a2ff', '#6b2bb3'], ['#f7f3ea', '#9c9688'], ['#ffa877', '#b34a14'], ['#7ff3f3', '#137f86'],
];

// ---- rules (mirror of server/games/ai/mancalaEngine.js, used only for the hover preview) ----
const storeOf = (side) => (side === 0 ? 6 : 13);
const firstPit = (side) => (side === 0 ? 0 : 7);
const sideOfPit = (i) => (i >= 0 && i <= 5 ? 0 : i >= 7 && i <= 12 ? 1 : -1);

export function previewMove(pits, side, pit, mode) {
  const p = pits.slice();
  const myStore = storeOf(side);
  const oppStore = storeOf(1 - side);
  let i = pit;
  let hand = p[i];
  p[i] = 0;
  let relays = 0;
  for (;;) {
    while (hand > 0) {
      i = (i + 1) % 14;
      if (i === oppStore) continue;
      p[i]++;
      hand--;
    }
    if (i === myStore) return { land: i, extra: true, captured: 0, relays };
    if (mode === 'avalanche') {
      if (p[i] > 1 && relays < 200) { hand = p[i]; p[i] = 0; relays++; continue; }
      return { land: i, extra: false, captured: 0, relays };
    }
    if (sideOfPit(i) === side && p[i] === 1 && p[12 - i] > 0) {
      return { land: i, extra: false, captured: p[12 - i] + 1, relays };
    }
    return { land: i, extra: false, captured: 0, relays };
  }
}

// Deterministic pseudo-random in [0,1) from integers — stone colours and jitter must look random
// but be stable across re-renders.
function hash(a, b, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const CSS = `
.mc-root { display:flex; flex-direction:column; align-items:center; gap:10px; width:100%; --pit:62px; }
.mc-status { font-size:18px; font-weight:bold; padding:6px 14px; border-radius:6px; border:2px solid transparent; text-align:center; }
.mc-status.mine { background:rgba(57,255,20,.15); border-color:#39ff14; }
.mc-flash { color:#ff4d4d; min-height:1.2em; font-size:14px; }
.mc-modes { display:flex; flex-direction:column; align-items:center; gap:4px; }
.mc-seg { display:inline-flex; border:1px solid #1f8f0c; border-radius:6px; overflow:hidden; }
.mc-seg button { border:0; border-radius:0; padding:4px 12px; }
.mc-seg button.on { background:#39ff14; color:#041004; font-weight:bold; }
.mc-seg button:disabled:not(.on) { opacity:.45; }
.mc-blurb { font-size:12px; opacity:.7; max-width:520px; text-align:center; }
.mc-plate { display:flex; align-items:center; justify-content:center; gap:10px; flex-wrap:wrap; padding:6px 12px;
  border:1px solid #1f8f0c; border-radius:8px; min-width:min(520px, 92%); box-sizing:border-box; transition:box-shadow .25s, border-color .25s; }
.mc-plate.turn { border-color:var(--sc); box-shadow:0 0 14px -2px var(--sc), inset 0 0 18px -10px var(--sc); }
.mc-dot { width:14px; height:14px; border-radius:50%; background:radial-gradient(circle at 35% 30%, #fff8, var(--sc) 45%, #0008); box-shadow:0 0 6px var(--sc); flex:none; }
.mc-name { font-weight:bold; color:var(--sc); }
.mc-tally { opacity:.75; font-size:13px; }
.mc-wrap { position:relative; padding:calc(var(--pit) * .36) 0; }
.mc-board { position:relative; display:grid; box-sizing:border-box; --st:max(7px, calc(var(--pit) * .25));
  grid-template-columns: calc(var(--pit) * 1.12) repeat(6, var(--pit)) calc(var(--pit) * 1.12);
  grid-template-rows: var(--pit) var(--pit); column-gap:calc(var(--pit) * .16); row-gap:calc(var(--pit) * .5);
  padding:calc(var(--pit) * .3) calc(var(--pit) * .26); border-radius:calc(var(--pit) * .62);
  background:
    repeating-linear-gradient(91deg, rgba(255,240,210,.04) 0 2px, transparent 2px 11px),
    repeating-linear-gradient(87deg, rgba(40,15,0,.12) 0 1px, transparent 1px 17px),
    radial-gradient(ellipse 70% 60% at 28% 18%, rgba(214,150,86,.55), transparent 70%),
    radial-gradient(ellipse 50% 70% at 82% 85%, rgba(60,25,6,.55), transparent 70%),
    linear-gradient(180deg, #a8662f, #7c4520 55%, #5a3014);
  border:3px solid #34190a;
  box-shadow:0 14px 30px rgba(0,0,0,.65), inset 0 2px 0 rgba(255,222,170,.3), inset 0 -8px 16px rgba(0,0,0,.4); }
.mc-pit, .mc-store { position:relative; border-radius:50%;
  background:radial-gradient(circle at 50% 36%, #241005 0%, #3a1c0a 52%, #5b3116 100%);
  box-shadow:inset 0 7px 13px rgba(0,0,0,.8), inset 0 -2px 4px rgba(255,200,140,.2), 0 1px 0 rgba(255,225,180,.28);
  transition:box-shadow .2s, transform .15s; }
.mc-store { grid-row:1 / span 2; border-radius:999px; }
.mc-store::after { content:''; position:absolute; inset:-3px; border-radius:inherit; pointer-events:none;
  box-shadow:0 0 0 2px var(--sc), 0 0 12px -3px var(--sc); opacity:.55; }
.mc-pit.can { cursor:pointer; box-shadow:inset 0 7px 13px rgba(0,0,0,.8), 0 0 0 2px rgba(57,255,20,.6), 0 0 14px rgba(57,255,20,.35); }
.mc-pit.can:hover, .mc-pit.can.kbd { transform:translateY(-2px);
  box-shadow:inset 0 7px 13px rgba(0,0,0,.8), 0 0 0 3px #39ff14, 0 0 22px rgba(57,255,20,.6); }
.mc-pit.last::before, .mc-store.last::before { content:''; position:absolute; inset:-5px; border-radius:inherit; border:2px dashed #ffb000; opacity:.8; pointer-events:none; }
.mc-pit.land::before, .mc-store.land::before { content:''; position:absolute; inset:-6px; border-radius:inherit; border:2px dashed #fff; pointer-events:none;
  animation:mc-blink .7s ease-in-out infinite alternate; }
.mc-pit.active { box-shadow:inset 0 7px 13px rgba(0,0,0,.8), 0 0 0 3px #fff, 0 0 20px rgba(255,255,255,.6); }
@keyframes mc-blink { to { opacity:.25; } }
.mc-stone { position:absolute; width:var(--st); height:var(--st); margin:calc(var(--st) / -2) 0 0 calc(var(--st) / -2); border-radius:50%;
  background:radial-gradient(circle at 32% 27%, rgba(255,255,255,.95) 0 7%, var(--c1) 24%, var(--c2) 78%, rgba(0,0,0,.6) 100%);
  box-shadow:0 2px 2px rgba(0,0,0,.6), inset 0 -1px 2px rgba(0,0,0,.35); pointer-events:none; }
.mc-count { position:absolute; left:50%; transform:translateX(-50%); font-weight:bold; font-size:calc(var(--pit) * .25);
  color:#ffe6bd; text-shadow:0 1px 0 #000, 0 0 6px rgba(0,0,0,.8); pointer-events:none; white-space:nowrap; }
.mc-count.below { top:calc(100% + 2px); } .mc-count.above { bottom:calc(100% + 2px); }
.mc-store .mc-count { top:50%; transform:translate(-50%, -50%); font-size:calc(var(--pit) * .38); color:#fff; z-index:5;
  background:rgba(10,5,2,.55); border-radius:999px; padding:0 .35em; }
.mc-num { position:absolute; left:50%; transform:translateX(-50%); top:calc(100% + 4px + max(9px, var(--pit) * .3)); font-size:10px; opacity:.45; pointer-events:none; }
.mc-hand { position:absolute; z-index:30; pointer-events:none; transform:translate(-50%, -115%); padding:1px 8px; border-radius:10px;
  background:#05080a; border:1px solid #fff; color:#fff; font-weight:bold; font-size:13px; transition:left .12s ease-out, top .12s ease-out; }
.mc-callout { position:absolute; left:50%; top:50%; z-index:40; pointer-events:none; white-space:nowrap; font-weight:bold; letter-spacing:2px;
  font-size:calc(var(--pit) * .44); color:var(--cc); text-shadow:0 0 14px var(--cc), 0 3px 0 #000; animation:mc-pop 1.3s ease-out forwards; }
@keyframes mc-pop {
  0% { opacity:0; transform:translate(-50%, -50%) scale(.4); }
  15% { opacity:1; transform:translate(-50%, -50%) scale(1.18); }
  30% { transform:translate(-50%, -50%) scale(1); }
  80% { opacity:1; }
  100% { opacity:0; transform:translate(-50%, -90%) scale(1); } }
.mc-hint { min-height:1.3em; font-size:13px; color:#ffe6bd; opacity:.9; text-align:center; }
.mc-rules { font-size:12px; opacity:.55; max-width:560px; text-align:center; line-height:1.4; }
@media (prefers-reduced-motion: reduce) { .mc-callout { animation-duration:.01s; } .mc-pit.land::before { animation:none; } }
`;

let styled = false;
function ensureStyles() {
  if (styled) return;
  styled = true;
  const tag = document.createElement('style');
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function mount(container, api) {
  ensureStyles();
  let view = null; // the state currently drawn (lags the server while a move animates)
  let roster = [];
  let flashError = null;
  let flashTimer = null;
  let destroyed = false;

  // Stone model: an array of colour indexes per pit, so individual pebbles keep their colour as
  // they're sown around the board.
  let stones = null;
  let shownPits = null; // counts currently drawn (= view.pits except mid-animation)
  let anim = null; // { activePit, hand, handPit } while sowing
  let animToken = 0;
  const queue = [];
  let running = false;
  let lastQueuedMove = -1;
  let hoverPit = null;
  let kbdPit = null;

  const root = document.createElement('div');
  root.className = 'mc-root';
  const results = createResults(container);
  const statusEl = document.createElement('div');
  statusEl.className = 'mc-status';
  const flashEl = document.createElement('div');
  flashEl.className = 'mc-flash';
  const topPlate = document.createElement('div');
  const wrap = document.createElement('div');
  wrap.className = 'mc-wrap';
  const board = document.createElement('div');
  board.className = 'mc-board';
  wrap.appendChild(board);
  const hintEl = document.createElement('div');
  hintEl.className = 'mc-hint';
  const bottomPlate = document.createElement('div');
  const modesEl = document.createElement('div');
  modesEl.className = 'mc-modes';
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center';
  const rules = document.createElement('div');
  rules.className = 'mc-rules';
  rules.textContent = 'Sow counter-clockwise, one stone per pit, skipping your opponent\'s store. Last stone in your store = another turn. '
    + 'When either row runs empty the game ends and each side banks the stones left on its own row. Most stones wins.';
  root.append(statusEl, flashEl, topPlate, wrap, hintEl, bottomPlate, modesEl, footer, rules);
  container.appendChild(root);

  // Size the board to the space we have (phones included).
  const ro = new ResizeObserver(() => {
    const w = root.clientWidth || container.clientWidth || 600;
    const pit = Math.max(28, Math.min(66, Math.floor((w - 16) / 10.4)));
    root.style.setProperty('--pit', `${pit}px`);
  });
  ro.observe(root);

  function nicknameFor(clientId) {
    if (!clientId) return null;
    if (clientId === 'BOT') return 'BOT';
    const entry = roster.find((r) => r.clientId === clientId);
    return entry ? entry.nickname : 'someone';
  }
  function displayName(seat) {
    const id = view && view.players[seat];
    if (!id) return null;
    if (id === 'BOT') return `BOT (${levelLabel((view.botLevels || {})[seat])})`;
    return nicknameFor(id);
  }
  function mySeat(v = view) {
    const me = api.getClientId();
    if (!v) return null;
    return SEATS.find((s) => v.players[s] === me) || null;
  }
  const bottomSide = () => (mySeat() === 'jade' ? 1 : 0);

  function modelFrom(pits, salt) {
    return pits.map((n, i) => Array.from({ length: n }, (_, k) => Math.floor(hash(i + 1, k + 1, salt) * PALETTE.length)));
  }
  const modelMatches = (pits) => stones && stones.every((a, i) => a.length === pits[i]);

  // ------------------------------------------------------------------ board drawing
  const pitEls = new Array(14);

  function stoneLayout(n, k, i, isStore) {
    // Golden-angle spiral, a little jitter, scaled to the cup.
    const ga = 2.399963;
    const spread = isStore ? Math.max(14, n) : Math.max(7, n);
    const rr = Math.min(1, Math.sqrt((k + 0.6) / spread)) * 0.33;
    const a = k * ga + hash(i, k, 7) * 0.6;
    const jx = (hash(i, k, 3) - 0.5) * 0.05;
    const jy = (hash(i, k, 5) - 0.5) * 0.05;
    return {
      x: 50 + (Math.cos(a) * rr + jx) * 100,
      // y is % of height: a store is ~2.2x taller than wide, so 1.25 keeps a full store inside its cup.
      y: 50 + (Math.sin(a) * rr * (isStore ? 1.25 : 1) + jy) * 100,
    };
  }

  function makeStone(color, pos) {
    const s = document.createElement('div');
    s.className = 'mc-stone';
    const [c1, c2] = PALETTE[color % PALETTE.length];
    s.style.setProperty('--c1', c1);
    s.style.setProperty('--c2', c2);
    s.style.left = `${pos.x}%`;
    s.style.top = `${pos.y}%`;
    return s;
  }

  function canPlay(i) {
    const seat = mySeat();
    return !!(view && seat && !anim && view.phase === 'playing' && view.turn === seat
      && sideOfPit(i) === (seat === 'gold' ? 0 : 1) && view.pits[i] > 0);
  }

  function preview() {
    const p = kbdPit != null ? kbdPit : hoverPit;
    if (p == null || !canPlay(p)) return null;
    return previewMove(view.pits, mySeat() === 'gold' ? 0 : 1, p, view.mode);
  }

  function renderBoard() {
    board.innerHTML = '';
    if (!shownPits) return;
    const bs = bottomSide();
    const ts = 1 - bs;
    const pv = preview();
    const lm = !anim && view && view.lastMove;

    const cell = (i, col, row, kind) => {
      const isStore = kind === 'store';
      const el = document.createElement('div');
      el.className = isStore ? 'mc-store' : 'mc-pit';
      el.dataset.pit = String(i);
      el.style.gridColumn = String(col);
      if (!isStore) el.style.gridRow = String(row);
      if (isStore) el.style.setProperty('--sc', SEAT_COLOR[SEATS[i === 6 ? 0 : 1]]);
      const list = (stones && stones[i]) || [];
      list.forEach((color, k) => el.appendChild(makeStone(color, stoneLayout(list.length, k, i, isStore))));
      const count = document.createElement('div');
      count.className = `mc-count ${row === 1 ? 'above' : 'below'}`;
      count.textContent = String(shownPits[i]);
      el.appendChild(count);
      if (!isStore && row === 2 && sideOfPit(i) === bs && mySeat()) {
        const num = document.createElement('div');
        num.className = 'mc-num';
        num.textContent = String(i - firstPit(bs) + 1);
        el.appendChild(num);
      }
      if (!isStore && canPlay(i)) {
        el.classList.add('can');
        if (kbdPit === i) el.classList.add('kbd');
        el.addEventListener('click', () => play(i));
        // Hover only toggles classes — rebuilding the board under the pointer would eat the click.
        el.addEventListener('pointerenter', () => { if (hoverPit !== i || kbdPit != null) { hoverPit = i; kbdPit = null; updateMarks(); } });
        el.addEventListener('pointerleave', () => { if (hoverPit === i) { hoverPit = null; updateMarks(); } });
      }
      if (lm && lm.pit === i) el.classList.add('last');
      if (pv && pv.land === i) el.classList.add('land');
      if (anim && anim.activePit === i) el.classList.add('active');
      pitEls[i] = el;
      board.appendChild(el);
    };

    cell(storeOf(ts), 1, 1, 'store');
    for (let k = 0; k < 6; k++) cell(firstPit(ts) + 5 - k, 2 + k, 1, 'pit');
    for (let k = 0; k < 6; k++) cell(firstPit(bs) + k, 2 + k, 2, 'pit');
    cell(storeOf(bs), 8, 1, 'store');

    if (anim && anim.hand > 0 && anim.handPit != null) {
      const h = document.createElement('div');
      h.className = 'mc-hand';
      h.textContent = String(anim.hand);
      const c = centerOf(anim.handPit);
      h.style.left = `${c.x}px`;
      h.style.top = `${c.y - c.h / 2}px`;
      board.appendChild(h);
    }
  }

  function updateMarks() {
    const pv = preview();
    pitEls.forEach((el, i) => {
      if (!el) return;
      el.classList.toggle('land', !!pv && pv.land === i);
      el.classList.toggle('kbd', kbdPit === i);
    });
    renderHint();
  }

  function centerOf(i) {
    const el = pitEls[i];
    if (!el || !el.isConnected) return { x: 0, y: 0, h: 0 };
    const b = board.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height / 2, h: r.height };
  }

  // Animate the newest stone of pit `to` flying in from pit `from` (both already rendered).
  function flyStone(from, to, ms) {
    if (reduced()) return;
    const el = pitEls[to];
    if (!el) return;
    const stoneEls = el.querySelectorAll('.mc-stone');
    const s = stoneEls[stoneEls.length - 1];
    if (!s) return;
    const a = centerOf(from);
    const b = centerOf(to);
    const sr = s.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const sx = sr.left - er.left + sr.width / 2 - er.width / 2;
    const sy = sr.top - er.top + sr.height / 2 - er.height / 2;
    const dx = a.x - b.x - sx;
    const dy = a.y - b.y - sy;
    s.style.zIndex = '20';
    s.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(1.15)` },
      { transform: `translate(${dx / 2}px, ${dy / 2 - 18}px) scale(1.3)`, offset: 0.5 },
      { transform: 'translate(0, 0) scale(1)' },
    ], { duration: ms, easing: 'ease-out', fill: 'backwards' });
  }

  // Many stones flying into a store (captures, end-of-game sweep): ghosts from each source pit.
  function flyGroup(fromPits, counts, to, ms) {
    if (reduced()) return;
    const b = centerOf(to);
    fromPits.forEach((p, idx) => {
      const a = centerOf(p);
      const n = Math.min(8, counts[idx] || 1);
      for (let k = 0; k < n; k++) {
        const g = makeStone(Math.floor(hash(p, k, 11) * PALETTE.length), { x: 0, y: 0 });
        g.style.left = `${a.x + (hash(p, k, 1) - 0.5) * 18}px`;
        g.style.top = `${a.y + (hash(p, k, 2) - 0.5) * 18}px`;
        g.style.margin = `calc(var(--st) / -2)`;
        g.style.zIndex = '25';
        board.appendChild(g);
        const ax = b.x - a.x;
        const ay = b.y - a.y;
        g.animate([
          { transform: 'translate(0,0)', opacity: 1 },
          { transform: `translate(${ax / 2}px, ${ay / 2 - 30}px) scale(1.3)`, opacity: 1, offset: 0.5 },
          { transform: `translate(${ax}px, ${ay}px) scale(.8)`, opacity: 0.2 },
        ], { duration: ms * 0.8, delay: k * 25, easing: 'ease-in-out', fill: 'both' }).onfinish = () => g.remove();
      }
    });
  }

  function callout(text, color) {
    const c = document.createElement('div');
    c.className = 'mc-callout';
    c.textContent = text;
    c.style.setProperty('--cc', color);
    wrap.appendChild(c);
    setTimeout(() => c.remove(), 1400);
  }

  // ------------------------------------------------------------------ chrome
  function renderStatus() {
    statusEl.className = 'mc-status';
    statusEl.style.color = '';
    if (!view) { statusEl.textContent = 'Loading...'; return; }
    const seat = mySeat();
    if (anim) {
      statusEl.textContent = `${SEAT_LABEL[anim.seat]} IS SOWING…`;
      statusEl.style.color = SEAT_COLOR[anim.seat];
    } else if (view.phase === 'waiting') {
      statusEl.textContent = 'Waiting for both seats to be filled.';
    } else if (view.phase === 'playing') {
      const mine = seat && seat === view.turn;
      statusEl.textContent = mine ? `▶ YOUR TURN (${SEAT_LABEL[seat]})` : `${SEAT_LABEL[view.turn]} TO MOVE. ${displayName(view.turn)}`;
      statusEl.style.color = SEAT_COLOR[view.turn];
      if (mine) statusEl.classList.add('mine');
    } else if (view.phase === 'game_over') {
      const g = view.pits[6];
      const j = view.pits[13];
      statusEl.textContent = view.winner === 'draw' ? `IT'S A DRAW! ${g} – ${j}` : `${SEAT_LABEL[view.winner]} WINS! ${Math.max(g, j)} – ${Math.min(g, j)}`;
      if (view.winner !== 'draw') statusEl.style.color = SEAT_COLOR[view.winner];
    }
  }

  function renderPlate(el, seat) {
    el.className = 'mc-plate';
    el.innerHTML = '';
    el.style.setProperty('--sc', SEAT_COLOR[seat]);
    if (view.phase === 'playing' && view.turn === seat && !anim) el.classList.add('turn');
    if (anim && anim.seat === seat) el.classList.add('turn');
    const dot = document.createElement('span');
    dot.className = 'mc-dot';
    const name = document.createElement('span');
    name.className = 'mc-name';
    const occupant = displayName(seat);
    name.textContent = `${SEAT_LABEL[seat]}: ${occupant || '(empty)'}${view.players[seat] === api.getClientId() ? ' (you)' : ''}`;
    el.append(dot, name);
    const sc = view.score || {};
    if (view.players.gold && view.players.jade && (sc.gold || sc.jade || sc.draws)) {
      const t = document.createElement('span');
      t.className = 'mc-tally';
      t.textContent = `wins ${sc[seat] || 0}`;
      el.appendChild(t);
    }
    const me = mySeat();
    const pid = view.players[seat];
    if (!pid) {
      if (!me) {
        const b = document.createElement('button');
        b.textContent = `PLAY ${SEAT_LABEL[seat]}`;
        b.addEventListener('click', () => api.sendAction({ kind: 'sit', seat }));
        el.appendChild(b);
      }
      const bot = document.createElement('button');
      bot.textContent = 'PLAY VS BOT';
      bot.addEventListener('click', () => api.sendAction({ kind: 'sit', seat, bot: true, level: preferredLevel() }));
      el.append(bot, levelSelect(preferredLevel()));
    } else if (pid === 'BOT') {
      el.appendChild(levelSelect((view.botLevels || {})[seat], (level) => api.sendAction({ kind: 'setBotLevel', seat, level })));
      const rm = document.createElement('button');
      rm.textContent = 'REMOVE BOT';
      rm.addEventListener('click', () => api.sendAction({ kind: 'removeBot', seat }));
      el.appendChild(rm);
    } else if (pid === api.getClientId()) {
      const leave = document.createElement('button');
      leave.textContent = 'LEAVE SEAT';
      leave.classList.add('seat-leave'); // hidden in play-by-turns games (seats are fixed)
      leave.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      el.appendChild(leave);
    }
  }

  function renderModes() {
    modesEl.innerHTML = '';
    const seg = document.createElement('div');
    seg.className = 'mc-seg';
    const anyHuman = SEATS.some((s) => view.players[s] && view.players[s] !== 'BOT');
    const mayChange = view.phase !== 'playing' && (!anyHuman || !!mySeat());
    for (const m of Object.keys(MODE_INFO)) {
      const b = document.createElement('button');
      b.textContent = MODE_INFO[m].label;
      if (view.mode === m) b.classList.add('on');
      b.disabled = !mayChange || view.mode === m;
      b.title = mayChange ? `Switch to ${MODE_INFO[m].label} mode` : 'Mode can be changed between games';
      b.addEventListener('click', () => { sfx.play('click'); api.sendAction({ kind: 'setMode', mode: m }); });
      seg.appendChild(b);
    }
    const blurb = document.createElement('div');
    blurb.className = 'mc-blurb';
    blurb.textContent = `${MODE_INFO[view.mode].label} MODE. ${MODE_INFO[view.mode].blurb}`;
    modesEl.append(seg, blurb);
  }

  function renderHint() {
    const pv = preview();
    if (!pv) { hintEl.textContent = mySeat() && view && view.phase === 'playing' && view.turn === mySeat() && !anim ? 'Pick a pit (click or press 1–6).' : ''; return; }
    if (pv.extra) hintEl.textContent = `Lands in your store${pv.relays ? ` after ${pv.relays} relay${pv.relays > 1 ? 's' : ''}` : ''}. Extra turn.`;
    else if (pv.captured) hintEl.textContent = `Captures ${pv.captured} stone${pv.captured > 1 ? 's' : ''}!`;
    else if (pv.relays) hintEl.textContent = `Avalanche: ${pv.relays} relay${pv.relays > 1 ? 's' : ''}, then your turn ends.`;
    else hintEl.textContent = 'Your turn ends after this move.';
  }

  function renderFooter() {
    footer.innerHTML = '';
    if (view.phase === 'game_over' && mySeat()) {
      const again = document.createElement('button');
      again.textContent = 'NEW GAME';
      again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
      footer.appendChild(again);
    }
  }

  function renderResults() {
    if (!view || view.phase !== 'game_over' || anim) { results.update(null); return; }
    const me = mySeat();
    const draw = view.winner === 'draw';
    const score = { gold: view.pits[6], jade: view.pits[13] };
    const order = draw ? SEATS : [view.winner, ...SEATS.filter((s) => s !== view.winner)];
    results.update({
      title: draw ? "IT'S A DRAW" : me === view.winner ? 'YOU WIN' : me ? 'YOU LOSE' : `${SEAT_LABEL[view.winner]} WINS`,
      subtitle: `Mancala · ${MODE_INFO[view.mode].label.toLowerCase()} mode · ${score.gold} – ${score.jade}`,
      outcome: draw ? 'draw' : !me ? 'over' : me === view.winner ? 'win' : 'lose',
      rows: order.map((s) => ({ name: `${displayName(s) || SEAT_LABEL[s]} · ${SEAT_LABEL[s]}`, value: `${score[s]} stones`, win: !draw && s === view.winner, you: s === me })),
      rematch: me ? { label: 'REMATCH', onClick: () => api.sendAction({ kind: 'resetGame' }) } : null,
    });
  }

  function render() {
    if (!view) { statusEl.textContent = 'Loading...'; return; }
    flashEl.textContent = flashError ? (REJECT_MESSAGES[flashError] || 'Move rejected') : '';
    renderStatus();
    const bs = bottomSide();
    renderPlate(topPlate, SEATS[1 - bs]);
    renderPlate(bottomPlate, SEATS[bs]);
    renderModes();
    renderFooter();
    renderBoard();
    renderHint();
    renderResults();
  }

  function play(i) {
    if (!canPlay(i)) return;
    sfx.play('click');
    hoverPit = null;
    kbdPit = null;
    api.sendAction({ kind: 'move', pit: i });
  }

  // ------------------------------------------------------------------ state + animation queue
  function showDirect(v) {
    const prev = view;
    view = v;
    if (!stones || !modelMatches(v.pits)) stones = modelFrom(v.pits, v.moveCount + 1);
    shownPits = v.pits.slice();
    lastQueuedMove = v.moveCount;
    endSounds(prev, v);
    render();
  }

  function endSounds(prev, v) {
    if (!prev) return;
    if (v.phase === 'game_over' && prev.phase !== 'game_over') {
      const me = mySeat(v);
      if (!me || v.winner === 'draw') sfx.play('point');
      else sfx.play(v.winner === me ? 'win' : 'lose');
    } else if (v.phase === 'playing' && mySeat(v) && v.turn === mySeat(v) && (prev.turn !== v.turn || prev.phase !== 'playing')) {
      setTimeout(() => sfx.play('turn'), 80);
    }
  }

  async function animateMove(v, fast) {
    const lm = v.lastMove;
    const token = animToken;
    const k = fast ? 0.45 : 1;
    if (!modelMatches(lm.before)) stones = modelFrom(lm.before, lm.id);
    shownPits = lm.before.slice();
    anim = { seat: lm.seat, activePit: lm.pit, hand: 0, handPit: null };
    let hand = [];
    let from = lm.pit;
    render();
    for (const step of lm.steps) {
      if (destroyed || token !== animToken) return false;
      if (step.t === 'pick') {
        hand = stones[step.pit].splice(0);
        shownPits[step.pit] = 0;
        anim.activePit = step.pit;
        anim.hand = hand.length;
        anim.handPit = step.pit;
        from = step.pit;
        sfx.play('select');
        renderBoard();
        await wait(PICK_MS * k);
      } else if (step.t === 'drop') {
        stones[step.pit].push(hand.length ? hand.shift() : Math.floor(Math.random() * PALETTE.length));
        shownPits[step.pit]++;
        anim.hand = hand.length;
        anim.handPit = step.pit;
        renderBoard();
        flyStone(from, step.pit, STEP_MS * k * 0.95);
        from = step.pit;
        sfx.play('tick', { vol: 0.6 });
        await wait(STEP_MS * k);
      } else if (step.t === 'capture' || step.t === 'sweep') {
        const counts = step.pits.map((p) => stones[p].length);
        for (const p of step.pits) {
          stones[step.store].push(...stones[p].splice(0));
          shownPits[p] = 0;
        }
        shownPits[step.store] += step.n;
        anim.hand = 0;
        anim.activePit = null;
        renderBoard();
        flyGroup(step.pits, counts, step.store, CAPTURE_MS * k);
        if (step.t === 'capture') {
          callout(`CAPTURE +${step.n}`, '#ff6b6b');
          sfx.play('capture');
        } else {
          callout(`${SEAT_LABEL[SEATS[step.side]]} BANKS ${step.n}`, SEAT_COLOR[SEATS[step.side]]);
          sfx.play('whoosh');
        }
        await wait(CAPTURE_MS * k);
      }
    }
    if (lm.extra) {
      callout('EXTRA TURN', SEAT_COLOR[lm.seat]);
      sfx.play('chime');
    }
    anim = null;
    return true;
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queue.length && !destroyed) {
        const v = queue.shift();
        const lm = v.lastMove;
        if (lm && view && lm.id === (view.moveCount || 0) + 1 && lm.steps && lm.steps.length) {
          const prev = view;
          const ok = await animateMove(v, queue.length > 0);
          if (!ok) continue;
          view = v;
          shownPits = v.pits.slice();
          if (!modelMatches(v.pits)) stones = modelFrom(v.pits, v.moveCount + 1);
          endSounds(prev, v);
          render();
        } else {
          showDirect(v);
        }
      }
    } finally {
      running = false;
    }
  }

  function receive(v) {
    // A new game / reset (move counter went backwards or the board was rebuilt) cancels any
    // animation still running and shows the fresh board immediately.
    if (v.moveCount < lastQueuedMove || (v.moveCount === lastQueuedMove && !v.lastMove && queue.length + (anim ? 1 : 0) > 0)) {
      animToken++;
      queue.length = 0;
      anim = null;
      stones = null;
      showDirect(v);
      return;
    }
    lastQueuedMove = v.moveCount;
    queue.push(v);
    pump();
  }

  function onKey(e) {
    if (!view || e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const seat = mySeat();
    if (!seat || view.phase !== 'playing' || view.turn !== seat || anim) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 6) {
      const pit = firstPit(seat === 'gold' ? 0 : 1) + n - 1;
      if (canPlay(pit)) { e.preventDefault(); play(pit); }
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Enter') {
      const legal = [0, 1, 2, 3, 4, 5].map((k) => firstPit(seat === 'gold' ? 0 : 1) + k).filter(canPlay);
      if (!legal.length) return;
      e.preventDefault();
      if (e.key === 'Enter') { if (kbdPit != null && canPlay(kbdPit)) play(kbdPit); return; }
      const idx = legal.indexOf(kbdPit);
      const next = idx === -1 ? (e.key === 'ArrowRight' ? 0 : legal.length - 1) : (idx + (e.key === 'ArrowRight' ? 1 : -1) + legal.length) % legal.length;
      kbdPit = legal[next];
      updateMarks();
    }
  }
  window.addEventListener('keydown', onKey);

  render();

  return {
    applySnapshot(snapshot) {
      animToken++;
      queue.length = 0;
      anim = null;
      stones = null;
      view = null;
      showDirect(snapshot);
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        const { kind, ...v } = data;
        if (flashError) { flashError = null; flashEl.textContent = ''; }
        if (!view) showDirect(v);
        else receive(v);
      } else if (data.kind === 'moveRejected') {
        flashError = data.reason || 'empty_pit';
        flashEl.textContent = REJECT_MESSAGES[flashError] || 'Move rejected';
        sfx.play('error');
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { flashError = null; flashEl.textContent = ''; }, 2500);
      }
    },
    applyRoster(newRoster) {
      roster = newRoster || [];
      if (view && !anim) render();
    },
    unmount() {
      destroyed = true;
      animToken++;
      clearTimeout(flashTimer);
      window.removeEventListener('keydown', onKey);
      ro.disconnect();
      results.destroy();
      container.innerHTML = '';
    },
  };
}
