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
const FILL_TOLERANCE = 24; // per-channel match tolerance, so anti-aliased stroke edges don't leak

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
  let filling = false;

  const swatchEls = [];
  function refreshSwatchBorders() {
    for (const el of swatchEls) {
      el.style.border = !erasing && !filling && el.dataset.color === currentColor ? '2px solid #fff' : '1px solid #333';
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
      filling = false;
      refreshSwatchBorders();
      eraserBtn.style.border = '1px solid #333';
      fillBtn.style.border = '1px solid #333';
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
    filling = false;
    eraserBtn.style.border = erasing ? '2px solid #fff' : '1px solid #333';
    fillBtn.style.border = '1px solid #333';
    refreshSwatchBorders();
  });
  toolbar.appendChild(eraserBtn);

  const fillBtn = document.createElement('button');
  fillBtn.textContent = 'FILL';
  fillBtn.style.border = '1px solid #333';
  fillBtn.addEventListener('click', () => {
    filling = !filling;
    erasing = false;
    fillBtn.style.border = filling ? '2px solid #fff' : '1px solid #333';
    eraserBtn.style.border = '1px solid #333';
    refreshSwatchBorders();
  });
  toolbar.appendChild(fillBtn);

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

  function hexToRgba(hex) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }

  // Standard stack-based paint-bucket flood fill, run identically by every client against its own
  // (already-consistent) canvas pixels rather than shipping rasterized pixel data over the wire.
  function applyFill(fillRec) {
    const startX = Math.round(fillRec.x);
    const startY = Math.round(fillRec.y);
    const w = canvas.width;
    const h = canvas.height;
    if (startX < 0 || startY < 0 || startX >= w || startY >= h) return;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const startI = (startY * w + startX) * 4;
    const tr = data[startI];
    const tg = data[startI + 1];
    const tb = data[startI + 2];
    const ta = data[startI + 3];
    const [fr, fg, fb, fa] = hexToRgba(fillRec.color);
    if (tr === fr && tg === fg && tb === fb && ta === fa) return; // already this color
    const matches = (i) =>
      Math.abs(data[i] - tr) <= FILL_TOLERANCE &&
      Math.abs(data[i + 1] - tg) <= FILL_TOLERANCE &&
      Math.abs(data[i + 2] - tb) <= FILL_TOLERANCE &&
      Math.abs(data[i + 3] - ta) <= FILL_TOLERANCE;
    const visited = new Uint8Array(w * h);
    const stack = [[startX, startY]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const vi = y * w + x;
      if (visited[vi]) continue;
      const i = vi * 4;
      if (!matches(i)) continue;
      visited[vi] = 1;
      data[i] = fr;
      data[i + 1] = fg;
      data[i + 2] = fb;
      data[i + 3] = fa;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // Full local mirror of the server's history (strokes AND fills), kept so undo/clear-mine (both
  // of which remove specific past records rather than only ever adding new ones) can redraw the
  // canvas from scratch instead of needing to un-paint pixels.
  let segments = [];
  function replayRecord(rec) {
    if (rec.type === 'fill') applyFill(rec);
    else drawSegment(rec);
  }
  function redrawAll() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const rec of segments) replayRecord(rec);
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
    if (filling) {
      const pos = pointerPos(ev);
      const fillId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const rec = { type: 'fill', strokeId: fillId, x: pos.x, y: pos.y, color: currentColor };
      segments.push(rec);
      applyFill(rec);
      myStrokes.push(fillId);
      api.sendAction({ kind: 'fill', fill: { strokeId: fillId, x: pos.x, y: pos.y, color: currentColor } });
      return;
    }
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
      } else if (data.kind === 'fill') {
        segments.push(data.fill);
        applyFill(data.fill);
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
