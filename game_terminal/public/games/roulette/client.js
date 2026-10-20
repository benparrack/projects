// Roulette — one European wheel shared by the room. Click a chip, then click the felt to bet;
// the first chip starts a 20s countdown. Server plugin: ../../../server/games/roulette.js

import { sfx } from '../sfx.js';
import { makeServerClock } from '../serverClock.js';

const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? 'g' : REDS.has(n) ? 'r' : 'b');
const money = (n) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const CELL = 46; // px per number on the wheel strip
const REJECT = {
  broke: 'Not enough in your casino balance. Claim the daily stipend or work a shift in the CASINO menu.',
  spot_max: 'That spot is at the $100 limit.',
  round_max: "You're at the $500 limit for this spin.",
  not_betting: 'No more bets: the wheel is spinning.',
  wallet_loading: 'Opening your casino balance… try again in a second.',
  nothing: 'No bets to do that with.',
};

const CSS = `
.rl-root { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 6px; }
.rl-strip { position: relative; width: min(100%, 560px); height: 58px; overflow: hidden; border: 2px solid #c9a24a; border-radius: 8px; background: #111; }
.rl-strip::after { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #ffd23f; box-shadow: 0 0 8px #ffd23f; }
.rl-track { position: absolute; top: 6px; left: 50%; display: flex; will-change: transform; }
.rl-n { width: ${CELL - 4}px; height: 42px; margin: 0 2px; display: flex; align-items: center; justify-content: center; border-radius: 4px; font-weight: bold; color: #fff; font-family: Georgia, serif; }
.rl-n.r { background: #c0262d; } .rl-n.b { background: #1c1c1c; border: 1px solid #333; } .rl-n.g { background: #12813a; }
.rl-hist { display: flex; gap: 4px; min-height: 26px; flex-wrap: wrap; justify-content: center; }
.rl-hist .rl-n { width: 26px; height: 24px; font-size: .75em; margin: 0; }
.rl-status { min-height: 1.5em; font-size: 1.15em; text-align: center; }
.rl-status.win { color: #ffbf00; }
.rl-timer { width: min(100%, 560px); height: 3px; background: rgba(255,255,255,.12); }
.rl-timer > div { height: 100%; background: #ffd23f; transition: width .25s linear; }
.rl-felt { display: grid; grid-template-columns: 40px repeat(12, minmax(26px, 40px)) 44px; gap: 2px; padding: 10px; border-radius: 10px; background: radial-gradient(ellipse at center, #1b7a3a, #0d4a22); border: 3px solid #5a3a12; user-select: none; max-width: 100%; }
.rl-spot { position: relative; min-height: 38px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,.55); color: #fff; font-family: Georgia, serif; font-weight: bold; cursor: pointer; font-size: .9em; }
.rl-spot.r { background: #b3262c; } .rl-spot.b { background: #1a1a1a; } .rl-spot.g { background: #12813a; }
.rl-spot:hover { outline: 2px solid #ffd23f; z-index: 1; }
.rl-spot.hit { outline: 3px solid #ffd23f; box-shadow: 0 0 14px #ffd23f; z-index: 2; }
.rl-spot.closed { cursor: default; }
.rl-chip { position: absolute; right: -4px; bottom: -4px; min-width: 22px; height: 22px; border-radius: 50%; font-size: .6em; display: flex; align-items: center; justify-content: center; background: #2f9e44; color: #fff; border: 2px dashed #fff; box-shadow: 0 1px 3px #000; z-index: 3; padding: 0 2px; }
.rl-chip.mine { background: #ffbf00; color: #000; border-color: #000; }
.rl-chips { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: center; }
.rl-pick { width: 40px; height: 40px; border-radius: 50%; padding: 0; font-weight: bold; border: 3px dashed #fff; color: #fff; }
.rl-pick.c1 { background: #ddd; color: #111; border-color: #888; } .rl-pick.c2 { background: #e8b923; color: #111; } .rl-pick.c5 { background: #e04848; }
.rl-pick.c10 { background: #2a6fdb; } .rl-pick.c25 { background: #2f9e44; } .rl-pick.c50 { background: #f08c00; } .rl-pick.c100 { background: #222; }
.rl-pick[aria-pressed="true"] { transform: translateY(-4px); box-shadow: 0 0 0 3px #ffd23f; }
.rl-players { font-size: .85em; width: min(100%, 560px); }
@media (max-width: 560px) {
  .rl-felt { grid-template-columns: 26px repeat(12, minmax(0, 1fr)) 30px; padding: 6px; gap: 1px; width: 100%; box-sizing: border-box; }
  .rl-spot { min-height: 32px; font-size: .68em; }
  .rl-chip { min-width: 16px; height: 16px; font-size: .5em; right: -3px; bottom: -3px; }
}
.rl-players li { display: flex; justify-content: space-between; }
`;

export function mount(container, api) {
  let view = null;
  let roster = [];
  let chip = 5;
  let spunFor = null; // result object already animated
  let landed = true; // the strip has stopped on the current result
  const clock = makeServerClock();
  const strip = WHEEL.concat(WHEEL, WHEEL, WHEEL, WHEEL, WHEEL); // long enough for a few laps
  let stripPos = WHEEL.length * 2 * CELL; // centre of number index i is at i*CELL + CELL/2

  const style = document.createElement('style');
  style.textContent = CSS;
  const root = document.createElement('div');
  root.className = 'rl-root';
  container.append(style, root);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const name = (id) => (roster.find((r) => r.clientId === id) || {}).nickname || 'someone';

  const stripBox = el('div', 'rl-strip');
  const track = el('div', 'rl-track');
  for (const n of strip) track.appendChild(el('div', `rl-n ${colorOf(n)}`, String(n)));
  stripBox.appendChild(track);
  const hist = el('div', 'rl-hist');
  const status = el('div', 'rl-status');
  const timer = el('div', 'rl-timer');
  const timerBar = el('div');
  timer.appendChild(timerBar);
  const felt = el('div', 'rl-felt');
  const chipsRow = el('div', 'rl-chips');
  const balance = el('div', 'casino-balance');
  const players = el('ul', 'rl-players');
  root.append(stripBox, hist, status, timer, felt, chipsRow, balance, players);

  const place = (px, animate) => {
    track.style.transition = animate ? 'transform 5.6s cubic-bezier(.12,.6,.15,1)' : 'none';
    track.style.transform = `translateX(${-px}px)`;
  };
  place(stripPos + CELL / 2, false);

  // The felt: 0 down the left, numbers 3 rows x 12, columns at the right, dozens and evens below.
  const spots = new Map();
  function spot(key, label, cls, gridArea) {
    const s = el('div', `rl-spot ${cls || ''}`, label);
    s.style.gridArea = gridArea;
    s.addEventListener('click', () => {
      if (!view || view.phase !== 'betting') return;
      sfx.play('chips');
      api.sendAction({ kind: 'bet', spot: key, amount: chip });
    });
    spots.set(key, s);
    felt.appendChild(s);
  }
  spot('n:0', '0', 'g', '1 / 1 / 4 / 2');
  for (let n = 1; n <= 36; n++) {
    const col = Math.ceil(n / 3) + 1;
    const row = 3 - ((n - 1) % 3);
    spot(`n:${n}`, String(n), colorOf(n), `${row} / ${col} / ${row + 1} / ${col + 1}`);
  }
  ['c3', 'c2', 'c1'].forEach((k, i) => spot(k, '2:1', '', `${i + 1} / 14 / ${i + 2} / 15`));
  ['d1', 'd2', 'd3'].forEach((k, i) => spot(k, ['1st 12', '2nd 12', '3rd 12'][i], '', `4 / ${2 + i * 4} / 5 / ${6 + i * 4}`));
  [['low', '1-18'], ['even', 'EVEN'], ['red', '◆', 'r'], ['black', '◆', 'b'], ['odd', 'ODD'], ['high', '19-36']]
    .forEach(([k, label, cls], i) => spot(k, label, cls, `5 / ${2 + i * 2} / 6 / ${4 + i * 2}`));

  function button(text, kind) {
    const b = el('button', null, text);
    b.type = 'button';
    b.addEventListener('click', () => { sfx.play('click'); api.sendAction({ kind }); });
    return b;
  }

  function spinTo(n) {
    // Rewind to the same number on lap 2 (no animation), then land on n at least two laps on.
    // Searching from wherever the last spin stopped ran off the end of the strip and looped forever.
    const cur = (Math.round(stripPos / CELL) % WHEEL.length) + WHEEL.length;
    place(cur * CELL + CELL / 2, false);
    void track.offsetWidth;
    let target = cur + WHEEL.length * 2;
    while (strip[target] !== n) target++;
    stripPos = target * CELL;
    landed = false;
    place(stripPos + CELL / 2, true);
    sfx.play('dice');
  }

  function render() {
    if (!view) { status.textContent = 'Loading…'; return; }
    const me = api.getClientId();
    const betting = view.phase === 'betting';
    const r = view.result;
    const showResult = r && (view.phase === 'result' || landed);

    hist.replaceChildren(...view.history.map((n) => el('div', `rl-n ${colorOf(n)}`, String(n))));
    const mine = view.bets[me] || [];
    const myStake = mine.reduce((a, b) => a + b.amount, 0);
    let bal = view.balances[me] || 0;
    if (r && !showResult && r.payouts[me]) bal -= r.payouts[me].won; // don't spoil the spin
    balance.textContent = `BALANCE ${money(bal)}${myStake ? ` · ${money(myStake)} on the felt` : ''}`;

    if (betting) {
      const secs = view.deadline ? Math.max(0, Math.ceil((view.deadline - clock.now()) / 1000)) : null;
      status.className = 'rl-status';
      status.textContent = secs == null ? 'Place your bets. The first chip starts the clock.' : `Place your bets: ${secs}s`;
    } else if (!showResult) {
      status.className = 'rl-status';
      status.textContent = 'No more bets…';
    } else {
      const p = r.payouts[me];
      const label = `${r.n} ${r.n === 0 ? 'GREEN' : REDS.has(r.n) ? 'RED' : 'BLACK'}`;
      status.className = `rl-status${p && p.won ? ' win' : ''}`;
      status.textContent = p ? (p.won ? `${label}: you win ${money(p.won)}!` : `${label}: no luck this time.`) : label;
    }
    const left = view.deadline && betting ? Math.max(0, (view.deadline - clock.now()) / 20000) : 0;
    timerBar.style.width = `${Math.min(1, left) * 100}%`;

    const totals = new Map();
    for (const [id, bets] of Object.entries(view.bets)) for (const b of bets) {
      const t = totals.get(b.spot) || { all: 0, mine: 0 };
      t.all += b.amount;
      if (id === me) t.mine += b.amount;
      totals.set(b.spot, t);
    }
    for (const [key, s] of spots) {
      s.querySelector('.rl-chip')?.remove();
      s.classList.toggle('closed', !betting);
      s.classList.toggle('hit', !!(showResult && key === `n:${r.n}`));
      const t = totals.get(key);
      if (t) s.appendChild(el('span', `rl-chip${t.mine ? ' mine' : ''}`, t.all >= 1000 ? `${Math.round(t.all / 100) / 10}k` : String(t.all)));
    }

    chipsRow.replaceChildren();
    for (const c of view.chips) {
      const b = el('button', `rl-pick c${c}`, String(c));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(c === chip));
      b.addEventListener('click', () => { chip = c; sfx.play('click'); render(); });
      chipsRow.appendChild(b);
    }
    if (betting) {
      if (mine.length) chipsRow.append(button('CLEAR', 'clear'), view.ready[me] ? el('span', 'muted', 'ready') : button('DONE', 'ready'));
      else if (view.rebet.includes(me)) chipsRow.append(button('REBET', 'rebet'));
    }

    players.replaceChildren();
    const ids = new Set([...roster.map((x) => x.clientId), ...Object.keys(view.bets)]);
    for (const id of ids) {
      const stake = (view.bets[id] || []).reduce((a, b) => a + b.amount, 0);
      const p = showResult && r.payouts[id];
      const right = p ? (p.won ? `won ${money(p.won)}` : `lost ${money(p.staked)}`) : stake ? `${money(stake)} down${view.ready[id] ? ' ✓' : ''}` : '';
      players.appendChild(el('li', id === me ? '' : 'muted')).append(el('span', null, `${name(id)}${id === me ? ' (you)' : ''}`), el('span', null, right));
    }
  }

  function apply(data) {
    clock.sync(data.now);
    view = data;
    if (view.result && view.result !== spunFor && view.phase === 'spinning') {
      spunFor = view.result;
      spinTo(view.result.n);
    } else if (view.phase !== 'spinning') landed = true;
    render();
  }

  track.addEventListener('transitionend', () => {
    landed = true;
    const r = view && view.result;
    if (r && r.payouts[api.getClientId()]) sfx.play(r.payouts[api.getClientId()].won ? 'win' : 'lose');
    render();
  });
  const ticker = setInterval(() => { if (view && view.phase === 'betting' && view.deadline) render(); }, 500);

  render();

  return {
    applySnapshot(s) { apply(s); },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        // A fresh state object each time: keep the same result identity so the spin isn't replayed.
        if (spunFor && data.result && data.result.n === spunFor.n && view && view.result) data.result = spunFor;
        apply(data);
      } else if (data.kind === 'moveRejected') { sfx.play('error'); status.className = 'rl-status'; status.textContent = REJECT[data.reason] || data.reason; }
    },
    applyRoster(r) { roster = r; render(); },
    unmount() { clearInterval(ticker); container.innerHTML = ''; },
  };
}
