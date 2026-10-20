// Terminal Diner: a three-minute burger shift that pays into your casino balance. Every press goes
// to the server, which keeps the clock and scores each order. Server plugin: ../../../server/games/diner.js

import { sfx } from '../sfx.js';
import { makeServerClock } from '../serverClock.js';

const ICON = { lettuce: '🥬', tomato: '🍅', cheese: '🧀', onion: '🧅', pickles: '🥒', bacon: '🥓' };
const money = (n) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const REJECT = {
  shift_cap: "That's all the paid shifts for today. Come back tomorrow (UTC).",
  wallet_loading: 'Opening your casino balance… try again in a second.',
  plate_full: 'Serve or trash the burger on the board first.',
  no_patty: 'Put a patty on the board first (TAKE OFF a grill).',
  stack_full: 'That burger is tall enough.',
};

const CSS = `
.dn-root { display: flex; flex-direction: column; gap: 12px; padding: 8px; max-width: 760px; margin: 0 auto; }
.dn-top { display: flex; flex-wrap: wrap; gap: 6px 18px; justify-content: space-between; color: #ffbf00; }
.dn-row { display: flex; flex-wrap: wrap; gap: 10px; }
.dn-h { font-size: .8em; opacity: .7; letter-spacing: .1em; }
.dn-ticket { border: 1px solid #ffbf00; border-radius: 6px; padding: 8px; min-width: 130px; background: #f4f0e4; color: #222; display: flex; flex-direction: column; gap: 4px; }
.dn-ticket b { font-size: 1.05em; }
.dn-ticket .tops { font-size: 1.5em; letter-spacing: 2px; }
.dn-wait { height: 4px; background: #ccc; } .dn-wait i { display: block; height: 100%; background: #2a9d3a; }
.dn-grill { border: 1px solid #555; border-radius: 6px; padding: 8px; flex: 1 1 130px; max-width: 170px; display: flex; flex-direction: column; gap: 6px; align-items: center; background: #151515; }
.dn-grills { flex-wrap: nowrap; flex: 1 1 280px; max-width: 360px; }
.dn-patty { width: 90px; height: 34px; border-radius: 50%; border: 2px solid #000; }
.dn-bar { position: relative; width: 100%; height: 8px; background: #333; }
.dn-bar span { position: absolute; top: 0; height: 100%; opacity: .55; }
.dn-bar i { position: absolute; top: -3px; width: 2px; height: 14px; background: #fff; }
.dn-board { display: flex; flex-direction: column-reverse; align-items: center; min-height: 120px; min-width: 150px; gap: 1px; padding: 6px; border: 1px dashed #555; border-radius: 6px; }
.dn-layer { font-size: 1.4em; line-height: 1.1; }
.dn-bun { width: 110px; height: 16px; background: #d39b4a; border-radius: 4px; } .dn-bun.top { border-radius: 40px 40px 4px 4px; height: 22px; }
.dn-pad { display: grid; grid-template-columns: repeat(3, auto); gap: 6px; align-content: start; }
.dn-pad button { font-size: 1.1em; }
.dn-msg { min-height: 1.3em; color: #ff4d4d; }
.dn-big { font-size: 1.3em; padding: 8px 24px; border-color: #ffbf00; color: #ffbf00; }
.dn-card { text-align: center; display: flex; flex-direction: column; gap: 8px; align-items: center; }
`;

export function mount(container, api) {
  let view = null;
  let msg = '';
  const clock = makeServerClock();
  const style = document.createElement('style');
  style.textContent = CSS;
  const root = document.createElement('div');
  root.className = 'dn-root';
  container.append(style, root);

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (label, onClick, cls) => { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; };
  const send = (data) => api.sendAction(data);

  // Raw red to brown to charcoal as it cooks.
  function pattyColor(ms) {
    const t = Math.min(1, ms / view.rules.BURNT_MS);
    const stops = [[196, 64, 64], [150, 82, 50], [92, 52, 30], [25, 20, 18]];
    const x = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x));
    const f = x - i;
    return `rgb(${stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * f)).join(',')})`;
  }
  function donenessOf(ms) {
    if (ms >= view.rules.BURNT_MS) return 'BURNT';
    for (const [name, [lo, hi]] of Object.entries(view.rules.DONENESS)) if (ms >= lo && ms <= hi) return name.toUpperCase();
    return ms < view.rules.DONENESS.rare[0] ? 'raw' : '…';
  }
  const ZONE = { rare: '#d04040', medium: '#b07040', well: '#6a4a30' };

  const live = []; // [fn] run every frame-ish to move timers without rebuilding the buttons

  function render() {
    root.replaceChildren();
    live.length = 0;
    if (!view) { root.textContent = 'Loading…'; return; }
    const R = view.rules;
    if (view.phase !== 'shift') {
      const card = el('div', 'dn-card');
      card.append(el('h2', null, '🍔 TERMINAL DINER'));
      if (view.phase === 'done' && view.pay) {
        const p = view.pay;
        card.append(el('div', null, `Shift over: ${view.served.length} served, ${view.missed} walked out.`));
        card.append(el('div', null, `Tips ${money(view.tips)} + wage ${money(p.base)}${p.earned < view.tips + p.base ? ` (capped at ${money(R.PAY_CAP)})` : ''}`));
        card.append(el('div', 'casino-balance', p.paid ? `PAID ${money(p.paid)}` : 'No pay: today\'s paid shifts were already used up.'));
      } else {
        card.append(el('div', null, `Three-minute shift. Grill each patty to the ticket's doneness, stack the toppings in the order shown (bottom first), serve fast. Wage ${money(R.BASE_PAY)} for ${R.BASE_MIN_SERVED}+ orders plus up to ${money(R.TIP_MAX)} tip each, ${money(R.PAY_CAP)} max.`));
      }
      if (view.balance != null) card.append(el('div', 'muted', `Balance ${money(view.balance)} · ${view.shiftsLeft} paid shift${view.shiftsLeft === 1 ? '' : 's'} left today`));
      const go = btn(view.phase === 'done' ? 'ANOTHER SHIFT' : 'START SHIFT', () => { sfx.play('click'); send({ kind: 'start' }); }, 'dn-big');
      go.disabled = view.shiftsLeft === 0;
      card.append(go, el('div', 'dn-msg', msg));
      root.append(card);
      return;
    }

    const top = el('div', 'dn-top');
    const timer = el('span');
    live.push(() => { const s = Math.max(0, Math.ceil((view.endsAt - clock.now()) / 1000)); timer.textContent = `SHIFT ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; });
    top.append(timer, el('span', null, `SERVED ${view.served.length} · TIPS ${money(view.tips)}`));
    if (view.served.length) { const last = view.served[view.served.length - 1]; top.append(el('span', null, `LAST ${last.score}% +${money(last.tip)}`)); }
    root.append(top);

    root.append(el('div', 'dn-h', 'TICKETS (toppings listed bottom to top)'));
    const tickets = el('div', 'dn-row');
    if (!view.tickets.length) tickets.append(el('span', 'muted', 'No customers right now…'));
    for (const t of view.tickets) {
      const card = el('div', 'dn-ticket');
      const bar = el('div', 'dn-wait');
      const fill = el('i');
      bar.append(fill);
      live.push(() => { const left = 1 - (clock.now() - t.at) / R.WALK_OUT_MS; fill.style.width = `${Math.max(0, left) * 100}%`; fill.style.background = left < 0.3 ? '#d04040' : '#2a9d3a'; });
      card.append(el('b', null, `#${t.id} ${t.doneness.toUpperCase()}`), el('div', 'tops', t.toppings.map((x) => ICON[x]).join('')), el('small', null, t.toppings.join(', ')), bar,
        btn('SERVE', () => { sfx.play('point'); send({ kind: 'serve', ticket: t.id }); }));
      tickets.append(card);
    }
    root.append(tickets);

    const work = el('div', 'dn-row');
    const grills = el('div', 'dn-row dn-grills');
    view.grills.forEach((g, i) => {
      const box = el('div', 'dn-grill');
      box.append(el('div', 'dn-h', `GRILL ${i + 1} (${i ? 'W' : 'Q'})`));
      if (!g) {
        box.append(el('div', 'dn-patty', null), btn('PATTY ON', () => { sfx.play('click'); send({ kind: 'grill', slot: i }); }));
        box.firstChild.nextSibling.style.visibility = 'hidden';
      } else {
        const patty = el('div', 'dn-patty');
        const label = el('div');
        const bar = el('div', 'dn-bar');
        for (const [name, [lo, hi]] of Object.entries(R.DONENESS)) {
          const z = el('span');
          Object.assign(z.style, { left: `${(lo / R.BURNT_MS) * 100}%`, width: `${((hi - lo) / R.BURNT_MS) * 100}%`, background: ZONE[name] });
          z.title = name;
          bar.append(z);
        }
        const needle = el('i');
        bar.append(needle);
        live.push(() => {
          const ms = Math.max(0, clock.now() - g.at);
          patty.style.background = pattyColor(ms);
          label.textContent = `${(ms / 1000).toFixed(1)}s ${donenessOf(ms)}`;
          needle.style.left = `${Math.min(100, (ms / R.BURNT_MS) * 100)}%`;
        });
        box.append(patty, label, bar, btn('TAKE OFF', () => { sfx.play('click'); send({ kind: 'plate', slot: i }); }), btn('SCRAPE', () => send({ kind: 'scrape', slot: i })));
      }
      grills.append(box);
    });
    work.append(grills);

    const board = el('div', 'dn-board');
    board.append(el('div', 'dn-bun'));
    const b = view.build;
    if (b.patty) {
      const p = el('div', 'dn-patty');
      p.style.background = pattyColor(b.patty.cooked);
      p.style.height = '20px';
      p.title = donenessOf(b.patty.cooked);
      board.append(p);
    }
    for (const x of b.toppings) board.append(el('div', 'dn-layer', ICON[x]));
    if (b.patty || b.toppings.length) board.append(el('div', 'dn-bun top'));
    const boardCol = el('div');
    boardCol.append(el('div', 'dn-h', b.patty ? `BOARD · ${donenessOf(b.patty.cooked)}` : 'BOARD'), board);
    work.append(boardCol);

    const pad = el('div', 'dn-pad');
    R.TOPPINGS.forEach((x, i) => pad.append(btn(`${ICON[x]} ${i + 1}`, () => { sfx.play('tick'); send({ kind: 'top', item: x }); })));
    pad.append(btn('TRASH (X)', () => send({ kind: 'trash' })));
    const padCol = el('div');
    padCol.append(el('div', 'dn-h', 'TOPPINGS'), pad);
    work.append(padCol);
    root.append(work, el('div', 'dn-msg', msg));
    for (const fn of live) fn();
  }

  const frame = setInterval(() => { for (const fn of live) fn(); }, 100);
  const onKey = (ev) => {
    if (!view || view.phase !== 'shift' || ev.target.closest('input, textarea')) return;
    const k = ev.key.toLowerCase();
    const n = Number(k);
    if (n >= 1 && n <= view.rules.TOPPINGS.length) send({ kind: 'top', item: view.rules.TOPPINGS[n - 1] });
    else if (k === 'q' || k === 'w') { const slot = k === 'q' ? 0 : 1; send({ kind: view.grills[slot] ? 'plate' : 'grill', slot }); }
    else if (k === 'x') send({ kind: 'trash' });
    else return;
    ev.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  function apply(data) {
    clock.sync(data.serverNow);
    const prev = view;
    view = data;
    if (prev && prev.phase === 'shift' && data.phase === 'done') sfx.play('win');
    if (prev && data.tickets.length > prev.tickets.length && data.phase === 'shift') sfx.play('chips');
    msg = '';
    render();
  }

  render();
  return {
    applySnapshot: apply,
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') apply(data);
      else if (data.kind === 'moveRejected') { sfx.play('error'); msg = REJECT[data.reason] || ''; render(); }
    },
    applyRoster() {},
    unmount() { clearInterval(frame); document.removeEventListener('keydown', onKey); container.innerHTML = ''; },
  };
}
