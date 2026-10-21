// Sea Battle — GamePigeon-style Battleship. Placing: drag ships around your grid (tap a ship to
// select it, tap again / R / ROTATE to turn it), RANDOMIZE, then READY. Battle: fire at the enemy
// grid; a hit lets you shoot again. Rules, secrecy and the bot live in server/games/seabattle.js —
// the server only ever sends you your own fleet (plus sunk enemy ships, and everything at the end).
import { sfx } from '../sfx.js';
import { preferredLevel, levelSelect } from '../botLevel.js';
import { createResults } from '../resultsPanel.js';

const N = 10;
const COLS = 'ABCDEFGHIJ';
const SEAT_LABEL = { p1: 'PLAYER 1', p2: 'PLAYER 2' };
const SEAT_COLOR = { p1: '#3ad7ff', p2: '#ff9f3a' };
const DEFAULT_FLEET = [
  { id: 'carrier', name: 'Carrier', len: 5 },
  { id: 'battleship', name: 'Battleship', len: 4 },
  { id: 'cruiser', name: 'Cruiser', len: 3 },
  { id: 'submarine', name: 'Submarine', len: 3 },
  { id: 'destroyer', name: 'Destroyer', len: 2 },
];
const REJECT_MESSAGES = {
  not_your_turn: "It's not your turn",
  not_seated: 'Take a seat to play',
  not_playing: 'The battle has not started',
  not_placing: 'Fleets are already locked in',
  already_shot: 'You already fired there',
  bad_fleet: 'That fleet layout is not valid',
  invalid: 'Invalid target',
  no_room: 'No room to rotate there',
  powers_off: 'Powers are off this game',
  power_cooldown: 'That power is still recharging',
  nothing_left: 'Nothing left to hit there',
};
const cellName = (r, c) => `${COLS[c]}${r + 1}`;

const CSS = `
.gt-sb { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; user-select: none; -webkit-user-select: none; }
.gt-sb .sb-status { font-size: 18px; font-weight: bold; padding: 6px 14px; border-radius: 6px; border: 2px solid transparent; text-align: center; }
.gt-sb .sb-status.mine { background: rgba(57,255,20,.15); border-color: #39ff14; }
.gt-sb .sb-status.alert { background: rgba(255,77,77,.12); border-color: #ff4d4d; color: #ff8a8a; }
.gt-sb .sb-err { color: #ff4d4d; min-height: 1.2em; font-size: 14px; }
.gt-sb .sb-seats { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; align-items: center; }
.gt-sb .sb-seat { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border: 1px solid #1f8f0c; border-radius: 6px; flex-wrap: wrap; }
.gt-sb .sb-seat.turn { border-color: #ffb000; box-shadow: 0 0 10px -2px #ffb000; }
.gt-sb .sb-flag { width: 14px; height: 14px; border-radius: 3px; display: inline-block; flex: none; }
.gt-sb .sb-score { font-weight: bold; color: #ffb000; }
.gt-sb .sb-badge { font-size: 11px; padding: 1px 6px; border-radius: 8px; border: 1px solid currentColor; opacity: .85; }
.gt-sb .sb-badge.ok { color: #39ff14; }
.gt-sb .sb-badge.wait { color: #8aa; }
.gt-sb .sb-boards { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; align-items: flex-start; width: 100%; }
.gt-sb .sb-panel { flex: 1 1 300px; max-width: 440px; display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
.gt-sb .sb-panel.small { max-width: 330px; }
.gt-sb .sb-title { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; letter-spacing: 1px; color: #9fe; }
.gt-sb .sb-title b { color: #fff; }
.gt-sb .sb-frame { display: grid; grid-template-columns: 6% 1fr; grid-template-rows: 6% 1fr; aspect-ratio: 1; width: 100%; }
.gt-sb .sb-collabels, .gt-sb .sb-rowlabels { display: grid; font-size: 10px; color: #6fa8b8; align-items: center; justify-items: center; }
.gt-sb .sb-collabels { grid-column: 2; grid-row: 1; grid-template-columns: repeat(10, 1fr); }
.gt-sb .sb-rowlabels { grid-column: 1; grid-row: 2; grid-template-rows: repeat(10, 1fr); }
.gt-sb .sb-grid { grid-column: 2; grid-row: 2; position: relative; display: grid; grid-template-columns: repeat(10, 1fr); grid-template-rows: repeat(10, 1fr);
  border-radius: 6px; overflow: hidden; touch-action: none; isolation: isolate;
  background:
    radial-gradient(ellipse at 30% 20%, rgba(120,200,255,.18), transparent 60%),
    linear-gradient(160deg, #0b3a5c 0%, #0a2b47 55%, #071d33 100%);
  box-shadow: inset 0 0 0 1px #1d5f86, 0 6px 22px rgba(0,0,0,.55); }
.gt-sb .sb-grid::before { content: ''; position: absolute; inset: -50%; pointer-events: none; opacity: .35;
  background: repeating-linear-gradient(115deg, transparent 0 18px, rgba(160,220,255,.07) 18px 20px);
  animation: sb-waves 9s linear infinite; }
@keyframes sb-waves { from { transform: translateX(0); } to { transform: translateX(40px); } }
.gt-sb .sb-grid.target { cursor: crosshair; box-shadow: inset 0 0 0 1px #1d5f86, 0 0 0 2px #39ff14, 0 0 18px 2px rgba(57,255,20,.4); }
.gt-sb .sb-grid.dim { filter: saturate(.6) brightness(.8); }
.gt-sb .sb-cell { position: relative; border-right: 1px solid rgba(120,190,230,.13); border-bottom: 1px solid rgba(120,190,230,.13); }
/* No z-index on cells: a stacking context per cell trapped hit/miss marks UNDER the ship hulls. */
.gt-sb .sb-grid.target:not(.armed) .sb-cell.open:hover { background: rgba(57,255,20,.18); box-shadow: inset 0 0 0 2px rgba(57,255,20,.7); }
.gt-sb .sb-grid.target:not(.armed) .sb-cell.open:hover::after { content: ''; position: absolute; inset: 22%; border: 2px solid #39ff14; border-radius: 50%;
  background: linear-gradient(#39ff14,#39ff14) center/2px 100% no-repeat, linear-gradient(#39ff14,#39ff14) center/100% 2px no-repeat; opacity: .8; }
.gt-sb .sb-mark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 4; pointer-events: none; }
.gt-sb .sb-mark.miss::before { content: ''; width: 26%; height: 26%; border-radius: 50%; background: rgba(220,240,255,.8); box-shadow: 0 0 0 3px rgba(220,240,255,.18); }
.gt-sb .sb-mark.hit::before { content: ''; width: 58%; height: 58%; border-radius: 50%;
  background: radial-gradient(circle at 50% 55%, #fff6a0 0%, #ffb000 30%, #ff3c1f 62%, rgba(255,60,31,0) 72%);
  animation: sb-flame 0.9s ease-in-out infinite alternate; }
.gt-sb .sb-mark.hit::after { content: ''; position: absolute; width: 18%; height: 18%; top: 14%; left: 48%; border-radius: 50%; background: rgba(60,60,60,.55); filter: blur(2px); animation: sb-smoke 1.6s ease-out infinite; }
.gt-sb .sb-mark.sunkcell::before { background: radial-gradient(circle, #ff8a5c 0%, #c0201a 55%, rgba(120,0,0,0) 72%); animation: none; }
@keyframes sb-flame { from { transform: scale(.88); filter: brightness(1); } to { transform: scale(1.06); filter: brightness(1.25); } }
@keyframes sb-smoke { from { transform: translateY(0) scale(.6); opacity: .8; } to { transform: translateY(-160%) scale(1.5); opacity: 0; } }
.gt-sb .sb-mark.fresh { animation: sb-pop .45s ease-out; }
.gt-sb .sb-mark.fresh.miss::after { content: ''; position: absolute; inset: 15%; border-radius: 50%; border: 2px solid rgba(220,240,255,.9); animation: sb-ripple .8s ease-out forwards; }
.gt-sb .sb-mark.fresh.hit .sb-boom { position: absolute; inset: -40%; border-radius: 50%; background: radial-gradient(circle, rgba(255,240,160,.95), rgba(255,120,30,.6) 40%, transparent 70%); animation: sb-boom .55s ease-out forwards; }
@keyframes sb-pop { 0% { transform: scale(1.8); opacity: 0; } 60% { transform: scale(.9); opacity: 1; } 100% { transform: scale(1); } }
@keyframes sb-ripple { from { transform: scale(.4); opacity: 1; } to { transform: scale(1.9); opacity: 0; } }
@keyframes sb-boom { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
.gt-sb .sb-last { position: absolute; inset: 6%; border: 2px solid #ffd23f; border-radius: 4px; z-index: 5; pointer-events: none; animation: sb-blink 1.1s ease-in-out infinite; }
@keyframes sb-blink { 50% { opacity: .25; } }
.gt-sb .sb-ship { position: absolute; z-index: 3; box-sizing: border-box; padding: .7%; /* % padding resolves against the grid width: .7% = 7% of a cell */ pointer-events: none; }
.gt-sb .sb-ship .hull { width: 100%; height: 100%; border-radius: 40% 999px 999px 40% / 50%;
  background:
    radial-gradient(circle, #5d6b77 0 22%, transparent 24%) 0 50% / var(--seg) 100% repeat-x,
    linear-gradient(180deg, #b7c3cc 0%, #8a98a4 45%, #5d6b77 100%);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.35), 0 3px 6px rgba(0,0,0,.55); }
.gt-sb .sb-ship.v .hull { border-radius: 50% / 40% 40% 999px 999px;
  background:
    radial-gradient(circle, #5d6b77 0 22%, transparent 24%) 50% 0 / 100% var(--seg) repeat-y,
    linear-gradient(90deg, #b7c3cc 0%, #8a98a4 45%, #5d6b77 100%); }
.gt-sb .sb-ship.sunk .hull { background: linear-gradient(180deg, #7a3a35, #4a1b18); box-shadow: inset 0 0 0 2px #ff5c4d, 0 0 10px rgba(255,60,40,.5); opacity: .85; }
.gt-sb .sb-ship.enemy .hull { opacity: .7; }
.gt-sb .sb-ship.drag { pointer-events: auto; cursor: grab; touch-action: none; }
.gt-sb .sb-ship.drag:active { cursor: grabbing; }
.gt-sb .sb-ship.selected .hull { box-shadow: inset 0 0 0 2px #39ff14, 0 0 12px rgba(57,255,20,.7); }
.gt-sb .sb-ship.ghost { z-index: 6; opacity: .85; }
.gt-sb .sb-ship.ghost.bad .hull { box-shadow: inset 0 0 0 2px #ff4d4d, 0 0 12px rgba(255,77,77,.8); filter: sepia(1) hue-rotate(-40deg) saturate(3); }
.gt-sb .sb-ship.lifted { opacity: .25; }
.gt-sb .sb-tools { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.gt-sb .sb-tools button.go { background: #39ff14; color: #001a00; font-weight: bold; }
.gt-sb .sb-fleetlist { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11px; justify-content: center; }
.gt-sb .sb-fleetlist span { display: inline-flex; gap: 4px; align-items: center; color: #9fe; }
.gt-sb .sb-fleetlist span.down { color: #ff6b5c; text-decoration: line-through; opacity: .8; }
.gt-sb .sb-pips { display: inline-flex; gap: 1px; }
.gt-sb .sb-pips i { width: 6px; height: 6px; background: currentColor; border-radius: 1px; display: inline-block; }
.gt-sb .sb-pips i.hit { background: #ff3c1f; box-shadow: 0 0 4px #ff3c1f; }
.gt-sb .sb-fleetlist span.struck { color: #ffb000; animation: sb-blink .5s ease-in-out 4; }
.gt-sb .sb-ship.damaged .hull { filter: brightness(.82) sepia(.35); }
.gt-sb .sb-callout { font-size: 15px; font-weight: bold; padding: 4px 12px; border-radius: 6px; text-align: center; color: #cfe; min-height: 1.3em; }
.gt-sb .sb-callout.bad { color: #ff8a8a; background: rgba(255,77,77,.1); }
.gt-sb .sb-callout.good { color: #39ff14; background: rgba(57,255,20,.08); }
.gt-sb .sb-callout.fresh { animation: sb-pop .45s ease-out; }
.gt-sb .sb-rules { display: flex; gap: 8px; align-items: center; justify-content: center; flex-wrap: wrap; font-size: 13px; }
.gt-sb .sb-rules button.on { background: #ffb000; color: #1a0f00; font-weight: bold; }
.gt-sb .sb-powers { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; align-items: center; font-size: 12px; }
.gt-sb .sb-powers button.armed { background: #ffb000; color: #1a0f00; font-weight: bold; box-shadow: 0 0 10px #ffb000; }
.gt-sb .sb-powers .foe { opacity: .75; }
.gt-sb .sb-cell.pv { background: rgba(255,176,0,.28); box-shadow: inset 0 0 0 2px rgba(255,176,0,.85); }
.gt-sb .sb-radar { position: absolute; inset: 0; z-index: 2; pointer-events: none; display: flex; align-items: center; justify-content: center; }
.gt-sb .sb-radar.ship::before { content: ''; width: 40%; height: 40%; border-radius: 50%; border: 2px solid #39ff14; background: rgba(57,255,20,.35); box-shadow: 0 0 8px #39ff14; animation: sb-blink 1.4s ease-in-out infinite; }
.gt-sb .sb-radar.empty { background: rgba(120,200,255,.08); }
.gt-sb .sb-radar.empty::before { content: '·'; color: rgba(160,220,255,.6); font-size: 14px; }
.gt-sb .sb-scan { position: absolute; z-index: 5; pointer-events: none; border: 2px dashed rgba(57,255,20,.55); border-radius: 4px; box-sizing: border-box; }
.gt-sb .sb-scan.fresh { border-style: solid; border-color: #39ff14; box-shadow: 0 0 14px rgba(57,255,20,.6);
  background: conic-gradient(from 0deg, rgba(57,255,20,.45), transparent 30%, transparent); animation: sb-sweep 1s linear 2; }
@keyframes sb-sweep { from { background: conic-gradient(from 0deg, rgba(57,255,20,.45), transparent 30%, transparent); } 50% { background: conic-gradient(from 180deg, rgba(57,255,20,.45), transparent 30%, transparent); } to { background: transparent; } }
.gt-sb .sb-hint { font-size: 12px; opacity: .65; text-align: center; max-width: 560px; }
@media (prefers-reduced-motion: reduce) { .gt-sb .sb-grid::before, .gt-sb .sb-mark.hit::before, .gt-sb .sb-mark.hit::after, .gt-sb .sb-last, .gt-sb .sb-radar.ship::before, .gt-sb .sb-scan.fresh { animation: none; } }
`;
let styled = false;
function ensureStyles() {
  if (styled) return;
  styled = true;
  const tag = document.createElement('style');
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

// ---- pure fleet helpers (also handy for tests) -------------------------------------------------
export function shipCells(ship, len) {
  const out = [];
  for (let k = 0; k < len; k++) out.push(ship.dir === 'h' ? [ship.r, ship.c + k] : [ship.r + k, ship.c]);
  return out;
}

export function fits(fleet, ship, lens) {
  const cells = shipCells(ship, lens[ship.id]);
  if (cells.some(([r, c]) => r < 0 || r >= N || c < 0 || c >= N)) return false;
  const taken = new Set();
  for (const s of fleet) if (s.id !== ship.id) for (const [r, c] of shipCells(s, lens[s.id])) taken.add(r * N + c);
  return cells.every(([r, c]) => !taken.has(r * N + c));
}

export function randomFleet(spec) {
  for (;;) {
    const fleet = [];
    let ok = true;
    const lens = Object.fromEntries(spec.map((s) => [s.id, s.len]));
    for (const { id, len } of spec) {
      let placed = false;
      for (let t = 0; t < 300 && !placed; t++) {
        const dir = Math.random() < 0.5 ? 'h' : 'v';
        const ship = {
          id, dir,
          r: Math.floor(Math.random() * (dir === 'v' ? N - len + 1 : N)),
          c: Math.floor(Math.random() * (dir === 'h' ? N - len + 1 : N)),
        };
        if (fits(fleet, ship, lens)) { fleet.push(ship); placed = true; }
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return fleet;
  }
}

export function mount(container, api) {
  ensureStyles();
  let view = null;
  let roster = [];
  let flashError = null;
  let flashTimer = null;
  let draft = null; // my fleet while placing: [{id, r, c, dir}]
  let draftRound = null;
  let selected = null;
  let drag = null; // { id, grabK, startX, startY, moved, cand, el, grid, valid }
  let pendingRender = false;
  let freshKey = null; // lastShot key that should animate on next render
  let armed = null; // power being aimed: { power: 'barrage'|'radar', axis: 'row'|'col' }
  let pvAnchor = null; // touch: first tap previews, a second tap on the same target fires

  const root = document.createElement('div');
  root.className = 'gt-sb';
  container.appendChild(root);
  const results = createResults(container);

  const spec = () => (view && view.fleetSpec) || DEFAULT_FLEET;
  const lens = () => Object.fromEntries(spec().map((s) => [s.id, s.len]));

  function nicknameFor(clientId) {
    if (!clientId) return null;
    if (clientId === 'BOT') return 'Bot';
    const entry = roster.find((r) => r.clientId === clientId);
    return entry ? entry.nickname : 'someone';
  }
  const mySeat = () => (view ? view.mySeat : null);
  const other = (s) => (s === 'p1' ? 'p2' : 'p1');
  const myTurn = () => view && view.phase === 'playing' && mySeat() && view.turn === mySeat();
  const seatName = (s) => nicknameFor(view.players[s]) || SEAT_LABEL[s];

  function showError(reason) {
    flashError = reason;
    sfx.play('error');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashError = null; render(); }, 1800);
    render();
  }

  // ---- board building --------------------------------------------------------------------------
  // opts: { shots: grid of null|'miss'|'hit' fired AT this board, ships: [{ship, cls}], target: bool,
  //         sunkCells: Set, last: {cells: Set(r*N+c), fresh} | null, onCell(r,c), dim,
  //         radar: grid of null|'ship'|'empty' (my readings), scans: [{r,c,fresh}] }
  function buildBoard(opts) {
    const frame = document.createElement('div');
    frame.className = 'sb-frame';
    const colLabels = document.createElement('div');
    colLabels.className = 'sb-collabels';
    for (let c = 0; c < N; c++) { const s = document.createElement('span'); s.textContent = COLS[c]; colLabels.appendChild(s); }
    const rowLabels = document.createElement('div');
    rowLabels.className = 'sb-rowlabels';
    for (let r = 0; r < N; r++) { const s = document.createElement('span'); s.textContent = String(r + 1); rowLabels.appendChild(s); }
    const grid = document.createElement('div');
    grid.className = 'sb-grid';
    if (opts.target) grid.classList.add('target');
    if (opts.dim) grid.classList.add('dim');
    const lastHas = (r, c) => !!(opts.last && opts.last.cells.has(r * N + c));
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const cell = document.createElement('div');
        cell.className = 'sb-cell';
        const shot = opts.shots ? opts.shots[r][c] : null;
        if (!shot) cell.classList.add('open');
        if (shot) {
          const mark = document.createElement('div');
          mark.className = `sb-mark ${shot}`;
          if (shot === 'hit' && opts.sunkCells && opts.sunkCells.has(r * N + c)) mark.classList.add('sunkcell');
          if (lastHas(r, c) && opts.last.fresh) {
            mark.classList.add('fresh');
            const boom = document.createElement('div');
            boom.className = 'sb-boom';
            mark.appendChild(boom);
          }
          cell.appendChild(mark);
        }
        const reading = !shot && opts.radar ? opts.radar[r][c] : null;
        if (reading) {
          const blip = document.createElement('div');
          blip.className = `sb-radar ${reading}`;
          cell.appendChild(blip);
        }
        if (lastHas(r, c)) {
          const ring = document.createElement('div');
          ring.className = 'sb-last';
          cell.appendChild(ring);
        }
        if (opts.onCell) cell.addEventListener('click', () => opts.onCell(r, c, shot));
        cell.title = cellName(r, c) + (reading === 'ship' ? ' · radar: ship.' : reading === 'empty' ? ' · radar: clear' : '');
        grid.appendChild(cell);
      }
    }
    for (const { ship, cls } of opts.ships || []) grid.appendChild(shipEl(ship, cls));
    for (const sc of opts.scans || []) {
      const box = document.createElement('div');
      box.className = `sb-scan${sc.fresh ? ' fresh' : ''}`;
      Object.assign(box.style, { left: `${sc.c * 10}%`, top: `${sc.r * 10}%`, width: '20%', height: '20%' });
      grid.appendChild(box);
    }
    frame.append(colLabels, rowLabels, grid);
    return { frame, grid };
  }

  function placeShipEl(el, ship) {
    const len = lens()[ship.id];
    el.style.left = `${ship.c * 10}%`;
    el.style.top = `${ship.r * 10}%`;
    el.style.width = `${(ship.dir === 'h' ? len : 1) * 10}%`;
    el.style.height = `${(ship.dir === 'v' ? len : 1) * 10}%`;
    el.classList.toggle('v', ship.dir === 'v');
    el.style.setProperty('--seg', `${100 / len}%`);
  }
  function shipEl(ship, cls = '') {
    const el = document.createElement('div');
    el.className = `sb-ship ${cls}`;
    el.dataset.id = ship.id;
    const hull = document.createElement('div');
    hull.className = 'hull';
    el.appendChild(hull);
    placeShipEl(el, ship);
    return el;
  }

  function sunkCellSet(sunkList) {
    const set = new Set();
    for (const s of sunkList || []) for (const [r, c] of shipCells(s, lens()[s.id])) set.add(r * N + c);
    return set;
  }

  // fleet + shots (optional, my own fleet): light one pip per hit cell and flag the ship just struck.
  function fleetList(sunkList, label, fleet, shots, struck) {
    const box = document.createElement('div');
    box.className = 'sb-fleetlist';
    const down = new Set((sunkList || []).map((s) => s.id));
    const cap = document.createElement('span');
    cap.textContent = label;
    cap.style.color = '#6fa8b8';
    box.appendChild(cap);
    for (const s of spec()) {
      const item = document.createElement('span');
      if (down.has(s.id)) item.classList.add('down');
      else if (struck && struck.has(s.id)) item.classList.add('struck');
      const mine = fleet && fleet.find((x) => x.id === s.id);
      const cells = mine ? shipCells(mine, s.len) : [];
      const pips = document.createElement('span');
      pips.className = 'sb-pips';
      for (let k = 0; k < s.len; k++) {
        const pip = document.createElement('i');
        if (mine && shots && shots[cells[k][0]][cells[k][1]] === 'hit') pip.classList.add('hit');
        pips.appendChild(pip);
      }
      item.append(pips, document.createTextNode(s.name));
      box.appendChild(item);
    }
    return box;
  }

  function panel(titleLeft, titleRight, board, extra, small) {
    const p = document.createElement('div');
    p.className = `sb-panel${small ? ' small' : ''}`;
    const t = document.createElement('div');
    t.className = 'sb-title';
    const a = document.createElement('span');
    a.innerHTML = titleLeft;
    const b = document.createElement('span');
    b.textContent = titleRight || '';
    t.append(a, b);
    p.append(t, board);
    if (extra) p.appendChild(extra);
    return p;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

  // ---- placing (drag / rotate / randomize) -----------------------------------------------------
  function ensureDraft() {
    if (!view || view.phase !== 'placing' || !mySeat()) return;
    if (draftRound === view.roundId && draft) return;
    draftRound = view.roundId;
    const mine = view.fleets && view.fleets[mySeat()];
    draft = mine ? mine.map((s) => ({ ...s })) : randomFleet(spec());
    selected = null;
  }

  function cellFromEvent(grid, e) {
    const rect = grid.getBoundingClientRect();
    if (!rect.width) return null;
    return {
      r: Math.floor(((e.clientY - rect.top) / rect.height) * N),
      c: Math.floor(((e.clientX - rect.left) / rect.width) * N),
    };
  }

  function rotate(id) {
    const ship = draft.find((s) => s.id === id);
    if (!ship) return;
    const len = lens()[id];
    const dir = ship.dir === 'h' ? 'v' : 'h';
    // Try rotating in place, then nudged back inside the grid / around neighbours.
    const tries = [];
    for (let k = 0; k < len; k++) {
      tries.push(dir === 'v' ? { r: ship.r - k, c: ship.c } : { r: ship.r, c: ship.c - k });
    }
    for (const t of tries) {
      const cand = { id, dir, r: t.r, c: t.c };
      if (fits(draft, cand, lens())) {
        Object.assign(ship, cand);
        sfx.play('swap');
        render();
        return;
      }
    }
    showError('no_room');
  }

  function attachDrag(grid) {
    for (const el of grid.querySelectorAll('.sb-ship.drag')) {
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        const ship = draft.find((s) => s.id === el.dataset.id);
        const cell = cellFromEvent(grid, e);
        if (!ship || !cell) return;
        const grabK = ship.dir === 'h' ? cell.c - ship.c : cell.r - ship.r;
        const ghost = shipEl(ship, 'ghost');
        grid.appendChild(ghost);
        el.classList.add('lifted');
        drag = { id: ship.id, grabK, startX: e.clientX, startY: e.clientY, moved: false, cand: { ...ship }, ghost, el, grid, valid: true };
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      });
      el.addEventListener('pointermove', (e) => {
        if (!drag || drag.el !== el) return;
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 5) drag.moved = true;
        const cell = cellFromEvent(drag.grid, e);
        if (!cell) return;
        const ship = draft.find((s) => s.id === drag.id);
        const cand = ship.dir === 'h'
          ? { id: ship.id, dir: 'h', r: cell.r, c: cell.c - drag.grabK }
          : { id: ship.id, dir: 'v', r: cell.r - drag.grabK, c: cell.c };
        // Keep the ghost inside the grid while dragging past an edge.
        const len = lens()[ship.id];
        cand.r = Math.max(0, Math.min(N - (cand.dir === 'v' ? len : 1), cand.r));
        cand.c = Math.max(0, Math.min(N - (cand.dir === 'h' ? len : 1), cand.c));
        if (cand.r === drag.cand.r && cand.c === drag.cand.c) return;
        drag.cand = cand;
        drag.valid = fits(draft, cand, lens());
        placeShipEl(drag.ghost, cand);
        drag.ghost.classList.toggle('bad', !drag.valid);
        sfx.play('tick');
      });
      const end = (e, cancelled) => {
        if (!drag || drag.el !== el) return;
        const d = drag;
        drag = null;
        try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        d.ghost.remove();
        el.classList.remove('lifted');
        if (!cancelled && !d.moved) {
          if (selected === d.id) rotate(d.id);
          else { selected = d.id; sfx.play('select'); render(); }
        } else if (!cancelled && d.valid) {
          Object.assign(draft.find((s) => s.id === d.id), d.cand);
          selected = d.id;
          sfx.play('move');
          render();
        } else {
          if (!cancelled) sfx.play('error');
          render();
        }
        if (pendingRender) { pendingRender = false; render(); }
      };
      el.addEventListener('pointerup', (e) => end(e, false));
      el.addEventListener('pointercancel', (e) => end(e, true));
    }
  }

  function onKey(e) {
    if (armed && e.key === 'Escape') { armed = null; render(); return; }
    if (armed && armed.power === 'barrage' && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); flipAxis(); return; }
    if (!view || view.phase !== 'placing' || !mySeat() || view.ready[mySeat()]) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if ((e.key === 'r' || e.key === 'R') && selected) { e.preventDefault(); rotate(selected); }
  }
  window.addEventListener('keydown', onKey);

  // ---- render ----------------------------------------------------------------------------------
  function renderSeats() {
    const seats = document.createElement('div');
    seats.className = 'sb-seats';
    const seat = mySeat();
    for (const s of ['p1', 'p2']) {
      const box = document.createElement('div');
      box.className = 'sb-seat';
      if (view.phase === 'playing' && view.turn === s) box.classList.add('turn');
      const flag = document.createElement('span');
      flag.className = 'sb-flag';
      flag.style.background = SEAT_COLOR[s];
      const label = document.createElement('span');
      const occ = nicknameFor(view.players[s]);
      label.textContent = `${SEAT_LABEL[s]}: ${occ || '(empty)'}${view.players[s] === api.getClientId() ? ' (you)' : ''}`;
      label.style.color = SEAT_COLOR[s];
      const sc = document.createElement('span');
      sc.className = 'sb-score';
      sc.textContent = String(view.score ? view.score[s] : 0);
      sc.title = 'Battles won';
      box.append(flag, label, sc);
      if (view.phase === 'placing' && view.players[s]) {
        const b = document.createElement('span');
        b.className = `sb-badge ${view.ready[s] ? 'ok' : 'wait'}`;
        b.textContent = view.ready[s] ? 'READY' : 'PLACING…';
        box.appendChild(b);
      }
      if (!view.players[s]) {
        if (!seat) {
          const btn = document.createElement('button');
          btn.textContent = 'TAKE SEAT';
          btn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: s }));
          box.appendChild(btn);
        }
        if (view.players[other(s)] !== 'BOT') {
          const botBtn = document.createElement('button');
          botBtn.textContent = 'PLAY VS BOT';
          botBtn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: s, bot: true, level: preferredLevel() }));
          box.append(botBtn, levelSelect(preferredLevel()));
        }
      } else if (view.players[s] === 'BOT') {
        const rm = document.createElement('button');
        rm.textContent = 'REMOVE BOT';
        rm.addEventListener('click', () => api.sendAction({ kind: 'removeBot', seat: s }));
        box.append(levelSelect((view.botLevels || {})[s], (level) => api.sendAction({ kind: 'setBotLevel', seat: s, level })), rm);
      }
      seats.appendChild(box);
    }
    if (seat) {
      const leave = document.createElement('button');
      leave.textContent = 'LEAVE SEAT';
      leave.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seats.appendChild(leave);
    }
    return seats;
  }

  function statusEl() {
    const status = document.createElement('div');
    status.className = 'sb-status';
    const seat = mySeat();
    if (view.phase === 'waiting') {
      status.textContent = 'Waiting for two admirals. Take a seat or play the bot.';
    } else if (view.phase === 'placing') {
      if (seat && !view.ready[seat]) { status.textContent = 'POSITION YOUR FLEET'; status.classList.add('mine'); }
      else if (seat) status.textContent = `Fleet locked in. Waiting for ${seatName(other(seat))}…`;
      else status.textContent = 'The admirals are positioning their fleets…';
    } else if (view.phase === 'playing') {
      const ls = view.lastShot;
      if (myTurn()) {
        status.textContent = ls && ls.by === seat && ls.result !== 'miss' ? 'DIRECT HIT. FIRE AGAIN' : 'YOUR TURN. FIRE';
        status.classList.add('mine');
      } else if (seat) {
        status.textContent = ls && ls.by !== seat && ls.result !== 'miss' ? `${seatName(view.turn)} hit you. Firing again…` : `${seatName(view.turn)} is taking aim…`;
        if (ls && ls.by !== seat && ls.result !== 'miss') status.classList.add('alert');
      } else {
        status.textContent = `${seatName(view.turn)} to fire`;
      }
    } else {
      status.textContent = `${seatName(view.winner).toUpperCase()} SANK THE ENEMY FLEET`;
      status.style.color = '#ffd23f';
    }
    return status;
  }

  function shotSummary(s) {
    const g = view.shots[s];
    let hits = 0;
    let total = 0;
    for (const row of g) for (const v of row) { if (v) total++; if (v === 'hit') hits++; }
    return total ? `${total} shots · ${Math.round((hits / total) * 100)}% hit` : '';
  }

  // The newest action aimed at `boardOwner`'s board: its cells (one shot or a barrage line) and
  // whether it should animate now.
  function lastFor(boardOwner) {
    const ls = view.lastShot;
    if (!ls || ls.by === boardOwner || ls.power === 'radar') return null;
    const cells = new Set(ls.power === 'barrage' ? ls.cells.map((x) => x.r * N + x.c) : [ls.r * N + ls.c]);
    return { cells, fresh: `${view.roundId}:${ls.n}` === freshKey };
  }

  // Radar scans made by `shooter` (drawn on the board they scanned); the newest one sweeps.
  function scansBy(shooter) {
    const ls = view.lastShot;
    const list = (view.radarAreas && view.radarAreas[shooter]) || [];
    return list.map((a, k) => ({ ...a, fresh: k === list.length - 1 && ls && ls.power === 'radar' && ls.by === shooter && `${view.roundId}:${ls.n}` === freshKey }));
  }

  // Ships of mine the newest enemy action struck, by id.
  function struckMine() {
    const ls = view.lastShot;
    const seat = mySeat();
    const fleet = seat && view.fleets[seat];
    if (!ls || !fleet || ls.by === seat || ls.power === 'radar') return new Set();
    const cells = ls.power === 'barrage' ? ls.cells : [ls];
    const out = new Set();
    for (const x of cells) {
      if (x.result === 'miss') continue;
      const ship = fleet.find((s) => shipCells(s, lens()[s.id]).some(([r, c]) => r === x.r && c === x.c));
      if (ship) out.add(ship.id);
    }
    return out;
  }

  // One line describing the newest action, from this viewer's side.
  function callout() {
    const ls = view.lastShot;
    if (!ls || (view.phase !== 'playing' && view.phase !== 'game_over')) return null;
    const seat = mySeat();
    const mine = seat && ls.by === seat;
    const who = mine ? 'You' : seatName(ls.by);
    const shipName = (id) => (spec().find((s) => s.id === id) || { name: id }).name;
    const struck = !mine && seat ? [...struckMine()].map(shipName) : [];
    const yours = !mine && seat;
    const target = yours ? 'your' : mine ? 'the enemy' : `${seatName(other(ls.by))}'s`;
    if (ls.power === 'radar') {
      if (mine) {
        const g = view.radar && view.radar[seat];
        let n = 0;
        if (g) for (let r = ls.r; r < ls.r + 2; r++) for (let c = ls.c; c < ls.c + 2; c++) if (g[r][c] === 'ship') n++;
        return { text: `Radar at ${cellName(ls.r, ls.c)}: ${n ? `${n} ship cell${n > 1 ? 's' : ''} found.` : 'all clear'}`, cls: n ? 'good' : '' };
      }
      return { text: `${who} scanned ${target} waters at ${cellName(ls.r, ls.c)}–${cellName(ls.r + 1, ls.c + 1)}`, cls: yours ? 'bad' : '' };
    }
    if (ls.power === 'barrage') {
      const hits = ls.cells.filter((x) => x.result !== 'miss').length;
      const sunk = ls.cells.filter((x) => x.result === 'sunk').map((x) => shipName(x.ship));
      const line = ls.axis === 'row' ? `row ${ls.i + 1}` : `column ${COLS[ls.i]}`;
      let text = `${who === 'You' ? 'Your' : `${who}'s`} BARRAGE on ${line}: ${hits ? `${hits} hit${hits > 1 ? 's' : ''}` : 'all misses'}`;
      if (struck.length) text += ` · struck your ${struck.join(', ')}`;
      if (sunk.length) text += ` · ${sunk.join(', ')} sunk.`;
      return { text, cls: hits ? (yours ? 'bad' : 'good') : '' };
    }
    const at = cellName(ls.r, ls.c);
    if (ls.result === 'miss') return { text: `${who} missed at ${at}`, cls: '' };
    if (yours) {
      const name = struck[0] || 'ship';
      return { text: ls.result === 'sunk' ? `${who} SANK your ${name}! (${at})` : `${who} hit your ${name} at ${at}!`, cls: 'bad' };
    }
    if (ls.result === 'sunk') return { text: `${who} sank ${mine ? 'their' : target} ${shipName(ls.ship)}! (${at})`, cls: mine ? 'good' : '' };
    return { text: `${who} hit at ${at}!`, cls: mine ? 'good' : '' };
  }

  // ---- powers ----------------------------------------------------------------------------------
  function flipAxis() {
    if (!armed) return;
    armed.axis = armed.axis === 'row' ? 'col' : 'row';
    pvAnchor = null;
    sfx.play('swap');
    render();
  }

  // The cells (and server message) a power aimed at hovered cell (r, c) covers.
  function aimAt(r, c) {
    if (armed.power === 'barrage') {
      const i = armed.axis === 'row' ? r : c;
      const cells = Array.from({ length: N }, (_, k) => (armed.axis === 'row' ? [i, k] : [k, i]));
      return { cells, msg: { kind: 'power', power: 'barrage', axis: armed.axis, i }, key: `b${armed.axis}${i}` };
    }
    const r0 = Math.min(r, N - 2);
    const c0 = Math.min(c, N - 2);
    return { cells: [[r0, c0], [r0, c0 + 1], [r0 + 1, c0], [r0 + 1, c0 + 1]], msg: { kind: 'power', power: 'radar', r: r0, c: c0 }, key: `r${r0},${c0}` };
  }

  // Hover preview: toggles classes on existing cells only (never rebuilds under the pointer).
  function attachAim(grid) {
    const cellEls = [...grid.querySelectorAll('.sb-cell')];
    let shown = null;
    const show = (aim) => {
      const key = aim ? aim.key : null;
      if (key === shown) return;
      shown = key;
      for (const el of cellEls) el.classList.remove('pv');
      if (aim) for (const [r, c] of aim.cells) cellEls[r * N + c].classList.add('pv');
    };
    grid.addEventListener('pointermove', (e) => {
      if (!armed || e.pointerType !== 'mouse') return;
      const cell = cellFromEvent(grid, e);
      show(cell && cell.r >= 0 && cell.r < N && cell.c >= 0 && cell.c < N ? aimAt(cell.r, cell.c) : null);
    });
    grid.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') show(null); });
    grid.addEventListener('pointerdown', (e) => {
      if (!armed || e.pointerType === 'mouse') return;
      const cell = cellFromEvent(grid, e);
      if (cell) show(aimAt(cell.r, cell.c));
    });
    return (r, c) => {
      const aim = aimAt(r, c);
      // Mouse users saw the preview on hover; touch users confirm with a second tap on the same target.
      if (lastPointer !== 'mouse' && pvAnchor !== aim.key) { pvAnchor = aim.key; show(aim); sfx.play('tick'); return; }
      pvAnchor = null;
      sfx.play('click');
      api.sendAction(aim.msg);
    };
  }
  let lastPointer = 'mouse';
  root.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; }, true);

  function powersBar() {
    const seat = mySeat();
    const bar = document.createElement('div');
    bar.className = 'sb-powers';
    const left = view.powerLeft || {};
    const ps = view.powerSpec || {};
    const label = (s, p) => (left[s][p] ? `${left[s][p]} turn${left[s][p] > 1 ? 's' : ''}` : 'READY');
    if (seat && view.phase === 'playing') {
      for (const p of Object.keys(ps)) {
        const isArmed = armed && armed.power === p;
        const b = button(`${ps[p].name.toUpperCase()} · ${isArmed ? 'AIMING' : label(seat, p)}`, () => {
          if (!myTurn()) return showError('not_your_turn');
          if (left[seat][p]) return showError('power_cooldown');
          armed = isArmed ? null : { power: p, axis: (armed && armed.axis) || 'row' };
          pvAnchor = null;
          sfx.play('select');
          render();
        });
        b.disabled = !myTurn() || left[seat][p] > 0;
        b.title = p === 'barrage' ? 'Fire at every cell of one row or column (ends your turn)' : 'Learn which cells of a 2×2 area hold a ship (ends your turn)';
        if (isArmed) b.classList.add('armed');
        bar.appendChild(b);
      }
      if (armed) {
        if (armed.power === 'barrage') bar.appendChild(button(armed.axis === 'row' ? '↔ ROW (R)' : '↕ COLUMN (R)', flipAxis));
        bar.appendChild(button('CANCEL', () => { armed = null; render(); }));
      }
    }
    const foes = seat ? [other(seat)] : ['p1', 'p2'];
    for (const s of foes) {
      const t = document.createElement('span');
      t.className = 'foe';
      t.textContent = `${seat ? 'Enemy' : seatName(s)}: ${Object.keys(ps).map((p) => `${ps[p].name} ${label(s, p)}`).join(' · ')}`;
      bar.appendChild(t);
    }
    return bar;
  }

  // Pre-game rule toggle (any seated admiral; everyone sees it).
  function rulesEl() {
    const box = document.createElement('div');
    box.className = 'sb-rules';
    const on = !!view.powers;
    if (mySeat()) {
      const b = button(`POWERS: ${on ? 'ON' : 'OFF'}`, () => { sfx.play('click'); api.sendAction({ kind: 'setPowers', on: !on }); });
      if (on) b.classList.add('on');
      b.title = 'Barrage (a whole row/column) and Radar (2×2 scan) on long cooldowns';
      box.appendChild(b);
    } else {
      const t = document.createElement('b');
      t.textContent = `POWERS: ${on ? 'ON' : 'OFF'}`;
      t.style.color = on ? '#ffb000' : '#8aa';
      box.appendChild(t);
    }
    const note = document.createElement('span');
    note.style.opacity = '.7';
    const ps = view.powerSpec || {};
    note.textContent = on && ps.barrage
      ? `Barrage from your turn ${ps.barrage.first} (then every ${ps.barrage.cooldown}) · Radar from turn ${ps.radar.first} (then every ${ps.radar.cooldown})`
      : 'Classic rules';
    box.appendChild(note);
    return box;
  }

  function render() {
    if (drag) { pendingRender = true; return; }
    // The newest shot animates once; later re-renders (roster, errors) must not replay it.
    if (freshKey) { const k = freshKey; setTimeout(() => { if (freshKey === k) freshKey = null; }, 0); }
    results.update(view && view.phase === 'game_over' ? resultsOpts() : null);
    root.innerHTML = '';
    if (!view) { root.textContent = 'Loading…'; return; }
    ensureDraft();
    const seat = mySeat();
    if (!myTurn()) { armed = null; pvAnchor = null; }
    root.append(statusEl(), renderSeats());
    if (view.phase === 'waiting' || view.phase === 'placing') root.appendChild(rulesEl());
    const co = callout();
    if (co) {
      const el = document.createElement('div');
      el.className = `sb-callout ${co.cls}${freshKey ? ' fresh' : ''}`;
      el.textContent = co.text;
      root.appendChild(el);
    }
    if (view.powers && view.phase === 'playing') root.appendChild(powersBar());
    const err = document.createElement('div');
    err.className = 'sb-err';
    err.textContent = flashError ? (REJECT_MESSAGES[flashError] || 'Move rejected') : '';
    root.appendChild(err);

    const boards = document.createElement('div');
    boards.className = 'sb-boards';
    root.appendChild(boards);

    if (view.phase === 'waiting') {
      const { frame } = buildBoard({ shots: null, ships: [], dim: true });
      boards.appendChild(panel('<b>OPEN WATERS</b>', '', frame));
      root.appendChild(hint('Each admiral hides five ships (5, 4, 3, 3, 2) on a 10×10 grid, then you take turns firing. Hit a ship and you shoot again. Sink the whole enemy fleet to win. Turn POWERS on for Barrage (a whole row or column) and Radar (2×2 scan) on long cooldowns.'));
      return;
    }

    if (view.phase === 'placing' && seat && !view.ready[seat]) {
      const ships = draft.map((s) => ({ ship: s, cls: `drag${selected === s.id ? ' selected' : ''}` }));
      const { frame, grid } = buildBoard({ shots: null, ships });
      attachDrag(grid);
      const tools = document.createElement('div');
      tools.className = 'sb-tools';
      const rot = button('ROTATE (R)', () => (selected ? rotate(selected) : showError('no_room')));
      rot.disabled = !selected;
      const rnd = button('RANDOMIZE', () => { draft = randomFleet(spec()); selected = null; sfx.play('whoosh'); render(); });
      const go = button('READY', () => { sfx.play('click'); api.sendAction({ kind: 'placeFleet', ships: draft }); });
      go.className = 'go';
      tools.append(rot, rnd, go);
      boards.appendChild(panel('<b>YOUR FLEET</b>', 'drag to move · tap twice to rotate', frame, tools));
      root.appendChild(hint('Drag ships to move them. Tap a ship to select it, then tap it again (or press R) to rotate. Ships may touch. Hit READY when you are happy.'));
      return;
    }

    if (view.phase === 'placing') {
      if (seat) {
        const ships = (view.fleets[seat] || []).map((s) => ({ ship: s, cls: '' }));
        const { frame } = buildBoard({ shots: null, ships });
        const tools = document.createElement('div');
        tools.className = 'sb-tools';
        tools.appendChild(button('EDIT FLEET', () => api.sendAction({ kind: 'unready' })));
        boards.appendChild(panel('<b>YOUR FLEET</b>', 'locked in', frame, tools));
      } else {
        for (const s of ['p1', 'p2']) {
          const { frame } = buildBoard({ shots: null, ships: [], dim: true });
          boards.appendChild(panel(`<b style="color:${SEAT_COLOR[s]}">${esc(seatName(s))}</b>'S WATERS`, view.ready[s] ? 'ready' : 'placing…', frame, null, true));
        }
      }
      return;
    }

    // playing / game_over
    const over = view.phase === 'game_over';
    if (seat) {
      const foe = other(seat);
      const enemyShips = (over && view.fleets[foe] ? view.fleets[foe] : view.sunk[seat])
        .map((s) => ({ ship: s, cls: `enemy${view.sunk[seat].some((x) => x.id === s.id) ? ' sunk' : ''}` }));
      let aim = null;
      const target = buildBoard({
        shots: view.shots[seat], ships: enemyShips, target: myTurn(), sunkCells: sunkCellSet(view.sunk[seat]), last: lastFor(foe),
        radar: view.radar && view.radar[seat], scans: scansBy(seat),
        onCell: (r, c, shot) => {
          if (view.phase !== 'playing') return;
          if (!myTurn()) return showError('not_your_turn');
          if (armed && aim) return aim(r, c);
          if (shot) return showError('already_shot');
          api.sendAction({ kind: 'fire', r, c });
        },
      });
      if (armed) target.grid.classList.add('armed');
      if (view.powers && !over) aim = attachAim(target.grid);
      boards.appendChild(panel(`<b>ENEMY WATERS</b>. ${esc(seatName(foe))}`, shotSummary(seat), target.frame, fleetList(view.sunk[seat], 'ENEMY:')));
      const myFleet = view.fleets[seat] || [];
      const hitAt = (r, c) => view.shots[foe][r][c] === 'hit';
      const mine = myFleet.map((s) => ({
        ship: s,
        cls: view.sunk[foe].some((x) => x.id === s.id) ? 'sunk' : shipCells(s, lens()[s.id]).some(([r, c]) => hitAt(r, c)) ? 'damaged' : '',
      }));
      const home = buildBoard({ shots: view.shots[foe], ships: mine, sunkCells: sunkCellSet(view.sunk[foe]), last: lastFor(seat), dim: myTurn() && !armed, scans: scansBy(foe) });
      boards.appendChild(panel('<b>YOUR FLEET</b>', shotSummary(foe), home.frame, fleetList(view.sunk[foe], 'YOURS:', myFleet, view.shots[foe], struckMine()), true));
    } else {
      for (const s of ['p1', 'p2']) {
        const shooter = other(s);
        const ships = (over && view.fleets[s] ? view.fleets[s] : view.sunk[shooter])
          .map((x) => ({ ship: x, cls: view.sunk[shooter].some((y) => y.id === x.id) ? 'sunk' : '' }));
        const b = buildBoard({ shots: view.shots[shooter], ships, sunkCells: sunkCellSet(view.sunk[shooter]), last: lastFor(s), scans: scansBy(shooter), radar: over && view.radar ? view.radar[shooter] : null });
        boards.appendChild(panel(`<b style="color:${SEAT_COLOR[s]}">${esc(seatName(s))}</b>'S FLEET`, shotSummary(shooter), b.frame, fleetList(view.sunk[shooter], 'SUNK:'), true));
      }
    }
    if (over && seat) {
      const tools = document.createElement('div');
      tools.className = 'sb-tools';
      tools.appendChild(button('REMATCH', () => api.sendAction({ kind: 'resetGame' })));
      root.appendChild(tools);
    } else if (!over) {
      root.appendChild(hint(armed
        ? (armed.power === 'barrage' ? 'BARRAGE: pick a row or column on the enemy grid (R flips). Fires at every unshot cell, then your turn ends.' : 'RADAR: pick a 2×2 area on the enemy grid. Green blips = ship, dots = clear. Ends your turn.')
          + (lastPointer !== 'mouse' ? ' Tap once to preview, tap again to fire.' : ' Esc cancels.')
        : 'Hit = fire again. Miss = their turn. Sunk ships are revealed.' + (view.powers ? ' Using a power ends your turn.' : '')));
    }
  }

  function resultsOpts() {
    const seat = mySeat();
    const w = view.winner;
    const order = [w, other(w)];
    return {
      title: seat ? (seat === w ? 'VICTORY AT SEA' : 'YOUR FLEET IS SUNK') : `${seatName(w).toUpperCase()} WINS`,
      subtitle: `${view.shotCount[w]} shots to sink the fleet`,
      outcome: seat ? (seat === w ? 'win' : 'lose') : 'over',
      rows: order.map((s) => ({ name: seatName(s), value: `${view.sunk[s].length}/5 sunk`, win: s === w, you: s === seat })),
      rematch: seat ? { label: 'REMATCH', onClick: () => api.sendAction({ kind: 'resetGame' }) } : null,
    };
  }

  function button(text, fn) {
    const b = document.createElement('button');
    b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  }
  function hint(text) {
    const h = document.createElement('div');
    h.className = 'sb-hint';
    h.textContent = text;
    return h;
  }

  function shotSounds(prev, next) {
    if (!prev || !next) return;
    const seat = next.mySeat;
    if (next.phase === 'game_over' && prev.phase !== 'game_over') {
      sfx.play(!seat ? 'point' : next.winner === seat ? 'win' : 'lose');
      return;
    }
    if (prev.phase === 'placing' && next.phase === 'playing') sfx.play('go');
    const a = prev.lastShot;
    const b = next.lastShot;
    if (b && (!a || a.n !== b.n || prev.roundId !== next.roundId)) {
      if (b.power === 'radar') sfx.play('whoosh');
      else if (b.result === 'miss') sfx.play('pop');
      else if (b.result === 'hit') sfx.play(b.by === seat || !seat ? 'crash' : 'hurt');
      else sfx.play('kill');
    }
    if (next.phase === 'playing' && seat && next.turn === seat && prev.turn !== seat) setTimeout(() => sfx.play('turn'), 220);
  }

  function setView(next, animate) {
    const ls = next.lastShot;
    const key = ls ? `${next.roundId}:${ls.n}` : null;
    const prevKey = view && view.lastShot ? `${view.roundId}:${view.lastShot.n}` : null;
    freshKey = animate && key && key !== prevKey ? key : null;
    view = next;
  }

  render();

  return {
    applySnapshot(snapshot) {
      setView(snapshot, false);
      render();
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        const prev = view;
        setView(data, true);
        shotSounds(prev, data);
        flashError = null;
        render();
      } else if (data.kind === 'moveRejected') {
        showError(data.reason);
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      render();
    },
    unmount() {
      window.removeEventListener('keydown', onKey);
      clearTimeout(flashTimer);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
