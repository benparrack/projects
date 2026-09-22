// Backgammon — click a remaining die to arm it (auto-armed when only one distinct value is
// left), then click a source point (or the bar pile) to play that die from there. The server is
// the sole legality authority (no client-side legal-move mirror here, unlike checkers/connect4 —
// backgammon's bear-off/blocking rules are involved enough that duplicating them client-side
// risked drifting out of sync); an illegal attempt gets a rejection flash instead of a preview.
//
// Visual note: points render as real triangles (CSS clip-path) alternating between two dark
// green-black tones so the board reads as an actual backgammon board rather than a plain grid.
// Checkers get a radial-gradient + shadow for depth. This is a full-DOM-rebuild-per-render
// component (render() clears and rebuilds `root` every call, same as this hub's other games) —
// true node-reuse animation isn't attempted, but every checker/point plays a short CSS
// pop-in/glow transition on (re)creation so state changes read as smoother than a hard cut.

const POINT_W = 48;
const POINT_H = 160;
const DISC = 30;
const BAR_W = 44;

const ACCENT = '#39ff14';
const ACCENT_DIM = '#1f8f0c';
const AMBER = '#ffb000';

// Layout: top row left->right is 13..18 | (bar) | 19..24 (Black's home on the right);
// bottom row left->right is 12..7 | (bar) | 6..1 (White's home on the right).
const TOP_LEFT = [13, 14, 15, 16, 17, 18];
const TOP_RIGHT = [19, 20, 21, 22, 23, 24];
const BOTTOM_LEFT = [12, 11, 10, 9, 8, 7];
const BOTTOM_RIGHT = [6, 5, 4, 3, 2, 1];

// Fires a short pop-in transition on an element that was just created/re-created — since this
// component rebuilds its whole subtree every render(), this is what stands in for "smooth" state
// changes without a full incremental-diff rewrite.
function popIn(el, delayMs = 0) {
  el.style.transform = 'scale(0.3)';
  el.style.opacity = '0';
  el.style.transition = 'transform 0.22s cubic-bezier(0.34,1.56,0.64,1), opacity 0.18s ease';
  requestAnimationFrame(() => {
    setTimeout(() => {
      el.style.transform = 'scale(1)';
      el.style.opacity = '1';
    }, delayMs);
  });
}

export function mount(container, api) {
  let view = null;
  let roster = [];
  let armedDie = null;
  let flashError = null;

  const root = document.createElement('div');
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '12px';
  root.style.alignItems = 'center';
  root.style.fontFamily = 'inherit';
  root.style.color = '#e8f5e9';
  container.appendChild(root);

  function nicknameFor(clientId) {
    if (!clientId) return null;
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

  function remainingDice() {
    return view ? view.dice : [];
  }

  function uniqueRemainingDice() {
    return [...new Set(remainingDice())];
  }

  function effectiveArmedDie() {
    const uniq = uniqueRemainingDice();
    if (uniq.length === 1) return uniq[0]; // only one distinct value left — no need to click it
    return armedDie;
  }

  function playFrom(from) {
    const seat = mySeat();
    if (!seat || view.phase !== 'playing' || view.turn !== seat) return;
    const die = effectiveArmedDie();
    if (die == null) return;
    api.sendAction({ kind: 'move', from, die });
    armedDie = null;
  }

  function discEl(color, i) {
    const d = document.createElement('div');
    d.style.width = `${DISC}px`;
    d.style.height = `${DISC}px`;
    d.style.borderRadius = '50%';
    d.style.boxSizing = 'border-box';
    d.style.flexShrink = '0';
    d.style.boxShadow = '0 2px 4px rgba(0,0,0,0.6), inset 0 1px 2px rgba(255,255,255,0.15)';
    if (color === 'black') {
      d.style.background = 'radial-gradient(circle at 34% 30%, #5a5a5a, #232323 55%, #050505 100%)';
      d.style.border = '1px solid #6a6a6a';
    } else {
      d.style.background = 'radial-gradient(circle at 34% 30%, #ffffff, #d6d6d6 55%, #9c9c9c 100%)';
      d.style.border = '1px solid #cfcfcf';
    }
    popIn(d, i * 25);
    return d;
  }

  // Decorative triangle behind the point's content — a separate absolutely-positioned layer
  // rather than clipping the content container itself, so checker discs stacked near the wide
  // edge are never visually clipped by the triangle's narrowing shape.
  function triangleBg(pointNum, faceUp) {
    const tri = document.createElement('div');
    tri.style.position = 'absolute';
    tri.style.inset = '0';
    tri.style.zIndex = '0';
    const alt = pointNum % 2 === 0;
    tri.style.background = alt ? '#16281a' : '#0e0e0e';
    tri.style.clipPath = faceUp
      ? 'polygon(50% 100%, 4% 0%, 96% 0%)' // apex at bottom (points down toward the bar)
      : 'polygon(50% 0%, 4% 100%, 96% 100%)'; // apex at top
    return tri;
  }

  function renderPoint(pointNum, faceUp) {
    const cell = document.createElement('div');
    cell.dataset.point = String(pointNum);
    cell.style.width = `${POINT_W}px`;
    cell.style.height = `${POINT_H}px`;
    cell.style.position = 'relative';
    cell.style.boxSizing = 'border-box';
    cell.style.transition = 'box-shadow 0.2s ease';

    cell.appendChild(triangleBg(pointNum, faceUp));

    const content = document.createElement('div');
    content.style.position = 'relative';
    content.style.zIndex = '1';
    content.style.display = 'flex';
    content.style.flexDirection = faceUp ? 'column' : 'column-reverse';
    content.style.alignItems = 'center';
    content.style.gap = '2px';
    content.style.padding = '6px 2px';
    content.style.height = '100%';
    content.style.boxSizing = 'border-box';

    const pt = view.points[pointNum];
    const seat = mySeat();
    const isMine = seat && pt && pt.color === seat && view.phase === 'playing' && view.turn === seat;
    if (isMine) {
      cell.style.cursor = 'pointer';
      cell.style.boxShadow = `0 0 0 2px ${ACCENT}, 0 0 10px 1px rgba(57,255,20,0.55)`;
      cell.addEventListener('click', () => playFrom(pointNum));
      cell.addEventListener('mouseenter', () => {
        cell.style.boxShadow = `0 0 0 2px ${ACCENT}, 0 0 16px 4px rgba(57,255,20,0.8)`;
      });
      cell.addEventListener('mouseleave', () => {
        cell.style.boxShadow = `0 0 0 2px ${ACCENT}, 0 0 10px 1px rgba(57,255,20,0.55)`;
      });
    }

    const label = document.createElement('div');
    label.textContent = String(pointNum);
    label.style.fontSize = '9px';
    label.style.opacity = '0.55';
    label.style.position = 'absolute';
    label.style[faceUp ? 'top' : 'bottom'] = '2px';
    label.style.left = '3px';
    content.appendChild(label);

    if (pt && pt.count > 0) {
      const shown = Math.min(pt.count, 5);
      for (let i = 0; i < shown; i++) content.appendChild(discEl(pt.color, i));
      if (pt.count > 5) {
        const more = document.createElement('div');
        more.textContent = `+${pt.count - 5}`;
        more.style.fontSize = '12px';
        more.style.fontWeight = 'bold';
        more.style.color = AMBER;
        content.appendChild(more);
      }
    }
    cell.appendChild(content);
    return cell;
  }

  function renderBarPile(color) {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '4px';
    wrap.style.width = `${BAR_W}px`;
    wrap.style.transition = 'box-shadow 0.2s ease';
    wrap.style.borderRadius = '6px';
    wrap.style.padding = '4px 0';
    const count = view.bar[color];
    const label = document.createElement('div');
    label.textContent = `BAR (${count})`;
    label.style.fontSize = '10px';
    label.style.opacity = '0.75';
    wrap.appendChild(label);
    if (count > 0) {
      const seat = mySeat();
      const clickable = seat === color && view.phase === 'playing' && view.turn === seat;
      if (clickable) {
        wrap.style.cursor = 'pointer';
        wrap.style.boxShadow = `0 0 0 2px ${ACCENT}, 0 0 10px 1px rgba(57,255,20,0.55)`;
        wrap.addEventListener('click', () => playFrom('bar'));
      }
      wrap.appendChild(discEl(color, 0));
    }
    return wrap;
  }

  function statusColor() {
    if (!view) return '#888';
    if (view.phase === 'playing') return view.turn === 'white' ? '#f2f2f2' : AMBER;
    if (view.phase === 'game_over') return ACCENT;
    return '#9ecfa3';
  }

  function render() {
    root.innerHTML = '';
    if (!view) {
      root.textContent = 'Loading...';
      return;
    }

    const seat = mySeat();

    const panel = document.createElement('div');
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.alignItems = 'center';
    panel.style.gap = '8px';
    panel.style.padding = '10px 18px';
    panel.style.border = `1px solid ${ACCENT_DIM}`;
    panel.style.borderRadius = '8px';
    panel.style.background = 'linear-gradient(180deg, #0c140c, #070a07)';
    panel.style.minWidth = '320px';

    const status = document.createElement('div');
    status.style.fontSize = '17px';
    status.style.fontWeight = 'bold';
    status.style.letterSpacing = '0.03em';
    status.style.color = statusColor();
    status.style.textShadow = view && view.phase === 'playing' ? `0 0 8px ${statusColor()}66` : 'none';
    status.style.transition = 'color 0.2s ease';
    if (view.phase === 'waiting') {
      status.textContent = 'WAITING FOR BOTH SEATS';
    } else if (view.phase === 'playing') {
      const turnName = nicknameFor(view.players[view.turn]) || view.turn;
      status.textContent = `${view.turn.toUpperCase()} TO MOVE — ${turnName}${seat === view.turn ? ' (YOU)' : ''}`;
    } else if (view.phase === 'game_over') {
      status.textContent = `${view.winner.toUpperCase()} WINS!`;
    }
    panel.appendChild(status);

    if (flashError) {
      const err = document.createElement('div');
      err.textContent = `Illegal move${flashError !== true ? ` (${flashError})` : ''}`;
      err.style.color = '#ff5c5c';
      err.style.fontSize = '12px';
      panel.appendChild(err);
    }

    const seatRow = document.createElement('div');
    seatRow.style.display = 'flex';
    seatRow.style.gap = '18px';
    seatRow.style.alignItems = 'center';
    for (const color of ['white', 'black']) {
      const box = document.createElement('div');
      box.style.display = 'flex';
      box.style.alignItems = 'center';
      box.style.gap = '6px';
      box.style.fontSize = '13px';

      const dot = document.createElement('div');
      dot.style.width = '10px';
      dot.style.height = '10px';
      dot.style.borderRadius = '50%';
      dot.style.background = color === 'white'
        ? 'radial-gradient(circle at 34% 30%, #fff, #b8b8b8)'
        : 'radial-gradient(circle at 34% 30%, #5a5a5a, #050505)';
      dot.style.border = '1px solid #888';
      dot.style.boxShadow = view.phase === 'playing' && view.turn === color ? `0 0 8px 2px ${statusColor()}` : 'none';
      box.appendChild(dot);

      const occupant = nicknameFor(view.players[color]);
      const label = document.createElement('span');
      label.textContent = `${color.toUpperCase()}: ${occupant || '(empty)'}`;
      label.style.opacity = occupant ? '1' : '0.5';
      box.appendChild(label);

      if (!view.players[color] && !seat) {
        const btn = document.createElement('button');
        btn.textContent = `PLAY ${color.toUpperCase()}`;
        btn.style.marginLeft = '4px';
        btn.addEventListener('click', () => api.sendAction({ kind: 'sit', seat: color }));
        box.appendChild(btn);
      }
      seatRow.appendChild(box);
    }
    if (seat) {
      const leaveBtn = document.createElement('button');
      leaveBtn.textContent = 'LEAVE SEAT';
      leaveBtn.style.marginLeft = '8px';
      leaveBtn.addEventListener('click', () => api.sendAction({ kind: 'leaveSeat' }));
      seatRow.appendChild(leaveBtn);
    }
    panel.appendChild(seatRow);

    if (view.phase === 'playing') {
      const diceRow = document.createElement('div');
      diceRow.style.display = 'flex';
      diceRow.style.gap = '8px';
      diceRow.style.alignItems = 'center';
      diceRow.style.minHeight = '40px';

      if (view.lastRoll.length) {
        const rollLabel = document.createElement('div');
        rollLabel.style.fontSize = '11px';
        rollLabel.style.opacity = '0.7';
        rollLabel.textContent = `rolled ${view.lastRoll.join('-')}`;
        rollLabel.style.marginRight = '4px';
        diceRow.appendChild(rollLabel);
      }

      if (view.dice.length === 0 && seat === view.turn) {
        const rollBtn = document.createElement('button');
        rollBtn.textContent = '⚅ ROLL DICE';
        rollBtn.style.fontSize = '14px';
        rollBtn.style.padding = '6px 14px';
        rollBtn.addEventListener('click', () => api.sendAction({ kind: 'rollDice' }));
        diceRow.appendChild(rollBtn);
      } else {
        const uniq = uniqueRemainingDice();
        view.dice.forEach((d, i) => {
          const pill = document.createElement('button');
          pill.textContent = String(d);
          pill.disabled = seat !== view.turn;
          const isArmed = uniq.length === 1 || armedDie === d;
          pill.style.width = '34px';
          pill.style.height = '34px';
          pill.style.fontSize = '16px';
          pill.style.fontWeight = 'bold';
          pill.style.borderRadius = '6px';
          pill.style.transition = 'background 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease';
          pill.style.opacity = pill.disabled ? '0.45' : '1';
          if (isArmed) {
            pill.style.background = AMBER;
            pill.style.color = '#000';
            pill.style.boxShadow = `0 0 10px 2px ${AMBER}aa`;
            pill.style.transform = 'scale(1.08)';
          }
          pill.addEventListener('click', () => {
            if (uniq.length > 1) {
              armedDie = armedDie === d ? null : d;
              render();
            }
          });
          popIn(pill, i * 40);
          diceRow.appendChild(pill);
        });
      }
      panel.appendChild(diceRow);
    }

    const offRow = document.createElement('div');
    offRow.style.display = 'flex';
    offRow.style.gap = '20px';
    offRow.style.fontSize = '12px';
    offRow.style.opacity = '0.85';
    const whiteOff = document.createElement('div');
    whiteOff.textContent = `WHITE borne off: ${view.borneOff.white}/15`;
    const blackOff = document.createElement('div');
    blackOff.textContent = `BLACK borne off: ${view.borneOff.black}/15`;
    offRow.appendChild(whiteOff);
    offRow.appendChild(blackOff);
    panel.appendChild(offRow);

    if (view.phase === 'game_over') {
      const again = document.createElement('button');
      again.textContent = 'NEW GAME';
      again.style.marginTop = '4px';
      again.addEventListener('click', () => api.sendAction({ kind: 'resetGame' }));
      panel.appendChild(again);
    }

    root.appendChild(panel);

    const board = document.createElement('div');
    board.style.display = 'flex';
    board.style.flexDirection = 'column';
    board.style.border = `3px solid ${ACCENT_DIM}`;
    board.style.borderRadius = '4px';
    board.style.background = '#050505';
    board.style.boxShadow = `0 0 24px rgba(31,143,12,0.25), inset 0 0 40px rgba(0,0,0,0.6)`;
    board.style.padding = '6px';

    function makeRow(leftPoints, rightPoints, faceUp) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      for (const p of leftPoints) row.appendChild(renderPoint(p, faceUp));
      const barCol = document.createElement('div');
      barCol.style.display = 'flex';
      barCol.style.alignItems = 'center';
      barCol.style.justifyContent = 'center';
      barCol.style.width = `${BAR_W}px`;
      barCol.style.background = '#0a0a0a';
      barCol.style.boxShadow = 'inset 0 0 8px rgba(0,0,0,0.8)';
      barCol.style.borderLeft = `1px solid ${ACCENT_DIM}`;
      barCol.style.borderRight = `1px solid ${ACCENT_DIM}`;
      if (faceUp) barCol.appendChild(renderBarPile('black'));
      else barCol.appendChild(renderBarPile('white'));
      row.appendChild(barCol);
      for (const p of rightPoints) row.appendChild(renderPoint(p, faceUp));
      return row;
    }

    board.appendChild(makeRow(TOP_LEFT, TOP_RIGHT, true));
    const mid = document.createElement('div');
    mid.style.height = '14px';
    mid.style.background = '#030303';
    board.appendChild(mid);
    board.appendChild(makeRow(BOTTOM_LEFT, BOTTOM_RIGHT, false));
    root.appendChild(board);
  }

  render();

  return {
    applySnapshot(snapshot) {
      view = snapshot;
      render();
    },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        view = data;
        flashError = null;
        armedDie = null;
        render();
      } else if (data.kind === 'moveRejected') {
        flashError = data.reason || true;
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
