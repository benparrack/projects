// Chess post-game review (RECAP) view: board at the selected ply with the move played
// highlighted, an arrow for the engine's best move, an eval bar + eval graph, and a SAN move list
// marked with each move's classification. Pure DOM builder — client.js owns the state (which ply,
// orientation, toggles) and rebuilds this on every change, like the rest of the hub's clients.
import { slideFrom, captureGhost, LAST_MOVE_TINT, CHECK_GLOW } from '../boardFx.js';
import { fenToBoard, fenTurn, whiteWinPct, formatEval, classifyMove, summarize, CLASSES } from './review.js';
import { injectStyle } from '../dom.js';

const CSS = `
.chrv { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; }
.chrv-head { text-align: center; }
.chrv-title { font-weight: bold; letter-spacing: 2px; }
.chrv-sub { font-size: 12px; opacity: .75; margin-top: 2px; }
.chrv-progress { font-size: 12px; color: var(--accent, #ffb000); }
.chrv-progress .bar { display: inline-block; width: 90px; height: 6px; border: 1px solid #3a5a36; vertical-align: middle; margin-left: 6px; position: relative; }
.chrv-progress .bar i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent, #ffb000); transition: width .3s; }
.chrv-row { display: flex; gap: 10px; align-items: flex-start; justify-content: center; flex-wrap: wrap; }
.chrv-pair { display: flex; gap: 6px; align-items: flex-start; }
@media (max-width: 640px) { .chrv-moves { height: auto !important; max-height: 150px; min-height: 60px; } .chrv-side { width: 100% !important; } }
.chrv-evalbar { width: 14px; border: 1px solid #1f8f0c; position: relative; background: #ffb347; overflow: hidden; }
.chrv-evalbar i { position: absolute; left: 0; right: 0; bottom: 0; background: #f2fff2; transition: height .35s cubic-bezier(.25,.8,.35,1); }
.chrv-evalbar b { position: absolute; left: 0; right: 0; top: 50%; border-top: 1px dashed rgba(0,0,0,.45); }
.chrv-boardwrap { position: relative; }
.chrv-arrows { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; }
.chrv-side { width: 172px; display: flex; flex-direction: column; gap: 6px; }
.chrv-moves { border: 1px solid #1f8f0c; padding: 4px; font-size: 13px; overflow-y: auto; box-sizing: border-box; }
.chrv-mrow { display: grid; grid-template-columns: 26px 1fr 1fr; align-items: center; }
.chrv-num { opacity: .5; font-size: 11px; }
.chrv-mv { cursor: pointer; padding: 1px 3px; border-radius: 3px; white-space: nowrap; }
.chrv-mv:hover { background: rgba(57,255,20,.12); }
.chrv-mv.cur { background: #39ff14; color: #041004; font-weight: bold; }
.chrv-mv sup { font-size: 10px; margin-left: 1px; font-weight: bold; }
.chrv-mv.cur sup { color: #041004 !important; }
.chrv-nav { display: flex; gap: 6px; align-items: center; justify-content: center; flex-wrap: wrap; }
.chrv-nav button { min-width: 38px; }
.chrv-ply { font-size: 12px; opacity: .8; min-width: 90px; text-align: center; }
.chrv-card { border: 1px solid #1f8f0c; border-radius: 6px; padding: 8px 10px; font-size: 13px; min-height: 40px; width: min(420px, 100%); box-sizing: border-box; background: rgba(57,255,20,.04); }
.chrv-card .cls { font-weight: bold; }
.chrv-card .hint { opacity: .75; font-size: 12px; margin-top: 3px; }
.chrv-graph { width: min(420px, 100%); height: 64px; border: 1px solid #1f8f0c; cursor: pointer; display: block; background: #0a0a0a; touch-action: none; }
.chrv-sum { display: grid; grid-template-columns: auto repeat(3, 1fr); gap: 2px 10px; font-size: 12px; width: min(420px, 100%); }
.chrv-sum .h { opacity: .6; }
.chrv-keys { font-size: 11px; opacity: .55; }
.chrv-toggles { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
.chrv-toggles button.on { background: #1f8f0c; color: #000; }
`;

const SVGNS = 'http://www.w3.org/2000/svg';
let arrowSeq = 0;

function arrowSvg(size, cell, flipped, arrows) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'chrv-arrows');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  const defs = document.createElementNS(SVGNS, 'defs');
  svg.appendChild(defs);
  const center = (sq) => {
    const vr = flipped ? 7 - sq.r : sq.r;
    const vc = flipped ? 7 - sq.c : sq.c;
    return [vc * cell + cell / 2, vr * cell + cell / 2];
  };
  for (const a of arrows) {
    const id = `chrv-ah-${++arrowSeq}`;
    const marker = document.createElementNS(SVGNS, 'marker');
    marker.setAttribute('id', id);
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '5');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '3.2');
    marker.setAttribute('markerHeight', '3.2');
    marker.setAttribute('orient', 'auto-start-reverse');
    const head = document.createElementNS(SVGNS, 'path');
    head.setAttribute('d', 'M0,0 L10,5 L0,10 z');
    head.setAttribute('fill', a.color);
    marker.appendChild(head);
    defs.appendChild(marker);
    const [x1, y1] = center(a.from);
    const [x2, y2] = center(a.to);
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    // Stop the shaft short so the head lands inside the destination square.
    const k = (len - cell * 0.32) / len;
    const line = document.createElementNS(SVGNS, 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x1 + (x2 - x1) * k));
    line.setAttribute('y2', String(y1 + (y2 - y1) * k));
    line.setAttribute('stroke', a.color);
    line.setAttribute('stroke-width', String(cell * 0.17));
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('opacity', a.opacity || '0.85');
    line.setAttribute('marker-end', `url(#${id})`);
    svg.appendChild(line);
  }
  return svg;
}

function evalGraph(review, onJump) {
  const W = 420;
  const H = 64;
  const plies = review.moves.length;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'chrv-graph');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const x = (i) => (plies ? (i / plies) * W : W / 2);
  const y = (pct) => H - (pct / 100) * H;
  const mid = document.createElementNS(SVGNS, 'line');
  mid.setAttribute('x1', '0'); mid.setAttribute('x2', String(W));
  mid.setAttribute('y1', String(H / 2)); mid.setAttribute('y2', String(H / 2));
  mid.setAttribute('stroke', '#3a5a36'); mid.setAttribute('stroke-dasharray', '3 3');
  svg.appendChild(mid);
  const pts = [];
  for (let i = 0; i <= plies; i++) {
    const a = review.analysis[i];
    if (!a || !a.eval) break; // analysis streams in order — draw the analysed prefix
    pts.push([x(i), y(whiteWinPct(a.eval))]);
  }
  if (pts.length) {
    const area = document.createElementNS(SVGNS, 'path');
    area.setAttribute('d', `M${pts[0][0]},${H} ${pts.map((p) => `L${p[0]},${p[1]}`).join(' ')} L${pts[pts.length - 1][0]},${H} Z`);
    area.setAttribute('fill', 'rgba(242,255,242,0.55)');
    svg.appendChild(area);
    const line = document.createElementNS(SVGNS, 'polyline');
    line.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', '#39ff14');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(line);
    review.moves.forEach((m, i) => {
      const k = classifyMove(m, review.analysis[i], review.analysis[i + 1]);
      if (k !== 'blunder' && k !== 'mistake') return;
      const dot = document.createElementNS(SVGNS, 'circle');
      dot.setAttribute('cx', String(x(i + 1)));
      dot.setAttribute('cy', String(y(whiteWinPct(review.analysis[i + 1].eval))));
      dot.setAttribute('r', '3');
      dot.setAttribute('fill', CLASSES[k].color);
      svg.appendChild(dot);
    });
  }
  const cur = document.createElementNS(SVGNS, 'line');
  cur.setAttribute('x1', String(x(review.idx))); cur.setAttribute('x2', String(x(review.idx)));
  cur.setAttribute('y1', '0'); cur.setAttribute('y2', String(H));
  cur.setAttribute('stroke', '#ffb000'); cur.setAttribute('stroke-width', '2');
  cur.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(cur);
  const jumpAt = (e) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    onJump(Math.round(((e.clientX - rect.left) / rect.width) * plies));
  };
  svg.addEventListener('pointerdown', (e) => {
    jumpAt(e);
    svg.setPointerCapture(e.pointerId);
    const move = (ev) => jumpAt(ev);
    const up = () => { svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
  });
  return svg;
}

// opts: { review, flipped, cell, glyphs, glyphColors, glyphOutline, resultText, prevIdx,
//         onNav(delta|'start'|'end'), onJump(i), onExit(), onFlip(), onToggleBest() }
export function buildReviewView(opts) {
  injectStyle(CSS);
  const { review, flipped, cell: CELL, glyphs, glyphColors, glyphOutline } = opts;
  const plies = review.moves.length;
  const idx = review.idx;
  const wrap = document.createElement('div');
  wrap.className = 'chrv';

  const head = document.createElement('div');
  head.className = 'chrv-head';
  const title = document.createElement('div');
  title.className = 'chrv-title';
  title.textContent = 'GAME REVIEW';
  const sub = document.createElement('div');
  sub.className = 'chrv-sub';
  sub.textContent = opts.resultText;
  head.append(title, sub);
  const done = review.analysis.filter(Boolean).length;
  if (review.loading) {
    const p = document.createElement('div');
    p.className = 'chrv-progress';
    p.textContent = 'Loading game…';
    head.appendChild(p);
  } else if (done < plies + 1) {
    const p = document.createElement('div');
    p.className = 'chrv-progress';
    p.textContent = `Engine analysing ${done}/${plies + 1}`;
    const bar = document.createElement('span');
    bar.className = 'bar';
    const fill = document.createElement('i');
    fill.style.width = `${(done / (plies + 1)) * 100}%`;
    bar.appendChild(fill);
    p.appendChild(bar);
    head.appendChild(p);
  }
  wrap.appendChild(head);
  if (review.loading) return wrap;

  const fen = review.fens[idx];
  const board = fenToBoard(fen);
  const turn = fenTurn(fen);
  const here = review.analysis[idx] || null;
  const played = idx > 0 ? review.moves[idx - 1] : null;
  const before = idx > 0 ? review.analysis[idx - 1] : null;
  const cls = played ? classifyMove(played, before, here) : null;

  const row = document.createElement('div');
  row.className = 'chrv-row';

  // Eval bar (White's share from the bottom when White is at the bottom).
  const evalBar = document.createElement('div');
  evalBar.className = 'chrv-evalbar';
  evalBar.style.height = `${CELL * 8}px`;
  evalBar.title = here && here.eval ? formatEval(here.eval) : 'analysing…';
  const fill = document.createElement('i');
  const pct = here && here.eval ? whiteWinPct(here.eval) : 50;
  fill.style.height = `${pct}%`;
  if (flipped) { fill.style.bottom = 'auto'; fill.style.top = '0'; }
  evalBar.append(fill, document.createElement('b'));
  // Eval bar + board stay side by side even when the row wraps (phone width).
  const pair = document.createElement('div');
  pair.className = 'chrv-pair';
  pair.appendChild(evalBar);
  row.appendChild(pair);

  // Board.
  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = `repeat(8, ${CELL}px)`;
  grid.style.gridTemplateRows = `repeat(8, ${CELL}px)`;
  grid.style.border = '1px solid #1f8f0c';
  const cellAt = {};
  const isSq = (p, r, c) => p && p.r === r && p.c === c;
  const kingInCheck = played && /[+#]$/.test(played.san || '') ? turn : null;
  for (let vr = 0; vr < 8; vr++) {
    for (let vc = 0; vc < 8; vc++) {
      const r = flipped ? 7 - vr : vr;
      const c = flipped ? 7 - vc : vc;
      const sq = document.createElement('div');
      sq.dataset.row = String(r);
      sq.dataset.col = String(c);
      Object.assign(sq.style, {
        width: `${CELL}px`, height: `${CELL}px`, background: (r + c) % 2 ? '#2a2a2a' : '#0a0a0a', position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', fontSize: `${CELL - 10}px`,
      });
      if (played && (isSq(played.from, r, c) || isSq(played.to, r, c))) {
        sq.style.boxShadow = cls && CLASSES[cls] && (cls === 'blunder' || cls === 'mistake' || cls === 'inaccuracy')
          ? `inset 0 0 0 999px ${CLASSES[cls].color}2e` : LAST_MOVE_TINT;
      }
      const piece = board[r][c];
      if (piece && piece.type === 'king' && kingInCheck === piece.color) sq.style.backgroundImage = CHECK_GLOW;
      if (piece) {
        const g = document.createElement('span');
        g.style.position = 'relative';
        g.textContent = glyphs[piece.color][piece.type];
        g.style.color = glyphColors[piece.color];
        g.style.textShadow = glyphOutline;
        sq.appendChild(g);
      }
      if (played && isSq(played.to, r, c) && cls && CLASSES[cls].mark) {
        const badge = document.createElement('span');
        badge.textContent = CLASSES[cls].mark;
        Object.assign(badge.style, {
          position: 'absolute', top: '-6px', right: '-6px', zIndex: '5', fontSize: '11px', fontWeight: 'bold', lineHeight: '1',
          padding: '2px 3px', borderRadius: '8px', background: CLASSES[cls].color, color: '#041004', boxShadow: '0 0 4px #000',
        });
        sq.appendChild(badge);
      }
      cellAt[`${r},${c}`] = sq;
      grid.appendChild(sq);
    }
  }
  // Slide the piece in when stepping forward one move.
  if (played && opts.prevIdx === idx - 1) {
    const dest = cellAt[`${played.to.r},${played.to.c}`];
    const glyph = dest && dest.querySelector('span');
    slideFrom(glyph, () => cellAt[`${played.from.r},${played.from.c}`], { duration: 160 });
    if (played.captured) {
      const capColor = played.color === 'white' ? 'black' : 'white';
      captureGhost(dest, glyphs[capColor][played.captured], glyphColors[capColor]);
    }
  }

  const arrows = [];
  // The better move that was available instead of the one played (from the previous position).
  if (review.showBest && played && before && before.best && cls && cls !== 'best') {
    arrows.push({ from: before.best.from, to: before.best.to, color: '#4dd2ff', opacity: '0.55' });
  }
  // The engine's pick from the position on the board now.
  if (review.showBest && here && here.best) arrows.push({ from: here.best.from, to: here.best.to, color: '#39ff14' });

  const boardWrap = document.createElement('div');
  boardWrap.className = 'chrv-boardwrap';
  boardWrap.appendChild(grid);
  if (arrows.length) boardWrap.appendChild(arrowSvg(CELL * 8, CELL, flipped, arrows));
  // +1px for the grid border so arrow centres line up with the squares.
  if (arrows.length) boardWrap.lastChild.style.left = boardWrap.lastChild.style.top = '1px';

  const files = document.createElement('div');
  files.style.display = 'flex';
  for (let vc = 0; vc < 8; vc++) {
    const f = document.createElement('div');
    f.textContent = String.fromCharCode(97 + (flipped ? 7 - vc : vc));
    Object.assign(f.style, { width: `${CELL}px`, textAlign: 'center', fontSize: '12px', opacity: '0.7' });
    files.appendChild(f);
  }
  const boardCol = document.createElement('div');
  boardCol.append(boardWrap, files);
  pair.appendChild(boardCol);

  // Side panel: move list.
  const side = document.createElement('div');
  side.className = 'chrv-side';
  const list = document.createElement('div');
  list.className = 'chrv-moves';
  list.style.height = `${CELL * 8}px`;
  const startRow = document.createElement('div');
  const startBtn = document.createElement('span');
  startBtn.className = `chrv-mv${idx === 0 ? ' cur' : ''}`;
  startBtn.textContent = 'start';
  startBtn.addEventListener('click', () => opts.onJump(0));
  startRow.appendChild(startBtn);
  list.appendChild(startRow);
  let curEl = idx === 0 ? startBtn : null;
  for (let i = 0; i < plies; i += 2) {
    const mrow = document.createElement('div');
    mrow.className = 'chrv-mrow';
    const num = document.createElement('span');
    num.className = 'chrv-num';
    num.textContent = `${i / 2 + 1}.`;
    mrow.appendChild(num);
    for (const j of [i, i + 1]) {
      const span = document.createElement('span');
      const m = review.moves[j];
      if (m) {
        span.className = `chrv-mv${idx === j + 1 ? ' cur' : ''}`;
        span.textContent = m.san || '?';
        const k = classifyMove(m, review.analysis[j], review.analysis[j + 1]);
        if (k && CLASSES[k].mark && k !== 'best') {
          const sup = document.createElement('sup');
          sup.textContent = CLASSES[k].mark;
          sup.style.color = CLASSES[k].color;
          span.appendChild(sup);
        }
        span.title = k ? CLASSES[k].label : '';
        span.addEventListener('click', () => opts.onJump(j + 1));
        if (idx === j + 1) curEl = span;
      }
      mrow.appendChild(span);
    }
    list.appendChild(mrow);
  }
  side.appendChild(list);
  row.appendChild(side);
  wrap.appendChild(row);
  // Keep the current move in view (after layout).
  if (curEl) requestAnimationFrame(() => {
    const top = curEl.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - 24) list.scrollTop = top - list.clientHeight / 2;
  });

  // Navigation.
  const nav = document.createElement('div');
  nav.className = 'chrv-nav';
  const mk = (label, title, fn, disabled) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.disabled = !!disabled;
    b.addEventListener('click', fn);
    nav.appendChild(b);
    return b;
  };
  mk('⏮', 'Start (Home)', () => opts.onNav('start'), idx === 0);
  mk('◀', 'Previous move (←)', () => opts.onNav(-1), idx === 0);
  const plyLabel = document.createElement('span');
  plyLabel.className = 'chrv-ply';
  plyLabel.textContent = idx === 0 ? `start / ${plies}` : `move ${Math.ceil(idx / 2)}${idx % 2 ? '' : '…'} · ${idx}/${plies}`;
  nav.appendChild(plyLabel);
  mk('▶', 'Next move (→)', () => opts.onNav(1), idx === plies);
  mk('⏭', 'End (End)', () => opts.onNav('end'), idx === plies);
  wrap.appendChild(nav);

  // Explanation card for the current ply.
  const card = document.createElement('div');
  card.className = 'chrv-card';
  const line1 = document.createElement('div');
  if (played) {
    const no = `${Math.ceil(idx / 2)}.${played.color === 'black' ? '..' : ''} ${played.san}`;
    line1.append(document.createTextNode(`${no} `));
    const c = document.createElement('span');
    c.className = 'cls';
    if (cls) {
      c.textContent = `— ${CLASSES[cls].label}${CLASSES[cls].mark && cls !== 'best' ? ` ${CLASSES[cls].mark}` : ''}`;
      c.style.color = CLASSES[cls].color;
    } else {
      c.textContent = '— analysing…';
      c.style.opacity = '0.6';
    }
    line1.appendChild(c);
  } else {
    line1.textContent = 'Starting position';
  }
  const evalSpan = document.createElement('span');
  evalSpan.style.float = 'right';
  evalSpan.style.fontWeight = 'bold';
  evalSpan.textContent = here && here.eval ? formatEval(here.eval) : '';
  line1.appendChild(evalSpan);
  card.appendChild(line1);
  const hint = document.createElement('div');
  hint.className = 'hint';
  const bits = [];
  if (played && cls && cls !== 'best' && before && before.best) bits.push(`Best was ${before.best.san}`);
  if (here && here.best) bits.push(`${turn === 'white' ? 'White' : 'Black'} to move. Engine plays ${here.best.san}`);
  else if (idx === plies) bits.push(opts.resultText);
  hint.textContent = bits.join(' · ');
  card.appendChild(hint);
  wrap.appendChild(card);

  wrap.appendChild(evalGraph(review, opts.onJump));

  // Per-side summary.
  const s = summarize(review.moves, review.analysis);
  const sum = document.createElement('div');
  sum.className = 'chrv-sum';
  const cellTxt = (txt, cls2, color) => {
    const d = document.createElement('div');
    d.textContent = txt;
    if (cls2) d.className = cls2;
    if (color) d.style.color = color;
    sum.appendChild(d);
  };
  cellTxt('', 'h');
  for (const k of ['inaccuracy', 'mistake', 'blunder']) cellTxt(`${CLASSES[k].label}s`, 'h', CLASSES[k].color);
  for (const color of ['white', 'black']) {
    cellTxt(opts.nameFor(color));
    for (const k of ['inaccuracy', 'mistake', 'blunder']) cellTxt(String(s[color][k]));
  }
  wrap.appendChild(sum);

  const toggles = document.createElement('div');
  toggles.className = 'chrv-toggles';
  const bestBtn = document.createElement('button');
  bestBtn.textContent = review.showBest ? 'BEST MOVE: ON' : 'BEST MOVE: OFF';
  if (review.showBest) bestBtn.className = 'on';
  bestBtn.addEventListener('click', opts.onToggleBest);
  const flipBtn = document.createElement('button');
  flipBtn.textContent = 'FLIP BOARD';
  flipBtn.addEventListener('click', opts.onFlip);
  const exitBtn = document.createElement('button');
  exitBtn.textContent = 'EXIT REVIEW';
  exitBtn.addEventListener('click', opts.onExit);
  toggles.append(bestBtn, flipBtn, exitBtn);
  wrap.appendChild(toggles);

  const keys = document.createElement('div');
  keys.className = 'chrv-keys';
  keys.textContent = '← → step through moves · Home / End jump · Esc exits';
  wrap.appendChild(keys);
  return wrap;
}
