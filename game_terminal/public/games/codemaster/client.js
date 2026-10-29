// Codemaster (Mastermind) — crack a hidden 4-colour code in 10 guesses. GREEN feedback pegs =
// right colour in the right spot, YELLOW = right colour in the wrong spot. Modes: DUEL (each seat
// sets a code for the other, race to crack it; either seat can be a CPU), RACE (the computer sets
// one code, everyone who joins cracks it on their own board) and CO-OP (one shared board).
// Pick colours from the palette (or keys 1-6), tap a filled slot to clear it, Enter submits.
// All rules/scoring are server-side; secrets only arrive here at game over.
import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect, levelLabel } from '../botLevel.js';
import { createResults } from '../resultsPanel.js';
import { makeServerClock } from '../serverClock.js';
import { injectStyle } from '../dom.js';

const PEG_COLORS = [
  { name: 'Red', hex: '#ff4d4d', dark: '#a61e1e', sym: '▲' },
  { name: 'Orange', hex: '#ff9f1c', dark: '#a85d00', sym: '★' },
  { name: 'Yellow', hex: '#ffe14d', dark: '#a68e00', sym: '●' },
  { name: 'Green', hex: '#3ddc4a', dark: '#16821f', sym: '■' },
  { name: 'Blue', hex: '#3a8dff', dark: '#1a4fa6', sym: '◆' },
  { name: 'Purple', hex: '#b46bff', dark: '#6a2db0', sym: '✚' },
];
const FB_GREEN = '#2bff5e';
const FB_YELLOW = '#ffd21f';
const PEGS = 4;

const MODE_INFO = {
  duel: { label: 'DUEL', blurb: 'Set a code for your opponent, then race to crack theirs.' },
  race: { label: 'RACE', blurb: 'The computer hides one code. Everyone races to crack it.' },
  coop: { label: 'CO-OP', blurb: 'The computer hides a code. Crack it together on one board.' },
};

const REJECT = {
  not_your_turn: "It's not your turn",
  bad_code: 'Fill all 4 slots first',
  no_dups: 'No duplicate colours in this game',
  not_playing: 'The game is not running',
  not_participant: "You're not playing. Join first",
  board_done: 'Your board is finished',
  two_bots: 'At least one seat must be a human',
};

function fmtTime(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '0:00';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const CSS = `
.cm-root { display:flex; flex-direction:column; align-items:center; gap:10px; width:100%; max-width:720px; padding:10px; box-sizing:border-box; }
.cm-status { font-size:18px; font-weight:bold; padding:6px 14px; border-radius:6px; text-align:center; border:2px solid transparent; }
.cm-status.mine { background:rgba(57,255,20,.15); border-color:#39ff14; }
.cm-sub { font-size:12px; opacity:.7; text-align:center; }
.cm-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:center; }
.cm-seg { display:inline-flex; border:1px solid #1f8f0c; border-radius:6px; overflow:hidden; }
.cm-seg button { border:none; border-radius:0; padding:5px 12px; }
.cm-seg button.on { background:#39ff14; color:#041004; font-weight:bold; }
.cm-seg button + button { border-left:1px solid #1f8f0c; }
.cm-err.none { display:none; }
.cm-err { color:#ff4d4d; min-height:1.2em; font-size:14px; animation: cm-shake .35s; }
@keyframes cm-shake { 25%{transform:translateX(-5px)} 50%{transform:translateX(4px)} 75%{transform:translateX(-2px)} }
.cm-boards { display:flex; flex-wrap:wrap; gap:14px; justify-content:center; align-items:flex-start; width:100%; }
.cm-board { background:linear-gradient(180deg,#0d1a10,#070c08); border:1px solid #1f8f0c; border-radius:10px; padding:10px; box-shadow: inset 0 0 30px -12px #39ff14; }
.cm-board.active { border-color:#39ff14; box-shadow: 0 0 14px -2px rgba(57,255,20,.6), inset 0 0 30px -12px #39ff14; }
.cm-board.solved { border-color:#ffd23f; box-shadow: 0 0 16px -2px rgba(255,210,63,.6); }
.cm-bhead { display:flex; justify-content:space-between; gap:10px; font-size:13px; margin-bottom:6px; }
.cm-bhead b { color:#d8ffd0; max-width:170px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cm-bhead .t { color:#3ad7ff; font-variant-numeric:tabular-nums; }
.cm-secret { display:flex; gap:6px; align-items:center; justify-content:flex-start; padding:6px 8px; margin-bottom:6px; border-radius:6px; background:#1a1206; border:1px solid #5a4410; }
.cm-secret .lbl { font-size:10px; opacity:.7; width:38px; line-height:1.1; }
.cm-shield { width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:repeating-linear-gradient(45deg,#3a2c0a 0 4px,#2a1f06 4px 8px); color:#ffb000; font-weight:bold; border:1px solid #5a4410; }
.cm-grid { display:flex; flex-direction:column; gap:4px; }
.cm-line { display:flex; align-items:center; gap:6px; padding:3px 6px; border-radius:6px; }
.cm-line.cur { background:rgba(57,255,20,.1); outline:1px dashed #39ff14; }
.cm-line .n { width:18px; text-align:right; font-size:11px; opacity:.55; }
.cm-line .by { font-size:10px; opacity:.55; width:52px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cm-slot { width:30px; height:30px; border-radius:50%; box-sizing:border-box; background:#020403; box-shadow: inset 0 3px 6px rgba(0,0,0,.9); border:1px solid #13301a; display:flex; align-items:center; justify-content:center; padding:0; }
.cm-slot.pick { cursor:pointer; border:1px solid #2f6b2a; }
.cm-slot.pick:hover { border-color:#39ff14; background:#06120a; }
.cm-slot.sel { outline:2px solid #39ff14; outline-offset:1px; }
.cm-peg { width:100%; height:100%; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px; color:rgba(0,0,0,.55); font-weight:bold; box-sizing:border-box; }
.cm-peg.hidden { background:radial-gradient(circle at 35% 30%,#666,#333 60%,#1a1a1a) !important; border-color:#222 !important; }
.cm-peg.drop { animation: cm-drop .35s cubic-bezier(.3,1.5,.5,1) backwards; }
@keyframes cm-drop { from { transform: scale(.2) translateY(-14px); opacity:0; } }
.cm-peg.flip { animation: cm-flip .6s ease-out backwards; }
@keyframes cm-flip { from { transform: rotateY(90deg); filter:brightness(2); } }
.cm-fb { display:grid; grid-template-columns:repeat(2,12px); grid-template-rows:repeat(2,12px); gap:3px; margin-left:4px; }
.cm-fbp { width:12px; height:12px; border-radius:50%; background:#020403; box-shadow: inset 0 1px 2px rgba(0,0,0,.9); box-sizing:border-box; }
.cm-fbp.g { background:radial-gradient(circle at 35% 30%,#b4ffc8,${FB_GREEN} 50%,#0a9e33); box-shadow:0 0 6px ${FB_GREEN}; }
.cm-fbp.r { background:radial-gradient(circle at 35% 30%,#fff3b0,${FB_YELLOW} 50%,#a68400); box-shadow:0 0 6px ${FB_YELLOW}; }
.cm-fbp.pop { animation: cm-pop .3s cubic-bezier(.3,1.8,.5,1) backwards; }
@keyframes cm-pop { from { transform:scale(0); } }
.cm-fbtxt { font-size:10px; width:34px; opacity:.75; font-variant-numeric:tabular-nums; }
.cm-fbtxt .g { color:${FB_GREEN}; } .cm-fbtxt .r { color:${FB_YELLOW}; }
.cm-palette { display:flex; gap:8px; justify-content:center; flex-wrap:wrap; }
.cm-pal { width:44px; height:44px; border-radius:50%; padding:0; border:2px solid transparent; position:relative; transition: transform .1s; }
.cm-pal:hover:not(:disabled) { transform: scale(1.1); background:transparent; }
.cm-pal:active:not(:disabled) { transform: scale(.92); }
.cm-pal .k { position:absolute; bottom:-15px; left:0; right:0; font-size:10px; color:#9fd89a; }
.cm-pal .cm-peg { font-size:16px; }
.cm-legend { display:flex; gap:14px; flex-wrap:wrap; justify-content:center; font-size:12px; opacity:.85; }
.cm-legend span { display:inline-flex; align-items:center; gap:5px; }
.cm-mini { background:#070c08; border:1px solid #1f8f0c; border-radius:8px; padding:6px 8px; min-width:96px; font-size:11px; }
.cm-mini.solved { border-color:#ffd23f; }
.cm-mini .rows { display:flex; flex-direction:column; gap:3px; margin-top:4px; }
.cm-mini .mr { display:flex; align-items:center; gap:4px; }
.cm-mini .cm-fb { grid-template-columns:repeat(4,8px); grid-template-rows:8px; gap:2px; margin:0; }
.cm-mini .cm-fbp { width:8px; height:8px; }
.cm-setter { display:flex; flex-direction:column; align-items:center; gap:10px; padding:14px; border:1px dashed #ffb000; border-radius:10px; background:rgba(255,176,0,.05); }
.cm-setter h3 { margin:0; color:#ffb000; font-size:15px; letter-spacing:1px; }
.cm-actions { display:flex; gap:8px; justify-content:center; flex-wrap:wrap; margin-top:14px; }
.cm-actions .go { background:#39ff14; color:#041004; font-weight:bold; }
.cm-actions .go:disabled { background:transparent; color:inherit; }
.cm-pill { font-size:12px; padding:2px 8px; border:1px solid #1f8f0c; border-radius:10px; }
@media (max-width:520px) { .cm-slot { width:26px; height:26px; } .cm-pal { width:38px; height:38px; } .cm-line .by { display:none; } }
@media (prefers-reduced-motion: reduce) { .cm-peg.drop,.cm-peg.flip,.cm-fbp.pop,.cm-err { animation:none; } }
`;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function pegEl(color, { hidden = false, anim = '', delay = 0 } = {}) {
  const p = el('div', 'cm-peg');
  if (hidden) {
    p.classList.add('hidden');
  } else if (color != null) {
    const c = PEG_COLORS[color];
    p.style.background = `radial-gradient(circle at 35% 30%, #fff8 0, ${c.hex} 38%, ${c.dark})`;
    p.style.border = `2px solid ${c.dark}`;
    p.textContent = c.sym;
    p.title = c.name;
  }
  if (anim) {
    p.classList.add(anim);
    p.style.animationDelay = `${delay}ms`;
  }
  return p;
}

// Feedback block: `exact` green then `near` yellow pegs, then empty holes.
function fbEl(exact, near, { animate = false, pegs = PEGS } = {}) {
  const box = el('div', 'cm-fb');
  box.title = `${exact} right colour & spot, ${near} right colour wrong spot`;
  for (let i = 0; i < pegs; i++) {
    const d = el('div', 'cm-fbp');
    if (i < exact) d.classList.add('g');
    else if (i < exact + near) d.classList.add('r');
    if (animate && i < exact + near) {
      d.classList.add('pop');
      d.style.animationDelay = `${250 + i * 140}ms`;
    }
    box.appendChild(d);
  }
  return box;
}

export function mount(container, api) {
  injectStyle(CSS);
  let view = null;
  let roster = [];
  let flash = null;
  let flashTimer = null;
  let draft = [null, null, null, null];
  let cursor = 0;
  let draftKey = ''; // resets the draft when my board/phase moves on
  let giveUpArmed = false;
  let giveUpTimer = null;
  const seen = new Map(); // boardKey -> guesses already animated
  let seenGame = -1;
  let revealedGame = -1;
  const clock = makeServerClock();

  const root = el('div', 'cm-root');
  container.appendChild(root);
  const results = createResults(container);

  const nick = (id) => {
    if (!id) return null;
    if (id === 'BOT') return 'CPU';
    const r = roster.find((x) => x.clientId === id);
    return r ? r.nickname : 'someone';
  };
  const me = () => api.getClientId();
  const mySeat = () => (view && view.mode === 'duel' ? (view.players.a === me() ? 'a' : view.players.b === me() ? 'b' : null) : null);
  const myKey = () => {
    if (!view) return null;
    if (view.mode === 'duel') return mySeat();
    if (view.mode === 'race') return view.racers.includes(me()) ? me() : null;
    return 'team';
  };
  const other = (s) => (s === 'a' ? 'b' : 'a');
  const seatName = (s) => {
    const p = view.players[s];
    if (p === 'BOT') return `CPU (${levelLabel((view.botLevels || {})[s])})`;
    return nick(p) || '(empty)';
  };
  const boardOwner = (k) => (view.mode === 'duel' ? seatName(k) : view.mode === 'race' ? nick(k) : 'Team');
  const canGuessNow = () => {
    const k = myKey();
    return !!(view && view.phase === 'playing' && k && view.boards[k] && !view.boards[k].done);
  };
  const inSetting = () => view && view.phase === 'setting' && mySeat() && !view.setBy[mySeat()];

  function setFlash(reason) {
    flash = REJECT[reason] || reason;
    sfx.play('error');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flash = null; render(); }, 2200);
    render();
  }

  function syncDraft() {
    const k = myKey();
    const key = view ? `${view.gameId}|${view.phase}|${k}|${k && view.boards[k] ? view.boards[k].guesses.length : -1}` : '';
    if (key !== draftKey) {
      draftKey = key;
      draft = [null, null, null, null];
      cursor = 0;
    }
  }

  function pick(color) {
    if (!(canGuessNow() || inSetting())) return;
    if (!view.allowDup && draft.some((c, i) => c === color && i !== cursor)) return setFlash('no_dups');
    const slot = cursor;
    draft[slot] = color;
    // Advance to the next empty slot after this one (wrapping); stay put once the row is full.
    let next = -1;
    for (let j = 1; j < PEGS; j++) if (draft[(slot + j) % PEGS] == null) { next = (slot + j) % PEGS; break; }
    cursor = next === -1 ? slot : next;
    sfx.play('select');
    render();
  }
  function clearSlot(i) {
    if (draft[i] != null) { draft[i] = null; sfx.play('click'); }
    cursor = i;
    render();
  }
  function backspace() {
    let i = -1;
    for (let j = PEGS - 1; j >= 0; j--) if (draft[j] != null) { i = j; break; }
    if (i >= 0) clearSlot(i);
  }
  function submit() {
    if (draft.some((c) => c == null)) return setFlash('bad_code');
    if (!view.allowDup && new Set(draft).size !== PEGS) return setFlash('no_dups');
    if (inSetting()) api.sendAction({ kind: 'setSecret', code: draft.slice() });
    else if (canGuessNow()) api.sendAction({ kind: 'guess', code: draft.slice() });
    else return;
    sfx.play('move');
  }
  function randomDraft() {
    const pool = [0, 1, 2, 3, 4, 5];
    draft = draft.map(() => (view.allowDup ? Math.floor(Math.random() * 6) : pool.splice(Math.floor(Math.random() * pool.length), 1)[0]));
    cursor = PEGS - 1;
    sfx.play('dice');
    render();
  }

  function onKey(e) {
    if (!view || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (!(canGuessNow() || inSetting())) return;
    if (e.key >= '1' && e.key <= '6') { pick(Number(e.key) - 1); e.preventDefault(); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { backspace(); e.preventDefault(); }
    else if (e.key === 'Enter') { submit(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { cursor = (cursor + PEGS - 1) % PEGS; render(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { cursor = (cursor + 1) % PEGS; render(); e.preventDefault(); }
  }
  document.addEventListener('keydown', onKey);

  // Live clocks: updated in place once a second, no full re-render.
  const clockTimer = setInterval(() => {
    for (const t of root.querySelectorAll('[data-start]')) {
      const start = Number(t.dataset.start);
      const end = t.dataset.end ? Number(t.dataset.end) : clock.now();
      t.textContent = `${fmtTime(end - start)}`;
    }
  }, 500);

  // ---- pieces ----

  function draftRow() {
    const line = el('div', 'cm-line cur');
    line.appendChild(el('span', 'n', '▶'));
    for (let i = 0; i < PEGS; i++) {
      const s = el('button', 'cm-slot pick');
      s.dataset.slot = String(i);
      if (i === cursor) s.classList.add('sel');
      s.title = draft[i] != null ? 'Tap to clear' : 'Selected slot';
      if (draft[i] != null) s.appendChild(pegEl(draft[i]));
      s.addEventListener('click', () => clearSlot(i));
      line.appendChild(s);
    }
    return line;
  }

  function palette() {
    const wrap = el('div', 'cm-palette');
    PEG_COLORS.forEach((c, i) => {
      const b = el('button', 'cm-pal');
      b.dataset.color = String(i);
      b.title = `${c.name} (${i + 1})`;
      b.disabled = !view.allowDup && draft.includes(i);
      b.appendChild(pegEl(i));
      b.appendChild(el('span', 'k', String(i + 1)));
      b.addEventListener('click', () => pick(i));
      wrap.appendChild(b);
    });
    return wrap;
  }

  function legend() {
    const lg = el('div', 'cm-legend');
    const a = el('span');
    a.append(Object.assign(el('span', 'cm-fbp g'), { style: 'display:inline-block' }), document.createTextNode('right colour, right spot'));
    const b = el('span');
    b.append(Object.assign(el('span', 'cm-fbp r'), { style: 'display:inline-block' }), document.createTextNode('right colour, wrong spot'));
    lg.append(a, b);
    return lg;
  }

  function timerEl(b) {
    const t = el('span', 't');
    if (b && b.startedAt) {
      t.dataset.start = String(b.startedAt);
      if (b.finishedAt) t.dataset.end = String(b.finishedAt);
      t.textContent = `${fmtTime((b.finishedAt || clock.now()) - b.startedAt)}`;
    }
    return t;
  }

  // Full board. `secretShown` = code to display in the shield row (or null = hidden).
  function boardEl(key, { title, secretShown, secretLabel, editable }) {
    const b = view.boards[key];
    const box = el('div', 'cm-board');
    box.dataset.board = key;
    if (editable) box.classList.add('active');
    if (b && b.solved) box.classList.add('solved');
    const head = el('div', 'cm-bhead');
    head.appendChild(el('b', null, title));
    const right = el('span');
    const used = b ? b.guesses.length : 0;
    right.append(document.createTextNode(`${b && b.solved ? '✔ ' : ''}${used}/${view.maxGuesses}  `), timerEl(b));
    head.appendChild(right);
    box.appendChild(head);

    const sec = el('div', 'cm-secret');
    sec.appendChild(el('span', 'lbl', secretLabel || 'secret code'));
    const flip = view.phase === 'game_over' && revealedGame !== view.gameId;
    for (let i = 0; i < PEGS; i++) {
      const slot = el('div', 'cm-slot');
      if (secretShown) slot.appendChild(pegEl(secretShown[i], { anim: flip ? 'flip' : '', delay: i * 150 }));
      else { slot.className = 'cm-shield'; slot.textContent = '?'; }
      sec.appendChild(slot);
    }
    box.appendChild(sec);

    const grid = el('div', 'cm-grid');
    const guesses = b ? b.guesses : [];
    const prevSeen = seen.get(key) || 0;
    for (let r = 0; r < view.maxGuesses; r++) {
      const g = guesses[r];
      if (!g && editable && r === guesses.length) { grid.appendChild(draftRow()); continue; }
      const line = el('div', 'cm-line');
      line.dataset.row = String(r);
      line.appendChild(el('span', 'n', String(r + 1)));
      const fresh = g && r >= prevSeen;
      for (let i = 0; i < PEGS; i++) {
        const s = el('div', 'cm-slot');
        if (g) s.appendChild(pegEl(g.code ? g.code[i] : null, { hidden: !g.code, anim: fresh ? 'drop' : '', delay: i * 60 }));
        line.appendChild(s);
      }
      line.appendChild(g ? fbEl(g.exact, g.near, { animate: fresh }) : fbEl(0, 0));
      if (g && view.mode === 'coop') line.appendChild(el('span', 'by', nick(g.by) || ''));
      grid.appendChild(line);
    }
    box.appendChild(grid);
    return box;
  }

  function miniEl(key) {
    const b = view.boards[key];
    const box = el('div', 'cm-mini');
    if (b.solved) box.classList.add('solved');
    const head = el('div', 'cm-bhead');
    head.appendChild(el('b', null, nick(key)));
    head.appendChild(timerEl(b));
    box.appendChild(head);
    box.appendChild(el('div', null, b.solved ? `✔ cracked in ${b.guesses.length}` : b.done ? '✖ out of guesses' : `${b.guesses.length}/${view.maxGuesses} guesses`));
    const rows = el('div', 'rows');
    const prevSeen = seen.get(key) || 0;
    b.guesses.forEach((g, i) => {
      const r = el('div', 'mr');
      r.appendChild(el('span', 'n', String(i + 1)));
      r.appendChild(fbEl(g.exact, g.near, { animate: i >= prevSeen }));
      rows.appendChild(r);
    });
    box.appendChild(rows);
    return box;
  }

  function guessControls(key) {
    const wrap = el('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px';
    wrap.appendChild(palette());
    const acts = el('div', 'cm-actions');
    const clr = el('button', null, 'CLEAR');
    clr.addEventListener('click', () => { draft = [null, null, null, null]; cursor = 0; sfx.play('click'); render(); });
    const go = el('button', 'go', view.phase === 'setting' ? 'LOCK IN CODE' : 'SUBMIT GUESS');
    go.dataset.action = 'submit';
    go.disabled = draft.some((c) => c == null);
    go.addEventListener('click', submit);
    acts.append(clr);
    if (view.phase === 'setting') {
      const rnd = el('button', null, 'RANDOM');
      rnd.addEventListener('click', randomDraft);
      acts.append(rnd);
    }
    acts.append(go);
    if (view.phase === 'playing' && key) {
      const gu = el('button', null, giveUpArmed ? 'REALLY GIVE UP?' : 'GIVE UP');
      if (giveUpArmed) gu.style.cssText = 'border-color:#ff4d4d;color:#ff4d4d';
      gu.addEventListener('click', () => {
        if (!giveUpArmed) {
          giveUpArmed = true;
          clearTimeout(giveUpTimer);
          giveUpTimer = setTimeout(() => { giveUpArmed = false; render(); }, 3000);
          render();
        } else {
          giveUpArmed = false;
          api.sendAction({ kind: 'giveUp' });
        }
      });
      acts.append(gu);
    }
    wrap.appendChild(acts);
    const hint = el('div', 'cm-sub', 'Keys: 1-6 colours · ⌫ clear · Enter submit · tap a filled slot to clear it');
    wrap.appendChild(hint);
    return wrap;
  }

  // ---- status / lobby ----

  function statusLine() {
    const s = el('div', 'cm-status');
    const k = myKey();
    if (view.phase === 'waiting') {
      s.textContent = view.mode === 'duel' ? 'Waiting for both seats to be filled.'
        : view.mode === 'race' ? (view.racers.length ? 'Ready. Press START RACE.' : 'Join the race to play.')
          : 'Press START to begin.';
    } else if (view.phase === 'setting') {
      const seat = mySeat();
      if (seat && !view.setBy[seat]) { s.textContent = `▶ SET A SECRET CODE FOR ${seatName(other(seat)).toUpperCase()}`; s.classList.add('mine'); }
      else if (seat) s.textContent = `Code locked in. Waiting for ${seatName(other(seat))}…`;
      else s.textContent = 'Players are setting their secret codes…';
      s.style.color = '#ffb000';
    } else if (view.phase === 'playing') {
      const b = k && view.boards[k];
      if (b && !b.done) {
        s.textContent = `▶ GUESS ${b.guesses.length + 1} OF ${view.maxGuesses}`;
        s.classList.add('mine');
      } else if (b && b.solved) s.textContent = `Cracked in ${b.guesses.length}. Waiting for the others…`;
      else if (b) s.textContent = 'Out of guesses. Waiting for the others…';
      else s.textContent = view.mode === 'race' ? 'Race in progress. You can still JOIN.' : 'Game in progress.';
    } else {
      s.textContent = headline().title;
    }
    return s;
  }

  function headline() {
    const res = view.result || { ranking: [], winners: [] };
    const k = myKey();
    const won = res.winners;
    if (view.mode === 'coop') {
      return won.length ? { title: 'CODE CRACKED', outcome: 'win' } : { title: 'THE CODE SURVIVES', outcome: 'lose' };
    }
    if (!won.length) return { title: 'NOBODY CRACKED IT', outcome: k ? 'lose' : 'over' };
    if (won.length > 1) return { title: "IT'S A TIE", outcome: 'draw' };
    if (k) return won[0] === k ? { title: 'YOU WIN', outcome: 'win' } : { title: 'YOU LOSE', outcome: 'lose' };
    return { title: `${(boardOwner(won[0]) || '').toUpperCase()} WINS`, outcome: 'over' };
  }

  function resultsOpts() {
    const h = headline();
    const res = view.result || { ranking: [], winners: [] };
    const k = myKey();
    const rows = res.ranking.map((key) => {
      const b = view.boards[key];
      const t = b.finishedAt && b.startedAt ? fmtTime(b.finishedAt - b.startedAt) : '';
      return {
        name: boardOwner(key),
        value: b.solved ? `${b.guesses.length} guess${b.guesses.length === 1 ? '' : 'es'} · ${t}` : 'not cracked',
        win: res.winners.includes(key),
        you: key === k && view.mode !== 'coop',
      };
    });
    const canRematch = view.mode === 'coop' || !!k;
    return {
      title: h.title,
      subtitle: view.mode === 'duel' ? 'Fewest guesses wins · ties go to the faster solver'
        : view.mode === 'race' ? 'Race to crack the CPU code' : 'Team effort',
      outcome: view.mode === 'coop' ? h.outcome : (k ? h.outcome : 'over'),
      rows,
      rematch: canRematch ? { label: 'PLAY AGAIN', onClick: () => api.sendAction({ kind: 'start' }) } : null,
    };
  }

  function modeControls() {
    const configurable = view.phase === 'waiting' || view.phase === 'game_over';
    const row = el('div', 'cm-row');
    const seg = el('div', 'cm-seg');
    for (const m of ['duel', 'race', 'coop']) {
      const b = el('button', view.mode === m ? 'on' : '', MODE_INFO[m].label);
      b.dataset.mode = m;
      b.disabled = !configurable && view.mode !== m;
      b.addEventListener('click', () => { if (view.mode !== m) api.sendAction({ kind: 'setMode', mode: m }); });
      seg.appendChild(b);
    }
    row.appendChild(seg);
    const dup = el('button', null, `DUPLICATES: ${view.allowDup ? 'ON' : 'OFF'}`);
    dup.dataset.action = 'dup';
    dup.title = 'Whether a code may repeat a colour';
    dup.disabled = !configurable;
    dup.addEventListener('click', () => api.sendAction({ kind: 'setDup', allowDup: !view.allowDup }));
    row.appendChild(dup);
    return row;
  }

  function seatControls() {
    const row = el('div', 'cm-row');
    const seat = mySeat();
    for (const s of ['a', 'b']) {
      const p = view.players[s];
      const pill = el('span', 'cm-pill', `${s === 'a' ? 'PLAYER 1' : 'PLAYER 2'}: ${seatName(s)}`);
      row.appendChild(pill);
      if (!p) {
        if (!seat) {
          const b = el('button', null, `PLAY ${s === 'a' ? '1' : '2'}`);
          b.dataset.sit = s;
          b.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: s }));
          row.appendChild(b);
        }
        if (view.players[other(s)] !== 'BOT') {
          const bot = el('button', null, 'PLAY VS BOT');
          bot.dataset.bot = s;
          bot.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: s, bot: true, level: preferredLevel() }));
          row.appendChild(bot);
          row.appendChild(levelSelect(preferredLevel()));
        }
      } else if (p === 'BOT') {
        row.appendChild(levelSelect((view.botLevels || {})[s], (level) => api.sendAction({ kind: 'setBotLevel', seat: s, level })));
        const rm = el('button', null, 'REMOVE BOT');
        rm.addEventListener('click', () => api.sendAction({ kind: 'removeBot', seat: s }));
        row.appendChild(rm);
      }
    }
    if (seat) {
      const lv = el('button', null, 'LEAVE SEAT');
      lv.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      row.appendChild(lv);
    }
    return row;
  }

  function raceControls() {
    const row = el('div', 'cm-row');
    const joined = view.racers.includes(me());
    row.appendChild(el('span', 'cm-pill', `RACERS: ${view.racers.length ? view.racers.map(nick).join(', ') : '(none)'}`));
    const j = el('button', null, joined ? 'LEAVE RACE' : 'JOIN RACE');
    j.dataset.action = joined ? 'leaveRace' : 'joinRace';
    j.addEventListener('click', () => api.sendAction({ kind: joined ? 'leaveRace' : 'joinRace' }));
    row.appendChild(j);
    if (joined && view.phase === 'waiting') {
      const st = el('button', null, 'START RACE');
      st.dataset.action = 'start';
      st.style.cssText = 'background:#39ff14;color:#041004;font-weight:bold';
      st.addEventListener('click', () => api.sendAction({ kind: 'start' }));
      row.appendChild(st);
    }
    return row;
  }

  function coopControls() {
    const row = el('div', 'cm-row');
    row.appendChild(el('span', 'cm-pill', `TEAM: everyone in the room (${roster.length})`));
    if (view.phase === 'waiting') {
      const st = el('button', null, 'START');
      st.dataset.action = 'start';
      st.style.cssText = 'background:#39ff14;color:#041004;font-weight:bold';
      st.addEventListener('click', () => api.sendAction({ kind: 'start' }));
      row.appendChild(st);
    }
    return row;
  }

  // ---- main render ----

  function render() {
    if (!view) { root.textContent = 'Loading…'; return; }
    syncDraft();
    if (seenGame !== view.gameId) { seen.clear(); seenGame = view.gameId; }
    results.update(view.phase === 'game_over' ? resultsOpts() : null);
    root.innerHTML = '';
    root.appendChild(statusLine());
    root.appendChild(el('div', 'cm-sub', MODE_INFO[view.mode].blurb));
    root.appendChild(modeControls());
    root.appendChild(view.mode === 'duel' ? seatControls() : view.mode === 'race' ? raceControls() : coopControls());
    const err = el('div', flash ? 'cm-err' : 'cm-err none', flash || '');
    if (!flash) err.style.animation = 'none';
    root.appendChild(err);

    const k = myKey();
    const boards = el('div', 'cm-boards');
    let mineIdx = -1;

    if (view.phase === 'setting' && mySeat()) {
      const seat = mySeat();
      const box = el('div', 'cm-setter');
      if (!view.setBy[seat]) {
        box.appendChild(el('h3', null, `YOUR SECRET CODE FOR ${seatName(other(seat)).toUpperCase()}`));
        const line = draftRow();
        box.appendChild(line);
        box.appendChild(guessControls(null));
      } else {
        box.appendChild(el('h3', null, 'CODE LOCKED IN'));
        const line = el('div', 'cm-line');
        const code = view.secrets[other(seat)] || [];
        for (let i = 0; i < PEGS; i++) { const s = el('div', 'cm-slot'); s.appendChild(pegEl(code[i])); line.appendChild(s); }
        box.appendChild(line);
        box.appendChild(el('div', 'cm-sub', `Waiting for ${seatName(other(seat))} to set yours…`));
      }
      root.appendChild(box);
    } else if (view.phase !== 'waiting' && view.phase !== 'setting') {
      if (view.mode === 'duel') {
        const order = k ? [k, other(k)] : ['a', 'b'];
        for (const s of order) {
          const isMine = s === k;
          const code = view.secrets[s] || null; // mine: hidden till end; theirs: the code I set
          boards.appendChild(boardEl(s, {
            title: isMine ? 'YOUR BOARD' : `${seatName(s)}`,
            secretShown: code,
            secretLabel: isMine || !k ? 'secret code' : 'your code',
            editable: isMine && canGuessNow(),
          }));
          if (isMine) mineIdx = boards.children.length - 1;
        }
      } else if (view.mode === 'race') {
        if (k && view.boards[k]) {
          boards.appendChild(boardEl(k, { title: 'YOUR BOARD', secretShown: view.secrets[k] || null, secretLabel: 'CPU code', editable: canGuessNow() }));
          mineIdx = boards.children.length - 1;
        }
        const others = Object.keys(view.boards).filter((x) => x !== k);
        if (others.length) {
          const col = el('div');
          col.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:420px';
          for (const o of others) {
            if (view.phase === 'game_over') col.appendChild(boardEl(o, { title: nick(o), secretShown: view.secrets[o] || null, secretLabel: 'CPU code' }));
            else col.appendChild(miniEl(o));
          }
          boards.appendChild(col);
        }
      } else if (view.boards.team) {
        boards.appendChild(boardEl('team', { title: 'TEAM BOARD', secretShown: view.secrets.team || null, secretLabel: 'CPU code', editable: canGuessNow() }));
        mineIdx = 0;
      }
      // The palette sits directly under my own board, so on a phone it isn't below the others.
      if (canGuessNow() && mineIdx >= 0) {
        const col = el('div');
        col.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px';
        const mine = boards.children[mineIdx];
        boards.insertBefore(col, mine);
        col.append(mine, guessControls(k));
      }
      root.appendChild(boards);
    } else {
      const intro = el('div', 'cm-board');
      intro.style.cssText += ';max-width:380px;font-size:13px;line-height:1.5';
      intro.innerHTML = '';
      intro.appendChild(el('div', null, 'Crack the hidden 4-peg code in 10 guesses. After each guess you get feedback pegs:'));
      const demoRow = el('div', 'cm-line');
      demoRow.style.justifyContent = 'center';
      for (const c of [0, 4, 4, 2]) { const s = el('div', 'cm-slot'); s.appendChild(pegEl(c)); demoRow.appendChild(s); }
      demoRow.appendChild(fbEl(1, 2));
      intro.appendChild(demoRow);
      intro.appendChild(el('div', 'cm-sub', 'e.g. one peg is exactly right, two more are the right colour in the wrong place.'));
      root.appendChild(intro);
    }

    root.appendChild(legend());

    // Mark everything rendered as seen so animations play only once.
    for (const [key, b] of Object.entries(view.boards)) seen.set(key, b.guesses.length);
    if (view.phase === 'game_over') revealedGame = view.gameId;
  }

  function sounds(prev, next) {
    if (!prev || prev.gameId !== next.gameId) {
      if (next.phase === 'setting' && (!prev || prev.phase !== 'setting')) sfx.play('turn');
      return;
    }
    if (next.phase === 'game_over' && prev.phase !== 'game_over') {
      const k = myKey();
      const won = next.result && next.result.winners;
      if (next.mode === 'coop') sfx.play(won && won.length ? 'win' : 'lose');
      else if (!k) sfx.play('point');
      else sfx.play(won && won.includes(k) ? 'win' : 'lose');
      return;
    }
    if (next.phase === 'playing' && prev.phase === 'setting') { sfx.play('go'); return; }
    const k = myKey();
    for (const [key, b] of Object.entries(next.boards)) {
      const pb = prev.boards[key];
      if (!pb || b.guesses.length <= pb.guesses.length) continue;
      const g = b.guesses[b.guesses.length - 1];
      if (key === k) {
        if (g.exact === PEGS) sfx.play('chime');
        else for (let i = 0; i < g.exact + g.near; i++) setTimeout(() => sfx.play(i < g.exact ? 'point' : 'blip'), 250 + i * 140);
        if (g.exact + g.near === 0) setTimeout(() => sfx.play('beep'), 250);
      } else sfx.play('tick');
    }
  }

  render();

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      clock.sync(snapshot && snapshot.now);
      // Don't replay animations for history that was already there on join.
      if (view) { seenGame = view.gameId; for (const [key, b] of Object.entries(view.boards)) seen.set(key, b.guesses.length); revealedGame = view.phase === 'game_over' ? view.gameId : -1; }
      render();
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        const prev = view;
        view = data;
        clock.sync(data.now);
        sounds(prev, data);
        render();
      } else if (data.kind === 'moveRejected') {
        setFlash(data.reason);
      }
    },
    applyRoster(r) {
      roster = r || [];
      render();
    },
    unmount() {
      document.removeEventListener('keydown', onKey);
      clearInterval(clockTimer);
      clearTimeout(flashTimer);
      clearTimeout(giveUpTimer);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
