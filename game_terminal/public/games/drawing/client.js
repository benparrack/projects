// Shared drawing canvas — first mini-game in the terminal.
// Server plugin: ../../../server/games/drawing.js (flat segment broadcast + full-history snapshot).

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 420;
const CANVAS_BG = '#000';
const COLORS = [
  '#39ff14', '#ffb000', '#00e5ff', '#ff4dd2', '#ffffff',
  '#ff4d4d', '#4d79ff', '#b24dff', '#ff944d', '#8c5a2b', '#888888', '#000000',
];
const MIN_SIZE = 1;
const MAX_SIZE = 30;
const DEFAULT_SIZE = 3;
const ERASER_SIZE_MULT = 6; // erasing needs a much fatter stroke to actually feel like erasing

export function mount(container, api) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '8px';
  wrap.style.alignItems = 'center';

  const toolbar = document.createElement('div');
  toolbar.style.display = 'flex';
  toolbar.style.flexWrap = 'wrap';
  toolbar.style.gap = '6px';
  toolbar.style.alignItems = 'center';
  toolbar.style.justifyContent = 'center';
  toolbar.style.maxWidth = `${CANVAS_WIDTH}px`;

  let currentColor = COLORS[0];
  let currentSize = DEFAULT_SIZE;
  let erasing = false;

  const swatchEls = [];
  function refreshSwatchBorders() {
    for (const el of swatchEls) {
      el.style.border = !erasing && el.dataset.color === currentColor ? '2px solid #fff' : '1px solid #333';
    }
  }
  for (const color of COLORS) {
    const swatch = document.createElement('button');
    swatch.style.background = color;
    swatch.style.width = '24px';
    swatch.style.height = '24px';
    swatch.dataset.swatch = 'true';
    swatch.dataset.color = color;
    swatch.addEventListener('click', () => {
      currentColor = color;
      erasing = false;
      refreshSwatchBorders();
      eraserBtn.style.border = '1px solid #333';
    });
    swatchEls.push(swatch);
    toolbar.appendChild(swatch);
  }
  refreshSwatchBorders();

  const sizeLabel = document.createElement('label');
  sizeLabel.style.display = 'flex';
  sizeLabel.style.alignItems = 'center';
  sizeLabel.style.gap = '4px';
  sizeLabel.style.fontSize = '12px';
  sizeLabel.textContent = 'SIZE';
  const sizeSlider = document.createElement('input');
  sizeSlider.type = 'range';
  sizeSlider.min = String(MIN_SIZE);
  sizeSlider.max = String(MAX_SIZE);
  sizeSlider.value = String(DEFAULT_SIZE);
  sizeSlider.addEventListener('input', () => {
    currentSize = Number(sizeSlider.value);
  });
  sizeLabel.appendChild(sizeSlider);
  toolbar.appendChild(sizeLabel);

  const eraserBtn = document.createElement('button');
  eraserBtn.textContent = 'ERASER';
  eraserBtn.style.border = '1px solid #333';
  eraserBtn.addEventListener('click', () => {
    erasing = !erasing;
    eraserBtn.style.border = erasing ? '2px solid #fff' : '1px solid #333';
    refreshSwatchBorders();
  });
  toolbar.appendChild(eraserBtn);

  const undoBtn = document.createElement('button');
  undoBtn.textContent = 'UNDO';
  undoBtn.addEventListener('click', () => {
    const strokeId = myStrokes.pop();
    if (strokeId) api.sendAction({ kind: 'undoStroke', strokeId });
  });
  toolbar.appendChild(undoBtn);

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'CLEAR MINE';
  clearBtn.addEventListener('click', () => {
    api.sendAction({ kind: 'clearMine' });
  });
  toolbar.appendChild(clearBtn);

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  canvas.style.background = CANVAS_BG;
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'crosshair';
  // Canvas elements are natively drag-sources in some browsers (Firefox especially) — a
  // mousedown-and-move gesture starting on one can get hijacked into the browser's built-in
  // "drag this image out" behavior instead of firing our own pointermove-based drawing (real
  // playtest bug: "sometimes instead of drawing it tries to just drag the entire creation as an
  // image"). Belt-and-suspenders: explicitly disable the native drag source, and suppress
  // dragstart entirely as a fallback for whichever engine still tries it.
  canvas.draggable = false;
  canvas.style.userSelect = 'none';
  canvas.style.webkitUserDrag = 'none';
  canvas.addEventListener('dragstart', (ev) => ev.preventDefault());
  const ctx = canvas.getContext('2d');

  wrap.appendChild(toolbar);
  wrap.appendChild(canvas);
  container.appendChild(wrap);

  // Debug hook for automated verification — counts segments applied from the network
  // (not locally drawn ones). Harmless to leave in; only touched by test tooling.
  window.__debugSegmentCount = 0;

  function drawSegment(seg) {
    ctx.strokeStyle = seg.color;
    ctx.lineWidth = seg.size;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(seg.x0, seg.y0);
    ctx.lineTo(seg.x1, seg.y1);
    ctx.stroke();
  }

  // Full local mirror of the server's segment history, kept so undo/clear-mine (both of which
  // remove specific past segments rather than only ever adding new ones) can redraw the canvas
  // from scratch instead of needing to un-paint pixels.
  let segments = [];
  function redrawAll() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const seg of segments) drawSegment(seg);
  }

  let drawing = false;
  let last = null;
  let strokeId = null;
  let strokeHadSegments = false;
  const myStrokes = []; // this client's own completed, non-empty strokeIds, for UNDO

  function pointerPos(ev) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * canvas.width,
      y: ((ev.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function onPointerDown(ev) {
    ev.preventDefault();
    drawing = true;
    strokeHadSegments = false;
    strokeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    last = pointerPos(ev);
    canvas.setPointerCapture(ev.pointerId);
  }

  function onPointerMove(ev) {
    if (!drawing) return;
    ev.preventDefault();
    const pos = pointerPos(ev);
    const seg = {
      strokeId,
      x0: last.x,
      y0: last.y,
      x1: pos.x,
      y1: pos.y,
      color: erasing ? CANVAS_BG : currentColor,
      size: erasing ? currentSize * ERASER_SIZE_MULT : currentSize,
    };
    segments.push(seg);
    drawSegment(seg);
    strokeHadSegments = true;
    api.sendAction({ kind: 'segment', segment: seg });
    last = pos;
  }

  function onPointerUp() {
    if (drawing && strokeHadSegments) myStrokes.push(strokeId);
    drawing = false;
    last = null;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);

  return {
    applySnapshot(snapshot) {
      segments = ((snapshot && snapshot.segments) || []).slice();
      redrawAll();
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'segment') {
        segments.push(data.segment);
        drawSegment(data.segment);
        window.__debugSegmentCount = (window.__debugSegmentCount || 0) + 1;
      } else if (data.kind === 'clear') {
        segments = [];
        redrawAll();
      } else if (data.kind === 'clearMine') {
        // Removes segments tagged with the clearing client's id — that covers every segment that
        // arrived from the server (both other clients' broadcast segments and our own, once
        // they've round-tripped through a snapshot). It does NOT cover segments we drew locally
        // this session before any snapshot reload (those were pushed straight into `segments`
        // without a clientId, to draw instantly without waiting on the network) — when the clear
        // is our own, also drop those by strokeId via our own `myStrokes` history.
        segments = segments.filter((s) => s.clientId !== data.clientId);
        if (data.clientId === api.getClientId()) {
          const mine = new Set(myStrokes);
          segments = segments.filter((s) => !mine.has(s.strokeId));
          myStrokes.length = 0;
        }
        redrawAll();
      } else if (data.kind === 'undoStroke') {
        segments = segments.filter((s) => s.strokeId !== data.strokeId);
        redrawAll();
      }
    },
    unmount() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerUp);
      container.innerHTML = '';
    },
  };
}
