// Spelling Bee: hear a word (or read its pronunciation guide and clues), then spell it.
// Formats: RACE (everyone spells the same 10 words at once), BEE (take turns, one miss and you're
// out), PRONOUNCER (players take turns saying a word for everyone else). Type or tap the keys;
// ENTER submits, BACKSPACE deletes, ESC clears, SPACE hears the word again.
// Server plugin: ../../../server/games/spellingbee.js. The word never reaches a speller before the
// reveal: spoken clues are pre-made clips under random IDs (./audio/), the rest is blanked text.
import { sfx } from '../sfx.js';
import { createBotBar } from '../tickBots.js';
import { createResults } from '../resultsPanel.js';
import { makeServerClock } from '../serverClock.js';
import { injectStyle, el, fmtClock, reduced } from '../dom.js';

const CSS = `
.sb-root { display: flex; flex-direction: column; gap: 10px; }
.sb-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.sb-status { font-weight: bold; letter-spacing: .5px; }
.sb-timer { font-size: 1.5em; font-weight: bold; color: #39ff14; font-variant-numeric: tabular-nums; min-height: 1.2em; }
.sb-timer.low { color: #ff4d4d; animation: sb-blink 1s steps(2) infinite; }
@keyframes sb-blink { 50% { opacity: .55; } }

.sb-setup { border: 1px solid var(--border, #1f8f0c); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
  background: rgba(57,255,20,.03); }
.sb-seg-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sb-seg-label { width: 64px; font-size: .78em; letter-spacing: 1px; opacity: .7; }
.sb-seg { display: inline-flex; flex-wrap: wrap; border: 1px solid #2c5a24; border-radius: 6px; overflow: hidden; }
.sb-seg button { border: 0; border-right: 1px solid #2c5a24; border-radius: 0; background: transparent; color: #9fd89a; padding: 5px 12px; margin: 0; font: inherit; cursor: pointer; }
.sb-seg button:last-child { border-right: 0; }
.sb-seg button:hover:not(.on) { background: rgba(57,255,20,.12); color: #d8ffd0; }
.sb-seg button.on { background: #39ff14; color: #041004; font-weight: bold; }
.sb-help { font-size: .86em; opacity: .8; line-height: 1.45; max-width: 70ch; }
.sb-locked { color: #ffd23f; font-size: .9em; line-height: 1.45; }
.sb-go { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sb-start { font-weight: bold; padding: 6px 22px; }
.sb-need { color: #ffb000; font-size: .85em; }

.sb-body { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
.sb-stage { position: relative; flex: 1 1 460px; max-width: 680px; min-width: 0; min-height: 360px; box-sizing: border-box;
  border: 1px solid var(--border, #1f8f0c); border-radius: 8px; padding: 14px 14px 16px; display: flex; flex-direction: column; gap: 12px;
  background: radial-gradient(ellipse at 50% 0%, #182812, #070b05 70%); box-shadow: inset 0 0 40px -14px #39ff14; overflow: hidden; }
.sb-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.sb-role { font-weight: bold; color: #d8ffd0; }
.sb-role.me { color: #ffd23f; }
.sb-tier { font-size: .75em; font-weight: bold; letter-spacing: 1.5px; padding: 2px 8px; border-radius: 10px; border: 1px solid currentColor; }
.sb-tier.easy { color: #39ff14; } .sb-tier.medium { color: #3ad7ff; } .sb-tier.hard { color: #ffb000; } .sb-tier.expert { color: #ff5c9a; }
.sb-bar { height: 4px; border-radius: 2px; background: rgba(57,255,20,.12); overflow: hidden; }
.sb-bar > i { display: block; height: 100%; width: 100%; background: #39ff14; transform-origin: left; }
.sb-bar.low > i { background: #ff4d4d; }
.sb-label { font-size: .74em; letter-spacing: 1.5px; opacity: .65; }
.sb-sub { font-size: .9em; opacity: .8; text-align: center; }

.sb-clue { display: flex; flex-direction: column; gap: 9px; padding: 12px; border-radius: 8px; border: 1px solid rgba(57,255,20,.18); background: rgba(0,0,0,.25); }
.sb-audio { display: flex; gap: 8px; flex-wrap: wrap; }
.sb-hear { display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px; border: 1px solid #ffd23f; border-radius: 6px; background: transparent;
  color: #ffd23f; font: inherit; font-weight: bold; letter-spacing: .5px; cursor: pointer; margin: 0; }
.sb-hear:hover { background: rgba(255,210,63,.14); color: #ffe78a; }
.sb-hear.big { font-size: 1.12em; padding: 11px 20px; }
.sb-hear.icon { padding: 4px 7px; border-color: rgba(255,210,63,.5); }
.sb-hear.playing { background: #ffd23f; color: #1a1200; box-shadow: 0 0 16px rgba(255,210,63,.55); }
.sb-hear.nudge { animation: sb-nudge 1.1s ease-in-out infinite; }
@keyframes sb-nudge { 50% { box-shadow: 0 0 0 5px rgba(255,210,63,.25), 0 0 18px rgba(255,210,63,.6); } }
.sb-hear svg { flex: none; }
.sb-say { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.sb-resp { font-size: 1.7em; font-weight: bold; color: #ffd23f; letter-spacing: 1px; word-break: break-word; }
.sb-def { line-height: 1.45; }
.sb-pos { display: inline-block; font-size: .78em; font-style: italic; color: #3ad7ff; margin-right: 8px; }
.sb-sent { font-style: italic; opacity: .85; line-height: 1.45; }
.sb-blank { display: inline-block; min-width: 3.2em; border-bottom: 2px solid #ffb000; margin: 0 2px; }
.sb-facts { display: flex; gap: 14px; flex-wrap: wrap; font-size: .88em; color: #9fd89a; }
.sb-facts b { color: #ffd23f; }
.sb-aloud { color: #3ad7ff; font-size: .92em; }

.sb-word { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.sb-tiles { display: flex; gap: 5px; justify-content: center; max-width: 100%; --sz: 48px; }
.sb-tile { width: var(--sz); height: calc(var(--sz) * 1.16); font-size: calc(var(--sz) * .56); flex: none; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center; position: relative; font-weight: bold; color: #d8ffd0; user-select: none;
  border: 2px solid rgba(57,255,20,.22); border-radius: 6px; }
.sb-tile.full { border-color: rgba(57,255,20,.7); background: rgba(57,255,20,.06); }
.sb-tile.pop { animation: sb-pop .12s ease-out; }
@keyframes sb-pop { from { transform: scale(1.18); } }
.sb-tile.ghost { color: rgba(255,210,63,.45); border-style: dashed; }
.sb-tile.over { border-color: #ff8a3a; }
.sb-tile.cursor::after { content: ''; position: absolute; left: 22%; right: 22%; bottom: 14%; height: 3px; background: #39ff14; animation: sb-blink 1s steps(2) infinite; }
.sb-tiles.good .sb-tile.full { background: #2e9e2a; border-color: #2e9e2a; color: #fff; }
.sb-tiles.bad .sb-tile.full { background: #8f2b2b; border-color: #b33a3a; color: #fff; }
.sb-tiles.bad { animation: sb-shake .35s ease-in-out; }
.sb-tiles.live .sb-tile.full { border-color: #3ad7ff; color: #bff3ff; }
@keyframes sb-shake { 20% { transform: translateX(-8px); } 40% { transform: translateX(7px); } 60% { transform: translateX(-5px); } 80% { transform: translateX(3px); } }
.sb-verdict { font-weight: bold; font-size: 1.1em; }
.sb-verdict.good { color: #39ff14; } .sb-verdict.bad { color: #ff7a7a; }
.sb-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.sb-actions button { margin: 0; }
.sb-submit { font-weight: bold; padding: 7px 22px; }
.sb-keys { display: flex; flex-direction: column; gap: 6px; width: 100%; max-width: 520px; }
.sb-keys.off { opacity: .4; pointer-events: none; }
.sb-krow { display: flex; gap: 5px; justify-content: center; }
.sb-key { flex: 1 1 0; max-width: 44px; height: 50px; padding: 0; margin: 0; font: inherit; font-weight: bold; font-size: 1.05em; text-transform: uppercase;
  border: 0; border-radius: 5px; background: #2f3f2f; color: #e8ffe0; cursor: pointer; touch-action: manipulation; }
.sb-key.wide { max-width: 70px; flex-grow: 1.6; font-size: .78em; }
.sb-key:hover { filter: brightness(1.3); background: #2f3f2f; color: #e8ffe0; }
.sb-key:active { transform: translateY(1px); }

.sb-reveal { display: flex; flex-direction: column; align-items: center; gap: 9px; text-align: center; padding: 6px 0 2px; }
.sb-answer { font-size: 2.2em; font-weight: bold; letter-spacing: 4px; color: #ffd23f; text-shadow: 0 0 14px rgba(255,210,63,.45); word-break: break-all;
  animation: sb-in .35s cubic-bezier(.2,1.4,.4,1); }
@keyframes sb-in { from { opacity: 0; transform: scale(.7); } }
.sb-alts { font-size: .85em; opacity: .75; }
.sb-diff .sb-tile { --sz: inherit; }
.sb-tile.eq { border-color: #2e9e2a; background: rgba(46,158,42,.25); }
.sb-tile.sub { border-color: #d24a4a; background: rgba(210,74,74,.3); color: #ffd0d0; }
.sb-tile.sub::after { content: attr(data-want); position: absolute; bottom: -1.35em; left: 0; right: 0; font-size: .52em; color: #ffd23f; }
.sb-tile.ins { border-color: #d24a4a; color: #ff9a9a; text-decoration: line-through; text-decoration-thickness: 3px; opacity: .8; }
.sb-tile.del { border: 2px dashed #ffd23f; color: #ffd23f; }
.sb-diff { padding-bottom: 1.1em; }
.sb-legend { font-size: .76em; opacity: .7; display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
.sb-legend i { font-style: normal; font-weight: bold; }
.sb-next { font-weight: bold; min-width: 12em; }

.sb-pick { display: flex; flex-direction: column; gap: 12px; }
.sb-sugg { padding: 12px; border: 1px solid rgba(255,210,63,.35); border-radius: 8px; display: flex; flex-direction: column; gap: 8px; background: rgba(0,0,0,.25); transition: opacity .2s; }
.sb-sugg.dim { opacity: .35; }
.sb-sugg-word { font-size: 2em; font-weight: bold; color: #ffd23f; letter-spacing: 3px; word-break: break-all; }
.sb-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sb-row.between { justify-content: space-between; }
.sb-pick input[type="text"] { flex: 1 1 200px; min-width: 0; font: inherit; padding: 6px 8px; }
.sb-rec { font-weight: bold; }
.sb-rec.on { background: #b33a3a; border-color: #ff6b6b; color: #fff; animation: sb-nudge 1s ease-in-out infinite; }
.sb-check { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: .92em; }
.sb-check input { width: 18px; height: 18px; accent-color: #39ff14; margin: 0; }
.sb-msg { min-height: 1.2em; color: #ff8a8a; font-size: .9em; }
.sb-msg.ok { color: #39ff14; }
.sb-send { font-weight: bold; align-self: flex-start; padding: 7px 22px; }
.sb-wait { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; min-height: 220px; text-align: center; }
.sb-wait-big { font-size: 1.35em; font-weight: bold; color: #d8ffd0; }
.sb-dots::after { content: ''; animation: sb-dots 1.2s steps(4) infinite; }
@keyframes sb-dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }

.sb-intro { display: flex; flex-direction: column; gap: 10px; line-height: 1.5; }
.sb-title { font-size: 2em; font-weight: bold; letter-spacing: 6px; color: #ffd23f; text-shadow: 0 0 16px rgba(255,210,63,.4); text-align: center; margin: 6px 0 2px; }
.sb-intro p { margin: 0; }
.sb-intro ul { margin: 0; padding-left: 1.2em; }
.sb-intro li { margin: 2px 0; }
.sb-pts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; text-align: center; }
.sb-pts div { border: 1px solid currentColor; border-radius: 6px; padding: 6px 2px; font-size: .85em; }
.sb-pts b { display: block; font-size: 1.25em; }

.sb-review { display: flex; flex-direction: column; gap: 5px; }
.sb-rv { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(57,255,20,.14); background: rgba(0,0,0,.2); }
.sb-rv.miss { border-color: rgba(255,90,90,.35); }
.sb-rv-word { font-weight: bold; letter-spacing: 1px; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.sb-rv-you { font-size: .85em; color: #ff8a8a; text-decoration: line-through; margin-left: 6px; font-weight: normal; letter-spacing: 0; }
.sb-rv-pts { font-weight: bold; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sb-rv.miss .sb-rv-pts { color: #ff8a8a; }
.sb-rv .sb-tier { font-size: .62em; }
.sb-big { font-size: 1.6em; font-weight: bold; color: #ffd23f; text-align: center; }

.sb-side { flex: 1 1 200px; min-width: 0; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 6px; }
.sb-side > b { flex-basis: 100%; color: #ffb000; letter-spacing: 1px; }
.sb-pl { flex: 1 1 190px; max-width: 100%; box-sizing: border-box; display: flex; gap: 8px; align-items: center; padding: 5px 8px; border: 1px solid rgba(57,255,20,.15); border-radius: 5px; }
.sb-pl.you { box-shadow: inset 3px 0 0 #39ff14; }
.sb-pl.out { opacity: .45; }
.sb-pl.turn { border-color: #3ad7ff; box-shadow: 0 0 10px -3px #3ad7ff; }
.sb-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.sb-pl-main { flex: 1; min-width: 0; }
.sb-pl-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .92em; }
.sb-pl-meta { font-size: .74em; opacity: .7; white-space: nowrap; }
.sb-tag { font-size: .68em; font-weight: bold; letter-spacing: 1px; white-space: nowrap; padding: 1px 6px; border-radius: 8px; border: 1px solid currentColor; opacity: .9; }
.sb-tag.good { color: #39ff14; } .sb-tag.bad { color: #ff7a7a; } .sb-tag.live { color: #3ad7ff; } .sb-tag.dim { color: #9fd89a; opacity: .6; }

.sb-toast { position: absolute; left: 50%; top: 10px; transform: translate(-50%, -8px); z-index: 5; padding: 6px 14px; border-radius: 6px;
  background: #0b140a; border: 1px solid currentColor; color: #ffd23f; font-weight: bold; text-align: center; max-width: calc(100% - 40px);
  opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; }
.sb-toast.show { opacity: 1; transform: translate(-50%, 0); }
.sb-float { position: absolute; left: 50%; top: 45%; z-index: 4; font-size: 2em; font-weight: bold; color: #39ff14; text-shadow: 0 0 12px #39ff14;
  pointer-events: none; animation: sb-float 1.1s ease-out forwards; }
@keyframes sb-float { from { opacity: 1; transform: translate(-50%, 0); } to { opacity: 0; transform: translate(-50%, -60px); } }
.sb-count { position: absolute; inset: 0; z-index: 6; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  background: rgba(3,8,3,.94); }
.sb-count[hidden] { display: none; }
.sb-count b { font-size: 5em; color: #ffd23f; text-shadow: 0 0 24px rgba(255,210,63,.6); line-height: 1; }

@media (max-width: 560px) {
  .sb-stage { padding: 10px 8px 12px; }
  .sb-key { height: 46px; }
  .sb-seg-label { width: auto; flex-basis: 100%; }
  .sb-answer { font-size: 1.7em; letter-spacing: 2px; }
  .sb-resp { font-size: 1.4em; }
}
@media (prefers-reduced-motion: reduce) {
  .sb-tile, .sb-tiles, .sb-answer, .sb-hear, .sb-rec, .sb-float, .sb-timer.low, .sb-tile.cursor::after { animation: none !important; }
}
`;

const AUDIO_DIR = new URL('./audio/', import.meta.url);
const KEYS = ['qwertyuiop', 'asdfghjkl', '+zxcvbnm-'];
const MAX_LEN = 30;
const REC_MS = 6000;
const MAX_CLIP_CHARS = 48000; // server limit (base64)
const CLIP_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac'];
const TIER_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
const POINTS = { easy: 100, medium: 200, hard: 300, expert: 400 };
const LEVEL_OPTS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['expert', 'Expert'], ['mix', 'Mix']];
const FORMAT_OPTS = [['race', 'Race'], ['bee', 'Bee'], ['pronounce', 'Pronouncer']];
const CLUE_OPTS = [['spoken', 'Spoken'], ['written', 'Written (no sound)']];
const FORMAT_HELP = {
  race: 'Everyone spells the same 10 words at once. One try per word: faster answers score more, and a hint (first letter and length) halves the points. Highest total wins. Add a bot to race the computer.',
  bee: 'A classic spelling bee. Players take turns, one word each; spell yours wrong and you are out at the end of the round (if everyone misses, everyone stays in). Last speller standing wins. On your own it is survival: how many can you spell in a row?',
  pronounce: 'Players take turns as the pronouncer: pick the suggested word or any word you like, record yourself saying it (or say it on voice chat), and everyone else spells it. Needs at least two people.',
};
const CLUE_HELP = {
  spoken: 'The word is read out loud, with its definition and an example sentence.',
  written: 'No sound needed: you get a pronunciation guide (like uh-KAH-muh-dayt, capitals stressed), the number of letters, the definition and an example sentence.',
};
const SPEAKER = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4M18 6.3a8 8 0 0 1 0 11.4"/></svg>';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const fileUrl = (id) => new URL(`${id}.mp3`, AUDIO_DIR).href;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const bestKey = (level) => `gt-sb-streak-${level}`;
function readBest(level) { try { return parseInt(localStorage.getItem(bestKey(level)), 10) || 0; } catch { return 0; } }
function writeBest(level, n) { try { localStorage.setItem(bestKey(level), String(n)); } catch { /* private mode */ } }

// Edit script turning `a` (what was typed) into `b` (the answer), for the letter-by-letter reveal.
export function align(a, b) {
  const n = a.length, m = b.length;
  const d = Array.from({ length: n + 1 }, (_, i) => { const r = new Array(m + 1).fill(0); r[0] = i; return r; });
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  const ops = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      ops.push(a[i - 1] === b[j - 1] ? { k: 'eq', c: a[i - 1] } : { k: 'sub', c: a[i - 1], want: b[j - 1] });
      i--; j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) { ops.push({ k: 'ins', c: a[i - 1] }); i--; }
    else { ops.push({ k: 'del', c: b[j - 1] }); j--; }
  }
  return ops.reverse();
}

export function mount(container, api) {
  injectStyle(CSS);
  const clock = makeServerClock();
  const results = createResults(container);
  const botBar = createBotBar(api);
  if (api.ranked) botBar.el.style.display = 'none';

  let view = null;
  let typed = '';
  let turnSeen = null; // turn id `typed` belongs to
  let popAt = -1; // tile that just got a letter (animates once)
  let pendingSubmit = null; // turn id we sent a submit for, until the server confirms
  let readySent = null;
  let autoplayed = null; // turn id whose word has auto-played
  let nudge = false; // autoplay was blocked by the browser: pulse the HEAR button
  let countdownTurn = null;
  let startedSeen = null;
  let lastSecond = null;
  let roundSeen = null;
  let resultsSeen = null;
  let best = null; // { gameId, level, best, isNew } for solo survival
  let player = null;
  let playingKey = null;
  let clipCache = { id: null, url: null };
  let rec = freshRec();
  let pick = null; // the pronouncer's panel, kept across renders so inputs keep their text
  let refs = {};
  let toastTimer = null;
  let rafId = 0;
  const hearBtns = new Map();

  // ---- layout
  const root = el('div', 'sb-root');
  const top = el('div', 'sb-top');
  const statusEl = el('div', 'sb-status', 'Loading...');
  const timerEl = el('div', 'sb-timer');
  top.append(statusEl, timerEl);

  const setup = el('div', 'sb-setup');
  const setupBody = el('div');
  setupBody.style.cssText = 'display:flex;flex-direction:column;gap:8px';
  const go = el('div', 'sb-go');
  const startBtn = el('button', 'sb-start', 'START');
  startBtn.addEventListener('click', () => { sfx.play('select'); api.sendAction({ kind: 'start' }); });
  const needEl = el('span', 'sb-need');
  go.append(startBtn, needEl, botBar.el);
  setup.append(setupBody, go);

  const body = el('div', 'sb-body');
  const stage = el('div', 'sb-stage');
  stage.setAttribute('aria-live', 'polite');
  const toastEl = el('div', 'sb-toast');
  toastEl.setAttribute('role', 'status');
  const countEl = el('div', 'sb-count');
  countEl.hidden = true;
  const countNum = el('b');
  const countSub = el('div', 'sb-sub');
  countEl.append(el('div', 'sb-label', 'GET READY'), countNum, countSub);
  const side = el('div', 'sb-side');
  body.append(stage, side);
  root.append(top, setup, body);
  container.appendChild(root);

  const keys = el('div', 'sb-keys');
  for (const row of KEYS) {
    const r = el('div', 'sb-krow');
    for (const k of row) {
      const b = el('button', `sb-key${k === '+' || k === '-' ? ' wide' : ''}`, k === '+' ? 'ENTER' : k === '-' ? 'BACK' : k);
      b.type = 'button';
      b.setAttribute('aria-label', k === '+' ? 'Submit' : k === '-' ? 'Delete letter' : k);
      b.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus off, so ENTER isn't a second click
      b.addEventListener('click', () => { if (k === '+') submit(); else if (k === '-') back(); else addLetter(k); });
      r.append(b);
    }
    keys.append(r);
  }

  // ---- helpers
  const myId = () => api.getClientId();
  const meP = () => (view ? view.players.find((p) => p.clientId === myId()) : null);
  const nameOf = (id) => { const p = view && view.players.find((q) => q.clientId === id); return p ? p.nickname : 'Someone'; };
  const humans = () => view.players.filter((p) => !p.bot);

  // speller | pronouncer | waiting (bee, someone else's turn) | out | watch
  function role() {
    const t = view && view.turn;
    const g = view && view.game;
    const me = meP();
    if (!t || !g || !me || !me.inRound || view.phase !== 'playing') return 'watch';
    if (g.format === 'pronounce') return t.pronouncerId === myId() ? 'pronouncer' : 'speller';
    if (g.format === 'bee') return t.spellerId === myId() ? 'speller' : me.out ? 'out' : 'waiting';
    return 'speller';
  }
  function canType() {
    const t = view && view.turn;
    if (!t || view.phase !== 'playing' || t.stage !== 'spell' || t.mine || pendingSubmit === t.id || role() !== 'speller') return false;
    const now = clock.now();
    return now >= t.startedAt && now < t.endsAt;
  }

  function toast(text, color = '#ffd23f', ms = 2600) {
    toastEl.textContent = text;
    toastEl.style.color = color;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }
  function floatText(text) {
    if (reduced()) return;
    const f = el('div', 'sb-float', text);
    stage.appendChild(f);
    setTimeout(() => f.remove(), 1200);
  }

  // ---- audio
  function setPlaying(k) {
    playingKey = k;
    for (const [key, b] of hearBtns) b.classList.toggle('playing', key === k);
  }
  function stopAudio() {
    if (player) { const a = player; player = null; a.pause(); }
    setPlaying(null);
  }
  // Auto plays respect the game mute/volume; a click always plays (at full volume if muted).
  function play(key, url, explicit) {
    if (!url) return;
    if (!explicit && (sfx.muted || sfx.volume <= 0)) return;
    stopAudio();
    const a = new Audio(url);
    a.volume = !sfx.muted && sfx.volume >= 0.05 ? sfx.volume : 1;
    player = a;
    const done = () => { if (player === a) { player = null; setPlaying(null); } };
    a.addEventListener('ended', done);
    a.addEventListener('pause', done);
    setPlaying(key);
    a.play().then(() => {
      if (nudge) { nudge = false; for (const b of hearBtns.values()) b.classList.remove('nudge'); }
    }).catch(() => {
      done();
      if (!explicit) { nudge = true; renderStage(); }
    });
  }
  function hearBtn(key, label, url, cls = '') {
    const b = el('button', `sb-hear ${cls}`);
    b.type = 'button';
    b.innerHTML = SPEAKER;
    if (label) b.append(el('span', '', label));
    else b.setAttribute('aria-label', 'Hear it');
    b.title = label ? `${label.toLowerCase()}${key.startsWith('w') || key.startsWith('c') ? ' (space)' : ''}` : 'Hear it';
    if (playingKey === key) b.classList.add('playing');
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => { if (playingKey === key) stopAudio(); else play(key, url, true); });
    hearBtns.set(key, b);
    return b;
  }
  function clipUrl(t) {
    if (!t) return null;
    if (clipCache.id === t.id) return clipCache.url;
    if (!t.clip) return null;
    try {
      const bin = atob(t.clip.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (clipCache.url) URL.revokeObjectURL(clipCache.url);
      clipCache = { id: t.id, url: URL.createObjectURL(new Blob([bytes], { type: String(t.clip.mime).split(';')[0] })) };
      return clipCache.url;
    } catch { return null; }
  }
  const wordUrl = (t) => (t.clue && t.clue.audio ? fileUrl(t.clue.audio.w) : t.hasClip ? clipUrl(t) : null);
  const wordKey = (t) => (t.clue && t.clue.audio ? `w${t.id}` : `c${t.id}`);

  // ---- typing
  function sendDraft() { api.sendAction({ kind: 'draft', text: typed }); }
  function addLetter(c) {
    if (!canType() || typed.length >= MAX_LEN) return;
    typed += c;
    popAt = typed.length - 1;
    sfx.play('click');
    sendDraft();
    renderWord();
  }
  function back() {
    if (!canType() || !typed) return;
    typed = typed.slice(0, -1);
    sendDraft();
    renderWord();
  }
  function clearTyped() {
    if (!canType() || !typed) return;
    typed = '';
    sendDraft();
    renderWord();
  }
  function submit() {
    if (!canType()) return;
    if (!typed) { toast('Type your spelling first', '#ff8a8a'); sfx.play('error'); return; }
    pendingSubmit = view.turn.id;
    api.sendAction({ kind: 'submit', word: typed });
    renderStage();
  }
  function ready() {
    const t = view && view.turn;
    if (!t || t.stage !== 'reveal' || readySent === t.id || view.phase !== 'playing') return;
    const me = meP();
    if (!me || !me.inRound) return;
    readySent = t.id;
    sfx.play('click');
    api.sendAction({ kind: 'next' });
    renderStage();
  }

  function onKey(e) {
    const tg = e.target;
    if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || !view || view.phase !== 'playing') return;
    const t = view.turn;
    if (!t) return;
    if (t.stage === 'reveal') {
      if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) ready(); }
      return;
    }
    if (t.stage !== 'spell') return;
    if (e.key === ' ') {
      const u = role() !== 'pronouncer' && wordUrl(t);
      if (u) { e.preventDefault(); if (!e.repeat) play(wordKey(t), u, true); }
      return;
    }
    if (!canType()) return;
    if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); addLetter(e.key.toLowerCase()); }
    else if (e.key === 'Backspace') { e.preventDefault(); back(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) submit(); }
    else if (e.key === 'Escape') { clearTyped(); }
  }
  window.addEventListener('keydown', onKey);

  // ---- tiles
  function tileRow(word, { len = null, ghost = null, cursor = false, cls = '', pop = -1 } = {}) {
    const n = Math.max(1, len || 0, word.length + (cursor ? 1 : 0));
    const shown = len && cursor && word.length >= len ? Math.max(len, word.length) : n;
    const row = el('div', `sb-tiles ${cls}`);
    sizeRow(row, shown);
    for (let i = 0; i < shown; i++) {
      const c = word[i];
      const tile = el('div', 'sb-tile', c ? c.toUpperCase() : '');
      if (c) tile.classList.add('full');
      else if (i === 0 && ghost) { tile.textContent = ghost.toUpperCase(); tile.classList.add('ghost'); }
      if (len && i >= len) tile.classList.add('over');
      if (i === pop) tile.classList.add('pop');
      if (cursor && i === word.length) tile.classList.add('cursor');
      row.append(tile);
    }
    return row;
  }
  function sizeRow(row, n) {
    const w = (stage.clientWidth || 480) - 32;
    row.style.setProperty('--sz', `${Math.max(16, Math.min(50, Math.floor((w - (n - 1) * 5) / n)))}px`);
  }

  // ---- stage pieces
  function tierBadge(tier) { return tier ? el('span', `sb-tier ${tier}`, TIER_LABEL[tier].toUpperCase()) : el('span'); }

  function headRow() {
    const t = view.turn;
    const g = view.game;
    const r = role();
    const h = el('div', 'sb-head');
    let text = '';
    let mine = false;
    if (g.format === 'pronounce') {
      if (r === 'pronouncer') { text = t.stage === 'pick' ? 'Your turn to pronounce' : 'You are the pronouncer'; mine = true; }
      else text = t.stage === 'pick' ? `${nameOf(t.pronouncerId)} is picking a word` : `${nameOf(t.pronouncerId)} is the pronouncer`;
    } else if (g.format === 'bee') {
      if (r === 'speller') { text = 'Your turn to spell'; mine = true; }
      else text = `${nameOf(t.spellerId)} is spelling`;
      if (r === 'out') text += ' (you are out)';
    } else {
      text = r === 'watch' ? 'Watching: you join the next game' : 'Spell the word';
    }
    if (r === 'watch' && g.format !== 'race') text += ' (watching)';
    h.append(el('span', `sb-role${mine ? ' me' : ''}`, text), tierBadge(t.tier));
    return h;
  }

  function sentenceEl(s, cls = 'sb-sent') {
    const p = el('div', cls);
    const parts = s.split('_____');
    parts.forEach((part, i) => {
      p.append(document.createTextNode(part));
      if (i < parts.length - 1) { const b = el('span', 'sb-blank'); b.setAttribute('aria-label', 'blank'); p.append(b); }
    });
    return p;
  }
  function defEl(pos, def) {
    const d = el('div', 'sb-def');
    if (pos) d.append(el('span', 'sb-pos', pos));
    d.append(document.createTextNode(def || ''));
    return d;
  }

  function clueCard() {
    const t = view.turn;
    const c = t.clue || {};
    const card = el('div', 'sb-clue');
    const url = wordUrl(t);
    const audio = el('div', 'sb-audio');
    if (url) {
      const b = hearBtn(wordKey(t), 'HEAR WORD', url, 'big');
      if (nudge) b.classList.add('nudge');
      audio.append(b);
    }
    if (c.audio && c.audio.s) audio.append(hearBtn(`s${t.id}`, 'HEAR SENTENCE', fileUrl(c.audio.s), 'big'));
    if (audio.childNodes.length) card.append(audio);
    const by = nameOf(t.pronouncerId);
    if (view.game.format === 'pronounce' && !url) card.append(el('div', 'sb-aloud', `${by} is saying the word out loud. Listen on voice chat, or ask them to say it again.`));
    else if (view.game.format === 'pronounce' && c.audio) card.append(el('div', 'sb-aloud', 'Read by the computer voice.'));
    if (c.custom) {
      card.append(el('div', 'sb-label', `${by.toUpperCase()}'S OWN WORD`));
      card.append(c.text ? el('div', 'sb-def', `Clue: ${c.text}`) : el('div', 'sb-sub', 'No clue given. Just the sound.'));
    } else {
      if (c.resp) {
        const say = el('div', 'sb-say');
        const r = el('span', 'sb-resp', c.resp);
        r.title = 'Capital letters mark the stressed syllable';
        say.append(el('span', 'sb-label', 'SAY IT'), r);
        card.append(say);
      }
      if (c.def) card.append(defEl(c.pos, c.def));
      if (c.sentence) card.append(sentenceEl(c.sentence));
    }
    const facts = el('div', 'sb-facts');
    const len = c.len || (t.hint && t.hint.len);
    if (len) { const f = el('span'); f.append(el('b', '', String(len)), document.createTextNode(' letters')); facts.append(f); }
    if (t.hint) { const f = el('span'); f.append(document.createTextNode('Starts with '), el('b', '', t.hint.first.toUpperCase())); facts.append(f); }
    if (facts.childNodes.length) card.append(facts);
    return card;
  }

  function pronouncerCard() {
    const t = view.turn;
    const card = el('div', 'sb-clue');
    card.append(el('div', 'sb-label', 'YOUR WORD'), el('div', 'sb-sugg-word', (t.answer || '').toUpperCase()));
    if (t.hasClip) { const a = el('div', 'sb-audio'); a.append(hearBtn(`c${t.id}`, 'HEAR YOUR RECORDING', clipUrl(t))); card.append(a); }
    else if (t.clue && t.clue.audio) card.append(el('div', 'sb-aloud', 'Spellers hear the computer voice.'));
    else card.append(el('div', 'sb-aloud', 'Say it out loud again if anyone asks.'));
    if (t.clue && t.clue.custom && t.clue.text) card.append(el('div', 'sb-def', `Your clue: ${t.clue.text}`));
    return card;
  }

  function renderWord() {
    const box = refs.word;
    if (!box || !view || !view.turn) return;
    box.textContent = '';
    const t = view.turn;
    const g = view.game;
    const r = role();
    if (t.stage !== 'spell') return;
    if (r === 'speller') {
      const locked = t.mine || pendingSubmit === t.id;
      const letters = t.mine ? t.mine.attempt : typed;
      const len = (t.clue && t.clue.len) || (t.hint && t.hint.len) || null;
      const cls = t.mine ? (t.mine.correct ? 'good' : 'bad') : '';
      box.append(tileRow(letters, { len, ghost: t.hint && !locked ? t.hint.first : null, cursor: canType(), cls, pop: popAt }));
      popAt = -1;
      if (t.mine) {
        box.append(el('div', `sb-verdict ${cls}`, t.mine.correct ? `Correct! +${t.mine.points}` : g.format === 'bee' ? 'Not quite...' : 'Not quite. The answer shows when time is up.'));
        const left = view.players.filter((p) => p.inRound && p.clientId !== t.pronouncerId && !p.submitted).length;
        if (left && g.format !== 'bee') box.append(el('div', 'sb-sub', `Waiting for ${plural(left, 'more player')}`));
      } else if (locked) {
        box.append(el('div', 'sb-sub sb-dots', 'Checking'));
      } else {
        const acts = el('div', 'sb-actions');
        const sub = el('button', 'sb-submit', 'SUBMIT');
        sub.disabled = !typed || !canType();
        sub.addEventListener('mousedown', (e) => e.preventDefault());
        sub.addEventListener('click', submit);
        acts.append(sub);
        if (g.format !== 'bee') {
          const hint = el('button', '', t.hint ? 'HINT USED' : 'HINT (HALF POINTS)');
          hint.disabled = !!t.hint || !canType();
          hint.title = 'Shows the first letter and the number of letters. The word then scores half.';
          hint.addEventListener('mousedown', (e) => e.preventDefault());
          hint.addEventListener('click', () => { sfx.play('click'); api.sendAction({ kind: 'hint' }); });
          acts.append(hint);
        }
        keys.classList.toggle('off', !canType());
        box.append(acts, keys);
      }
    } else if (r === 'pronouncer') {
      const sp = view.players.filter((p) => p.inRound && p.clientId !== t.pronouncerId);
      const done = sp.filter((p) => p.submitted).length;
      box.append(el('div', 'sb-wait-big', `${done} of ${sp.length} locked in`), el('div', 'sb-sub', 'Everyone else is spelling your word.'));
    } else if (g.format === 'bee') {
      box.append(tileRow(t.live || '', { cursor: true, cls: 'live' }), el('div', 'sb-sub sb-dots', `${nameOf(t.spellerId)} is typing`));
    } else {
      box.append(el('div', 'sb-sub', 'You are watching this game. Press START when it ends to join in.'));
    }
  }

  function revealCard() {
    const t = view.turn;
    const g = view.game;
    const card = el('div', 'sb-reveal');
    card.append(el('div', 'sb-label', 'THE WORD WAS'), el('div', 'sb-answer', (t.answer || '').toUpperCase()));
    const sub = el('div', 'sb-row');
    sub.style.justifyContent = 'center';
    if (t.answerResp) { const r = el('span', 'sb-resp', t.answerResp); r.style.fontSize = '1.15em'; sub.append(r); }
    if (t.answerAudio) sub.append(hearBtn(`a${t.id}`, '', fileUrl(t.answerAudio), 'icon'));
    if (sub.childNodes.length) card.append(sub);
    if (t.alts && t.alts.length) card.append(el('div', 'sb-alts', `Also accepted: ${t.alts.join(', ')}`));

    const attempts = t.attempts || {};
    const focusId = g.format === 'bee' ? t.spellerId : myId();
    const a = attempts[focusId];
    const who = focusId === myId() ? 'You' : nameOf(focusId);
    if (a) {
      if (a.correct) {
        card.append(el('div', 'sb-verdict good', `${who === 'You' ? 'You got it' : `${who} got it`}${a.points ? `  +${a.points}` : ''}`));
      } else if (!a.attempt) {
        card.append(el('div', 'sb-verdict bad', `${who === 'You' ? 'You ran' : `${who} ran`} out of time`));
      } else {
        card.append(el('div', 'sb-verdict bad', who === 'You' ? 'You wrote' : `${who} wrote`));
        const ops = align(a.attempt, t.answer || '');
        const row = el('div', 'sb-tiles sb-diff');
        sizeRow(row, ops.length);
        for (const op of ops) {
          const tile = el('div', `sb-tile ${op.k}`, op.c.toUpperCase());
          if (op.k === 'sub') { tile.dataset.want = op.want.toUpperCase(); tile.title = `should be ${op.want.toUpperCase()}`; }
          if (op.k === 'ins') tile.title = 'extra letter';
          if (op.k === 'del') tile.title = 'missing letter';
          row.append(tile);
        }
        card.append(row);
        const kinds = new Set(ops.map((o) => o.k));
        const lg = el('div', 'sb-legend');
        if (kinds.has('sub')) { const s = el('span'); s.append(el('i', '', 'red'), document.createTextNode(' wrong letter (fix below)')); lg.append(s); }
        if (kinds.has('ins')) { const s = el('span'); s.append(el('i', '', 'struck'), document.createTextNode(' extra letter')); lg.append(s); }
        if (kinds.has('del')) { const s = el('span'); s.append(el('i', '', 'dashed'), document.createTextNode(' missing letter')); lg.append(s); }
        card.append(lg);
      }
    } else if (role() === 'pronouncer' || (g.format === 'pronounce' && t.pronouncerId === myId())) {
      const all = Object.values(attempts);
      card.append(el('div', 'sb-verdict', `${all.filter((x) => x.correct).length} of ${all.length} spelled it right`));
    }

    const me = meP();
    if (me && me.inRound && view.phase === 'playing') {
      const nb = el('button', 'sb-next');
      nb.disabled = readySent === t.id;
      nb.addEventListener('click', ready);
      refs.next = nb;
      card.append(nb);
      updateNext();
    }
    return card;
  }
  function updateNext() {
    const nb = refs.next;
    const t = view && view.turn;
    if (!nb || !t || t.stage !== 'reveal') return;
    const secs = Math.max(0, Math.ceil((t.revealEndsAt - clock.now()) / 1000));
    const hs = humans().filter((p) => p.inRound);
    const done = (t.ready || []).filter((id) => hs.some((p) => p.clientId === id)).length;
    const label = readySent === t.id ? (hs.length > 1 ? `READY ${done}/${hs.length}` : 'READY') : 'NEXT WORD';
    nb.textContent = `${label} (${secs})`;
  }

  function waitPickCard() {
    const w = el('div', 'sb-wait');
    w.append(el('div', 'sb-wait-big sb-dots', `${nameOf(view.turn.pronouncerId)} is picking a word`), el('div', 'sb-sub', 'Get ready to listen. If they use voice chat, keep it on.'));
    return w;
  }

  // ---- pronouncer panel
  function freshRec() { return { recording: false, recorder: null, stream: null, clip: null, url: null, until: 0, timer: null }; }
  function resetRec() {
    const r = rec;
    rec = freshRec();
    clearTimeout(r.timer);
    if (r.recorder && r.recording) { try { r.recorder.stop(); } catch { /* already stopped */ } }
    if (r.stream) r.stream.getTracks().forEach((tr) => tr.stop());
    if (r.url) URL.revokeObjectURL(r.url);
  }
  function pickMsg(text, ok = false) {
    if (!pick) return;
    pick.msg.textContent = text;
    pick.msg.classList.toggle('ok', ok);
  }
  function blobToB64(blob) {
    return new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || '').split(',')[1] || '');
      fr.onerror = () => resolve('');
      fr.readAsDataURL(blob);
    });
  }
  async function startRec() {
    const p = pick;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      pickMsg('This browser cannot record. Say the word out loud and tick the box instead.');
      return;
    }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { pickMsg('No microphone access. Allow it in the browser, or say the word out loud and tick the box.'); return; }
    if (pick !== p) { stream.getTracks().forEach((tr) => tr.stop()); return; }
    stopAudio();
    resetRec();
    const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m));
    let r;
    try { r = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 }); }
    catch { stream.getTracks().forEach((tr) => tr.stop()); pickMsg('Recording failed to start. Say the word out loud and tick the box instead.'); return; }
    const chunks = [];
    const mine = { ...freshRec(), recording: true, recorder: r, stream, until: Date.now() + REC_MS };
    rec = mine;
    r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    r.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      if (rec !== mine) return;
      mine.recording = false;
      clearTimeout(mine.timer);
      const blob = new Blob(chunks, { type: r.mimeType || type || 'audio/webm' });
      const data = await blobToB64(blob);
      if (rec !== mine) return;
      const mime = blob.type || 'audio/webm';
      if (!data) pickMsg('Nothing was recorded. Check your microphone and try again.');
      else if (!CLIP_TYPES.includes(mime.split(';')[0].trim())) pickMsg('This browser records in a format that cannot be sent. Say the word out loud and tick the box instead.');
      else if (data.length > MAX_CLIP_CHARS) pickMsg('That recording is too long to send. Keep it to the word and try again.');
      else { mine.clip = { mime, data }; mine.url = URL.createObjectURL(blob); pickMsg('Recorded. Play it back, or send it.', true); }
      updatePick();
    };
    r.start();
    mine.timer = setTimeout(stopRec, REC_MS);
    pickMsg('');
    sfx.play('blip');
    updatePick();
  }
  function stopRec() {
    if (rec.recording && rec.recorder) { clearTimeout(rec.timer); try { rec.recorder.stop(); } catch { /* already stopped */ } }
  }

  function buildPick(turnId) {
    resetRec();
    const p = { turnId, el: el('div', 'sb-pick') };
    p.el.append(el('div', 'sb-sub', 'Pick a word, say it, and everyone else has to spell it.'));
    p.sugg = el('div', 'sb-sugg');
    const own = el('div', 'sb-clue');
    p.word = el('input');
    p.word.type = 'text';
    p.word.maxLength = 30;
    p.word.placeholder = 'Type any word';
    p.word.autocomplete = 'off';
    p.word.spellcheck = false;
    p.word.setAttribute('aria-label', 'Your own word');
    p.clue = el('input');
    p.clue.type = 'text';
    p.clue.maxLength = 120;
    p.clue.placeholder = 'Clue for spellers (optional)';
    p.clue.autocomplete = 'off';
    p.clue.setAttribute('aria-label', 'Clue for spellers');
    p.word.addEventListener('input', () => updatePick());
    for (const inp of [p.word, p.clue]) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendPick(); } });
    const r1 = el('div', 'sb-row');
    r1.append(p.word);
    const r2 = el('div', 'sb-row');
    r2.append(p.clue);
    own.append(el('div', 'sb-label', 'OR USE YOUR OWN WORD'), r1, r2);
    const say = el('div', 'sb-clue');
    p.recRow = el('div', 'sb-row');
    const chk = el('label', 'sb-check');
    p.aloud = el('input');
    p.aloud.type = 'checkbox';
    p.aloud.addEventListener('change', () => updatePick());
    chk.append(p.aloud, el('span', '', 'I said it out loud (voice chat or same room)'));
    say.append(el('div', 'sb-label', 'SAY IT'), p.recRow, chk);
    p.msg = el('div', 'sb-msg');
    p.msg.setAttribute('role', 'status');
    p.send = el('button', 'sb-send', 'SEND WORD');
    p.send.addEventListener('click', sendPick);
    p.el.append(p.sugg, own, say, p.msg, p.send);
    pick = p;
  }
  function updatePick() {
    const p = pick;
    const t = view && view.turn;
    if (!p || !t || t.id !== p.turnId) return;
    const s = t.suggest;
    const own = norm(p.word.value);
    p.sugg.textContent = '';
    p.sugg.classList.toggle('dim', !!own);
    if (s) {
      const head = el('div', 'sb-row between');
      const left = el('div', 'sb-row');
      left.append(el('span', 'sb-label', 'SUGGESTED WORD'), tierBadge(s.tier));
      const rr = el('button', '', 'ANOTHER WORD');
      rr.addEventListener('click', () => { sfx.play('click'); api.sendAction({ kind: 'reroll' }); });
      head.append(left, rr);
      const w = el('div', 'sb-row');
      w.append(el('span', 'sb-sugg-word', s.word.toUpperCase()));
      if (s.audio) w.append(hearBtn('p', '', fileUrl(s.audio.w), 'icon'));
      p.sugg.append(head, w);
      if (s.resp) { const say = el('div', 'sb-say'); say.append(el('span', 'sb-label', 'SAY IT'), el('span', 'sb-resp', s.resp)); p.sugg.append(say); }
      if (s.def) p.sugg.append(defEl(s.pos, s.def));
      if (s.sentence) p.sugg.append(el('div', 'sb-sent', `"${s.sentence}"`));
    }
    p.recRow.textContent = '';
    const rb = el('button', `sb-rec${rec.recording ? ' on' : ''}`);
    p.recBtn = rb;
    updateRecBtn();
    rb.addEventListener('click', () => { if (rec.recording) stopRec(); else startRec(); });
    p.recRow.append(rb);
    if (rec.clip && rec.url) {
      p.recRow.append(hearBtn('rec', 'PLAY BACK', rec.url));
      const del = el('button', '', 'DISCARD');
      del.addEventListener('click', () => { stopAudio(); resetRec(); pickMsg(''); updatePick(); });
      p.recRow.append(del);
    }
    p.recRow.append(el('span', 'sb-sub', 'up to 6 seconds'));
    const said = rec.clip || p.aloud.checked;
    p.send.textContent = own ? 'SEND MY WORD' : said ? 'SEND WORD' : 'SEND (COMPUTER READS IT)';
    p.send.disabled = rec.recording || (!!own && !said);
    p.send.title = own && !said ? 'Record your word, or say it out loud and tick the box' : '';
  }
  function updateRecBtn() {
    if (!pick || !pick.recBtn) return;
    pick.recBtn.textContent = rec.recording ? `STOP (${Math.max(0, Math.ceil((rec.until - Date.now()) / 1000))})` : rec.clip ? 'RECORD AGAIN' : 'RECORD';
  }
  function sendPick() {
    const p = pick;
    if (!p || p.send.disabled) {
      if (p && norm(p.word.value) && !rec.clip && !p.aloud.checked) { pickMsg('Record your word, or say it out loud and tick the box.'); sfx.play('error'); }
      return;
    }
    const own = norm(p.word.value);
    if (own && own.length < 2) { pickMsg('Pick a longer word.'); sfx.play('error'); return; }
    if (own && norm(p.clue.value).includes(own)) { pickMsg('The clue gives the word away.'); sfx.play('error'); return; }
    stopAudio();
    api.sendAction({ kind: 'pronounce', word: own || undefined, clue: own ? p.clue.value : undefined, aloud: p.aloud.checked, clip: rec.clip || undefined });
    p.send.disabled = true;
    pickMsg('Sending...', true);
    setTimeout(() => { if (pick === p) updatePick(); }, 2500);
  }

  // ---- intro and results
  function introCard() {
    const c = el('div', 'sb-intro');
    const s = view.settings;
    c.append(el('div', 'sb-title', 'SPELLING BEE'));
    if (api.daily) c.append(el('p', '', 'Today\'s ten words are the same for everyone, from easy to expert. Listen, then type the spelling. One try at each word; the faster you spell it, the more it scores.'));
    else c.append(el('p', '', FORMAT_HELP[s.format]));
    const pts = el('div', 'sb-pts');
    for (const tier of ['easy', 'medium', 'hard', 'expert']) {
      const d = el('div', '');
      d.style.color = { easy: '#39ff14', medium: '#3ad7ff', hard: '#ffb000', expert: '#ff5c9a' }[tier];
      d.append(el('b', '', String(POINTS[tier])), document.createTextNode(TIER_LABEL[tier]));
      pts.append(d);
    }
    if (s.format !== 'bee' || view.locked) c.append(el('div', 'sb-label', 'POINTS PER WORD (UP TO +50% FOR SPEED)'), pts);
    const ul = el('ul');
    for (const line of [
      'Type on your keyboard or tap the keys. ENTER submits, BACKSPACE deletes, ESC clears.',
      'SPACE plays the word again. HEAR SENTENCE uses it in context.',
      'One try per word. When time runs out, whatever you have typed is judged.',
    ]) ul.append(el('li', '', line));
    c.append(ul);
    if (s.format === 'bee' && !view.locked) {
      const b = readBest(s.level);
      if (b) c.append(el('div', 'sb-sub', `Your best solo streak on ${s.level === 'mix' ? 'mixed' : TIER_LABEL[s.level].toLowerCase()} words: ${b}`));
    }
    return c;
  }

  function reviewCard() {
    const c = el('div', 'sb-intro');
    const g = view.game;
    const me = meP();
    const rv = view.review || [];
    if (!me || !me.inRound) {
      c.append(el('div', 'sb-big', 'GAME OVER'), el('div', 'sb-sub', 'Press START to play the next game.'));
      return c;
    }
    const right = rv.filter((r) => r.correct).length;
    if (g.format === 'bee' && g.solo) {
      c.append(el('div', 'sb-big', `${plural(me.correct, 'word')} in a row`));
      if (best && best.gameId === view.gameId) c.append(el('div', 'sb-sub', best.isNew ? 'New personal best!' : `Personal best: ${best.best}`));
    } else {
      c.append(el('div', 'sb-big', `${right} of ${rv.length} right${g.format === 'bee' ? '' : ` · ${me.score} points`}`));
    }
    if (rv.length) {
      c.append(el('div', 'sb-label', 'YOUR WORDS (TAP TO HEAR)'));
      const list = el('div', 'sb-review');
      rv.forEach((r, i) => {
        const row = el('div', `sb-rv${r.correct ? '' : ' miss'}`);
        if (r.audio) row.append(hearBtn(`r${i}`, '', fileUrl(r.audio), 'icon'));
        const w = el('div', 'sb-rv-word', r.word.toUpperCase());
        if (!r.correct) w.append(el('span', 'sb-rv-you', r.attempt ? r.attempt : 'no answer'));
        row.append(w, tierBadge(r.tier), el('span', 'sb-rv-pts', r.correct ? (g.format === 'bee' ? 'RIGHT' : `+${r.points}`) : 'MISS'));
        list.append(row);
      });
      c.append(list);
    }
    return c;
  }

  function renderResults() {
    const g = view.game;
    if (view.phase !== 'results' || !g) { results.update(null); return; }
    const me = myId();
    const ps = view.players.filter((p) => p.inRound);
    if (!ps.length) { results.update(null); return; }
    const mine = ps.find((p) => p.clientId === me);
    const levelName = g.level === 'mix' ? 'Mixed words' : `${TIER_LABEL[g.level]} words`;
    const rematch = api.daily ? undefined : { label: 'PLAY AGAIN', onClick: () => api.sendAction({ kind: 'start' }) };
    if (g.format === 'bee' && g.solo) {
      const p = ps[0];
      const b = best && best.gameId === view.gameId ? best : { best: p.correct, isNew: false };
      results.update({
        title: `${p.correct} IN A ROW`,
        subtitle: `Survival · ${levelName} · ${b.isNew ? 'new best!' : `best ${b.best}`}`,
        outcome: b.isNew && p.correct > 0 ? 'win' : 'over',
        rematch,
      });
      return;
    }
    let rows;
    let topIds;
    if (g.format === 'bee') {
      const sorted = ps.slice().sort((a, b) => (a.out ? a.outRound : 1e9) - (b.out ? b.outRound : 1e9));
      sorted.reverse();
      const standing = sorted.filter((p) => !p.out);
      const topRound = standing.length ? null : sorted[0].outRound;
      topIds = (standing.length ? standing : sorted.filter((p) => p.outRound === topRound)).map((p) => p.clientId);
      rows = sorted.map((p) => ({
        name: p.nickname,
        value: p.out ? `out in round ${p.outRound}` : standing.length > 1 ? 'still standing' : 'champion',
        win: topIds.includes(p.clientId),
        you: p.clientId === me,
      }));
    } else {
      const sorted = ps.slice().sort((a, b) => b.score - a.score);
      const topScore = sorted[0].score;
      topIds = topScore > 0 ? sorted.filter((p) => p.score === topScore).map((p) => p.clientId) : [];
      rows = sorted.map((p) => ({ name: p.nickname, value: `${p.score} pts · ${p.correct} right`, win: topIds.includes(p.clientId), you: p.clientId === me }));
    }
    let title;
    let outcome = 'over';
    let subtitle = `${{ race: 'Race', bee: 'Spelling bee', pronounce: 'Pronouncer' }[g.format]} · ${levelName}`;
    if (ps.length === 1) {
      const p = ps[0];
      title = p.correct === g.total ? 'PERFECT!' : `${p.correct} OF ${g.total} RIGHT`;
      subtitle = `${api.daily ? 'Daily challenge' : levelName} · ${p.score} points`;
      outcome = p.correct >= Math.ceil((g.total || 10) * 0.7) ? 'win' : 'over';
    } else if (mine) {
      const won = topIds.includes(me);
      outcome = won ? 'win' : 'lose';
      title = won ? (topIds.length > 1 ? 'TIED FOR FIRST' : 'YOU WIN') : 'YOU LOSE';
    } else {
      title = topIds.length === 1 ? `${nameOf(topIds[0]).toUpperCase()} WINS` : topIds.length ? 'A TIE' : 'GAME OVER';
    }
    results.update({ title, subtitle, outcome, rows, rematch });
  }

  // ---- render
  function renderStatus() {
    const g = view.game;
    const t = view.turn;
    let s = '';
    if (view.phase === 'waiting') s = api.daily ? 'Daily challenge: 10 words' : api.ranked ? 'Ranked: 10 words' : 'Pick a mode, then press START';
    else if (view.phase === 'results') s = 'Game over';
    else if (g && t) {
      if (g.format === 'bee') {
        const me = meP();
        s = g.solo ? `Survival · word ${(me ? me.correct : 0) + 1}` : `Round ${g.round} · ${plural(view.players.filter((p) => p.inRound && !p.out).length, 'speller')} left`;
      } else s = `Word ${Math.min(g.index + 1, g.total)} of ${g.total}`;
    }
    statusEl.textContent = s;
  }

  function seg(label, opts, value, key) {
    const row = el('div', 'sb-seg-row');
    row.append(el('span', 'sb-seg-label', label));
    const box = el('div', 'sb-seg');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', label);
    for (const [v, text] of opts) {
      const b = el('button', v === value ? 'on' : '', text);
      b.setAttribute('aria-pressed', String(v === value));
      b.addEventListener('click', () => {
        if (view.settings[key] === v) return;
        sfx.play('click');
        view.settings = { ...view.settings, [key]: v }; // show it now; the server echoes it to everyone
        api.sendAction({ kind: 'settings', [key]: v });
        renderAll();
      });
      box.append(b);
    }
    row.append(box);
    return row;
  }

  function renderSetup() {
    const playing = view.phase === 'playing';
    setup.hidden = playing;
    if (playing) return;
    setupBody.textContent = '';
    const s = view.settings;
    if (view.locked) {
      setupBody.append(el('div', 'sb-locked', api.daily
        ? 'DAILY CHALLENGE: the same 10 words for everyone today, easy to expert, read out loud. One run per day.'
        : 'RANKED: 10 words from easy to expert, read out loud. Highest score wins.'));
    } else {
      setupBody.append(seg('WORDS', LEVEL_OPTS, s.level, 'level'), seg('FORMAT', FORMAT_OPTS, s.format, 'format'));
      if (s.format !== 'pronounce') setupBody.append(seg('CLUES', CLUE_OPTS, s.clues, 'clues'));
      setupBody.append(el('div', 'sb-help', s.format === 'pronounce' ? FORMAT_HELP.pronounce : CLUE_HELP[s.clues]));
    }
    const needTwo = !view.locked && s.format === 'pronounce' && humans().length < 2;
    startBtn.disabled = needTwo;
    startBtn.textContent = view.phase === 'results' ? 'PLAY AGAIN' : 'START';
    startBtn.hidden = !!api.daily && view.phase === 'results';
    needEl.textContent = needTwo ? 'Pronouncer needs a second person: share the room code.' : '';
    botBar.update(view.players);
  }

  function renderStage() {
    hearBtns.clear();
    refs = {};
    stage.textContent = '';
    stage.append(toastEl, countEl);
    if (!view) return;
    const t = view.turn;
    if (view.phase === 'waiting' || !view.game) { stage.append(introCard()); return; }
    if (view.phase === 'results') { stage.append(reviewCard()); return; }
    if (!t) return;
    stage.append(headRow());
    if (t.stage === 'pick') {
      if (role() === 'pronouncer') {
        if (!pick || pick.turnId !== t.id) buildPick(t.id);
        updatePick();
        stage.append(pick.el);
      } else stage.append(waitPickCard());
      return;
    }
    if (t.stage === 'spell') {
      const bar = el('div', 'sb-bar');
      const fill = el('i');
      bar.append(fill);
      refs.bar = bar;
      refs.fill = fill;
      stage.append(bar);
    }
    stage.append(role() === 'pronouncer' && t.stage === 'spell' ? pronouncerCard() : clueCard());
    if (t.stage === 'reveal') stage.append(revealCard());
    else {
      refs.word = el('div', 'sb-word');
      stage.append(refs.word);
      renderWord();
    }
  }

  function renderPlayers() {
    side.textContent = '';
    side.append(el('b', '', 'PLAYERS'));
    const g = view.game;
    const t = view.phase === 'playing' ? view.turn : null;
    const bee = g && g.format === 'bee';
    const ps = view.players.slice().sort((a, b) => {
      if (a.inRound !== b.inRound) return a.inRound ? -1 : 1;
      if (bee) {
        if (a.out !== b.out) return a.out ? 1 : -1;
        if (a.out) return b.outRound - a.outRound;
        const o = g.order || [];
        return (o.indexOf(a.clientId) + 1 || 99) - (o.indexOf(b.clientId) + 1 || 99);
      }
      return b.score - a.score;
    });
    for (const p of ps) {
      const row = el('div', 'sb-pl');
      if (p.clientId === myId()) row.classList.add('you');
      if (bee && p.out) row.classList.add('out');
      if (t && ((bee && t.spellerId === p.clientId) || t.pronouncerId === p.clientId) && t.stage !== 'reveal') row.classList.add('turn');
      const dot = el('span', 'sb-dot');
      dot.style.background = p.color;
      const main = el('div', 'sb-pl-main');
      main.append(el('div', 'sb-pl-name', `${p.nickname}${p.clientId === myId() ? ' (you)' : ''}`));
      let meta = '';
      if (g && p.inRound) {
        if (bee) meta = p.out ? `out in round ${p.outRound}` : `${plural(p.correct, 'word')} right`;
        else meta = `${p.score} pts · ${p.correct} right`;
      } else if (p.bot) meta = `bot · ${p.bot}`;
      if (p.wins) meta += `${meta ? ' · ' : ''}${plural(p.wins, 'win')}`;
      if (meta) main.append(el('div', 'sb-pl-meta', meta));
      row.append(dot, main);
      const tag = tagFor(p, t, g);
      if (tag) row.append(el('span', `sb-tag ${tag[1]}`, tag[0]));
      side.append(row);
    }
  }
  function tagFor(p, t, g) {
    if (!t || !g) return null;
    if (!p.inRound) return ['WATCHING', 'dim'];
    if (g.format === 'bee' && p.out) return ['OUT', 'bad'];
    if (t.stage === 'reveal' && t.attempts && t.attempts[p.clientId]) {
      const a = t.attempts[p.clientId];
      return a.correct ? [g.format === 'bee' ? 'RIGHT' : `+${a.points}`, 'good'] : ['MISSED', 'bad'];
    }
    if (t.pronouncerId === p.clientId) return ['PRONOUNCER', 'live'];
    if (g.format === 'bee' && t.spellerId === p.clientId) return ['SPELLING', 'live'];
    if (t.stage === 'spell' && p.submitted) return ['LOCKED IN', 'good'];
    if (t.stage === 'reveal' && (t.ready || []).includes(p.clientId)) return ['READY', 'dim'];
    return null;
  }

  function renderAll() {
    if (!view) return;
    renderStatus();
    renderSetup();
    renderStage();
    renderPlayers();
    renderResults();
  }

  // ---- per-frame: clocks, countdown, ticks, autoplay
  function frame() {
    rafId = requestAnimationFrame(frame);
    if (!view) return;
    const now = clock.now();
    const t = view.turn;
    let timer = '';
    let low = false;
    countEl.hidden = true;
    if (view.phase === 'playing' && t) {
      if (t.stage === 'pick') {
        timer = fmtClock(t.pickEndsAt - now);
      } else if (t.stage === 'spell') {
        const counting = now < t.startedAt;
        const left = counting ? t.spellMs : t.endsAt - now;
        timer = fmtClock(left);
        low = !counting && left <= 10000;
        if (refs.fill) refs.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, left / t.spellMs))})`;
        if (refs.bar) refs.bar.classList.toggle('low', low);
        if (counting && countdownTurn === t.id) {
          countEl.hidden = false;
          countNum.textContent = String(Math.ceil((t.startedAt - now) / 1000));
          countSub.textContent = t.clue && t.clue.audio ? 'Listen for the first word' : 'First word coming up';
        }
        const sec = counting ? `c${Math.ceil((t.startedAt - now) / 1000)}` : `t${Math.ceil(left / 1000)}`;
        if (sec !== lastSecond) {
          lastSecond = sec;
          if (counting && countdownTurn === t.id) sfx.play('beep');
          else if (!counting && left <= 5000 && left > 0 && canType()) sfx.play('tick');
        }
        if (!counting && startedSeen !== t.id) {
          startedSeen = t.id;
          if (countdownTurn === t.id) sfx.play('go');
          renderStage();
        }
        if (now >= t.startedAt - 80 && autoplayed !== t.id) {
          autoplayed = t.id;
          if (role() !== 'pronouncer') play(wordKey(t), wordUrl(t), false);
        }
      } else if (t.stage === 'reveal') {
        updateNext();
      }
    }
    if (timerEl.textContent !== timer) timerEl.textContent = timer;
    timerEl.classList.toggle('low', low);
    if (rec.recording) updateRecBtn();
  }

  // ---- incoming
  function onState(data) {
    const prev = view;
    view = data;
    clock.sync(view.serverNow);
    const t = view.turn;
    const g = view.game;
    if (t && t.id !== turnSeen) {
      turnSeen = t.id;
      typed = '';
      popAt = -1;
      pendingSubmit = null;
      nudge = false;
      stopAudio();
      if (t.stage === 'spell' && t.startedAt - clock.now() > 1600) countdownTurn = t.id;
    }
    if (t && t.mine && pendingSubmit === t.id) pendingSubmit = null;
    if (t && t.clip) clipUrl(t);
    if (pick && (!t || t.id !== pick.turnId || t.stage !== 'pick' || view.phase !== 'playing')) { resetRec(); pick = null; }

    // bee: announce who went out when a new round starts
    if (g && g.format === 'bee' && !g.solo && view.phase !== 'waiting') {
      const key = `${view.gameId}:${g.round}`;
      if (roundSeen && roundSeen !== key && roundSeen.split(':')[0] === String(view.gameId)) {
        const outNow = view.players.filter((p) => p.out && p.outRound === g.round - 1);
        if (g.notice === 'allMissed') toast('Everyone missed, so everyone stays in', '#3ad7ff', 3500);
        else if (outNow.length) {
          toast(`${outNow.map((p) => (p.clientId === myId() ? 'You' : p.nickname)).join(', ')} ${outNow.length === 1 && outNow[0].clientId !== myId() ? 'is' : 'are'} out`, '#ff8a8a', 3500);
          if (outNow.some((p) => p.clientId === myId())) sfx.play('lose');
        }
      }
      roundSeen = key;
    }

    if (prev && prev.phase === 'playing' && view.phase === 'results' && resultsSeen !== view.gameId) {
      resultsSeen = view.gameId;
      const me = meP();
      if (g && g.format === 'bee' && g.solo && me && me.inRound) {
        const old = readBest(g.level);
        best = { gameId: view.gameId, level: g.level, best: Math.max(old, me.correct), isNew: me.correct > old };
        if (best.isNew) writeBest(g.level, me.correct);
      }
      if (me && me.inRound) {
        const ps = view.players.filter((p) => p.inRound);
        let won;
        if (g.format === 'bee') won = g.solo ? best && best.isNew : !me.out;
        else won = ps.length === 1 ? me.correct >= Math.ceil(g.total * 0.7) : me.score > 0 && me.score === Math.max(...ps.map((p) => p.score));
        sfx.play(won ? 'win' : 'lose');
      }
    } else if (prev && prev.turn && t && prev.turn.id === t.id && prev.turn.stage === 'spell' && t.stage === 'reveal' && view.phase === 'playing') {
      const a = t.attempts && t.attempts[myId()];
      if (!a && g.format === 'bee') { const s = t.attempts && t.attempts[t.spellerId]; if (s) sfx.play(s.correct ? 'point' : 'error'); }
      else if (a && !prev.turn.mine) sfx.play(a.correct ? 'point' : 'error'); // judged at the buzzer
    }
    renderAll();
  }

  function onJudged(d) {
    if (!view || !view.turn || d.turnId !== view.turn.id) return;
    pendingSubmit = null;
    view.turn.mine = { attempt: d.attempt, correct: d.correct, points: d.points };
    if (d.correct) { sfx.play(d.points >= 400 ? 'chime' : 'point'); if (d.points) floatText(`+${d.points}`); }
    else sfx.play('error');
    renderStage();
  }

  function onError(d) {
    const msg = String(d.message || 'Something went wrong.');
    sfx.play('error');
    if (pick && view && view.turn && view.turn.stage === 'pick') { pickMsg(msg); updatePick(); }
    else toast(msg, '#ff8a8a', 3500);
  }

  // Re-fit tiles when the window changes size.
  let resizeTimer = null;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (view && !pick) renderStage(); }, 150); };
  window.addEventListener('resize', onResize);

  rafId = requestAnimationFrame(frame);

  return {
    applySnapshot(snapshot) {
      if (!snapshot) return;
      onState(snapshot.kind === 'state' ? snapshot : { kind: 'state', ...snapshot });
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') onState(data);
      else if (data.kind === 'judged') onJudged(data);
      else if (data.kind === 'error') onError(data);
    },
    applyRoster() { /* names come from the server's player list */ },
    unmount() {
      cancelAnimationFrame(rafId);
      clearTimeout(toastTimer);
      clearTimeout(resizeTimer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      stopAudio();
      resetRec();
      if (clipCache.url) URL.revokeObjectURL(clipCache.url);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
