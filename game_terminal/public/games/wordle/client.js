// Wordle — everyone gets the same hidden five-letter word and six guesses. Type (or tap the
// keyboard) and press ENTER; green = right spot, yellow = in the word elsewhere, grey = not in it.
// Fewest guesses wins. Other players' colours show live, their letters only once the round ends.
// Server plugin: ../../../server/games/wordle.js (checks words and marks guesses).
import { sfx } from '../sfx.js';
import { createResults } from '../resultsPanel.js';

const CSS = `
.wd-root { display: flex; flex-direction: column; gap: 10px; }
.wd-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.wd-status { font-weight: bold; }
.wd-body { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; justify-content: center; }
.wd-play { display: flex; flex-direction: column; align-items: center; gap: 12px; flex: 1 1 340px; max-width: 520px; }
.wd-grid { display: grid; grid-template-rows: repeat(6, 1fr); gap: 6px; }
.wd-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.wd-row.bad { animation: wd-shake .35s ease-in-out; }
@keyframes wd-shake { 20% { transform: translateX(-8px); } 40% { transform: translateX(7px); } 60% { transform: translateX(-5px); } 80% { transform: translateX(3px); } }
.wd-tile { width: 58px; height: 58px; display: flex; align-items: center; justify-content: center; font-size: 2em; font-weight: bold;
  text-transform: uppercase; border: 2px solid rgba(57,255,20,.22); color: #d8ffd0; box-sizing: border-box; user-select: none; }
.wd-tile.typed { border-color: rgba(57,255,20,.7); animation: wd-pop .1s ease-out; }
@keyframes wd-pop { from { transform: scale(1.12); } }
.wd-tile.g, .wd-tile.y, .wd-tile.x { border-color: transparent; color: #fff; animation: wd-flip .45s ease-in backwards; }
.wd-tile.g { background: #2e9e2a; }
.wd-tile.y { background: #b8901c; }
.wd-tile.x { background: #2b332b; color: #9aa59a; }
@keyframes wd-flip { 0% { transform: rotateX(0); background: transparent; } 50% { transform: rotateX(90deg); background: transparent; } }
.wd-keys { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.wd-krow { display: flex; gap: 5px; justify-content: center; }
.wd-key { flex: 1 1 0; max-width: 44px; height: 52px; padding: 0; font: inherit; font-weight: bold; font-size: 1.05em; text-transform: uppercase;
  border: 0; border-radius: 5px; background: #3a4a3a; color: #e8ffe0; cursor: pointer; touch-action: manipulation; }
.wd-key.wide { max-width: 70px; flex-grow: 1.6; font-size: .8em; }
.wd-key:hover { filter: brightness(1.25); background: #3a4a3a; color: #e8ffe0; }
.wd-key.g, .wd-key.g:hover { background: #2e9e2a; color: #fff; }
.wd-key.y, .wd-key.y:hover { background: #b8901c; color: #fff; }
.wd-key.x, .wd-key.x:hover { background: #1a1f1a; color: #5e6a5e; }
.wd-toast { min-height: 1.3em; color: #ffb000; text-align: center; }
.wd-side { flex: 0 1 230px; min-width: 200px; display: flex; flex-direction: column; gap: 6px; }
.wd-side b { color: #ffb000; letter-spacing: 1px; }
.wd-pl { display: flex; gap: 8px; align-items: center; padding: 4px 6px; border: 1px solid rgba(57,255,20,.15); border-radius: 4px; }
.wd-pl.you { box-shadow: inset 3px 0 0 #39ff14; }
.wd-pl-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .9em; }
.wd-pl-meta { font-size: .76em; opacity: .75; white-space: nowrap; }
.wd-mini { display: grid; grid-template-columns: repeat(5, 8px); gap: 2px; }
.wd-mini i { width: 8px; height: 8px; background: rgba(57,255,20,.1); }
.wd-mini i.g { background: #2e9e2a; } .wd-mini i.y { background: #b8901c; } .wd-mini i.x { background: #3a423a; }
@media (max-width: 520px) { .wd-tile { width: 48px; height: 48px; font-size: 1.6em; } .wd-key { height: 46px; } }
@media (prefers-reduced-motion: reduce) { .wd-tile, .wd-row.bad { animation: none !important; } }
`;

let styled = false;
function ensureStyles() {
  if (styled) return;
  styled = true;
  const tag = document.createElement('style');
  tag.textContent = CSS;
  document.head.appendChild(tag);
}
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const KEYS = ['qwertyuiop', 'asdfghjkl', '+zxcvbnm-'];
const RANK = { x: 1, y: 2, g: 3 };

export function mount(container, api) {
  ensureStyles();
  const results = createResults(container);
  let view = null;
  let typed = '';
  let roundSeen = -1;
  let shownGuesses = 0; // only rows that arrive after this animate their flip
  let toastTimer = null;

  const root = el('div', 'wd-root');
  const top = el('div', 'wd-top');
  const statusEl = el('div', 'wd-status', 'Loading…');
  const startBtn = el('button', null, 'START');
  startBtn.addEventListener('click', () => { sfx.play('select'); api.sendAction({ kind: 'start' }); });
  top.append(statusEl, startBtn);
  const body = el('div', 'wd-body');
  const play = el('div', 'wd-play');
  const grid = el('div', 'wd-grid');
  const toastEl = el('div', 'wd-toast');
  const keys = el('div', 'wd-keys');
  const side = el('div', 'wd-side');
  play.append(grid, toastEl, keys);
  body.append(play, side);
  root.append(top, body);
  container.appendChild(root);

  const me = () => view && view.players.find((p) => p.clientId === api.getClientId());
  const canType = () => view && view.phase === 'playing' && me() && me().inRound && !me().done;

  function toast(text) {
    toastEl.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.textContent = ''; }, 1800);
  }

  function press(k) {
    if (!canType()) return;
    if (k === 'enter') {
      if (typed.length < 5) { toast('Five letters, please'); shake(); sfx.play('error'); return; }
      api.sendAction({ kind: 'guess', guess: typed });
      return;
    }
    if (k === 'back') typed = typed.slice(0, -1);
    else if (typed.length < 5) typed += k;
    renderGrid();
  }
  function shake() {
    const row = grid.children[view.myGuesses.length];
    if (!row) return;
    row.classList.remove('bad');
    void row.offsetWidth; // restart the animation
    row.classList.add('bad');
  }

  function renderGrid() {
    const guesses = view ? view.myGuesses : [];
    const rows = view ? view.maxGuesses : 6;
    grid.replaceChildren(...Array.from({ length: rows }, (_, r) => {
      const row = el('div', 'wd-row');
      const g = guesses[r];
      for (let i = 0; i < 5; i++) {
        const t = el('div', 'wd-tile');
        if (g) {
          t.textContent = g.guess[i];
          t.classList.add(g.mark[i]);
          if (r >= shownGuesses) t.style.animationDelay = `${i * 0.18}s`;
          else t.style.animation = 'none';
        } else if (r === guesses.length && canType() && typed[i]) {
          t.textContent = typed[i];
          t.classList.add('typed');
        }
        row.appendChild(t);
      }
      return row;
    }));
    shownGuesses = guesses.length;
  }

  function renderKeys() {
    const best = {};
    for (const g of view ? view.myGuesses : []) {
      for (let i = 0; i < 5; i++) if ((RANK[g.mark[i]] || 0) > (RANK[best[g.guess[i]]] || 0)) best[g.guess[i]] = g.mark[i];
    }
    keys.replaceChildren(...KEYS.map((row) => {
      const r = el('div', 'wd-krow');
      for (const ch of row) {
        const k = ch === '+' ? 'enter' : ch === '-' ? 'back' : ch;
        const b = el('button', `wd-key${k.length > 1 ? ' wide' : ''}${best[k] ? ` ${best[k]}` : ''}`, k === 'enter' ? 'ENTER' : k === 'back' ? '⌫' : ch);
        b.type = 'button';
        b.addEventListener('click', () => press(k));
        r.appendChild(b);
      }
      return r;
    }));
  }

  function renderSide() {
    const meId = api.getClientId();
    side.replaceChildren(el('b', null, 'PLAYERS'), ...view.players.map((p) => {
      const row = el('div', `wd-pl${p.clientId === meId ? ' you' : ''}`);
      const mini = el('div', 'wd-mini');
      for (let r = 0; r < view.maxGuesses; r++) for (let i = 0; i < 5; i++) mini.appendChild(el('i', p.guesses[r] ? p.guesses[r].mark[i] : ''));
      const name = el('span', 'wd-pl-name', p.nickname);
      name.style.color = p.color;
      const meta = !p.inRound ? 'next round' : p.solved ? `✓ in ${p.count}` : p.done ? '✗ out' : `${p.count}/${view.maxGuesses}`;
      row.append(mini, name, el('span', 'wd-pl-meta', `${meta}${p.wins ? ` · ${p.wins}W` : ''}`));
      return row;
    }));
  }

  function renderTop() {
    const m = me();
    startBtn.hidden = view.phase === 'playing';
    startBtn.textContent = view.phase === 'waiting' ? 'START' : 'NEW WORD';
    if (view.phase === 'waiting') statusEl.textContent = 'Press START for a word. Everyone in the room gets the same one.';
    else if (view.phase === 'results') statusEl.textContent = `The word was ${String(view.answer).toUpperCase()}`;
    else if (m && !m.inRound) statusEl.textContent = 'Round in progress. You\'re in the next one.';
    else if (m && m.done) statusEl.textContent = m.solved ? `Solved in ${m.count}! Waiting for the others…` : 'Out of guesses. Waiting for the others…';
    else statusEl.textContent = `Guess ${(m ? m.count : 0) + 1} of ${view.maxGuesses}`;
  }

  function renderResults() {
    if (view.phase !== 'results') { results.update(null); return; }
    const meId = api.getClientId();
    const players = view.players.filter((p) => p.inRound)
      .sort((a, b) => (a.solved ? a.count : 99) - (b.solved ? b.count : 99) || (a.finishedAt || 0) - (b.finishedAt || 0));
    const top = players[0];
    const mine = players.find((p) => p.clientId === meId);
    const won = mine && mine.solved && mine === top; // ties on guesses go to whoever finished first
    results.update({
      title: mine && mine.solved ? (players.length > 1 ? (won ? 'YOU WIN' : `SOLVED IN ${mine.count}`) : ['GENIUS', 'MAGNIFICENT', 'IMPRESSIVE', 'SPLENDID', 'GREAT', 'PHEW'][mine.count - 1]) : 'OUT OF GUESSES',
      subtitle: `The word was ${String(view.answer).toUpperCase()}`,
      outcome: won ? 'win' : mine && mine.solved ? 'over' : 'lose',
      rows: players.map((p) => ({ name: p.nickname, value: p.solved ? `${p.count}/${view.maxGuesses}` : 'X', win: p === top && p.solved, you: p.clientId === meId })),
      rematch: { label: 'NEW WORD', onClick: () => api.sendAction({ kind: 'start' }) },
    });
  }

  function onState(data) {
    const prev = view;
    view = data;
    if (view.roundId !== roundSeen) { roundSeen = view.roundId; typed = ''; shownGuesses = 0; }
    const before = prev ? prev.myGuesses.length : view.myGuesses.length;
    if (!prev) shownGuesses = view.myGuesses.length; // joining/reconnecting: no flip replay
    if (view.myGuesses.length > before) {
      typed = '';
      const last = view.myGuesses[view.myGuesses.length - 1];
      setTimeout(() => sfx.play(last.mark === 'ggggg' ? 'win' : 'point'), 900);
    }
    if (prev && prev.phase === 'playing' && view.phase === 'results' && me() && !me().solved) sfx.play('lose');
    renderTop();
    renderGrid();
    renderKeys();
    renderSide();
    // Let the last row finish flipping before the results card covers it.
    if (view.phase === 'results' && prev && prev.phase === 'playing') setTimeout(() => view && renderResults(), 1500);
    else renderResults();
  }

  function onKey(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || !canType()) return;
    if (e.key === 'Enter') { e.preventDefault(); press('enter'); } else if (e.key === 'Backspace') { e.preventDefault(); press('back'); } else if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); press(e.key.toLowerCase()); }
  }
  window.addEventListener('keydown', onKey);

  return {
    applySnapshot(snapshot) { if (snapshot) onState(snapshot); },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') onState(data);
      else if (data.kind === 'error') { toast(data.error); shake(); sfx.play('error'); }
    },
    applyRoster() { /* names come from the server's player list */ },
    unmount() {
      clearTimeout(toastTimer);
      window.removeEventListener('keydown', onKey);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
