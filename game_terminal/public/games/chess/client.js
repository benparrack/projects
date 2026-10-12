// Chess — click a piece, then a destination. Server validates fully (check, castling,
// en passant, promotion); illegal attempts flash a rejection. Board orientation defaults to
// each seated player's own perspective (black sees themselves on the bottom) with a manual
// FLIP BOARD override; `flipped` only ever changes what's rendered where — board coordinates
// (dataset.row/col, onSquareClick args) always stay in the server's own r/c space.
import { sfx, boardSounds } from '../sfx.js';
import { preferredLevel, levelSelect } from '../botLevel.js';
import { createResults, duelResults } from '../resultsPanel.js';
import { slideFrom, captureGhost, changeTracker, LAST_MOVE_TINT, CHECK_GLOW } from '../boardFx.js';
import { buildReviewView } from './reviewView.js';
import { clampIndex } from './review.js';

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
  const moveChanged = changeTracker();
  let roster = [];
  let selected = null;
  let flashError = false;
  let pendingPromotion = null; // { from, to }
  let manualFlip = null; // null = auto (flip for black seat), true/false = explicit user override
  let premoveSelected = null; // { r, c } — piece chosen while queueing a premove on opponent's turn
  let premove = null; // { from, to } — queued move, auto-sent the instant it becomes my turn
  let awaitingPremoveResult = false; // true right after auto-sending a premove; suppresses the
  // next moveRejected's error flash so a failed premove clears silently instead of alarming
  // Post-game review (RECAP) — purely this viewer's local state; the server only supplies the
  // archived game (SAN + FENs) and streams engine analysis. null when not reviewing.
  // { gameId, idx, prevIdx, loading, moves, fens, analysis[], winner, winReason, showBest }
  let review = null;
  let resultsHiddenFor = null; // gameId whose results card was closed by opening the review
  let reviewNotice = null; // brief "review closed" note when a new game kicks the viewer out

  const root = document.createElement('div');
  const results = createResults(container);
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
    if (m.san) return m.san;
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
      } else if (piece && piece.color === seat) {
        selected = { r, c }; // clicking another of your own pieces switches the selection
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

  let clockEls = {};
  function sigWithoutClocks(v) {
    return JSON.stringify({ ...v, clocks: null });
  }
  function updateClocks() {
    for (const color of ['white', 'black']) {
      if (clockEls[color]) clockEls[color].textContent = `${color.toUpperCase()}: ${formatClock(view.clocks[color])}`;
    }
  }

  function resultText(winner, winReason) {
    const reason = { checkmate: 'checkmate', resignation: 'resignation', timeout: 'time', stalemate: 'stalemate' }[winReason] || winReason;
    if (winner === 'draw') return `Draw by ${reason}`;
    const name = view && nicknameFor(view.players[winner]);
    return `${winner === 'white' ? 'White' : 'Black'}${name ? ` (${name})` : ''} wins by ${reason}`;
  }

  function openReview() {
    if (!view || !view.review) return;
    const plies = view.review.plies;
    review = { gameId: view.review.gameId, idx: plies, prevIdx: plies, loading: true, moves: [], fens: [], analysis: [], winner: null, winReason: null, showBest: true };
    resultsHiddenFor = view.review.gameId;
    reviewNotice = null;
    api.sendAction({ kind: 'reviewRequest', gameId: view.review.gameId });
    sfx.play('click');
    render();
  }

  function closeReview(silent) {
    if (!review) return;
    review = null;
    if (!silent) api.sendAction({ kind: 'reviewClose' });
    render();
  }

  function reviewGo(target) {
    if (!review || review.loading) return;
    const plies = review.moves.length;
    const next = target === 'start' ? 0 : target === 'end' ? plies : clampIndex(review.idx + target, plies);
    if (next === review.idx) return;
    review.prevIdx = review.idx;
    review.idx = next;
    const m = next > 0 && next === review.prevIdx + 1 ? review.moves[next - 1] : null;
    sfx.play(m && m.captured ? 'capture' : 'move');
    render();
  }

  function reviewJump(i) {
    if (!review || review.loading) return;
    const next = clampIndex(i, review.moves.length);
    if (next === review.idx) return;
    review.prevIdx = review.idx;
    review.idx = next;
    sfx.play('move');
    render();
  }

  function onKey(e) {
    if (!review || review.loading) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!root.isConnected) return;
    const map = { ArrowLeft: -1, ArrowRight: 1, Home: 'start', End: 'end', ArrowUp: 'start', ArrowDown: 'end' };
    if (e.key in map) {
      e.preventDefault();
      reviewGo(map[e.key]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeReview();
    }
  }
  document.addEventListener('keydown', onKey);

  function renderReview() {
    const seat = mySeat();
    const flipped = manualFlip !== null ? manualFlip : seat === 'black';
    root.appendChild(buildReviewView({
      review,
      flipped,
      cell: Math.max(32, Math.min(CELL, Math.floor((window.innerWidth - 84) / 8))),
      glyphs: GLYPHS,
      glyphColors: GLYPH_COLORS,
      glyphOutline: GLYPH_OUTLINE,
      resultText: review.loading ? '' : resultText(review.winner, review.winReason),
      prevIdx: review.prevIdx,
      nameFor: (color) => nicknameFor(view.players[color]) || (color === 'white' ? 'White' : 'Black'),
      onNav: reviewGo,
      onJump: reviewJump,
      onExit: () => closeReview(),
      onFlip: () => { manualFlip = !flipped; render(); },
      onToggleBest: () => { review.showBest = !review.showBest; render(); },
    }));
    // A one-shot slide: re-renders for other reasons (analysis arriving) must not replay it.
    review.prevIdx = review.idx;
  }

  function render() {
    const showResults = view && view.phase === 'game_over' && !review && resultsHiddenFor !== view.gameId;
    results.update(showResults ? duelResults({
      winner: view.winner, colors: ['white', 'black'], players: view.players, me: mySeat(), nameFor: nicknameFor,
      subtitle: { checkmate: 'Checkmate', resignation: 'By resignation', timeout: 'On time', stalemate: 'Stalemate' }[view.winReason] || null, onRematch: () => api.sendAction({ kind: 'resetGame' }),
    }) : null);
    // Add a REVIEW GAME button to the results card (the shared panel only has rematch/view).
    if (showResults && view.review) {
      const btns = container.querySelector('.gt-res-btns');
      if (btns && !btns.querySelector('.chess-review-btn')) {
        const rb = document.createElement('button');
        rb.className = 'ghost chess-review-btn';
        rb.textContent = 'REVIEW GAME';
        rb.addEventListener('click', openReview);
        btns.insertBefore(rb, btns.lastChild);
      }
    }
    clockEls = {};
    root.innerHTML = '';
    if (!view) {
      root.textContent = 'Loading...';
      return;
    }
    if (review) {
      renderReview();
      return;
    }
    if (reviewNotice) {
      const note = document.createElement('div');
      note.textContent = reviewNotice;
      note.style.color = '#ffb000';
      note.style.fontSize = '0.85em';
      root.appendChild(note);
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
        c.style.color = view.phase === 'playing' && view.turn === color ? '#39ff14' : '#888';
        c.style.fontWeight = view.phase === 'playing' && view.turn === color ? 'bold' : 'normal';
        clockEls[color] = c;
        clockRow.appendChild(c);
      }
      updateClocks();
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
    seatRow.style.gap = '8px 12px';
    seatRow.style.flexWrap = 'wrap';
    seatRow.style.justifyContent = 'center';
    seatRow.style.alignItems = 'center';
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
        botBtn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: color, bot: true, level: preferredLevel() }));
        seatRow.appendChild(botBtn);
        seatRow.appendChild(levelSelect(preferredLevel()));
      } else if (view.players[color] === 'BOT') {
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'REMOVE BOT';
        removeBtn.addEventListener('click', () => api.sendAction({ kind: 'removeBot', seat: color }));
        seatRow.appendChild(levelSelect((view.botLevels || {})[color], (level) => api.sendAction({ kind: 'setBotLevel', seat: color, level })));
        seatRow.appendChild(removeBtn);
      }
    }
    if (seat) {
      const leaveBtn = document.createElement('button');
      leaveBtn.textContent = 'LEAVE SEAT';
      leaveBtn.classList.add('seat-leave'); // hidden in play-by-turns games (seats are fixed)
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

    const sq = Math.max(28, Math.min(CELL, Math.floor((window.innerWidth - 84) / 8))); // all 8 files fit a phone
    const board = document.createElement('div');
    board.style.display = 'grid';
    board.style.gridTemplateColumns = `repeat(8, ${sq}px)`;
    board.style.gridTemplateRows = `repeat(8, ${sq}px)`;
    board.style.border = '1px solid #1f8f0c';

    const destMoves = legalDestinations();
    const history = view.moveHistory || [];
    const lm = history[history.length - 1] || null;
    const animate = moveChanged(lm ? `${history.length}:${lm.from.r}${lm.from.c}${lm.to.r}${lm.to.c}` : null);
    const cellAt = {};
    const isSq = (p, r, c) => p && p.r === r && p.c === c;

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
        cell.style.width = `${sq}px`;
        cell.style.height = `${sq}px`;
        cell.style.background = dark ? '#2a2a2a' : '#0a0a0a';
        cell.style.position = 'relative';
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';
        cell.style.boxSizing = 'border-box';
        cell.style.fontSize = `${sq - 10}px`;
        cell.style.cursor = 'pointer';
        if (selected && selected.r === r && selected.c === c) {
          cell.style.border = '2px solid #ffb000';
        } else if (premoveSelected && premoveSelected.r === r && premoveSelected.c === c) {
          cell.style.border = '2px dashed #ff4d4d';
        } else if (premove && ((premove.from.r === r && premove.from.c === c) || (premove.to.r === r && premove.to.c === c))) {
          cell.style.border = '2px dashed #ff4d4d';
        }
        cell.addEventListener('click', () => onSquareClick(r, c));
        cellAt[`${r},${c}`] = cell;
        if (lm && (isSq(lm.from, r, c) || isSq(lm.to, r, c))) cell.style.boxShadow = LAST_MOVE_TINT;
        const piece = view.board[r][c];
        if (piece && piece.type === 'king' && view.inCheck === piece.color && !view.winner) {
          cell.style.backgroundImage = CHECK_GLOW;
        }
        if (piece) {
          const glyph = document.createElement('span');
          glyph.style.position = 'relative';
          glyph.textContent = GLYPHS[piece.color][piece.type];
          glyph.style.color = GLYPH_COLORS[piece.color];
          glyph.style.textShadow = GLYPH_OUTLINE;
          cell.appendChild(glyph);
          if (animate && isSq(lm.to, r, c)) {
            slideFrom(glyph, () => cellAt[`${lm.from.r},${lm.from.c}`]);
          }
        }
        const destMove = destMoves.find((m) => m.to.r === r && m.to.c === c);
        if (destMove) {
          const marker = document.createElement('div');
          marker.style.position = 'absolute';
          marker.style.boxSizing = 'border-box';
          if (piece) {
            marker.style.width = `${sq - 6}px`;
            marker.style.height = `${sq - 6}px`;
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
    if (animate) {
      if (lm.captured) {
        const capColor = lm.color === 'white' ? 'black' : 'white';
        captureGhost(cellAt[`${lm.to.r},${lm.to.c}`], GLYPHS[capColor][lm.captured], GLYPH_COLORS[capColor]);
      }
      if (lm.castle) {
        const [rf, rt] = lm.castle === 'king' ? [7, 5] : [0, 3];
        const rookGlyph = cellAt[`${lm.to.r},${rt}`] && cellAt[`${lm.to.r},${rt}`].querySelector('span');
        slideFrom(rookGlyph, cellAt[`${lm.to.r},${rf}`]);
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
      rank.style.height = `${sq}px`;
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
      file.style.width = `${sq}px`;
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
    boardRow.style.flexWrap = 'wrap'; // move history drops below the board on narrow screens
    boardRow.style.justifyContent = 'center';
    boardRow.appendChild(boardWithLabels);

    const historyPanel = document.createElement('div');
    historyPanel.style.width = '150px';
    historyPanel.style.maxHeight = `${sq * 8}px`;
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

    if (view.phase !== 'playing' && view.review) {
      const recap = document.createElement('div');
      recap.style.display = 'flex';
      recap.style.gap = '8px';
      recap.style.marginTop = '4px';
      recap.style.flexWrap = 'wrap';
      recap.style.justifyContent = 'center';
      const reviewBtn = document.createElement('button');
      reviewBtn.textContent = view.phase === 'game_over' ? '▶ REVIEW GAME' : '▶ REVIEW LAST GAME';
      reviewBtn.title = 'Step through the moves with ← → and see the engine\'s best move';
      reviewBtn.style.borderColor = '#ffb000';
      reviewBtn.style.color = '#ffb000';
      reviewBtn.addEventListener('click', openReview);
      recap.appendChild(reviewBtn);
      if (view.phase === 'game_over') {
        const again = document.createElement('button');
        again.textContent = 'NEW GAME';
        again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
        recap.appendChild(again);
      }
      root.appendChild(recap);
    }
  }

  render();

  // Re-fit the board when the width changes (phone rotation); height-only resizes are the mobile URL bar.
  let lastWidth = window.innerWidth;
  const onResize = () => { if (window.innerWidth !== lastWidth && view) { lastWidth = window.innerWidth; render(); } };
  window.addEventListener('resize', onResize);

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      maybeSubmitPremove();
      render();
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        // The server re-broadcasts once a second just to tick the clocks — patch the clock text in
        // place for those instead of rebuilding the board (a rebuild mid-click drops the click).
        if (view && clockEls.white && sigWithoutClocks(data) === sigWithoutClocks(view)) {
          view = data;
          updateClocks();
          return;
        }
        const prevView = view;
        view = data;
        // A new game started (rematch / new opponent) or the archive went away: leave review.
        if (review && (data.phase === 'playing' || !data.review || data.review.gameId !== review.gameId)) {
          review = null;
          reviewNotice = data.phase === 'playing' ? 'A new game started — review closed.' : null;
        } else if (data.phase !== 'waiting') {
          reviewNotice = null;
        }
        boardSounds(prevView, data, mySeat(), { inCheck: !!data.inCheck && !data.winner });
        flashError = false;
        awaitingPremoveResult = false; // the pending move (ours or otherwise) resolved, not rejected
        maybeSubmitPremove();
        render();
      } else if (data.kind === 'reviewData') {
        if (!review || data.gameId !== review.gameId) return;
        const plies = data.moves.length;
        Object.assign(review, {
          loading: false, moves: data.moves, fens: data.fens, winner: data.winner, winReason: data.winReason,
          analysis: Array.isArray(data.analysis) ? data.analysis.slice() : [],
        });
        review.idx = clampIndex(review.idx, plies);
        review.prevIdx = review.idx;
        render();
      } else if (data.kind === 'reviewAnalysis') {
        if (!review || data.gameId !== review.gameId || !data.entry) return;
        review.analysis[data.entry.index] = data.entry;
        render();
      } else if (data.kind === 'reviewUnavailable') {
        if (!review) return;
        review = null;
        reviewNotice = 'That game is no longer available to review.';
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
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey);
      results.destroy();
      container.innerHTML = '';
    },
  };
}
