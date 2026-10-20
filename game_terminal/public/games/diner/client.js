// Terminal Diner: a three-minute burger shift that pays into your casino balance. Every press goes
// to the server, which keeps the clock and scores each order. Server plugin: ../../../server/games/diner.js

import { sfx } from '../sfx.js';
import { makeServerClock } from '../serverClock.js';

const ICON = { lettuce: '🥬', tomato: '🍅', cheese: '🧀', onion: '🧅', pickles: '🥒', bacon: '🥓' };
const FACES = ['🧑', '👩', '👨‍🦰', '👵', '🧔', '👧', '👴', '👩‍🦱', '🧑‍🦲', '👱'];
const money = (n) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const REJECT = {
  shift_cap: "That's all the paid shifts for today. Come back tomorrow (UTC).",
  wallet_loading: 'Opening your casino balance… try again in a second.',
  plate_full: 'Serve or trash the burger on the board first.',
  no_patty: 'Put a patty on the board first: click a cooking patty to plate it.',
  stack_full: 'That burger is tall enough.',
};

const CSS = `
.dn-wrap { position: relative; }
.dn-root { display: flex; flex-direction: column; gap: 10px; padding: 8px; max-width: 780px; margin: 0 auto; user-select: none; }
.dn-top { display: flex; flex-wrap: wrap; gap: 6px 18px; justify-content: space-between; align-items: center; color: #ffbf00; font-size: 1.05em; }
.dn-clock { font-size: 1.3em; font-weight: bold; } .dn-clock.low { color: #ff4d4d; animation: dn-blink 1s steps(2) infinite; }
.dn-h { font-size: .75em; opacity: .7; letter-spacing: .12em; }
.dn-counter { display: flex; gap: 10px; flex-wrap: wrap; min-height: 150px; padding: 10px; border-radius: 8px 8px 0 0;
  background: linear-gradient(#2a1a10, #3b2414); border-bottom: 10px solid #8a5a2b; align-items: flex-end; }
.dn-cust { flex: 1 1 150px; max-width: 220px; display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; border-radius: 8px; padding: 4px; border: 2px solid transparent; transition: transform .12s; animation: dn-in .35s ease-out; }
.dn-cust:hover { transform: translateY(-3px); }
.dn-cust.can:hover, .dn-cust.next { border-color: #ffd23f; box-shadow: 0 0 14px rgba(255,210,63,.45); }
.dn-face { font-size: 2.6em; line-height: 1; position: relative; }
.dn-mood { position: absolute; right: -14px; top: -6px; font-size: .45em; }
.dn-slip { background: #f4f0e4; color: #222; border-radius: 4px; padding: 6px 8px; width: 100%; box-sizing: border-box; box-shadow: 0 2px 0 #b9b0a0; font-size: .85em; display: flex; flex-direction: column; gap: 4px; }
.dn-slip-h { display: flex; justify-content: space-between; align-items: center; font-weight: bold; }
.dn-tag { padding: 0 6px; border-radius: 3px; color: #fff; font-size: .85em; }
.dn-tag.rare { background: #c0392b; } .dn-tag.medium { background: #a0622d; } .dn-tag.well { background: #5a3d26; }
.dn-tag.ok { outline: 2px solid #2a9d3a; }
.dn-want { display: flex; gap: 2px; font-size: 1.35em; flex-wrap: wrap; }
.dn-want span { border-radius: 4px; padding: 0 1px; opacity: .55; }
.dn-want span.ok { background: #b6f0c0; opacity: 1; } .dn-want span.bad { background: #f5b5b5; opacity: 1; }
.dn-wait { height: 5px; background: #ccc; border-radius: 3px; overflow: hidden; } .dn-wait i { display: block; height: 100%; }
.dn-serve { font-size: .75em; text-align: center; color: #7a6a50; min-height: 1.2em; }
.dn-cust.next .dn-serve { color: #b07a00; font-weight: bold; }
.dn-empty { color: #c9a27a; opacity: .7; align-self: center; margin: auto; }
.dn-kitchen { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(130px, .8fr) minmax(0, 1fr); gap: 10px; }
.dn-griddle { display: flex; gap: 8px; padding: 10px; border-radius: 8px; border: 3px solid #555;
  background: repeating-linear-gradient(90deg, #2b2b2b 0 14px, #222 14px 16px), #222; }
.dn-burner { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 6px 4px; border-radius: 6px; background: rgba(0,0,0,.35); position: relative; justify-content: center; }
.dn-spot { width: 100%; height: 70px; display: flex; align-items: center; justify-content: center; border-radius: 50%; cursor: pointer; position: relative; }
.dn-spot.empty { border: 2px dashed #666; color: #888; font-size: .85em; white-space: pre-line; text-align: center; }
.dn-spot.empty:hover { border-color: #ffd23f; color: #ffd23f; }
.dn-patty { width: 86px; height: 46px; border-radius: 50%; border: 2px solid rgba(0,0,0,.6); box-shadow: inset 0 -6px 8px rgba(0,0,0,.35), inset 0 4px 6px rgba(255,255,255,.12); position: relative; }
.dn-spot:not(.empty):hover .dn-patty { outline: 3px solid #ffd23f; }
.dn-steam { position: absolute; left: 50%; top: -6px; width: 60px; margin-left: -30px; height: 30px; pointer-events: none; }
.dn-steam i { position: absolute; bottom: 0; width: 8px; height: 18px; border-radius: 50%; background: rgba(230,230,230,.5); filter: blur(3px); animation: dn-steam 1.4s ease-out infinite; }
.dn-steam i:nth-child(2) { left: 26px; animation-delay: .45s; } .dn-steam i:nth-child(3) { left: 48px; animation-delay: .9s; }
.dn-steam.smoke i { background: rgba(60,60,60,.85); width: 14px; height: 24px; }
.dn-read { font-size: .85em; font-weight: bold; }
.dn-bar { position: relative; width: 100%; height: 10px; background: #333; border-radius: 3px; }
.dn-bar span { position: absolute; top: 0; height: 100%; opacity: .7; }
.dn-bar i { position: absolute; top: -3px; width: 3px; height: 16px; background: #fff; box-shadow: 0 0 4px #fff; }
.dn-scrape { position: absolute; top: 4px; right: 4px; padding: 0 6px; font-size: .8em; border-color: #d04040; color: #ff6b6b; }
.dn-key { font-size: .7em; opacity: .6; }
.dn-boardcol { display: flex; flex-direction: column; gap: 6px; align-items: center; }
.dn-board { width: 100%; min-height: 150px; padding: 8px 6px; box-sizing: border-box; display: flex; flex-direction: column-reverse; align-items: center; justify-content: flex-start;
  border-radius: 10px; background: linear-gradient(135deg, #b9844e, #8f5f30); border: 2px solid #6b4220; }
.dn-l { width: 110px; height: 12px; border-radius: 4px; margin-top: -2px; display: flex; align-items: center; justify-content: center; font-size: .75em; box-shadow: 0 1px 0 rgba(0,0,0,.3); animation: dn-drop .18s ease-out; }
.dn-l.bun { background: #d9a057; height: 16px; border-radius: 4px 4px 10px 10px; }
.dn-l.bun.top { height: 26px; border-radius: 55px 55px 5px 5px; background: radial-gradient(circle at 30% 30%, #f7f0d8 1.5px, transparent 2px) 0 0/14px 10px, #d9a057; }
.dn-l.meat { height: 18px; width: 104px; border-radius: 8px; }
.dn-l.lettuce { background: #5cb85c; height: 9px; border-radius: 10px; width: 118px; } .dn-l.tomato { background: #e0443e; height: 8px; width: 100px; }
.dn-l.cheese { background: #ffcc33; height: 6px; width: 116px; border-radius: 2px; } .dn-l.onion { background: #c8a2d6; height: 7px; width: 98px; }
.dn-l.pickles { background: #6b8e23; height: 7px; width: 96px; } .dn-l.bacon { background: repeating-linear-gradient(90deg, #a83a2a 0 10px, #e8a07a 10px 14px); height: 8px; width: 112px; }
.dn-l.last { cursor: pointer; } .dn-l.last:hover { outline: 2px solid #ffd23f; }
.dn-boardnote { font-size: .8em; text-align: center; min-height: 1.2em; }
.dn-pad { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; align-content: start; }
.dn-bin { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 6px 8px; font-size: 1em; }
.dn-bin b { font-size: 1.5em; }
.dn-actions { display: flex; gap: 6px; grid-column: 1 / -1; }
.dn-actions button { flex: 1; min-width: 0; padding: 6px 2px; font-size: .85em; }
.dn-msg { min-height: 1.3em; color: #ff4d4d; text-align: center; }
.dn-help { font-size: .75em; opacity: .6; text-align: center; }
.dn-big { font-size: 1.3em; padding: 8px 24px; border-color: #ffbf00; color: #ffbf00; }
.dn-card { text-align: center; display: flex; flex-direction: column; gap: 8px; align-items: center; }
.dn-fx { position: absolute; left: 0; right: 0; top: 40px; pointer-events: none; display: flex; flex-direction: column; align-items: center; gap: 4px; z-index: 5; }
.dn-pop { padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 1.15em; background: #ffd23f; color: #222; box-shadow: 0 2px 10px rgba(0,0,0,.5); animation: dn-pop 1.8s ease-out forwards; }
.dn-pop.bad { background: #d04040; color: #fff; }
@keyframes dn-pop { 0% { transform: scale(.4); opacity: 0; } 12% { transform: scale(1.15); opacity: 1; } 25% { transform: scale(1); } 75% { opacity: 1; } 100% { transform: translateY(-40px); opacity: 0; } }
@keyframes dn-steam { 0% { transform: translateY(0) scaleX(1); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateY(-26px) scaleX(1.8); opacity: 0; } }
@keyframes dn-drop { from { transform: translateY(-14px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes dn-in { from { transform: translateX(30px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes dn-blink { 50% { opacity: .4; } }
@media (max-width: 640px) {
  .dn-kitchen { grid-template-columns: 1fr 1fr; }
  .dn-griddle { grid-column: 1 / -1; }
  .dn-cust { flex-basis: 95px; } .dn-face { font-size: 2em; }
  .dn-want { font-size: 1.1em; }
  .dn-help { display: none; }
}
`;

export function mount(container, api) {
  let view = null;
  let msg = '';
  const clock = makeServerClock();
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = document.createElement('div');
  wrap.className = 'dn-wrap';
  const root = document.createElement('div');
  root.className = 'dn-root';
  const fx = document.createElement('div');
  fx.className = 'dn-fx';
  wrap.append(root, fx);
  container.append(style, wrap);

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (label, onClick, cls) => { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); }); return b; };
  const send = (data) => api.sendAction(data);
  const pop = (text, bad) => { const p = el('div', `dn-pop${bad ? ' bad' : ''}`, text); fx.append(p); setTimeout(() => p.remove(), 1900); };

  // Raw red to brown to charcoal as it cooks.
  function pattyColor(ms) {
    const t = Math.min(1, ms / view.rules.BURNT_MS);
    const stops = [[196, 64, 64], [150, 82, 50], [92, 52, 30], [25, 20, 18]];
    const x = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x));
    const f = x - i;
    return `rgb(${stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * f)).join(',')})`;
  }
  function donenessKey(ms) {
    if (ms >= view.rules.BURNT_MS) return 'burnt';
    for (const [name, [lo, hi]] of Object.entries(view.rules.DONENESS)) if (ms >= lo && ms <= hi) return name;
    return ms < view.rules.DONENESS.rare[0] ? 'raw' : 'between';
  }
  const donenessLabel = (ms) => ({ burnt: 'BURNT', raw: 'raw', between: '…' }[donenessKey(ms)] || donenessKey(ms).toUpperCase());
  const ZONE = { rare: '#d04040', medium: '#b07040', well: '#6a4a30' };

  // Who the burger on the board fits best (what SPACE serves): right doneness, then most toppings
  // in the right place, then whoever has waited longest.
  function bestTicket() {
    const b = view.build;
    if (!b.patty || !view.tickets.length) return null;
    const cook = donenessKey(b.patty.cooked);
    const fit = (t) => (t.doneness === cook ? 100 : 0) + t.toppings.filter((x, i) => b.toppings[i] === x).length * 10
      - Math.abs(t.toppings.length - b.toppings.length) * 5;
    return view.tickets.reduce((best, t) => (!best || fit(t) > fit(best) || (fit(t) === fit(best) && t.at < best.at) ? t : best), null);
  }
  const serve = (t) => { if (t) send({ kind: 'serve', ticket: t.id }); };

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
        const avg = view.served.length ? Math.round(view.served.reduce((a, s) => a + s.score, 0) / view.served.length) : 0;
        card.append(el('div', null, `Shift over: ${view.served.length} served (avg ${avg}%), ${view.missed} walked out.`));
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

    const b = view.build;
    const next = bestTicket();

    const top = el('div', 'dn-top');
    const timer = el('span', 'dn-clock');
    live.push(() => {
      const s = Math.max(0, Math.ceil((view.endsAt - clock.now()) / 1000));
      timer.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      timer.classList.toggle('low', s <= 20);
    });
    top.append(timer, el('span', null, `SERVED ${view.served.length} · TIPS ${money(view.tips)}`));
    if (view.served.length) { const last = view.served[view.served.length - 1]; top.append(el('span', null, `LAST ${last.score}% +${money(last.tip)}`)); }
    root.append(top);

    // The counter: one customer per ticket. Click one (or SPACE for the highlighted one) to serve.
    const counter = el('div', 'dn-counter');
    if (!view.tickets.length) counter.append(el('div', 'dn-empty', 'No customers right now… get a patty going.'));
    for (const t of view.tickets) {
      const cust = el('div', `dn-cust${b.patty ? ' can' : ''}${next === t ? ' next' : ''}`);
      cust.title = b.patty ? `Serve the burger on the board to #${t.id}` : 'Plate a patty first';
      cust.addEventListener('click', () => serve(t));
      const face = el('div', 'dn-face', FACES[t.id % FACES.length]);
      const mood = el('span', 'dn-mood');
      face.append(mood);
      const slip = el('div', 'dn-slip');
      const tag = el('span', `dn-tag ${t.doneness}${b.patty && donenessKey(b.patty.cooked) === t.doneness ? ' ok' : ''}`, t.doneness.toUpperCase());
      const head = el('div', 'dn-slip-h');
      head.append(el('span', null, `#${t.id}`), tag);
      const want = el('div', 'dn-want');
      t.toppings.forEach((x, i) => {
        const s = el('span', b.toppings[i] == null ? '' : b.toppings[i] === x ? 'ok' : 'bad', ICON[x]);
        s.title = x;
        want.append(s);
      });
      const bar = el('div', 'dn-wait');
      const fill = el('i');
      bar.append(fill);
      live.push(() => {
        const left = Math.max(0, 1 - (clock.now() - t.at) / R.WALK_OUT_MS);
        fill.style.width = `${left * 100}%`;
        fill.style.background = left < 0.3 ? '#d04040' : left < 0.6 ? '#e0a020' : '#2a9d3a';
        mood.textContent = left < 0.3 ? '😠' : left < 0.6 ? '😐' : '🙂';
      });
      slip.append(head, want, bar, el('div', 'dn-serve', next === t ? 'SERVE ▸ SPACE' : b.patty ? 'click to serve' : ''));
      cust.append(face, slip);
      counter.append(cust);
    }
    root.append(counter);

    const kitchen = el('div', 'dn-kitchen');

    // Griddle: click an empty spot to drop a patty, click a patty to plate it, ✕ scrapes it.
    const griddle = el('div', 'dn-griddle');
    view.grills.forEach((g, i) => {
      const burner = el('div', 'dn-burner');
      const spot = el('div', `dn-spot${g ? '' : ' empty'}`);
      if (!g) {
        spot.textContent = `+ PATTY\n${i ? 'W' : 'Q'}`;
        spot.addEventListener('click', () => { sfx.play('whoosh'); send({ kind: 'grill', slot: i }); });
        burner.append(spot, el('div', 'dn-read', ' '));
      } else {
        const patty = el('div', 'dn-patty');
        const steam = el('div', 'dn-steam');
        steam.append(el('i'), el('i'), el('i'));
        patty.append(steam);
        spot.append(patty);
        spot.title = 'Click to plate it';
        spot.addEventListener('click', () => { sfx.play('click'); send({ kind: 'plate', slot: i }); });
        const read = el('div', 'dn-read');
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
          const k = donenessKey(ms);
          patty.style.background = pattyColor(ms);
          steam.classList.toggle('smoke', k === 'burnt');
          read.textContent = `${(ms / 1000).toFixed(1)}s ${donenessLabel(ms)}`;
          read.style.color = k === 'burnt' ? '#ff4d4d' : ZONE[k] ? '#7dff9a' : '#ccc';
          needle.style.left = `${Math.min(100, (ms / R.BURNT_MS) * 100)}%`;
        });
        burner.append(btn('✕', () => { sfx.play('crash'); send({ kind: 'scrape', slot: i }); }, 'dn-scrape'), spot, read, bar,
          el('div', 'dn-key', `${i ? 'W' : 'Q'} plate · ${i ? 'R' : 'E'} scrape`));
      }
      griddle.append(burner);
    });
    kitchen.append(griddle);

    // The board, drawn bottom bun up. Click the top topping (or BACKSPACE) to take it back off.
    const boardCol = el('div', 'dn-boardcol');
    const board = el('div', 'dn-board');
    board.append(el('div', 'dn-l bun'));
    if (b.patty) {
      const meat = el('div', 'dn-l meat');
      meat.style.background = pattyColor(b.patty.cooked);
      board.append(meat);
    }
    b.toppings.forEach((x, i) => {
      const layer = el('div', `dn-l ${x}${i === b.toppings.length - 1 ? ' last' : ''}`);
      layer.title = x;
      if (i === b.toppings.length - 1) { layer.title = `${x}: click to take it off`; layer.addEventListener('click', () => { sfx.play('pop'); send({ kind: 'untop' }); }); }
      board.append(layer);
    });
    if (b.patty || b.toppings.length) board.append(el('div', 'dn-l bun top'));
    boardCol.append(el('div', 'dn-h', 'BOARD'), board,
      el('div', 'dn-boardnote', b.patty ? `${donenessLabel(b.patty.cooked)} patty${next ? ` · fits #${next.id}` : ''}` : b.toppings.length ? 'needs a patty' : 'empty'));
    kitchen.append(boardCol);

    const pad = el('div', 'dn-pad');
    R.TOPPINGS.forEach((x, i) => {
      const bin = btn('', () => { sfx.play('tick'); send({ kind: 'top', item: x }); }, 'dn-bin');
      bin.title = x;
      bin.append(el('b', null, ICON[x]), el('span', 'dn-key', String(i + 1)));
      pad.append(bin);
    });
    const actions = el('div', 'dn-actions');
    actions.append(btn('↶ UNDO', () => send({ kind: 'untop' })), btn('🗑 TRASH', () => { sfx.play('crash'); send({ kind: 'trash' }); }));
    const serveBtn = btn('SERVE ▸', () => serve(next));
    serveBtn.disabled = !next;
    actions.append(serveBtn);
    pad.append(actions);
    const padCol = el('div', 'dn-boardcol');
    padCol.append(el('div', 'dn-h', 'TOPPINGS'), pad);
    kitchen.append(padCol);

    root.append(kitchen, el('div', 'dn-msg', msg),
      el('div', 'dn-help', 'Q/W patty on or plate · E/R scrape · 1-6 toppings · BACKSPACE undo · X trash · SPACE serve the highlighted customer'));
    for (const fn of live) fn();
  }

  const frame = setInterval(() => { for (const fn of live) fn(); }, 100);
  const onKey = (ev) => {
    if (!view || view.phase !== 'shift' || ev.target.closest('input, textarea')) return;
    const k = ev.key.toLowerCase();
    const n = Number(k);
    if (n >= 1 && n <= view.rules.TOPPINGS.length) send({ kind: 'top', item: view.rules.TOPPINGS[n - 1] });
    else if (k === 'q' || k === 'w') { const slot = k === 'q' ? 0 : 1; send({ kind: view.grills[slot] ? 'plate' : 'grill', slot }); }
    else if (k === 'e' || k === 'r') send({ kind: 'scrape', slot: k === 'e' ? 0 : 1 });
    else if (k === 'x') send({ kind: 'trash' });
    else if (k === 'backspace') send({ kind: 'untop' });
    else if (k === ' ' || k === 'enter') serve(bestTicket());
    else return;
    ev.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  function apply(data) {
    clock.sync(data.serverNow);
    const prev = view;
    view = data;
    if (prev && prev.phase === 'shift' && data.phase === 'done') sfx.play('win');
    if (prev && prev.phase === 'shift' && data.phase === 'shift') {
      if (data.tickets.length > prev.tickets.length) sfx.play('chime');
      if (data.served.length > prev.served.length) {
        const s = data.served[data.served.length - 1];
        sfx.play(s.score >= 60 ? 'chips' : 'point');
        pop(`${s.score >= 90 ? '😋' : s.score >= 60 ? '🙂' : '😕'} ${s.score}% · +${money(s.tip)} tip`);
      }
      if (data.missed > prev.missed) { sfx.play('lose'); pop('😠 A customer walked out', true); }
    }
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
