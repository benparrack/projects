// BS / Cheat — 2-6 players. On your turn, select 1-4 cards and play them face-down claiming
// they're the required rank. Anyone else can CALL BS; the next player in turn order can instead
// let the play ride. Server plugin: ../../../server/games/bs.js

import { renderCard, SUIT_GLYPH } from '../cardCommon.js';

export function mount(container, api) {
  let view = null;
  let roster = [];
  let selected = new Set();

  const root = document.createElement('div');
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '10px';
  root.style.alignItems = 'center';
  container.appendChild(root);

  function nicknameFor(clientId) {
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
    const status = document.createElement('div');
    if (view.phase === 'waiting') {
      status.textContent = `Waiting for players (${view.seats.length}/6 seated, need 2+ to start).`;
    } else if (view.phase === 'playing') {
      status.textContent = `${nameAt(view.turnIdx)}${view.turnIdx === mySeat ? ' (you)' : ''} must play claiming: ${view.requiredRank}`;
    } else if (view.phase === 'challenge') {
      status.textContent = `${nameAt(view.lastPlay.playerIdx)} played ${view.lastPlay.count} card(s) claiming ${view.lastPlay.claimedRank} — call BS or let it ride!`;
    } else if (view.phase === 'game_over') {
      status.textContent = `${nameAt(view.winnerSeat)} WINS — hand emptied unchallenged!`;
    }
    root.appendChild(status);

    const seatRow = document.createElement('div');
    seatRow.style.display = 'flex';
    seatRow.style.gap = '8px';
    seatRow.style.flexWrap = 'wrap';
    if (mySeat === -1 && view.phase === 'waiting' && view.seats.length < 6) {
      const btn = document.createElement('button');
      btn.textContent = 'SIT DOWN';
      btn.addEventListener('click', () => api.sendAction({ kind: 'sit' }));
      seatRow.appendChild(btn);
    }
    if (mySeat !== -1) {
      const leaveBtn = document.createElement('button');
      leaveBtn.textContent = 'LEAVE SEAT';
      leaveBtn.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seatRow.appendChild(leaveBtn);
    }
    if (view.phase === 'waiting' && view.seats.length >= 2 && mySeat === 0) {
      const startBtn = document.createElement('button');
      startBtn.textContent = 'START GAME';
      startBtn.addEventListener('click', () => api.sendAction({ kind: 'startGame' }));
      seatRow.appendChild(startBtn);
    }
    root.appendChild(seatRow);

    const players = document.createElement('div');
    players.style.display = 'flex';
    players.style.gap = '14px';
    players.style.fontSize = '0.85em';
    view.seats.forEach((clientId, i) => {
      const tag = document.createElement('div');
      const isTurn = view.phase === 'playing' && i === view.turnIdx;
      tag.textContent = `${nicknameFor(clientId)}${clientId === api.getClientId() ? ' (you)' : ''}: ${view.handCounts[i]}${isTurn ? ' ← turn' : ''}`;
      tag.style.fontWeight = isTurn ? 'bold' : 'normal';
      players.appendChild(tag);
    });
    root.appendChild(players);

    if (view.phase !== 'waiting') {
      const pile = document.createElement('div');
      pile.textContent = `Pile: ${view.pileSize} face-down card${view.pileSize === 1 ? '' : 's'}`;
      pile.style.opacity = '0.8';
      root.appendChild(pile);
    }

    if (view.phase === 'challenge') {
      const nextIdx = (view.lastPlay.playerIdx + 1) % view.seats.length;
      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '8px';
      if (mySeat !== -1 && mySeat !== view.lastPlay.playerIdx) {
        const bsBtn = document.createElement('button');
        bsBtn.textContent = 'CALL BS!';
        bsBtn.style.color = '#ff4d4d';
        bsBtn.addEventListener('click', () => api.sendAction({ kind: 'callBS' }));
        actions.appendChild(bsBtn);
      }
      if (mySeat === nextIdx) {
        const passBtn = document.createElement('button');
        passBtn.textContent = 'LET IT RIDE';
        passBtn.addEventListener('click', () => api.sendAction({ kind: 'passChallenge' }));
        actions.appendChild(passBtn);
      }
      root.appendChild(actions);
    }

    if (view.lastChallengeResult) {
      const r = view.lastChallengeResult;
      const box = document.createElement('div');
      box.style.display = 'flex';
      box.style.flexDirection = 'column';
      box.style.alignItems = 'center';
      box.style.gap = '4px';
      box.style.fontSize = '0.85em';
      const line = document.createElement('div');
      line.textContent = r.bluffConfirmed
        ? `BUSTED! ${nameAt(r.playerIdx)} was bluffing (claimed ${r.claimedRank}) — ${nameAt(r.callerIdx)} was right and ${nameAt(r.playerIdx)} takes the pile.`
        : `${nameAt(r.playerIdx)} was telling the truth (really had ${r.claimedRank}) — ${nameAt(r.callerIdx)} takes the pile instead.`;
      box.appendChild(line);
      const revealRow = document.createElement('div');
      revealRow.style.display = 'flex';
      revealRow.style.gap = '4px';
      for (const card of r.revealedCards) revealRow.appendChild(renderCard(card, { small: true }));
      box.appendChild(revealRow);
      root.appendChild(box);
    }

    if (mySeat !== -1 && (view.phase === 'playing' || view.phase === 'challenge')) {
      const isMyTurn = view.phase === 'playing' && mySeat === view.turnIdx;
      const handLabel = document.createElement('div');
      handLabel.textContent = 'Your hand:';
      handLabel.style.fontSize = '0.8em';
      root.appendChild(handLabel);

      const hand = document.createElement('div');
      hand.style.display = 'flex';
      hand.style.gap = '4px';
      hand.style.flexWrap = 'wrap';
      hand.style.justifyContent = 'center';
      view.myHand.forEach((card, i) => {
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.flexDirection = 'column';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '2px';
        const cardEl = renderCard(card);
        const isSelected = selected.has(i);
        cardEl.style.outline = isSelected ? '3px solid #ffb000' : 'none';
        cardEl.style.cursor = isMyTurn ? 'pointer' : 'default';
        cardEl.style.transform = isSelected ? 'translateY(-6px)' : 'none';
        if (isMyTurn) {
          cardEl.addEventListener('click', () => {
            if (selected.has(i)) selected.delete(i);
            else if (selected.size < 4) selected.add(i);
            render();
          });
        }
        wrap.appendChild(cardEl);
        hand.appendChild(wrap);
      });
      root.appendChild(hand);

      if (isMyTurn) {
        const playBtn = document.createElement('button');
        playBtn.textContent = selected.size ? `PLAY ${selected.size} CARD(S) AS ${view.requiredRank}` : `SELECT CARDS TO PLAY AS ${view.requiredRank}`;
        playBtn.disabled = selected.size === 0;
        playBtn.addEventListener('click', () => {
          api.sendAction({ kind: 'play', cardIndices: [...selected] });
          selected = new Set();
        });
        root.appendChild(playBtn);
      }
    }

    if (view.phase === 'game_over') {
      const again = document.createElement('button');
      again.textContent = 'NEW GAME';
      again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
      root.appendChild(again);
    }
  }

  render();

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      render();
    },
    applyEvent(data) {
      if (data && data.kind === 'state') {
        view = data;
        selected = new Set();
        render();
      }
    },
    applyRoster(newRoster) {
      roster = newRoster;
      render();
    },
    unmount() {
      container.innerHTML = '';
    },
  };
}
