// Backgammon: standard rules, casual scope. Doubling cube and gammon/backgammon scoring
// multipliers are explicitly out of scope for v1 — first to bear off all 15 checkers just wins.
//
// Point numbering: 1-24, White moves high->low (24 -> 1 -> off), Black moves low->high
// (1 -> 24 -> off). White's home is 1-6, Black's home is 19-24 (mirror-symmetric standard
// start). The bar and the off-tray are modeled as virtual points so movement math stays
// symmetric: for White the bar acts like point 25 and off is past point 0; for Black the bar
// acts like point 0 and off is past point 25. `distanceToOff(color, point)` is how many pips
// that color's checker on `point` needs to bear off — `point` for White, `25 - point` for
// Black — and drives both the exact and "no checker further back" overage bear-off rules.

function opponent(color) {
  return color === 'white' ? 'black' : 'white';
}

function rollDie() {
  return 1 + Math.floor(Math.random() * 6);
}

function createInitialPoints() {
  const points = new Array(25).fill(null);
  points[24] = { color: 'white', count: 2 };
  points[13] = { color: 'white', count: 5 };
  points[8] = { color: 'white', count: 3 };
  points[6] = { color: 'white', count: 5 };
  points[1] = { color: 'black', count: 2 };
  points[12] = { color: 'black', count: 5 };
  points[17] = { color: 'black', count: 3 };
  points[19] = { color: 'black', count: 5 };
  return points;
}

function isHomePoint(color, point) {
  return color === 'white' ? point >= 1 && point <= 6 : point >= 19 && point <= 24;
}

function distanceToOff(color, point) {
  return color === 'white' ? point : 25 - point;
}

function allCheckersHome(st, color) {
  if (st.bar[color] > 0) return false;
  for (let p = 1; p <= 24; p++) {
    if (isHomePoint(color, p)) continue;
    const pt = st.points[p];
    if (pt && pt.color === color && pt.count > 0) return false;
  }
  return true;
}

function maxOccupiedHomeDistance(st, color) {
  let max = -1;
  for (let p = 1; p <= 24; p++) {
    if (!isHomePoint(color, p)) continue;
    const pt = st.points[p];
    if (pt && pt.color === color && pt.count > 0) {
      const d = distanceToOff(color, p);
      if (d > max) max = d;
    }
  }
  return max;
}

function seatOf(st, clientId) {
  if (st.players.white === clientId) return 'white';
  if (st.players.black === clientId) return 'black';
  return null;
}

// Pure legality check for one leg (one die) — doesn't mutate. `from` is 'bar' or a point 1-24.
function computeMove(st, color, from, die) {
  const opp = opponent(color);
  const fromIsBar = from === 'bar';
  if (fromIsBar) {
    if (st.bar[color] <= 0) return { legal: false, reason: 'no_checker_there' };
  } else {
    if (st.bar[color] > 0) return { legal: false, reason: 'must_enter_from_bar' };
    const pt = st.points[from];
    if (!pt || pt.color !== color || pt.count <= 0) return { legal: false, reason: 'no_checker_there' };
  }
  const fromVal = fromIsBar ? (color === 'white' ? 25 : 0) : from;
  const toVal = color === 'white' ? fromVal - die : fromVal + die;
  const bearingOff = color === 'white' ? toVal <= 0 : toVal >= 25;

  if (bearingOff) {
    if (fromIsBar) return { legal: false, reason: 'illegal' }; // a single die (max 6) can never bar->off
    if (!allCheckersHome(st, color)) return { legal: false, reason: 'not_all_home' };
    const dist = distanceToOff(color, from);
    if (die === dist) return { legal: true, to: 'off' };
    if (die > dist && dist === maxOccupiedHomeDistance(st, color)) return { legal: true, to: 'off' };
    return { legal: false, reason: 'illegal' };
  }

  const destPt = st.points[toVal];
  if (destPt && destPt.color === opp && destPt.count >= 2) return { legal: false, reason: 'blocked' };
  const hit = !!(destPt && destPt.color === opp && destPt.count === 1);
  return { legal: true, to: toVal, hit };
}

function hasAnyLegalMove(st, color) {
  const uniqueDice = [...new Set(st.dice)];
  if (uniqueDice.length === 0) return false;
  const froms = [];
  if (st.bar[color] > 0) {
    froms.push('bar');
  } else {
    for (let p = 1; p <= 24; p++) {
      const pt = st.points[p];
      if (pt && pt.color === color && pt.count > 0) froms.push(p);
    }
  }
  for (const from of froms) {
    for (const die of uniqueDice) {
      if (computeMove(st, color, from, die).legal) return true;
    }
  }
  return false;
}

// Mutates st. Returns true if applied. Caller is responsible for re-checking whose turn it is
// after this (dice exhausted / no legal moves left -> advance turn).
function applyMove(st, color, from, die) {
  const result = computeMove(st, color, from, die);
  if (!result.legal) return false;

  if (from === 'bar') {
    st.bar[color]--;
  } else {
    st.points[from].count--;
    if (st.points[from].count === 0) st.points[from] = null;
  }

  if (result.to === 'off') {
    st.borneOff[color]++;
  } else {
    if (result.hit) {
      st.bar[opponent(color)]++;
      st.points[result.to] = { color, count: 1 };
    } else {
      const destPt = st.points[result.to];
      if (destPt && destPt.color === color) destPt.count++;
      else st.points[result.to] = { color, count: 1 };
    }
  }

  const idx = st.dice.indexOf(die);
  if (idx !== -1) st.dice.splice(idx, 1);
  st.lastMove = { color, from, to: result.to, die };

  if (st.borneOff[color] === 15) {
    st.phase = 'game_over';
    st.winner = color;
  }
  return true;
}

// If the current player has no dice left, or no legal move with what's left, the turn passes
// (any unplayable dice are simply forfeited — see FUTURE.md note on the "must use both dice if
// possible" simplification made here).
function maybeAdvanceTurn(st) {
  if (st.phase !== 'playing') return;
  if (st.dice.length === 0 || !hasAnyLegalMove(st, st.turn)) {
    st.turn = opponent(st.turn);
    st.dice = [];
  }
}

function startGame(st) {
  st.points = createInitialPoints();
  st.bar = { white: 0, black: 0 };
  st.borneOff = { white: 0, black: 0 };
  st.winner = null;
  st.lastMove = null;
  let d1, d2;
  do {
    d1 = rollDie();
    d2 = rollDie();
  } while (d1 === d2); // ties reroll — standard rule, nobody can open on a tied roll
  st.turn = d1 > d2 ? 'white' : 'black';
  st.dice = [d1, d2];
  st.lastRoll = [d1, d2];
  st.phase = 'playing';
}

function resetToWaiting(st) {
  st.phase = 'waiting';
  st.points = createInitialPoints();
  st.bar = { white: 0, black: 0 };
  st.borneOff = { white: 0, black: 0 };
  st.turn = 'white';
  st.dice = [];
  st.lastRoll = [];
  st.winner = null;
  st.lastMove = null;
}

function buildPublicState(room) {
  const st = room.state;
  return {
    phase: st.phase,
    players: st.players,
    points: st.points,
    bar: st.bar,
    borneOff: st.borneOff,
    turn: st.turn,
    dice: st.dice,
    lastRoll: st.lastRoll,
    winner: st.winner,
    lastMove: st.lastMove,
  };
}

function broadcastState(room, ctx) {
  const envelope = { v: 1, type: 'game.event', payload: { gameType: 'backgammon', data: { kind: 'state', ...buildPublicState(room) } } };
  if (ctx && typeof ctx.broadcast === 'function') ctx.broadcast(envelope);
  else for (const clientId of room.clients.keys()) room.sendTo(clientId, envelope);
}

module.exports = {
  type: 'backgammon',

  createInitialState() {
    return {
      phase: 'waiting',
      players: { white: null, black: null },
      points: createInitialPoints(),
      bar: { white: 0, black: 0 },
      borneOff: { white: 0, black: 0 },
      turn: 'white',
      dice: [],
      lastRoll: [],
      winner: null,
      lastMove: null,
    };
  },

  isRoomFull(room) {
    return !!(room.state.players.white && room.state.players.black);
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  onLeave(room, client) {
    const st = room.state;
    let changed = false;
    if (st.players.white === client.clientId) {
      st.players.white = null;
      changed = true;
    }
    if (st.players.black === client.clientId) {
      st.players.black = null;
      changed = true;
    }
    if (changed) {
      resetToWaiting(st);
      for (const clientId of room.clients.keys()) {
        room.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'backgammon', data: { kind: 'state', ...buildPublicState(room) } } });
      }
    }
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;

    function reject(reason) {
      ctx.sendTo(ctx.senderId, { v: 1, type: 'game.event', payload: { gameType: 'backgammon', data: { kind: 'moveRejected', reason } } });
    }

    if (data.kind === 'sit') {
      const seat = data.seat === 'white' || data.seat === 'black' ? data.seat : null;
      if (!seat) return;
      if (st.players[seat]) return;
      if (st.players.white === ctx.senderId || st.players.black === ctx.senderId) return;
      st.players[seat] = ctx.senderId;
      if (st.players.white && st.players.black) startGame(st);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'leaveSeat') {
      let changed = false;
      if (st.players.white === ctx.senderId) {
        st.players.white = null;
        changed = true;
      }
      if (st.players.black === ctx.senderId) {
        st.players.black = null;
        changed = true;
      }
      if (changed) {
        resetToWaiting(st);
        broadcastState(room, ctx);
      }
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'game_over') return;
      startGame(st);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'rollDice') {
      if (st.phase !== 'playing') return;
      const seatColor = seatOf(st, ctx.senderId);
      if (!seatColor || seatColor !== st.turn) return reject('not_your_turn');
      if (st.dice.length !== 0) return reject('already_rolled');
      const d1 = rollDie();
      const d2 = rollDie();
      st.dice = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
      st.lastRoll = [d1, d2];
      maybeAdvanceTurn(st); // handles the "rolled but nothing playable at all" dead-turn case
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'move') {
      if (st.phase !== 'playing') return;
      const seatColor = seatOf(st, ctx.senderId);
      if (!seatColor || seatColor !== st.turn) return reject('not_your_turn');
      if (st.dice.length === 0) return reject('must_roll_first');
      const { from, die } = data;
      if (typeof die !== 'number' || !st.dice.includes(die)) return reject('invalid_die');
      if (from !== 'bar' && !(Number.isInteger(from) && from >= 1 && from <= 24)) return reject('invalid_from');
      const ok = applyMove(st, seatColor, from, die);
      if (!ok) return reject('illegal_move');
      maybeAdvanceTurn(st);
      broadcastState(room, ctx);
      return;
    }
  },
};
