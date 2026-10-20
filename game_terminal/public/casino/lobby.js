// The casino lobby strip at the top of the CASINO menu category: balance, tier, play-money note for
// guests, the daily stipend, work shifts, the shop and the casino leaderboards. Casino money is
// shown here and at casino tables only.
import { h } from '../ui.js';

const money = (n) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const SLOT_NAMES = { felt: 'TABLE FELT', back: 'CARD BACKS', slots: 'SLOT MACHINE', charm: 'LUCKY CHARM (beside your name at tables; does not change the odds)', key: 'HIGH-ROLLER ROOM' };
const ERRORS = { broke: "You can't afford that yet.", owned: 'You already own that.', guest: 'Sign in to buy things: guest play money disappears when you leave.' };
const openPanels = new Set(); // which panels stay open across re-renders

function panel(id, title, ...body) {
  return h('details.casino-panel', { open: openPanels.has(id), ontoggle: (e) => (e.target.open ? openPanels.add(id) : openPanels.delete(id)) },
    h('summary', title), ...body);
}

function shop(cs, onBuy, onEquip) {
  const groups = [];
  for (const slot of Object.keys(SLOT_NAMES)) {
    const rows = cs.shop.filter((x) => x.slot === slot).map((x) => {
      const owned = !!cs.owned[x.id];
      const on = cs.equipped[x.slot] === x.id;
      const label = `${x.glyph ? `${x.glyph} ` : ''}${x.name}`;
      const btn = owned
        ? (slot === 'key' ? h('span.muted', 'OWNED') : h('button.casino-btn', { type: 'button', onclick: () => onEquip(x.id) }, on ? 'TAKE OFF' : 'EQUIP'))
        : h('button.casino-btn', { type: 'button', disabled: cs.guest || cs.balance < x.price, onclick: () => onBuy(x.id) }, `BUY ${money(x.price)}`);
      return h('li', { class: on ? 'casino-on' : null }, h('span', label), btn);
    });
    groups.push(h('div.muted.casino-note', SLOT_NAMES[slot]), h('ul.casino-items', ...rows));
  }
  return panel('shop', 'SHOP', ...groups);
}

function boards(b) {
  const list = (title, rows) => h('div', h('div.muted.casino-note', title),
    rows.length ? h('ol.casino-items', ...rows.map((r) => h('li', h('span', `${r.tier} ${r.name}`), h('span.casino-balance', money(r.value))))) : h('div.muted', 'Nobody yet.'));
  return panel('boards', 'LEADERBOARDS', h('div.casino-boards', list('RICHEST', b.richest), list('BIGGEST WIN', b.biggestWin), list('MOST WAGERED', b.wagered)));
}

// cs = the server's casino.state payload, or null/'loading'. onStipend claims today's stipend,
// onWork opens a diner shift (the way back from broke, so it stands out when the balance is gone),
// onBuy/onEquip go to the shop.
export function casinoBar(cs, { onStipend, onWork, onBuy, onEquip }) {
  if (!cs || cs === 'loading') return h('li.casino-bar', h('span.muted', 'Opening the casino…'));
  const parts = [h('span.casino-balance', { title: 'Your casino balance' }, money(cs.balance))];
  if (cs.atTables > 0) parts.push(h('span.muted', `+ ${money(cs.atTables)} at tables`));
  if (cs.guest) parts.push(h('span.muted.casino-note', 'PLAY MONEY · sign in to keep your winnings'));
  else {
    const t = cs.tier;
    parts.push(h('span.casino-note', { title: t.next ? `${money(t.next.at - cs.wagered)} more wagered to reach ${t.next.name}` : 'The top tier' }, `${t.glyph} ${t.name.toUpperCase()}`));
  }
  if (!cs.guest && cs.stipend && cs.stipend.ready) parts.push(h('button.casino-btn', { type: 'button', onclick: onStipend }, `CLAIM ${money(cs.stipend.amount)} DAILY`));
  else if (cs.stipend) parts.push(h('span.muted.casino-note', 'Daily stipend claimed · back tomorrow'));
  if (cs.shiftsLeft > 0) {
    const broke = cs.balance + cs.atTables < 2;
    parts.push(h(`button.casino-btn${broke ? '.casino-broke' : ''}`, { type: 'button', onclick: onWork, title: 'Terminal Diner: a 3 minute burger shift that pays up to $120' },
      `${broke ? 'BROKE? ' : ''}WORK A SHIFT (${cs.shiftsLeft} left today)`));
  }
  if (cs.jackpot) parts.push(h('span.casino-note', { title: 'Progressive slots jackpot, shared by the whole site' }, `◆ SLOTS JACKPOT ${money(cs.jackpot)}`));
  if (cs.error && ERRORS[cs.error]) parts.push(h('div.casino-note.casino-error', ERRORS[cs.error]));
  parts.push(shop(cs, onBuy, onEquip));
  if (cs.boards) parts.push(boards(cs.boards));
  return h('li.casino-bar.cz', ...parts);
}
