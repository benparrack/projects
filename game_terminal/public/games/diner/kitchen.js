// The shift: customers at the counter, the griddle, the board and the topping bins. Every press is
// sent to the server; `live` callbacks move the timers between state updates.
import { ICON, face, setMood } from './art.js';

export const GRILL_KEYS = ['q', 'w', 'e', 'r'];
export const STATION_KEYS = { fryer: 'f', fountain: 'd', shake: 's' };
const ZONE = { rare: '#e05050', medium: '#c07a40', well: '#7a5236' };
export const SIDE_ICON = { fryer: '🍟', fountain: '🥤', shake: '🍨' };
export const FLAVOR = { fries: '#f4c430', cola: '#5a2d1a', lemon: '#c8e64a', orange: '#ff9f1c', vanilla: '#fff3c4', chocolate: '#7b4a2a', strawberry: '#ff8fab' };
const STATION_VERB = { fryer: ['DROP BASKET', 'PULL'], fountain: ['HOLD TO POUR', 'RELEASE'], shake: ['BLEND', 'POUR'] };

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
    const sides = (t) => Object.entries(t.sides || {}).filter(([id, f]) => c.view.tray[id] && c.view.tray[id].flavor === f).length * 10;
    const fitAll = (t) => fit(t) + sides(t);
    return tickets.reduce((best, t) => (!best || fitAll(t) > fitAll(best) || (fitAll(t) === fitAll(best) && t.at < best.at) ? t : best), null);
  }
  // 0-1 like the server's sideQuality, ignoring flavour (the slip shows that).
  function sideTiming(id, ms) {
    const { window: [lo, hi], ruin, slop } = c.view.catalog.STATIONS[id];
    return ms >= ruin ? 0 : ms < lo ? Math.max(0, 1 - (lo - ms) / slop) : ms > hi ? 1 - (ms - hi) / (ruin - hi) : 1;
  }
  // The flavour a station should make next: what the oldest ticket wanting it still needs.
  function wantedFlavor(id) {
    const tray = c.view.tray[id];
    const t = c.view.tickets.find((x) => x.sides && x.sides[id] && (!tray || tray.flavor !== x.sides[id]));
    return t ? t.sides[id] : c.view.catalog.STATIONS[id].flavors[0];
  }
  return { pattyColor, donenessKey, donenessLabel, bestTicket, sideTiming, wantedFlavor };
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
  if (view.perks.staff.includes('prep')) top.append(el('span', 'dn-pill', '🔪 prep cook'));
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
    for (const [id, f] of Object.entries(t.sides || {})) {
      const tr = view.tray[id];
      const s = el('span', `dn-side${tr ? (tr.flavor === f ? ' ok' : ' bad') : ''}`, SIDE_ICON[id]);
      s.style.setProperty('--fl', FLAVOR[f]);
      s.title = id === 'fryer' ? 'fries' : `${f} ${id === 'shake' ? 'shake' : 'soda'}`;
      want.append(s);
    }
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

  page.append(kitchen);
  if (view.perks.stations.length) page.append(renderStations(c, cook));
  page.append(el('div', 'dn-msg', c.msg),
    el('div', 'dn-help', `Q/W/E/R patty on or plate · shift+key scrape · number keys toppings · BACKSPACE undo · X trash · SPACE serve${view.perks.stations.length ? ' · F fries · hold D soda · S shake' : ''}`));
  return page;
}

// Fryer, soda fountain, shake machine: start, watch the needle, stop it in the green. The fountain pours
// while held (the client stops it on pointerup / key up, see client.js).
function renderStations(c, cook) {
  const { view, el, btn, send, sfx, clock, live, ui } = c;
  const row = el('div', 'dn-stations');
  for (const id of view.perks.stations) {
    const S = view.catalog.STATIONS[id];
    const run = view.stations[id];
    const tray = view.tray[id];
    const card = el('div', `dn-station ${id}`);
    const head = el('div', 'dn-st-h');
    const crew = { fryer: 'frycook', fountain: 'jerk' }[id];
    head.append(el('b', null, `${SIDE_ICON[id]} ${S.name}`), view.perks.staff.includes(crew)
      ? el('span', 'dn-crew', crew === 'frycook' ? '🧑‍🍳 fry cook' : '🧃 soda jerk') : el('span', 'dn-key', STATION_KEYS[id].toUpperCase()));
    card.append(head);
    // The vessel: oil with a basket, a cup filling to the line, or the blender jug.
    const pot = el('div', `dn-pot ${id}`);
    const fill = el('div', 'dn-fill');
    pot.append(fill);
    if (id === 'fountain') pot.append(el('div', 'dn-fillline'));
    card.append(pot);
    const bar = el('div', 'dn-bar');
    const [lo, hi] = S.window;
    const zone = el('span');
    Object.assign(zone.style, { left: `${(lo / S.ruin) * 100}%`, width: `${((hi - lo) / S.ruin) * 100}%`, background: '#2ecc71' });
    const needle = el('i');
    bar.append(zone, needle);
    card.append(bar);
    if (run) {
      fill.style.setProperty('--fl', FLAVOR[run.flavor]);
      live.push(() => {
        const ms = Math.max(0, clock.now() - run.at);
        const k = Math.min(1, ms / S.ruin);
        needle.style.left = `${k * 100}%`;
        fill.style.height = id === 'fountain' ? `${Math.min(100, (ms / hi) * 86)}%` : '70%';
        pot.classList.toggle('spill', ms >= S.ruin && id === 'fountain');
        pot.classList.toggle('ruined', ms >= S.ruin && id !== 'fountain');
        pot.classList.toggle('good', ms >= lo && ms <= hi);
      });
      pot.classList.add('on');
      if (view.perks.staff.includes(crew)) card.append(el('div', 'dn-st-act', `${crew === 'jerk' ? 'pouring' : 'frying'} ${run.flavor}…`));
      else if (id === 'fountain') card.append(el('div', 'dn-st-act', `pouring ${run.flavor}… let go at the line`));
      else card.append(btn(`${STATION_VERB[id][1]} ▸`, () => { sfx.play('pop'); send({ kind: 'station_stop', id }); }, 'dn-btn small go'));
    } else if (tray) {
      fill.style.setProperty('--fl', FLAVOR[tray.flavor]);
      pot.classList.add('done');
      fill.style.height = id === 'fountain' ? `${Math.min(100, (tray.ms / hi) * 86)}%` : '70%';
      const q = Math.round(cook.sideTiming(id, tray.ms) * 100);
      const ready = el('div', 'dn-st-act');
      ready.append(el('b', q >= 80 ? 'ok' : 'bad', `${id === 'fryer' ? '' : `${tray.flavor} `}ready · ${q}%`),
        btn('✕', () => { sfx.play('crash'); send({ kind: 'dump', id }); }, 'dn-btn icon'));
      card.append(ready);
    } else {
      const picks = el('div', 'dn-st-picks');
      const want = cook.wantedFlavor(id);
      for (const f of S.flavors) {
        const label = id === 'fryer' ? STATION_VERB[id][0] : f;
        const b = btn(label, () => {}, `dn-btn small dn-flavor${f === want && S.flavors.length > 1 ? ' want' : ''}`);
        b.style.setProperty('--fl', FLAVOR[f]);
        if (id === 'fountain') {
          b.addEventListener('pointerdown', (e) => { e.preventDefault(); ui.pouring = true; sfx.play('whoosh'); send({ kind: 'station', id, flavor: f }); });
        } else b.addEventListener('click', () => { sfx.play('whoosh'); send({ kind: 'station', id, flavor: f }); });
        picks.append(b);
      }
      card.append(picks);
    }
    row.append(card);
  }
  return row;
}
