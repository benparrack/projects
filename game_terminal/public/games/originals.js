// Shared shell for the crypto-casino style originals (crash, plinko, mines): the look, the bet panel
// (Manual / Auto tabs, a typed bet with ½ and 2x, auto-bet rules), live session stats with a profit
// chart, the room's bets feed, a big-win splash, and the provably fair modal that re-derives any bet
// in the browser. Server side: ../../server/casino/originals.js

import { sfx } from './sfx.js';

export const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtX = (m) => `${Number(m).toFixed(2)}x`;
const round2 = (n) => Math.round(n * 100) / 100;

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const btn = (cls, text, onClick) => { const b = el('button', cls, text); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; };
export { btn };

// Per-game settings remembered in this browser (bet, risk, auto rules...).
export function store(game) {
  const key = `gt.og.${game}`;
  let data = {};
  try { data = JSON.parse(localStorage.getItem(key)) || {}; } catch { /* storage blocked */ }
  return {
    get: (k, d) => (k in data ? data[k] : d),
    set(k, v) { data[k] = v; try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* storage blocked */ } },
  };
}

export const REJECT = {
  broke: 'Not enough in your casino balance. Claim the daily stipend or work a shift in the CASINO menu.',
  bad_bet: 'That bet is outside the table limits.',
  wallet_loading: 'Opening your casino balance… try again in a second.',
  too_fast: 'Easy, one at a time.',
  game_active: 'Finish the game on the board first.',
  bad_seed: 'Client seeds are 1-32 letters, digits, - or _.',
  not_betting: 'The round already started. Your bet is queued for the next one.',
  too_late: 'Too late, it crashed.',
  bad_auto: 'Auto cash-out must be at least 1.01x.',
  bad_tiles: 'Pick at least one tile (and no more than there are gems).',
};

export const CSS = `
.og { --bg: #0b0e1d; --panel: #141a33; --panel2: #1b2246; --input: #090c1a; --line: #262e58; --text: #e9edff; --muted: #8890b8;
  --accent: #5b7cff; --accent2: #9a5cff; --win: #27e07c; --loss: #ff4b63; --gold: #ffc94a;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: var(--text); width: 100%; display: flex; flex-direction: column; gap: 10px;
  background: radial-gradient(ellipse at 70% 0%, #1a2150 0%, var(--bg) 60%); border-radius: 14px; padding: 10px; box-sizing: border-box; letter-spacing: 0; }
.og * { box-sizing: border-box; }
.og button { font-family: inherit; cursor: pointer; }
.og button:disabled { cursor: not-allowed; opacity: .45; }
.og input[type=number] { -moz-appearance: textfield; appearance: textfield; }
.og input::-webkit-inner-spin-button, .og input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.og-main { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 10px; }
.og-panel { background: var(--panel); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 9px; border: 1px solid var(--line); }
.og-stage { position: relative; background: linear-gradient(180deg, #121836, #0c1028); border-radius: 12px; border: 1px solid var(--line); overflow: hidden; min-height: 320px; display: flex; flex-direction: column; }
.og-tabs { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; background: var(--input); border-radius: 999px; padding: 3px; gap: 3px; }
.og-tabs button { background: transparent; border: 0; color: var(--muted); border-radius: 999px; padding: 6px 0; font-weight: 600; font-size: 13px; }
.og-tabs button[aria-pressed="true"] { background: var(--panel2); color: var(--text); box-shadow: 0 2px 6px rgba(0,0,0,.4); }
.og-field { display: flex; flex-direction: column; gap: 4px; }
.og-label { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); font-weight: 600; }
.og-label span:last-child { color: var(--text); opacity: .8; }
.og-input { display: flex; align-items: center; background: var(--input); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; height: 38px; transition: border-color .15s; }
.og-input:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(91,124,255,.25); }
.og-input > b { padding: 0 2px 0 10px; color: var(--gold); font-size: 14px; }
.og-input input, .og-input select { flex: 1; min-width: 0; background: transparent; border: 0; color: var(--text); font: 600 14px system-ui, sans-serif; padding: 0 8px; height: 100%; outline: none; }
.og-input select option { background: var(--panel); }
.og-input input:disabled, .og-input select:disabled { opacity: .5; }
.og-input .og-mini { height: 100%; border: 0; border-left: 1px solid var(--line); background: var(--panel2); color: var(--text); font-weight: 700; font-size: 12px; padding: 0 10px; }
.og-input .og-mini:hover:not(:disabled) { background: #2a3470; }
.og-seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; }
.og-seg button { background: var(--input); border: 1px solid var(--line); color: var(--muted); border-radius: 7px; padding: 7px 0; font-weight: 700; font-size: 12px; text-transform: capitalize; }
.og-seg button[aria-pressed="true"] { border-color: var(--accent); color: var(--text); background: rgba(91,124,255,.18); }
.og .og-bet { height: 46px; border: 0; border-radius: 9px; font-weight: 800; font-size: 16px; color: #fff; letter-spacing: .3px;
  background: linear-gradient(135deg, var(--accent), var(--accent2)); box-shadow: 0 4px 0 #3a2a8a, 0 6px 18px rgba(91,124,255,.35); transition: transform .08s, box-shadow .08s, filter .15s; }
.og-bet:hover:not(:disabled) { filter: brightness(1.12); }
.og-bet:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 1px 0 #3a2a8a, 0 2px 8px rgba(91,124,255,.35); }
.og-bet.cash { background: linear-gradient(135deg, #1fcf70, #12a35a); box-shadow: 0 4px 0 #0b6b3a, 0 6px 22px rgba(39,224,124,.4); color: #04130a; }
.og-bet.stop { background: linear-gradient(135deg, #ff5b72, #d02a48); box-shadow: 0 4px 0 #7a1226, 0 6px 18px rgba(255,75,99,.35); }
.og-bet.ghost { background: var(--panel2); box-shadow: 0 4px 0 #0a0e22; color: var(--muted); }
.og-bet small { display: block; font-size: 11px; font-weight: 600; opacity: .85; }
.og-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; } .og-row2 > * { min-width: 0; }
.og-sub { font-size: 12px; color: var(--muted); display: flex; justify-content: space-between; }
.og-sub b { color: var(--text); }
.og-balance { font: 700 13px system-ui, sans-serif; color: var(--muted); display: flex; justify-content: space-between; align-items: center; padding: 2px 2px 0; }
.og-balance b { color: var(--gold); font-size: 15px; transition: color .2s; }
.og-balance b.up { color: var(--win); } .og-balance b.down { color: var(--loss); }
.og-foot { display: flex; gap: 6px; align-items: center; padding: 6px 8px; border-top: 1px solid var(--line); background: rgba(0,0,0,.2); font-size: 12px; color: var(--muted); }
.og-foot button { background: transparent; border: 1px solid var(--line); color: var(--muted); border-radius: 6px; padding: 3px 8px; font-size: 12px; font-weight: 600; }
.og-foot button:hover { color: var(--text); border-color: var(--accent); }
.og-foot .og-spacer { flex: 1; }
.og-msg { min-height: 16px; font-size: 12px; color: var(--loss); } .og-msg.info { color: var(--muted); }
.og-below { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.og-card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 8px 10px; }
.og-card h4 { margin: 0 0 6px; font-size: 13px; color: var(--muted); display: flex; gap: 8px; align-items: center; }
.og-card h4 .og-tabs { margin-left: auto; width: 160px; }
.og-feed { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.og-feed th { text-align: left; color: var(--muted); font-weight: 600; padding: 3px 4px; border-bottom: 1px solid var(--line); }
.og-feed td { padding: 4px; border-bottom: 1px solid rgba(38,46,88,.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 130px; }
.og-feed th:not(:first-child), .og-feed td:not(:first-child) { text-align: right; }
.og-feed tr.new td { animation: og-row .5s ease-out; }
.og-feed .w { color: var(--win); font-weight: 700; } .og-feed .l { color: var(--muted); }
.og-feed .x { display: inline-block; padding: 1px 6px; border-radius: 5px; background: var(--input); font-weight: 700; }
.og-feed .x.hot { color: var(--gold); background: rgba(255,201,74,.12); }
.og-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; font-size: 12px; }
.og-stats div { background: var(--input); border-radius: 7px; padding: 5px 7px; } .og-stats span { display: block; color: var(--muted); font-size: 11px; }
.og-stats b { font-variant-numeric: tabular-nums; } .og-stats b.w { color: var(--win); } .og-stats b.l { color: var(--loss); }
.og-chart { width: 100%; height: 70px; display: block; margin-top: 6px; }
.og-splash { position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%); z-index: 20; pointer-events: none; text-align: center; padding: 14px 28px; border-radius: 14px;
  background: rgba(10,14,32,.92); border: 2px solid var(--win); box-shadow: 0 0 40px rgba(39,224,124,.45); animation: og-pop 2.2s cubic-bezier(.2,1.4,.4,1) forwards; }
.og-splash b { display: block; font-size: 34px; color: var(--win); font-weight: 900; text-shadow: 0 0 18px rgba(39,224,124,.6); }
.og-splash span { font-size: 16px; color: var(--text); font-weight: 700; }
.og-splash em { display: block; font-style: normal; font-size: 12px; letter-spacing: 3px; color: var(--gold); font-weight: 800; }
.og-splash.mega { border-color: var(--gold); box-shadow: 0 0 60px rgba(255,201,74,.55); } .og-splash.mega b { color: var(--gold); text-shadow: 0 0 22px rgba(255,201,74,.8); font-size: 42px; }
.og-confetti { position: absolute; inset: 0; pointer-events: none; z-index: 19; overflow: hidden; }
.og-confetti i { position: absolute; width: 8px; height: 12px; top: 40%; left: 50%; border-radius: 2px; animation: og-conf var(--t) cubic-bezier(.15,.6,.4,1) forwards; }
.og-modal { position: fixed; inset: 0; background: rgba(3,5,14,.75); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
.og-modal .og-box { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; width: 100%; max-width: 460px; max-height: 90vh; overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.og-modal h3 { margin: 0; font-size: 16px; display: flex; justify-content: space-between; align-items: center; }
.og-modal h3 button { background: transparent; border: 0; color: var(--muted); font-size: 18px; }
.og-modal p { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.45; }
.og-mono { font-family: ui-monospace, Menlo, Consolas, monospace !important; font-size: 12px !important; }
.og-verify { background: var(--input); border-radius: 8px; padding: 10px; font-size: 13px; min-height: 40px; }
.og-verify .ok { color: var(--win); } .og-verify .bad { color: var(--loss); }
.og-hot { font-size: 11px; color: var(--muted); text-align: center; }
.og-shake { animation: og-shake .45s; }
@keyframes og-row { from { background: rgba(91,124,255,.25); transform: translateX(-6px); } to { background: transparent; transform: none; } }
@keyframes og-pop { 0% { transform: translate(-50%, -50%) scale(.3); opacity: 0; } 12% { transform: translate(-50%, -50%) scale(1.08); opacity: 1; } 20% { transform: translate(-50%, -50%) scale(1); }
  80% { opacity: 1; } 100% { transform: translate(-50%, -62%) scale(1); opacity: 0; } }
@keyframes og-conf { 0% { transform: translate(0, 0) rotate(0); opacity: 1; } 100% { transform: translate(var(--x), var(--y)) rotate(var(--r)); opacity: 0; } }
@keyframes og-shake { 10%, 90% { transform: translate(-2px, 1px); } 20%, 80% { transform: translate(4px, -2px); } 30%, 50%, 70% { transform: translate(-6px, 2px); } 40%, 60% { transform: translate(6px, -1px); } }
@media (max-width: 640px) {
  .og-main { grid-template-columns: minmax(0, 1fr); }
  .og-panel { order: 2; } .og-stage { min-height: 260px; }
  .og-stats { grid-template-columns: repeat(2, 1fr); }
  .og-feed td { max-width: 90px; }
}
`;

// The game's root: style, panel on the left, stage on the right, feed and stats below.
export function shell(container, extraCss) {
  const style = el('style');
  style.textContent = CSS + (extraCss || '');
  const root = el('div', 'og');
  const main = el('div', 'og-main');
  const panel = el('div', 'og-panel');
  const stage = el('div', 'og-stage');
  const foot = el('div', 'og-foot');
  const below = el('div', 'og-below');
  main.append(panel, stage);
  root.append(main, below);
  container.append(style, root);
  return { root, panel, stage, foot, below };
}

export function tabs(names, value, onChange) {
  const box = el('div', 'og-tabs');
  const buttons = names.map((n) => btn(null, n, () => { if (box.dataset.locked) return; set(n); sfx.play('click'); onChange(n); }));
  function set(n) { value = n; buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === n))); }
  box.append(...buttons);
  set(value);
  return { el: box, get: () => value, set, lock(on) { if (on) box.dataset.locked = '1'; else delete box.dataset.locked; buttons.forEach((b) => { b.disabled = on && b.textContent !== value; }); } };
}

export function field(label, input, right) {
  const f = el('div', 'og-field');
  const l = el('div', 'og-label');
  const r = el('span', null, right || '');
  l.append(el('span', null, label), r);
  f.append(l, input);
  return { el: f, right: r };
}

// A segmented picker (risk levels, speeds).
export function seg(options, value, onChange, labels = {}) {
  const box = el('div', 'og-seg');
  const bs = options.map((o) => btn(null, labels[o] || String(o), () => { set(o); sfx.play('click'); onChange(o); }));
  function set(o) { value = o; bs.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i] === o))); }
  box.append(...bs);
  set(value);
  return { el: box, get: () => value, set, disable(on) { bs.forEach((b) => { b.disabled = on; }); } };
}

export function numberInput({ value, step = 'any', min, max, prefix, suffix, onChange, extras = [] }) {
  const wrap = el('div', 'og-input');
  if (prefix) wrap.append(el('b', null, prefix));
  const input = el('input');
  input.type = 'number';
  input.step = step;
  input.inputMode = 'decimal';
  if (min != null) input.min = min;
  if (max != null) input.max = max;
  input.value = value;
  input.addEventListener('change', () => onChange && onChange(input.value));
  wrap.append(input);
  if (suffix) wrap.append(el('b', null, suffix));
  for (const [text, fn] of extras) wrap.append(btn('og-mini', text, () => { fn(); sfx.play('chips'); }));
  return { el: wrap, input, get: () => input.value, set(v) { input.value = v; }, disable(on) { input.disabled = on; wrap.querySelectorAll('button').forEach((b) => { b.disabled = on; }); } };
}

export function select(options, value, onChange) {
  const wrap = el('div', 'og-input');
  const s = el('select');
  for (const [v, text] of options) { const o = el('option', null, text); o.value = v; s.append(o); }
  s.value = String(value);
  s.addEventListener('change', () => { sfx.play('click'); onChange(s.value); });
  wrap.append(s);
  return { el: wrap, get: () => s.value, set(v) { s.value = String(v); }, disable(on) { s.disabled = on; } };
}

// Bet amount with ½ and 2x, clamped to the table limits; remembered per game.
export function amountField(st, limits, getBalance) {
  const clamp = (v) => round2(Math.min(limits.max, Math.max(limits.min, Number(v) || limits.min)));
  let value = clamp(st.get('bet', 1));
  const n = numberInput({
    value: value.toFixed(2), step: '0.01', min: limits.min, max: limits.max, prefix: '$',
    onChange: (v) => set(v),
    extras: [['½', () => set(value / 2)], ['2×', () => set(value * 2)], ['MAX', () => set(Math.min(limits.max, getBalance()))]],
  });
  function set(v) { value = clamp(v); n.set(value.toFixed(2)); st.set('bet', value); f.right.textContent = ''; for (const fn of listeners) fn(value); }
  const listeners = [];
  const f = field('Bet Amount', n.el);
  return { el: f.el, get: () => value, set, disable: n.disable, onChange(fn) { listeners.push(fn); }, label: f.right };
}

// Auto-bet rules, Stake/Rainbet style: number of bets (0 = until stopped), what to do to the bet on
// a win and on a loss (reset to the base bet, or raise it by a percentage), stop on profit / loss.
export function autoFields(st) {
  const box = el('div', 'og-field');
  const count = numberInput({ value: st.get('autoCount', 0), step: '1', min: 0, suffix: '∞', onChange: (v) => st.set('autoCount', Math.max(0, Math.floor(Number(v) || 0))) });
  const rule = (key, label) => {
    let mode = st.get(`${key}Mode`, 'reset');
    const pct = numberInput({ value: st.get(`${key}Pct`, 100), step: '1', min: 0, suffix: '%', onChange: (v) => st.set(`${key}Pct`, Math.max(0, Number(v) || 0)) });
    const s = seg(['reset', 'inc'], mode, (m) => { mode = m; st.set(`${key}Mode`, m); pct.disable(m === 'reset'); }, { reset: 'Reset', inc: 'Increase by' });
    pct.disable(mode === 'reset');
    const wrap = el('div', 'og-field');
    wrap.append(field(label, s.el).el, pct.el);
    return { el: wrap, read: () => ({ mode, pct: Number(pct.get()) || 0 }), disable(on) { s.disable(on); pct.disable(on || mode === 'reset'); } };
  };
  // Base bet: the Bet Amount field, or a share of the balance taken fresh on every reset so it grows with you.
  let sizeMode = st.get('sizeMode', 'fixed');
  const sizePct = numberInput({ value: st.get('sizePct', 1), step: '0.1', min: 0.1, suffix: '%', onChange: (v) => st.set('sizePct', Math.min(100, Math.max(0.1, Number(v) || 1))) });
  const sizeSeg = seg(['fixed', 'pct'], sizeMode, (m) => { sizeMode = m; st.set('sizeMode', m); sizePct.disable(m === 'fixed'); }, { fixed: 'Fixed', pct: '% of Balance' });
  sizePct.disable(sizeMode === 'fixed');
  const size = el('div', 'og-field');
  size.append(field('Base Bet', sizeSeg.el).el, sizePct.el);
  const onWin = rule('win', 'On Win');
  const onLoss = rule('loss', 'On Loss');
  const stopP = numberInput({ value: st.get('stopProfit', ''), step: '0.01', min: 0, prefix: '$', onChange: (v) => st.set('stopProfit', v) });
  const stopL = numberInput({ value: st.get('stopLoss', ''), step: '0.01', min: 0, prefix: '$', onChange: (v) => st.set('stopLoss', v) });
  const row = el('div', 'og-row2');
  row.append(field('Stop on Profit', stopP.el).el, field('Stop on Loss', stopL.el).el);
  box.append(field('Number of Bets', count.el).el, size, onWin.el, onLoss.el, row);
  return {
    el: box,
    read: () => ({ count: Math.max(0, Math.floor(Number(count.get()) || 0)), sizePct: sizeMode === 'pct' ? Math.min(100, Number(sizePct.get()) || 0) : 0, onWin: onWin.read(), onLoss: onLoss.read(), stopProfit: Number(stopP.get()) || 0, stopLoss: Number(stopL.get()) || 0 }),
    disable(on) { count.disable(on); sizeSeg.disable(on); sizePct.disable(on || sizeMode === 'fixed'); onWin.disable(on); onLoss.disable(on); stopP.disable(on); stopL.disable(on); },
  };
}

// Runs the auto rules: `next(profit)` after each settled bet returns the next bet, or null to stop
// (with `reason` saying why).
export function autoRunner(rules, base, limits, balance) {
  const clamp = (v) => Math.min(limits.max, Math.max(limits.min, v));
  const baseFor = (bal) => (rules.sizePct && bal != null ? clamp(round2(bal * rules.sizePct / 100)) : base);
  let bet = baseFor(balance);
  let left = rules.count || Infinity;
  let net = 0;
  const r = {
    get bet() { return bet; },
    get left() { return left; },
    get net() { return net; },
    reason: '',
    next(profit, balance) {
      net = round2(net + profit);
      left--;
      if (left <= 0) { r.reason = 'Finished all bets.'; return null; }
      if (rules.stopProfit && net >= rules.stopProfit) { r.reason = `Stopped on profit (${money(net)}).`; return null; }
      if (rules.stopLoss && -net >= rules.stopLoss) { r.reason = `Stopped on loss (${money(net)}).`; return null; }
      const rule = profit > 0 ? rules.onWin : rules.onLoss;
      bet = clamp(rule.mode === 'reset' ? baseFor(balance) : round2(bet * (1 + rule.pct / 100)));
      if (balance != null && balance < bet) { r.reason = 'Not enough balance for the next bet.'; return null; }
      return bet;
    },
  };
  return r;
}

// Session stats: profit, wagered, wins, losses, and a cumulative profit chart.
export function statsCard() {
  const card = el('div', 'og-card');
  const head = el('h4', null, 'LIVE STATS');
  const reset = btn(null, 'reset', () => { pts = [0]; wag = 0; wins = 0; losses = 0; draw(); });
  reset.style.cssText = 'margin-left:auto;background:transparent;border:1px solid var(--line);color:var(--muted);border-radius:6px;font-size:11px;padding:2px 8px';
  head.append(reset);
  const grid = el('div', 'og-stats');
  const cells = ['Profit', 'Wagered', 'Wins', 'Losses'].map((n) => { const d = el('div'); const b = el('b', null, '0'); d.append(el('span', null, n), b); grid.append(d); return b; });
  const canvas = el('canvas', 'og-chart');
  card.append(head, grid, canvas);
  let pts = [0];
  let wag = 0; let wins = 0; let losses = 0;
  function draw() {
    const p = pts[pts.length - 1];
    cells[0].textContent = `${p >= 0 ? '+' : '-'}${money(Math.abs(p))}`;
    cells[0].className = p > 0 ? 'w' : p < 0 ? 'l' : '';
    cells[1].textContent = money(wag);
    cells[2].textContent = wins; cells[2].className = 'w';
    cells[3].textContent = losses; cells[3].className = 'l';
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300; const h = canvas.clientHeight || 70;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    const lo = Math.min(0, ...pts); const hi = Math.max(0, ...pts);
    const span = hi - lo || 1;
    const X = (i) => (pts.length < 2 ? 0 : (i / (pts.length - 1)) * w);
    const Y = (v) => 4 + (1 - (v - lo) / span) * (h - 8);
    const zero = Y(0);
    g.strokeStyle = 'rgba(136,144,184,.3)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(0, zero); g.lineTo(w, zero); g.stroke(); g.setLineDash([]);
    if (pts.length < 2) return;
    for (const [clipTop, color] of [[true, '39,224,124'], [false, '255,75,99']]) {
      g.save();
      g.beginPath();
      if (clipTop) g.rect(0, 0, w, zero); else g.rect(0, zero, w, h - zero);
      g.clip();
      g.beginPath(); g.moveTo(0, zero);
      pts.forEach((v, i) => g.lineTo(X(i), Y(v)));
      g.lineTo(w, zero); g.closePath();
      g.fillStyle = `rgba(${color},.18)`; g.fill();
      g.beginPath(); pts.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
      g.strokeStyle = `rgb(${color})`; g.lineWidth = 2; g.stroke();
      g.restore();
    }
  }
  requestAnimationFrame(draw);
  return {
    el: card,
    add(bet, profit) { wag += bet; if (profit > 0) wins++; else losses++; pts.push(round2(pts[pts.length - 1] + profit)); if (pts.length > 400) pts.splice(1, 1); draw(); },
  };
}

// The room's recent bets (everyone's), with an "Mine" filter.
export function feedCard(getMe) {
  const card = el('div', 'og-card');
  const head = el('h4', null, 'LIVE BETS');
  let mineOnly = false;
  let rows = [];
  let seen = new Set();
  const t = tabs(['All', 'Mine'], 'All', (n) => { mineOnly = n === 'Mine'; render(); });
  head.append(t.el);
  const table = el('table', 'og-feed');
  const thead = el('thead');
  const tr = el('tr');
  for (const h of ['Player', 'Bet', 'Multi', 'Payout']) tr.append(el('th', null, h));
  thead.append(tr);
  const tbody = el('tbody');
  table.append(thead, tbody);
  card.append(head, table);
  function render() {
    const me = getMe();
    tbody.replaceChildren();
    const list = rows.filter((r) => !mineOnly || r.id === me).slice(0, 12);
    for (const r of list) {
      const key = `${r.id}:${r.at}:${r.bet}`;
      const row = el('tr', seen.has(key) ? null : 'new');
      const x = el('span', `x${r.mult >= 10 ? ' hot' : ''}`, fmtX(r.mult));
      const cells = [el('td', null, r.name), el('td', null, money(r.bet)), el('td'), el('td', r.win > r.bet ? 'w' : 'l', `${r.win >= r.bet ? '+' : '-'}${money(Math.abs(r.win - r.bet))}`)];
      cells[2].append(x);
      row.append(...cells);
      tbody.append(row);
    }
    seen = new Set(rows.map((r) => `${r.id}:${r.at}:${r.bet}`));
    if (!list.length) { const e = el('tr'); const td = el('td', 'l', 'No bets yet.'); td.colSpan = 4; e.append(td); tbody.append(e); }
  }
  render();
  return { el: card, set(feed) { rows = feed || []; render(); } };
}

// Animated balance, ticking toward its new value.
export function balanceLine() {
  const line = el('div', 'og-balance');
  const b = el('b', null, money(0));
  line.append(el('span', null, 'Balance'), b);
  let shown = null; let timer = null;
  return {
    el: line,
    get value() { return shown || 0; },
    set(v) {
      if (shown == null || Math.abs(v - shown) < 0.005) { shown = v; b.textContent = money(v); return; }
      b.className = v > shown ? 'up' : 'down';
      const from = shown; shown = v;
      const t0 = performance.now();
      clearInterval(timer);
      timer = setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / 450);
        b.textContent = money(from + (v - from) * (1 - (1 - k) ** 3));
        if (k >= 1) { clearInterval(timer); setTimeout(() => { b.className = ''; }, 400); }
      }, 30);
    },
  };
}

// Confetti and a splash card over the stage for big hits.
export function celebrate(stage, mult, win) {
  const mega = mult >= 50;
  const s = el('div', `og-splash${mega ? ' mega' : ''}`);
  s.append(el('em', null, mega ? 'MEGA WIN' : 'BIG WIN'), el('b', null, fmtX(mult)), el('span', null, `+${money(win)}`));
  const c = el('div', 'og-confetti');
  const colors = ['#ffc94a', '#27e07c', '#5b7cff', '#9a5cff', '#ff4b63', '#ffffff'];
  for (let i = 0; i < (mega ? 90 : 45); i++) {
    const p = el('i');
    const a = Math.random() * Math.PI * 2; const d = 120 + Math.random() * 260;
    p.style.cssText = `background:${colors[i % colors.length]};--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d + 160}px;--r:${(Math.random() - 0.5) * 1080}deg;--t:${1.2 + Math.random()}s`;
    c.append(p);
  }
  stage.append(c, s);
  setTimeout(() => { s.remove(); c.remove(); }, 2300);
  sfx.play('win');
}

export const shake = (node) => { node.classList.remove('og-shake'); void node.offsetWidth; node.classList.add('og-shake'); };

// ---- Provably fair ----
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); }
export async function floats(server, client, nonce, count) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(server), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const out = [];
  for (let cursor = 0; out.length < count; cursor++) {
    const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${client}:${nonce}:${cursor}`)));
    for (let i = 0; i < 32 && out.length < count; i += 4) out.push(h[i] / 256 + h[i + 1] / 256 ** 2 + h[i + 2] / 256 ** 3 + h[i + 3] / 256 ** 4);
  }
  return out;
}

// The fairness modal. `seeds()` is the current {hash, client, nonce} (null for crash, whose seeds are
// per round); `rotate(client)` asks for a new pair; `verify` = { fields: [[key, label, default]], run(inputs) -> Promise<string> }.
export function fairButton({ seeds, rotate, verify, intro }) {
  let revealed = null;
  const open = (pre = {}) => {
    const m = el('div', 'og-modal og');
    const box = el('div', 'og-box');
    const close = btn(null, '✕', () => m.remove());
    const h = el('h3', null, 'Provably Fair');
    h.append(close);
    box.append(h, el('p', null, intro));
    const s = seeds && seeds();
    if (s) {
      const ro = (label, v) => { const n = numberInput({ value: '' }); n.input.type = 'text'; n.input.value = v; n.input.readOnly = true; n.input.classList.add('og-mono'); return field(label, n.el).el; };
      const client = numberInput({ value: '' });
      client.input.type = 'text'; client.input.value = s.client; client.input.classList.add('og-mono'); client.input.maxLength = 32;
      box.append(ro('Active server seed (hashed)', s.hash), field('Active client seed', client.el).el, ro('Bets made with this pair (nonce)', String(s.nonce)));
      box.append(btn('og-bet', 'Rotate seed pair', () => { rotate(client.input.value.trim() || null); m.remove(); }));
      if (revealed) box.append(el('p', null, 'Previous pair, server seed now revealed:'), ro('Server seed', revealed.server), ro('Client seed', revealed.client), ro('Bets made (nonces 0 to n-1)', String(revealed.nonces)));
    }
    box.append(el('h3', null, 'Verify a bet'));
    const inputs = {};
    for (const [k, label, d] of verify.fields) {
      const n = numberInput({ value: '' });
      n.input.type = 'text'; n.input.value = pre[k] ?? d ?? ''; n.input.classList.add('og-mono');
      inputs[k] = n.input;
      box.append(field(label, n.el).el);
    }
    const out = el('div', 'og-verify', 'Enter a revealed server seed to check a bet.');
    const go = btn('og-bet ghost', 'Verify', async () => {
      try {
        const vals = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()]));
        out.replaceChildren();
        const res = await verify.run(vals);
        if (vals.hash) {
          const ok = (await sha256(vals.server)) === vals.hash;
          out.append(el('div', ok ? 'ok' : 'bad', ok ? '✓ sha256(server seed) matches the hash shown before the bet' : '✗ sha256(server seed) does NOT match the hash'));
        }
        out.append(el('div', null, res));
      } catch (e) { out.textContent = `Could not verify: ${e.message}`; }
    });
    box.append(go, out);
    m.append(box);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    document.body.append(m);
    if (pre.server) go.click();
  };
  const b = btn(null, 'Fairness', () => open());
  return { el: b, open, reveal(prev) { revealed = prev; } };
}

// Space = the main action, unless typing in a field.
export function hotkey(fn) {
  const onKey = (ev) => {
    if (ev.code !== 'Space' || ev.repeat || ev.target.closest('input, textarea, select') || document.querySelector('.og-modal')) return;
    ev.preventDefault();
    fn();
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
