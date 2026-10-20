// The casino lobby strip at the top of the CASINO menu category: balance, play-money note for
// guests, and the daily stipend. Casino money is shown here and at casino tables only.
import { h } from '../ui.js';

const money = (n) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// cs = the server's casino.state payload, or null/'loading'. onStipend claims today's stipend,
// onWork opens a diner shift (the way back from broke, so it stands out when the balance is gone).
export function casinoBar(cs, { onStipend, onWork }) {
  if (!cs || cs === 'loading') return h('li.casino-bar', h('span.muted', 'Opening the casino…'));
  const parts = [h('span.casino-balance', { title: 'Your casino balance' }, money(cs.balance))];
  if (cs.atTables > 0) parts.push(h('span.muted', `+ ${money(cs.atTables)} at tables`));
  if (cs.guest) parts.push(h('span.muted.casino-note', 'PLAY MONEY · sign in to keep your winnings'));
  else if (cs.stipend && cs.stipend.ready) parts.push(h('button.casino-btn', { type: 'button', onclick: onStipend }, `CLAIM ${money(cs.stipend.amount)} DAILY`));
  else if (cs.stipend) parts.push(h('span.muted.casino-note', 'Daily stipend claimed · back tomorrow'));
  if (cs.shiftsLeft > 0) {
    const broke = cs.balance + cs.atTables < 2;
    parts.push(h(`button.casino-btn${broke ? '.casino-broke' : ''}`, { type: 'button', onclick: onWork, title: 'Terminal Diner: a 3 minute burger shift that pays up to $120' },
      `${broke ? 'BROKE? ' : ''}WORK A SHIFT (${cs.shiftsLeft} left today)`));
  }
  if (cs.jackpot) parts.push(h('span.casino-note', { title: 'Progressive slots jackpot, shared by the whole site' }, `◆ SLOTS JACKPOT ${money(cs.jackpot)}`));
  return h('li.casino-bar', ...parts);
}
