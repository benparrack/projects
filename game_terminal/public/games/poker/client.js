// Texas Hold'em cash table in the CASINO: $1/$2 blinds, buy in from your casino balance.
// Server plugin: ../../../server/games/poker.js

import { renderCard, isBot, botName, botSeatControls } from '../cardCommon.js';
import { sfx, tableSounds, seatResult } from '../sfx.js';
import { injectStyle } from '../dom.js';

const money = (n) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const REJECT = {
  broke: 'Not enough in your casino balance for that buy-in. Claim the daily stipend or work a shift in the CASINO menu.',
  wallet_loading: 'Opening your casino balance… try again in a second.',
  table_full: 'The table is full.',
  in_hand: 'Finish this hand first.',
  at_max: 'Your stack is already at the maximum buy-in.',
  need_players: 'Need two stacks at the table to deal.',
};

// Mirrors server/games/poker.js's HAND_NAMES (category index -> display name) — duplicated here
// since it's just a tiny display lookup, not game logic that needs to stay authoritative.
const HAND_NAMES = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

const CSS = `
.pk { display: flex; flex-direction: column; gap: 10px; align-items: center; width: 100%; max-width: 760px; margin: 0 auto; }
.pk-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; width: 100%; }
.pk-bal { color: #ffd23f; font-weight: bold; }
.pk-status { font-size: .95em; color: #e8dcb0; text-align: center; min-height: 1.3em; }
.pk-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: center; }
.pk-felt {
  position: relative; width: calc(100% - 60px); aspect-ratio: 16 / 9; margin: 34px 30px 40px; border-radius: 50%;
  background: radial-gradient(ellipse at 50% 40%, #1d6b2a 0%, #0f4a1b 55%, #082d10 100%);
  border: 14px solid #5a3a12; box-shadow: inset 0 0 0 2px rgba(255,220,120,.25), inset 0 0 50px rgba(0,0,0,.6), 0 0 0 3px #2b1a06, 0 10px 28px rgba(0,0,0,.7);
  border-image: none;
}
.pk-felt::before { content: ''; position: absolute; inset: 9%; border-radius: 50%; border: 1px solid rgba(255,220,120,.16); pointer-events: none; }
.pk-center { position: absolute; left: 50%; top: 57%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 6px; }
.pk-board { display: flex; gap: 4px; }
.pk-pot { font-weight: bold; color: #ffe9a6; background: rgba(0,0,0,.5); border: 1px solid rgba(255,210,63,.5); border-radius: 12px; padding: 2px 12px; font-size: .9em; }
.pk-logo { font-family: Georgia, serif; font-style: italic; letter-spacing: 3px; color: rgba(255,220,120,.35); font-size: 1.4em; white-space: nowrap; }
.pk-seat {
  position: absolute; transform: translate(-50%, -50%); width: 112px; display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 4px 6px 5px; border-radius: 10px; background: linear-gradient(180deg, #1c1408, #0b0803); border: 2px solid #8a6a2a;
  box-shadow: 0 4px 10px rgba(0,0,0,.6); color: #f3e6c0; z-index: 2; transition: box-shadow .2s, opacity .2s;
}
.pk-seat.me { border-color: #39ff14; }
.pk-seat.turn { border-color: #ffd23f; box-shadow: 0 0 0 2px #ffd23f, 0 0 20px rgba(255,210,63,.6); }
.pk-seat.folded { opacity: .45; }
.pk-seat.won { border-color: #ffd23f; box-shadow: 0 0 22px rgba(255,210,63,.8); animation: pk-won 1s ease-in-out 3; }
@keyframes pk-won { 50% { box-shadow: 0 0 4px rgba(255,210,63,.3); } }
.pk-hole { display: flex; gap: 2px; margin-top: -26px; min-height: 0; }
.pk-hole:empty { display: none; }
.pk-hole .gt-card.small { width: 30px; height: 42px; }
.pk-name { font-size: .78em; font-weight: bold; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pk-stack { font-size: .75em; color: #ffd23f; }
.pk-tag { font-size: .66em; font-weight: bold; letter-spacing: 1px; padding: 0 6px; border-radius: 4px; background: rgba(255,255,255,.12); max-width: 100%; text-align: center; }
.pk-tag.win { background: #ffd23f; color: #1a1200; }
.pk-dealer { position: absolute; right: -10px; top: -10px; width: 22px; height: 22px; border-radius: 50%; background: #fff; color: #111; font-weight: bold; font-size: .72em; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,.6); }
.pk-bet { position: absolute; top: 50%; transform: translateY(-50%); display: flex; align-items: center; gap: 4px; font-size: .75em; font-weight: bold; color: #fff; text-shadow: 0 1px 2px #000; z-index: 1; }
.pk-bet i { width: 16px; height: 16px; border-radius: 50%; background: radial-gradient(circle, #e04848 0 50%, transparent 52%), repeating-conic-gradient(#e04848 0 30deg, #fff 30deg 60deg); box-shadow: 0 2px 3px rgba(0,0,0,.6); }
.pk-bet.r { left: 100%; margin-left: 6px; } .pk-bet.l { right: 100%; margin-right: 6px; }
.pk-myhand { display: flex; gap: 6px; margin-top: -8px; }
.pk-myhand .gt-card { transform: scale(1.15); margin: 0 6px; }
.pk-myhand.folded { opacity: .45; }
.pk-actions { padding: 10px; border-radius: 10px; background: linear-gradient(180deg, #1c1408, #0b0803); border: 1px solid #8a6a2a; }
@media (max-width: 560px) {
  .pk-felt { aspect-ratio: 1 / 1.3; width: calc(100% - 40px); margin: 30px 20px 40px; border-width: 10px; }
  .pk-seat { width: 84px; padding: 3px 4px 4px; }
  .pk-board .gt-card { width: 36px; height: 52px; }
  .pk-board { gap: 2px; }
  .pk-logo { font-size: 1em; }
  .pk-center { top: 50%; }
}
`;

export function mount(container, api) {
  let view = null;
  let roster = [];
  let raiseAmount = null;
  let confirmingFold = false; // FOLD sits right next to CALL — this guards against a misclick
  let buyIn = null; // chosen buy-in amount, defaults to the max you can afford
  let notice = '';

  injectStyle(CSS);
  const root = document.createElement('div');
  root.className = 'pk cz';
  container.appendChild(root);

  function nicknameFor(clientId) {
    if (isBot(clientId)) return botName(clientId);
    const entry = roster.find((r) => r.clientId === clientId);
    return entry ? entry.nickname : 'someone';
  }
  function nameAt(seatIdx) {
    return nicknameFor(view.seats[seatIdx]);
  }
  function mySeatIndex() {
    if (!view) return -1;
    return view.seats.indexOf(api.getClientId());
  }

  function render() {
    root.innerHTML = '';
    if (!view) {
      root.textContent = 'Loading...';
      return;
    }

    const mySeat = mySeatIndex();
    const h = view.hand;

    const [sb, bb] = view.blinds;
    const [minBuy, maxBuy] = view.buyIn;
    const top = document.createElement('div');
    top.className = 'pk-top';
    top.innerHTML = `<span class="cz-title">${money(sb)}/${money(bb)} NO LIMIT HOLD'EM</span>`;
    if (view.balance != null) {
      const bal = document.createElement('span');
      bal.className = 'pk-bal';
      bal.textContent = `BALANCE ${money(view.balance)}`;
      top.appendChild(bal);
    }
    root.appendChild(top);

    const status = document.createElement('div');
    status.className = 'pk-status';
    const dealIn = view.nextAt ? Math.max(0, Math.ceil((view.nextAt - Date.now()) / 1000)) : null;
    if (view.phase === 'waiting') {
      status.textContent = dealIn != null ? `Dealing in ${dealIn}s…` : `Waiting for players (${view.seats.length}/6 seated, need 2 stacks to deal).`;
    } else if (view.phase === 'playing') {
      status.textContent = `${h.stage.toUpperCase()}. ${nameAt(h.toAct)}${h.toAct === mySeat ? ' (you)' : ''} to act. Pot: ${money(h.potTotal)}`;
    } else if (view.phase === 'hand_over') {
      const r = h.lastResult;
      status.textContent = (r.kind === 'fold' ? `${nameAt(r.winnerSeat)} wins ${money(r.payouts[r.winnerSeat])}, everyone else folded.` : 'Showdown.')
        + (dealIn != null ? ` Next hand in ${dealIn}s.` : '');
    }
    root.appendChild(status);
    if (notice) {
      const n = document.createElement('div');
      n.textContent = notice;
      n.style.color = '#ff4d4d';
      root.appendChild(n);
    }

    const seatRow = document.createElement('div');
    seatRow.className = 'pk-row';
    const leftTable = mySeat !== -1 && view.leaving.includes(api.getClientId());
    const myChips = mySeat !== -1 && !leftTable ? view.chips[mySeat] : 0;
    // Buy-in picker: SIT DOWN when standing, REBUY to top up a short stack between hands.
    const room = mySeat === -1 || leftTable ? maxBuy : maxBuy - myChips;
    const canTopUp = mySeat !== -1 && !leftTable && room > 0 && (view.phase !== 'playing' || h.folded[mySeat]);
    if (((mySeat === -1 && view.seats.length < 6) || leftTable || canTopUp)) {
      const afford = view.balance == null ? room : Math.min(room, Math.floor(view.balance));
      const lo = mySeat === -1 || leftTable ? minBuy : 1;
      if (afford >= lo) {
        buyIn = Math.max(lo, Math.min(buyIn ?? afford, afford));
        const amt = document.createElement('input');
        amt.type = 'number';
        amt.min = String(lo);
        amt.max = String(afford);
        amt.value = String(buyIn);
        amt.style.width = '70px';
        amt.setAttribute('aria-label', 'Buy-in amount');
        amt.addEventListener('input', () => { buyIn = Math.max(lo, Math.min(Number(amt.value) || lo, afford)); });
        const btn = document.createElement('button');
        btn.textContent = mySeat === -1 || leftTable ? 'SIT DOWN WITH $' : myChips === 0 ? 'REBUY $' : 'TOP UP $';
        btn.addEventListener('click', () => { api.sendAction({ kind: mySeat === -1 || leftTable ? 'sit' : 'rebuy', amount: buyIn }); buyIn = null; });
        seatRow.append(btn, amt);
      } else if (mySeat === -1 || myChips === 0) {
        const broke = document.createElement('span');
        broke.textContent = `You need ${money(lo)} to sit. Stipend and shifts are in the CASINO menu.`;
        seatRow.appendChild(broke);
      }
    }
    if (mySeat !== -1 && !leftTable) {
      const leaveBtn = document.createElement('button');
      const inHand = view.phase === 'playing' && !h.folded[mySeat] && !h.allIn[mySeat];
      leaveBtn.textContent = inHand ? 'LEAVE (folds hand)' : 'LEAVE SEAT';
      leaveBtn.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seatRow.appendChild(leaveBtn);
    }
    if (view.phase !== 'playing' && mySeat !== -1 && view.chips.filter((c) => c > 0).length >= 2) {
      const startBtn = document.createElement('button');
      startBtn.textContent = 'DEAL NOW';
      startBtn.addEventListener('click', () => api.sendAction({ kind: 'startGame' }));
      seatRow.appendChild(startBtn);
    }
    // Bots can join between or during hands (they sit out until the next deal).
    seatRow.appendChild(botSeatControls(api, view.seats, 6, 'waiting', 'hard'));
    root.appendChild(seatRow);

    // The table: an oval felt with the seats around the rail (you at the bottom), the board and pot
    // in the middle, each seat's bet pushed out in front of it, and hands turned up at showdown.
    const table = document.createElement('div');
    table.className = 'pk-felt';
    const center = document.createElement('div');
    center.className = 'pk-center';
    if (h && (view.phase === 'playing' || view.phase === 'hand_over')) {
      const board = document.createElement('div');
      board.className = 'pk-board';
      for (const card of h.community) board.appendChild(renderCard(card));
      for (let i = h.community.length; i < 5; i++) board.appendChild(renderCard(null, { faceDown: true }));
      center.appendChild(board);
      const pot = document.createElement('div');
      pot.className = 'pk-pot';
      pot.textContent = `POT ${money(h.potTotal)}`;
      center.appendChild(pot);
    } else {
      center.innerHTML = '<div class="pk-logo">TEXAS HOLD\'EM</div>';
    }
    table.appendChild(center);
    const revealed = view.phase === 'hand_over' && h && h.lastResult.kind === 'showdown' ? h.lastResult.revealedHands : [];
    const payouts = view.phase === 'hand_over' && h ? h.lastResult.payouts : null;
    const base = Math.max(0, mySeat);
    view.seats.forEach((clientId, i) => {
      const n = Math.max(2, view.seats.length);
      const a = Math.PI / 2 + ((i - base + n) % n) * (2 * Math.PI / n); // you at the bottom, the rest spread clockwise
      const pod = document.createElement('div');
      pod.className = 'pk-seat';
      if (clientId === api.getClientId()) pod.classList.add('me');
      if (h && h.toAct === i && view.phase === 'playing') pod.classList.add('turn');
      if (h && h.folded[i]) pod.classList.add('folded');
      if (payouts && payouts[i] > 0) pod.classList.add('won');
      pod.style.left = `${50 + 44 * Math.cos(a)}%`;
      pod.style.top = `${50 + 42 * Math.sin(a)}%`;
      const name = document.createElement('div');
      name.className = 'pk-name';
      name.textContent = `${nicknameFor(clientId)}${view.flair && view.flair[clientId] ? ` ${view.flair[clientId]}` : ''}${view.leaving.includes(clientId) ? ' (left)' : ''}`;
      const stack = document.createElement('div');
      stack.className = 'pk-stack';
      stack.textContent = view.chips[i] > 0 ? money(view.chips[i]) : 'busted';
      const shown = revealed.find((r) => r.seat === i);
      const cards = document.createElement('div');
      cards.className = 'pk-hole';
      if (shown) for (const card of shown.cards) cards.appendChild(renderCard(card, { small: true }));
      else if (h && view.phase !== 'waiting' && !h.folded[i] && clientId !== api.getClientId() && h.totalContributed && h.totalContributed[i] > 0) {
        cards.append(renderCard(null, { faceDown: true, small: true }), renderCard(null, { faceDown: true, small: true }));
      }
      pod.append(cards, name, stack);
      const tag = shown ? HAND_NAMES[shown.best[0]] : h && h.allIn[i] && !h.folded[i] ? 'ALL IN' : h && h.folded[i] ? 'FOLD' : '';
      if (payouts && payouts[i] > 0) {
        const won = document.createElement('div');
        won.className = 'pk-tag win';
        won.textContent = `+${money(payouts[i])}${tag ? ` · ${tag}` : ''}`;
        pod.appendChild(won);
      } else if (tag) {
        const t = document.createElement('div');
        t.className = 'pk-tag';
        t.textContent = tag;
        pod.appendChild(t);
      }
      if (i === view.dealerIdx && h) {
        const d = document.createElement('div');
        d.className = 'pk-dealer';
        d.textContent = 'D';
        pod.appendChild(d);
      }
      if (h && view.phase === 'playing' && h.bets[i] > 0) {
        // The bet sits beside the seat on the side facing the middle (seats at the right put it left).
        const bet = document.createElement('div');
        bet.className = `pk-bet ${Math.cos(a) > 0.2 ? 'l' : 'r'}`;
        bet.innerHTML = '<i></i>';
        bet.append(money(h.bets[i]));
        pod.appendChild(bet);
      }
      table.appendChild(pod);
    });
    root.appendChild(table);

    if (mySeat !== -1 && h && h.myHoleCards && h.myHoleCards.length && view.phase !== 'waiting') {
      const holeRow = document.createElement('div');
      holeRow.className = 'pk-myhand';
      if (h.folded[mySeat]) holeRow.classList.add('folded');
      for (const card of h.myHoleCards) holeRow.appendChild(renderCard(card));
      root.appendChild(holeRow);
    }

    if (view.phase === 'playing' && h.toAct === mySeat) {
      const toCall = h.currentBet - h.bets[mySeat];
      const myStack = view.chips[mySeat];
      const maxRaiseTo = h.bets[mySeat] + myStack;
      const minRaiseTo = Math.min(h.currentBet + bb, maxRaiseTo);
      if (raiseAmount === null) raiseAmount = minRaiseTo;

      const actions = document.createElement('div');
      actions.className = 'pk-row pk-actions';

      const foldBtn = document.createElement('button');
      if (confirmingFold) {
        foldBtn.textContent = 'CONFIRM FOLD?';
        foldBtn.style.color = '#ff4d4d';
        foldBtn.style.borderColor = '#ff4d4d';
        foldBtn.addEventListener('click', () => {
          confirmingFold = false;
          api.sendAction({ kind: 'fold' });
        });
        actions.appendChild(foldBtn);
        const cancelFoldBtn = document.createElement('button');
        cancelFoldBtn.textContent = 'CANCEL';
        cancelFoldBtn.addEventListener('click', () => {
          confirmingFold = false;
          render();
        });
        actions.appendChild(cancelFoldBtn);
      } else {
        foldBtn.textContent = 'FOLD';
        foldBtn.addEventListener('click', () => {
          confirmingFold = true;
          render();
        });
        actions.appendChild(foldBtn);
      }

      const callBtn = document.createElement('button');
      callBtn.textContent = toCall <= 0 ? 'CHECK' : `CALL ${money(Math.min(toCall, myStack))}`;
      callBtn.addEventListener('click', () => api.sendAction({ kind: toCall <= 0 ? 'check' : 'call' }));
      actions.appendChild(callBtn);

      if (maxRaiseTo > h.currentBet) {
        const raiseInput = document.createElement('input');
        raiseInput.type = 'range';
        raiseInput.min = String(minRaiseTo);
        raiseInput.max = String(maxRaiseTo);
        raiseInput.value = String(Math.min(raiseAmount, maxRaiseTo));
        raiseInput.addEventListener('input', () => {
          raiseAmount = Number(raiseInput.value);
          amountInput.value = String(raiseAmount);
          raiseBtn.textContent = raiseAmount >= maxRaiseTo ? 'ALL IN' : 'RAISE TO';
        });
        actions.appendChild(raiseInput);
        const amountInput = document.createElement('input');
        amountInput.type = 'number';
        amountInput.min = String(minRaiseTo);
        amountInput.max = String(maxRaiseTo);
        amountInput.value = String(Math.min(raiseAmount, maxRaiseTo));
        amountInput.style.width = '70px';
        amountInput.addEventListener('input', () => {
          const typed = Number(amountInput.value);
          if (!Number.isFinite(typed)) return;
          raiseAmount = Math.max(minRaiseTo, Math.min(typed, maxRaiseTo));
          raiseInput.value = String(raiseAmount);
          raiseBtn.textContent = raiseAmount >= maxRaiseTo ? 'ALL IN' : 'RAISE TO';
        });
        amountInput.addEventListener('blur', () => {
          // Snap the displayed value back in range once they're done typing (e.g. they typed
          // "50" then kept typing toward "500" — mid-edit we don't want to fight the field).
          amountInput.value = String(raiseAmount);
        });
        actions.appendChild(amountInput);
        const raiseBtn = document.createElement('button');
        raiseBtn.textContent = raiseAmount >= maxRaiseTo ? 'ALL IN' : 'RAISE TO';
        raiseBtn.addEventListener('click', () => {
          api.sendAction({ kind: 'raise', amount: raiseAmount });
          raiseAmount = null;
        });
        actions.appendChild(raiseBtn);
      }
      root.appendChild(actions);
    } else {
      raiseAmount = null;
      confirmingFold = false;
    }
  }

  // Move the server's deal time onto our clock.
  function localClock(v) {
    if (v && v.nextAt) v.nextAt += Date.now() - v.serverNow;
    return v;
  }

  render();
  // Re-render each second so the "next hand in Ns" countdown moves.
  const countdown = setInterval(() => { if (view && view.nextAt) render(); }, 1000);

  return {
    applySnapshot(snapshot) {
      view = localClock(snapshot);
      render();
    },
    applyEvent(data) {
      if (data && data.kind === 'moveRejected') {
        sfx.play('error');
        notice = REJECT[data.reason] || '';
        render();
        return;
      }
      if (data && data.kind === 'state') {
        notice = '';
        const prevView = view;
        // Count down against our clock, offset by the server's.
        localClock(data);
        view = data;
        tableSounds(prevView, data, (v) => {
          const me = v.seats.indexOf(api.getClientId());
          const h = v.hand || {};
          return { played: (h.community || []).length, hand: (h.myHoleCards || []).length * 2,
            myTurn: me >= 0 && h.toAct === me && v.phase === 'playing',
            result: v.phase === 'hand_over' && me >= 0 && h.totalContributed && h.totalContributed[me] > 0
              ? seatResult(h.lastResult.payouts[me] > h.totalContributed[me] ? me : -2, me) : null };
        });
        if (prevView && prevView.hand && data.hand && data.hand.potTotal > prevView.hand.potTotal) sfx.play('chips');
        render();
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      render();
    },
    unmount() {
      clearInterval(countdown);
      container.innerHTML = '';
    },
  };
}
