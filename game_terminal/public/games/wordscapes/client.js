// Wordscapes client: letter wheel (drag / tap / type) under a crossword that fills as words are
// found. Server sends masked views (see server/games/wordscapes.js); everything here is display
// and input. Pure helpers live in wheel.js so the Node test can exercise them.
import { sfx } from '../sfx.js';
import { createResults } from '../resultsPanel.js';
import { createBotBar } from '../tickBots.js';
import { makeServerClock } from '../serverClock.js';
import { wheelPositions, hitNode, applyDragNode, keyPick, sceneFor, fitCell } from './wheel.js';

const STYLE_ID = 'ws-style';
const CSS = `
.ws-root{width:100%;max-width:640px;margin:0 auto;display:flex;flex-direction:column;gap:8px;padding:8px;box-sizing:border-box;font-family:"Courier New",monospace;color:var(--fg,#39ff14);user-select:none;-webkit-user-select:none}
.ws-top{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:space-between}
.ws-title{font-weight:bold;letter-spacing:2px;color:var(--accent,#ffb000)}
.ws-modes{display:flex;gap:0}
.ws-modes button{padding:4px 10px;font-size:.85em;border-radius:0}
.ws-modes button.on{background:var(--fg,#39ff14);color:#000}
.ws-status{min-height:1.3em;font-size:.92em;color:var(--fg,#39ff14);text-align:center}
.ws-status.bad{color:var(--error,#ff4d4d)}.ws-status.good{color:var(--accent,#ffb000)}
.ws-stage{position:relative;border:1px solid var(--border,#1f8f0c);border-radius:6px;overflow:hidden;padding:12px 8px 10px;transition:background 1.2s ease}
.ws-stage::before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 50% 120%,rgba(0,0,0,.55),rgba(0,0,0,.1) 60%);pointer-events:none}
.ws-sun{position:absolute;width:140px;height:140px;border-radius:50%;top:-40px;right:-30px;filter:blur(2px);opacity:.55;pointer-events:none;transition:background 1.2s}
.ws-hills{position:absolute;left:0;right:0;bottom:0;height:45%;pointer-events:none;opacity:.5;transition:fill 1.2s}
.ws-grid{position:relative;display:grid;gap:3px;margin:0 auto 10px;justify-content:center}
.ws-cell{border-radius:4px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28);display:flex;align-items:center;justify-content:center;font-weight:bold;color:#10141a;box-sizing:border-box;transition:background .25s,transform .25s}
.ws-cell.f{background:var(--c,#e9f7ea);border-color:rgba(0,0,0,.25);box-shadow:0 2px 0 rgba(0,0,0,.25)}
.ws-cell.h{background:#f4f1e6;border-color:#f4f1e6}
.ws-cell.m{background:rgba(0,0,0,.35);color:rgba(255,255,255,.6);border-style:dashed}
.ws-cell.pop{animation:ws-pop .38s ease-out both}
.ws-cell.flash{animation:ws-flash .6s ease-out}
.ws-cell.hold{color:transparent}
@keyframes ws-pop{0%{transform:scale(.4)}60%{transform:scale(1.18)}100%{transform:scale(1)}}
@keyframes ws-flash{0%,100%{filter:none}40%{filter:brightness(1.6) drop-shadow(0 0 6px #fff)}}
.ws-preview{position:relative;height:40px;display:flex;justify-content:center;align-items:center;gap:3px}
.ws-preview span{min-width:28px;height:32px;padding:0 4px;border-radius:5px;background:var(--accent,#ffb000);color:#111;font-weight:bold;font-size:20px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 0 rgba(0,0,0,.35)}
.ws-preview.shake{animation:ws-shake .42s}
.ws-preview.good span{background:#39ff14}
.ws-preview.bonus span{background:#8c52ff;color:#fff}
@keyframes ws-shake{0%,100%{transform:none}20%{transform:translateX(-9px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(4px)}}
.ws-wheelrow{position:relative;display:flex;justify-content:center;align-items:center}
.ws-wheel{width:min(72vw,260px);height:min(72vw,260px);touch-action:none;cursor:pointer;display:block}
.ws-wheel .bg{fill:rgba(255,255,255,.16);stroke:rgba(255,255,255,.35);stroke-width:2}
.ws-wheel .node circle{fill:rgba(0,0,0,.001);transition:fill .12s}
.ws-wheel .node text{fill:#fff;font:bold 46px "Courier New",monospace;text-anchor:middle;dominant-baseline:central;pointer-events:none;text-shadow:0 2px 3px rgba(0,0,0,.5)}
.ws-wheel .node.sel circle{fill:var(--accent,#ffb000)}
.ws-wheel .node.sel text{fill:#111}
.ws-wheel .node{transition:transform .35s cubic-bezier(.5,1.6,.5,1)}
.ws-wheel.off{opacity:.5;cursor:default}
.ws-side{position:absolute;display:flex;flex-direction:column;gap:8px}
.ws-side.l{left:2px}.ws-side.r{right:2px}
.ws-side button{width:48px;height:48px;padding:0;border-radius:50%;font-size:20px;display:flex;align-items:center;justify-content:center;position:relative;background:rgba(0,0,0,.55)}
.ws-side button .n{position:absolute;right:-4px;top:-4px;background:var(--accent,#ffb000);color:#000;border-radius:9px;font-size:11px;min-width:18px;height:18px;line-height:18px;font-weight:bold}
.ws-side button.pulse{animation:ws-pop .45s}
.ws-players{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
.ws-chip{display:flex;align-items:center;gap:6px;border:1px solid var(--c);border-radius:14px;padding:2px 10px;font-size:.85em;background:rgba(0,0,0,.4)}
.ws-chip .dot{width:9px;height:9px;border-radius:50%;background:var(--c)}
.ws-chip.me{box-shadow:0 0 0 1px var(--c) inset}
.ws-chip .bar{width:46px;height:6px;border-radius:3px;background:rgba(255,255,255,.15);overflow:hidden}
.ws-chip .bar i{display:block;height:100%;background:var(--c);transition:width .3s}
.ws-chip .sc{color:var(--accent,#ffb000)}
.ws-bonuslist{position:absolute;left:8px;right:8px;bottom:8px;max-height:45%;overflow:auto;background:rgba(5,8,10,.94);border:1px solid var(--border,#1f8f0c);border-radius:6px;padding:8px;font-size:.9em;z-index:3}
.ws-bonuslist b{color:var(--accent,#ffb000)}
.ws-count{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:72px;font-weight:bold;color:#fff;text-shadow:0 0 18px #000;background:rgba(0,0,0,.35);z-index:4;pointer-events:none}
.ws-fly{position:fixed;z-index:50;pointer-events:none;border-radius:5px;background:var(--accent,#ffb000);color:#111;font:bold 20px "Courier New",monospace;display:flex;align-items:center;justify-content:center;transition:transform .45s cubic-bezier(.3,.7,.4,1),opacity .45s}
.ws-actions{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
.ws-actions button{font-size:.85em;padding:5px 10px}
@media (max-width:420px){.ws-side button{width:40px;height:40px;font-size:17px}.ws-preview span{min-width:24px;height:28px;font-size:17px}}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mount(container, api) {
  ensureStyle();
  const clock = makeServerClock();
  const myId = () => api.getClientId();
  let snap = null;
  let order = []; // display order of wheel letter indexes (client-side shuffle)
  let orderKey = '';
  let sel = []; // selected letter indexes (into snap.letters)
  let dragging = false;
  let pointer = null;
  let pendingFly = null; // { slot, rects } captured from the preview when my word was accepted
  let prevFound = new Set();
  let prevHint = new Set();
  let statusTimer = 0;
  let countTimer = 0;
  let lastPuzzle = null;
  let bonusOpen = false;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };

  const root = el('div', 'ws-root');
  const top = el('div', 'ws-top');
  const title = el('div', 'ws-title', 'WORDSCAPES');
  const modes = el('div', 'ws-modes');
  const coopBtn = el('button', '', 'CO-OP');
  const raceBtn = el('button', '', 'RACE');
  coopBtn.title = 'Everyone fills one shared crossword';
  raceBtn.title = 'Everyone gets their own copy — first to finish wins';
  coopBtn.addEventListener('click', () => { if (snap && snap.mode !== 'coop') { sfx.play('click'); api.sendAction({ kind: 'setMode', mode: 'coop' }); } });
  raceBtn.addEventListener('click', () => { if (snap && snap.mode !== 'race') { sfx.play('click'); api.sendAction({ kind: 'setMode', mode: 'race' }); } });
  modes.append(coopBtn, raceBtn);
  top.append(title, modes);

  const status = el('div', 'ws-status');
  const stage = el('div', 'ws-stage');
  const sun = el('div', 'ws-sun');
  const hills = svgEl('svg', { class: 'ws-hills', viewBox: '0 0 100 40', preserveAspectRatio: 'none' });
  const hillPath = svgEl('path', { d: 'M0 40 L0 22 Q15 8 30 20 T60 16 T100 12 L100 40 Z' });
  const hillPath2 = svgEl('path', { d: 'M0 40 L0 30 Q20 20 45 29 T100 24 L100 40 Z', opacity: '.7' });
  hills.append(hillPath, hillPath2);
  const grid = el('div', 'ws-grid');
  const preview = el('div', 'ws-preview');
  const wheelRow = el('div', 'ws-wheelrow');
  const wheel = svgEl('svg', { class: 'ws-wheel', viewBox: '0 0 300 300' });
  const sideL = el('div', 'ws-side l');
  const sideR = el('div', 'ws-side r');
  const shuffleBtn = el('button', '', '🔀');
  shuffleBtn.title = 'Shuffle the wheel (Space)';
  const hintBtn = el('button', '', '💡');
  hintBtn.title = `Reveal a letter (costs 2 points)`;
  const hintN = el('span', 'n', '0');
  hintBtn.appendChild(hintN);
  const bonusBtn = el('button', '', '★');
  bonusBtn.title = 'Your bonus words (every 5 earns a hint)';
  const bonusN = el('span', 'n', '0');
  bonusBtn.appendChild(bonusN);
  sideL.append(shuffleBtn);
  sideR.append(hintBtn, bonusBtn);
  wheelRow.append(sideL, wheel, sideR);
  const bonusList = el('div', 'ws-bonuslist');
  bonusList.hidden = true;
  const countEl = el('div', 'ws-count');
  countEl.hidden = true;
  stage.append(sun, hills, grid, preview, wheelRow, bonusList, countEl);

  const players = el('div', 'ws-players');
  const actions = el('div', 'ws-actions');
  const newBtn = el('button', '', 'NEW PUZZLE');
  newBtn.title = 'Skip to a different puzzle at this level';
  newBtn.addEventListener('click', () => { sfx.play('click'); api.sendAction({ kind: 'newPuzzle' }); });
  const restartBtn = el('button', '', 'RESTART AT LVL 1');
  restartBtn.addEventListener('click', () => { sfx.play('click'); api.sendAction({ kind: 'restart' }); });
  actions.append(newBtn, restartBtn);
  const botBar = createBotBar(api);
  root.append(top, status, stage, players, actions, botBar.el);
  container.appendChild(root);
  const results = createResults(container);

  // --- wheel ---
  const bgCircle = svgEl('circle', { class: 'bg', cx: 150, cy: 150, r: 138 });
  const line = svgEl('polyline', { fill: 'none', stroke: '#ffb000', 'stroke-width': 11, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: '.9' });
  const nodesG = svgEl('g');
  wheel.append(bgCircle, line, nodesG);
  let nodeEls = [];
  let positions = [];

  function buildWheel() {
    nodesG.textContent = '';
    nodeEls = snap.letters.split('').map((ch, i) => {
      const g = svgEl('g', { class: 'node' });
      g.append(svgEl('circle', { cx: 0, cy: 0, r: 30 }));
      const t = svgEl('text', { x: 0, y: 2 });
      t.textContent = ch.toUpperCase();
      g.appendChild(t);
      g.dataset.i = i;
      nodesG.appendChild(g);
      return g;
    });
    layoutWheel();
  }

  function layoutWheel() {
    positions = wheelPositions(order.length, 150, 150, order.length >= 7 ? 98 : 92);
    order.forEach((letterIdx, slot) => {
      const g = nodeEls[letterIdx];
      if (g) g.style.transform = `translate(${positions[slot].x}px, ${positions[slot].y}px)`;
    });
    drawSelection();
  }

  const posOf = (letterIdx) => positions[order.indexOf(letterIdx)];

  function drawSelection() {
    nodeEls.forEach((g, i) => g.classList.toggle('sel', sel.includes(i)));
    const pts = sel.map((i) => posOf(i)).filter(Boolean).map((p) => `${p.x},${p.y}`);
    if (dragging && pointer && sel.length) pts.push(`${pointer.x},${pointer.y}`);
    line.setAttribute('points', pts.join(' '));
    preview.classList.remove('shake', 'good', 'bonus');
    preview.textContent = '';
    for (const i of sel) preview.appendChild(el('span', '', snap.letters[i].toUpperCase()));
  }

  const canPlay = () => snap && snap.me && snap.phase === 'playing' && clock.now() >= snap.startAt;

  function svgPoint(ev) {
    const r = wheel.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * 300, y: ((ev.clientY - r.top) / r.height) * 300 };
  }

  function onDown(ev) {
    if (!canPlay()) return;
    ev.preventDefault();
    closeBonus();
    pointer = svgPoint(ev);
    const slot = hitNode(positions, pointer, 36);
    if (slot < 0) return;
    dragging = true;
    try { wheel.setPointerCapture(ev.pointerId); } catch { /* old browser */ }
    sel = [order[slot]];
    sfx.play('blip');
    drawSelection();
  }
  function onMove(ev) {
    if (!dragging) return;
    ev.preventDefault();
    pointer = svgPoint(ev);
    const slot = hitNode(positions, pointer, 30);
    if (slot >= 0) {
      const next = applyDragNode(sel, order[slot]);
      if (next !== sel) { if (next.length > sel.length) sfx.play('blip'); sel = next; }
    }
    drawSelection();
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    pointer = null;
    submit();
  }
  wheel.addEventListener('pointerdown', onDown);
  wheel.addEventListener('pointermove', onMove);
  wheel.addEventListener('pointerup', onUp);
  wheel.addEventListener('pointercancel', onUp);

  function submit() {
    const word = sel.map((i) => snap.letters[i]).join('');
    if (word.length === 0) { drawSelection(); return; }
    if (word.length < 3) {
      if (word.length === 2) reject('Words need 3+ letters');
      else { sel = []; drawSelection(); }
      return;
    }
    // Remember where the preview tiles are so an accepted word can fly into the grid.
    pendingFly = { word, rects: [...preview.children].map((c) => c.getBoundingClientRect()) };
    api.sendAction({ kind: 'submit', word });
    line.setAttribute('points', '');
  }

  function reject(msg) {
    sfx.play('error');
    setStatus(msg, 'bad');
    preview.classList.remove('shake');
    void preview.offsetWidth;
    preview.classList.add('shake');
    later(() => { sel = []; drawSelection(); }, 430);
  }

  function shuffleWheel() {
    if (!snap) return;
    sfx.play('swap');
    const cur = order.slice();
    for (let k = 0; k < 8 && order.join() === cur.join(); k++) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    layoutWheel();
  }
  shuffleBtn.addEventListener('click', shuffleWheel);
  hintBtn.addEventListener('click', () => {
    if (!canPlay()) return;
    if (!snap.me.hintsLeft) { reject('No hints left — find bonus words to earn more'); return; }
    api.sendAction({ kind: 'hint' });
  });
  bonusBtn.addEventListener('click', () => { if (bonusOpen) closeBonus(); else openBonus(); });
  function openBonus() {
    bonusOpen = true;
    renderBonus();
    bonusList.hidden = false;
  }
  function closeBonus() { bonusOpen = false; bonusList.hidden = true; }
  function renderBonus() {
    bonusList.textContent = '';
    const mine = (snap && snap.me && snap.me.bonusWords) || [];
    bonusList.appendChild(el('b', '', `BONUS WORDS ${mine.length}/${snap ? snap.bonusTotal : 0}`));
    bonusList.appendChild(el('div', '', mine.length ? mine.join(' · ').toUpperCase() : 'None yet — any real word from the wheel that is not in the grid counts.'));
    if (snap && snap.missedBonus && snap.missedBonus.length) {
      bonusList.appendChild(el('b', '', 'MISSED'));
      bonusList.appendChild(el('div', '', snap.missedBonus.join(' · ').toUpperCase()));
    }
  }
  bonusList.addEventListener('click', closeBonus);

  function onKey(ev) {
    if (!snap || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (!root.isConnected) return;
    const k = ev.key;
    if (k === ' ') { ev.preventDefault(); shuffleWheel(); return; }
    if (!canPlay() || dragging) return;
    if (k === 'Enter') { ev.preventDefault(); submit(); return; }
    if (k === 'Backspace') { ev.preventDefault(); sel = sel.slice(0, -1); drawSelection(); return; }
    if (k === 'Escape') { sel = []; drawSelection(); return; }
    if (/^[a-zA-Z]$/.test(k)) {
      const i = keyPick(snap.letters, sel, k.toLowerCase());
      if (i < 0) { reject(`No ${k.toUpperCase()} left on the wheel`); return; }
      sel = [...sel, i];
      sfx.play('blip');
      drawSelection();
    }
  }
  window.addEventListener('keydown', onKey);

  // --- status ---
  function baseStatus() {
    if (!snap) return '';
    const left = snap.total - snap.foundCount;
    if (snap.phase === 'complete') {
      if (snap.mode === 'race') {
        const w = snap.players.find((p) => p.clientId === snap.winnerId);
        return w ? (w.clientId === myId() ? 'You won the race! NEXT LEVEL when ready' : `${w.nickname} won the race`) : 'Level over';
      }
      return `Level ${snap.level} complete! Press NEXT LEVEL`;
    }
    if (clock.now() < snap.startAt) return 'Race starting…';
    const modeTxt = snap.mode === 'race' ? 'RACE — first to fill your grid wins' : 'CO-OP — fill the grid together';
    return `${left} word${left === 1 ? '' : 's'} left · ${modeTxt}`;
  }
  function setStatus(msg, cls) {
    status.textContent = msg;
    status.className = `ws-status ${cls || ''}`;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = baseStatus(); status.className = 'ws-status'; }, 1800);
  }

  // --- render ---
  const nameOf = (id) => { const p = snap && snap.players.find((x) => x.clientId === id); return p ? p.nickname : 'someone'; };
  const colorOf = (id) => { const p = snap && snap.players.find((x) => x.clientId === id); return p ? p.color : '#e9f7ea'; };

  let cellPx = 32;
  function sizeGrid() {
    if (!snap) return;
    const w = stage.clientWidth - 20;
    cellPx = fitCell(w, snap.cols, snap.rows, Math.max(150, Math.min(320, window.innerHeight * 0.36)));
    grid.style.gridTemplateColumns = `repeat(${snap.cols}, ${cellPx}px)`;
    grid.style.gridTemplateRows = `repeat(${snap.rows}, ${cellPx}px)`;
    grid.style.fontSize = `${Math.round(cellPx * 0.6)}px`;
  }

  function renderGrid() {
    grid.textContent = '';
    sizeGrid();
    const letters = new Map(snap.cells.map(([r, c, ch, kind]) => [`${r},${c}`, { ch, kind }]));
    const owner = new Map(); // cell -> finder colour (first found slot wins)
    const isFound = new Set();
    snap.slots.forEach((s, i) => {
      for (let k = 0; k < s.len; k++) {
        const key = s.dir === 'v' ? `${s.r + k},${s.c}` : `${s.r},${s.c + k}`;
        if (s.found) { isFound.add(key); if (!owner.has(key) && s.by) owner.set(key, colorOf(s.by)); }
        if (!owner.has(key) && s.found && !s.by) owner.set(key, '#e9f7ea');
        if (!grid.querySelector(`[data-k="${key}"]`)) {
          const d = el('div', 'ws-cell');
          d.dataset.k = key;
          d.style.gridRow = String((s.dir === 'v' ? s.r + k : s.r) + 1);
          d.style.gridColumn = String((s.dir === 'v' ? s.c : s.c + k) + 1);
          grid.appendChild(d);
        }
      }
      void i;
    });
    for (const d of grid.children) {
      const key = d.dataset.k;
      const info = letters.get(key);
      d.className = 'ws-cell';
      d.textContent = info ? info.ch.toUpperCase() : '';
      if (!info) continue;
      if (isFound.has(key)) { d.classList.add('f'); d.style.setProperty('--c', owner.get(key) || '#e9f7ea'); }
      else if (info.kind === 1) d.classList.add('h');
      else if (info.kind === 2) d.classList.add('m');
    }
  }

  const cellEl = (key) => grid.querySelector(`[data-k="${key}"]`);
  const slotKeys = (s) => Array.from({ length: s.len }, (_, k) => (s.dir === 'v' ? `${s.r + k},${s.c}` : `${s.r},${s.c + k}`));

  function animateNewFinds(newSlots, newHints) {
    if (reduced()) return;
    const flySlot = pendingFly && pendingFly.slot != null ? pendingFly.slot : -1;
    newSlots.forEach((i, n) => {
      const keys = slotKeys(snap.slots[i]);
      if (i === flySlot && pendingFly.rects.length === keys.length) {
        flyInto(keys, pendingFly.rects, colorOf(snap.slots[i].by));
      } else {
        keys.forEach((k, j) => { const d = cellEl(k); if (d) { d.style.animationDelay = `${n * 60 + j * 45}ms`; d.classList.add('pop'); } });
      }
    });
    for (const k of newHints) { const d = cellEl(k); if (d) d.classList.add('pop'); }
    pendingFly = null;
  }

  function flyInto(keys, rects, color) {
    keys.forEach((k, j) => {
      const d = cellEl(k);
      if (!d) return;
      const to = d.getBoundingClientRect();
      const from = rects[j];
      d.classList.add('hold');
      const f = el('div', 'ws-fly', d.textContent);
      f.style.left = `${from.left}px`;
      f.style.top = `${from.top}px`;
      f.style.width = `${from.width}px`;
      f.style.height = `${from.height}px`;
      f.style.background = color;
      document.body.appendChild(f);
      const sx = to.width / from.width;
      const sy = to.height / from.height;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        f.style.transitionDelay = `${j * 55}ms`;
        f.style.transform = `translate(${to.left - from.left + (to.width - from.width) / 2}px, ${to.top - from.top + (to.height - from.height) / 2}px) scale(${sx}, ${sy})`;
      }));
      later(() => { f.remove(); d.classList.remove('hold'); d.classList.add('pop'); }, 470 + j * 55);
    });
  }

  function renderPlayers() {
    players.textContent = '';
    const list = snap.players.slice().sort((a, b) => (snap.mode === 'race' ? (b.progress - a.progress) : 0) || b.levelWords - a.levelWords || b.score - a.score);
    for (const p of list) {
      const c = el('div', `ws-chip${p.clientId === myId() ? ' me' : ''}`);
      c.style.setProperty('--c', p.color);
      c.appendChild(el('span', 'dot'));
      c.appendChild(el('span', '', p.nickname));
      if (snap.mode === 'race') {
        const bar = el('span', 'bar');
        const fill = el('i');
        fill.style.width = `${Math.round((100 * (p.progress || 0)) / snap.total)}%`;
        bar.appendChild(fill);
        c.appendChild(bar);
        if (p.raceWins) c.appendChild(el('span', '', `🏆${p.raceWins}`));
      } else {
        c.appendChild(el('span', '', `${p.levelWords}w`));
      }
      c.appendChild(el('span', 'sc', `${p.score}`));
      c.title = `${p.nickname}: ${p.words} words total, ${p.bonusCount} bonus this level, ${p.score} points`;
      players.appendChild(c);
    }
    botBar.update(snap.players.map((p) => ({ clientId: p.clientId, nickname: p.nickname })));
  }

  function renderScene() {
    const sc = sceneFor(snap.level);
    stage.style.background = sc.sky;
    sun.style.background = sc.sun;
    hillPath.setAttribute('fill', sc.hill);
    hillPath2.setAttribute('fill', sc.hill2);
    title.textContent = `WORDSCAPES · LVL ${snap.level} · ${sc.name}`;
  }

  function renderCountdown() {
    clearTimeout(countTimer);
    const left = snap.startAt - clock.now();
    if (snap.phase !== 'playing' || left <= 0) { if (!countEl.hidden) { countEl.hidden = true; sfx.play('go'); status.textContent = baseStatus(); } return; }
    const n = Math.ceil(left / 1000);
    if (countEl.hidden || countEl.textContent !== String(n)) { countEl.textContent = String(n); sfx.play('tick'); }
    countEl.hidden = false;
    countTimer = setTimeout(renderCountdown, Math.min(250, left));
  }

  function renderResults() {
    if (snap.phase !== 'complete') { results.update(null); return; }
    const me = myId();
    const race = snap.mode === 'race';
    const rows = snap.players.slice()
      .sort((a, b) => (race ? (b.clientId === snap.winnerId) - (a.clientId === snap.winnerId) || b.progress - a.progress : b.levelWords - a.levelWords) || b.score - a.score)
      .map((p) => ({
        name: p.nickname,
        value: race ? `${p.progress}/${snap.total}${p.finishMs ? ` · ${(p.finishMs / 1000).toFixed(1)}s` : ''}` : `${p.levelWords} word${p.levelWords === 1 ? '' : 's'} · ${p.score} pts`,
        win: race ? p.clientId === snap.winnerId : false,
        you: p.clientId === me,
      }));
    const won = race ? snap.winnerId === me : true;
    const mine = snap.me ? snap.me.bonusWords.length : 0;
    results.update({
      title: race ? (won ? 'YOU WIN THE RACE!' : `${nameOf(snap.winnerId)} WINS`) : `LEVEL ${snap.level} CLEAR!`,
      subtitle: `${snap.total} words · ${mine}/${snap.bonusTotal} bonus words found by you`,
      outcome: race ? (snap.me ? (won ? 'win' : 'lose') : 'over') : 'win',
      rows,
      rematch: { label: 'NEXT LEVEL ▶', onClick: () => api.sendAction({ kind: 'nextLevel' }) },
    });
  }

  function render() {
    const puzzleChanged = lastPuzzle !== snap.puzzleId;
    if (puzzleChanged) {
      results.update(null);
      lastPuzzle = snap.puzzleId;
      sel = [];
      pendingFly = null;
      prevFound = new Set();
      prevHint = new Set();
      closeBonus();
    }
    const key = `${snap.puzzleId}:${snap.letters}`;
    if (key !== orderKey) {
      orderKey = key;
      order = snap.letters.split('').map((_, i) => i);
      buildWheel();
    }
    coopBtn.classList.toggle('on', snap.mode === 'coop');
    raceBtn.classList.toggle('on', snap.mode === 'race');
    renderScene();
    renderGrid();
    const found = new Set(snap.slots.map((s, i) => (s.found ? i : -1)).filter((i) => i >= 0));
    const hints = new Set(snap.cells.filter((c) => c[3] === 1).map(([r, c]) => `${r},${c}`));
    if (!puzzleChanged) animateNewFinds([...found].filter((i) => !prevFound.has(i)), [...hints].filter((k) => !prevHint.has(k)));
    prevFound = found;
    prevHint = hints;
    hintN.textContent = snap.me ? String(snap.me.hintsLeft) : '0';
    bonusN.textContent = snap.me ? String(snap.me.bonusWords.length) : '0';
    if (bonusOpen) renderBonus();
    wheel.classList.toggle('off', !snap.me || snap.phase !== 'playing');
    renderPlayers();
    if (!status.className.includes('bad') && !status.className.includes('good')) status.textContent = baseStatus();
    renderCountdown();
    renderResults();
    if (snap.phase !== 'playing') { sel = []; dragging = false; drawSelection(); }
  }

  function onResult(d) {
    const word = (d.word || '').toUpperCase();
    if (d.outcome === 'found') {
      if (pendingFly) pendingFly.slot = d.slot;
      sfx.play('chime');
      setStatus(`${word} ✓`, 'good');
      preview.classList.add('good');
      later(() => { sel = []; drawSelection(); }, 350);
    } else if (d.outcome === 'bonus') {
      pendingFly = null;
      sfx.play('pop');
      setStatus(`BONUS WORD ${word} +1`, 'good');
      preview.classList.add('bonus');
      bonusBtn.classList.remove('pulse');
      void bonusBtn.offsetWidth;
      bonusBtn.classList.add('pulse');
      later(() => { sel = []; drawSelection(); }, 450);
    } else {
      pendingFly = null;
      if (d.outcome === 'already') {
        const s = snap && snap.slots[d.slot];
        if (s) slotKeys(s).forEach((k) => { const c = cellEl(k); if (c) { c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); } });
        reject(`${word} is already in the grid`);
      } else if (d.outcome === 'alreadyBonus') reject(`${word} — bonus word already found`);
      else if (d.outcome === 'short') reject('Words need 3+ letters');
      else if (d.outcome === 'early') reject('Wait for GO!');
      else if (d.outcome === 'closed') { sel = []; drawSelection(); }
      else reject(`${word} is not a word`);
    }
  }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => sizeGrid()) : null;
  if (ro) ro.observe(stage);

  return {
    applySnapshot(s) {
      if (!s) return;
      snap = s;
      clock.sync(s.serverNow);
      render();
    },
    applyEvent(d) {
      if (!d) return;
      if (d.kind === 'state') { snap = d; clock.sync(d.serverNow); render(); return; }
      if (d.kind === 'result') { onResult(d); return; }
      if (d.kind === 'hintResult') {
        if (d.cell) { sfx.play('select'); setStatus('Hint: a letter is revealed (−2)', 'good'); }
        else reject('No hint available');
        return;
      }
      if (d.kind === 'found' && d.clientId !== myId() && snap) {
        if (d.bonus) return;
        if (snap.mode === 'coop' && d.word) { sfx.play('point'); setStatus(`${nameOf(d.clientId)} found ${d.word.toUpperCase()}`); }
        else if (snap.mode === 'race') sfx.play('tick');
      }
    },
    applyRoster() { /* players come from game state */ },
    unmount() {
      window.removeEventListener('keydown', onKey);
      if (ro) ro.disconnect();
      clearTimeout(statusTimer);
      clearTimeout(countTimer);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      document.querySelectorAll('.ws-fly').forEach((f) => f.remove());
      results.destroy();
      root.remove();
    },
  };
}
