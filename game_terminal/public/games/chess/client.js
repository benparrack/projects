// Chess — click a piece, then a destination. Server validates fully (check, castling,
// en passant, promotion); illegal attempts flash a rejection. Board orientation defaults to
// each seated player's own perspective (black sees themselves on the bottom) with a manual
// FLIP BOARD override; `flipped` only ever changes what's rendered where — board coordinates
// (dataset.row/col, onSquareClick args) always stay in the server's own r/c space.

const CELL = 44;
const GLYPHS = {
  white: { king: '♔', queen: '♕', rook: '♖', bishop: '♗', knight: '♘', pawn: '♙' },
  black: { king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' },
};
// Vivid, high-contrast pair instead of the old near-white/near-black (which nearly vanished
// against the board's own dark squares) — white pieces bright mint-white, black pieces a vivid
// amber (matches the hub's --accent), both with a hard dark outline so they read clearly against
// either light or dark squares.
const GLYPH_COLORS = { white: '#f2fff2', black: '#ffb347' };
const GLYPH_OUTLINE = '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000';
const PROMOTION_CHOICES = ['queen', 'rook', 'bishop', 'knight'];
const PIECE_VALUES = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };
const TIME_CONTROLS = [
  { label: 'NO TIMER', minutes: 0 },
  { label: '5 MIN', minutes: 5 },
  { label: '10 MIN', minutes: 10 },
  { label: '15 MIN', minutes: 15 },
];

function formatClock(ms) {
  if (ms == null) return '';
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Running material-captured differential (white total captured value minus black's) after each
// move — reused for both the live differential readout and the post-game eval bar. Purely a
// material count, not a real engine evaluation (see chess fix-up notes).
function materialDiffSeries(history) {
  let white = 0;
  let black = 0;
  const series = [0];
  for (const m of history || []) {
    if (m.captured) {
      const value = PIECE_VALUES[m.captured] || 0;
      if (m.color === 'white') white += value;
      else black += value;
    }
    if (m.promotion) {
      // A promotion changes material even with no capture (pawn value 1 -> promoted piece's
      // value) — without this, a player promoting a pawn to a queen without capturing anything
      // would show no material swing at all, which is wrong.
      const gain = (PIECE_VALUES[m.promotion] || 0) - PIECE_VALUES.pawn;
      if (m.color === 'white') white += gain;
      else black += gain;
    }
    series.push(white - black);
  }
  return { white, black, diff: white - black, series };
}

export function mount(container, api) {
  let view = null;
  let roster = [];
  let selected = null;
  let flashError = false;
  let pendingPromotion = null; // { from, to }
  let manualFlip = null; // null = auto (flip for black seat), true/false = explicit user override
  let premoveSelected = null; // { r, c } — piece chosen while queueing a premove on opponent's turn
  let premove = null; // { from, to } — queued move, auto-sent the instant it becomes my turn
  let awaitingPremoveResult = false; // true right after auto-sending a premove; suppresses the
  // next moveRejected's error flash so a failed premove clears silently instead of alarming
  let showEvalBar = false; // post-game recap toggle

  const root = document.createElement('div');
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '10px';
  root.style.alignItems = 'center';
  container.appendChild(root);

  function nicknameFor(clientId) {
    if (!clientId) return null;
    if (clientId === 'BOT') return '(bot)';
    const entry = roster.find((r) => r.clientId === clientId);
    return entry ? entry.nickname : 'someone';
  }

  function mySeat() {
    const me = api.getClientId();
    if (!view) return null;
    if (view.players.white === me) return 'white';
    if (view.players.black === me) return 'black';
    return null;
  }

  function squareName(r, c) {
    return `${String.fromCharCode(97 + c)}${8 - r}`;
  }

  function moveText(m) {
    if (m.castle === 'king') return 'O-O';
    if (m.castle === 'queen') return 'O-O-O';
    const sep = m.captured ? 'x' : '→';
    let txt = `${squareName(m.from.r, m.from.c)}${sep}${squareName(m.to.r, m.to.c)}`;
    if (m.promotion) txt += `=${m.promotion[0].toUpperCase()}`;
    return txt;
  }

  function legalDestinations() {
    if (!selected || !view.legalMoves) return [];
    return view.legalMoves.filter((m) => m.from.r === selected.r && m.from.c === selected.c);
  }

  function isPromotionAttempt(from, to) {
    // Must actually be one of this pawn's legal moves, not just "any click landing on the back
    // rank while a pawn is selected" — the latter used to also fire when a player clicked one of
    // their OWN OTHER pieces sitting on the back rank (e.g. a rook) hoping to switch selection,
    // popping an unrelated promotion picker and then silently eating every further click (since
    // onSquareClick bails out early whenever pendingPromotion is set) until the easy-to-miss
    // picker was noticed and its move got rejected as illegal. Matched a real playtest report of
    // pieces randomly becoming unresponsive.
    if (!view.legalMoves) return false;
    return view.legalMoves.some(
      (m) => m.from.r === from.r && m.from.c === from.c && m.to.r === to.r && m.to.c === to.c && m.promotion
    );
  }

  function onSquareClick(r, c) {
    const seat = mySeat();
    if (!seat || view.phase !== 'playing' || pendingPromotion) return;

    if (view.turn !== seat) {
      // Not my turn yet — queue a premove instead of moving now. No legality check against the
      // (still-changing) opponent position here; the server validates for real the instant it
      // actually becomes my turn and this gets auto-sent (see maybeSubmitPremove).
      const piece = view.board[r][c];
      if (premoveSelected) {
        if (premoveSelected.r === r && premoveSelected.c === c) {
          premoveSelected = null;
        } else if (piece && piece.color === seat) {
          premoveSelected = { r, c };
        } else {
          premove = { from: premoveSelected, to: { r, c } };
          premoveSelected = null;
        }
      } else if (piece && piece.color === seat) {
        premove = null; // starting a fresh selection replaces any already-queued premove
        premoveSelected = { r, c };
      }
      render();
      return;
    }

    const piece = view.board[r][c];
    if (selected) {
      if (selected.r === r && selected.c === c) {
        selected = null;
      } else if (isPromotionAttempt(selected, { r, c })) {
        pendingPromotion = { from: selected, to: { r, c } };
        selected = null;
      } else {
        api.sendAction({ kind: 'move', from: selected, to: { r, c } });
        selected = null;
      }
      render();
    } else if (piece && piece.color === seat) {
      selected = { r, c };
      render();
    }
  }

  function maybeSubmitPremove() {
    const seat = mySeat();
    if (!premove || !seat || !view || view.phase !== 'playing' || view.turn !== seat) return;
    const { from, to } = premove;
    premove = null;
    // Basic sanity check only — is it still our own piece sitting on the square we queued from?
    // Anything beyond that (is the move itself still legal on the position as it actually
    // evolved) is left to the server; if it rejects, the moveRejected handler below drops it
    // silently rather than flashing "Illegal move" (see awaitingPremoveResult).
    const piece = view.board[from.r][from.c];
    if (!piece || piece.color !== seat) return;
    awaitingPremoveResult = true;
    api.sendAction({ kind: 'move', from, to });
  }

  function cancelPremove() {
    premove = null;
    premoveSelected = null;
    render();
  }

  function choosePromotion(type) {
    if (!pendingPromotion) return;
    api.sendAction({ kind: 'move', from: pendingPromotion.from, to: pendingPromotion.to, promotion: type });
    pendingPromotion = null;
    render();
  }

  function render() {
    root.innerHTML = '';
    if (!view) {
      root.textContent = 'Loading...';
      return;
    }
    if (view.phase !== 'playing') {
      premove = null;
      premoveSelected = null;
    }

    const status = document.createElement('div');
    if (view.phase === 'waiting') {
      status.textContent = 'Waiting for both seats to be filled.';
    } else if (view.phase === 'playing') {
      const turnName = nicknameFor(view.players[view.turn]) || view.turn;
      status.textContent = `Turn: ${view.turn.toUpperCase()} (${turnName})${view.inCheck === view.turn ? ' — CHECK' : ''}`;
    } else if (view.phase === 'game_over') {
      const reason =
        view.winReason === 'checkmate' ? 'CHECKMATE' : view.winReason === 'resignation' ? 'RESIGNATION' : view.winReason === 'timeout' ? 'TIME OUT' : 'STALEMATE';
      status.textContent = view.winner === 'draw' ? `DRAW (${reason})` : `${view.winner.toUpperCase()} WINS (${reason})`;
    }
    root.appendChild(status);

    if (view.timeControlMs && view.clocks && (view.phase === 'playing' || view.phase === 'game_over')) {
      const clockRow = document.createElement('div');
      clockRow.style.display = 'flex';
      clockRow.style.gap = '16px';
      clockRow.style.fontSize = '1.1em';
      for (const color of ['white', 'black']) {
        const c = document.createElement('div');
        c.textContent = `${color.toUpperCase()}: ${formatClock(view.clocks[color])}`;
        c.style.color = view.phase === 'playing' && view.turn === color ? '#39ff14' : '#888';
        c.style.fontWeight = view.phase === 'playing' && view.turn === color ? 'bold' : 'normal';
        clockRow.appendChild(c);
      }
      root.appendChild(clockRow);
    }

    const material = materialDiffSeries(view.moveHistory);
    if (material.diff !== 0) {
      const diffRow = document.createElement('div');
      const leader = material.diff > 0 ? 'White' : 'Black';
      diffRow.textContent = `Material: ${leader} +${Math.abs(material.diff)}`;
      diffRow.style.opacity = '0.8';
      diffRow.style.fontSize = '0.9em';
      root.appendChild(diffRow);
    }

    if (premove) {
      const pm = document.createElement('div');
      pm.textContent = `Premove queued: ${squareName(premove.from.r, premove.from.c)}→${squareName(premove.to.r, premove.to.c)} `;
      pm.style.color = '#ffb000';
      pm.style.fontSize = '0.9em';
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'CANCEL';
      cancelBtn.style.marginLeft = '6px';
      cancelBtn.addEventListener('click', cancelPremove);
      pm.appendChild(cancelBtn);
      root.appendChild(pm);
    }

    if (flashError) {
      const err = document.createElement('div');
      err.textContent = 'Illegal move';
      err.style.color = '#ff4d4d';
      root.appendChild(err);
    }

    const seatRow = document.createElement('div');
    seatRow.style.display = 'flex';
    seatRow.style.gap = '12px';
    const seat = mySeat();
    const flipped = manualFlip !== null ? manualFlip : seat === 'black';

    for (const color of ['white', 'black']) {
      const label = document.createElement('div');
      const occupant = nicknameFor(view.players[color]);
      label.textContent = `${color.toUpperCase()}: ${occupant || '(empty)'}`;
      seatRow.appendChild(label);
      if (!view.players[color]) {
        if (!seat) {
          const btn = document.createElement('button');
          btn.textContent = `PLAY ${color.toUpperCase()}`;
          btn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: color }));
          seatRow.appendChild(btn);
        }
        // Shown even when the viewer is already seated — that's the whole point of a bot seat:
        // a lone human who's already sat down can still fill the other seat without waiting.
        const botBtn = document.createElement('button');
        botBtn.textContent = 'PLAY VS BOT';
        botBtn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: color, bot: true }));
        seatRow.appendChild(botBtn);
      } else if (view.players[color] === 'BOT') {
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'REMOVE BOT';
        removeBtn.addEventListener('click', () => api.sendAction({ kind: 'removeBot', seat: color }));
        seatRow.appendChild(removeBtn);
      }
    }
    if (seat) {
      const leaveBtn = document.createElement('button');
      leaveBtn.textContent = 'LEAVE SEAT';
      leaveBtn.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seatRow.appendChild(leaveBtn);
      if (view.phase === 'playing') {
        const resignBtn = document.createElement('button');
        resignBtn.textContent = 'RESIGN';
        resignBtn.addEventListener('click', () => api.sendAction({ kind: 'resign' }));
        seatRow.appendChild(resignBtn);
      }
    }
    const flipBtn = document.createElement('button');
    flipBtn.textContent = 'FLIP BOARD';
    flipBtn.addEventListener('click', () => {
      manualFlip = !flipped;
      render();
    });
    seatRow.appendChild(flipBtn);
    root.appendChild(seatRow);

    if (view.phase === 'waiting' && seat) {
      const timeRow = document.createElement('div');
      timeRow.style.display = 'flex';
      timeRow.style.gap = '8px';
      timeRow.style.alignItems = 'center';
      const label = document.createElement('span');
      label.textContent = 'Time control:';
      label.style.fontSize = '0.85em';
      label.style.opacity = '0.8';
      timeRow.appendChild(label);
      for (const tc of TIME_CONTROLS) {
        const btn = document.createElement('button');
        btn.textContent = tc.label;
        const isActive = (tc.minutes === 0 && !view.timeControlMs) || view.timeControlMs === tc.minutes * 60000;
        if (isActive) {
          btn.style.background = '#1f8f0c';
          btn.style.color = '#000';
        }
        btn.addEventListener('click', () => api.sendAction({ kind: 'setTimeControl', minutes: tc.minutes }));
        timeRow.appendChild(btn);
      }
      root.appendChild(timeRow);
    }

    const board = document.createElement('div');
    board.style.display = 'grid';
    board.style.gridTemplateColumns = `repeat(8, ${CELL}px)`;
    board.style.gridTemplateRows = `repeat(8, ${CELL}px)`;
    board.style.border = '1px solid #1f8f0c';

    const destMoves = legalDestinations();

    for (let vr = 0; vr < 8; vr++) {
      for (let vc = 0; vc < 8; vc++) {
        // `r`/`c` stay in the server's own board coordinate space regardless of orientation;
        // only which (vr, vc) screen slot a given (r, c) square lands in changes with `flipped`.
        const r = flipped ? 7 - vr : vr;
        const c = flipped ? 7 - vc : vc;
        const cell = document.createElement('div');
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        const dark = (r + c) % 2 === 1;
        cell.style.width = `${CELL}px`;
        cell.style.height = `${CELL}px`;
        cell.style.background = dark ? '#2a2a2a' : '#0a0a0a';
        cell.style.position = 'relative';
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';
        cell.style.boxSizing = 'border-box';
        cell.style.fontSize = `${CELL - 10}px`;
        cell.style.cursor = 'pointer';
        if (selected && selected.r === r && selected.c === c) {
          cell.style.border = '2px solid #ffb000';
        } else if (premoveSelected && premoveSelected.r === r && premoveSelected.c === c) {
          cell.style.border = '2px dashed #ff4d4d';
        } else if (premove && ((premove.from.r === r && premove.from.c === c) || (premove.to.r === r && premove.to.c === c))) {
          cell.style.border = '2px dashed #ff4d4d';
        }
        cell.addEventListener('click', () => onSquareClick(r, c));
        const piece = view.board[r][c];
        if (piece) {
          const glyph = document.createElement('span');
          glyph.textContent = GLYPHS[piece.color][piece.type];
          glyph.style.color = GLYPH_COLORS[piece.color];
          glyph.style.textShadow = GLYPH_OUTLINE;
          cell.appendChild(glyph);
        }
        const destMove = destMoves.find((m) => m.to.r === r && m.to.c === c);
        if (destMove) {
          const marker = document.createElement('div');
          marker.style.position = 'absolute';
          marker.style.boxSizing = 'border-box';
          if (piece) {
            marker.style.width = `${CELL - 6}px`;
            marker.style.height = `${CELL - 6}px`;
            marker.style.border = '3px solid rgba(57,255,20,0.65)';
            marker.style.borderRadius = '50%';
          } else {
            marker.style.width = '14px';
            marker.style.height = '14px';
            marker.style.background = 'rgba(57,255,20,0.55)';
            marker.style.borderRadius = '50%';
          }
          cell.appendChild(marker);
        }
        board.appendChild(cell);
      }
    }

    // Coordinate labels (file letters a-h, rank numbers 1-8), oriented to match `flipped` the
    // same way the board squares themselves are.
    const ranksCol = document.createElement('div');
    ranksCol.style.display = 'flex';
    ranksCol.style.flexDirection = 'column';
    for (let vr = 0; vr < 8; vr++) {
      const r = flipped ? 7 - vr : vr;
      const rank = document.createElement('div');
      rank.textContent = String(8 - r);
      rank.style.width = '16px';
      rank.style.height = `${CELL}px`;
      rank.style.display = 'flex';
      rank.style.alignItems = 'center';
      rank.style.justifyContent = 'center';
      rank.style.fontSize = '12px';
      rank.style.opacity = '0.7';
      ranksCol.appendChild(rank);
    }
    const filesRow = document.createElement('div');
    filesRow.style.display = 'flex';
    filesRow.style.marginLeft = '16px';
    for (let vc = 0; vc < 8; vc++) {
      const c = flipped ? 7 - vc : vc;
      const file = document.createElement('div');
      file.textContent = String.fromCharCode(97 + c);
      file.style.width = `${CELL}px`;
      file.style.textAlign = 'center';
      file.style.fontSize = '12px';
      file.style.opacity = '0.7';
      filesRow.appendChild(file);
    }
    const boardGridRow = document.createElement('div');
    boardGridRow.style.display = 'flex';
    boardGridRow.appendChild(ranksCol);
    boardGridRow.appendChild(board);
    const boardWithLabels = document.createElement('div');
    boardWithLabels.style.display = 'flex';
    boardWithLabels.style.flexDirection = 'column';
    boardWithLabels.appendChild(boardGridRow);
    boardWithLabels.appendChild(filesRow);

    const boardRow = document.createElement('div');
    boardRow.style.display = 'flex';
    boardRow.style.gap = '12px';
    boardRow.style.alignItems = 'flex-start';
    boardRow.appendChild(boardWithLabels);

    const historyPanel = document.createElement('div');
    historyPanel.style.width = '150px';
    historyPanel.style.maxHeight = `${CELL * 8}px`;
    historyPanel.style.overflowY = 'auto';
    historyPanel.style.border = '1px solid #1f8f0c';
    historyPanel.style.padding = '6px';
    historyPanel.style.fontSize = '13px';
    historyPanel.style.color = '#39ff14';
    historyPanel.style.boxSizing = 'border-box';
    const historyTitle = document.createElement('div');
    historyTitle.textContent = 'MOVES';
    historyTitle.style.opacity = '0.7';
    historyTitle.style.marginBottom = '4px';
    historyPanel.appendChild(historyTitle);
    const history = view.moveHistory || [];
    for (let i = 0; i < history.length; i += 2) {
      const row = document.createElement('div');
      const num = i / 2 + 1;
      const whiteText = moveText(history[i]);
      const blackText = history[i + 1] ? moveText(history[i + 1]) : '';
      row.textContent = `${num}. ${whiteText}  ${blackText}`;
      historyPanel.appendChild(row);
    }
    boardRow.appendChild(historyPanel);
    root.appendChild(boardRow);
    historyPanel.scrollTop = historyPanel.scrollHeight;

    if (pendingPromotion) {
      const picker = document.createElement('div');
      picker.style.display = 'flex';
      picker.style.gap = '6px';
      const label = document.createElement('span');
      label.textContent = 'Promote to: ';
      picker.appendChild(label);
      for (const type of PROMOTION_CHOICES) {
        const btn = document.createElement('button');
        btn.textContent = type.toUpperCase();
        btn.addEventListener('click', () => choosePromotion(type));
        picker.appendChild(btn);
      }
      root.appendChild(picker);
    }

    if (view.phase === 'game_over') {
      const recap = document.createElement('div');
      recap.style.display = 'flex';
      recap.style.flexDirection = 'column';
      recap.style.alignItems = 'center';
      recap.style.gap = '6px';
      recap.style.marginTop = '4px';

      const evalToggle = document.createElement('button');
      evalToggle.textContent = showEvalBar ? 'HIDE EVAL BAR' : 'SHOW EVAL BAR';
      evalToggle.addEventListener('click', () => {
        showEvalBar = !showEvalBar;
        render();
      });
      recap.appendChild(evalToggle);

      if (showEvalBar) {
        const clamp = (v) => Math.max(-10, Math.min(10, v));
        const barWrap = document.createElement('div');
        barWrap.style.width = '260px';
        barWrap.style.height = '18px';
        barWrap.style.border = '1px solid #1f8f0c';
        barWrap.style.position = 'relative';
        barWrap.style.background = '#1a1a1a';
        const finalDiff = clamp(material.diff);
        const whitePct = 50 + finalDiff * 5; // each point of material = 5% of the bar width
        const fill = document.createElement('div');
        fill.style.position = 'absolute';
        fill.style.left = '0';
        fill.style.top = '0';
        fill.style.bottom = '0';
        fill.style.width = `${whitePct}%`;
        fill.style.background = '#f2fff2';
        barWrap.appendChild(fill);
        const blackFill = document.createElement('div');
        blackFill.style.position = 'absolute';
        blackFill.style.right = '0';
        blackFill.style.top = '0';
        blackFill.style.bottom = '0';
        blackFill.style.width = `${100 - whitePct}%`;
        blackFill.style.background = '#ffb347';
        barWrap.appendChild(blackFill);
        recap.appendChild(barWrap);

        const evalLabel = document.createElement('div');
        evalLabel.textContent =
          material.diff === 0 ? 'Material even' : `Final material: ${material.diff > 0 ? 'White' : 'Black'} +${Math.abs(material.diff)}`;
        evalLabel.style.fontSize = '0.8em';
        evalLabel.style.opacity = '0.8';
        recap.appendChild(evalLabel);

        // A simple move-by-move sparkline of the running material diff, in keeping with the
        // text-mode terminal aesthetic rather than a plotted chart.
        const spark = document.createElement('div');
        spark.style.fontSize = '0.75em';
        spark.style.opacity = '0.6';
        spark.style.maxWidth = '260px';
        spark.style.wordBreak = 'break-all';
        spark.textContent = material.series.map((v) => clamp(v)).join(' ');
        recap.appendChild(spark);
      }

      const again = document.createElement('button');
      again.textContent = 'NEW GAME';
      again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
      recap.appendChild(again);
      root.appendChild(recap);
    }
  }

  render();

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      maybeSubmitPremove();
      render();
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        view = data;
        flashError = false;
        awaitingPremoveResult = false; // the pending move (ours or otherwise) resolved, not rejected
        maybeSubmitPremove();
        render();
      } else if (data.kind === 'moveRejected') {
        if (awaitingPremoveResult) {
          awaitingPremoveResult = false;
        } else {
          flashError = true;
        }
        selected = null;
        pendingPromotion = null;
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
