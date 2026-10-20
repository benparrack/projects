// Texas Hold'em cash table in the CASINO: $1/$2 blinds, buy in from your casino balance.
// Server plugin: ../../../server/games/poker.js

import { renderCard, isBot, botName, botSeatControls } from '../cardCommon.js';
import { sfx, tableSounds, seatResult } from '../sfx.js';

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

export function mount(container, api) {
  let view = null;
  let roster = [];
  let raiseAmount = null;
  let confirmingFold = false; // FOLD sits right next to CALL — this guards against a misclick
  let buyIn = null; // chosen buy-in amount, defaults to the max you can afford
  let notice = '';

  const root = document.createElement('div');
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '10px';
  root.style.alignItems = 'center';
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
    top.className = 'casino-balance';
    top.textContent = `${money(sb)}/${money(bb)} NO LIMIT${view.balance != null ? ` · BALANCE ${money(view.balance)}` : ''}`;
    root.appendChild(top);

    const status = document.createElement('div');
    const dealIn = view.nextAt ? Math.max(0, Math.ceil((view.nextAt - Date.now()) / 1000)) : null;
    if (view.phase === 'waiting') {
      status.textContent = dealIn != null ? `Dealing in ${dealIn}s…` : `Waiting for players (${view.seats.length}/6 seated, need 2 stacks to deal).`;
    } else if (view.phase === 'playing') {
      status.textContent = `${h.stage.toUpperCase()} — ${nameAt(h.toAct)}${h.toAct === mySeat ? ' (you)' : ''} to act — pot: ${money(h.potTotal)}`;
    } else if (view.phase === 'hand_over') {
      const r = h.lastResult;
      status.textContent = (r.kind === 'fold' ? `${nameAt(r.winnerSeat)} wins ${money(r.payouts[r.winnerSeat])}, everyone else folded.` : 'Showdown!')
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
    seatRow.style.display = 'flex';
    seatRow.style.gap = '8px';
    seatRow.style.flexWrap = 'wrap';
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
    seatRow.appendChild(botSeatControls(api, view.seats, 6, 'waiting'));
    root.appendChild(seatRow);

    // Seats around the table: chips, current bet, dealer marker, folded/all-in state.
    const seatsRow = document.createElement('div');
    seatsRow.style.display = 'flex';
    seatsRow.style.gap = '14px';
    seatsRow.style.flexWrap = 'wrap';
    seatsRow.style.justifyContent = 'center';
    view.seats.forEach((clientId, i) => {
      const col = document.createElement('div');
      col.style.display = 'flex';
      col.style.flexDirection = 'column';
      col.style.alignItems = 'center';
      col.style.gap = '2px';
      col.style.padding = '6px';
      col.style.border = h && h.toAct === i && view.phase === 'playing' ? '2px solid #39ff14' : '1px solid transparent';
      col.style.opacity = h && h.folded[i] ? '0.4' : '1';
      const name = document.createElement('div');
      name.textContent = `${i === view.dealerIdx && h ? '(D) ' : ''}${nicknameFor(clientId)}${view.flair && view.flair[clientId] ? ` ${view.flair[clientId]}` : ''}${clientId === api.getClientId() ? ' (you)' : ''}${view.leaving.includes(clientId) ? ' (left)' : ''}`;
      name.style.fontSize = '0.85em';
      col.appendChild(name);
      const chips = document.createElement('div');
      chips.textContent = view.chips[i] > 0 ? money(view.chips[i]) : 'busted';
      chips.style.fontSize = '0.8em';
      chips.style.opacity = '0.8';
      col.appendChild(chips);
      if (h) {
        const bet = document.createElement('div');
        bet.textContent = h.folded[i] ? 'folded' : h.allIn[i] ? 'ALL IN' : h.bets[i] > 0 ? `bet ${money(h.bets[i])}` : '';
        bet.style.fontSize = '0.75em';
        bet.style.color = '#ffb000';
        col.appendChild(bet);
      }
      seatsRow.appendChild(col);
    });
    root.appendChild(seatsRow);

    if (h && (view.phase === 'playing' || view.phase === 'hand_over')) {
      const table = document.createElement('div');
      table.className = 'pk-felt';
      table.style.display = 'flex';
      table.style.flexDirection = 'column';
      table.style.alignItems = 'center';
      table.style.gap = '6px';
      const communityRow = document.createElement('div');
      communityRow.style.display = 'flex';
      communityRow.style.gap = '4px';
      for (const card of h.community) communityRow.appendChild(renderCard(card));
      for (let i = h.community.length; i < 5; i++) communityRow.appendChild(renderCard(null, { faceDown: true }));
      table.appendChild(communityRow);
      const potLabel = document.createElement('div');
      potLabel.textContent = `Pot: ${money(h.potTotal)}`;
      potLabel.style.opacity = '0.8';
      table.appendChild(potLabel);
      root.appendChild(table);
    }

    if (view.phase === 'hand_over' && h.lastResult.kind === 'showdown') {
      const reveal = document.createElement('div');
      reveal.style.display = 'flex';
      reveal.style.flexDirection = 'column';
      reveal.style.alignItems = 'center';
      reveal.style.gap = '4px';
      for (const entry of h.lastResult.revealedHands) {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '6px';
        const label = document.createElement('span');
        const won = h.lastResult.payouts[entry.seat] > 0;
        label.textContent = `${nameAt(entry.seat)}${won ? ` 🏆 +${money(h.lastResult.payouts[entry.seat])}` : ''}: ${HAND_NAMES[entry.best[0]]}`;
        label.style.fontWeight = won ? 'bold' : 'normal';
        row.appendChild(label);
        for (const card of entry.cards) row.appendChild(renderCard(card, { small: true }));
        reveal.appendChild(row);
      }
      root.appendChild(reveal);
    }

    if (mySeat !== -1 && h && h.myHoleCards && h.myHoleCards.length && view.phase !== 'waiting') {
      const holeLabel = document.createElement('div');
      holeLabel.textContent = 'Your hand:';
      holeLabel.style.fontSize = '0.8em';
      root.appendChild(holeLabel);
      const holeRow = document.createElement('div');
      holeRow.style.display = 'flex';
      holeRow.style.gap = '4px';
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
      actions.style.display = 'flex';
      actions.style.gap = '8px';
      actions.style.alignItems = 'center';
      actions.style.flexWrap = 'wrap';

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
