// Anagrams — everyone gets the same six letters and 60 seconds to make as many 3-6 letter words
// as they can. Tap the tiles (or type) to spell a word, ENTER to submit, SPACE to shuffle,
// BACKSPACE to undo a letter, ESC to clear. 3 letters = 100, 4 = 400, 5 = 1200, 6 = 2000.
// Server plugin: ../../../server/games/anagrams.js (checks words; keeps other players' words and
// the answer list hidden until the round is over).
import { sfx } from '../sfx.js';
import { createBotBar } from '../tickBots.js';
import { createResults } from '../resultsPanel.js';
import { makeServerClock } from '../serverClock.js';

const CSS = `
.an-root { display: flex; flex-direction: column; gap: 8px; }
.an-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.an-status { font-weight: bold; }
.an-timer { font-size: 1.5em; font-weight: bold; letter-spacing: 1px; color: #39ff14; font-variant-numeric: tabular-nums; }
.an-timer.low { color: #ff4d4d; animation: an-blink 1s steps(2) infinite; }
@keyframes an-blink { 50% { opacity: .55; } }
.an-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.an-start { font-weight: bold; }
.an-body { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
.an-stage { position: relative; flex: 1 1 480px; max-width: 660px; border: 1px solid var(--border, #1f8f0c); border-radius: 8px;
  padding: 14px 12px 16px; display: flex; flex-direction: column; align-items: center; gap: 14px; overflow: hidden;
  background: radial-gradient(ellipse at 50% 0%, #1b2a12, #070b05 70%); box-shadow: inset 0 0 40px -14px #39ff14; }
.an-scoreline { display: flex; gap: 18px; align-items: baseline; justify-content: center; width: 100%; }
.an-score { font-size: 2em; font-weight: bold; color: #ffd23f; text-shadow: 0 0 12px rgba(255,210,63,.5); font-variant-numeric: tabular-nums; min-width: 3ch; text-align: center; }
.an-score.bump { animation: an-bump .35s cubic-bezier(.2,1.6,.4,1); }
@keyframes an-bump { 0% { transform: scale(1.35); } }
.an-sublabel { font-size: .8em; opacity: .75; }
.an-tray { display: flex; gap: 6px; min-height: 74px; }
.an-slot { width: 66px; height: 74px; border-radius: 9px; border: 2px dashed rgba(57,255,20,.25); display: flex; align-items: center; justify-content: center;
  font-size: 2.4em; font-weight: bold; color: #1c1206; cursor: pointer; user-select: none; }
.an-slot.full { border: 0; background: linear-gradient(180deg, #ffe7b0, #e7bf73); box-shadow: 0 3px 0 #9c7434, 0 0 12px -2px rgba(255,210,63,.6);
  animation: an-drop .16s ease-out; }
@keyframes an-drop { from { transform: translateY(-14px) scale(.8); opacity: .3; } }
.an-tray.good .an-slot.full { background: linear-gradient(180deg, #c8ffb8, #6fdc56); box-shadow: 0 3px 0 #2e7d1e, 0 0 16px #39ff14; }
.an-tray.dupe .an-slot.full { background: linear-gradient(180deg, #fff3b0, #e8d067); box-shadow: 0 3px 0 #9a8a2a; }
.an-tray.bad { animation: an-shake .35s ease-in-out; }
.an-tray.bad .an-slot.full { background: linear-gradient(180deg, #ffc4c4, #e57373); box-shadow: 0 3px 0 #8a2b2b; }
@keyframes an-shake { 20% { transform: translateX(-8px); } 40% { transform: translateX(7px); } 60% { transform: translateX(-5px); } 80% { transform: translateX(3px); } }
.an-tiles { display: flex; gap: 10px; flex-wrap: nowrap; }
.an-tile { width: 80px; height: 86px; border-radius: 12px; border: 0; padding: 0; font: inherit; font-size: 2.8em; font-weight: bold; color: #1c1206; cursor: pointer;
  background: linear-gradient(180deg, #fff1cf, #e3b866); box-shadow: 0 4px 0 #9c7434, 0 6px 14px -4px rgba(0,0,0,.7);
  transition: transform .08s, opacity .12s, box-shadow .08s; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
.an-tile:hover:not(:disabled) { transform: translateY(-2px); }
.an-tile:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 1px 0 #9c7434; }
.an-tile:disabled { opacity: .18; cursor: default; transform: scale(.9); }
.an-tiles.shuffling .an-tile { animation: an-spin .3s ease-in-out; }
@keyframes an-spin { 50% { transform: scale(.75) rotate(8deg); } }
.an-actions { display: flex; gap: 8px; }
.an-actions button { min-width: 82px; font-weight: bold; }
.an-enter { background: #39ff14; color: #041004; }
.an-enter:disabled { background: transparent; color: inherit; }
.an-float { position: absolute; left: 50%; top: 92px; transform: translateX(-50%); font-size: 1.5em; font-weight: bold; pointer-events: none;
  text-shadow: 0 0 10px currentColor; animation: an-float 1s ease-out forwards; white-space: nowrap; }
@keyframes an-float { to { transform: translate(-50%, -46px); opacity: 0; } }
.an-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  background: rgba(3,6,3,.82); z-index: 2; text-align: center; padding: 12px; }
.an-overlay[hidden] { display: none; }
.an-count { font-size: 4em; font-weight: bold; color: #ffd23f; text-shadow: 0 0 24px rgba(255,210,63,.7); animation: an-bump .5s cubic-bezier(.2,1.6,.4,1); }
.an-help { font-size: .82em; opacity: .8; max-width: 300px; line-height: 1.5; }
.an-side { flex: 1; min-width: 210px; display: flex; flex-direction: column; gap: 10px; }
.an-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid var(--border, #1f8f0c); padding-bottom: 3px; }
.an-head b { letter-spacing: 1px; color: #ffb000; }
.an-head span { font-size: .82em; opacity: .8; }
.an-words { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto; }
.an-group { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.an-glabel { font-size: .72em; opacity: .65; width: 100%; }
.an-chip { padding: 1px 7px; border-radius: 10px; font-size: .86em; letter-spacing: 1.5px; border: 1px solid rgba(57,255,20,.35); background: rgba(57,255,20,.07); }
.an-chip.fresh { animation: an-bump .4s cubic-bezier(.2,1.6,.4,1); background: rgba(57,255,20,.3); }
.an-chip.missed { border-color: rgba(255,138,138,.35); background: transparent; color: #ff9a9a; opacity: .85; }
.an-chip.long { border-color: rgba(255,210,63,.6); color: #ffd23f; }
.an-empty { font-size: .82em; opacity: .55; }
.an-scores { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.an-sc { display: flex; align-items: center; gap: 8px; padding: 3px 6px; border-radius: 4px; border: 1px solid rgba(57,255,20,.15); font-size: .88em; }
.an-sc.lead { border-color: rgba(255,210,63,.6); background: rgba(255,210,63,.08); }
.an-sc.you { box-shadow: inset 3px 0 0 #39ff14; }
.an-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; box-shadow: 0 0 6px currentColor; }
.an-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-pts { font-weight: bold; font-variant-numeric: tabular-nums; }
.an-meta { font-size: .76em; opacity: .7; white-space: nowrap; }
.an-toast { min-height: 1.3em; font-size: .9em; text-align: center; color: #ffb000; }
.an-hint { font-size: .8em; opacity: .7; margin: 0; }
@media (max-width: 520px) {
  .an-tile { width: 44px; height: 50px; font-size: 1.55em; }
  .an-slot { width: 38px; height: 44px; font-size: 1.35em; }
  .an-tiles, .an-tray { gap: 5px; }
}
@media (prefers-reduced-motion: reduce) {
  .an-timer.low, .an-score.bump, .an-slot.full, .an-tray.bad, .an-tiles.shuffling .an-tile, .an-chip.fresh, .an-count { animation: none; }
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

const POINTS = { 3: 100, 4: 400, 5: 1200, 6: 2000 };
const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const shuffled = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export function mount(container, api) {
  ensureStyles();
  const clock = makeServerClock();
  const results = createResults(container);
  const botBar = createBotBar(api);

  const root = el('div', 'an-root');
  const top = el('div', 'an-top');
  const statusEl = el('div', 'an-status', 'Loading…');
  const timerEl = el('div', 'an-timer');
  top.append(statusEl, timerEl);

  const controls = el('div', 'an-controls');
  const startBtn = el('button', 'an-start', 'START ROUND');
  startBtn.addEventListener('click', () => { sfx.play('select'); api.sendAction({ kind: 'start' }); });
  controls.append(startBtn, botBar.el);

  const body = el('div', 'an-body');
  const stage = el('div', 'an-stage');
  const scoreline = el('div', 'an-scoreline');
  const scoreEl = el('div', 'an-score', '0');
  const countEl = el('div', 'an-sublabel', '0 words');
  scoreline.append(scoreEl, countEl);
  const tray = el('div', 'an-tray');
  const tilesEl = el('div', 'an-tiles');
  const actions = el('div', 'an-actions');
  const shuffleBtn = el('button', '', '⟲ SHUFFLE');
  const backBtn = el('button', '', '⌫');
  const enterBtn = el('button', 'an-enter', 'ENTER');
  shuffleBtn.title = 'Shuffle (Space)';
  backBtn.title = 'Delete letter (Backspace) — Esc clears';
  enterBtn.title = 'Submit (Enter)';
  actions.append(shuffleBtn, backBtn, enterBtn);
  const toastEl = el('div', 'an-toast');
  const overlay = el('div', 'an-overlay');
  stage.append(scoreline, tray, tilesEl, actions, toastEl, overlay);

  const side = el('div', 'an-side');
  const wordsHead = el('div', 'an-head');
  const wordsTitle = el('b', '', 'YOUR WORDS');
  const wordsMeta = el('span');
  wordsHead.append(wordsTitle, wordsMeta);
  const wordsEl = el('div', 'an-words');
  const scoresHead = el('div', 'an-head');
  scoresHead.append(el('b', '', 'SCORES'), el('span', '', 'pts · words · wins'));
  const scoresEl = el('ul', 'an-scores');
  const hint = el('p', 'an-hint', 'Type or tap letters · ENTER submits · SPACE shuffles · ⌫ undoes · ESC clears. 3 letters = 100, 4 = 400, 5 = 1200, 6 = 2000.');
  side.append(wordsHead, wordsEl, scoresHead, scoresEl, hint);
  body.append(stage, side);
  root.append(top, controls, body);
  container.appendChild(root);

  let view = null;
  let roundSeen = null;
  let order = [0, 1, 2, 3, 4, 5]; // display order of the letter indices (client-side shuffle)
  let picked = []; // letter indices in the word being built
  let freshWord = null;
  let toastTimer = null;
  let trayTimer = null;
  let rafId = 0;
  let lastSecond = null;

  const myId = () => api.getClientId();
  const letters = () => (view && view.letters) || '';
  const canPlay = () => view && view.phase === 'playing' && view.letters
    && clock.now() >= view.startedAt && clock.now() < view.endsAt;
  const currentWord = () => picked.map((i) => letters()[i]).join('');

  function toast(text, color = '#ffb000') {
    toastEl.textContent = text;
    toastEl.style.color = color;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.textContent = ''; }, 1800);
  }
  function flashTray(cls, ms = 380) {
    tray.classList.remove('good', 'bad', 'dupe');
    void tray.offsetWidth; // restart the animation
    tray.classList.add(cls);
    clearTimeout(trayTimer);
    trayTimer = setTimeout(() => { tray.classList.remove(cls); picked = []; renderBoard(); }, ms);
  }
  function floatText(text, color) {
    const f = el('div', 'an-float', text);
    f.style.color = color;
    stage.appendChild(f);
    setTimeout(() => f.remove(), 1000);
  }

  function pick(i) {
    if (!canPlay() || picked.includes(i) || picked.length >= letters().length) return;
    if (trayTimer) { clearTimeout(trayTimer); trayTimer = null; tray.classList.remove('good', 'bad', 'dupe'); picked = []; }
    picked.push(i);
    sfx.play('blip');
    renderBoard();
  }
  function backspace() {
    if (!picked.length) return;
    picked.pop();
    sfx.play('click');
    renderBoard();
  }
  function clearWord() {
    if (!picked.length) return;
    picked = [];
    renderBoard();
  }
  function shuffleTiles() {
    if (!view || !view.letters) return;
    order = shuffled(order);
    tilesEl.classList.remove('shuffling');
    void tilesEl.offsetWidth;
    tilesEl.classList.add('shuffling');
    sfx.play('swap');
    renderBoard();
  }
  function submit() {
    if (!canPlay()) return;
    const word = currentWord();
    if (word.length < 3) {
      if (word.length) { toast('Words need at least 3 letters'); sfx.play('error'); flashTray('bad'); }
      return;
    }
    if (view.myWords.includes(word)) {
      toast(`Already have ${word.toUpperCase()}`);
      sfx.play('error');
      flashTray('dupe');
      return;
    }
    api.sendAction({ kind: 'submit', word });
    // Keep the letters in the tray until the server answers (flashTray clears them).
    trayTimer = setTimeout(() => { trayTimer = null; picked = []; renderBoard(); }, 1500);
  }

  shuffleBtn.addEventListener('click', shuffleTiles);
  backBtn.addEventListener('click', backspace);
  enterBtn.addEventListener('click', submit);

  function onKey(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!view || view.phase !== 'playing') return;
    const k = e.key;
    if (k === 'Enter') { e.preventDefault(); submit(); return; }
    if (k === 'Backspace') { e.preventDefault(); backspace(); return; }
    if (k === 'Escape') { clearWord(); return; }
    if (k === ' ') { e.preventDefault(); shuffleTiles(); return; }
    if (/^[a-zA-Z]$/.test(k)) {
      const ch = k.toLowerCase();
      // First unused tile with that letter, in the order shown on screen.
      const i = order.find((idx) => letters()[idx] === ch && !picked.includes(idx));
      if (i === undefined) { if (canPlay()) sfx.play('error'); return; }
      e.preventDefault();
      pick(i);
    }
  }
  window.addEventListener('keydown', onKey);

  function renderBoard() {
    const L = letters();
    const playing = canPlay();
    tray.textContent = '';
    for (let s = 0; s < Math.max(6, L.length); s++) {
      const slot = el('div', 'an-slot');
      if (s < picked.length) {
        slot.classList.add('full');
        slot.textContent = L[picked[s]].toUpperCase();
        // Tap a tray letter to take it (and anything after it) back.
        slot.addEventListener('click', () => { if (trayTimer) return; picked = picked.slice(0, s); sfx.play('click'); renderBoard(); });
      }
      tray.appendChild(slot);
    }
    tilesEl.textContent = '';
    for (const idx of order) {
      const b = el('button', 'an-tile', L ? L[idx].toUpperCase() : '?');
      b.disabled = !playing || picked.includes(idx);
      b.addEventListener('click', () => pick(idx));
      tilesEl.appendChild(b);
    }
    const word = picked.length;
    enterBtn.disabled = !playing || word < 3;
    backBtn.disabled = !playing || !word;
    shuffleBtn.disabled = !L;
  }

  function renderOverlay() {
    overlay.textContent = '';
    const now = clock.now();
    if (!view || view.phase === 'waiting' || !view.letters) {
      overlay.hidden = false;
      overlay.append(el('div', 'an-count', '🔤'), el('div', '', 'ANAGRAMS'),
        el('div', 'an-help', 'Six letters, 60 seconds. Make as many words as you can — longer words score far more. Press START ROUND' + (api.daily ? ': one try at today\'s letters.' : ' (add a bot to play against the computer).')));
      return;
    }
    if (view.phase === 'playing' && now < view.startedAt) {
      overlay.hidden = false;
      overlay.append(el('div', 'an-count', String(Math.ceil((view.startedAt - now) / 1000))), el('div', '', 'GET READY'));
      return;
    }
    overlay.hidden = true;
  }

  function renderStatus() {
    if (!view) return;
    const now = clock.now();
    startBtn.hidden = view.phase === 'playing';
    startBtn.textContent = view.phase === 'results' ? 'NEW ROUND' : 'START ROUND';
    if (view.phase === 'waiting') statusEl.textContent = 'Waiting to start…';
    else if (view.phase === 'playing') statusEl.textContent = now < view.startedAt ? 'Get ready…' : `${view.totalWords} words hide in these letters`;
    else statusEl.textContent = `Round over — the 6-letter word was ${String(view.base || '').toUpperCase()}`;
    const me = view.players.find((p) => p.clientId === myId());
    const score = me ? me.score : 0;
    if (scoreEl.textContent !== String(score)) {
      scoreEl.textContent = String(score);
      scoreEl.classList.remove('bump');
      void scoreEl.offsetWidth;
      scoreEl.classList.add('bump');
    }
    const n = view.myWords.length;
    countEl.textContent = `${n} word${n === 1 ? '' : 's'}`;
  }

  function renderWords() {
    wordsEl.textContent = '';
    if (!view) return;
    const mine = new Set(view.myWords);
    const over = view.phase === 'results' && view.answers;
    wordsTitle.textContent = over ? 'ALL WORDS' : 'YOUR WORDS';
    wordsMeta.textContent = over ? `you found ${mine.size} of ${view.answers.length}` : `${mine.size} found`;
    const list = over ? view.answers : view.myWords;
    if (!list.length) { wordsEl.appendChild(el('div', 'an-empty', 'No words yet.')); return; }
    for (const len of [6, 5, 4, 3]) {
      const ws = list.filter((w) => w.length === len).sort();
      if (!ws.length) continue;
      const g = el('div', 'an-group');
      g.appendChild(el('div', 'an-glabel', `${len} LETTERS · ${POINTS[len]} each`));
      for (const w of ws) {
        const chip = el('span', 'an-chip', w.toUpperCase());
        if (over && !mine.has(w)) chip.classList.add('missed');
        if (len >= 5 && mine.has(w)) chip.classList.add('long');
        if (w === freshWord) chip.classList.add('fresh');
        g.appendChild(chip);
      }
      wordsEl.appendChild(g);
    }
  }

  function renderScores() {
    scoresEl.textContent = '';
    if (!view) return;
    const players = view.players.slice().sort((a, b) => b.score - a.score || b.wins - a.wins);
    const topScore = players.length ? players[0].score : 0;
    for (const p of players) {
      const li = el('li', 'an-sc');
      if (topScore > 0 && p.score === topScore) li.classList.add('lead');
      if (p.clientId === myId()) li.classList.add('you');
      const dot = el('span', 'an-dot');
      dot.style.background = p.color;
      dot.style.color = p.color;
      li.append(dot, el('span', 'an-name', p.clientId === myId() ? `${p.nickname} (you)` : p.nickname),
        el('span', 'an-pts', String(p.score)), el('span', 'an-meta', `${p.count}w · ${p.wins}🏆`));
      scoresEl.appendChild(li);
    }
  }

  function renderResults() {
    if (!view || view.phase !== 'results') { results.update(null); return; }
    const me = myId();
    const players = view.players.filter((p) => p.inRound).sort((a, b) => b.score - a.score);
    const topScore = players.length ? players[0].score : 0;
    const mine = players.find((p) => p.clientId === me);
    const solo = players.length <= 1;
    let outcome = 'over';
    let title = "TIME'S UP";
    if (mine && !solo) {
      const iWon = topScore > 0 && mine.score === topScore;
      outcome = iWon ? 'win' : 'lose';
      title = iWon ? (players.filter((p) => p.score === topScore).length > 1 ? 'TIED FOR FIRST!' : 'YOU WIN!') : 'YOU LOSE';
    } else if (mine && solo) {
      outcome = mine.score > 0 ? 'win' : 'lose';
    }
    results.update({
      title,
      subtitle: `${String(view.base || '').toUpperCase()} · ${view.answers ? view.answers.length : 0} possible words`,
      outcome,
      rows: players.map((p) => {
        const best = (p.words || []).reduce((b, w) => (w.length > b.length ? w : b), '');
        return {
          name: p.nickname,
          value: `${p.score} · ${p.count}w${best ? ` · ${best.toUpperCase()}` : ''}`,
          win: topScore > 0 && p.score === topScore,
          you: p.clientId === me,
        };
      }),
      rematch: { label: 'NEW ROUND', onClick: () => api.sendAction({ kind: 'start' }) },
    });
  }

  function frame() {
    rafId = requestAnimationFrame(frame);
    if (!view) return;
    const now = clock.now();
    if (view.phase === 'playing') {
      const counting = now < view.startedAt;
      const left = counting ? view.roundMs : view.endsAt - now;
      timerEl.textContent = fmtClock(left);
      timerEl.classList.toggle('low', !counting && left <= 10000);
      const sec = counting ? `c${Math.ceil((view.startedAt - now) / 1000)}` : `t${Math.ceil(left / 1000)}`;
      if (sec !== lastSecond) {
        const wasCounting = lastSecond && lastSecond[0] === 'c';
        lastSecond = sec;
        if (counting) sfx.play('beep');
        else if (wasCounting) { sfx.play('go'); renderAll(); }
        else if (left <= 10000 && left > 0) sfx.play('tick');
        if (counting) renderOverlay();
      }
    } else {
      timerEl.textContent = view.phase === 'results' ? '0:00' : fmtClock(view.roundMs || 60000);
      timerEl.classList.remove('low');
    }
  }

  function renderAll() {
    renderStatus();
    renderBoard();
    renderOverlay();
    renderWords();
    renderScores();
    renderResults();
    botBar.update(view.players);
  }

  function onState(data) {
    const prev = view;
    view = data;
    clock.sync(view.serverNow);
    if (view.roundId !== roundSeen) {
      roundSeen = view.roundId;
      picked = [];
      order = [0, 1, 2, 3, 4, 5].slice(0, (view.letters || 'xxxxxx').length);
      freshWord = null;
    }
    if (prev && prev.phase === 'playing' && view.phase === 'results') {
      const me = view.players.find((p) => p.clientId === myId() && p.inRound);
      const topScore = Math.max(0, ...view.players.filter((p) => p.inRound).map((p) => p.score));
      if (me) sfx.play(me.score === topScore && topScore > 0 ? 'win' : 'lose');
      picked = [];
    }
    renderAll();
  }

  function onResult(data) {
    clearTimeout(trayTimer);
    trayTimer = null;
    const w = String(data.word || '').toUpperCase();
    if (data.outcome === 'found') {
      freshWord = data.word;
      sfx.play(data.word.length >= 5 ? 'chime' : 'point');
      floatText(`+${data.points}`, data.word.length === 6 ? '#ffd23f' : '#39ff14');
      if (data.word.length === 6) toast(`${w} — ALL SIX LETTERS!`, '#ffd23f');
      flashTray('good');
      renderWords();
    } else if (data.outcome === 'already') {
      toast(`Already have ${w}`);
      sfx.play('error');
      flashTray('dupe');
    } else if (data.outcome === 'not_word') {
      toast(`${w} isn't in the dictionary`, '#ff8a8a');
      sfx.play('error');
      flashTray('bad');
    } else if (data.outcome === 'short') {
      toast('Words need at least 3 letters');
      sfx.play('error');
      flashTray('bad');
    } else if (data.outcome === 'closed') {
      picked = [];
      renderBoard();
    } else {
      sfx.play('error');
      flashTray('bad');
    }
  }

  renderBoard();
  renderOverlay();
  rafId = requestAnimationFrame(frame);

  return {
    applySnapshot(snapshot) {
      if (!snapshot) return;
      onState(snapshot.kind === 'state' ? snapshot : { kind: 'state', ...snapshot });
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') onState(data);
      else if (data.kind === 'result') onResult(data);
    },
    applyRoster() { /* names come from the server's player list */ },
    unmount() {
      cancelAnimationFrame(rafId);
      clearTimeout(toastTimer);
      clearTimeout(trayTimer);
      window.removeEventListener('keydown', onKey);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
