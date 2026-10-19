// Gartic Phone-style drawing telephone — 3-8 players. Round 0 everyone writes a secret prompt;
// each round after that alternates drawing what you're shown / guessing what you're shown, always
// based only on the immediately-previous entry. Every round is timed (whatever you have is sent
// when it runs out). Afterwards the chains are revealed one link at a time, in sync for everyone.
// Server plugin: ../../../server/games/garticphone.js

import { makeServerClock } from '../serverClock.js';
import { sfx } from '../sfx.js';
import { timerBar, scribble } from '../drawFx.js';

const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 320;
const MAX_DRAWING_LEN = 60000; // kept in sync by hand with server/games/garticphone.js
const COLORS = ['#111111', '#ffffff', '#ff4d4d', '#ffb000', '#ffe14d', '#39ff14', '#1f8f0c', '#00e5ff', '#4d79ff', '#a64dff', '#ff4dd2', '#8b5a2b'];
const SIZES = [3, 7, 14, 28];
const ROUND_SECS = [60, 90, 120];

const CSS = `
.gp-card { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; box-sizing: border-box; padding: 14px; border: 1px solid #1f8f0c; border-radius: 10px; background: rgba(57,255,20,.04); }
.gp-label { font-size: 11px; letter-spacing: 3px; opacity: .75; }
.gp-quote { font-size: 1.5em; font-style: italic; text-align: center; color: #ffb000; word-break: break-word; }
.gp-img { width: ${CANVAS_WIDTH}px; max-width: 100%; aspect-ratio: ${CANVAS_WIDTH} / ${CANVAS_HEIGHT}; background: #fff; border-radius: 6px; box-shadow: 0 0 0 2px #1f8f0c; }
.gp-blank { opacity: .55; font-style: italic; }
.gp-tools { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; align-items: center; }
.gp-swatch { width: 24px; height: 24px; padding: 0; border-radius: 50%; border: 2px solid #333; cursor: pointer; }
.gp-swatch.on { border-color: #fff; box-shadow: 0 0 0 2px #39ff14; }
.gp-size { width: 30px; height: 30px; padding: 0; display: flex; align-items: center; justify-content: center; }
.gp-size span { display: block; border-radius: 50%; background: currentColor; }
.gp-size.on { box-shadow: 0 0 0 2px #39ff14; }
.gp-canvas { display: block; max-width: 100%; height: auto; background: #fff; border-radius: 6px; box-shadow: 0 0 0 2px #39ff14; touch-action: none; cursor: crosshair; user-select: none; }
.gp-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.gp-pip { padding: 2px 10px; border-radius: 10px; border: 1px solid #444; opacity: .55; font-size: .8em; }
.gp-pip.done { border-color: #39ff14; color: #39ff14; opacity: 1; }
.gp-input { width: 300px; max-width: 70vw; font-size: 1.05em; }
.gp-chain { display: flex; flex-direction: column; align-items: center; gap: 14px; width: 100%; }
.gp-link { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%; }
.gp-who { font-size: .8em; opacity: .7; }
`;

export function mount(container, api) {
  const serverClock = makeServerClock();
  let view = null;
  let roster = [];
  let tickHandle = null;
  // The in-progress task widget is cached across re-renders so another player's submit (which
  // broadcasts new state) doesn't wipe your half-finished drawing or typed text.
  let taskCache = { key: null, el: null, submitNow: null };
  let revealKey = null;

  const style = document.createElement('style');
  style.textContent = CSS;
  container.appendChild(style);

  const root = document.createElement('div');
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '12px';
  root.style.alignItems = 'center';
  root.style.width = '100%';
  root.style.maxWidth = '640px';
  root.style.margin = '0 auto';
  container.appendChild(root);

  const timer = timerBar();
  timer.el.style.width = `${CANVAS_WIDTH}px`;
  timer.el.style.maxWidth = '100%';

  function nicknameFor(clientId) {
    const entry = roster.find((r) => r.clientId === clientId);
    return entry ? entry.nickname : 'someone';
  }
  function mySeatIndex() {
    return view ? view.seats.indexOf(api.getClientId()) : -1;
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  // Pop in once only: a re-render re-inserts cached nodes, which would otherwise replay it.
  function popOnce(node) {
    node.classList.add('dfx-pop');
    node.addEventListener('animationend', () => node.classList.remove('dfx-pop'), { once: true });
    return node;
  }

  function buildCanvasWidget() {
    const wrap = el('div', 'gp-chain');
    const canvas = el('canvas', 'gp-canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    canvas.draggable = false;
    canvas.addEventListener('dragstart', (ev) => ev.preventDefault());
    const cctx = canvas.getContext('2d');
    let color = COLORS[0];
    let size = SIZES[1];
    const strokes = [];

    function drawStroke(s) {
      cctx.strokeStyle = s.color;
      cctx.fillStyle = s.color;
      cctx.lineWidth = s.size;
      cctx.lineCap = 'round';
      cctx.lineJoin = 'round';
      if (s.pts.length === 1) {
        cctx.beginPath();
        cctx.arc(s.pts[0].x, s.pts[0].y, s.size / 2, 0, Math.PI * 2);
        cctx.fill();
        return;
      }
      cctx.beginPath();
      cctx.moveTo(s.pts[0].x, s.pts[0].y);
      for (const p of s.pts) cctx.lineTo(p.x, p.y);
      cctx.stroke();
    }
    function redraw() {
      cctx.fillStyle = '#fff';
      cctx.fillRect(0, 0, canvas.width, canvas.height);
      strokes.forEach(drawStroke);
    }
    redraw();

    const tools = el('div', 'gp-tools');
    const swatches = COLORS.map((c) => {
      const b = el('button', 'gp-swatch');
      b.style.background = c;
      b.title = c;
      b.addEventListener('click', () => { color = c; swatches.forEach((s) => s.classList.toggle('on', s === b)); });
      tools.appendChild(b);
      return b;
    });
    swatches[0].classList.add('on');
    const sizeBtns = SIZES.map((sz) => {
      const b = el('button', 'gp-size');
      const dot = el('span');
      dot.style.width = dot.style.height = `${Math.min(22, sz)}px`;
      b.appendChild(dot);
      b.title = `brush ${sz}`;
      b.addEventListener('click', () => { size = sz; sizeBtns.forEach((s) => s.classList.toggle('on', s === b)); });
      tools.appendChild(b);
      return b;
    });
    sizeBtns[1].classList.add('on');
    const undoBtn = el('button', null, 'UNDO');
    undoBtn.addEventListener('click', () => { strokes.pop(); redraw(); });
    const clearBtn = el('button', null, 'CLEAR');
    clearBtn.addEventListener('click', () => { strokes.length = 0; sfx.play('whoosh'); redraw(); });
    tools.append(undoBtn, clearBtn);

    let cur = null;
    function pos(ev) {
      const rect = canvas.getBoundingClientRect();
      return { x: ((ev.clientX - rect.left) / rect.width) * canvas.width, y: ((ev.clientY - rect.top) / rect.height) * canvas.height };
    }
    canvas.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      cur = { color, size, pts: [pos(ev)] };
      strokes.push(cur);
      canvas.setPointerCapture(ev.pointerId);
      drawStroke(cur);
      scribble();
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (!cur) return;
      ev.preventDefault();
      const p = pos(ev);
      const last = cur.pts[cur.pts.length - 1];
      cur.pts.push(p);
      cctx.strokeStyle = cur.color;
      cctx.lineWidth = cur.size;
      cctx.lineCap = 'round';
      cctx.beginPath();
      cctx.moveTo(last.x, last.y);
      cctx.lineTo(p.x, p.y);
      cctx.stroke();
      scribble();
    });
    const stop = () => { cur = null; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    document.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z' && wrap.isConnected) { ev.preventDefault(); undoBtn.click(); }
    });

    // PNG suits line art; very busy drawings fall back to lossy JPEG so they still fit the cap.
    function exportImage() {
      let url = canvas.toDataURL('image/png');
      for (const q of [0.8, 0.6, 0.4, 0.25]) {
        if (url.length <= MAX_DRAWING_LEN) break;
        url = canvas.toDataURL('image/jpeg', q);
      }
      return url.length <= MAX_DRAWING_LEN ? url : null;
    }

    const doneBtn = el('button', null, 'DONE ✓');
    const send = () => {
      const url = exportImage();
      if (url) api.sendAction({ kind: 'submit', content: url });
    };
    doneBtn.addEventListener('click', send);

    wrap.append(tools, canvas, doneBtn);
    return { el: wrap, submitNow: send };
  }

  function buildTextForm(placeholder) {
    const form = el('form', 'gp-row');
    const input = el('input', 'gp-input');
    input.type = 'text';
    input.maxLength = 200;
    input.placeholder = placeholder;
    const submit = el('button', null, 'DONE ✓');
    submit.type = 'submit';
    form.append(input, submit);
    const send = () => {
      const val = input.value.trim();
      if (val) api.sendAction({ kind: 'submit', content: val });
    };
    form.addEventListener('submit', (ev) => { ev.preventDefault(); send(); });
    setTimeout(() => input.focus(), 0);
    return { el: form, submitNow: send };
  }

  function renderEntry(entry) {
    if (entry.content == null) return el('div', 'gp-blank', entry.type === 'drawing' ? '(no drawing — ran out of time)' : '(nothing written — ran out of time)');
    if (entry.type === 'drawing') {
      const img = el('img', 'gp-img');
      img.src = entry.content;
      img.alt = 'drawing';
      return img;
    }
    return el('div', 'gp-quote', `“${entry.content}”`);
  }

  function buildTask(task) {
    const card = popOnce(el('div', 'gp-card'));
    let widget;
    if (task.taskType === 'prompt') {
      card.appendChild(el('div', 'gp-label', 'WRITE A PROMPT'));
      card.appendChild(el('div', null, 'Something fun for the next player to draw.'));
      widget = buildTextForm('e.g. a cat riding a skateboard');
    } else if (task.taskType === 'drawing') {
      card.appendChild(el('div', 'gp-label', 'DRAW THIS'));
      card.appendChild(renderEntry(task.previousEntry));
      widget = buildCanvasWidget();
    } else {
      card.appendChild(el('div', 'gp-label', 'WHAT IS THIS?'));
      card.appendChild(renderEntry(task.previousEntry));
      widget = buildTextForm('your best guess');
    }
    card.appendChild(widget.el);
    return { el: card, submitNow: widget.submitNow };
  }

  function updateTimer() {
    if (!view || view.phase !== 'playing' || !view.roundEndsAt) return;
    const msLeft = Math.max(0, view.roundEndsAt - serverClock.now());
    timer.update(msLeft / (view.roundSecs * 1000), Math.ceil(msLeft / 1000));
    // Out of time: send whatever is on the canvas / in the box (the server fills gaps later).
    if (msLeft === 0 && taskCache.submitNow && view.myTask && !view.myTask.alreadySubmitted) {
      const fn = taskCache.submitNow;
      taskCache.submitNow = null;
      fn();
    }
  }

  function feedback(prev, next) {
    if (!prev || !next) return;
    if (next.phase !== prev.phase) {
      if (next.phase === 'playing') sfx.play('go');
      else if (next.phase === 'reveal') sfx.play('chime');
      return;
    }
    if (next.phase === 'playing' && next.currentRound !== prev.currentRound) {
      sfx.play('whoosh');
      timer.reset();
    } else if (next.phase === 'playing' && next.myTask && next.myTask.alreadySubmitted && !(prev.myTask && prev.myTask.alreadySubmitted)) {
      sfx.play('pop');
    }
    if (next.phase === 'reveal' && prev.reveal && next.reveal && (next.reveal.step !== prev.reveal.step || next.reveal.bookIdx !== prev.reveal.bookIdx)) {
      sfx.play(next.reveal.done ? 'win' : next.reveal.step === 0 ? 'turn' : 'pop');
    }
  }

  function render() {
    const focused = taskCache.el && taskCache.el.contains(document.activeElement) ? document.activeElement : null;
    root.innerHTML = '';
    if (!view) {
      root.textContent = 'Loading...';
      return;
    }
    if (view.phase !== 'playing') taskCache = { key: null, el: null, submitNow: null };
    const mySeat = mySeatIndex();

    if (view.phase === 'waiting') {
      const card = el('div', 'gp-card');
      card.appendChild(el('div', 'gp-label', 'DRAWING PHONE'));
      card.appendChild(el('div', null, `${view.seats.length}/8 seated — need 3+ to start. One round per player.`));
      const players = el('div', 'gp-row');
      view.seats.forEach((id) => players.appendChild(el('span', 'gp-pip done', nicknameFor(id))));
      card.appendChild(players);
      const row = el('div', 'gp-row');
      if (mySeat === -1 && view.seats.length < 8) {
        const btn = el('button', null, 'SIT DOWN');
        btn.addEventListener('click', () => api.sendAction({ kind: 'sit' }));
        row.appendChild(btn);
      }
      if (mySeat !== -1) {
        const leaveBtn = el('button', null, 'LEAVE SEAT');
        leaveBtn.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
        row.appendChild(leaveBtn);
        for (const secs of ROUND_SECS) {
          const b = el('button', null, `${secs}s${secs === view.roundSecs ? ' ✓' : ''}`);
          b.title = 'time per round';
          b.addEventListener('click', () => api.sendAction({ kind: 'setRoundSecs', secs }));
          row.appendChild(b);
        }
        if (view.seats.length >= 3) {
          const startBtn = el('button', null, 'START GAME');
          startBtn.addEventListener('click', () => api.sendAction({ kind: 'startGame' }));
          row.appendChild(startBtn);
        }
      } else {
        card.appendChild(el('div', null, `${view.roundSecs}s per round`));
      }
      card.appendChild(row);
      root.appendChild(card);
      return;
    }

    if (view.phase === 'playing') {
      root.appendChild(el('div', 'gp-label', `ROUND ${view.currentRound + 1} / ${view.totalRounds}`));
      root.appendChild(timer.el);
      updateTimer();
      const pips = el('div', 'gp-row');
      const done = new Set(view.submittedSeatIdxs);
      view.seats.forEach((id, i) => pips.appendChild(el('span', `gp-pip${done.has(i) ? ' done' : ''}`, `${done.has(i) ? '✓' : '✎'} ${nicknameFor(id)}`)));
      root.appendChild(pips);

      if (mySeat === -1) {
        root.appendChild(el('div', 'gp-blank', 'Game in progress — you can sit in next game.'));
      } else if (view.myTask.alreadySubmitted) {
        const key = `done:${view.currentRound}`;
        if (taskCache.key !== key) {
          const card = el('div', 'gp-card');
          const stamp = el('div', 'dfx-stamp', '✓ SUBMITTED');
          stamp.addEventListener('animationend', () => { stamp.style.animation = 'none'; }, { once: true });
          card.append(stamp, el('div', null, 'Waiting for everyone else...'));
          taskCache = { key, el: card, submitNow: null };
        }
        root.appendChild(taskCache.el);
      } else {
        const key = `${view.currentRound}:${view.myTask.taskType}`;
        if (taskCache.key !== key) taskCache = { key, ...buildTask(view.myTask) };
        root.appendChild(taskCache.el);
        if (focused) focused.focus();
      }
      return;
    }

    // Reveal: one book at a time, links appearing as anyone presses NEXT.
    const rv = view.reveal;
    const card = el('div', 'gp-card');
    card.appendChild(el('div', 'gp-label', `CHAIN ${rv.bookIdx + 1} / ${view.seats.length}`));
    card.appendChild(el('div', null, `${nicknameFor(view.seats[rv.bookIdx])}'s book`));
    const chain = el('div', 'gp-chain');
    rv.entries.forEach((entry, i) => {
      const link = el('div', 'gp-link');
      const verb = entry.type === 'prompt' ? 'wrote' : entry.type === 'drawing' ? 'drew' : 'guessed';
      link.append(el('div', 'gp-who', `${nicknameFor(view.seats[entry.authorIdx])} ${verb}`), renderEntry(entry));
      if (i === rv.entries.length - 1 && revealKey !== `${rv.bookIdx}:${i}`) popOnce(link);
      chain.appendChild(link);
    });
    revealKey = `${rv.bookIdx}:${rv.entries.length - 1}`;
    card.appendChild(chain);
    root.appendChild(card);
    const row = el('div', 'gp-row');
    if (!rv.done && mySeat !== -1) {
      const lastOfBook = rv.step === view.totalRounds - 1;
      const next = el('button', null, lastOfBook ? 'NEXT CHAIN ▶' : 'NEXT ▶');
      next.addEventListener('click', () => api.sendAction({ kind: 'revealNext' }));
      row.appendChild(next);
    }
    if (rv.done) {
      const again = el('button', null, 'PLAY AGAIN');
      again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
      row.appendChild(again);
    }
    root.appendChild(row);
    // Keep the newest link in view as the chain grows.
    const lastLink = chain.lastElementChild;
    if (lastLink && lastLink.classList.contains('dfx-pop')) setTimeout(() => lastLink.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
  }

  render();
  tickHandle = setInterval(updateTimer, 250);

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      if (view) serverClock.sync(view.serverNow);
      render();
    },
    applyEvent(data) {
      if (data && data.kind === 'state') {
        const prevView = view;
        view = data;
        serverClock.sync(view.serverNow);
        feedback(prevView, view);
        render();
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      render();
    },
    unmount() {
      clearInterval(tickHandle);
      container.innerHTML = '';
    },
  };
}
