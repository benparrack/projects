// Dots and Boxes — 2-4 players. Tap/click between two dots to draw a line; close the fourth side
// of a box to claim it and move again. Most boxes when the grid is full wins.
// Server plugin: ../../../server/games/dotsboxes.js
//
// The board is one SVG. Every possible line owns a diamond-shaped hit area (the triangles between
// it and the two neighbouring box centres), so the whole board is clickable with no dead zones —
// wherever you tap, the nearest line is the one you get.

import { sfx } from '../sfx.js';
import { isBot, botName, addBotButton, removeBotButton } from '../cardCommon.js';
import { levelSelect } from '../botLevel.js';
import { createResults, seatResults } from '../resultsPanel.js';

export const COLORS = ['#ff5c7a', '#3ad7ff', '#ffd23f', '#b98cff'];
const SIZES = [4, 5, 6];
const MAX_SEATS = 4;
const S = 60; // dot spacing in SVG units
const M = 22; // margin
const NS = 'http://www.w3.org/2000/svg';

const REJECT = {
  not_your_turn: "It's not your turn",
  taken: 'That line is already drawn',
  invalid: 'Not a line',
  not_seated: 'Take a seat to play',
};

const CSS = `
.gt-db { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; }
.gt-db-status { font-size: 18px; font-weight: bold; padding: 6px 14px; border-radius: 6px; text-align: center;
  border: 2px solid transparent; background: rgba(255,255,255,.04); transition: background .2s, border-color .2s; }
.gt-db-status.mine { background: rgba(57,255,20,.13); border-color: #39ff14; animation: gt-db-pulse 1.6s ease-in-out infinite; }
@keyframes gt-db-pulse { 50% { box-shadow: 0 0 14px -2px #39ff14; } }
.gt-db-note { color: #ffb000; font-size: 13px; }
.gt-db-err { color: #ff4d4d; font-size: 14px; min-height: 0; }
.gt-db-players { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.gt-db-chip { display: flex; align-items: center; gap: 8px; padding: 6px 10px 6px 8px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,.12); background: #070b09; min-width: 120px; transition: transform .2s, box-shadow .2s; }
.gt-db-chip.turn { border-color: var(--c); box-shadow: 0 0 0 1px var(--c), 0 0 16px -4px var(--c); transform: translateY(-2px); }
.gt-db-chip.lead .gt-db-score::after { content: ' ★'; font-size: 11px; color: #ffd23f; }
.gt-db-swatch { width: 14px; height: 14px; border-radius: 4px; background: var(--c); box-shadow: 0 0 8px var(--c); flex: none; }
.gt-db-name { flex: 1; color: #d8ffd0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px; }
.gt-db-chip.you .gt-db-name::after { content: ' (you)'; opacity: .6; font-size: 11px; }
.gt-db-score { font-size: 20px; font-weight: bold; color: var(--c); min-width: 24px; text-align: right; }
.gt-db-score.bump { animation: gt-db-bump .45s cubic-bezier(.2,1.8,.4,1); }
@keyframes gt-db-bump { 40% { transform: scale(1.6); } }
.gt-db-controls { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; }
.gt-db-size button.on { background: #1f8f0c; color: #000; }
.gt-db-size { display: inline-flex; gap: 0; }
.gt-db-size button { padding: 6px 10px; }
.gt-db-size button + button { border-left: none; }
.gt-db-wrap { width: min(100%, 520px); position: relative; }
.gt-db-board { width: 100%; height: auto; display: block; touch-action: manipulation; user-select: none;
  background: radial-gradient(circle at 50% 40%, #0b1a10, #050805 70%); border: 1px solid #1f8f0c; border-radius: 10px; }
.gt-db-board.live { border-color: var(--turn); box-shadow: 0 0 18px -6px var(--turn); }
.gt-db-guide { stroke: rgba(57,255,20,.10); stroke-width: 2; stroke-dasharray: 2 7; stroke-linecap: round; }
.gt-db-line { stroke-width: 7; stroke-linecap: round; }
.gt-db-line.new { animation: gt-db-draw .28s ease-out backwards; }
@keyframes gt-db-draw { from { stroke-dashoffset: var(--len); } }
.gt-db-line.last { filter: drop-shadow(0 0 5px var(--c)); }
.gt-db-lastmark { stroke: #fff; stroke-width: 2.2; stroke-linecap: round; opacity: .85; animation: gt-db-blink 1.2s ease-in-out infinite; pointer-events: none; }
@keyframes gt-db-blink { 50% { opacity: .2; } }
.gt-db-preview { stroke-width: 7; stroke-linecap: round; opacity: 0; transition: opacity .08s; pointer-events: none; }
.gt-db-hit { fill: transparent; cursor: pointer; }
.gt-db-hit:hover + .gt-db-preview, .gt-db-hit.focus + .gt-db-preview { opacity: .45; }
.gt-db-dot { fill: #d8ffd0; }
.gt-db-box { transform-box: fill-box; transform-origin: center; }
.gt-db-box.new { animation: gt-db-pop .45s cubic-bezier(.2,1.6,.4,1) backwards; }
@keyframes gt-db-pop { from { transform: scale(.2); opacity: 0; } }
.gt-db-initial { font-family: "Courier New", monospace; font-weight: bold; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.gt-db-hint { font-size: 12px; opacity: .6; text-align: center; }
@media (prefers-reduced-motion: reduce) {
  .gt-db-line.new, .gt-db-box.new, .gt-db-score.bump, .gt-db-status.mine, .gt-db-lastmark { animation: none; }
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

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const svgEl = (tag, attrs) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};

// Endpoints of line {o, r, c} in SVG units.
export function lineEnds(o, r, c) {
  const x = M + c * S;
  const y = M + r * S;
  return o === 'h' ? [x, y, x + S, y] : [x, y, x, y + S];
}

// Diamond hit area for a line: its two dots plus the centres of the boxes either side.
export function hitDiamond(o, r, c) {
  const [x1, y1, x2, y2] = lineEnds(o, r, c);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const h = S / 2;
  return o === 'h'
    ? `${x1},${y1} ${mx},${my - h} ${x2},${y2} ${mx},${my + h}`
    : `${x1},${y1} ${mx + h},${my} ${x2},${y2} ${mx - h},${my}`;
}

export function mount(container, api) {
  ensureStyles();
  let view = null;
  let roster = [];
  let flash = null;
  let flashTimer = null;
  let seenMoves = -1; // moveCount already drawn (lines newer than this animate in)
  let prevBoxes = null;
  let prevScores = null;
  let focusKey = null; // hovered line, kept across re-renders

  const root = el('div', 'gt-db');
  const results = createResults(container);
  container.appendChild(root);

  const me = () => api.getClientId();
  const mySeat = () => (view ? view.seats.indexOf(me()) : -1);
  function nameFor(id) {
    if (!id) return '(empty)';
    if (isBot(id)) return botName(id);
    const r = roster.find((x) => x.clientId === id);
    return r ? r.nickname : 'someone';
  }
  const plainName = (id) => (isBot(id) ? id.slice(4).split('~')[0] : nameFor(id));

  function send(data) { api.sendAction(data); }

  function render() {
    const seat = mySeat();
    results.update(view && view.phase === 'game_over' ? seatResults({
      seats: view.seats, winners: view.winners, me: seat, nameFor,
      value: (i) => `${view.scores[i]} box${view.scores[i] === 1 ? '' : 'es'}`,
      rank: (i) => -view.scores[i],
      winTitle: view.winners.length > 1 ? "IT'S A TIE" : `${plainName(view.seats[view.winners[0]])} WINS`,
      subtitle: view.winners.length > 1 ? `Tied on ${view.scores[view.winners[0]]} boxes` : `${view.size}×${view.size} grid`,
      onRematch: () => send({ kind: 'resetGame' }),
    }) : null);

    root.innerHTML = '';
    if (!view) { root.textContent = 'Loading...'; return; }

    // --- status ---
    const status = el('div', 'gt-db-status');
    const turnId = view.seats[view.turnIdx];
    if (view.phase === 'waiting') {
      status.textContent = view.seats.length < 2
        ? `Waiting for players (${view.seats.length}/${MAX_SEATS}). Need 2 to start`
        : `${view.seats.length} players ready. Press START`;
    } else if (view.phase === 'playing') {
      const mine = seat === view.turnIdx;
      const again = view.lastLine && view.lastLine.made > 0 && view.lastLine.seat === view.turnIdx;
      status.textContent = mine
        ? (again ? '▶ BOX GO AGAIN' : '▶ YOUR TURN. Draw a line')
        : `${plainName(turnId)}${again ? ' scored. Going again' : ' is thinking…'}`;
      status.style.color = COLORS[view.turnIdx];
      if (mine) status.classList.add('mine');
    } else {
      status.textContent = view.winners.length > 1
        ? `TIE. ${view.winners.map((i) => plainName(view.seats[i])).join(' & ')}`
        : `${plainName(view.seats[view.winners[0]])} WINS ${view.scores[view.winners[0]]}–${Math.max(...view.scores.filter((_, i) => i !== view.winners[0]))}`;
      status.style.color = view.winners.length === 1 ? COLORS[view.winners[0]] : '#7fd7ff';
    }
    root.appendChild(status);
    if (view.note && view.phase === 'playing') root.appendChild(el('div', 'gt-db-note', view.note));
    if (flash) root.appendChild(el('div', 'gt-db-err', REJECT[flash] || 'Move rejected'));

    // --- players ---
    const players = el('div', 'gt-db-players');
    const top = view.phase === 'waiting' ? -1 : Math.max(...view.scores);
    view.seats.forEach((id, i) => {
      const chip = el('div', 'gt-db-chip');
      chip.style.setProperty('--c', COLORS[i]);
      if (view.phase === 'playing' && i === view.turnIdx) chip.classList.add('turn');
      if (top > 0 && view.scores[i] === top) chip.classList.add('lead');
      if (id === me()) chip.classList.add('you');
      chip.appendChild(el('span', 'gt-db-swatch'));
      chip.appendChild(el('span', 'gt-db-name', nameFor(id)));
      if (isBot(id) && view.phase === 'playing') {
        const sel = levelSelect(id.split('~')[1], (level) => send({ kind: 'setBotLevel', seat: i, level }));
        sel.style.fontSize = '11px';
        chip.appendChild(sel);
      }
      if (isBot(id) && view.phase !== 'playing' && seat !== -1) chip.appendChild(removeBotButton(api, i));
      const sc = el('span', 'gt-db-score', String(view.scores[i] || 0));
      if (prevScores && prevScores[i] != null && view.scores[i] > prevScores[i]) sc.classList.add('bump');
      chip.appendChild(sc);
      players.appendChild(chip);
    });
    if (!view.seats.length) players.appendChild(el('div', 'gt-db-hint', 'No one seated yet.'));
    root.appendChild(players);

    // --- controls ---
    const controls = el('div', 'gt-db-controls');
    if (view.phase === 'waiting') {
      if (seat === -1 && view.seats.length < MAX_SEATS) {
        const b = el('button', null, 'TAKE A SEAT');
        b.addEventListener('click', () => send({ kind: 'sit' }));
        controls.appendChild(b);
      }
      if (seat !== -1) {
        if (view.seats.length < MAX_SEATS) controls.appendChild(addBotButton(api, undefined, '+ PLAY VS BOT'));
        const sizes = el('span', 'gt-db-size');
        for (const n of SIZES) {
          const b = el('button', n === view.size ? 'on' : null, `${n}×${n}`);
          b.title = `${n}×${n} boxes`;
          b.addEventListener('click', () => send({ kind: 'setSize', size: n }));
          sizes.appendChild(b);
        }
        controls.appendChild(sizes);
        const start = el('button', null, 'START');
        start.disabled = view.seats.length < 2;
        if (!start.disabled) { start.style.borderColor = '#39ff14'; start.style.fontWeight = 'bold'; }
        start.addEventListener('click', () => send({ kind: 'startGame' }));
        controls.appendChild(start);
      } else {
        controls.appendChild(el('span', 'gt-db-hint', `Board: ${view.size}×${view.size}`));
      }
    }
    if (view.phase === 'game_over' && seat !== -1) {
      const again = el('button', null, 'NEW GAME');
      again.addEventListener('click', () => send({ kind: 'resetGame' }));
      controls.appendChild(again);
    }
    if (seat !== -1) {
      const leave = el('button', null, 'LEAVE SEAT');
      leave.addEventListener('click', () => send({ kind: 'leaveSeat' }));
      controls.appendChild(leave);
    }
    if (controls.childNodes.length) root.appendChild(controls);

    // --- board ---
    root.appendChild(renderBoard(seat));
    if (view.phase === 'playing' && seat === -1) root.appendChild(el('div', 'gt-db-hint', 'Spectating'));
    if (view.phase === 'waiting') root.appendChild(el('div', 'gt-db-hint', 'Close the 4th side of a box to claim it and go again.'));

    seenMoves = view.moveCount;
    prevBoxes = view.boxes.slice();
    prevScores = view.scores.slice();
  }

  function renderBoard(seat) {
    const n = view.size;
    const W = n * S + 2 * M;
    const wrap = el('div', 'gt-db-wrap');
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${W}`, class: 'gt-db-board' });
    const canPlay = view.phase === 'playing' && seat !== -1 && seat === view.turnIdx;
    if (view.phase === 'playing') {
      svg.classList.add('live');
      svg.style.setProperty('--turn', COLORS[view.turnIdx]);
    }

    // Boxes.
    const gBoxes = svgEl('g', {});
    view.boxes.forEach((owner, b) => {
      if (owner == null) return;
      const r = Math.floor(b / n);
      const c = b % n;
      const x = M + c * S;
      const y = M + r * S;
      const g = svgEl('g', { class: 'gt-db-box' });
      if (prevBoxes && prevBoxes.length === view.boxes.length && prevBoxes[b] == null) g.classList.add('new');
      g.appendChild(svgEl('rect', { x: x + 5, y: y + 5, width: S - 10, height: S - 10, rx: 6, fill: COLORS[owner], 'fill-opacity': 0.24, stroke: COLORS[owner], 'stroke-opacity': 0.35 }));
      const t = svgEl('text', { x: x + S / 2, y: y + S / 2 + 1, class: 'gt-db-initial', fill: COLORS[owner], 'font-size': S * 0.42 });
      t.textContent = (plainName(view.seats[owner]) || '?').trim().charAt(0).toUpperCase() || '?';
      g.appendChild(t);
      gBoxes.appendChild(g);
    });
    svg.appendChild(gBoxes);

    // Guides for every possible line, then drawn lines.
    const drawn = new Map(view.lines.map((l) => [`${l.o}${l.r},${l.c}`, l]));
    const all = [];
    for (let r = 0; r <= n; r++) for (let c = 0; c < n; c++) all.push({ o: 'h', r, c });
    for (let r = 0; r < n; r++) for (let c = 0; c <= n; c++) all.push({ o: 'v', r, c });
    const gGuides = svgEl('g', {});
    const gLines = svgEl('g', {});
    const gHits = svgEl('g', {});
    const last = view.lastLine;
    const lastKey = last ? `${last.o}${last.r},${last.c}` : null;
    const animateLast = seenMoves !== -1 && view.moveCount === seenMoves + 1;
    for (const ln of all) {
      const key = `${ln.o}${ln.r},${ln.c}`;
      const [x1, y1, x2, y2] = lineEnds(ln.o, ln.r, ln.c);
      const d = drawn.get(key);
      if (d) {
        const line = svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'gt-db-line', stroke: COLORS[d.seat] || '#d8ffd0' });
        line.style.setProperty('--c', COLORS[d.seat] || '#d8ffd0');
        if (key === lastKey) {
          line.classList.add('last');
          if (animateLast) {
            line.classList.add('new');
            line.style.strokeDasharray = `${S} ${S}`;
            line.style.setProperty('--len', `${S}px`);
          }
        }
        gLines.appendChild(line);
        continue;
      }
      gGuides.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'gt-db-guide' }));
      if (!canPlay) continue;
      const hit = svgEl('polygon', { points: hitDiamond(ln.o, ln.r, ln.c), class: 'gt-db-hit' });
      hit.dataset.o = ln.o;
      hit.dataset.r = String(ln.r);
      hit.dataset.c = String(ln.c);
      if (key === focusKey) hit.classList.add('focus');
      hit.addEventListener('pointerenter', () => { focusKey = key; });
      hit.addEventListener('pointerleave', () => { if (focusKey === key) focusKey = null; hit.classList.remove('focus'); });
      hit.addEventListener('click', () => {
        focusKey = null;
        sfx.play('click');
        send({ kind: 'move', o: ln.o, r: ln.r, c: ln.c });
      });
      gHits.appendChild(hit);
      gHits.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'gt-db-preview', stroke: COLORS[seat] }));
    }
    svg.appendChild(gGuides);
    svg.appendChild(gLines);
    if (last && view.phase === 'playing') {
      // A small white tick in the middle of the most recent line, so it's easy to spot.
      const [x1, y1, x2, y2] = lineEnds(last.o, last.r, last.c);
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      svg.appendChild(svgEl('circle', { cx: mx, cy: my, r: 3.2, class: 'gt-db-lastmark', fill: '#fff' }));
    }
    svg.appendChild(gHits);

    // Dots on top.
    const gDots = svgEl('g', {});
    for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++) gDots.appendChild(svgEl('circle', { cx: M + c * S, cy: M + r * S, r: 5.5, class: 'gt-db-dot' }));
    svg.appendChild(gDots);
    wrap.appendChild(svg);
    return wrap;
  }

  function sounds(prev, next) {
    if (!prev || !next) return;
    const seat = next.seats.indexOf(me());
    if (prev.phase !== 'game_over' && next.phase === 'game_over') {
      if (seat === -1) sfx.play('point');
      else sfx.play(next.winners.includes(seat) ? 'win' : 'lose');
      return;
    }
    if (next.phase !== 'playing' || next.moveCount === prev.moveCount) return;
    if (next.lastLine && next.lastLine.made > 0) sfx.play('point');
    else sfx.play('move');
    const myTurnNow = seat !== -1 && next.turnIdx === seat;
    const myTurnBefore = seat !== -1 && prev.phase === 'playing' && prev.turnIdx === seat;
    if (myTurnNow && !myTurnBefore) setTimeout(() => sfx.play('turn'), 140);
  }

  function setView(v) {
    // A new game / board change resets the animation baselines (nothing should "pop").
    if (view && (v.moveCount < view.moveCount || v.size !== view.size || v.phase !== view.phase && v.phase !== 'game_over')) {
      seenMoves = v.moveCount;
      prevBoxes = null;
      prevScores = null;
    }
    view = v;
  }

  render();

  return {
    applySnapshot(snapshot) {
      seenMoves = -1;
      prevBoxes = null;
      prevScores = null;
      view = snapshot;
      render();
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        const prev = view;
        setView(data);
        sounds(prev, data);
        flash = null;
        render();
      } else if (data.kind === 'moveRejected') {
        flash = data.reason;
        sfx.play('error');
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { flash = null; render(); }, 2200);
        render();
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      render();
    },
    unmount() {
      clearTimeout(flashTimer);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
