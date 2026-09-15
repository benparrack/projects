// Gartic Phone-style drawing telephone — 3-8 players. Round 0: everyone writes a secret prompt
// (their own "book"). Each following round, every book rotates one seat over and gets a new
// entry: drawings alternate with text guesses, each based only on the immediately-previous entry
// (never the original prompt) — the classic "telephone" drift. After `seats.length` rounds every
// book has cycled through every player exactly once and the whole thing is revealed to everyone.

const MIN_SEATS = 3;
const MAX_SEATS = 8;
const MAX_TEXT_LEN = 200;
const MAX_DRAWING_LEN = 60000; // data URL length cap — stays well under the WS maxPayload (64KB)

function taskTypeForRound(round) {
  if (round === 0) return 'prompt';
  return round % 2 === 1 ? 'drawing' : 'guess';
}

// Which book (0..N-1) a given seat works on at a given round — each round rotates every book one
// seat over, so a seat never revisits its own book after round 0 (see file header for the math).
function bookForSeatAtRound(seatIdx, round, n) {
  return ((seatIdx - round) % n + n) % n;
}

function buildPublicState(room, forClientId) {
  const st = room.state;
  const seatIdx = st.seats.indexOf(forClientId);
  const base = {
    phase: st.phase,
    seats: st.seats,
    currentRound: st.currentRound,
    totalRounds: st.totalRounds,
    submittedSeatIdxs: st.phase === 'playing' ? [...st.submittedThisRound] : [],
  };
  if (st.phase === 'playing' && seatIdx !== -1) {
    const n = st.seats.length;
    const myBookIndex = bookForSeatAtRound(seatIdx, st.currentRound, n);
    const taskType = taskTypeForRound(st.currentRound);
    const book = st.books[myBookIndex];
    base.myTask = {
      taskType,
      previousEntry: st.currentRound > 0 ? book[book.length - 1] : null,
      alreadySubmitted: st.submittedThisRound.has(seatIdx),
    };
  }
  if (st.phase === 'reveal') {
    base.books = st.books;
  }
  return base;
}

function broadcastState(room, ctx) {
  for (const clientId of room.clients.keys()) {
    ctx.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'garticphone', data: { kind: 'state', ...buildPublicState(room, clientId) } } });
  }
}

function startGame(st) {
  const n = st.seats.length;
  st.totalRounds = n;
  st.currentRound = 0;
  st.books = st.seats.map(() => []);
  st.submittedThisRound = new Set();
  st.phase = 'playing';
}

module.exports = {
  type: 'garticphone',

  createInitialState() {
    return { phase: 'waiting', seats: [], totalRounds: 0, currentRound: 0, books: [], submittedThisRound: new Set() };
  },

  isRoomFull(room) {
    return room.state.seats.length >= MAX_SEATS;
  },

  serializeSnapshot(room, client) {
    return buildPublicState(room, client ? client.clientId : null);
  },

  onLeave(room, client) {
    const st = room.state;
    const idx = st.seats.indexOf(client.clientId);
    if (idx === -1) return;
    st.seats.splice(idx, 1);
    st.phase = 'waiting';
    st.books = [];
    st.submittedThisRound = new Set();
    for (const clientId of room.clients.keys()) {
      room.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'garticphone', data: { kind: 'state', ...buildPublicState(room, clientId) } } });
    }
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;

    if (data.kind === 'sit') {
      if (st.phase !== 'waiting' || st.seats.length >= MAX_SEATS || st.seats.includes(ctx.senderId)) return;
      st.seats.push(ctx.senderId);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'leaveSeat') {
      const idx = st.seats.indexOf(ctx.senderId);
      if (idx === -1) return;
      st.seats.splice(idx, 1);
      st.phase = 'waiting';
      st.books = [];
      st.submittedThisRound = new Set();
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'startGame') {
      if (st.phase !== 'waiting' || st.seats.length < MIN_SEATS) return;
      startGame(st);
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'reveal') return;
      if (st.seats.length >= MIN_SEATS) startGame(st);
      else {
        st.phase = 'waiting';
        st.books = [];
      }
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'submit') {
      const seatIdx = st.seats.indexOf(ctx.senderId);
      if (seatIdx === -1 || st.phase !== 'playing' || st.submittedThisRound.has(seatIdx)) return;
      const n = st.seats.length;
      const taskType = taskTypeForRound(st.currentRound);
      const content = data.content;
      if (taskType === 'drawing') {
        if (typeof content !== 'string' || !content.startsWith('data:image/') || content.length > MAX_DRAWING_LEN) return;
      } else {
        if (typeof content !== 'string' || !content.trim() || content.length > MAX_TEXT_LEN) return;
      }
      const bookIdx = bookForSeatAtRound(seatIdx, st.currentRound, n);
      st.books[bookIdx].push({ type: taskType, authorIdx: seatIdx, content: taskType === 'drawing' ? content : content.trim() });
      st.submittedThisRound.add(seatIdx);
      if (st.submittedThisRound.size === n) {
        st.currentRound += 1;
        st.submittedThisRound = new Set();
        if (st.currentRound >= st.totalRounds) st.phase = 'reveal';
      }
      broadcastState(room, ctx);
    }
  },
};
