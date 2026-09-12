// Shared drawing canvas — first mini-game in the terminal.
// Server plugin: ../../../server/games/drawing.js (flat segment broadcast + full-history snapshot).

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 420;
const COLORS = ['#39ff14', '#ffb000', '#00e5ff', '#ff4dd2', '#ffffff'];

export function mount(container, api) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '8px';
  wrap.style.alignItems = 'center';

  const toolbar = document.createElement('div');
  toolbar.style.display = 'flex';
  toolbar.style.gap = '6px';

  let currentColor = COLORS[0];
  for (const color of COLORS) {
    const swatch = document.createElement('button');
    swatch.style.background = color;
    swatch.style.width = '24px';
    swatch.style.height = '24px';
    swatch.style.border = color === currentColor ? '2px solid #fff' : '1px solid #333';
    swatch.addEventListener('click', () => {
      currentColor = color;
      for (const el of toolbar.querySelectorAll('button[data-swatch]')) {
        el.style.border = el.dataset.color === color ? '2px solid #fff' : '1px solid #333';
      }
    });
    swatch.dataset.swatch = 'true';
    swatch.dataset.color = color;
    toolbar.appendChild(swatch);
  }

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'CLEAR';
  clearBtn.addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    api.sendAction({ kind: 'clear' });
  });
  toolbar.appendChild(clearBtn);

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  canvas.style.background = '#000';
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'crosshair';
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

  function onPointerDown(ev) {
    drawing = true;
    strokeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    last = pointerPos(ev);
    canvas.setPointerCapture(ev.pointerId);
  }

  function onPointerMove(ev) {
    if (!drawing) return;
    const pos = pointerPos(ev);
    const seg = { strokeId, x0: last.x, y0: last.y, x1: pos.x, y1: pos.y, color: currentColor, size: 3 };
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

  return {
    applySnapshot(snapshot) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const seg of (snapshot && snapshot.segments) || []) drawSegment(seg);
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'segment') {
        drawSegment(data.segment);
        window.__debugSegmentCount = (window.__debugSegmentCount || 0) + 1;
      } else if (data.kind === 'clear') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
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
