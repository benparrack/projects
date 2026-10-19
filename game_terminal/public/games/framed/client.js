// Framed — guess the movie (released 2000 or later) from its stills. Everyone gets the same movie
// and six tries; each wrong guess or SKIP unlocks the next frame. Pick a title from the suggestions
// and press ENTER. Fewest frames wins. Click the frame numbers to look back at earlier frames.
// Server plugin: ../../../server/games/framed.js (holds the answer; sends frames as you unlock them).
import { sfx } from '../sfx.js';
import { createResults } from '../resultsPanel.js';

const CSS = `
.fr-root { display: flex; flex-direction: column; gap: 10px; }
.fr-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.fr-status { font-weight: bold; }
.fr-body { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; justify-content: center; }
.fr-play { display: flex; flex-direction: column; gap: 10px; flex: 1 1 420px; max-width: 780px; }
.fr-frame { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #050805; border: 1px solid var(--fg-dim, #1f8f0c);
  border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.fr-frame img { width: 100%; height: 100%; object-fit: cover; display: block; animation: fr-in .35s ease-out; }
@keyframes fr-in { from { opacity: 0; } }
.fr-frame .fr-empty { opacity: .6; padding: 16px; text-align: center; line-height: 1.5; }
.fr-tabs { display: flex; gap: 6px; }
.fr-tab { flex: 1; padding: 6px 0; font-weight: bold; }
.fr-tab[disabled], .fr-tab[disabled]:hover { opacity: .3; cursor: default; background: transparent; color: inherit; }
.fr-tab.miss { border-color: #ff4d4d; color: #ff8a8a; }
.fr-tab.skip { border-color: #777; color: #aaa; }
.fr-tab.hit { border-color: #39ff14; color: #39ff14; }
.fr-tab.on, .fr-tab.on:hover { background: var(--fg, #39ff14); color: #000; }
.fr-form { display: flex; gap: 6px; }
.fr-form input { flex: 1; min-width: 0; font: inherit; padding: 8px 10px; background: #000; color: var(--fg, #39ff14);
  border: 1px solid var(--fg-dim, #1f8f0c); }
.fr-form input:focus { outline: none; border-color: var(--fg, #39ff14); }
.fr-toast { min-height: 1.3em; color: #ffb000; }
.fr-log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.fr-log li { padding: 3px 8px; border-left: 3px solid; font-size: .92em; }
.fr-log li.miss { border-color: #ff4d4d; color: #ff9a9a; }
.fr-log li.skip { border-color: #666; color: #999; }
.fr-log li.hit { border-color: #39ff14; color: #39ff14; }
.fr-side { flex: 0 1 230px; min-width: 200px; display: flex; flex-direction: column; gap: 6px; }
.fr-side b { color: #ffb000; letter-spacing: 1px; }
.fr-pl { display: flex; gap: 8px; align-items: center; padding: 4px 6px; border: 1px solid rgba(57,255,20,.15); border-radius: 4px; }
.fr-pl.you { box-shadow: inset 3px 0 0 #39ff14; }
.fr-pl-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .9em; }
.fr-pl-meta { font-size: .76em; opacity: .75; white-space: nowrap; }
.fr-dots { display: flex; gap: 2px; }
.fr-dots i { width: 9px; height: 9px; background: rgba(57,255,20,.1); }
.fr-dots i.hit { background: #2e9e2a; } .fr-dots i.miss { background: #c23b3b; } .fr-dots i.skip { background: #555; }
.fr-credit { font-size: .72em; opacity: .5; }
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

let listSeq = 0;

export function mount(container, api) {
  ensureStyles();
  const results = createResults(container);
  let view = null;
  let titles = [];
  let roundSeen = -1;
  let showing = 0; // which frame is on screen
  let toastTimer = null;

  const root = el('div', 'fr-root');
  const top = el('div', 'fr-top');
  const statusEl = el('div', 'fr-status', 'Loading…');
  const startBtn = el('button', null, 'START');
  startBtn.addEventListener('click', () => { sfx.play('select'); api.sendAction({ kind: 'start' }); });
  top.append(statusEl, startBtn);

  const play = el('div', 'fr-play');
  const frameBox = el('div', 'fr-frame');
  const tabs = el('div', 'fr-tabs');
  const form = el('form', 'fr-form');
  const input = el('input');
  const listId = `fr-titles-${++listSeq}`;
  const datalist = el('datalist');
  datalist.id = listId;
  Object.assign(input, { placeholder: 'Search for a movie…', autocomplete: 'off', spellcheck: false });
  input.setAttribute('list', listId);
  input.setAttribute('aria-label', 'Movie title');
  const guessBtn = el('button', null, 'GUESS');
  guessBtn.type = 'submit';
  const skipBtn = el('button', null, 'SKIP');
  skipBtn.type = 'button';
  form.append(input, datalist, guessBtn, skipBtn);
  const toastEl = el('div', 'fr-toast');
  const log = el('ul', 'fr-log');
  play.append(frameBox, tabs, form, toastEl, log, el('div', 'fr-credit', 'Stills via TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.'));
  const side = el('div', 'fr-side');
  const body = el('div', 'fr-body');
  body.append(play, side);
  root.append(top, body);
  container.appendChild(root);

  const me = () => view && view.players.find((p) => p.clientId === api.getClientId());
  const canGuess = () => view && view.phase === 'playing' && me() && me().inRound && !me().done;

  function toast(text) {
    toastEl.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.textContent = ''; }, 2200);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const guess = input.value.trim();
    if (!canGuess() || !guess) return;
    // Exact (case-insensitive) title match only, so a half-typed name never burns a frame.
    const match = titles.find((t) => t.toLowerCase() === guess.toLowerCase());
    if (!match) { toast('Pick a movie from the suggestions'); sfx.play('error'); return; }
    api.sendAction({ kind: 'guess', guess: match });
  });
  skipBtn.addEventListener('click', () => { if (canGuess()) api.sendAction({ kind: 'guess', guess: '' }); });

  function renderFrame() {
    const frames = view.frames || [];
    if (!frames.length) {
      frameBox.replaceChildren(el('div', 'fr-empty', 'Guess the movie from its stills. Every movie came out in 2000 or later. You get six frames; each wrong guess or skip shows the next one. Press START.'));
      return;
    }
    showing = Math.min(showing, frames.length - 1);
    const img = el('img');
    img.alt = `Frame ${showing + 1}`;
    img.src = frames[showing];
    frameBox.replaceChildren(img);
  }

  function renderTabs() {
    const frames = view.frames || [];
    const marks = view.myGuesses.map((g) => g.mark);
    tabs.replaceChildren(...Array.from({ length: view.maxGuesses }, (_, i) => {
      const b = el('button', `fr-tab${marks[i] ? ` ${marks[i]}` : ''}${i === showing && frames.length ? ' on' : ''}`, String(i + 1));
      b.type = 'button';
      b.disabled = i >= frames.length;
      b.addEventListener('click', () => { showing = i; renderFrame(); renderTabs(); });
      return b;
    }));
  }

  function renderLog() {
    log.replaceChildren(...view.myGuesses.map((g) => el('li', g.mark, g.mark === 'skip' ? 'Skipped' : `${g.mark === 'hit' ? '✓' : '✗'} ${g.guess}`)));
  }

  function renderSide() {
    const meId = api.getClientId();
    side.replaceChildren(el('b', null, 'PLAYERS'), ...view.players.map((p) => {
      const row = el('div', `fr-pl${p.clientId === meId ? ' you' : ''}`);
      const dots = el('div', 'fr-dots');
      for (let i = 0; i < view.maxGuesses; i++) dots.appendChild(el('i', p.guesses[i] ? p.guesses[i].mark : ''));
      const name = el('span', 'fr-pl-name', p.nickname);
      name.style.color = p.color;
      const meta = !p.inRound ? 'next round' : p.solved ? `✓ in ${p.count}` : p.done ? '✗ out' : `${p.count}/${view.maxGuesses}`;
      row.append(dots, name, el('span', 'fr-pl-meta', `${meta}${p.wins ? ` · ${p.wins}W` : ''}`));
      return row;
    }));
  }

  function renderTop() {
    const m = me();
    startBtn.hidden = view.phase === 'playing';
    startBtn.textContent = view.phase === 'waiting' ? 'START' : 'NEW MOVIE';
    form.hidden = !canGuess();
    if (view.phase === 'waiting') statusEl.textContent = 'Press START for a movie. Everyone in the room gets the same one.';
    else if (view.phase === 'results') statusEl.textContent = `It was ${view.answer}`;
    else if (m && !m.inRound) statusEl.textContent = 'Round in progress. You\'re in the next one.';
    else if (m && m.done) statusEl.textContent = m.solved ? `Got it in ${m.count}! Waiting for the others…` : 'Out of frames. Waiting for the others…';
    else statusEl.textContent = `Frame ${(m ? m.count : 0) + 1} of ${view.maxGuesses}`;
  }

  function renderResults() {
    if (view.phase !== 'results') { results.update(null); return; }
    const meId = api.getClientId();
    const players = view.players.filter((p) => p.inRound)
      .sort((a, b) => (a.solved ? a.count : 99) - (b.solved ? b.count : 99) || (a.finishedAt || 0) - (b.finishedAt || 0));
    const top = players[0];
    const mine = players.find((p) => p.clientId === meId);
    const won = mine && mine.solved && mine === top; // ties on frames go to whoever got it first
    results.update({
      title: mine && mine.solved ? (won && players.length > 1 ? 'YOU WIN!' : `GOT IT IN ${mine.count}!`) : 'NOT THIS TIME',
      subtitle: `It was ${view.answer}`,
      outcome: won ? 'win' : mine && mine.solved ? 'over' : 'lose',
      rows: players.map((p) => ({ name: p.nickname, value: p.solved ? `${p.count}/${view.maxGuesses}` : 'X', win: p === top && p.solved, you: p.clientId === meId })),
      rematch: { label: 'NEW MOVIE', onClick: () => api.sendAction({ kind: 'start' }) },
    });
  }

  function onState(data) {
    const prev = view;
    view = data;
    if (data.titles) {
      titles = data.titles;
      datalist.replaceChildren(...titles.map((t) => { const o = el('option'); o.value = t; return o; }));
    }
    const newRound = view.roundId !== roundSeen;
    roundSeen = view.roundId;
    const before = prev && !newRound ? prev.myGuesses.length : view.myGuesses.length;
    if (newRound || view.myGuesses.length > before) {
      // Jump to the newest frame (or back to frame 1 on a new movie).
      showing = Math.max(0, (view.frames || []).length - 1);
      input.value = '';
      if (newRound && view.phase === 'playing' && canGuess()) setTimeout(() => input.focus(), 0);
    }
    if (prev && view.myGuesses.length > before) {
      const last = view.myGuesses[view.myGuesses.length - 1];
      sfx.play(last.mark === 'hit' ? 'win' : last.mark === 'skip' ? 'select' : 'error');
      if (last.mark === 'miss') toast(`Not ${last.guess}`);
    }
    if (prev && prev.phase === 'playing' && view.phase === 'results' && me() && !me().solved) sfx.play('lose');
    renderTop();
    renderFrame();
    renderTabs();
    renderLog();
    renderSide();
    renderResults();
  }

  return {
    applySnapshot(snapshot) { if (snapshot) onState(snapshot); },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') onState(data);
      else if (data.kind === 'error') { toast(data.error); sfx.play('error'); }
    },
    applyRoster() { /* names come from the server's player list */ },
    unmount() {
      clearTimeout(toastTimer);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
