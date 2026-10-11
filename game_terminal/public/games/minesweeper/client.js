// Minesweeper race client. You see your own board plus a progress bar for both seats; spectators
// (and everyone at game over) see both boards. Click opens (or chords a satisfied number),
// right-click / long-press / FLAG mode flags. Bots stream a state every few hundred ms, so the
// seat/controls block is only rebuilt when it actually changes and board cells are patched in
// place. Cells carry data-i (server index) for testing.
import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect } from '../botLevel.js';
import { createResults } from '../resultsPanel.js';

const SEAT_LABEL = { p1: 'P1', p2: 'P2' };
const SEAT_COLOR = { p1: '#39ff14', p2: '#3ad7ff' };
const SIZES = [['small', 'SMALL 9×9'], ['medium', 'MEDIUM 16×16'], ['large', 'LARGE 30×16']];
const NUM_COLOR = ['', '#4da3ff', '#52d273', '#ff5d5d', '#b48cff', '#ffa94d', '#3fd5d5', '#f0f0f0', '#9aa0a6'];
const LONG_PRESS_MS = 450;

const REJECT_MESSAGES = {
  frozen: 'Frozen — you hit a mine!',
  not_playing: 'The game is not in progress',
  not_seated: 'Take a seat to play',
  in_progress: 'Finish this race first (size can change mid-game only vs a bot)',
  invalid: 'Invalid move',
};

const CSS = `
.ms-root { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; }
.ms-status { font-size: 18px; font-weight: bold; padding: 6px 14px; border-radius: 6px; text-align: center; }
.ms-status.frozen { color: #ff4d4d; }
.ms-err { color: #ff4d4d; min-height: 1.2em; font-size: 14px; }
.ms-chrome { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.ms-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; align-items: center; }
.ms-seat { display: flex; gap: 6px; align-items: center; padding: 4px 8px; border: 1px solid #1f8f0c; border-radius: 6px; }
.ms-chip { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
.ms-size.on, .ms-flagbtn.on { background: #39ff14; color: #000; }
.ms-race { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 8px; align-items: center; width: min(460px, 92vw); font-size: 13px; }
.ms-bar { height: 12px; border-radius: 6px; border: 1px solid #1f8f0c; background: #0a0f0a; overflow: hidden; }
.ms-bar > div { height: 100%; transition: width .25s ease-out; }
.ms-bar.frozen > div { background: #ff4d4d !important; }
.ms-boards { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }
.ms-boardbox { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.ms-cap { font-size: 13px; opacity: .8; }
.ms-grid {
  display: grid; gap: 1px; padding: 5px; background: #050805; border: 3px solid #1f8f0c; border-radius: 8px;
  touch-action: manipulation; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
}
.ms-grid.mine-board { border-color: #39ff14; }
.ms-c {
  width: var(--cell); height: var(--cell); display: flex; align-items: center; justify-content: center;
  font-weight: bold; font-size: calc(var(--cell) * .62); line-height: 1; border-radius: 2px;
  background: #2b3a2b; box-shadow: inset 0 2px 0 rgba(255,255,255,.18), inset 0 -2px 0 rgba(0,0,0,.35);
}
.ms-grid.live .ms-c.h, .ms-grid.live .ms-c.f { cursor: pointer; }
.ms-grid.live .ms-c.h:hover { background: #3c533c; }
.ms-c.o { background: #121812; box-shadow: none; }
.ms-c.o.pop { animation: ms-pop .18s ease-out; }
@keyframes ms-pop { from { transform: scale(.6); opacity: .3; } }
.ms-c.f::after { content: '⚑'; color: #ff5d5d; }
.ms-c.x { background: #a8222d; box-shadow: none; }
.ms-c.x::after, .ms-c.m::after { content: '✹'; color: #fff; }
.ms-c.m { background: #3a1517; box-shadow: none; }
.ms-c.w { background: #3a2a10; }
.ms-c.w::after { content: '✕'; color: #ffb000; }
.ms-freeze {
  position: absolute; inset: 22px 0 0 0; display: none; align-items: center; justify-content: center; border-radius: 8px;
  background: rgba(80,0,0,.45); color: #fff; font-size: 28px; font-weight: bold; text-shadow: 0 0 6px #000; pointer-events: none;
}
.ms-freeze.on { display: flex; }
.ms-hint { font-size: 12px; opacity: .65; text-align: center; max-width: 460px; }
@media (prefers-reduced-motion: reduce) { .ms-c.o.pop { animation: none; } .ms-bar > div { transition: none; } }
`;

let styled = false;
function ensureStyles() {
  if (styled) return;
  styled = true;
  const tag = document.createElement('style');
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function mount(container, api) {
  ensureStyles();
  let view = null;
  let roster = [];
  let flashTimer = null;
  let flagMode = false;
  let chromeKey = null;
  let gridKey = null;
  let clockBase = 0; // performance.now() - elapsedMs at the last state
  let frozenUntil = { p1: 0, p2: 0 }; // performance.now() deadlines
  const grids = {}; // seat -> { el, cells[], prev[] }

  const root = document.createElement('div');
  root.className = 'ms-root';
  container.appendChild(root);
  const status = document.createElement('div');
  status.className = 'ms-status';
  const err = document.createElement('div');
  err.className = 'ms-err';
  const chrome = document.createElement('div');
  chrome.className = 'ms-chrome';
  const race = document.createElement('div');
  race.className = 'ms-race';
  const boardsEl = document.createElement('div');
  boardsEl.className = 'ms-boards';
  const hint = document.createElement('div');
  hint.className = 'ms-hint';
  hint.textContent = 'Click: open (click a number whose mines are all flagged to open around it) · Right-click / long-press / FLAG mode: flag. Same mines for both players — first to clear wins. A mine freezes you for 5s.';
  root.append(status, err, chrome, race, boardsEl, hint);
  const results = createResults(container);

  const nicknameFor = (id) => {
    if (!id) return null;
    const e = roster.find((r) => r.clientId === id);
    return e ? e.nickname : 'someone';
  };
  const mySeat = () => {
    const me = api.getClientId();
    if (!view) return null;
    return ['p1', 'p2'].find((s) => view.players[s] === me) || null;
  };
  const seatName = (s) => (view.players[s] === 'BOT' ? `Bot (${(view.botLevels || {})[s] || 'hard'})` : nicknameFor(view.players[s]) || '(empty)');

  function seatBox(seat) {
    const box = document.createElement('div');
    box.className = 'ms-seat';
    const chip = document.createElement('span');
    chip.className = 'ms-chip';
    chip.style.background = SEAT_COLOR[seat];
    const name = document.createElement('span');
    name.textContent = `${SEAT_LABEL[seat]}: ${seatName(seat)}${view.players[seat] === api.getClientId() ? ' (you)' : ''}`;
    box.append(chip, name);
    if (!view.players[seat]) {
      if (!mySeat()) {
        const btn = document.createElement('button');
        btn.textContent = `PLAY ${SEAT_LABEL[seat]}`;
        btn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat }));
        box.appendChild(btn);
      }
      const bot = document.createElement('button');
      bot.textContent = 'PLAY VS BOT';
      bot.addEventListener('click', () => api.sendAction({ kind: 'sit', seat, bot: true, level: preferredLevel() }));
      box.append(bot, levelSelect(preferredLevel()));
    } else if (view.players[seat] === 'BOT') {
      box.appendChild(levelSelect((view.botLevels || {})[seat], (level) => api.sendAction({ kind: 'setBotLevel', seat, level })));
      const rm = document.createElement('button');
      rm.textContent = 'REMOVE BOT';
      rm.addEventListener('click', () => api.sendAction({ kind: 'removeBot', seat }));
      box.appendChild(rm);
    }
    return box;
  }

  function renderChrome() {
    const seat = mySeat();
    const key = JSON.stringify([view.players, view.botLevels, view.phase, view.size, view.score, seat, flagMode, roster.map((r) => r.clientId + r.nickname)]);
    if (key === chromeKey) return;
    chromeKey = key;
    chrome.innerHTML = '';
    const seats = document.createElement('div');
    seats.className = 'ms-row';
    seats.append(seatBox('p1'), seatBox('p2'));
    if (seat) {
      const leave = document.createElement('button');
      leave.textContent = 'LEAVE SEAT';
      leave.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seats.appendChild(leave);
    }
    chrome.appendChild(seats);
    if (seat || view.phase === 'waiting') {
      const row = document.createElement('div');
      row.className = 'ms-row';
      const other = seat === 'p1' ? 'p2' : 'p1';
      const canSize = view.phase === 'waiting' || (seat && (view.phase !== 'playing' || view.players[other] === 'BOT'));
      for (const [id, label] of SIZES) {
        const b = document.createElement('button');
        b.className = `ms-size${view.size === id ? ' on' : ''}`;
        b.textContent = label;
        b.disabled = !canSize;
        b.title = canSize ? (view.phase === 'playing' ? 'Restart on this size' : 'Board size') : 'Size can change between races';
        b.addEventListener('click', () => api.sendAction({ kind: 'setSize', size: id }));
        row.appendChild(b);
      }
      if (seat && view.phase === 'playing') {
        const fb = document.createElement('button');
        fb.className = `ms-flagbtn${flagMode ? ' on' : ''}`;
        fb.textContent = flagMode ? '⚑ FLAG MODE: ON' : '⚑ FLAG MODE: OFF';
        fb.addEventListener('click', () => { flagMode = !flagMode; renderChrome(); });
        row.appendChild(fb);
      }
      if (seat && view.phase === 'game_over') {
        const again = document.createElement('button');
        again.textContent = 'NEW RACE';
        again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
        row.appendChild(again);
      }
      chrome.appendChild(row);
    }
    if (view.score.p1 || view.score.p2) {
      const t = document.createElement('div');
      t.className = 'ms-cap';
      t.textContent = `Match: P1 ${view.score.p1} · P2 ${view.score.p2}`;
      chrome.appendChild(t);
    }
  }

  function renderRace() {
    race.innerHTML = '';
    for (const s of ['p1', 'p2']) {
      const p = view.progress[s];
      const label = document.createElement('span');
      label.textContent = SEAT_LABEL[s];
      label.style.color = SEAT_COLOR[s];
      const bar = document.createElement('div');
      bar.className = `ms-bar${p && frozenUntil[s] > performance.now() ? ' frozen' : ''}`;
      const fill = document.createElement('div');
      fill.style.width = `${p ? (100 * p.opened) / view.safeTotal : 0}%`;
      fill.style.background = SEAT_COLOR[s];
      bar.appendChild(fill);
      const info = document.createElement('span');
      info.textContent = p ? `${Math.floor((100 * p.opened) / view.safeTotal)}% · ✹${p.hits} · ⚑${p.flags}` : '—';
      race.append(label, bar, info);
    }
  }

  // Narrow screens show the wide board on its side so cells stay tappable.
  const transposed = () => view.cols > view.rows && window.innerWidth < 760;

  function buildGrid(seat, live) {
    const tr = transposed();
    const dCols = tr ? view.rows : view.cols;
    const dRows = tr ? view.cols : view.rows;
    const both = !live;
    const el = document.createElement('div');
    el.className = `ms-grid${live ? ' live mine-board' : ''}`;
    const avail = both && window.innerWidth >= 760 ? Math.min(window.innerWidth, 1100) / 2 - 40 : Math.min(window.innerWidth, 900) * 0.94 - 16;
    el.style.setProperty('--cell', `${Math.max(12, Math.min(30, Math.floor(avail / dCols) - 1))}px`);
    el.style.gridTemplateColumns = `repeat(${dCols}, var(--cell))`;
    const cells = new Array(view.cols * view.rows);
    for (let dr = 0; dr < dRows; dr++) {
      for (let dc = 0; dc < dCols; dc++) {
        const i = tr ? dc * view.cols + dr : dr * view.cols + dc;
        const c = document.createElement('div');
        c.className = 'ms-c h';
        c.dataset.i = i;
        cells[i] = c;
        el.appendChild(c);
      }
    }
    if (live) wireInput(el);
    return { el, cells, prev: null };
  }

  function wireInput(el) {
    let pressTimer = null;
    let longFired = false;
    let lastTouch = 0;
    const cellOf = (e) => e.target.closest && e.target.closest('.ms-c');
    const send = (kind, c) => {
      if (!c || !view || view.phase !== 'playing') return;
      if (frozenUntil[mySeat()] > performance.now()) { sfx.play('error'); return; }
      api.sendAction({ kind, i: Number(c.dataset.i) });
    };
    el.addEventListener('pointerdown', (e) => {
      longFired = false;
      if (e.pointerType !== 'touch') return;
      lastTouch = Date.now();
      const c = cellOf(e);
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => { longFired = true; send('flag', c); if (navigator.vibrate) navigator.vibrate(30); }, LONG_PRESS_MS);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => clearTimeout(pressTimer));
    el.addEventListener('click', (e) => {
      if (longFired) { longFired = false; return; }
      const c = cellOf(e);
      if (!c) return;
      const isNum = /\bo\b/.test(c.className);
      send(flagMode && !isNum ? 'flag' : 'reveal', c);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (Date.now() - lastTouch < 1000) return; // the long-press timer handles touch
      send('flag', cellOf(e));
    });
  }

  function patchGrid(g, cells, animate) {
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i];
      if (g.prev && g.prev[i] === v) continue;
      const c = g.cells[i];
      c.textContent = '';
      c.style.color = '';
      if (v >= 0) {
        c.className = `ms-c o${animate && g.prev && g.prev[i] < 0 ? ' pop' : ''}`;
        if (v > 0) { c.textContent = v; c.style.color = NUM_COLOR[v]; }
      } else {
        c.className = `ms-c ${{ '-1': 'h', '-2': 'f', '-3': 'x', '-4': 'm', '-5': 'w' }[v]}`;
      }
    }
    g.prev = cells.slice();
  }

  function renderBoards() {
    const seat = mySeat();
    const shown = ['p1', 'p2'].filter((s) => view.boards[s]);
    // Own board first, alone while racing.
    if (seat && shown.includes(seat)) shown.sort((a) => (a === seat ? -1 : 1));
    const key = JSON.stringify([view.round, view.cols, view.rows, shown, seat, view.phase === 'playing', transposed()]);
    if (key !== gridKey) {
      gridKey = key;
      boardsEl.innerHTML = '';
      for (const k of Object.keys(grids)) delete grids[k];
      if (!shown.length) {
        // Waiting: an empty preview board of the chosen size.
        const g = buildGrid(null, false);
        boardsEl.appendChild(g.el);
      }
      for (const s of shown) {
        const box = document.createElement('div');
        box.className = 'ms-boardbox';
        const cap = document.createElement('div');
        cap.className = 'ms-cap';
        cap.textContent = s === seat ? 'YOUR BOARD' : `${SEAT_LABEL[s]} — ${seatName(s)}`;
        cap.style.color = SEAT_COLOR[s];
        const g = buildGrid(s, s === seat && view.phase === 'playing');
        const fz = document.createElement('div');
        fz.className = 'ms-freeze';
        box.append(cap, g.el, fz);
        g.freeze = fz;
        grids[s] = g;
        boardsEl.appendChild(box);
      }
    }
    for (const s of shown) patchGrid(grids[s], view.boards[s], true);
  }

  function renderStatus() {
    if (!view) { status.textContent = 'Loading...'; return; }
    const seat = mySeat();
    const now = performance.now();
    status.classList.remove('frozen');
    status.style.color = '';
    if (view.phase === 'waiting') status.textContent = 'Waiting for both seats — take one and add a bot or a friend.';
    else if (view.phase === 'game_over') {
      status.textContent = `${seat === view.winner ? 'YOU WIN' : `${SEAT_LABEL[view.winner]} (${seatName(view.winner)}) WINS`} — cleared in ${fmt(view.elapsedMs)}`;
      status.style.color = '#ffb000';
    } else if (seat && frozenUntil[seat] > now) {
      status.textContent = `💥 FROZEN ${Math.ceil((frozenUntil[seat] - now) / 1000)}s · ${fmt(now - clockBase)}`;
      status.classList.add('frozen');
    } else {
      status.textContent = `⏱ ${fmt(now - clockBase)} · ${view.mines} mines · first to clear wins`;
    }
    for (const s of ['p1', 'p2']) {
      const g = grids[s];
      if (!g || !g.freeze) continue;
      const left = frozenUntil[s] - now;
      g.freeze.classList.toggle('on', view.phase === 'playing' && left > 0);
      g.freeze.textContent = left > 0 ? `💥 ${Math.ceil(left / 1000)}` : '';
    }
  }

  function resultsOpts() {
    if (view.phase !== 'game_over' || !view.winner) return null;
    const seat = mySeat();
    const order = [view.winner, view.winner === 'p1' ? 'p2' : 'p1'];
    return {
      title: seat === view.winner ? 'YOU WIN!' : seat ? 'YOU LOSE' : `${seatName(view.winner).toUpperCase()} WINS!`,
      subtitle: `Cleared in ${fmt(view.elapsedMs)}`,
      outcome: !seat ? 'over' : seat === view.winner ? 'win' : 'lose',
      rows: order.map((s) => ({ name: seatName(s), value: `${Math.floor((100 * view.progress[s].opened) / view.safeTotal)}% · ✹${view.progress[s].hits}`, win: s === view.winner, you: s === seat })),
      rematch: seat ? { label: 'REMATCH', onClick: () => api.sendAction({ kind: 'resetGame' }) } : null,
    };
  }

  function render() {
    if (!view) { renderStatus(); return; }
    results.update(resultsOpts());
    renderChrome();
    renderRace();
    renderBoards();
    renderStatus();
  }

  function absorb(data) {
    const now = performance.now();
    clockBase = now - data.elapsedMs;
    for (const s of ['p1', 'p2']) frozenUntil[s] = data.progress[s] ? now + data.progress[s].frozenMs : 0;
  }

  const ticker = setInterval(() => { if (view && view.phase === 'playing') { renderStatus(); renderRace(); } }, 250);
  let resizeTimer = null;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { gridKey = null; if (view) renderBoards(); }, 200); };
  window.addEventListener('resize', onResize);
  render();

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      absorb(view);
      render();
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        const prev = view;
        const seat = mySeat();
        view = data;
        absorb(data);
        if (prev && seat && prev.round === data.round && prev.progress[seat] && data.progress[seat]) {
          const a = prev.progress[seat];
          const b = data.progress[seat];
          if (b.hits > a.hits) sfx.play('crash');
          else if (b.opened - a.opened > 8) sfx.play('swap');
          else if (b.opened > a.opened) sfx.play('pop');
          else if (b.flags !== a.flags) sfx.play('blip');
        }
        if (prev && prev.phase === 'playing' && data.phase === 'game_over') sfx.play(seat ? (data.winner === seat ? 'win' : 'lose') : 'point');
        if (prev && prev.phase !== 'playing' && data.phase === 'playing') sfx.play('go');
        render();
      } else if (data.kind === 'moveRejected') {
        sfx.play('error');
        err.textContent = REJECT_MESSAGES[data.reason] || 'Move rejected';
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { err.textContent = ''; }, 2000);
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      if (view) render();
    },
    unmount() {
      clearInterval(ticker);
      clearTimeout(flashTimer);
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
