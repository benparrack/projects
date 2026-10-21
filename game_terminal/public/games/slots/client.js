// Slots — your own 3-reel machine, one pay line, played from your casino balance. Three diamonds
// pay 500x plus the site-wide progressive; two ★ start the pick-a-jackpot bonus board. Server plugin: ../../../server/games/slots.js
// The server decides every spin up front; everything here is the show.

import { sfx } from '../sfx.js';

const GLYPH = { CH: '🍒', LE: '🍋', BE: '🔔', BA: 'BAR', SE: '7', JP: '◆', BL: '·', BN: '★' };
const ORDER = ['CH', 'LE', 'BE', 'BA', 'SE', 'JP', 'BL', 'BN'];
const PAYTABLE = [['JP', '500x + POT'], ['SE', '100x'], ['BA', '40x'], ['BE', '20x'], ['LE', '10x'], ['CH', '10x']];
const PAYS = new Set(['CH', 'LE', 'BE', 'BA', 'SE', 'JP']); // a pair of these on reels 1-2 teases reel 3
const SYM_H = 64;
const STOP_MS = [800, 1150, 1500];
const TEASE_MS = 1100;
const AUTO_SPINS = 10;
const money = (n) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const REJECT = {
  broke: "Not enough in your casino balance for that bet. Claim the daily stipend or work a shift in the CASINO menu.",
  too_fast: 'Let the reels stop first.',
  wallet_loading: 'Opening your casino balance… try again in a second.',
};

const CSS = `
.sl-root { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 8px; }
.sl-cab { position: relative; display: flex; align-items: center; gap: 6px; }
.sl-machine { --sl-accent: #ffbf00; --sl-body: #2a1d00; --sl-glow: rgba(255,191,0,.35);
  position: relative; border: 3px solid var(--sl-accent); border-radius: 18px 18px 10px 10px; padding: 0 16px 14px;
  background: linear-gradient(180deg, var(--sl-body), #050400 85%); box-shadow: 0 0 28px var(--sl-glow), inset 0 2px 0 rgba(255,255,255,.15); }
.sl-marquee { margin: 0 -16px 10px; padding: 8px 10px 6px; border-radius: 14px 14px 0 0; text-align: center; position: relative;
  background: linear-gradient(180deg, rgba(255,255,255,.12), transparent); border-bottom: 2px solid var(--sl-accent); }
.sl-title { font-family: Georgia, serif; font-weight: bold; font-size: 1.5em; letter-spacing: .12em; color: var(--sl-accent); text-shadow: 0 0 10px var(--sl-glow), 0 2px 0 #000; }
.sl-bulbs { display: flex; justify-content: space-between; padding: 0 2px; }
.sl-bulbs i { width: 8px; height: 8px; border-radius: 50%; background: var(--sl-accent); opacity: .25; animation: sl-chase 1.2s infinite; }
.sl-machine.won .sl-bulbs i { animation-duration: .35s; }
.sl-led { display: inline-block; margin-top: 4px; padding: 2px 10px; border-radius: 4px; background: #000; border: 1px solid #333;
  font-family: 'Courier New', monospace; font-weight: bold; font-size: 1.35em; color: #ff3b3b; text-shadow: 0 0 6px #ff3b3b; letter-spacing: .08em; }
.sl-led small { font-size: .55em; color: #ff9b9b; letter-spacing: .1em; margin-right: 6px; }
.sl-window { position: relative; padding: 8px; border-radius: 10px; background: #111; box-shadow: inset 0 0 0 2px #000, inset 0 0 0 4px rgba(255,255,255,.08); }
.sl-reels { display: flex; gap: 8px; position: relative; }
.sl-payline { position: absolute; left: 2px; right: 2px; top: 50%; height: 0; border-top: 3px solid rgba(255,40,40,.75); pointer-events: none; z-index: 2; box-shadow: 0 0 6px rgba(255,40,40,.8); }
.sl-machine.won .sl-payline { border-color: #39ff14; box-shadow: 0 0 12px #39ff14; animation: sl-flash .3s 6; }
.sl-reel { position: relative; width: 84px; height: ${SYM_H * 3}px; overflow: hidden; border-radius: 6px;
  background: linear-gradient(180deg, #bdb6a3, #fffdf6 30%, #fffdf6 70%, #bdb6a3); }
.sl-reel::after { content: ''; position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 18px 16px -6px rgba(0,0,0,.55), inset 0 -18px 16px -6px rgba(0,0,0,.55); }
.sl-reel.tease { box-shadow: 0 0 0 3px #ffd23f, 0 0 22px #ffd23f; animation: sl-flash .25s infinite; }
.sl-strip { position: absolute; left: 0; right: 0; top: 0; will-change: transform; }
.sl-strip.moving { animation: sl-blur var(--dur) ease-out; }
.sl-sym { height: ${SYM_H}px; display: flex; align-items: center; justify-content: center; font-size: 40px; font-weight: bold; color: #222; font-family: Georgia, serif; }
.sl-sym.SE { font-size: 52px; background: linear-gradient(180deg, #ff5a5a, #a00000); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-stroke: 1px #600; filter: drop-shadow(0 2px 0 rgba(0,0,0,.35)); }
.sl-sym.BA span { font-size: 18px; letter-spacing: .08em; color: #fffdf6; background: linear-gradient(180deg, #333, #000); padding: 4px 8px; border-radius: 3px; border: 2px solid #c9a24a; }
.sl-sym.JP { font-size: 50px; color: #19b5f2; text-shadow: 0 0 10px rgba(25,181,242,.7), 0 2px 0 #045; }
.sl-sym.BL { color: #b8b0a0; }
.sl-sym.BN { font-size: 46px; color: #ffd23f; -webkit-text-stroke: 2px #8a2be2; text-shadow: 0 0 10px rgba(138,43,226,.6); }
.sl-ladder { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin: 6px 0 2px; }
.sl-ladder div { border-radius: 6px; padding: 2px 4px; text-align: center; font-family: Georgia, serif; font-weight: bold; font-size: .72em; line-height: 1.2; color: #fff; border: 1px solid rgba(255,255,255,.35); }
.sl-ladder b { display: block; font-size: 1.15em; font-family: 'Courier New', monospace; }
.sl-ladder .MINI { background: linear-gradient(180deg, #2e9b4f, #0d4a20); } .sl-ladder .MINOR { background: linear-gradient(180deg, #2f6fd6, #10306b); }
.sl-ladder .MAJOR { background: linear-gradient(180deg, #a531d6, #4a1066); } .sl-ladder .GRAND { background: linear-gradient(180deg, #e0302a, #6b0d0a); }
.sl-ladder .lit { animation: sl-pulse .35s 8; box-shadow: 0 0 16px #ffd23f; border-color: #ffd23f; }
.sl-bonus { position: absolute; inset: 0; z-index: 4; border-radius: 16px 16px 8px 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  background: radial-gradient(circle at 50% 30%, rgba(90,20,140,.97), rgba(20,0,40,.97)); padding: 10px; }
.sl-bonus h3 { margin: 0; font-family: Georgia, serif; color: #ffd23f; text-shadow: 0 0 10px #ff8c00; letter-spacing: .1em; }
.sl-board { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; width: 100%; max-width: 320px; }
.sl-tile { aspect-ratio: 1.3; border-radius: 8px; border: 2px solid #ffd23f; background: linear-gradient(180deg, #ffe680, #c98a00); color: #4a2a00; font-size: 1.6em; font-weight: bold; padding: 0; cursor: pointer; transition: transform .25s; }
.sl-tile:hover:not(:disabled) { transform: scale(1.06); box-shadow: 0 0 12px #ffd23f; }
.sl-tile.open { cursor: default; font-family: Georgia, serif; font-size: .78em; color: #fff; transform: rotateY(360deg); transition: transform .4s; }
.sl-tile.open.MINI { background: linear-gradient(180deg, #2e9b4f, #0d4a20); } .sl-tile.open.MINOR { background: linear-gradient(180deg, #2f6fd6, #10306b); }
.sl-tile.open.MAJOR { background: linear-gradient(180deg, #a531d6, #4a1066); } .sl-tile.open.GRAND { background: linear-gradient(180deg, #e0302a, #6b0d0a); }
.sl-tile:disabled { opacity: 1; } .sl-tile.dim { opacity: .35; } .sl-tile.win { box-shadow: 0 0 16px #ffd23f; animation: sl-pulse .35s 6; }
.sl-sym.hit { animation: sl-hit .45s ease-in-out infinite alternate; }
.sl-lever { position: relative; width: 26px; height: 170px; cursor: pointer; align-self: center; }
.sl-lever .base { position: absolute; left: 3px; bottom: 0; width: 20px; height: 34px; border-radius: 6px; background: linear-gradient(90deg, #555, #ccc, #555); }
.sl-lever .arm { position: absolute; left: 10px; bottom: 26px; width: 6px; height: 120px; border-radius: 3px; background: linear-gradient(90deg, #888, #eee, #888); transform-origin: 50% 100%; transition: transform .18s ease-in; }
.sl-lever .ball { position: absolute; left: -7px; top: -14px; width: 20px; height: 20px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #ff8a8a, #c00 60%, #600); box-shadow: 0 2px 6px rgba(0,0,0,.6); }
.sl-lever.pull .arm { transform: scaleY(-.35); transition-timing-function: ease-out; }
.sl-lever:hover .ball { box-shadow: 0 0 10px #ff6b6b; }
.sl-line { min-height: 1.6em; font-size: 1.3em; text-align: center; font-weight: bold; }
.sl-line.win { color: #ffbf00; text-shadow: 0 0 10px rgba(255,191,0,.6); }
.sl-line.jackpot { color: #39ff14; font-size: 1.8em; animation: sl-pulse .4s 10; }
.sl-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; }
.sl-bet { border-radius: 50%; width: 46px; height: 46px; padding: 0; font-weight: bold; font-size: .8em; border: 3px dashed var(--sl-accent, #ffbf00); }
.sl-bet[aria-pressed="true"] { background: #ffbf00; color: #000; transform: translateY(-3px); box-shadow: 0 0 10px rgba(255,191,0,.6); }
.sl-spin { font-size: 1.25em; font-weight: bold; width: 88px; height: 88px; border-radius: 50%; padding: 0; color: #fff; border: 4px solid #600;
  background: radial-gradient(circle at 35% 30%, #ff7070, #d00000 55%, #800000); box-shadow: 0 6px 0 #500, 0 8px 14px rgba(0,0,0,.5); transition: transform .08s, box-shadow .08s; }
.sl-spin:active:not(:disabled) { transform: translateY(5px); box-shadow: 0 1px 0 #500, 0 2px 4px rgba(0,0,0,.5); }
.sl-spin:disabled { filter: grayscale(.7) brightness(.6); }
.sl-auto[aria-pressed="true"] { background: #39ff14; color: #000; }
.sl-pay { display: grid; grid-template-columns: auto auto; gap: 0 18px; font-size: .85em; align-items: center; }
.sl-pay .sl-sym { height: 30px; font-size: 20px; display: inline-flex; width: 30px; }
.sl-pay .sl-sym.SE { font-size: 24px; } .sl-pay .sl-sym.JP { font-size: 22px; } .sl-pay .sl-sym.BA span { font-size: 9px; padding: 2px 3px; border-width: 1px; }
.sl-pay > span:nth-child(even) { color: #ffbf00; text-align: right; }
.sl-others { font-size: .85em; width: 100%; max-width: 420px; }
.sl-others li { display: flex; justify-content: space-between; gap: 8px; }
.sl-fx { position: absolute; inset: -40px -20px -20px; pointer-events: none; overflow: hidden; z-index: 5; }
.sl-coin { position: absolute; top: -30px; font-size: 22px; animation: sl-fall var(--t) cubic-bezier(.3,.1,.6,1) var(--d) forwards; opacity: 0; }
.sl-banner { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); white-space: nowrap; font-family: Georgia, serif; font-weight: bold; font-size: 2.4em;
  color: #ffd23f; text-shadow: 0 0 14px #ff8c00, 0 3px 0 #7a3b00, 0 0 30px #ffbf00; animation: sl-banner 2.6s ease-out forwards; z-index: 6; }
.sl-banner.jp { color: #39ff14; text-shadow: 0 0 18px #39ff14, 0 3px 0 #064; font-size: 2.8em; }
@keyframes sl-chase { 0%, 100% { opacity: .25; } 50% { opacity: 1; box-shadow: 0 0 8px var(--sl-accent); } }
.sl-bulbs i:nth-child(3n+1) { animation-delay: .4s; } .sl-bulbs i:nth-child(3n+2) { animation-delay: .8s; }
@keyframes sl-blur { 0% { filter: blur(0); } 15%, 70% { filter: blur(2.5px); } 100% { filter: blur(0); } }
@keyframes sl-hit { from { transform: scale(1); filter: drop-shadow(0 0 0 #ffd23f); } to { transform: scale(1.18); filter: drop-shadow(0 0 10px #ffd23f); } }
@keyframes sl-flash { 50% { opacity: .45; } }
@keyframes sl-pulse { 50% { transform: scale(1.12); } }
@keyframes sl-fall { 0% { opacity: 1; transform: translateY(0) rotate(0); } 100% { opacity: 1; transform: translateY(var(--y)) translateX(var(--x)) rotate(var(--r)); } }
@keyframes sl-banner { 0% { transform: translate(-50%, -50%) scale(.2); opacity: 0; } 15% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
  25% { transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { transform: translate(-50%, -80%) scale(1); opacity: 0; } }
@media (max-width: 480px) {
  .sl-reel { width: 70px; } .sl-machine { padding: 0 10px 10px; } .sl-marquee { margin: 0 -10px 8px; }
  .sl-lever { display: none; } .sl-sym { font-size: 34px; } .sl-sym.SE { font-size: 44px; } .sl-sym.JP { font-size: 42px; }
  .sl-banner { font-size: 1.7em; } .sl-banner.jp { font-size: 2em; }
}
`;

export function mount(container, api) {
  let view = null;
  let roster = [];
  let bet = 1;
  let shownSpin = null; // spinNo whose result is on screen
  let shownBalance = null;
  let spinning = false;
  let auto = 0; // spins left on AUTO

  const style = document.createElement('style');
  style.textContent = CSS;
  const root = document.createElement('div');
  root.className = 'sl-root';
  container.append(style, root);

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const sym = (s) => { const d = el('div', `sl-sym ${s}`); if (s === 'BA') d.append(el('span', null, 'BAR')); else d.textContent = GLYPH[s]; return d; };
  const prize = (tier, b) => (view.bonusTiers.find(([n]) => n === tier) || [0, 0])[1] * b;
  const name = (id) => (roster.find((r) => r.clientId === id) || {}).nickname || 'someone';
  const randSym = () => ORDER[Math.floor(Math.random() * ORDER.length)];

  // Cabinet: marquee (bulbs, title, jackpot LED), the reel window, a lever on the side.
  const machine = el('div', 'sl-machine');
  const marquee = el('div', 'sl-marquee');
  const bulbs = () => { const b = el('div', 'sl-bulbs'); for (let i = 0; i < 16; i++) b.append(el('i')); return b; };
  const led = el('div', 'sl-led');
  const ladder = el('div', 'sl-ladder');
  marquee.append(bulbs(), el('div', 'sl-title', '7 TERMINAL 7'), led, ladder, bulbs());
  const win = el('div', 'sl-window');
  const reelsBox = el('div', 'sl-reels');
  const reels = [0, 1, 2].map(() => { const r = el('div', 'sl-reel'); const s = el('div', 'sl-strip'); r.append(s); reelsBox.append(r); return { box: r, strip: s }; });
  win.append(reelsBox, el('div', 'sl-payline'));
  machine.append(marquee, win);
  const lever = el('div', 'sl-lever');
  const arm = el('div', 'arm');
  arm.append(el('div', 'ball'));
  lever.append(el('div', 'base'), arm);
  lever.title = 'Pull to spin';
  lever.addEventListener('click', doSpin);
  const cab = el('div', 'sl-cab');
  const fx = el('div', 'sl-fx');
  cab.append(machine, lever, fx);

  const line = el('div', 'sl-line');
  const balance = el('div', 'casino-balance');
  const controls = el('div', 'sl-controls');
  const spinBtn = el('button', 'sl-spin', 'SPIN');
  spinBtn.type = 'button';
  spinBtn.title = 'Space';
  spinBtn.addEventListener('click', doSpin);
  const autoBtn = el('button', 'sl-auto');
  autoBtn.type = 'button';
  autoBtn.addEventListener('click', () => { sfx.play('click'); auto = auto ? 0 : AUTO_SPINS; if (auto) doSpin(); render(); });
  const pay = el('div', 'sl-pay');
  const row3 = (s) => { const d = el('span'); d.append(sym(s), sym(s), sym(s)); return d; };
  for (const [s, x] of PAYTABLE) pay.append(row3(s), el('span', null, x));
  pay.append(el('span', null, '🍒 🍒 any'), el('span', null, '3x'), el('span', null, '🍒 any'), el('span', null, '1x'));
  { const d = el('span'); d.append(sym('BN'), sym('BN'), el('span', null, ' any')); pay.append(d, el('span', null, 'BONUS')); }
  const others = el('ul', 'sl-others');
  root.append(cab, line, balance, controls, pay, others);

  function rest(r, s) {
    r.strip.style.transition = 'none';
    r.strip.style.transform = 'translateY(0)';
    r.strip.replaceChildren(sym(randSym()), sym(s), sym(randSym()));
  }
  reels.forEach((r) => rest(r, 'SE'));

  function doSpin() {
    if (spinning || !view) return;
    lever.classList.add('pull');
    setTimeout(() => lever.classList.remove('pull'), 260);
    sfx.play('whoosh');
    api.sendAction({ kind: 'spin', bet });
  }
  const onKey = (ev) => {
    if (ev.code !== 'Space' || ev.target.closest('input, textarea')) return;
    ev.preventDefault();
    doSpin();
  };
  document.addEventListener('keydown', onKey);

  // Each reel gets a long strip that ends on the result, then slides down to it with a little
  // overshoot. A pair on reels 1-2 holds reel 3 back and makes it glow.
  function scroll(r, final, ms, laps) {
    const syms = [sym(randSym()), sym(final), sym(randSym())];
    for (let i = 0; i < laps; i++) syms.push(sym(randSym()));
    for (const c of [...r.strip.children].slice(0, 3)) { const k = c.cloneNode(true); k.classList.remove('hit'); syms.push(k); } // what's showing now
    r.strip.replaceChildren(...syms);
    const dist = (syms.length - 3) * SYM_H;
    r.strip.style.transition = 'none';
    r.strip.style.transform = `translateY(${-dist}px)`;
    void r.strip.offsetHeight;
    r.strip.style.setProperty('--dur', `${ms}ms`);
    r.strip.classList.remove('moving');
    void r.strip.offsetHeight;
    r.strip.classList.add('moving');
    r.strip.style.transition = `transform ${ms}ms cubic-bezier(.25,.1,.3,1.04)`;
    r.strip.style.transform = 'translateY(0)';
  }

  function coins(count) {
    const w = fx.clientWidth || 300;
    const h = fx.clientHeight || 400;
    for (let i = 0; i < count; i++) {
      const c = el('span', 'sl-coin', i % 5 === 0 ? '💰' : '🪙');
      c.style.left = `${Math.random() * w}px`;
      c.style.setProperty('--d', `${Math.random() * 0.8}s`);
      c.style.setProperty('--t', `${1.1 + Math.random() * 0.9}s`);
      c.style.setProperty('--y', `${h + 60}px`);
      c.style.setProperty('--x', `${(Math.random() - 0.5) * 80}px`);
      c.style.setProperty('--r', `${(Math.random() - 0.5) * 720}deg`);
      fx.append(c);
      setTimeout(() => c.remove(), 3200);
    }
  }
  function banner(text, jp) {
    const b = el('div', `sl-banner${jp ? ' jp' : ''}`, text);
    fx.append(b);
    setTimeout(() => b.remove(), 2700);
  }
  // Count the win up on the line, ticking as it goes.
  function countUp(target, cls, prefix) {
    line.className = `sl-line ${cls}`;
    const steps = Math.min(30, Math.max(6, Math.round(target)));
    let i = 0;
    const t = setInterval(() => {
      i++;
      line.textContent = `${prefix} ${money(i >= steps ? target : Math.round((target * i) / steps * 100) / 100)}`;
      if (i % 2) sfx.play('blip');
      if (i >= steps) clearInterval(t);
    }, 45);
  }

  function animate(m, finalBalance) {
    spinning = true;
    machine.classList.remove('won');
    ladder.querySelectorAll('.lit').forEach((e) => e.classList.remove('lit'));
    line.className = 'sl-line';
    line.textContent = '';
    const tease = m.reels[0] === m.reels[1] && PAYS.has(m.reels[0]);
    const stops = STOP_MS.map((ms, i) => (i === 2 && tease ? ms + TEASE_MS : ms));
    reels.forEach((r, i) => scroll(r, m.reels[i], stops[i], 14 + i * 6 + (i === 2 && tease ? 16 : 0)));
    reels.forEach((r, i) => setTimeout(() => {
      sfx.play('tick');
      r.strip.classList.remove('moving');
      if (i === 1 && tease) { reels[2].box.classList.add('tease'); sfx.play('beep'); }
      if (i < 2) return;
      r.box.classList.remove('tease');
      finish(m, finalBalance);
    }, stops[i]));
    render();
  }

  // Pick-a-jackpot: each click flips the next tile of the server's reveal order; three alike wins that prize.
  function bonusGame(m, finalBalance) {
    sfx.play('win');
    banner('★ BONUS ★');
    const box = el('div', 'sl-bonus');
    const board = el('div', 'sl-board');
    const hint = el('div', 'muted', 'Pick tiles until you match three.');
    box.append(el('h3', null, 'PICK A JACKPOT'), board, hint);
    let k = 0;
    const tiles = [];
    const flip = (t, tier) => { t.disabled = true; t.className = `sl-tile open ${tier}`; t.textContent = `${tier}\n${money(prize(tier, m.bet))}`; t.style.whiteSpace = 'pre'; };
    for (let i = 0; i < 12; i++) {
      const t = el('button', 'sl-tile', '?');
      t.type = 'button';
      t.addEventListener('click', () => {
        if (t.disabled || k >= m.bonus.reveal.length) return;
        const tier = m.bonus.reveal[k++];
        flip(t, tier);
        sfx.play(k === m.bonus.reveal.length ? 'chime' : 'card');
        if (k < m.bonus.reveal.length) return;
        tiles.forEach((o) => { if (o.classList.contains(tier)) o.classList.add('win'); });
        const rest = [...m.bonus.rest];
        setTimeout(() => tiles.forEach((o) => { if (!o.disabled) { flip(o, rest.shift()); o.classList.add('dim'); } }), 700);
        hint.textContent = `${tier} JACKPOT!`;
        setTimeout(() => { box.remove(); bonusPaid = tier; finish(m, finalBalance); }, 2600);
      });
      tiles.push(t);
      board.append(t);
    }
    machine.append(box);
  }
  let bonusPaid = null; // the tier the bonus board just landed on, lit on the ladder

  function finish(m, finalBalance) {
    if (m.bonus && !bonusPaid) { auto = 0; render(); bonusGame(m, finalBalance); return; }
    spinning = false;
    shownBalance = finalBalance;
    const x = m.win / m.bet;
    if (bonusPaid) {
      const lit = ladder.querySelector(`.${bonusPaid}`);
      if (lit) lit.classList.add('lit');
      countUp(m.win, 'win', `${bonusPaid} JACKPOT`);
      if (bonusPaid === 'GRAND' || bonusPaid === 'MAJOR') { banner(`${bonusPaid} JACKPOT!`); coins(bonusPaid === 'GRAND' ? 60 : 35); } else coins(12);
      bonusPaid = null;
      render();
      return;
    }
    if (m.win > 0 && !m.bonus) {
      machine.classList.add('won');
      const cherryOnly = !(m.reels[0] === m.reels[1] && m.reels[1] === m.reels[2]);
      reels.forEach((r, i) => { if (!cherryOnly || m.reels[i] === 'CH') r.strip.children[1].classList.add('hit'); });
    }
    if (m.jackpot) { countUp(m.win, 'jackpot', '◆ JACKPOT'); banner('◆ JACKPOT ◆', true); coins(70); sfx.play('win'); }
    else if (x >= 100) { countUp(m.win, 'win', 'MEGA WIN'); banner('MEGA WIN!'); coins(55); sfx.play('win'); }
    else if (x >= 20) { countUp(m.win, 'win', 'BIG WIN'); banner('BIG WIN!'); coins(35); sfx.play('win'); }
    else if (x >= 3) { countUp(m.win, 'win', 'WIN'); coins(10); sfx.play('chime'); }
    else if (m.win > 0) { countUp(m.win, 'win', 'WIN'); sfx.play('point'); }
    if (auto) {
      auto--;
      if (x >= 20 || shownBalance < bet) auto = 0; // stop on a big moment or when the money runs short
      else if (auto) setTimeout(() => { if (auto && !spinning) doSpin(); }, m.win ? 1100 : 450);
    }
    render();
  }

  function render() {
    if (!view) { line.textContent = 'Loading…'; return; }
    const me = api.getClientId();
    led.replaceChildren(el('small', null, '◆◆◆ PAYS'), document.createTextNode(money(Math.floor(view.jpFixed * bet + (view.jackpot * bet) / view.maxBet))));
    led.title = `Three diamonds pay ${view.jpFixed}x your bet plus your bet's share of the ${money(view.jackpot)} progressive (all of it at $${view.maxBet}; the progressive is for signed-in players only)`;
    if (!ladder.children.length) for (const [n] of view.bonusTiers) ladder.append(el('div', n));
    view.bonusTiers.forEach(([n, x], i) => { ladder.children[i].replaceChildren(document.createTextNode(n), el('b', null, money(x * bet))); });
    if (shownBalance == null) shownBalance = view.balances[me] || 0;
    balance.textContent = `BALANCE ${money(shownBalance)}`;
    controls.replaceChildren(el('span', 'muted', 'BET'));
    for (const b of view.bets) {
      const btn = el('button', 'sl-bet', b >= 1000 ? `$${b / 1000}k` : `$${b}`);
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(b === bet));
      btn.disabled = spinning;
      btn.addEventListener('click', () => { bet = b; sfx.play('chips'); render(); });
      controls.appendChild(btn);
    }
    spinBtn.disabled = spinning || shownBalance < bet;
    autoBtn.textContent = auto ? `STOP (${auto})` : `AUTO ×${AUTO_SPINS}`;
    autoBtn.setAttribute('aria-pressed', String(!!auto));
    autoBtn.disabled = !auto && (spinning || shownBalance < bet);
    controls.append(spinBtn, autoBtn);
    if (shownBalance < view.bets[0] && !spinning) { line.className = 'sl-line'; line.textContent = 'Out of money. Stipend and shifts are in the CASINO menu.'; }
    others.replaceChildren();
    for (const [id, om] of Object.entries(view.machines)) {
      if (id === me || !om.spinNo) continue;
      others.appendChild(el('li', null)).append(el('span', null, name(id)), el('span', null, `${om.reels.map((s) => GLYPH[s]).join(' ')} ${om.win ? `+${money(om.win)}` : ''}`));
    }
    for (const w of view.wins) if (w.id !== me) others.appendChild(el('li', 'muted', `${name(w.id)} hit ${w.jackpot ? 'the JACKPOT' : 'big'}: ${money(w.win)}`));
    const m = view.machines[me];
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
      else if (data.kind === 'moveRejected') { auto = 0; sfx.play('error'); line.className = 'sl-line'; line.textContent = REJECT[data.reason] || data.reason; render(); }
    },
    applyRoster(r) { roster = r; render(); },
    unmount() { auto = 0; document.removeEventListener('keydown', onKey); container.innerHTML = ''; },
  };
}
