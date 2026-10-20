// Gartic Phone-style drawing telephone — 3-8 players. Round 0: everyone writes a secret prompt
// (their own "book"). Each following round, every book moves to another seat and gets a new
// entry: drawings alternate with text guesses, each based only on the immediately-previous entry
// (never the original prompt) — the classic "telephone" drift. There are as many rounds as
// players, so every book visits every player exactly once; then the books are revealed one link
// at a time, in sync for everyone.

const MIN_SEATS = 3;
const MAX_SEATS = 8;
const MAX_TEXT_LEN = 200;
const MAX_DRAWING_LEN = 60000; // data URL length cap — stays well under the WS maxPayload (64KB)
const ROUND_SECS = [60, 90, 120];
const DEFAULT_ROUND_SECS = 90;
// Clients auto-submit whatever they have when their clock hits zero; the server waits this much
// longer before filling in anyone still missing.
const GRACE_MS = 2500;
const REVEAL_STEP_MIN_MS = 1300; // = client SUSPENSE_MS: NEXT is ignored during each link's drumroll (and double-clicks)

function taskTypeForRound(round) {
  if (round === 0) return 'prompt';
  return round % 2 === 1 ? 'drawing' : 'guess';
}

// Which book a seat works on in a round. Books move by a different random offset each round
// (playtest: "shuffle the order each round"), so you aren't always handed books by the same
// neighbour. offsets is a permutation of 0..n-1 with offsets[0] = 0 (round 0 = your own book),
// which still has every seat visit every book exactly once.
function bookForSeatAtRound(st, seatIdx, round) {
  const n = st.seats.length;
  return ((seatIdx - st.offsets[round]) % n + n) % n;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildPublicState(room, forClientId) {
  const st = room.state;
  const seatIdx = st.seats.indexOf(forClientId);
  const base = {
    phase: st.phase,
    seats: st.seats,
    currentRound: st.currentRound,
    totalRounds: st.totalRounds,
    roundSecs: st.roundSecs,
    roundEndsAt: st.phase === 'playing' ? st.roundEndsAt : null,
    serverNow: Date.now(),
    submittedSeatIdxs: st.phase === 'playing' ? [...st.submittedThisRound] : [],
  };
  if (st.phase === 'playing' && seatIdx !== -1) {
    const book = st.books[bookForSeatAtRound(st, seatIdx, st.currentRound)];
    base.myTask = {
      taskType: taskTypeForRound(st.currentRound),
      previousEntry: st.currentRound > 0 ? book[book.length - 1] : null,
      alreadySubmitted: st.submittedThisRound.has(seatIdx),
    };
  }
  // Only the book being revealed, up to the current link (not every drawing on every click).
  if (st.phase === 'reveal') {
    base.reveal = {
      bookIdx: st.revealBook,
      step: st.revealStep,
      entries: st.books[st.revealBook].slice(0, st.revealStep + 1),
      done: st.revealBook === st.books.length - 1 && st.revealStep === st.books[st.revealBook].length - 1,
    };
  }
  return base;
}

function broadcastState(room) {
  for (const clientId of room.clients.keys()) {
    room.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'garticphone', data: { kind: 'state', ...buildPublicState(room, clientId) } } });
  }
}

function startRound(room) {
  const st = room.state;
  clearTimeout(st._timer);
  st.submittedThisRound = new Set();
  st.roundEndsAt = Date.now() + st.roundSecs * 1000;
  const round = st.currentRound;
  st._timer = setTimeout(() => {
    if (st.phase !== 'playing' || st.currentRound !== round) return;
    // Out of time: anyone who sent nothing gets an empty entry so the chain carries on.
    st.seats.forEach((_, i) => { if (!st.submittedThisRound.has(i)) addEntry(st, i, null); });
    advance(room);
  }, st.roundSecs * 1000 + GRACE_MS);
}

function addEntry(st, seatIdx, content) {
  st.books[bookForSeatAtRound(st, seatIdx, st.currentRound)].push({ type: taskTypeForRound(st.currentRound), authorIdx: seatIdx, content });
  st.submittedThisRound.add(seatIdx);
}

function advance(room) {
  const st = room.state;
  st.currentRound += 1;
  if (st.currentRound >= st.totalRounds) {
    clearTimeout(st._timer);
    st.phase = 'reveal';
    st.revealBook = 0;
    st.revealStep = 0;
    st.revealAt = Date.now();
  } else {
    startRound(room);
  }
  broadcastState(room);
}

function startGame(room) {
  const st = room.state;
  shuffle(st.seats);
  const n = st.seats.length;
  st.totalRounds = n;
  st.currentRound = 0;
  st.offsets = [0, ...shuffle([...Array(n).keys()].slice(1))];
  st.books = st.seats.map(() => []);
  st.phase = 'playing';
  startRound(room);
}

function toWaiting(st) {
  clearTimeout(st._timer);
  st.phase = 'waiting';
  st.books = [];
  st.submittedThisRound = new Set();
}

module.exports = {
  type: 'garticphone',
  _test: { bookForSeatAtRound, ROUND_SECS },
  // Cooperative telephone game: nobody wins or scores, so there is no result to report.
  stats: { none: true },

  createInitialState() {
    return { phase: 'waiting', seats: [], totalRounds: 0, currentRound: 0, books: [], offsets: [], roundSecs: DEFAULT_ROUND_SECS, submittedThisRound: new Set() };
  },

  isRoomFull(room) {
    return room.state.seats.length >= MAX_SEATS;
  },

  serializeSnapshot(room, client) {
    return buildPublicState(room, client ? client.clientId : null);
  },

  onJoin(room, client) {
    const st = room.state;
    if (st.phase === 'waiting' && st.seats.length < MAX_SEATS && !st.seats.includes(client.clientId)) {
      st.seats.push(client.clientId);
    }
    for (const clientId of room.clients.keys()) {
      if (clientId === client.clientId) continue;
      room.sendTo(clientId, { v: 1, type: 'game.event', payload: { gameType: 'garticphone', data: { kind: 'state', ...buildPublicState(room, clientId) } } });
    }
  },

  onLeave(room, client) {
    const st = room.state;
    const idx = st.seats.indexOf(client.clientId);
    if (idx === -1) return;
    st.seats.splice(idx, 1);
    toWaiting(st);
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
      broadcastState(room);
      return;
    }

    if (data.kind === 'leaveSeat') {
      const idx = st.seats.indexOf(ctx.senderId);
      if (idx === -1) return;
      st.seats.splice(idx, 1);
      toWaiting(st);
      broadcastState(room);
      return;
    }

    if (data.kind === 'setRoundSecs') {
      if (st.phase === 'playing' || !st.seats.includes(ctx.senderId) || !ROUND_SECS.includes(data.secs)) return;
      st.roundSecs = data.secs;
      broadcastState(room);
      return;
    }

    if (data.kind === 'startGame') {
      if (st.phase !== 'waiting' || st.seats.length < MIN_SEATS) return;
      startGame(room);
      broadcastState(room);
      return;
    }

    if (data.kind === 'resetGame') {
      if (st.phase !== 'reveal') return;
      if (st.seats.length >= MIN_SEATS) startGame(room);
      else toWaiting(st);
      broadcastState(room);
      return;
    }

    if (data.kind === 'revealNext') {
      if (st.phase !== 'reveal' || !st.seats.includes(ctx.senderId)) return;
      if (Date.now() - st.revealAt < REVEAL_STEP_MIN_MS) return;
      if (st.revealStep < st.books[st.revealBook].length - 1) st.revealStep += 1;
      else if (st.revealBook < st.books.length - 1) { st.revealBook += 1; st.revealStep = 0; }
      else return;
      st.revealAt = Date.now();
      broadcastState(room);
      return;
    }

    if (data.kind === 'submit') {
      const seatIdx = st.seats.indexOf(ctx.senderId);
      if (seatIdx === -1 || st.phase !== 'playing' || st.submittedThisRound.has(seatIdx)) return;
      const taskType = taskTypeForRound(st.currentRound);
      const content = data.content;
      if (taskType === 'drawing') {
        if (typeof content !== 'string' || !content.startsWith('data:image/') || content.length > MAX_DRAWING_LEN) return;
      } else {
        if (typeof content !== 'string' || !content.trim() || content.length > MAX_TEXT_LEN) return;
      }
      addEntry(st, seatIdx, taskType === 'drawing' ? content : content.trim());
      if (st.submittedThisRound.size === st.seats.length) advance(room);
      else broadcastState(room);
    }
  },
};
