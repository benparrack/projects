// Slots — your own 3-reel machine, one pay line, played from your casino balance. Three diamonds
// win the site-wide progressive jackpot. Server plugin: ../../../server/games/slots.js

import { sfx } from '../sfx.js';

const GLYPH = { CH: '🍒', LE: '🍋', BE: '🔔', BA: 'BAR', SE: '7', JP: '◆', BL: '·' };
const ORDER = ['CH', 'LE', 'BE', 'BA', 'SE', 'JP', 'BL'];
const PAYTABLE = [['JP', 'JACKPOT'], ['SE', '100x'], ['BA', '40x'], ['BE', '20x'], ['LE', '10x'], ['CH', '10x']];
const money = (n) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const REJECT = {
  broke: "Not enough in your casino balance for that bet. Claim the daily stipend or work a shift in the CASINO menu.",
  too_fast: 'Let the reels stop first.',
  wallet_loading: 'Opening your casino balance… try again in a second.',
};

const CSS = `
.sl-root { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 8px; }
.sl-jackpot { text-align: center; color: #ffbf00; letter-spacing: .1em; }
.sl-jackpot b { display: block; font-size: 2em; text-shadow: 0 0 12px rgba(255,191,0,.6); }
.sl-machine { border: 2px solid #ffbf00; border-radius: 12px; padding: 14px; background: linear-gradient(180deg, #1a1200, #050400); box-shadow: 0 0 24px rgba(255,191,0,.15); }
.sl-reels { display: flex; gap: 10px; position: relative; }
.sl-reels::after { content: ''; position: absolute; left: -6px; right: -6px; top: 50%; border-top: 2px solid rgba(255,60,60,.7); pointer-events: none; }
.sl-reel { width: 84px; height: 192px; overflow: hidden; background: #f4f0e4; border-radius: 6px; box-shadow: inset 0 12px 14px rgba(0,0,0,.45), inset 0 -12px 14px rgba(0,0,0,.45); }
.sl-sym { height: 64px; display: flex; align-items: center; justify-content: center; font-size: 40px; font-weight: bold; color: #222; font-family: Georgia, serif; }
.sl-sym.SE { color: #d01818; font-size: 46px; } .sl-sym.BA { font-size: 22px; letter-spacing: .05em; background: linear-gradient(#222,#222) center/70% 34% no-repeat; color: #f4f0e4; }
.sl-sym.JP { color: #0a9bd6; font-size: 48px; } .sl-sym.BL { color: #aaa; }
.sl-reel.spin .sl-sym { filter: blur(1.5px); }
.sl-line { min-height: 1.6em; font-size: 1.3em; text-align: center; }
.sl-line.win { color: #ffbf00; animation: sl-pulse .5s 3; }
.sl-line.jackpot { color: #39ff14; font-size: 1.8em; animation: sl-pulse .4s 10; }
@keyframes sl-pulse { 50% { transform: scale(1.12); } }
.sl-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; }
.sl-bet[aria-pressed="true"] { background: #ffbf00; color: #000; }
.sl-spin { font-size: 1.3em; padding: 8px 28px; border-color: #ffbf00; color: #ffbf00; }
.sl-pay { display: grid; grid-template-columns: auto auto; gap: 2px 14px; font-size: .85em; }
.sl-pay span:nth-child(even) { color: #ffbf00; text-align: right; }
.sl-others { font-size: .85em; width: 100%; max-width: 420px; }
.sl-others li { display: flex; justify-content: space-between; gap: 8px; }
`;

export function mount(container, api) {
  let view = null;
  let roster = [];
  let bet = 1;
  let shownSpin = null; // spinNo whose result is on screen
  let shownBalance = null;
  let spinning = false;

  const style = document.createElement('style');
  style.textContent = CSS;
  const root = document.createElement('div');
  root.className = 'sl-root';
  container.append(style, root);

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const sym = (s) => el('div', `sl-sym ${s}`, GLYPH[s]);
  const name = (id) => (roster.find((r) => r.clientId === id) || {}).nickname || 'someone';
  const randSym = () => ORDER[Math.floor(Math.random() * ORDER.length)];

  const jackpot = el('div', 'sl-jackpot');
  const reelsBox = el('div', 'sl-reels');
  const reels = [0, 1, 2].map(() => { const r = el('div', 'sl-reel'); reelsBox.appendChild(r); return r; });
  const machineBox = el('div', 'sl-machine');
  machineBox.appendChild(reelsBox);
  const line = el('div', 'sl-line');
  const balance = el('div', 'casino-balance');
  const controls = el('div', 'sl-controls');
  const betBtns = [];
  const spinBtn = el('button', 'sl-spin', 'SPIN ␣');
  spinBtn.type = 'button';
  spinBtn.addEventListener('click', doSpin);
  const pay = el('div', 'sl-pay');
  for (const [s, x] of PAYTABLE) pay.append(el('span', null, `${GLYPH[s]} ${GLYPH[s]} ${GLYPH[s]}`), el('span', null, x));
  pay.append(el('span', null, '🍒 🍒 any'), el('span', null, '3x'), el('span', null, '🍒 any'), el('span', null, '1x'));
  const others = el('ul', 'sl-others');
  root.append(jackpot, machineBox, line, balance, controls, pay, others);

  function setReel(r, s) { r.replaceChildren(sym(randSym()), sym(s), sym(randSym())); }
  reels.forEach((r) => setReel(r, 'SE'));

  function doSpin() {
    if (spinning || !view) return;
    sfx.play('chips');
    api.sendAction({ kind: 'spin', bet });
  }
  const onKey = (ev) => {
    if (ev.code !== 'Space' || ev.target.closest('input, textarea')) return;
    ev.preventDefault();
    doSpin();
  };
  document.addEventListener('keydown', onKey);

  // Spin the reels for show, stop them one at a time on the server's result, then reveal the win.
  function animate(m, finalBalance) {
    spinning = true;
    line.className = 'sl-line';
    line.textContent = '';
    const timers = reels.map((r, i) => {
      r.classList.add('spin');
      return setInterval(() => setReel(r, randSym()), 60);
    });
    const stopAt = [700, 1050, 1400];
    reels.forEach((r, i) => setTimeout(() => {
      clearInterval(timers[i]);
      r.classList.remove('spin');
      setReel(r, m.reels[i]);
      sfx.play('tick');
      if (i < 2) return;
      spinning = false;
      shownBalance = finalBalance;
      if (m.jackpot) { line.className = 'sl-line jackpot'; line.textContent = `◆ JACKPOT ${money(m.win)} ◆`; sfx.play('win'); }
      else if (m.win > 0) { line.className = 'sl-line win'; line.textContent = `WIN ${money(m.win)}`; sfx.play(m.win >= m.bet * 10 ? 'win' : 'point'); }
      render();
    }, stopAt[i]));
  }

  function render() {
    if (!view) { line.textContent = 'Loading…'; return; }
    const me = api.getClientId();
    const m = view.machines[me];
    jackpot.replaceChildren(el('span', null, 'PROGRESSIVE JACKPOT'), el('b', null, money(view.jackpot)), el('small', 'muted', `pays in full on a $${view.bets[view.bets.length - 1]} bet · signed-in players only`));
    if (shownBalance == null) shownBalance = view.balances[me] || 0;
    balance.textContent = `BALANCE ${money(shownBalance)}`;
    controls.replaceChildren(el('span', 'muted', 'BET'));
    betBtns.length = 0;
    for (const b of view.bets) {
      const btn = el('button', 'sl-bet', `$${b}`);
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(b === bet));
      btn.addEventListener('click', () => { bet = b; sfx.play('click'); render(); });
      controls.appendChild(btn);
    }
    spinBtn.disabled = spinning || shownBalance < bet;
    controls.appendChild(spinBtn);
    if (shownBalance < view.bets[0] && !spinning) line.textContent = 'Out of money. Stipend and shifts are in the CASINO menu.';
    others.replaceChildren();
    for (const [id, om] of Object.entries(view.machines)) {
      if (id === me || !om.spinNo) continue;
      others.appendChild(el('li', null)).append(el('span', null, name(id)), el('span', null, `${om.reels.map((s) => GLYPH[s]).join(' ')} ${om.win ? `+${money(om.win)}` : ''}`));
    }
    for (const w of view.wins) if (w.id !== me) others.appendChild(el('li', 'muted', `${name(w.id)} hit ${w.jackpot ? 'the JACKPOT' : 'big'}: ${money(w.win)}`));
    if (m) { shownSpin = shownSpin ?? m.spinNo; }
  }

  function apply(data) {
    if (!view) line.textContent = '';
    const me = api.getClientId();
    const prev = view && view.machines[me];
    view = data;
    const m = view.machines[me];
    if (m && prev && m.spinNo !== prev.spinNo && m.spinNo !== shownSpin) {
      shownSpin = m.spinNo;
      shownBalance = (view.balances[me] || 0) - m.win; // show the stake gone now, the win once the reels stop
      animate(m, view.balances[me]);
    } else if (!spinning) shownBalance = view.balances[me];
    render();
  }

  render();

  return {
    applySnapshot: apply,
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') apply(data);
      else if (data.kind === 'moveRejected') { sfx.play('error'); line.className = 'sl-line'; line.textContent = REJECT[data.reason] || data.reason; }
    },
    applyRoster(r) { roster = r; render(); },
    unmount() { document.removeEventListener('keydown', onKey); container.innerHTML = ''; },
  };
}
