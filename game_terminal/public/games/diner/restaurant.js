// The restaurant between shifts: the storefront, the upgrade shop (tabs of cards) and the shift
// report. Prices, gates and levels come from the server (view.restaurant.quotes); this only draws them.
import { storefront, tierThumb } from './art.js';

const pct = (x) => `${Math.round(x * 100)}%`;
// What one more level does, as "now → next".
const EFFECT = {
  grill: (n) => [`${1 + n} grill${n ? 's' : ''}`, `${2 + n} grills`],
  burners: (n) => [n ? `${pct(1 - 0.85 ** n)} faster` : 'normal', `${pct(1 - 0.85 ** (n + 1))} faster`],
  bell: () => ['no bell', 'ding.'],
  toppings: (n) => [`${4 + 2 * n} toppings`, `${6 + 2 * n} toppings`],
  premium: (n) => [`tips ×${(1.25 ** n).toFixed(2)}`, `tips ×${(1.25 ** (n + 1)).toFixed(2)}`],
  seats: (n) => [`${2 + n} customers`, `${3 + n} customers`],
  booths: (n) => [`patience +${pct(1.2 ** n - 1)}`, `patience +${pct(1.2 ** (n + 1) - 1)}`],
  fryer: () => ['no fries', 'fries +$2'],
  fountain: () => ['no drinks', 'sodas +$1.50'],
  shake: () => ['no shakes', 'shakes +$3.50'],
  frycook: () => ['you fry', 'fries on autopilot'],
  jerk: () => ['you pour', 'sodas on autopilot'],
  prep: () => ['you stack', 'auto-toppings'],
  host: () => ['no host', '+25% patience'],
  billboard: (n) => [`+${pct(1 / 0.8 ** n - 1)} customers`, `+${pct(1 / 0.8 ** (n + 1) - 1)} customers`],
};
const TABS = [['kitchen', 'Kitchen'], ['stations', 'Stations'], ['dining', 'Dining room'], ['staff', 'Staff'], ['expand', 'Expand']];
export const BUY_ERR = { broke: "You can't afford that yet.", tier: 'Upgrade your restaurant first.', maxed: 'Already maxed out.', needs: 'Buy that station first.', bad_name: "That name won't fit on the sign." };

export function renderHome(c) {
  const { view, el, btn, money, ui } = c;
  const r = view.restaurant;
  const tier = view.catalog.TIERS[r.tier];
  const page = el('div', 'dn-home');

  const hero = el('div', 'dn-hero');
  hero.append(storefront(r.tier, r.levels, r.name));
  const nameRow = el('div', 'dn-namerow');
  if (ui.renaming) {
    const input = el('input', 'dn-nameinput');
    Object.assign(input, { value: r.name, maxLength: 24, placeholder: 'Restaurant name' });
    const save = () => { ui.renaming = false; if (input.value.trim() && input.value !== r.name) c.send({ kind: 'rename', name: input.value }); else c.rerender(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { ui.renaming = false; c.rerender(); } });
    nameRow.append(input, btn('SAVE', save, 'dn-btn small'));
    setTimeout(() => input.focus(), 0);
  } else {
    nameRow.append(el('h2', 'dn-name', r.name), el('span', 'dn-tierpill', tier.name.toUpperCase()));
    if (!view.guest) nameRow.append(btn('Rename', () => { ui.renaming = true; c.rerender(); }, 'dn-btn small'));
  }
  hero.append(nameRow);
  // Reputation: stars, progress to the next one, and what the next star unlocks.
  const stars = Math.min(5, Math.floor((r.rep || 0) / 100));
  const starsRow = el('div', 'dn-starsrow');
  starsRow.append(el('span', 'dn-stars', '★'.repeat(stars) + '☆'.repeat(5 - stars)));
  if (stars < 5) {
    const bar = el('div', 'dn-repbar');
    const fill = el('i');
    fill.style.width = `${(r.rep || 0) % 100}%`;
    bar.append(fill);
    const next = Object.values(view.catalog.SPECIALS).filter((x) => x.stars === stars + 1).map((x) => x.name.toLowerCase());
    starsRow.append(bar, el('span', null, `${100 - ((r.rep || 0) % 100)} rep to ${stars + 1}★${next.length ? ` (${next.join(', ')})` : ''}`));
  }
  starsRow.title = 'Great orders (80%+) earn rep, bad ones and walk-outs lose it. Each star brings more customers and bigger tips.';
  hero.append(starsRow);

  const stats = el('div', 'dn-stats');
  const stat = (label, value) => { const s = el('div', 'dn-stat'); s.append(el('b', null, String(value)), el('span', null, label)); return s; };
  stats.append(stat('balance', money(view.balance || 0)), stat('best shift', money(r.bestShift)), stat('shifts worked', r.shifts), stat('menu prices', `×${tier.mult}`));
  hero.append(stats);
  const open = btn('OPEN FOR BUSINESS', () => { c.sfx.play('go'); c.send({ kind: 'start' }); }, 'dn-btn big go');
  hero.append(open, el('div', 'dn-msg', c.msg));
  if (view.guest) hero.append(el('div', 'dn-note', 'Play money: sign in to keep your restaurant and its upgrades.'));
  page.append(hero);

  const shop = el('div', 'dn-shop');
  const tabs = el('div', 'dn-tabs');
  for (const [id, label] of TABS) {
    const t = btn(label, () => { ui.tab = id; c.sfx.play('click'); c.rerender(); }, `dn-tab${ui.tab === id ? ' on' : ''}`);
    tabs.append(t);
  }
  shop.append(tabs);
  const grid = el('div', 'dn-grid');
  if (ui.tab === 'expand') grid.append(...tierCards(c));
  else grid.append(...view.catalog.UPGRADES.filter((u) => u.tab === ui.tab).map((u) => upgradeCard(c, u)));
  shop.append(grid);
  page.append(shop);
  return page;
}

function buyButton(c, id, q, u) {
  const { btn, money, view } = c;
  if (q.err === 'maxed') return c.el('div', 'dn-owned', u && u.wage ? 'HIRED' : 'MAXED');
  if (q.err === 'needs') return c.el('div', 'dn-locked', `Needs a ${q.need.toLowerCase()}`);
  if (q.err === 'tier') return c.el('div', 'dn-locked', `Needs ${q.need}`);
  const short = q.cost - (view.balance || 0);
  const b = btn(`${u && u.wage ? 'HIRE' : 'BUY'} ${money(q.cost)}`, () => { c.sfx.play('chips'); c.send({ kind: 'buy', id }); }, 'dn-btn buy');
  if (short <= 0) return b;
  b.disabled = true;
  const wrap = c.el('div', 'dn-buywrap');
  wrap.append(b, c.el('div', 'dn-short', `${money(short)} short`), btn('Win it at the casino →', () => c.leave(), 'dn-link'));
  return wrap;
}

function upgradeCard(c, u) {
  const { el, view } = c;
  const n = view.restaurant.levels[u.id] || 0;
  const card = el('div', `dn-card${n ? ' has' : ''}`);
  const head = el('div', 'dn-cardhead');
  head.append(el('b', null, u.name));
  const pips = el('div', 'dn-pips');
  for (let i = 0; i < u.prices.length; i++) pips.append(el('i', i < n ? 'on' : ''));
  const [now, next] = EFFECT[u.id] ? EFFECT[u.id](n) : ['', ''];
  const eff = el('div', 'dn-eff');
  eff.append(el('span', null, now));
  if (n < u.prices.length) eff.append(el('span', 'dn-arrow', '→'), el('b', null, next));
  card.append(head, pips, el('div', 'dn-desc', u.desc), eff);
  if (u.wage) card.append(el('div', 'dn-wage', `wage ${c.money(u.wage * view.catalog.TIERS[view.restaurant.tier].mult)} a shift`));
  card.append(buyButton(c, u.id, view.restaurant.quotes[u.id], u));
  return card;
}

function tierCards(c) {
  const { el, view } = c;
  const r = view.restaurant;
  return view.catalog.TIERS.map((t, i) => {
    const card = el('div', `dn-card dn-tiercard${i <= r.tier ? ' has' : ''}`);
    card.append(tierThumb(i, t.name));
    const head = el('div', 'dn-cardhead');
    head.append(el('b', null, t.name), el('span', 'dn-tierpill', `prices ×${t.mult}`));
    card.append(head);
    if (i <= r.tier) card.append(el('div', 'dn-owned', i === r.tier ? 'CURRENT' : 'OWNED'));
    else if (i === r.tier + 1) card.append(el('div', 'dn-desc', 'Bigger place, bigger prices, new upgrades.'), buyButton(c, 'tier', r.quotes.tier));
    else card.append(el('div', 'dn-locked', c.money(t.price)));
    return card;
  });
}

// The receipt after a shift, with the pay counting up.
export function renderReport(c) {
  const { view, el, btn, money } = c;
  const r = view.report;
  const card = el('div', 'dn-receipt');
  card.append(el('div', 'dn-receipt-h', 'SHIFT REPORT'), el('div', 'dn-receipt-sub', view.restaurant.name));
  const line = (label, value, cls = '') => { const l = el('div', `dn-line ${cls}`); l.append(el('span', null, label), el('b', null, value)); return l; };
  card.append(line('Orders served', r.served), line('Walked out', r.missed, r.missed ? 'bad' : ''), line('Average order', `${r.avg}%`));
  if (r.combos) card.append(line('Combos (+25%)', r.combos));
  if (r.best) card.append(line('Best order', `#${r.best.id} · ${r.best.score}%`));
  card.append(el('div', 'dn-rule'), line('Sales', money(r.revenue)), line('Tips', money(r.tips)));
  if (r.wages) card.append(line('Wages', `−${money(r.wages)}`, 'bad'));
  card.append(el('div', 'dn-rule'));
  const total = line('TOTAL', money(0), 'total');
  card.append(total);
  if (r.rep) {
    const d = r.rep.to - r.rep.from;
    card.append(line('Reputation', `${d >= 0 ? '+' : ''}${d} · ${'★'.repeat(r.rep.stars)}${'☆'.repeat(5 - r.rep.stars)}`, d < 0 ? 'bad' : ''));
  }
  if (r.rep && r.rep.stars > r.rep.starsBefore) card.append(el('div', 'dn-stamp', `NEW STAR ${'★'.repeat(r.rep.stars)}`));
  else if (r.rep && r.rep.stars < r.rep.starsBefore) card.append(el('div', 'dn-stamp bad', 'LOST A STAR'));
  if (r.newBest) card.append(el('div', 'dn-stamp', 'NEW BEST SHIFT'));
  const t0 = performance.now();
  const shown = total.querySelector('b');
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / 1200);
    shown.textContent = money(Math.round(r.paid * (1 - (1 - k) ** 3) * 100) / 100);
    if (k < 1 && shown.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const row = el('div', 'dn-row');
  row.append(btn('BACK TO RESTAURANT', () => { c.ui.showReport = false; c.rerender(); }, 'dn-btn'),
    btn('ANOTHER SHIFT', () => { c.sfx.play('go'); c.send({ kind: 'start' }); }, 'dn-btn go'));
  card.append(row, el('div', 'dn-msg', c.msg));
  return card;
}
