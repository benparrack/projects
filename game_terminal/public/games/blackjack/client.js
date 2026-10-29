// Blackjack — 1-6 seats against the house. Bet with the chip buttons, press DEAL, then HIT /
// STAND / DOUBLE / SPLIT (keys H S D P, Space/Enter = deal). HINTS shows basic-strategy advice.
// Server plugin: ../../../server/games/blackjack.js (authoritative; the hole card never reaches
// the client until the dealer flips it).

import { renderCard, isBot, botName, addBotButton, removeBotButton, markBotSeat } from '../cardCommon.js';
import { createResults } from '../resultsPanel.js';
import { sfx } from '../sfx.js';
import { makeServerClock } from '../serverClock.js';
import { handValue, cardValue, basicStrategy, adviceLabel } from './strategy.js';
import { injectStyle } from '../dom.js';

const HINT_KEY = 'gt.blackjack.hints';

const TIP_THANKS = ['Much obliged.', 'Thank you kindly.', 'Good luck to you.', 'A true gentleman of the felt.'];
const REJECT = {
  not_betting: 'Bets are closed', not_seated: 'Sit down first', already_ready: 'Bet locked in. Wait for the deal',
  bad_amount: 'Invalid chip', over_max: 'Over the table max', insufficient: 'Not enough chips', no_last_bet: 'No previous bet',
  under_min: 'Minimum bet is $2', vip_only: 'High rollers only: $1,000+ in the casino, or the VIP key from the casino SHOP.', no_rebuy: 'No rebuys. Visit the CASINO lobby',
  broke: 'You\'re broke: claim the daily stipend or work a shift in the CASINO lobby', wallet_loading: 'Loading your balance, try again', no_insurance: 'Insurance is closed',
  not_your_turn: "It's not your turn", cant_double: "Can't double this hand", cant_split: "Can't split this hand",
  split_aces: 'Split aces get one card', table_full: 'Table is full', already_seated: 'Already seated',
  not_a_bot: 'Not a bot', bad_phase: 'Not now', unknown: 'Unknown action',
};

const RESULT_LABEL = { blackjack: 'BLACKJACK', win: 'WIN', push: 'PUSH', lose: 'LOSE', bust: 'BUST' };

const CSS = `
.bj { display: flex; flex-direction: column; gap: 10px; align-items: stretch; width: 100%; max-width: 860px; margin: 0 auto; }
.bj-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.bj-status { font-size: 1em; letter-spacing: .5px; min-height: 1.3em; }
.bj-status .bj-cd { color: var(--accent, #ffb000); margin-left: 6px; }
.bj-tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: .8em; }
.bj-tools button { font-size: .85em; padding: 4px 10px; }
.bj-tools button.on { background: #39ff14; color: #041004; }
.bj-shoe { display: flex; align-items: center; gap: 6px; opacity: .85; }
.bj-shoe-bar { position: relative; width: 90px; height: 8px; border: 1px solid #1f8f0c; border-radius: 4px; overflow: hidden; background: #020402; }
.bj-shoe-fill { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, #1f8f0c, #39ff14); transition: width .3s; }
.bj-shoe-cut { position: absolute; top: -2px; bottom: -2px; width: 2px; background: #ff4d4d; }

.bj-felt {
  position: relative; border-radius: 22px 22px 120px 120px / 22px 22px 70px 70px; padding: 16px 12px 18px;
  background: radial-gradient(ellipse at 50% 0%, #1d6b2a 0%, #0f4a1b 45%, #082d10 100%);
  border: 3px solid #5a3a12; box-shadow: inset 0 0 0 2px #2b1a06, inset 0 0 40px rgba(0,0,0,.55), 0 6px 22px rgba(0,0,0,.6);
  color: #e8f5e0; overflow: hidden;
}
.bj-felt::before {
  content: ''; position: absolute; left: 8%; right: 8%; top: 46%; height: 60%; border: 1px solid rgba(255,220,120,.18);
  border-radius: 50% 50% 0 0 / 70% 70% 0 0; border-bottom: none; pointer-events: none;
}
.bj-dealer { display: flex; flex-direction: column; align-items: center; gap: 6px; min-height: 120px; position: relative; z-index: 1; }
.bj-dealer-label { font-size: .75em; letter-spacing: 3px; opacity: .8; }
.bj-rules { text-align: center; font-family: Georgia, serif; font-style: italic; color: rgba(255,220,120,.55); font-size: .78em; letter-spacing: 1px; margin: 6px 0 12px; position: relative; z-index: 1; }
.bj-rules b { font-style: normal; color: rgba(255,220,120,.8); letter-spacing: 2px; font-size: 1.15em; display: block; }
.bj-cards { display: flex; justify-content: center; min-height: 74px; }
.bj-cards .gt-card + .gt-card { margin-left: -24px; }
.bj-cards.small .gt-card + .gt-card { margin-left: -20px; }
.bj-total {
  display: inline-block; min-width: 28px; padding: 1px 8px; border-radius: 10px; font-size: .8em; font-weight: bold; text-align: center;
  background: rgba(0,0,0,.55); border: 1px solid rgba(255,255,255,.25); color: #fff;
}
.bj-total.bust { background: #7a0d0d; border-color: #ff4d4d; }
.bj-total.bj { background: #8a6a00; border-color: #ffd23f; color: #fff6c8; }
.bj-total.t21 { border-color: #39ff14; color: #b8ffa8; }

.bj-seats { display: grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); gap: 8px; position: relative; z-index: 1; }
.bj-seat {
  position: relative; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; padding: 6px 6px 8px; min-height: 150px;
  background: rgba(0,0,0,.22); display: flex; flex-direction: column; align-items: center; gap: 4px; transition: box-shadow .2s, border-color .2s;
}
.bj-seat.me { border-color: rgba(57,255,20,.5); }
.bj-seat.turn { border-color: #ffd23f; box-shadow: 0 0 0 1px #ffd23f, 0 0 18px rgba(255,210,63,.45); }
.bj-seat.empty { justify-content: center; border-style: dashed; opacity: .75; }
.bj-seat-name { font-size: .78em; font-weight: bold; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bj-seat-bank { font-size: .72em; opacity: .85; }
.bj-seat-bank .ready { color: #39ff14; }
.bj-hands { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }
.bj-hand { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 3px; border-radius: 6px; border: 1px solid transparent; }
.bj-hand.active { border-color: #ffd23f; background: rgba(255,210,63,.08); }
.bj-hand.dim { opacity: .55; }
.bj-res {
  font-size: .7em; font-weight: bold; padding: 1px 6px; border-radius: 4px; letter-spacing: 1px;
  animation: bj-pop .45s cubic-bezier(.2,1.6,.4,1) backwards;
}
.bj-res.win, .bj-res.blackjack { background: #39ff14; color: #041004; }
.bj-res.blackjack { background: #ffd23f; }
.bj-res.push { background: #7fd7ff; color: #04121a; }
.bj-res.lose, .bj-res.bust { background: #ff4d4d; color: #1a0404; }
@keyframes bj-pop { from { transform: scale(.2); opacity: 0; } }
.bj-chipstack { display: flex; align-items: center; gap: 4px; font-size: .75em; min-height: 22px; }
.bj-chip {
  --c: #e8e8e8; width: 34px; height: 34px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  font-size: .72em; font-weight: bold; color: #111; cursor: pointer; padding: 0; border: none; user-select: none;
  background:
    radial-gradient(circle, var(--c) 0 52%, transparent 53%),
    repeating-conic-gradient(var(--c) 0 20deg, #fff 20deg 40deg);
  box-shadow: 0 0 0 2px rgba(0,0,0,.45), 0 3px 5px rgba(0,0,0,.5), inset 0 0 0 3px rgba(0,0,0,.15);
  transition: transform .1s;
}
.bj-chip:hover:not(:disabled) { transform: translateY(-3px); }
.bj-chip:hover { background:
    radial-gradient(circle, var(--c) 0 52%, transparent 53%),
    repeating-conic-gradient(var(--c) 0 20deg, #fff 20deg 40deg); color: #111; }
.bj-chip:active:not(:disabled) { transform: translateY(1px) scale(.95); }
.bj-chip.mini { width: 20px; height: 20px; font-size: .55em; cursor: default; box-shadow: 0 0 0 1px rgba(0,0,0,.5), 0 1px 2px rgba(0,0,0,.5); }
.bj-chip.c1 { --c: #ddd; color: #111; } .bj-chip.c5 { --c: #e04848; color: #fff; } .bj-chip.c25 { --c: #2f9e44; color: #fff; }
.bj-chip.c100 { --c: #222; color: #fff; } .bj-chip.c500 { --c: #7b3fd1; color: #fff; }
.bj-chip.c10 { --c: #2a6fdb; color: #fff; } .bj-chip.c50 { --c: #f08c00; color: #fff; } .bj-chip.c250 { --c: #d6336c; color: #fff; } .bj-chip.c1000 { --c: #e8b923; color: #111; }
.bj-chip.c5:hover, .bj-chip.c10:hover, .bj-chip.c25:hover, .bj-chip.c50:hover, .bj-chip.c100:hover, .bj-chip.c250:hover, .bj-chip.c500:hover { color: #fff; }
.bj-chip.in { animation: bj-chip-in .3s cubic-bezier(.2,1.4,.4,1); }
@keyframes bj-chip-in { from { transform: translateY(26px) scale(.6); opacity: 0; } }
.bj-timer { width: 100%; height: 3px; background: rgba(255,255,255,.12); border-radius: 2px; overflow: hidden; }
.bj-timer > div { height: 100%; background: #ffd23f; transition: width .2s linear; }
.bj-ins { font-size: .7em; color: #7fd7ff; }

.bj-panel {
  display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 10px; border: 1px solid #8a6a2a; border-radius: 10px;
  background: linear-gradient(180deg, #1c1408, #0b0803); box-shadow: 0 4px 12px rgba(0,0,0,.5);
}
.bj-row { display: flex; gap: 8px; align-items: center; justify-content: center; flex-wrap: wrap; }
.bj-bigbet { font-size: 1.05em; }
.bj-bigbet b { color: #ffd23f; }
.bj-act button { min-width: 84px; font-weight: bold; letter-spacing: 1px; position: relative; }
.bj-act button .k { opacity: .5; font-size: .75em; margin-left: 4px; }
.bj-act button.hint { border-color: #ffd23f; color: #ffd23f; box-shadow: 0 0 12px rgba(255,210,63,.45); animation: bj-hint 1.4s ease-in-out infinite; }
.bj-act button.hint:hover { background: #ffd23f; color: #000; }
@keyframes bj-hint { 50% { box-shadow: 0 0 2px rgba(255,210,63,.2); } }
.bj-hinttext { font-size: .8em; color: #ffd23f; min-height: 1.1em; }
.bj-flash { animation: bj-flash .35s; }
@keyframes bj-flash { 30% { background: rgba(255,60,60,.35); } }
.bj-toast { font-size: .82em; color: #ff8a8a; min-height: 1.1em; text-align: center; }

.bj-board { width: 100%; border-collapse: collapse; font-size: .8em; }
.bj-board th, .bj-board td { padding: 3px 6px; text-align: right; border-bottom: 1px solid rgba(201,162,74,.2); white-space: nowrap; }
@media (max-width: 420px) { .bj-board th, .bj-board td { padding: 3px 3px; } }
.bj-board th:first-child, .bj-board td:first-child { text-align: left; }
.bj-board th { opacity: .8; font-weight: normal; color: #c9a24a; }
.bj-board tr.me td { color: #b8ffa8; }
.bj-pos { color: #39ff14; } .bj-neg { color: #ff6b6b; }
.bj-banner {
  position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); z-index: 3; pointer-events: none;
  font-size: 1.6em; font-weight: bold; letter-spacing: 3px; padding: 6px 18px; border-radius: 8px; white-space: nowrap;
  background: rgba(0,0,0,.72); border: 2px solid currentColor; animation: bj-banner 1.8s ease-out forwards;
}
@keyframes bj-banner { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.5); } 15% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); } 25% { transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; } }
@media (max-width: 520px) {
  .bj-seats { grid-template-columns: repeat(2, 1fr); }
  .bj-felt { border-radius: 16px; }
  .bj-chip { width: 40px; height: 40px; }
}
@media (prefers-reduced-motion: reduce) { .bj-res, .bj-chip.in, .bj-banner, .bj-act button.hint { animation: none; } }
`;

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// Break an amount into chip denominations for the little bet stack.
function chipBreakdown(amount) {
  const out = [];
  let left = amount;
  for (const d of [1000, 500, 250, 100, 50, 25, 10, 5]) {
    while (left >= d && out.length < 6) { out.push(d); left -= d; }
  }
  return out;
}

export function mount(container, api) {
  injectStyle(CSS);
  let view = null;
  let roster = [];
  let hints = false;
  try { hints = localStorage.getItem(HINT_KEY) === '1'; } catch { /* storage blocked */ }
  let toast = '';
  let toastTimer = null;
  let lastSeenEvent = null;
  let pendingBanner = null;
  const clock = makeServerClock();
  const timerEls = []; // { bar, text, deadline, span }

  const root = el('div', 'bj cz');
  const results = createResults(container);
  container.appendChild(root);

  const me = () => api.getClientId();
  function nameFor(id) {
    if (isBot(id)) return botName(id);
    const r = roster.find((x) => x.clientId === id);
    const flair = view && view.players[id] && view.players[id].flair;
    return `${r ? r.nickname : 'someone'}${flair ? ` ${flair}` : ''}`;
  }
  const mySeat = () => (view ? view.seats.indexOf(me()) : -1);
  const myEntry = () => (view && view.round ? view.round.entries.find((e) => e.id === me()) : null);

  function currentTurn() {
    if (!view || !view.round || !view.round.turn || view.phase !== 'playing') return null;
    const e = view.round.entries[view.round.turn.e];
    if (!e) return null;
    return { entry: e, hand: e.hands[view.round.turn.h], e: view.round.turn.e, h: view.round.turn.h };
  }
  const myTurn = () => { const t = currentTurn(); return t && t.entry.id === me() ? t : null; };

  function legal(t) {
    const p = view.players[me()];
    const h = t.hand;
    const bank = p ? p.bankroll : 0;
    const pair = h.cards.length === 2 && cardValue(h.cards[0]) === cardValue(h.cards[1]);
    return {
      hit: !h.splitAces,
      stand: true,
      double: h.cards.length === 2 && !h.splitAces && bank >= h.bet,
      split: pair && t.entry.hands.length < 4 && bank >= h.bet && !h.splitAces,
    };
  }

  function advice(t) {
    const L = legal(t);
    const up = view.round.dealer.cards[0];
    if (!up) return null;
    return basicStrategy(t.hand.cards, cardValue(up), { canDouble: L.double, canSplit: L.split });
  }

  function send(data) {
    api.sendAction(data);
  }

  function showToast(msg) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast = ''; render(); }, 2200);
    render();
  }

  function statusText() {
    if (!view) return 'Loading…';
    const t = currentTurn();
    switch (view.phase) {
      case 'waiting': return 'Table open. Take a seat to play.';
      case 'betting': return view.deadline ? 'Place your bets. Dealing in' : 'Place your bets.';
      case 'dealing': return 'Dealing…';
      case 'insurance': return 'Dealer shows an ace. Insurance?';
      case 'peek': return 'Dealer checks for blackjack…';
      case 'playing': return t ? `${t.entry.id === me() ? 'Your' : `${nameFor(t.entry.id)}'s`} turn${t.entry.hands.length > 1 ? ` (hand ${t.h + 1})` : ''}` : '';
      case 'dealer': return 'Dealer plays…';
      case 'settle': return 'Round over.';
      case 'shoe_over': return 'End of the shoe. Reshuffling. Next shoe in';
      default: return '';
    }
  }

  function addTimer(parent, deadline, total, withText) {
    const bar = el('div', 'bj-timer');
    const fill = el('div');
    bar.appendChild(fill);
    parent.appendChild(bar);
    timerEls.push({ fill, deadline, total, text: withText || null });
    return bar;
  }

  function tickTimers() {
    const now = clock.now();
    for (const t of timerEls) {
      const left = Math.max(0, t.deadline - now);
      if (t.fill) t.fill.style.width = `${Math.min(100, (left / t.total) * 100)}%`;
      if (t.text) t.text.textContent = `${Math.ceil(left / 1000)}s`;
    }
  }
  const timerHandle = setInterval(tickTimers, 200);

  function renderHandCards(cards, small) {
    const row = el('div', `bj-cards${small ? ' small' : ''}`);
    for (const c of cards) row.appendChild(renderCard(c, { faceDown: !c, small }));
    return row;
  }

  function totalBadge(total, soft, { bust, natural } = {}) {
    const b = el('span', 'bj-total');
    if (bust) { b.classList.add('bust'); b.textContent = `${total} BUST`; }
    else if (natural) { b.classList.add('bj'); b.textContent = 'BJ'; }
    else { b.textContent = soft && total < 21 ? `${total - 10}/${total}` : String(total); if (total === 21) b.classList.add('t21'); }
    return b;
  }

  function renderDealer(parent) {
    const d = el('div', 'bj-dealer');
    d.appendChild(el('div', 'bj-dealer-label', 'DEALER'));
    const r = view.round;
    if (r && r.dealer.cards.length) {
      d.appendChild(renderHandCards(r.dealer.cards, false));
      d.appendChild(totalBadge(r.dealer.total, r.dealer.soft, { bust: r.dealer.bust, natural: r.dealer.natural }));
    } else {
      const ph = el('div', 'bj-cards');
      ph.appendChild(renderCard(null, { faceDown: true }));
      ph.style.opacity = '.25';
      d.appendChild(ph);
    }
    parent.appendChild(d);
    const rules = el('div', 'bj-rules');
    rules.appendChild(el('b', null, 'BLACKJACK PAYS 3 TO 2'));
    rules.appendChild(document.createTextNode('Dealer stands on soft 17 · Insurance pays 2 to 1'));
    parent.appendChild(rules);
  }

  function renderSeat(id, seatIdx) {
    const p = view.players[id] || { bankroll: 0, bet: 0 };
    const entry = view.round ? view.round.entries.find((e) => e.id === id) : null;
    const t = currentTurn();
    const seat = el('div', 'bj-seat');
    if (id === me()) seat.classList.add('me');
    if (t && t.entry.id === id) seat.classList.add('turn');
    markBotSeat(seat, id, seatIdx);

    const name = el('div', 'bj-seat-name', `${nameFor(id)}${id === me() ? ' (you)' : ''}`);
    seat.appendChild(name);
    const bank = el('div', 'bj-seat-bank');
    bank.textContent = `$${fmt(p.bankroll)}`;
    if (view.phase === 'betting' && p.ready) {
      const r = el('span', 'ready', ' ✓ READY');
      bank.appendChild(r);
    }
    seat.appendChild(bank);

    if (entry) {
      const hands = el('div', 'bj-hands');
      entry.hands.forEach((h, hi) => {
        const hw = el('div', 'bj-hand');
        const active = t && t.entry.id === id && t.h === hi;
        if (active) hw.classList.add('active');
        else if (entry.hands.length > 1 && t && t.entry.id === id && !h.done) hw.classList.add('dim');
        hw.appendChild(renderHandCards(h.cards, entry.hands.length > 1 || view.seats.length > 3));
        hw.appendChild(totalBadge(h.total, h.soft, { bust: h.bust, natural: h.natural }));
        const stack = el('div', 'bj-chipstack');
        for (const d of chipBreakdown(h.bet).slice(0, 4)) stack.appendChild(el('span', `bj-chip mini c${d}`));
        stack.appendChild(el('span', null, `$${fmt(h.bet)}${h.doubled ? ' ×2' : ''}`));
        hw.appendChild(stack);
        if (h.result) {
          const res = el('span', `bj-res ${h.result}`, `${RESULT_LABEL[h.result]} ${h.payout ? signed(h.payout) : ''}`.trim());
          hw.appendChild(res);
        }
        if (active && view.deadline) addTimer(hw, view.deadline, 20000);
        hands.appendChild(hw);
      });
      seat.appendChild(hands);
      if (entry.insurance > 0) seat.appendChild(el('div', 'bj-ins', `Insured $${fmt(entry.insurance)}`));
      else if (view.phase === 'insurance' && !entry.insDecided) seat.appendChild(el('div', 'bj-ins', 'deciding insurance…'));
      if (entry.left) seat.appendChild(el('div', 'bj-ins', '(left the table)'));
    } else if (p.bet > 0) {
      const stack = el('div', 'bj-chipstack');
      for (const d of chipBreakdown(p.bet)) {
        const c = el('span', `bj-chip mini c${d}`);
        stack.appendChild(c);
      }
      stack.appendChild(el('span', null, `$${fmt(p.bet)}`));
      seat.appendChild(stack);
    } else if (view.phase === 'betting') {
      seat.appendChild(el('div', 'bj-seat-bank', p.bankroll < view.minBet ? 'broke' : 'betting…'));
    } else if (view.round) {
      seat.appendChild(el('div', 'bj-seat-bank', 'sitting out'));
    }

    if (isBot(id) && seatIdx >= 0 && (view.phase === 'betting' || view.phase === 'waiting' || view.phase === 'settle' || view.phase === 'shoe_over')) {
      const rm = removeBotButton(api, seatIdx);
      rm.style.marginTop = 'auto';
      seat.appendChild(rm);
    }
    return seat;
  }

  function renderSeats(parent) {
    const grid = el('div', 'bj-seats');
    view.seats.forEach((id, i) => grid.appendChild(renderSeat(id, i)));
    // Players who left mid-round keep their hands on the table until it settles.
    if (view.round) {
      for (const e of view.round.entries) if (!view.seats.includes(e.id)) grid.appendChild(renderSeat(e.id, -1));
    }
    const free = 6 - view.seats.length;
    for (let i = 0; i < free; i++) {
      const s = el('div', 'bj-seat empty');
      if (i === 0 && mySeat() === -1) {
        const b = el('button', null, 'SIT DOWN');
        b.addEventListener('click', () => { sfx.play('click'); send({ kind: 'sit' }); });
        s.appendChild(b);
        s.appendChild(el('div', 'bj-seat-bank', 'brings your casino balance'));
      } else if (i === (mySeat() === -1 ? 1 : 0)) {
        s.appendChild(addBotButton(api));
      } else {
        s.appendChild(el('div', 'bj-seat-bank', 'open seat'));
      }
      grid.appendChild(s);
    }
    parent.appendChild(grid);
  }

  function chipButton(d, disabled) {
    const b = el('button', `bj-chip c${d}`, d >= 1000 ? `${d / 1000}k` : String(d));
    b.disabled = disabled;
    b.title = `Bet ${d}`;
    b.addEventListener('click', () => { sfx.play('chips'); send({ kind: 'bet', amount: d }); });
    return b;
  }

  function renderPanel(parent) {
    const panel = el('div', 'bj-panel');
    const p = view.players[me()];
    const seated = mySeat() !== -1;
    if (!seated && !myEntry()) {
      panel.appendChild(el('div', null, view.seats.length >= 6 ? 'Table full. Watching.' : 'Watching. Take a seat to play.'));
      parent.appendChild(panel);
      return;
    }

    if (view.phase === 'betting' && p) {
      const broke = p.bankroll < view.minBet && p.bet === 0;
      if (broke) {
        panel.appendChild(el('div', null, 'Out of chips. Stand up, then claim the daily stipend or work a shift in the CASINO lobby.'));
      } else {
        const line = el('div', 'bj-bigbet');
        line.innerHTML = `Bet: <b>$${fmt(p.bet)}</b> · Bankroll $${fmt(p.bankroll - p.bet)} · min ${view.minBet} / max ${view.maxBet}`;
        panel.appendChild(line);
        const chips = el('div', 'bj-row');
        for (const d of view.chips) chips.appendChild(chipButton(d, p.ready || p.bet + d > Math.min(view.maxBet, p.bankroll)));
        panel.appendChild(chips);
        const acts = el('div', 'bj-row bj-act');
        const clear = el('button', null, 'CLEAR');
        clear.disabled = p.bet === 0;
        clear.addEventListener('click', () => { sfx.play('click'); send({ kind: 'clearBet' }); });
        const rebet = el('button', null, p.lastBet ? `REBET ${fmt(p.lastBet)}` : 'REBET');
        rebet.disabled = p.ready || !p.lastBet || p.bet > 0 || p.bankroll < view.minBet;
        rebet.addEventListener('click', () => { sfx.play('chips'); send({ kind: 'rebet' }); });
        const deal = el('button', null, p.ready ? 'WAITING…' : 'DEAL');
        deal.appendChild(el('span', 'k', '␣'));
        deal.disabled = p.ready || p.bet < view.minBet;
        if (!deal.disabled) deal.classList.add('hint');
        deal.addEventListener('click', () => { sfx.play('click'); send({ kind: 'deal' }); });
        acts.append(clear, rebet, deal);
        panel.appendChild(acts);
      }
      if (view.deadline) addTimer(panel, view.deadline, 15000);
    } else if (view.phase === 'insurance') {
      const e = myEntry();
      if (e && !e.insDecided) {
        const cost = e.hands[0].bet / 2;
        panel.appendChild(el('div', null, e.hands[0].natural ? 'You have blackjack. Insurance = take even money.' : `Insurance costs $${fmt(cost)} and pays 2:1 if the dealer has blackjack.`));
        const row = el('div', 'bj-row bj-act');
        const yes = el('button', null, 'INSURE');
        yes.disabled = p.bankroll < cost;
        yes.addEventListener('click', () => { sfx.play('chips'); send({ kind: 'insurance', take: true }); });
        const no = el('button', null, 'NO THANKS');
        if (hints) no.classList.add('hint');
        no.addEventListener('click', () => { sfx.play('click'); send({ kind: 'insurance', take: false }); });
        row.append(yes, no);
        panel.appendChild(row);
        if (hints) panel.appendChild(el('div', 'bj-hinttext', 'Hint: basic strategy never takes insurance.'));
        if (view.deadline) addTimer(panel, view.deadline, 10000);
      } else {
        panel.appendChild(el('div', null, 'Waiting for the others to decide on insurance…'));
      }
    } else if (view.phase === 'playing' && myTurn()) {
      const t = myTurn();
      const L = legal(t);
      const adv = hints ? advice(t) : null;
      const row = el('div', 'bj-row bj-act');
      const mk = (kind, label, key) => {
        const b = el('button', null, label);
        b.appendChild(el('span', 'k', key));
        b.disabled = !L[kind];
        if (adv === kind) b.classList.add('hint');
        b.addEventListener('click', () => doAction(kind));
        return b;
      };
      row.append(mk('hit', 'HIT', 'H'), mk('stand', 'STAND', 'S'), mk('double', 'DOUBLE', 'D'), mk('split', 'SPLIT', 'P'));
      panel.appendChild(row);
      panel.appendChild(el('div', 'bj-hinttext', adv ? `Hint: ${adviceLabel(adv)} (${t.hand.soft ? 'soft' : 'hard'} ${t.hand.total} vs ${view.round.dealer.cards[0].rank})` : `Your hand: ${t.hand.total}${t.hand.soft ? ' (soft)' : ''}`));
    } else if (view.phase === 'settle') {
      const e = myEntry();
      if (e) {
        const net = e.hands.reduce((s, h) => s + (h.payout || 0), 0) + (e.insurance > 0 ? (view.round.dealer.natural ? e.insurance * 2 : -e.insurance) : 0);
        const line = el('div', 'bj-bigbet');
        line.innerHTML = `This round: <b class="${net > 0 ? 'bj-pos' : net < 0 ? 'bj-neg' : ''}">${signed(net)}</b>`;
        panel.appendChild(line);
      } else panel.appendChild(el('div', null, 'Next round starting…'));
    } else if (view.phase === 'shoe_over') {
      const b = el('button', null, 'NEXT SHOE');
      b.addEventListener('click', () => send({ kind: 'continue' }));
      panel.appendChild(b);
    } else {
      const t = currentTurn();
      panel.appendChild(el('div', null, t ? `Waiting for ${nameFor(t.entry.id)}…` : myEntry() ? 'Good luck.' : 'Sitting this round out. You can bet next round.'));
    }
    if (seated) {
      const leaveRow = el('div', 'bj-row');
      const leave = el('button', null, 'LEAVE SEAT');
      leave.style.fontSize = '.75em';
      leave.style.padding = '3px 10px';
      leave.addEventListener('click', () => send({ kind: 'leaveSeat' }));
      leaveRow.appendChild(leave);
      if (view.phase === 'betting') {
        const tip = el('button', null, `TIP DEALER $${view.chips[0]}`);
        tip.style.fontSize = '.75em';
        tip.style.padding = '3px 10px';
        tip.addEventListener('click', () => send({ kind: 'tip' }));
        leaveRow.appendChild(tip);
      }
      panel.appendChild(leaveRow);
    }
    parent.appendChild(panel);
  }

  function renderBoard(parent) {
    const ids = [...view.seats];
    if (view.round) for (const e of view.round.entries) if (!ids.includes(e.id)) ids.push(e.id);
    if (!ids.length) return;
    ids.sort((a, b) => (view.players[b] ? view.players[b].bankroll : 0) - (view.players[a] ? view.players[a].bankroll : 0));
    const table = el('table', 'bj-board');
    const head = el('tr');
    for (const h of ['PLAYER', 'BANKROLL', 'NET', 'W-L-P', 'BJ', 'REBUYS']) head.appendChild(el('th', null, h));
    table.appendChild(head);
    for (const id of ids) {
      const p = view.players[id];
      if (!p) continue;
      const tr = el('tr', id === me() ? 'me' : '');
      tr.appendChild(el('td', null, nameFor(id)));
      tr.appendChild(el('td', null, `$${fmt(p.bankroll)}`));
      tr.appendChild(el('td', p.net > 0 ? 'bj-pos' : p.net < 0 ? 'bj-neg' : '', signed(p.net)));
      tr.appendChild(el('td', null, `${p.stats.won}-${p.stats.lost}-${p.stats.push}`));
      tr.appendChild(el('td', null, String(p.stats.blackjacks)));
      tr.appendChild(el('td', null, String(p.rebuys)));
      table.appendChild(tr);
    }
    parent.appendChild(table);
  }

  function doAction(kind) {
    const t = myTurn();
    if (!t) return;
    if (!legal(t)[kind]) { sfx.play('error'); return; }
    sfx.play(kind === 'double' || kind === 'split' ? 'chips' : 'click');
    send({ kind });
  }

  function onKey(ev) {
    if (!view || ev.target.closest('input, textarea, select')) return;
    const k = ev.key.toLowerCase();
    if (view.phase === 'playing' && myTurn()) {
      const map = { h: 'hit', s: 'stand', d: 'double', p: 'split' };
      if (map[k]) { ev.preventDefault(); doAction(map[k]); }
    } else if (view.phase === 'betting' && (k === ' ' || k === 'enter')) {
      const p = view.players[me()];
      if (p && !p.ready && p.bet >= view.minBet) { ev.preventDefault(); sfx.play('click'); send({ kind: 'deal' }); }
      else if (p && !p.ready && p.bet === 0 && p.lastBet && k === ' ') { ev.preventDefault(); send({ kind: 'rebet' }); }
    }
  }
  window.addEventListener('keydown', onKey);

  function renderResults() {
    if (!view || view.phase !== 'shoe_over') { results.update(null); return; }
    const ids = view.seats.filter((id) => view.players[id]);
    ids.sort((a, b) => view.players[b].shoeNet - view.players[a].shoeNet);
    const best = ids.length ? view.players[ids[0]].shoeNet : 0;
    const winners = ids.filter((id) => view.players[id].shoeNet === best && best > 0);
    const seated = mySeat() !== -1;
    const iWon = winners.includes(me());
    results.update({
      title: seated ? (iWon ? 'TOP OF THE TABLE' : view.players[me()].shoeNet >= 0 ? 'SHOE COMPLETE' : 'THE HOUSE WINS') : 'SHOE COMPLETE',
      subtitle: `Shoe #${view.shoeNo} done after ${view.shoeRounds} rounds. Standings for this shoe`,
      outcome: seated ? (iWon ? 'win' : view.players[me()].shoeNet >= 0 ? 'over' : 'lose') : 'over',
      rows: ids.map((id) => ({ name: nameFor(id), value: `${signed(view.players[id].shoeNet)} · $${fmt(view.players[id].bankroll)}`, win: winners.includes(id), you: id === me() })),
      rematch: seated ? { label: 'NEXT SHOE', onClick: () => send({ kind: 'continue' }) } : null,
    });
  }

  function render() {
    timerEls.length = 0;
    renderResults();
    root.innerHTML = '';
    if (!view) { root.textContent = 'Loading…'; return; }

    const top = el('div', 'bj-top');
    const status = el('div', 'bj-status', statusText());
    if (view.deadline && (view.phase === 'betting' || view.phase === 'shoe_over' || view.phase === 'insurance' || view.phase === 'playing')) {
      const cd = el('span', 'bj-cd');
      status.appendChild(cd);
      timerEls.push({ fill: null, deadline: view.deadline, total: 1, text: cd });
    }
    top.appendChild(status);
    const tools = el('div', 'bj-tools');
    const shoe = el('div', 'bj-shoe');
    shoe.title = `Shoe: ${view.shoeLeft} of ${view.shoeSize} cards left (red line = cut card)`;
    shoe.appendChild(el('span', null, 'SHOE'));
    const bar = el('div', 'bj-shoe-bar');
    const fill = el('div', 'bj-shoe-fill');
    fill.style.width = `${(view.shoeLeft / view.shoeSize) * 100}%`;
    const cut = el('div', 'bj-shoe-cut');
    cut.style.left = `${(view.cutAt / view.shoeSize) * 100}%`;
    bar.append(fill, cut);
    shoe.appendChild(bar);
    if (view.reshuffleNext) shoe.appendChild(el('span', 'bj-neg', 'cut.'));
    tools.appendChild(shoe);
    const hb = el('button', hints ? 'on' : '', hints ? 'HINTS: ON' : 'HINTS: OFF');
    hb.title = 'Highlight the basic-strategy play';
    hb.addEventListener('click', () => {
      hints = !hints;
      try { localStorage.setItem(HINT_KEY, hints ? '1' : '0'); } catch { /* ignore */ }
      sfx.play('click');
      render();
    });
    tools.appendChild(hb);
    top.appendChild(tools);
    root.appendChild(top);

    const felt = el('div', 'bj-felt');
    renderDealer(felt);
    renderSeats(felt);
    if (pendingBanner) {
      const b = el('div', 'bj-banner', pendingBanner.text);
      b.style.color = pendingBanner.color;
      felt.appendChild(b);
      pendingBanner = null;
    }
    root.appendChild(felt);
    root.appendChild(el('div', 'bj-toast', toast));
    renderPanel(root);
    renderBoard(root);
    tickTimers();
  }

  // Sounds + banners from what changed between two views.
  function react(prev, next) {
    if (!prev) return;
    const countCards = (v) => {
      if (!v.round) return 0;
      let n = v.round.dealer.cards.filter(Boolean).length;
      for (const e of v.round.entries) for (const h of e.hands) n += h.cards.length;
      return n;
    };
    const ev = next.lastEvent;
    const fresh = ev && (!lastSeenEvent || ev.id !== lastSeenEvent);
    if (ev) lastSeenEvent = ev.id;
    if (countCards(next) > countCards(prev)) sfx.play('card');
    if (fresh) {
      if (ev.kind === 'shuffle') sfx.play('whoosh');
      if (ev.kind === 'deal') sfx.play('deal');
      if (ev.kind === 'tip') { sfx.play('chips'); showToast(`${nameFor(ev.id)} tipped the dealer $${ev.amount}. "${TIP_THANKS[ev.id.length % TIP_THANKS.length]}"`); }
      if (ev.kind === 'dealerBlackjack') pendingBanner = { text: 'DEALER BLACKJACK', color: '#ff4d4d' };
      if (ev.kind === 'bust' && ev.who === me()) sfx.play('crash');
      if (ev.kind === 'timeout' && ev.who === me()) showToast('Time up. You stood.');
      if (ev.kind === 'settle') {
        const e = next.round && next.round.entries.find((x) => x.id === me());
        if (e) {
          const net = e.hands.reduce((s, h) => s + (h.payout || 0), 0);
          const bj = e.hands.some((h) => h.result === 'blackjack');
          if (bj) pendingBanner = { text: 'BLACKJACK', color: '#ffd23f' };
          else if (next.round.dealer.bust && net > 0) pendingBanner = { text: 'DEALER BUSTS', color: '#39ff14' };
          setTimeout(() => sfx.play(net > 0 ? 'win' : net < 0 ? 'lose' : 'point'), 150);
        } else if (next.round && next.round.dealer.bust) pendingBanner = { text: 'DEALER BUSTS', color: '#39ff14' };
      }
    }
    const wasMine = prev.phase === 'playing' && prev.round && prev.round.turn && prev.round.entries[prev.round.turn.e] && prev.round.entries[prev.round.turn.e].id === me();
    const isMine = !!(next.phase === 'playing' && next.round && next.round.turn && next.round.entries[next.round.turn.e] && next.round.entries[next.round.turn.e].id === me());
    if (isMine && (!wasMine || prev.round.turn.h !== next.round.turn.h)) setTimeout(() => sfx.play('turn'), 120);
    if (next.phase === 'insurance' && prev.phase !== 'insurance' && next.round.entries.some((e) => e.id === me())) sfx.play('check');
  }

  render();

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      clock.sync(snapshot && snapshot.serverNow);
      lastSeenEvent = snapshot && snapshot.lastEvent ? snapshot.lastEvent.id : null;
      render();
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        const prev = view;
        view = data;
        clock.sync(data.serverNow);
        react(prev, data);
        render();
      } else if (data.kind === 'moveRejected') {
        sfx.play('error');
        root.classList.remove('bj-flash');
        void root.offsetWidth;
        root.classList.add('bj-flash');
        showToast(view && data.reason === 'over_max' ? `Table max is $${view.maxBet}` : view && data.reason === 'under_min' ? `Minimum bet is $${view.minBet}` : REJECT[data.reason] || 'Not allowed');
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      render();
    },
    unmount() {
      clearInterval(timerHandle);
      clearTimeout(toastTimer);
      window.removeEventListener('keydown', onKey);
      results.destroy();
      container.innerHTML = '';
    },
  };
}

// Exposed for tests.
export const _test = { chipBreakdown, handValue };
