// Framed — guess the movie (released 2000 or later) from frames of it. Everyone gets the same movie
// and six tries; each wrong guess or SKIP unlocks the next frame. Type, then ENTER (or click) guesses
// the highlighted suggestion; ↑/↓ moves it. Fewest frames wins. The frame numbers flip back.
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
.fr-form { display: flex; gap: 6px; position: relative; }
.fr-sugg { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 5; list-style: none; margin: 0; padding: 0;
  background: #050a05; border: 1px solid var(--fg, #39ff14); box-shadow: 0 6px 18px rgba(0,0,0,.7); max-height: 300px; overflow-y: auto; }
.fr-sugg[hidden] { display: none; }
.fr-sugg li { padding: 7px 10px; cursor: pointer; border-bottom: 1px solid rgba(57,255,20,.12); }
.fr-sugg li.on { background: var(--fg, #39ff14); color: #000; }
.fr-sugg li.none { cursor: default; opacity: .6; }
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

// Loose title search: case, accents and punctuation don't matter, "&" = "and", and the words you
// type can come in any order ("return king" finds The Return of the King). Best matches first:
// title starts with it, then a word starts with it, then it appears anywhere, then all words match.
const norm = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
function searchTitles(titles, q, limit = 8) {
  const nq = norm(q);
  if (!nq) return [];
  const words = nq.split(' ');
  const hits = [];
  for (const t of titles) {
    const nt = norm(t);
    const tw = nt.split(' ');
    let rank;
    if (nt.startsWith(nq)) rank = 0;
    else if ((' ' + nt).includes(' ' + nq)) rank = 1;
    else if (nt.includes(nq)) rank = 2;
    else if (words.every((w) => tw.some((x) => x.startsWith(w)))) rank = 3;
    else continue;
    hits.push({ t, rank });
  }
  return hits.sort((a, b) => a.rank - b.rank || a.t.length - b.t.length).slice(0, limit).map((h) => h.t);
}

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
  const sugg = el('ul', 'fr-sugg');
  sugg.hidden = true;
  sugg.setAttribute('role', 'listbox');
  Object.assign(input, { placeholder: 'Search for a movie…', autocomplete: 'off', spellcheck: false });
  input.setAttribute('aria-label', 'Movie title');
  input.setAttribute('role', 'combobox');
  const guessBtn = el('button', null, 'GUESS');
  guessBtn.type = 'submit';
  const skipBtn = el('button', null, 'SKIP');
  skipBtn.type = 'button';
  form.append(input, guessBtn, skipBtn, sugg);
  const toastEl = el('div', 'fr-toast');
  const log = el('ul', 'fr-log');
  play.append(frameBox, tabs, form, toastEl, log, el('div', 'fr-credit', 'Frames from official trailers. Movie data from TMDB; this product uses the TMDB API but is not endorsed or certified by TMDB.'));
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

  let hits = [];
  let hi = 0;
  function renderSugg() {
    const tried = new Set(view ? view.myGuesses.map((g) => g.guess) : []);
    hits = searchTitles(titles.filter((t) => !tried.has(t)), input.value);
    hi = Math.min(hi, Math.max(0, hits.length - 1));
    sugg.hidden = !input.value.trim() || document.activeElement !== input;
    sugg.replaceChildren(...(hits.length ? hits.map((t, i) => {
      const li = el('li', i === hi ? 'on' : '', t);
      li.setAttribute('role', 'option');
      // mousedown, not click, so the input keeps focus.
      li.addEventListener('mousedown', (e) => { e.preventDefault(); input.value = t; renderSugg(); form.requestSubmit(); });
      return li;
    }) : [el('li', 'none', 'No movie by that name in the list')]));
  }
  input.addEventListener('input', () => { hi = 0; renderSugg(); });
  input.addEventListener('focus', renderSugg);
  input.addEventListener('blur', () => { sugg.hidden = true; });
  input.addEventListener('keydown', (e) => {
    if (sugg.hidden || !hits.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      hi = (hi + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
      renderSugg();
      sugg.children[hi].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Escape') sugg.hidden = true;
    // ENTER guesses the highlighted suggestion (the top one unless you arrowed to another).
    else if (e.key === 'Enter') input.value = hits[hi];
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const guess = input.value.trim();
    if (!canGuess() || !guess) return;
    // Exact (case-insensitive) title match only, so a half-typed name never burns a frame.
    const match = titles.find((t) => t.toLowerCase() === guess.toLowerCase());
    if (!match) { toast('Pick a movie from the suggestions'); sfx.play('error'); return; }
    sugg.hidden = true;
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
