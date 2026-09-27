// Gartic Phone-style drawing telephone — 3-8 players. Round 0 everyone writes a secret prompt;
// each round after that alternates drawing what you're shown / guessing what you're shown, always
// based only on the immediately-previous entry. After every book has rotated through all players,
// everyone sees the full chains. Server plugin: ../../../server/games/garticphone.js

import { sfx } from '../sfx.js';
import { scribble } from '../drawFx.js';

const CANVAS_WIDTH = 360;
const CANVAS_HEIGHT = 240;

export function mount(container, api) {
  let view = null;
  let roster = [];
  // The in-progress task widget is cached across re-renders so another player's submit (which
  // broadcasts new state) doesn't wipe your half-finished drawing or typed text.
  let taskCache = { key: null, el: null };

  const root = document.createElement('div');
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '10px';
  root.style.alignItems = 'center';
  root.style.maxWidth = '640px';
  container.appendChild(root);

  function nicknameFor(clientId) {
    const entry = roster.find((r) => r.clientId === clientId);
    return entry ? entry.nickname : 'someone';
  }
  function mySeatIndex() {
    if (!view) return -1;
    return view.seats.indexOf(api.getClientId());
  }

  function buildCanvasWidget(onSubmit) {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '6px';
    wrap.style.alignItems = 'center';

    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    canvas.style.background = '#fff';
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'crosshair';
    canvas.draggable = false;
    canvas.style.userSelect = 'none';
    canvas.addEventListener('dragstart', (ev) => ev.preventDefault());
    const canvasCtx = canvas.getContext('2d');
    canvasCtx.lineCap = 'round';
    canvasCtx.lineWidth = 3;
    canvasCtx.strokeStyle = '#111';

    let drawing = false;
    let last = null;
    function pos(ev) {
      const rect = canvas.getBoundingClientRect();
      return { x: ((ev.clientX - rect.left) / rect.width) * canvas.width, y: ((ev.clientY - rect.top) / rect.height) * canvas.height };
    }
    canvas.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      drawing = true;
      last = pos(ev);
      canvas.setPointerCapture(ev.pointerId);
      scribble();
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (!drawing) return;
      ev.preventDefault();
      const p = pos(ev);
      canvasCtx.beginPath();
      canvasCtx.moveTo(last.x, last.y);
      canvasCtx.lineTo(p.x, p.y);
      canvasCtx.stroke();
      scribble();
      last = p;
    });
    const stop = () => { drawing = false; last = null; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointerleave', stop);

    wrap.appendChild(canvas);

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '6px';
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'CLEAR';
    clearBtn.addEventListener('click', () => canvasCtx.clearRect(0, 0, canvas.width, canvas.height));
    controls.appendChild(clearBtn);
    const doneBtn = document.createElement('button');
    doneBtn.textContent = 'DONE — SUBMIT DRAWING';
    doneBtn.addEventListener('click', () => {
      const dataUrl = canvas.toDataURL('image/png');
      if (dataUrl.length > 60000) {
        alert('That drawing is too detailed to send — try simplifying it a bit.');
        return;
      }
      onSubmit(dataUrl);
    });
    controls.appendChild(doneBtn);
    wrap.appendChild(controls);
    return wrap;
  }

  function renderPreviousEntry(entry) {
    const box = document.createElement('div');
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.alignItems = 'center';
    box.style.gap = '4px';
    const label = document.createElement('div');
    label.style.fontSize = '0.8em';
    label.style.opacity = '0.8';
    label.textContent = entry.type === 'drawing' ? 'What was drawn:' : 'What was written:';
    box.appendChild(label);
    if (entry.type === 'drawing') {
      const img = document.createElement('img');
      img.src = entry.content;
      img.style.width = `${CANVAS_WIDTH}px`;
      img.style.height = `${CANVAS_HEIGHT}px`;
      img.style.border = '1px solid #333';
      img.style.background = '#fff';
      box.appendChild(img);
    } else {
      const text = document.createElement('div');
      text.textContent = `"${entry.content}"`;
      text.style.fontSize = '1.2em';
      text.style.fontStyle = 'italic';
      box.appendChild(text);
    }
    return box;
  }

  function buildTask(task) {
    const box = document.createElement('div');
    box.className = 'dfx-pop';
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.gap = '10px';
    box.style.alignItems = 'center';
    if (task.taskType === 'prompt') {
      const hint = document.createElement('div');
      hint.textContent = 'Write a short prompt for someone else to draw:';
      hint.style.fontSize = '0.85em';
      box.appendChild(hint);
      const form = document.createElement('form');
      form.style.display = 'flex';
      form.style.gap = '6px';
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 200;
      input.placeholder = 'e.g. a cat riding a skateboard';
      input.style.width = '260px';
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.textContent = 'SUBMIT';
      form.appendChild(input);
      form.appendChild(submit);
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const val = input.value.trim();
        if (!val) return;
        api.sendAction({ kind: 'submit', content: val });
      });
      box.appendChild(form);
    } else if (task.taskType === 'drawing') {
      box.appendChild(renderPreviousEntry(task.previousEntry));
      box.appendChild(buildCanvasWidget((dataUrl) => api.sendAction({ kind: 'submit', content: dataUrl })));
    } else if (task.taskType === 'guess') {
      box.appendChild(renderPreviousEntry(task.previousEntry));
      const hint = document.createElement('div');
      hint.textContent = 'What do you think this drawing shows?';
      hint.style.fontSize = '0.85em';
      box.appendChild(hint);
      const form = document.createElement('form');
      form.style.display = 'flex';
      form.style.gap = '6px';
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 200;
      input.style.width = '260px';
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.textContent = 'SUBMIT';
      form.appendChild(input);
      form.appendChild(submit);
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const val = input.value.trim();
        if (!val) return;
        api.sendAction({ kind: 'submit', content: val });
      });
      box.appendChild(form);
    }
    return box;
  }

  let revealPlayed = false;
  let stampShownFor = null;
  const pipsShown = new Set();
  const revealTimers = [];

  // Sounds for the difference between two consecutive views.
  function feedback(prev, next) {
    if (!prev || !next) return;
    if (next.phase !== prev.phase) {
      if (next.phase === 'playing') sfx.play('go');
      else if (next.phase === 'reveal') sfx.play('chime');
      else if (next.phase === 'waiting') { pipsShown.clear(); revealTimers.splice(0).forEach(clearTimeout); }
      return;
    }
    if (next.phase !== 'playing') return;
    if (next.currentRound !== prev.currentRound) {
      sfx.play('whoosh');
      setTimeout(() => sfx.play('turn'), 150);
      return;
    }
    const mine = next.myTask && next.myTask.alreadySubmitted && !(prev.myTask && prev.myTask.alreadySubmitted);
    if (mine) sfx.play('pop');
    else if (next.submittedSeatIdxs.length > prev.submittedSeatIdxs.length) sfx.play('blip');
  }

  function render() {
    const focused = taskCache.el && taskCache.el.contains(document.activeElement) ? document.activeElement : null;
    root.innerHTML = '';
    if (!view) {
      root.textContent = 'Loading...';
      return;
    }

    if (view.phase !== 'playing') taskCache = { key: null, el: null };
    if (view.phase !== 'reveal') revealPlayed = false;
    const mySeat = mySeatIndex();
    const status = document.createElement('div');
    if (view.phase === 'waiting') {
      status.textContent = `Waiting for players (${view.seats.length}/8 seated, need 3+ to start).`;
    } else if (view.phase === 'playing') {
      status.textContent = `Round ${view.currentRound + 1} / ${view.totalRounds} — ${view.submittedSeatIdxs.length}/${view.seats.length} submitted`;
    } else if (view.phase === 'reveal') {
      status.textContent = 'The chains are complete! Here\'s how they went:';
    }
    root.appendChild(status);

    const seatRow = document.createElement('div');
    seatRow.style.display = 'flex';
    seatRow.style.gap = '8px';
    seatRow.style.flexWrap = 'wrap';
    if (mySeat === -1 && view.phase === 'waiting' && view.seats.length < 8) {
      const btn = document.createElement('button');
      btn.textContent = 'SIT DOWN';
      btn.addEventListener('click', () => api.sendAction({ kind: 'sit' }));
      seatRow.appendChild(btn);
    }
    if (mySeat !== -1 && view.phase === 'waiting') {
      const leaveBtn = document.createElement('button');
      leaveBtn.textContent = 'LEAVE SEAT';
      leaveBtn.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seatRow.appendChild(leaveBtn);
    }
    if (view.phase === 'waiting' && view.seats.length >= 3 && mySeat !== -1) {
      const startBtn = document.createElement('button');
      startBtn.textContent = 'START GAME';
      startBtn.addEventListener('click', () => api.sendAction({ kind: 'startGame' }));
      seatRow.appendChild(startBtn);
    }
    root.appendChild(seatRow);

    if (view.phase === 'waiting') {
      const players = document.createElement('div');
      players.style.fontSize = '0.85em';
      players.textContent = view.seats.map((id) => nicknameFor(id)).join(', ');
      root.appendChild(players);
    }

    if (view.phase === 'playing') {
      const pips = document.createElement('div');
      pips.style.display = 'flex';
      pips.style.gap = '6px';
      pips.style.flexWrap = 'wrap';
      pips.style.justifyContent = 'center';
      pips.style.fontSize = '0.8em';
      const done = new Set(view.submittedSeatIdxs);
      view.seats.forEach((id, i) => {
        const pip = document.createElement('span');
        pip.style.padding = '2px 8px';
        pip.style.borderRadius = '10px';
        pip.style.border = `1px solid ${done.has(i) ? '#39ff14' : '#444'}`;
        pip.style.color = done.has(i) ? '#39ff14' : '';
        pip.style.opacity = done.has(i) ? '1' : '0.55';
        pip.textContent = `${done.has(i) ? '✓ ' : '✎ '}${nicknameFor(id)}`;
        if (done.has(i) && !pipsShown.has(`${view.currentRound}:${i}`)) {
          pip.style.display = 'inline-block';
          pip.className = 'dfx-bump';
          pipsShown.add(`${view.currentRound}:${i}`);
        }
        pips.appendChild(pip);
      });
      root.appendChild(pips);
    }

    if (view.phase === 'playing' && mySeat !== -1) {
      const task = view.myTask;
      if (task.alreadySubmitted) {
        const stamp = document.createElement('div');
        stamp.className = 'dfx-stamp';
        stamp.textContent = '✓ SUBMITTED';
        if (stampShownFor === view.currentRound) stamp.style.animation = 'none';
        stampShownFor = view.currentRound;
        root.appendChild(stamp);
        const waiting = document.createElement('div');
        waiting.textContent = 'Waiting for everyone else...';
        waiting.style.opacity = '0.8';
        root.appendChild(waiting);
      } else {
        const key = `${view.currentRound}:${task.taskType}`;
        if (taskCache.key !== key) taskCache = { key, el: buildTask(task) };
        root.appendChild(taskCache.el);
        if (focused) focused.focus();
      }
    }

    if (view.phase === 'reveal') {
      const animate = !revealPlayed;
      revealPlayed = true;
      view.books.forEach((book, bookIdx) => {
        const bookBox = document.createElement('div');
        bookBox.style.display = 'flex';
        bookBox.style.flexDirection = 'column';
        bookBox.style.alignItems = 'center';
        bookBox.style.gap = '6px';
        bookBox.style.border = '1px solid #1f8f0c';
        bookBox.style.padding = '10px';
        bookBox.style.width = '100%';
        bookBox.style.boxSizing = 'border-box';
        const title = document.createElement('div');
        title.textContent = `${nicknameFor(view.seats[bookIdx])}'s chain:`;
        title.style.fontWeight = 'bold';
        bookBox.appendChild(title);
        if (animate) { bookBox.className = 'dfx-pop'; bookBox.style.animationDelay = `${bookIdx * 0.25}s`; }
        book.forEach((entry, entryIdx) => {
          const row = document.createElement('div');
          if (animate) {
            const delay = bookIdx * 0.25 + 0.3 + entryIdx * 0.45;
            row.className = 'dfx-pop';
            row.style.animationDelay = `${delay}s`;
            if (bookIdx === 0) revealTimers.push(setTimeout(() => sfx.play(entryIdx % 2 ? 'pop' : 'blip'), delay * 1000));
          }
          row.style.display = 'flex';
          row.style.flexDirection = 'column';
          row.style.alignItems = 'center';
          row.style.gap = '2px';
          const who = document.createElement('div');
          who.style.fontSize = '0.75em';
          who.style.opacity = '0.7';
          who.textContent = nicknameFor(view.seats[entry.authorIdx]);
          row.appendChild(who);
          row.appendChild(renderPreviousEntry(entry));
          bookBox.appendChild(row);
        });
        root.appendChild(bookBox);
      });
      const again = document.createElement('button');
      again.textContent = 'PLAY AGAIN';
      if (animate) {
        const longest = Math.max(0, ...view.books.map((b, i) => i * 0.25 + 0.3 + b.length * 0.45));
        revealTimers.push(setTimeout(() => sfx.play('win'), longest * 1000));
        again.className = 'dfx-pop';
        again.style.animationDelay = `${longest}s`;
      }
      again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
      root.appendChild(again);
    }
  }

  render();

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      render();
    },
    applyEvent(data) {
      if (data && data.kind === 'state') {
        const prevView = view;
        view = data;
        feedback(prevView, view);
        render();
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      render();
    },
    unmount() {
      revealTimers.splice(0).forEach(clearTimeout);
      container.innerHTML = '';
    },
  };
}
