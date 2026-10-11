// 20 Questions — one player picks a secret word (three suggestions, or their own), the other asks
// free-text yes/no questions; the picker taps YES / NO / SOMETIMES / DON'T KNOW. A guess can be
// made any time and costs a question; 20 max. Two rounds per match (roles swap), points for
// solving fast (21 - questions) or for stumping (10).
//
// Rendering: the layout is built once and patched in place — the Q&A log appends entries, the
// question meter recolours pips, panels toggle `hidden` — so typed text and focus survive state
// updates and nothing under the pointer is rebuilt on hover. The seat bar is only rebuilt when
// its content actually changes.
import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect } from '../botLevel.js';
import { createResults } from '../resultsPanel.js';

const SEAT_COLOR = { p1: '#3ad7ff', p2: '#ffb000' };
const CAT_EMOJI = { animal: '🐾', food: '🍔', object: '📦', place: '🗺️', person: '🧑', any: '❔' };
const CAT_LABEL = { animal: 'ANIMAL', food: 'FOOD & DRINK', object: 'OBJECT', place: 'PLACE', person: 'PERSON / JOB', any: 'ANYTHING' };
const ANSWER_LABEL = { yes: 'YES', no: 'NO', sometimes: 'SOMETIMES', unknown: "DON'T KNOW", correct: 'CORRECT!' };
const REJECT_MESSAGES = {
  not_your_turn: "It's not your turn",
  not_playing: 'Not right now',
  invalid: 'Invalid move',
  too_long: 'That is too long',
  bad_word: 'Pick a real word (letters only)',
  empty: 'Type a question first',
  wait_answer: 'Wait for the answer first',
  bad_answer: 'Invalid answer',
};
const IDEAS = [
  'Is it alive?', 'Is it an animal?', 'Can you eat it?', 'Is it a place?', 'Is it bigger than a person?',
  'Can you hold it in one hand?', 'Does it use electricity?', 'Is it found outdoors?', 'Would you find it in a house?',
  'Is it a person or a job?', 'Does it have fur?', 'Can it fly?', 'Is it sweet?', 'Is it made of metal?',
  'Is it a building?', 'Does it live in water?', 'Can it be dangerous?', 'Is it to do with sports?', 'Do you wear it?',
  'Is it red?', 'Does it have four legs?', 'Is it a pet?', 'Is it made by people?', 'Does it make noise?',
];

const CSS = `
.tq-root { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; --tq-c: #39ff14; }
.tq-status { font-size: 18px; font-weight: bold; padding: 6px 14px; border-radius: 6px; border: 2px solid transparent; text-align: center; max-width: 94vw; }
.tq-status.mine { background: rgba(57,255,20,.15); border-color: #39ff14; animation: tq-glow 1.6s ease-in-out infinite; }
@keyframes tq-glow { 50% { box-shadow: 0 0 16px -2px #39ff14; } }
.tq-err { color: #ff4d4d; min-height: 1.2em; font-size: 14px; }
.tq-seats { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; align-items: stretch; width: min(760px, 96vw); }
.tq-seat { flex: 1 1 220px; display: flex; flex-direction: column; gap: 4px; padding: 6px 10px; border: 1px solid #1f8f0c; border-radius: 8px; background: rgba(8,20,8,.6); transition: box-shadow .25s, border-color .25s; min-width: 0; }
.tq-seat.turn { border-color: var(--c); box-shadow: 0 0 14px -3px var(--c); }
.tq-seat .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tq-seat .nm { font-weight: bold; color: var(--c); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
.tq-seat .role { font-size: 11px; letter-spacing: 1px; padding: 1px 6px; border-radius: 10px; border: 1px solid var(--c); color: var(--c); }
.tq-seat .score { margin-left: auto; font-size: 30px; font-weight: bold; color: var(--c); text-shadow: 0 0 10px var(--c); font-variant-numeric: tabular-nums; line-height: 1; }
.tq-seat .score.bump { animation: tq-bump .5s ease-out; }
@keyframes tq-bump { 35% { transform: scale(1.35); color: #fff; } }
.tq-seat .sub { font-size: 11px; color: #6fae5f; }
.tq-chip { width: 12px; height: 12px; border-radius: 50%; display: inline-block; background: var(--c); box-shadow: 0 0 6px var(--c); flex: none; }
.tq-mid { display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 74px; font-size: 12px; color: #6fae5f; letter-spacing: 1px; text-align: center; }
.tq-mid b { font-size: 18px; color: #c8ffc0; }
.tq-main { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 14px; width: min(760px, 96vw); align-items: start; }
@media (max-width: 640px) { .tq-main { grid-template-columns: minmax(0, 1fr); } }
.tq-left { display: flex; flex-direction: column; gap: 10px; align-items: center; }
.tq-card { width: 220px; height: 150px; perspective: 700px; position: relative; }
.tq-card-in { position: absolute; inset: 0; transform-style: preserve-3d; transition: transform .8s cubic-bezier(.3,1.4,.5,1); }
.tq-card-in.flip { transform: rotateY(180deg); }
.tq-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 8px; text-align: center; }
.tq-face.front { background: repeating-linear-gradient(45deg, #071407 0 10px, #0a1d0a 10px 20px); border: 2px solid #1f8f0c; box-shadow: inset 0 0 30px rgba(0,0,0,.7); }
.tq-face.front .q { font-size: 64px; font-weight: bold; color: #39ff14; text-shadow: 0 0 18px #39ff14; line-height: 1; animation: tq-float 3s ease-in-out infinite; }
@keyframes tq-float { 50% { transform: translateY(-5px) rotate(-4deg); } }
.tq-face.back { transform: rotateY(180deg); background: radial-gradient(circle at 50% 35%, #2a2208, #0d0b03 75%); border: 2px solid #ffb000; box-shadow: 0 0 22px -6px #ffb000, inset 0 0 26px rgba(0,0,0,.6); }
.tq-face.back .w { font-size: 26px; font-weight: bold; color: #ffd36b; text-shadow: 0 0 12px rgba(255,176,0,.7); word-break: break-word; text-transform: uppercase; letter-spacing: 1px; }
.tq-face .lbl { font-size: 11px; letter-spacing: 2px; color: #8fcf7f; }
.tq-face.back .lbl { color: #d9a640; }
.tq-cat { font-size: 12px; letter-spacing: 1px; padding: 2px 8px; border-radius: 10px; border: 1px solid #3ad7ff; color: #3ad7ff; background: rgba(58,215,255,.08); }
.tq-burst { position: absolute; left: 50%; top: 50%; width: 8px; height: 8px; border-radius: 2px; pointer-events: none; z-index: 4; }
.tq-meter { width: 220px; }
.tq-meter .cnt { display: flex; justify-content: space-between; font-size: 12px; color: #6fae5f; letter-spacing: 1px; margin-bottom: 4px; }
.tq-meter .cnt b { color: #c8ffc0; font-size: 16px; }
.tq-pips { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; }
.tq-pip { height: 14px; border-radius: 3px; border: 1px solid #1f5f12; background: #061006; transition: background .3s, border-color .3s, box-shadow .3s; }
.tq-pip.yes { background: #39ff14; border-color: #39ff14; box-shadow: 0 0 6px #39ff14; }
.tq-pip.no { background: #ff4d4d; border-color: #ff4d4d; }
.tq-pip.sometimes { background: #ffb000; border-color: #ffb000; }
.tq-pip.unknown { background: #5f7f78; border-color: #8aa; }
.tq-pip.correct { background: #ffd36b; border-color: #fff; box-shadow: 0 0 10px #ffd36b; }
.tq-pip.pending { border-color: #c8ffc0; animation: tq-blink 1s steps(2) infinite; }
.tq-pip.guess { border-radius: 50%; }
@keyframes tq-blink { 50% { background: #1f5f12; } }
.tq-pip.pop { animation: tq-pippop .35s ease-out; }
@keyframes tq-pippop { 40% { transform: scale(1.4); } }
.tq-meter.low .cnt b { color: #ff4d4d; }
.tq-right { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.tq-log { height: 260px; overflow-y: auto; border: 1px solid #1f8f0c; border-radius: 8px; background: rgba(3,10,3,.75); padding: 6px; display: flex; flex-direction: column; gap: 4px; scroll-behavior: smooth; }
.tq-log .empty { color: #4f7f45; font-size: 13px; text-align: center; margin: auto; padding: 10px; }
.tq-q { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 6px; background: rgba(31,143,12,.08); border-left: 3px solid var(--c, #1f8f0c); animation: tq-in .3s ease-out; }
@keyframes tq-in { from { opacity: 0; transform: translateY(8px); } }
.tq-q .n { font-size: 11px; color: #6fae5f; min-width: 20px; text-align: right; font-variant-numeric: tabular-nums; }
.tq-q .t { flex: 1; min-width: 0; overflow-wrap: anywhere; color: #e6ffe0; }
.tq-q.guess .t { color: #ffd36b; font-weight: bold; }
.tq-stamp { flex: none; font-size: 12px; font-weight: bold; letter-spacing: 1px; padding: 2px 7px; border-radius: 4px; border: 2px solid currentColor; transform: rotate(-4deg); }
.tq-stamp.yes { color: #39ff14; } .tq-stamp.no { color: #ff4d4d; } .tq-stamp.sometimes { color: #ffb000; } .tq-stamp.unknown { color: #8aa; }
.tq-stamp.correct { color: #111; background: #ffd36b; border-color: #ffd36b; box-shadow: 0 0 12px #ffd36b; }
.tq-stamp.wait { border-color: transparent; color: #6fae5f; transform: none; }
.tq-stamp.slam { animation: tq-slam .35s cubic-bezier(.2,1.6,.4,1); }
@keyframes tq-slam { from { transform: scale(2.4) rotate(-14deg); opacity: 0; } }
.tq-dots span { animation: tq-dot 1.2s infinite; opacity: .2; }
.tq-dots span:nth-child(2) { animation-delay: .2s; } .tq-dots span:nth-child(3) { animation-delay: .4s; }
@keyframes tq-dot { 30% { opacity: 1; } }
.tq-root [hidden] { display: none !important; }
.tq-panel { border: 1px solid #1f8f0c; border-radius: 8px; padding: 10px; background: rgba(8,20,8,.6); display: flex; flex-direction: column; gap: 8px; }
.tq-panel.hot { border-color: #39ff14; box-shadow: 0 0 14px -4px #39ff14; }
.tq-panel h4 { margin: 0; font-size: 13px; letter-spacing: 2px; color: #8fcf7f; font-weight: normal; }
.tq-sugs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
@media (max-width: 420px) { .tq-sugs { grid-template-columns: 1fr; } }
.tq-sug { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 10px 4px !important; font-size: 16px !important; text-transform: uppercase; }
.tq-sug small { font-size: 10px; letter-spacing: 1px; opacity: .75; text-transform: none; }
.tq-sug .e { font-size: 22px; }
.tq-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.tq-row input[type=text] { flex: 1 1 160px; min-width: 0; background: #020802; color: #e6ffe0; border: 1px solid #1f8f0c; border-radius: 4px; padding: 8px; font: inherit; font-size: 16px; }
.tq-row input[type=text]:focus { outline: none; border-color: #39ff14; box-shadow: 0 0 8px -2px #39ff14; }
.tq-row select { background: #0d1117; color: #3ad7ff; border: 1px solid #3ad7ff; border-radius: 4px; font: inherit; padding: 6px 4px; }
.tq-or { font-size: 11px; color: #4f7f45; text-align: center; letter-spacing: 2px; }
.tq-hint { font-size: 12px; color: #6fae5f; }
.tq-hint.warn { color: #ffb000; }
.tq-ideas { display: flex; gap: 5px; flex-wrap: wrap; }
.tq-idea { font-size: 12px !important; padding: 3px 8px !important; border-radius: 12px !important; opacity: .85; }
.tq-ask-q { font-size: 20px; font-weight: bold; color: #e6ffe0; text-align: center; padding: 6px; overflow-wrap: anywhere; }
.tq-ask-q.guess { color: #ffd36b; }
.tq-answers { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
@media (max-width: 480px) { .tq-answers { grid-template-columns: repeat(2, 1fr); } }
.tq-answers.two { grid-template-columns: repeat(2, 1fr); }
.tq-ans { font-size: 16px !important; font-weight: bold; padding: 12px 4px !important; border: 2px solid var(--a) !important; color: var(--a) !important; background: rgba(0,0,0,.4) !important; transition: transform .08s, background .15s; }
.tq-ans:hover { background: color-mix(in srgb, var(--a) 22%, transparent) !important; }
.tq-ans:active { transform: scale(.95); }
.tq-ans kbd { display: block; font-size: 10px; opacity: .6; font-family: inherit; }
.tq-gotit { align-self: center; font-size: 12px !important; }
.tq-wait { text-align: center; color: #8fcf7f; padding: 10px 4px; }
.tq-result { text-align: center; padding: 10px 6px; border-radius: 8px; border: 2px solid var(--r); box-shadow: 0 0 22px -6px var(--r); animation: tq-in .4s ease-out; }
.tq-result .big { font-size: 22px; font-weight: bold; color: var(--r); text-shadow: 0 0 10px var(--r); }
.tq-result .sm { font-size: 13px; color: #c8ffc0; margin-top: 4px; }
.tq-recap { font-size: 12px; color: #6fae5f; text-align: center; }
.tq-btns { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.tq-btn-hot { background: #39ff14 !important; color: #000 !important; font-weight: bold; }
@media (prefers-reduced-motion: reduce) {
  .tq-card-in { transition: none; } .tq-face.front .q, .tq-status.mine, .tq-pip.pending { animation: none; }
  .tq-q, .tq-stamp.slam, .tq-seat .score.bump, .tq-result, .tq-pip.pop { animation: none; }
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
const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(text, onClick, cls) {
  const b = el('button', cls || '', text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
const dots = () => { const d = el('span', 'tq-dots'); d.innerHTML = '<span>.</span><span>.</span><span>.</span>'; return d; };

export function mount(container, api) {
  ensureStyles();
  let view = null;
  let roster = [];
  let flashTimer = null;
  let countdownTimer = null;
  let roundDeadline = 0;
  let seatSig = '';
  let logKey = ''; // `${round}` of the entries in the log
  let shownPanel = null;
  let prevScores = null;
  const results = createResults(container);

  // ---------- static layout ----------
  const root = el('div', 'tq-root');
  const status = el('div', 'tq-status', 'Loading...');
  const err = el('div', 'tq-err');
  const seats = el('div', 'tq-seats');
  const main = el('div', 'tq-main');
  root.append(status, err, seats, main);
  container.appendChild(root);

  // Left column: secret card + question meter.
  const left = el('div', 'tq-left');
  const card = el('div', 'tq-card');
  const cardIn = el('div', 'tq-card-in');
  const front = el('div', 'tq-face front');
  const frontQ = el('div', 'q', '?');
  const frontLbl = el('div', 'lbl', 'SECRET WORD');
  const frontCat = el('div', 'tq-cat');
  front.append(frontQ, frontLbl, frontCat);
  const back = el('div', 'tq-face back');
  const backLbl = el('div', 'lbl', 'YOUR SECRET WORD');
  const backWord = el('div', 'w');
  const backCat = el('div', 'tq-cat');
  back.append(backLbl, backWord, backCat);
  cardIn.append(front, back);
  card.appendChild(cardIn);
  const meter = el('div', 'tq-meter');
  const meterCnt = el('div', 'cnt');
  const meterUsed = el('span');
  const meterLeft = el('span');
  meterCnt.append(meterUsed, meterLeft);
  const pipsBox = el('div', 'tq-pips');
  const pips = [];
  for (let i = 0; i < 20; i++) { const p = el('div', 'tq-pip'); pips.push(p); pipsBox.appendChild(p); }
  meter.append(meterCnt, pipsBox);
  const recap = el('div', 'tq-recap');
  left.append(card, meter, recap);

  // Right column: log + the one active panel.
  const right = el('div', 'tq-right');
  const log = el('div', 'tq-log');
  right.appendChild(log);
  main.append(left, right);

  // Picking panel.
  const pickPanel = el('div', 'tq-panel hot');
  const sugBox = el('div', 'tq-sugs');
  const rerollBtn = btn('🎲 NEW SUGGESTIONS', () => api.sendAction({ kind: 'reroll' }));
  const pickInput = el('input');
  pickInput.type = 'text';
  pickInput.placeholder = 'or type your own word';
  pickInput.maxLength = 30;
  pickInput.autocomplete = 'off';
  pickInput.spellcheck = true;
  const pickCat = el('select');
  for (const c of ['object', 'animal', 'food', 'place', 'person', 'any']) {
    const o = el('option', '', `${CAT_EMOJI[c]} ${CAT_LABEL[c].toLowerCase()}`);
    o.value = c;
    pickCat.appendChild(o);
  }
  pickCat.title = 'Category shown to the guesser';
  const pickGo = btn('USE IT', () => submitPick());
  const pickRow = el('div', 'tq-row');
  pickRow.append(pickInput, pickCat, pickGo);
  const pickHint = el('div', 'tq-hint');
  pickPanel.append(el('h4', '', '🤫 PICK A SECRET WORD'), sugBox, el('div', 'tq-row'), pickRow, pickHint);
  pickPanel.children[2].append(rerollBtn);
  pickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitPick(); } });
  function submitPick() {
    const word = pickInput.value.trim();
    if (!word) { flash('bad_word'); return; }
    api.sendAction({ kind: 'pick', word, category: pickCat.value });
    sfx.play('select');
  }

  // Asking panel.
  const askPanel = el('div', 'tq-panel hot');
  const askInput = el('input');
  askInput.type = 'text';
  askInput.placeholder = 'Ask a yes/no question…';
  askInput.maxLength = 100;
  askInput.autocomplete = 'off';
  askInput.spellcheck = true;
  const askBtn = btn('ASK ❓', () => submitAsk('ask'), 'tq-btn-hot');
  const guessBtn = btn('GUESS 🎯', () => submitAsk('guess'));
  const askRow = el('div', 'tq-row');
  askRow.append(askInput, askBtn, guessBtn);
  const ideas = el('div', 'tq-ideas');
  const askHint = el('div', 'tq-hint');
  askPanel.append(el('h4', '', '🔍 YOUR QUESTION'), askRow, ideas, askHint);
  askInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitAsk('ask'); } });
  let ideasKey = '';
  function submitAsk(kind) {
    let text = askInput.value.trim();
    if (!text) { flash('empty'); askInput.focus(); return; }
    if (kind === 'guess') text = text.replace(/^(is it|it's|its)\s+(an?|the)\s+/i, '').replace(/[?!.]+$/, '').trim();
    api.sendAction({ kind, text });
    askInput.value = '';
    sfx.play('blip');
  }

  // Answering panel.
  const ansPanel = el('div', 'tq-panel hot');
  const ansQ = el('div', 'tq-ask-q');
  const ansBox = el('div', 'tq-answers');
  const ANS_DEF = [
    ['yes', 'YES', '#39ff14', 'Y'], ['no', 'NO', '#ff4d4d', 'N'], ['sometimes', 'SOMETIMES', '#ffb000', 'S'], ['unknown', "DON'T KNOW", '#8aa', 'U'],
  ];
  const ansBtns = {};
  for (const [v, label, color, key] of ANS_DEF) {
    const b = btn('', () => answer(v), 'tq-ans');
    b.style.setProperty('--a', color);
    b.append(label, Object.assign(el('kbd'), { textContent: key }));
    ansBtns[v] = b;
  }
  const correctBtn = btn('', () => answer('correct'), 'tq-ans');
  correctBtn.style.setProperty('--a', '#ffd36b');
  correctBtn.append('CORRECT!', Object.assign(el('kbd'), { textContent: 'Y' }));
  const wrongBtn = btn('', () => answer('no'), 'tq-ans');
  wrongBtn.style.setProperty('--a', '#ff4d4d');
  wrongBtn.append('NOPE', Object.assign(el('kbd'), { textContent: 'N' }));
  const gotIt = btn('✔ They got it — that IS my word', () => answer('correct'), 'tq-gotit');
  ansPanel.append(el('h4', '', '💬 ANSWER HONESTLY'), ansQ, ansBox, gotIt);
  function answer(v) {
    if (!isMyAnswerTurn()) return;
    api.sendAction({ kind: 'answer', value: v });
    sfx.play('click');
  }

  // Waiting / result panels.
  const waitPanel = el('div', 'tq-panel');
  const waitText = el('div', 'tq-wait');
  waitPanel.appendChild(waitText);
  const roundPanel = el('div', 'tq-panel');
  const resultBox = el('div', 'tq-result');
  const resultBig = el('div', 'big');
  const resultSm = el('div', 'sm');
  resultBox.append(resultBig, resultSm);
  const nextInfo = el('div', 'tq-hint');
  nextInfo.style.textAlign = 'center';
  const roundBtns = el('div', 'tq-btns');
  const nextBtn = btn('NEXT ROUND ▶', () => api.sendAction({ kind: 'nextRound' }), 'tq-btn-hot');
  const newGameBtn = btn('NEW GAME (SWAP WHO PICKS FIRST)', () => api.sendAction({ kind: 'resetGame' }), 'tq-btn-hot');
  roundBtns.append(nextBtn, newGameBtn);
  roundPanel.append(resultBox, nextInfo, roundBtns);

  const panels = [pickPanel, askPanel, ansPanel, waitPanel, roundPanel];
  for (const p of panels) { p.hidden = true; right.appendChild(p); }

  const leaveRow = el('div', 'tq-btns');
  const leaveBtn = btn('LEAVE SEAT', () => api.sendAction({ kind: 'leaveSeat' }));
  leaveRow.appendChild(leaveBtn);
  root.appendChild(leaveRow);

  function onKey(e) {
    if (!isMyAnswerTurn() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.activeElement && document.activeElement.matches('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    const last = view.questions[view.questions.length - 1];
    const map = last && last.kind === 'guess' ? { y: 'correct', n: 'no' } : { y: 'yes', n: 'no', s: 'sometimes', u: 'unknown' };
    if (map[k]) { e.preventDefault(); answer(map[k]); }
  }
  window.addEventListener('keydown', onKey);

  // ---------- helpers ----------
  function nicknameFor(id) {
    if (!id) return null;
    if (id === 'BOT') return '🤖 Bot';
    const r = roster.find((x) => x.clientId === id);
    return r ? r.nickname : 'someone';
  }
  const seatName = (seat) => (view && view.players[seat] ? nicknameFor(view.players[seat]) : '(empty)');
  function mySeat() {
    const me = api.getClientId();
    if (!view || !me) return null;
    return view.players.p1 === me ? 'p1' : view.players.p2 === me ? 'p2' : null;
  }
  const isMyAnswerTurn = () => view && view.phase === 'answering' && mySeat() === view.picker;
  function flash(reason) {
    err.textContent = REJECT_MESSAGES[reason] || 'Not allowed';
    sfx.play('error');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { err.textContent = ''; }, 2200);
  }
  function burst(colors) {
    if (reduced()) return;
    for (let i = 0; i < 28; i++) {
      const s = el('div', 'tq-burst');
      s.style.background = colors[i % colors.length];
      card.appendChild(s);
      const a = Math.random() * Math.PI * 2;
      const d = 70 + Math.random() * 90;
      s.animate([
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
        { transform: `translate(${Math.cos(a) * d - 4}px, ${Math.sin(a) * d - 4}px) rotate(${Math.random() * 540}deg) scale(.6)`, opacity: 0 },
      ], { duration: 700 + Math.random() * 400, easing: 'cubic-bezier(.1,.8,.3,1)' }).onfinish = () => s.remove();
    }
  }
  function showPanel(p) {
    for (const x of panels) x.hidden = x !== p;
    const changed = shownPanel !== p;
    shownPanel = p;
    return changed;
  }
  const focusIfFree = (input) => setTimeout(() => {
    if (input.isConnected && !input.closest('[hidden]') && !(document.activeElement && document.activeElement.matches('input, textarea, select'))) input.focus({ preventScroll: true });
  }, 0);

  // ---------- render pieces ----------
  function renderSeats() {
    const seat = mySeat();
    const active = !view ? null : view.phase === 'asking' ? view.guesser : (view.phase === 'picking' || view.phase === 'answering') ? view.picker : null;
    const inMatch = view && view.phase !== 'waiting';
    const sig = JSON.stringify([view.players, view.botLevels, view.scores, view.series, view.picker, active, seat, inMatch, view.round,
      view.players.p1 && nicknameFor(view.players.p1), view.players.p2 && nicknameFor(view.players.p2)]);
    if (sig === seatSig) return;
    seatSig = sig;
    seats.innerHTML = '';
    const mk = (s) => {
      const box = el('div', `tq-seat${active === s ? ' turn' : ''}`);
      box.style.setProperty('--c', SEAT_COLOR[s]);
      const row = el('div', 'row');
      row.append(el('span', 'tq-chip'), el('span', 'nm', `${seatName(s)}${view.players[s] && view.players[s] === api.getClientId() ? ' (you)' : ''}`));
      if (inMatch && view.picker) row.appendChild(el('span', 'role', view.picker === s ? '🤫 PICKER' : '🔍 GUESSER'));
      const sc = el('span', 'score', String(view.scores[s]));
      if (prevScores && view.scores[s] > prevScores[s] && !reduced()) sc.classList.add('bump');
      row.appendChild(sc);
      box.appendChild(row);
      const ctl = el('div', 'row');
      if (!view.players[s]) {
        if (!seat) ctl.appendChild(btn('PLAY HERE', () => api.sendAction({ kind: 'sit', seat: s })));
        ctl.append(btn('PLAY VS BOT', () => api.sendAction({ kind: 'sit', seat: s, bot: true, level: preferredLevel() })), levelSelect(preferredLevel()));
      } else if (view.players[s] === 'BOT') {
        ctl.append(levelSelect((view.botLevels || {})[s], (level) => api.sendAction({ kind: 'setBotLevel', seat: s, level })),
          btn('REMOVE BOT', () => api.sendAction({ kind: 'removeBot', seat: s })));
      }
      if (ctl.childNodes.length) box.appendChild(ctl);
      const wins = (view.series || {})[s] || 0;
      box.appendChild(el('div', 'sub', `points this match · matches won: ${wins}`));
      return box;
    };
    const mid = el('div', 'tq-mid');
    if (inMatch) mid.append(el('div', '', 'ROUND'), el('b', '', `${Math.max(1, view.round)}/${view.rounds}`));
    else mid.append(el('div', '', '20'), el('b', '', 'Q'));
    seats.append(mk('p1'), mid, mk('p2'));
  }

  function renderCard() {
    const seat = mySeat();
    const cat = view.category;
    const reveal = view.phase === 'round_over' || view.phase === 'game_over';
    const showWord = !!view.secretWord && (reveal || seat === view.picker);
    frontCat.hidden = !cat;
    if (cat) frontCat.textContent = `${CAT_EMOJI[cat] || '❔'} ${CAT_LABEL[cat] || 'ANYTHING'}`;
    frontLbl.textContent = view.phase === 'waiting' ? 'WAITING FOR PLAYERS' : view.phase === 'picking' ? 'PICKING A WORD…' : 'SECRET WORD';
    if (showWord) {
      backWord.textContent = view.secretWord;
      backLbl.textContent = reveal ? 'THE WORD WAS' : 'YOUR SECRET WORD';
      backCat.textContent = frontCat.textContent;
      backCat.hidden = !cat;
    }
    cardIn.classList.toggle('flip', showWord);
  }

  function renderMeter() {
    const qs = view.questions;
    const used = qs.length;
    meterUsed.innerHTML = '';
    meterUsed.append(el('b', '', String(used)), ` / ${view.maxQ} QUESTIONS`);
    meterLeft.textContent = view.phase === 'waiting' ? '' : `${view.maxQ - used} LEFT`;
    meter.classList.toggle('low', view.maxQ - used <= 3 && view.phase !== 'waiting');
    pips.forEach((p, i) => {
      const q = qs[i];
      const cls = `tq-pip${q ? ` ${q.answer || 'pending'}` : ''}${q && q.kind === 'guess' ? ' guess' : ''}`;
      if (p.dataset.c !== cls) {
        const was = p.dataset.c;
        p.className = cls;
        if (was && q && q.answer && !reduced()) p.classList.add('pop');
        p.dataset.c = cls;
      }
    });
    const log2 = view.roundLog || [];
    recap.textContent = log2.length ? log2.map((r) => `R${r.round}: ${r.word.toUpperCase()} — ${r.solved ? `solved in ${r.questions}` : 'stumped'} (+${r.points} ${seatName(r.winner)})`).join('\n') : '';
    recap.style.whiteSpace = 'pre-line';
  }

  function stampFor(q) {
    if (!q.answer) {
      const s = el('span', 'tq-stamp wait');
      s.appendChild(dots());
      return s;
    }
    return el('span', `tq-stamp ${q.answer}`, ANSWER_LABEL[q.answer] || q.answer.toUpperCase());
  }

  function renderLog() {
    const key = `${view.round}:${view.phase === 'waiting' ? 'w' : ''}`;
    if (key !== logKey) {
      logKey = key;
      log.innerHTML = '';
    }
    const qs = view.questions;
    const items = Array.from(log.querySelectorAll('.tq-q'));
    if (items.length > qs.length) { log.innerHTML = ''; items.length = 0; }
    let added = false;
    qs.forEach((q, i) => {
      let row = items[i];
      if (!row) {
        row = el('div', `tq-q${q.kind === 'guess' ? ' guess' : ''}`);
        row.style.setProperty('--c', SEAT_COLOR[view.guesser] || '#1f8f0c');
        row.append(el('span', 'n', String(q.n)), el('span', 't', q.kind === 'guess' ? `🎯 Is it ${/^[aeiou]/i.test(q.text) ? 'an' : 'a'} ${q.text}?` : q.text), stampFor(q));
        row.dataset.a = q.answer || '';
        const empty = log.querySelector('.empty');
        if (empty) empty.remove();
        log.appendChild(row);
        added = true;
      } else if (row.dataset.a !== (q.answer || '')) {
        row.dataset.a = q.answer || '';
        const st = stampFor(q);
        if (!reduced()) st.classList.add('slam');
        row.replaceChild(st, row.lastChild);
        added = true;
      }
    });
    if (!qs.length && !log.querySelector('.empty')) {
      const msg = view.phase === 'waiting' ? 'Questions and answers will appear here.'
        : view.phase === 'picking' ? 'The picker is choosing a secret word…' : 'No questions yet — ask away!';
      log.appendChild(el('div', 'empty', msg));
    } else if (!qs.length) {
      log.querySelector('.empty').textContent = view.phase === 'picking' ? 'The picker is choosing a secret word…' : 'No questions yet — ask away!';
    }
    if (added) log.scrollTop = log.scrollHeight;
  }

  function renderPanels() {
    const seat = mySeat();
    const ph = view.phase;
    const picker = view.picker;
    const guesser = view.guesser;
    const opponentBot = seat && view.players[seat === 'p1' ? 'p2' : 'p1'] === 'BOT';
    nextBtn.hidden = true;
    newGameBtn.hidden = true;

    if (ph === 'picking' && seat === picker) {
      const fresh = showPanel(pickPanel);
      const sig = JSON.stringify(view.suggestions);
      if (sugBox.dataset.sig !== sig) {
        sugBox.dataset.sig = sig;
        sugBox.innerHTML = '';
        view.suggestions.forEach((s, i) => {
          const b = btn('', () => { api.sendAction({ kind: 'pick', index: i }); sfx.play('select'); }, 'tq-sug');
          b.append(el('span', 'e', CAT_EMOJI[s.category] || '❔'), el('span', '', s.word), el('small', '', CAT_LABEL[s.category].toLowerCase()));
          sugBox.appendChild(b);
        });
      }
      pickHint.textContent = opponentBot ? '🤖 The bot only knows its built-in words — the suggestions are safe picks.' : 'The guesser sees only the category.';
      pickHint.className = `tq-hint${opponentBot ? ' warn' : ''}`;
      if (fresh) { pickInput.value = ''; }
      return;
    }
    if (ph === 'asking' && seat === guesser) {
      const fresh = showPanel(askPanel);
      const left = view.maxQ - view.questions.length;
      askHint.textContent = `${left} question${left === 1 ? '' : 's'} left · a guess costs a question${opponentBot ? ' · the bot answers simple yes/no questions about common traits' : ''}`;
      const asked = new Set(view.questions.map((q) => q.text.toLowerCase()));
      const k = `${view.round}:${view.questions.length}`;
      if (k !== ideasKey) {
        ideasKey = k;
        ideas.innerHTML = '';
        const pool = IDEAS.filter((t) => !asked.has(t.toLowerCase()));
        const start = (view.questions.length * 5 + view.round * 7) % Math.max(1, pool.length);
        for (let i = 0; i < Math.min(4, pool.length); i++) {
          const t = pool[(start + i) % pool.length];
          ideas.appendChild(btn(t, () => { askInput.value = t; askInput.focus(); }, 'tq-idea'));
        }
      }
      if (fresh) focusIfFree(askInput);
      return;
    }
    if (ph === 'answering' && seat === picker) {
      const fresh = showPanel(ansPanel);
      const q = view.questions[view.questions.length - 1];
      const isGuess = q && q.kind === 'guess';
      ansQ.textContent = q ? (isGuess ? `🎯 They guess: “${q.text}”` : `“${q.text}”`) : '';
      ansQ.className = `tq-ask-q${isGuess ? ' guess' : ''}`;
      const want = isGuess ? [correctBtn, wrongBtn] : ANS_DEF.map(([v]) => ansBtns[v]);
      if (fresh || ansBox.dataset.mode !== String(isGuess)) {
        ansBox.dataset.mode = String(isGuess);
        ansBox.innerHTML = '';
        ansBox.append(...want);
        ansBox.classList.toggle('two', isGuess);
      }
      gotIt.hidden = isGuess;
      return;
    }
    if (ph === 'round_over' || ph === 'game_over') {
      showPanel(roundPanel);
      const r = view.result;
      if (r) {
        const mine = seat === r.winner;
        resultBox.style.setProperty('--r', r.solved ? '#ffd36b' : '#ff7ad9');
        resultBig.textContent = r.solved
          ? `🎉 ${r.guesser === seat ? 'YOU GOT IT' : `${seatName(r.guesser)} GOT IT`} IN ${r.questions}!`
          : `🤐 STUMPED! ${r.picker === seat ? 'You win the round' : `${seatName(r.picker)} wins the round`}`;
        resultSm.textContent = `The word was “${r.word}” · +${r.points} to ${mine ? 'you' : seatName(r.winner)}`;
      }
      if (ph === 'round_over') {
        nextBtn.hidden = !seat;
        updateCountdown();
      } else {
        nextInfo.textContent = view.winner === 'draw' ? "Match drawn!" : `${view.winner === seat ? 'You win' : `${seatName(view.winner)} wins`} the match ${Math.max(view.scores.p1, view.scores.p2)}–${Math.min(view.scores.p1, view.scores.p2)}`;
        newGameBtn.hidden = !seat;
      }
      return;
    }
    // Everything else: a waiting message.
    showPanel(waitPanel);
    waitText.innerHTML = '';
    let msg;
    if (ph === 'waiting') msg = seat ? 'Waiting for an opponent — or fill the other seat with a bot' : 'Take a seat or PLAY VS BOT to start';
    else if (ph === 'picking') msg = `${seatName(picker)} is picking a secret word`;
    else if (ph === 'asking') msg = `${seatName(guesser)} is thinking of a question`;
    else if (ph === 'answering') msg = `${seatName(picker)} is answering`;
    waitText.append(msg);
    if (ph !== 'waiting') waitText.appendChild(dots());
  }

  function updateCountdown() {
    if (!view || view.phase !== 'round_over') return;
    const s = Math.max(0, Math.ceil((roundDeadline - performance.now()) / 1000));
    nextInfo.textContent = `Round ${view.round + 1} starts in ${s}s — roles swap`;
  }

  function renderStatus() {
    const seat = mySeat();
    const ph = view.phase;
    let text;
    let mine = false;
    if (ph === 'waiting') text = 'Waiting for both seats to be filled.';
    else if (ph === 'picking') { mine = seat === view.picker; text = mine ? '▶ YOUR TURN — pick a secret word' : `${seatName(view.picker)} is picking a word…`; }
    else if (ph === 'asking') { mine = seat === view.guesser; text = mine ? `▶ YOUR TURN — ask or guess (question ${view.questions.length + 1}/${view.maxQ})` : `${seatName(view.guesser)} is asking question ${view.questions.length + 1}…`; }
    else if (ph === 'answering') { mine = seat === view.picker; text = mine ? '▶ YOUR TURN — answer the question' : `Waiting for ${seatName(view.picker)} to answer…`; }
    else if (ph === 'round_over') text = `ROUND ${view.round} OVER — the word was “${view.result ? view.result.word : '?'}”`;
    else text = view.winner === 'draw' ? "IT'S A DRAW!" : `${view.winner === seat ? 'YOU WIN' : `${seatName(view.winner).toUpperCase()} WINS`} THE MATCH!`;
    status.textContent = text;
    status.classList.toggle('mine', mine);
    status.style.color = ph === 'game_over' || ph === 'round_over' ? '#ffb000' : '';
  }

  function renderResults() {
    const seat = mySeat();
    if (!view || view.phase !== 'game_over') { results.update(null); return; }
    const order = ['p1', 'p2'].sort((a, b) => view.scores[b] - view.scores[a]);
    const draw = view.winner === 'draw';
    results.update({
      title: draw ? "IT'S A DRAW" : seat ? (seat === view.winner ? 'YOU WIN!' : 'YOU LOSE') : `${seatName(view.winner).toUpperCase()} WINS!`,
      subtitle: (view.roundLog || []).map((r) => `${r.word.toUpperCase()} ${r.solved ? `in ${r.questions}` : '(stumped)'}`).join(' · '),
      outcome: draw ? 'draw' : !seat ? 'over' : seat === view.winner ? 'win' : 'lose',
      rows: order.map((s) => ({ name: seatName(s), value: `${view.scores[s]} pts`, win: !draw && s === view.winner, you: s === seat })),
      rematch: seat ? { label: 'REMATCH', onClick: () => api.sendAction({ kind: 'resetGame' }) } : null,
    });
  }

  function render() {
    if (!view) return;
    renderStatus();
    renderSeats();
    renderCard();
    renderMeter();
    renderLog();
    renderPanels();
    renderResults();
    leaveRow.hidden = !mySeat();
    prevScores = { ...view.scores };
  }

  // ---------- sounds / juice on state transitions ----------
  function react(prev, next) {
    const seat = mySeat();
    if (!prev || prev.round !== next.round || prev.phase === 'waiting') {
      if (next.phase === 'picking' && prev && prev.phase !== 'picking') sfx.play(next.picker === seat ? 'turn' : 'whoosh');
      return;
    }
    const pq = prev.questions;
    const nq = next.questions;
    if (nq.length > pq.length) {
      const q = nq[nq.length - 1];
      if (seat !== next.guesser) sfx.play('pop');
      if (q.answer) setTimeout(() => answerSound(q.answer), 120);
    } else if (nq.length && pq.length === nq.length && !pq[pq.length - 1].answer && nq[nq.length - 1].answer) {
      answerSound(nq[nq.length - 1].answer);
    }
    if (next.phase !== prev.phase) {
      if ((next.phase === 'asking' && seat === next.guesser) || (next.phase === 'answering' && seat === next.picker)) setTimeout(() => sfx.play('turn'), 380);
      if (next.phase === 'round_over' || next.phase === 'game_over') {
        const r = next.result;
        if (r) {
          setTimeout(() => {
            if (r.solved) { sfx.play('chime'); burst(['#ffd36b', '#39ff14', '#3ad7ff', '#ff7ad9']); }
            else burst(['#ff7ad9', '#ffb000']);
            if (seat) setTimeout(() => sfx.play(seat === r.winner ? 'win' : 'lose'), 450);
            else setTimeout(() => sfx.play('point'), 450);
          }, 250);
        }
      }
    }
  }
  function answerSound(a) {
    if (a === 'yes') sfx.play('point');
    else if (a === 'no') sfx.play('beep');
    else if (a === 'sometimes') sfx.play('select');
    else if (a === 'unknown') sfx.play('click');
  }

  function setView(v) {
    view = v;
    roundDeadline = v.nextInMs != null ? performance.now() + v.nextInMs : 0;
    clearInterval(countdownTimer);
    if (v.phase === 'round_over') countdownTimer = setInterval(updateCountdown, 250);
  }

  return {
    applySnapshot(snapshot) {
      if (!snapshot) return;
      setView(snapshot);
      prevScores = null;
      render();
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        const prev = view;
        const { kind, ...v } = data;
        setView(v);
        react(prev, v);
        render();
      } else if (data.kind === 'moveRejected') {
        flash(data.reason);
      }
    },
    applyRoster(newRoster) {
      roster = Array.isArray(newRoster) ? newRoster : [];
      seatSig = '';
      if (view) render();
    },
    unmount() {
      clearTimeout(flashTimer);
      clearInterval(countdownTimer);
      window.removeEventListener('keydown', onKey);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
