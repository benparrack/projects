// Pictionary — the drawer (rotates each round) draws on a shared canvas, everyone else races to
// type the word into the guess log. Server plugin: ../../../server/games/pictionary.js (segment/
// clear events mirror drawing.js's wire format; 'state' is a per-recipient view like hangman.js's
// — only the drawer's own view carries the actual word while a round is live).

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 420;
const CANVAS_BG = '#000';
const COLORS = ['#39ff14', '#ffb000', '#00e5ff', '#ff4dd2', '#ffffff', '#ff4d4d', '#4d79ff', '#000000'];
const DEFAULT_SIZE = 4;

export function mount(container, api) {
  let view = null;
  let roster = [];
  let currentColor = COLORS[0];
  let currentSize = DEFAULT_SIZE;
  let tickHandle = null;

  const root = document.createElement('div');
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '10px';
  root.style.alignItems = 'center';
  root.style.width = '100%';
  container.appendChild(root);

  function nicknameFor(clientId) {
    if (!clientId) return null;
    const entry = roster.find((r) => r.clientId === clientId);
    return entry ? entry.nickname : 'someone';
  }

  // --- Canvas (drawer draws, everyone renders) -------------------------------------------------
  const canvasWrap = document.createElement('div');
  canvasWrap.style.display = 'flex';
  canvasWrap.style.flexDirection = 'column';
  canvasWrap.style.gap = '6px';
  canvasWrap.style.alignItems = 'center';

  const toolbar = document.createElement('div');
  toolbar.style.display = 'flex';
  toolbar.style.gap = '6px';
  toolbar.style.flexWrap = 'wrap';
  toolbar.style.justifyContent = 'center';

  const swatchEls = [];
  function refreshSwatchBorders() {
    for (const el of swatchEls) {
      el.style.border = el.dataset.color === currentColor ? '2px solid #fff' : '1px solid #333';
    }
  }
  for (const color of COLORS) {
    const swatch = document.createElement('button');
    swatch.style.background = color;
    swatch.style.width = '22px';
    swatch.style.height = '22px';
    swatch.dataset.color = color;
    swatch.addEventListener('click', () => {
      currentColor = color;
      refreshSwatchBorders();
    });
    swatchEls.push(swatch);
    toolbar.appendChild(swatch);
  }
  refreshSwatchBorders();

  const sizeSlider = document.createElement('input');
  sizeSlider.type = 'range';
  sizeSlider.min = '2';
  sizeSlider.max = '20';
  sizeSlider.value = String(DEFAULT_SIZE);
  sizeSlider.addEventListener('input', () => {
    currentSize = Number(sizeSlider.value);
  });
  toolbar.appendChild(sizeSlider);

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'CLEAR';
  clearBtn.addEventListener('click', () => api.sendAction({ kind: 'clear' }));
  toolbar.appendChild(clearBtn);

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  canvas.style.background = CANVAS_BG;
  canvas.style.touchAction = 'none';
  canvas.draggable = false;
  canvas.style.userSelect = 'none';
  canvas.style.webkitUserDrag = 'none';
  canvas.addEventListener('dragstart', (ev) => ev.preventDefault());
  const cctx = canvas.getContext('2d');

  canvasWrap.appendChild(toolbar);
  canvasWrap.appendChild(canvas);

  function drawSegment(seg) {
    cctx.strokeStyle = seg.color;
    cctx.lineWidth = seg.size;
    cctx.lineCap = 'round';
    cctx.beginPath();
    cctx.moveTo(seg.x0, seg.y0);
    cctx.lineTo(seg.x1, seg.y1);
    cctx.stroke();
  }

  let segments = [];
  function redrawAll() {
    cctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const seg of segments) drawSegment(seg);
  }

  let drawing = false;
  let last = null;
  let strokeId = null;

  function pointerPos(ev) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * canvas.width,
      y: ((ev.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function canDraw() {
    return view && view.isDrawer && view.phase === 'drawing';
  }

  function onPointerDown(ev) {
    if (!canDraw()) return;
    ev.preventDefault();
    drawing = true;
    strokeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    last = pointerPos(ev);
    canvas.setPointerCapture(ev.pointerId);
  }
  function onPointerMove(ev) {
    if (!drawing || !canDraw()) return;
    ev.preventDefault();
    const pos = pointerPos(ev);
    const seg = { strokeId, x0: last.x, y0: last.y, x1: pos.x, y1: pos.y, color: currentColor, size: currentSize };
    segments.push(seg);
    drawSegment(seg);
    api.sendAction({ kind: 'segment', segment: seg });
    last = pos;
  }
  function onPointerUp() {
    drawing = false;
    last = null;
  }
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);

  // --- Rest of the UI: status, word choices, guess form, log, scoreboard -----------------------
  const statusEl = document.createElement('div');
  statusEl.style.fontSize = '15px';
  statusEl.style.fontWeight = 'bold';

  const wordChoiceEl = document.createElement('div');
  wordChoiceEl.style.display = 'flex';
  wordChoiceEl.style.gap = '8px';

  const guessForm = document.createElement('form');
  guessForm.style.display = 'flex';
  guessForm.style.gap = '6px';
  const guessInput = document.createElement('input');
  guessInput.type = 'text';
  guessInput.placeholder = 'type your guess...';
  guessInput.maxLength = 60;
  guessInput.autocomplete = 'off';
  const guessSubmit = document.createElement('button');
  guessSubmit.type = 'submit';
  guessSubmit.textContent = 'GUESS';
  guessForm.appendChild(guessInput);
  guessForm.appendChild(guessSubmit);
  guessForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = guessInput.value.trim();
    if (!text) return;
    api.sendAction({ kind: 'guess', text });
    guessInput.value = '';
  });

  const logEl = document.createElement('div');
  logEl.style.width = `${CANVAS_WIDTH}px`;
  logEl.style.maxHeight = '140px';
  logEl.style.overflowY = 'auto';
  logEl.style.border = '1px solid #333';
  logEl.style.padding = '6px';
  logEl.style.fontSize = '13px';
  logEl.style.display = 'flex';
  logEl.style.flexDirection = 'column';
  logEl.style.gap = '2px';

  const scoreEl = document.createElement('div');
  scoreEl.style.display = 'flex';
  scoreEl.style.gap = '14px';
  scoreEl.style.flexWrap = 'wrap';
  scoreEl.style.justifyContent = 'center';
  scoreEl.style.fontSize = '13px';

  root.appendChild(statusEl);
  root.appendChild(wordChoiceEl);
  root.appendChild(canvasWrap);
  root.appendChild(guessForm);
  root.appendChild(logEl);
  root.appendChild(scoreEl);

  function render() {
    if (!view) {
      statusEl.textContent = 'Loading...';
      wordChoiceEl.hidden = true;
      guessForm.hidden = true;
      return;
    }

    const drawerName = nicknameFor(view.drawerClientId);
    canvas.style.cursor = canDraw() ? 'crosshair' : 'default';
    // Only the drawer can actually draw/clear (server-enforced) — hide the toolbar for everyone
    // else so a guesser doesn't see color/size/clear controls that would silently no-op.
    toolbar.style.display = view.isDrawer ? 'flex' : 'none';

    wordChoiceEl.innerHTML = '';
    guessForm.hidden = true;

    if (view.phase === 'lobby') {
      statusEl.textContent = `Waiting for at least one more player (${view.playerCount} here)...`;
    } else if (view.phase === 'choosing_word') {
      if (view.isDrawer) {
        statusEl.textContent = "You're drawing next — pick a word:";
        for (const word of view.wordOptions || []) {
          const btn = document.createElement('button');
          btn.textContent = word.toUpperCase();
          btn.addEventListener('click', () => api.sendAction({ kind: 'chooseWord', word }));
          wordChoiceEl.appendChild(btn);
        }
      } else {
        statusEl.textContent = `Waiting for ${drawerName} to pick a word...`;
      }
    } else if (view.phase === 'drawing') {
      const secsLeft = view.roundEndsAt ? Math.max(0, Math.ceil((view.roundEndsAt - Date.now()) / 1000)) : 0;
      if (view.isDrawer) {
        statusEl.textContent = `Draw: "${view.word ? view.word.toUpperCase() : ''}" — ${secsLeft}s left`;
      } else {
        const guessed = view.correctGuessers.includes(api.getClientId());
        statusEl.textContent = guessed
          ? `You got it! Waiting on others — ${secsLeft}s left`
          : `${drawerName} is drawing — ${secsLeft}s left`;
        guessForm.hidden = guessed;
      }
    } else if (view.phase === 'round_over') {
      statusEl.textContent = `Round over — the word was "${(view.word || '').toUpperCase()}"`;
    }

    logEl.innerHTML = '';
    for (const entry of view.guessLog) {
      const line = document.createElement('div');
      const name = nicknameFor(entry.clientId);
      if (entry.correct) {
        line.textContent = `${name} guessed the word!`;
        line.style.color = '#39ff14';
      } else {
        line.textContent = `${name}: ${entry.text}`;
      }
      logEl.appendChild(line);
    }
    logEl.scrollTop = logEl.scrollHeight;

    scoreEl.innerHTML = '';
    const entries = Object.entries(view.scores).sort((a, b) => b[1] - a[1]);
    for (const [clientId, pts] of entries) {
      const el = document.createElement('div');
      el.textContent = `${nicknameFor(clientId)}: ${pts}`;
      scoreEl.appendChild(el);
    }
  }

  function ensureTicking() {
    if (tickHandle) return;
    tickHandle = setInterval(() => {
      if (view && view.phase === 'drawing') render();
    }, 500);
  }

  render();
  ensureTicking();

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      segments = (view && view.history) || [];
      redrawAll();
      render();
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        const prevPhase = view ? view.phase : null;
        view = data.view;
        // The server only ever ships full segment history inside 'state' views on join/reset —
        // live strokes arrive as their own 'segment' events. Re-sync from history only when the
        // round actually changed (a fresh round always starts with an empty history), so we don't
        // clobber the in-progress local canvas on every routine state update (a guess, a score).
        if (view.phase !== prevPhase) {
          segments = view.history || [];
          redrawAll();
        }
        render();
      } else if (data.kind === 'segment') {
        segments.push(data.segment);
        drawSegment(data.segment);
      } else if (data.kind === 'clear') {
        segments = [];
        redrawAll();
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      render();
    },
    unmount() {
      if (tickHandle) clearInterval(tickHandle);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerUp);
      container.innerHTML = '';
    },
  };
}
