// Word Trails — a last-letter word chain. On your turn, type a word that starts with the last
// letter of the previous word before the clock runs out (it shortens every lap). No repeats.
// Running out of time costs a life; the last player with lives left wins. A wrong word doesn't
// cost a life but takes a couple of seconds off your clock. Everyone sees the active player type.
// Server plugin: ../../../server/games/wordtrails.js (validates words, runs the clock and bots).
import { sfx } from '../sfx.js';
import { createBotBar } from '../tickBots.js';
import { createResults } from '../resultsPanel.js';
import { makeServerClock } from '../serverClock.js';

const PREF_KEY = 'gt-wordtrails-prefs';

const CSS = `
.wt-root { display: flex; flex-direction: column; gap: 10px; }
.wt-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.wt-status { font-weight: bold; }
.wt-meta { font-size: .85em; opacity: .75; }
.wt-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.wt-seg { display: inline-flex; border: 1px solid var(--border, #1f8f0c); border-radius: 4px; overflow: hidden; }
.wt-seg button { border: 0; border-radius: 0; padding: 5px 10px; font-size: .85em; }
.wt-seg button + button { border-left: 1px solid var(--border, #1f8f0c); }
.wt-seg button.on { background: #39ff14; color: #041004; font-weight: bold; }
.wt-label { font-size: .8em; opacity: .75; }
.wt-start { font-weight: bold; }
.wt-body { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
.wt-main { flex: 1 1 380px; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.wt-side { flex: 0 1 240px; min-width: 200px; display: flex; flex-direction: column; gap: 6px; }

.wt-stage { position: relative; border: 1px solid var(--border, #1f8f0c); border-radius: 8px; padding: 18px 14px 14px;
  background: radial-gradient(ellipse at 50% 0%, #0b1a0b, #030503 70%); box-shadow: inset 0 0 40px -16px #39ff14;
  display: flex; flex-direction: column; align-items: center; gap: 12px; min-height: 210px; }
.wt-stage.mine { border-color: #39ff14; box-shadow: inset 0 0 50px -12px #39ff14, 0 0 18px -6px #39ff14; }
.wt-stage.shake { animation: wt-shake .35s; }
@keyframes wt-shake { 20%, 60% { transform: translateX(-6px); } 40%, 80% { transform: translateX(6px); } }
.wt-who { font-size: .95em; letter-spacing: 1px; min-height: 1.3em; text-align: center; }
.wt-who b { color: var(--wt-c, #39ff14); }
.wt-line { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; justify-content: center; min-height: 64px; }
.wt-tile { width: 46px; height: 56px; display: grid; place-items: center; font-size: 30px; font-weight: bold;
  border-radius: 6px; text-transform: uppercase; border: 1px solid rgba(57,255,20,.35); background: #061006; color: #e9ffe0; }
.wt-tile.need { background: #39ff14; color: #041004; border-color: #39ff14; box-shadow: 0 0 16px -2px #39ff14; }
.wt-tile.ghost { opacity: .35; border-style: dashed; }
.wt-tile.pop { animation: wt-pop .18s ease-out; }
@keyframes wt-pop { 0% { transform: scale(1.25); } }
.wt-caret { width: 3px; height: 40px; background: #39ff14; animation: wt-blink 1s steps(2) infinite; margin-left: 2px; }
@keyframes wt-blink { 50% { opacity: 0; } }
.wt-form { display: flex; gap: 8px; width: 100%; max-width: 420px; }
.wt-input { flex: 1; min-width: 0; background: #000; color: #e9ffe0; border: 1px solid var(--border, #1f8f0c); border-radius: 4px;
  font: inherit; font-size: 1.1em; letter-spacing: 2px; padding: 8px 10px; text-transform: uppercase; }
.wt-input:focus { outline: none; border-color: #39ff14; box-shadow: 0 0 8px -2px #39ff14; }
.wt-input:disabled { opacity: .4; }
.wt-go { font-weight: bold; }
.wt-clock { width: 100%; height: 10px; border-radius: 5px; background: rgba(57,255,20,.12); overflow: hidden; }
.wt-clock-fill { height: 100%; width: 0; background: #39ff14; border-radius: 5px; box-shadow: 0 0 10px #39ff14; }
.wt-clock-fill.low { background: #ff4d4d; box-shadow: 0 0 10px #ff4d4d; }
.wt-secs { font-size: 1.35em; font-weight: bold; font-variant-numeric: tabular-nums; color: #39ff14; min-width: 3.2em; text-align: right; }
.wt-secs.low { color: #ff4d4d; animation: wt-blink 1s steps(2) infinite; }
.wt-countdown { font-size: 64px; font-weight: bold; color: #39ff14; text-shadow: 0 0 20px #39ff14; line-height: 1; }
.wt-toast { min-height: 1.3em; font-size: .9em; text-align: center; color: #ffb000; }
.wt-toast.bad { color: #ff8a8a; }

.wt-trail-head, .wt-side-head { display: flex; justify-content: space-between; align-items: baseline;
  border-bottom: 1px solid var(--border, #1f8f0c); padding-bottom: 3px; }
.wt-h { font-weight: bold; letter-spacing: 1px; color: #ffb000; }
.wt-count { font-size: .85em; opacity: .8; }
.wt-trail { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 2px; max-height: 168px; overflow-y: auto; padding: 4px 0; }
.wt-chip { display: inline-flex; align-items: baseline; padding: 3px 8px; border-radius: 12px; letter-spacing: 1.5px; font-size: .9em;
  border: 1px solid color-mix(in srgb, var(--wt-c) 55%, transparent); background: color-mix(in srgb, var(--wt-c) 10%, transparent);
  text-transform: uppercase; white-space: nowrap; }
.wt-chip .wt-end { color: var(--wt-c); font-weight: bold; text-decoration: underline; text-underline-offset: 3px; }
.wt-chip.opener { --wt-c: #9aa79a; font-style: italic; }
.wt-chip.fresh { animation: wt-in .45s cubic-bezier(.2,1.5,.4,1); }
@keyframes wt-in { 0% { transform: scale(.4); opacity: 0; } }
.wt-arrow { opacity: .4; font-size: .8em; padding: 0 2px; }

.wt-players { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.wt-player { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 4px; border: 1px solid rgba(57,255,20,.15); font-size: .88em; }
.wt-player.turn { border-color: var(--wt-c); background: color-mix(in srgb, var(--wt-c) 12%, transparent); }
.wt-player.you { box-shadow: inset 3px 0 0 #39ff14; }
.wt-player.out { opacity: .45; }
.wt-player.out .wt-name { text-decoration: line-through; }
.wt-player.hit { animation: wt-hit .6s; }
@keyframes wt-hit { 0%, 50% { background: rgba(255,77,77,.35); } }
.wt-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; background: var(--wt-c); box-shadow: 0 0 6px var(--wt-c); }
.wt-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wt-lives { color: #ff4d6d; letter-spacing: 1px; white-space: nowrap; }
.wt-lives .gone { color: #3a2a2e; }
.wt-stat { font-size: .78em; opacity: .75; white-space: nowrap; font-variant-numeric: tabular-nums; }
.wt-hint { font-size: .8em; opacity: .7; margin: 0; }
@media (prefers-reduced-motion: reduce) { .wt-chip.fresh, .wt-stage.shake, .wt-tile.pop, .wt-player.hit, .wt-secs.low, .wt-caret { animation: none; } }
@media (max-width: 520px) { .wt-tile { width: 34px; height: 44px; font-size: 22px; } .wt-countdown { font-size: 48px; } }
`;

let styled = false;
function ensureStyles() {
  if (styled) return;
  styled = true;
  const tag = document.createElement('style');
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

const DEFAULT_PREFS = { lives: 3, turnSecs: 12, minLen: 3 };
function loadPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { return { ...DEFAULT_PREFS }; }
}
function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* private mode */ } }

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const REASON_TEXT = {
  not_word: 'not in the dictionary',
  wrong_letter: 'wrong starting letter',
  too_short: 'too short',
  used: 'already on the trail',
  not_your_turn: "it's not your turn",
  not_playing: 'hold on…',
};

export function mount(container, api) {
  ensureStyles();
  const clock = makeServerClock();
  const prefs = loadPrefs();
  const results = createResults(container);

  const root = el('div', 'wt-root');
  const top = el('div', 'wt-top');
  const statusEl = el('div', 'wt-status', 'Loading…');
  const metaEl = el('div', 'wt-meta');
  top.append(statusEl, metaEl);

  // --- lobby controls ---
  const controls = el('div', 'wt-controls');
  const segs = {};
  const seg = (key, values, fmt) => {
    const wrap = el('div', 'wt-seg');
    segs[key] = {};
    for (const v of values) {
      const b = el('button', '', fmt(v));
      b.addEventListener('click', () => { prefs[key] = v; savePrefs(prefs); sfx.play('click'); renderControls(); });
      segs[key][v] = b;
      wrap.appendChild(b);
    }
    return wrap;
  };
  const startBtn = el('button', 'wt-start', 'START');
  startBtn.addEventListener('click', () => startRound());
  controls.append(
    el('span', 'wt-label', 'LIVES'), seg('lives', [1, 3, 5], (v) => '♥'.repeat(v)),
    el('span', 'wt-label', 'CLOCK'), seg('turnSecs', [8, 12, 20], (v) => `${v}s`),
    el('span', 'wt-label', 'MIN'), seg('minLen', [3, 4, 5], (v) => `${v}+`),
    startBtn,
  );
  const botBar = createBotBar(api);

  // --- stage ---
  const body = el('div', 'wt-body');
  const main = el('div', 'wt-main');
  const stage = el('div', 'wt-stage');
  const whoEl = el('div', 'wt-who');
  const lineEl = el('div', 'wt-line');
  const clockRow = el('div');
  clockRow.style.cssText = 'display:flex;align-items:center;gap:10px;width:100%;max-width:420px';
  const clockBar = el('div', 'wt-clock');
  const clockFill = el('div', 'wt-clock-fill');
  clockBar.appendChild(clockFill);
  const secsEl = el('div', 'wt-secs');
  clockRow.append(clockBar, secsEl);
  const form = el('form', 'wt-form');
  const input = el('input', 'wt-input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.autocapitalize = 'none';
  input.spellcheck = false;
  input.maxLength = 24;
  input.placeholder = 'type a word…';
  const goBtn = el('button', 'wt-go', 'GO');
  goBtn.type = 'submit';
  form.append(input, goBtn);
  const toastEl = el('div', 'wt-toast');
  stage.append(whoEl, lineEl, clockRow, form, toastEl);

  const trailHead = el('div', 'wt-trail-head');
  const trailCount = el('span', 'wt-count');
  trailHead.append(el('span', 'wt-h', 'THE TRAIL'), trailCount);
  const trailEl = el('div', 'wt-trail');
  main.append(stage, trailHead, trailEl);

  const side = el('div', 'wt-side');
  const sideHead = el('div', 'wt-side-head');
  sideHead.append(el('span', 'wt-h', 'PLAYERS'), el('span', 'wt-count', 'lives · words · wins'));
  const playersEl = el('ul', 'wt-players');
  side.append(sideHead, playersEl);
  body.append(main, side);

  const hint = el('p', 'wt-hint', 'Each word must start with the last letter of the one before it — no repeats. Run out of time and you lose a life; the clock gets shorter every lap. A wrong word costs no life, just a couple of seconds. Last player standing wins.');
  root.append(top, controls, botBar.el, body, hint);
  container.appendChild(root);

  let view = null;
  let prevView = null;
  let typingText = '';
  let typingTurn = null;
  let toastTimer = 0;
  let rafId = 0;
  let lastSecShown = null;
  let lastTypingSent = '';
  let renderedChainKey = '';

  const me = () => api.getClientId();
  const myTurn = () => view && view.phase === 'playing' && view.turnId === me() && view.turnEndsAt;
  const playerOf = (id) => view && view.players.find((p) => p.clientId === id);
  const inPlay = () => view && (view.phase === 'playing' || view.phase === 'countdown');

  function toast(text, bad) {
    toastEl.textContent = text;
    toastEl.className = `wt-toast${bad ? ' bad' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.textContent = ''; }, 2600);
  }

  function startRound() {
    sfx.play('click');
    api.sendAction({ kind: 'start', lives: prefs.lives, turnSecs: prefs.turnSecs, minLen: prefs.minLen });
  }

  function renderControls() {
    const lobby = !inPlay();
    controls.style.display = lobby ? '' : 'none';
    botBar.el.style.display = lobby ? '' : 'none';
    for (const key of Object.keys(segs)) {
      for (const [v, b] of Object.entries(segs[key])) b.classList.toggle('on', Number(v) === prefs[key]);
    }
    startBtn.textContent = view && view.phase === 'results' ? 'PLAY AGAIN' : 'START';
  }

  function renderStatus() {
    if (!view) return;
    const s = view.settings;
    metaEl.textContent = inPlay() || view.phase === 'results'
      ? `${'♥'.repeat(s.lives)} · ${s.turnSecs}s clock · ${s.minLen}+ letters`
      : '';
    if (view.phase === 'waiting') {
      const n = view.players.length;
      statusEl.textContent = n < 2 ? 'Start solo for a survival run, or add a bot / wait for friends.' : `${n} players ready — press START.`;
    } else if (view.phase === 'countdown') statusEl.textContent = 'Get ready…';
    else if (view.phase === 'playing') {
      const p = playerOf(view.turnId);
      statusEl.textContent = view.turnId === me() ? 'YOUR TURN!' : p ? `${p.nickname}'s turn` : '…';
    } else if (view.phase === 'results') {
      statusEl.textContent = view.solo ? `Run over — a trail of ${view.chainLength} words.` : 'Round over.';
    }
  }

  // The big letter row: [NEED][typed letters...][caret]
  function renderLine() {
    lineEl.textContent = '';
    if (!view) return;
    if (view.phase === 'countdown') {
      const left = Math.max(0, Math.ceil((view.startsAt - clock.now()) / 1000));
      lineEl.appendChild(el('div', 'wt-countdown', String(left || 'GO')));
      return;
    }
    const need = view.required;
    if (!need) return;
    const mine = myTurn();
    let rest = '';
    if (mine) {
      const v = input.value.toLowerCase().replace(/[^a-z]/g, '');
      rest = v.startsWith(need) ? v.slice(1) : v;
    } else if (view.phase === 'playing' && typingTurn === view.turnId) {
      rest = typingText.startsWith(need) ? typingText.slice(1) : typingText;
    }
    const needTile = el('div', 'wt-tile need', need);
    lineEl.appendChild(needTile);
    for (const ch of rest.slice(0, 14)) lineEl.appendChild(el('div', 'wt-tile', ch));
    if (view.phase === 'playing' && view.turnEndsAt) {
      if (!rest) for (let k = 1; k < view.settings.minLen; k++) lineEl.appendChild(el('div', 'wt-tile ghost', ''));
      lineEl.appendChild(el('div', 'wt-caret'));
    }
  }

  function renderWho() {
    whoEl.textContent = '';
    stage.classList.toggle('mine', !!myTurn());
    if (!view) return;
    const p = playerOf(view.turnId);
    if (view.phase === 'playing' && p) {
      stage.style.setProperty('--wt-c', p.color);
      if (!view.turnEndsAt) {
        // post-timeout beat
        const ev = view.lastEvent;
        whoEl.append(ev && ev.kind === 'timeout' ? `${ev.name} ran out of time${ev.out ? ' and is OUT!' : ' — loses a life!'}` : '…');
        return;
      }
      if (p.clientId === me()) whoEl.append('Your word — starts with ');
      else { const b = el('b', '', p.nickname); whoEl.append(b, ' needs a word starting with '); }
      const L = el('b', '', view.required.toUpperCase());
      L.style.color = '#39ff14';
      whoEl.appendChild(L);
    } else if (view.phase === 'countdown') whoEl.textContent = 'The trail starts with…';
    else if (view.phase === 'results' && view.required) whoEl.textContent = 'Final letter';
    else if (view.phase === 'waiting') whoEl.textContent = 'WORD TRAILS';
  }

  function renderInput() {
    const mine = !!myTurn();
    input.disabled = !mine;
    goBtn.disabled = !mine;
    if (!mine) input.value = '';
    else if (document.activeElement !== input) input.focus({ preventScroll: true });
  }

  function renderTrail() {
    if (!view) return;
    const chain = view.chain || [];
    trailCount.textContent = `${view.chainLength} word${view.chainLength === 1 ? '' : 's'}`;
    const key = `${view.roundId}:${view.chainLength}`;
    if (key === renderedChainKey) return;
    const fresh = renderedChainKey.split(':')[0] === String(view.roundId);
    renderedChainKey = key;
    trailEl.textContent = '';
    chain.forEach((c, i) => {
      if (i > 0) trailEl.appendChild(el('span', 'wt-arrow', '›'));
      const chip = el('span', `wt-chip${c.by ? '' : ' opener'}${fresh && i === chain.length - 1 && c.by ? ' fresh' : ''}`);
      if (c.color) chip.style.setProperty('--wt-c', c.color);
      chip.title = c.by ? c.name : 'opening word';
      chip.append(c.word.slice(0, -1), el('span', 'wt-end', c.word.slice(-1)));
      trailEl.appendChild(chip);
    });
    trailEl.scrollTop = trailEl.scrollHeight;
  }

  function renderPlayers() {
    if (!view) return;
    playersEl.textContent = '';
    const order = view.order && view.order.length ? view.order : [];
    const ps = [...view.players].sort((a, b) => {
      const ia = order.indexOf(a.clientId);
      const ib = order.indexOf(b.clientId);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    const ev = view.lastEvent;
    const hitId = ev && ev.kind === 'timeout' && prevView && prevView.lastEvent !== ev && (!prevView.lastEvent || prevView.lastEvent.at !== ev.at) ? ev.clientId : null;
    for (const p of ps) {
      const li = el('li', 'wt-player');
      li.style.setProperty('--wt-c', p.color);
      const playing = p.inRound && order.includes(p.clientId);
      if (view.phase === 'playing' && p.clientId === view.turnId) li.classList.add('turn');
      if (p.clientId === me()) li.classList.add('you');
      if (p.out) li.classList.add('out');
      if (p.clientId === hitId) li.classList.add('hit');
      const name = el('span', 'wt-name', `${view.phase === 'playing' && p.clientId === view.turnId ? '▶ ' : ''}${p.nickname}${p.clientId === me() ? ' (you)' : ''}`);
      const lives = el('span', 'wt-lives');
      if (playing && (inPlay() || view.phase === 'results')) {
        const max = view.settings.lives;
        lives.append('♥'.repeat(p.lives));
        if (max > p.lives) lives.appendChild(el('span', 'gone', '♥'.repeat(max - p.lives)));
      } else lives.append(el('span', 'wt-stat', inPlay() ? 'watching' : ''));
      const stat = el('span', 'wt-stat', `${p.words}w · ${p.wins}🏆`);
      li.append(el('span', 'wt-dot'), name, lives, stat);
      playersEl.appendChild(li);
    }
  }

  function renderResults() {
    if (!view || view.phase !== 'results') { results.update(null); return; }
    const id = me();
    const order = view.order || [];
    const ps = view.players.filter((p) => order.includes(p.clientId));
    ps.sort((a, b) => (b.clientId === view.winner) - (a.clientId === view.winner) || b.lives - a.lives || b.words - a.words);
    const mine = ps.find((p) => p.clientId === id);
    let title;
    let outcome = 'over';
    if (view.solo) {
      title = `TRAIL OF ${view.chainLength}`;
      outcome = mine && mine.bestTrail === view.chainLength && view.chainLength > 0 ? 'win' : 'over';
    } else if (mine) {
      outcome = view.winner === id ? 'win' : 'lose';
      title = view.winner === id ? 'YOU WIN!' : 'YOU LOSE';
    } else {
      const w = playerOf(view.winner);
      title = w ? `${w.nickname.toUpperCase()} WINS!` : 'ROUND OVER';
    }
    const longest = (view.chain || []).filter((c) => c.by).reduce((a, c) => (c.word.length > (a ? a.word.length : 0) ? c : a), null);
    results.update({
      title,
      subtitle: `${view.chainLength}-word trail${longest ? ` · longest: ${longest.word.toUpperCase()} (${longest.name})` : ''}`,
      outcome,
      rows: ps.map((p) => ({
        name: p.nickname,
        value: view.solo ? `${p.words} words · best ${p.bestTrail}` : `${p.words} word${p.words === 1 ? '' : 's'} · ${p.letters} letters`,
        win: p.clientId === view.winner,
        you: p.clientId === id,
      })),
      rematch: { label: 'PLAY AGAIN', onClick: () => startRound() },
    });
  }

  function sounds(prev, next) {
    if (!prev) return;
    if (prev.phase !== 'playing' && next.phase === 'playing') sfx.play('go');
    if (next.phase === 'countdown' && prev.phase !== 'countdown') sfx.play('beep');
    if (next.chainLength > prev.chainLength && next.roundId === prev.roundId) sfx.play('point');
    const ev = next.lastEvent;
    if (ev && ev.kind === 'timeout' && (!prev.lastEvent || prev.lastEvent.at !== ev.at)) sfx.play(ev.out ? 'crash' : 'hurt');
    if (ev && ev.kind === 'reject' && ev.clientId !== me() && (!prev.lastEvent || prev.lastEvent.at !== ev.at)) sfx.play('error', { vol: 0.5 });
    if (next.phase === 'playing' && next.turnId === me() && next.turnEndsAt && (prev.turnId !== me() || !prev.turnEndsAt)) sfx.play('turn');
    if (next.phase === 'results' && prev.phase !== 'results') {
      if (next.solo) sfx.play('chime');
      else if (next.winner === me()) sfx.play('win');
      else if ((next.order || []).includes(me())) sfx.play('lose');
      else sfx.play('chime');
    }
  }

  function onState(data) {
    clock.sync(data.serverNow);
    prevView = view;
    view = data;
    if (!prevView || prevView.turnId !== view.turnId || prevView.chainLength !== view.chainLength) {
      typingText = '';
      typingTurn = null;
      lastTypingSent = '';
      if (prevView && prevView.chainLength !== view.chainLength) input.value = '';
    }
    // When a turn becomes mine, pre-fill the required letter so I only type the rest.
    if (myTurn() && (!prevView || prevView.turnId !== me() || !prevView.turnEndsAt || prevView.chainLength !== view.chainLength)) {
      input.value = view.required.toUpperCase();
    }
    const ev = view.lastEvent;
    if (ev && ev.kind === 'reject' && ev.clientId !== me() && (!prevView || !prevView.lastEvent || prevView.lastEvent.at !== ev.at)) {
      const p = playerOf(ev.clientId);
      toast(`${p ? p.nickname : '?'}: ${ev.word.toUpperCase() || '—'} — ${REASON_TEXT[ev.reason] || 'rejected'}`, true);
    }
    sounds(prevView, view);
    renderAll();
  }

  function renderAll() {
    renderControls();
    renderStatus();
    renderWho();
    renderInput();
    renderLine();
    renderTrail();
    renderPlayers();
    renderResults();
    if (view) botBar.update(view.players);
  }

  function frame() {
    rafId = requestAnimationFrame(frame);
    if (!view) return;
    if (view.phase === 'countdown') {
      const left = Math.max(0, Math.ceil((view.startsAt - clock.now()) / 1000));
      if (left !== lastSecShown) { lastSecShown = left; renderLine(); if (left > 0) sfx.play('tick'); }
    }
    if (view.phase === 'playing' && view.turnEndsAt && view.turnMs) {
      const leftMs = Math.max(0, view.turnEndsAt - clock.now());
      const frac = Math.min(1, leftMs / view.turnMs);
      clockFill.style.width = `${(frac * 100).toFixed(2)}%`;
      const low = leftMs < 3000;
      clockFill.classList.toggle('low', low);
      secsEl.classList.toggle('low', low);
      secsEl.textContent = `${(leftMs / 1000).toFixed(1)}s`;
      const sec = Math.ceil(leftMs / 1000);
      if (myTurn() && low && sec !== lastSecShown && sec > 0) { lastSecShown = sec; sfx.play('tick'); }
    } else {
      clockFill.style.width = view.phase === 'playing' ? '0%' : '100%';
      clockFill.classList.remove('low');
      secsEl.classList.remove('low');
      secsEl.textContent = view.phase === 'playing' ? '—' : '';
    }
  }

  input.addEventListener('input', () => {
    if (!myTurn()) return;
    const need = view.required;
    let v = input.value.toLowerCase().replace(/[^a-z]/g, '');
    // Keep the required first letter in place even if the player selects-all and retypes.
    if (v && v[0] !== need) v = need + v;
    if (!v) v = need;
    input.value = v.toUpperCase();
    renderLine();
    const tiles = lineEl.querySelectorAll('.wt-tile:not(.need)');
    if (tiles.length) tiles[tiles.length - 1].classList.add('pop');
    if (v !== lastTypingSent) {
      lastTypingSent = v;
      api.sendAction({ kind: 'typing', text: v });
    }
  });
  input.addEventListener('keydown', (e) => {
    // Don't let Backspace eat the locked first letter.
    if (e.key === 'Backspace' && input.value.length <= 1 && input.selectionStart <= 1 && input.selectionEnd <= 1) e.preventDefault();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!myTurn()) return;
    const word = input.value.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length < 2) return;
    api.sendAction({ kind: 'submit', word });
  });

  renderAll();
  rafId = requestAnimationFrame(frame);

  return {
    applySnapshot(snapshot) {
      if (snapshot) onState({ kind: 'state', ...snapshot });
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') onState(data);
      else if (data.kind === 'typing') {
        if (!view || data.clientId !== view.turnId) return;
        typingText = data.text || '';
        typingTurn = data.clientId;
        renderLine();
      } else if (data.kind === 'rejected') {
        sfx.play('error');
        if (data.reason === 'not_playing') return;
        const pen = view && view.penaltyMs ? ` (−${view.penaltyMs / 1000}s)` : '';
        toast(`${(data.word || '').toUpperCase() || 'That'} — ${REASON_TEXT[data.reason] || 'rejected'}${data.reason === 'not_your_turn' ? '' : pen}`, true);
        stage.classList.remove('shake');
        void stage.offsetWidth;
        stage.classList.add('shake');
        if (myTurn()) { input.focus(); input.setSelectionRange(1, input.value.length); }
      }
    },
    applyRoster() { /* names come from the server's player list */ },
    unmount() {
      cancelAnimationFrame(rafId);
      clearTimeout(toastTimer);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
