// The shift: customers at the counter, the griddle, the board and the topping bins. Every press is
// sent to the server; `live` callbacks move the timers between state updates.
import { ICON, face, setMood } from './art.js';

export const GRILL_KEYS = ['q', 'w', 'e', 'r'];
const ZONE = { rare: '#e05050', medium: '#c07a40', well: '#7a5236' };

export function makeCook(c) {
  const R = () => c.view.rules;
  // Raw red to brown to charcoal as it cooks.
  function pattyColor(ms) {
    const t = Math.min(1, ms / R().BURNT_MS);
    const stops = [[214, 82, 82], [160, 92, 56], [100, 58, 34], [30, 24, 20]];
    const x = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x));
    const f = x - i;
    return `rgb(${stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f)).join(',')})`;
  }
  function donenessKey(ms) {
    if (ms >= R().BURNT_MS) return 'burnt';
    for (const [name, [lo, hi]] of Object.entries(R().DONENESS)) if (ms >= lo && ms <= hi) return name;
    return ms < R().DONENESS.rare[0] ? 'raw' : 'between';
  }
  const donenessLabel = (ms) => ({ burnt: 'BURNT!', raw: 'raw', between: '…' }[donenessKey(ms)] || donenessKey(ms).toUpperCase());
  // Who the burger on the board fits best (what SPACE serves): right doneness, then most toppings
  // in the right place, then whoever has waited longest.
  function bestTicket() {
    const { build: b, tickets } = c.view;
    if (!b.patty || !tickets.length) return null;
    const cook = donenessKey(b.patty.cooked);
    const fit = (t) => (t.doneness === cook ? 100 : 0) + t.toppings.filter((x, i) => b.toppings[i] === x).length * 10
      - Math.abs(t.toppings.length - b.toppings.length) * 5;
    return tickets.reduce((best, t) => (!best || fit(t) > fit(best) || (fit(t) === fit(best) && t.at < best.at) ? t : best), null);
  }
  return { pattyColor, donenessKey, donenessLabel, bestTicket };
}

export function renderKitchen(c, cook, rang) {
  const { view, el, btn, send, sfx, money, clock, live } = c;
  const R = view.rules;
  const b = view.build;
  const next = cook.bestTicket();
  const serve = (t) => { if (t) send({ kind: 'serve', ticket: t.id }); };
  const page = el('div', 'dn-shift');

  const top = el('div', 'dn-top');
  const timer = el('span', 'dn-pill dn-clock');
  live.push(() => {
    const s = Math.max(0, Math.ceil((view.endsAt - clock.now()) / 1000));
    timer.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    timer.classList.toggle('low', s <= 20);
  });
  top.append(timer, el('span', 'dn-pill', `🍔 ${view.served.length} served`), el('span', 'dn-pill money', `💰 ${money(view.revenue + view.tips)}`));
  page.append(top);

  // The counter: one customer per ticket. Click one (or SPACE for the highlighted one) to serve.
  const counter = el('div', 'dn-counter');
  if (!view.tickets.length) counter.append(el('div', 'dn-empty', 'No customers yet… get a patty going!'));
  for (const t of view.tickets) {
    const cust = el('div', `dn-cust${b.patty ? ' can' : ''}${next === t ? ' next' : ''}`);
    cust.title = b.patty ? `Serve the burger on the board to #${t.id}` : 'Plate a patty first';
    cust.addEventListener('click', () => serve(t));
    const ring = el('div', 'dn-ring');
    const f = face(t.id, 'happy');
    ring.append(f);
    const slip = el('div', 'dn-slip');
    const head = el('div', 'dn-slip-h');
    head.append(el('span', null, `#${t.id}`), el('span', `dn-tag ${t.doneness}${b.patty && cook.donenessKey(b.patty.cooked) === t.doneness ? ' ok' : ''}`, t.doneness.toUpperCase()));
    const want = el('div', 'dn-want');
    t.toppings.forEach((x, i) => {
      const s = el('span', b.toppings[i] == null ? '' : b.toppings[i] === x ? 'ok' : 'bad', ICON[x]);
      s.title = x;
      want.append(s);
    });
    let mood = 'happy';
    live.push(() => {
      const left = Math.max(0, 1 - (clock.now() - t.at) / R.WALK_OUT_MS);
      const color = left < 0.3 ? '#e74c3c' : left < 0.6 ? '#f39c12' : '#2ecc71';
      ring.style.background = `conic-gradient(${color} ${left * 360}deg, rgba(0,0,0,.15) 0)`;
      const m = left < 0.3 ? 'mad' : left < 0.6 ? 'meh' : 'happy';
      if (m !== mood) { mood = m; setMood(f, m); }
    });
    slip.append(head, want, el('div', 'dn-serve', next === t ? 'SERVE ▸ SPACE' : b.patty ? 'click to serve' : ''));
    cust.append(ring, slip);
    counter.append(cust);
  }
  page.append(counter);

  const kitchen = el('div', 'dn-kitchen');

  // Griddle: click an empty spot to drop a patty, click a patty to plate it, ✕ scrapes it.
  const griddle = el('div', 'dn-griddle');
  view.grills.forEach((g, i) => {
    const key = GRILL_KEYS[i].toUpperCase();
    const burner = el('div', 'dn-burner');
    const spot = el('div', `dn-spot${g ? '' : ' empty'}`);
    if (!g) {
      spot.append(el('b', null, '+ PATTY'), el('span', 'dn-key', key));
      spot.addEventListener('click', () => { sfx.play('whoosh'); send({ kind: 'grill', slot: i }); });
      burner.append(spot);
    } else {
      const patty = el('div', 'dn-patty');
      const steam = el('div', 'dn-steam');
      steam.append(el('i'), el('i'), el('i'));
      patty.append(steam);
      spot.append(patty);
      spot.title = 'Click to plate it';
      spot.addEventListener('click', () => { sfx.play('pop'); send({ kind: 'plate', slot: i }); });
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
        const k = cook.donenessKey(ms);
        patty.style.background = cook.pattyColor(ms);
        steam.classList.toggle('smoke', k === 'burnt');
        read.textContent = `${(ms / 1000).toFixed(1)}s ${cook.donenessLabel(ms)}`;
        read.style.color = k === 'burnt' ? '#e74c3c' : ZONE[k] ? '#1e8449' : '#555';
        needle.style.left = `${Math.min(100, (ms / R.BURNT_MS) * 100)}%`;
        // The doneness bell: glow (and one ding) while it's cooked the way a waiting ticket wants it.
        const wanted = view.perks.bell && view.tickets.some((t) => t.doneness === k);
        spot.classList.toggle('ready', wanted);
        const tag = `${g.at}:${k}`;
        if (wanted && !rang.has(tag)) { rang.add(tag); sfx.play('check'); }
      });
      burner.append(btn('✕', () => { sfx.play('crash'); send({ kind: 'scrape', slot: i }); }, 'dn-scrape'), spot, read, bar,
        el('div', 'dn-key', `${key} plate · shift+${key} scrape`));
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
    meat.style.background = cook.pattyColor(b.patty.cooked);
    board.append(meat);
  }
  b.toppings.forEach((x, i) => {
    const layer = el('div', `dn-l ${x}`);
    layer.title = x;
    if (i === b.toppings.length - 1) { layer.title = `${x}: click to take it off`; layer.addEventListener('click', () => { sfx.play('pop'); send({ kind: 'untop' }); }); }
    board.append(layer);
  });
  if (b.patty || b.toppings.length) board.append(el('div', 'dn-l bun top'));
  boardCol.append(el('div', 'dn-h', 'BOARD'), board,
    el('div', 'dn-boardnote', b.patty ? `${cook.donenessLabel(b.patty.cooked)} patty${next ? ` · fits #${next.id}` : ''}` : b.toppings.length ? 'needs a patty' : 'empty'));
  kitchen.append(boardCol);

  const pad = el('div', 'dn-pad');
  R.TOPPINGS.forEach((x, i) => {
    const bin = btn('', () => { sfx.play('tick'); send({ kind: 'top', item: x }); }, 'dn-bin');
    bin.title = x;
    bin.append(el('b', null, ICON[x]), el('span', 'dn-key', String((i + 1) % 10)));
    pad.append(bin);
  });
  const actions = el('div', 'dn-actions');
  actions.append(btn('↶ UNDO', () => send({ kind: 'untop' }), 'dn-btn small'), btn('🗑 TRASH', () => { sfx.play('crash'); send({ kind: 'trash' }); }, 'dn-btn small'));
  const serveBtn = btn('SERVE ▸', () => serve(next), 'dn-btn small go');
  serveBtn.disabled = !next;
  actions.append(serveBtn);
  const padCol = el('div', 'dn-boardcol');
  padCol.append(el('div', 'dn-h', 'TOPPINGS'), pad, actions);
  kitchen.append(padCol);

  page.append(kitchen, el('div', 'dn-msg', c.msg),
    el('div', 'dn-help', 'Q/W/E/R patty on or plate · shift+key scrape · number keys toppings · BACKSPACE undo · X trash · SPACE serve'));
  return page;
}
