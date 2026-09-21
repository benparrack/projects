// Pictionary — one player (the drawer, rotating each round) draws on a shared canvas while
// everyone else races to guess the secret word in a chat log. Combines drawing.js's canvas
// broadcast (segment/clear events, replayed identically by every client) with hangman.js's
// per-recipient hidden-state pattern (only the drawer's view carries the actual word).

const WORDS = [
  'dog', 'cat', 'house', 'tree', 'car', 'sun', 'moon', 'star', 'fish', 'bird',
  'apple', 'banana', 'pizza', 'guitar', 'robot', 'rainbow', 'umbrella', 'mountain', 'river', 'boat',
  'airplane', 'bicycle', 'clock', 'chair', 'table', 'book', 'phone', 'camera', 'rocket', 'castle',
  'dragon', 'snowman', 'balloon', 'butterfly', 'elephant', 'spider', 'ghost', 'pirate', 'wizard', 'volcano',
];

const ROUND_MS = 80000; // time to draw + guess, once a word is chosen
const CHOOSE_MS = 15000; // time the drawer gets to pick a word before one is auto-picked
const ROUND_OVER_PAUSE_MS = 6000; // reveal/scoreboard pause before the next round auto-starts
const MAX_HISTORY = 3000;
const TRIM_TO = 2400;
const MAX_GUESS_LOG = 40;
const MAX_GUESS_LEN = 60;

const FIRST_GUESS_POINTS = 3;
const LATER_GUESS_POINTS = 1;
const DRAWER_BONUS_POINTS = 2; // awarded once per round, the first time anyone guesses correctly

function normalize(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function pickRandomWords(n) {
  const pool = WORDS.slice();
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function buildView(room, forClientId) {
  const st = room.state;
  const isDrawer = forClientId != null && forClientId === st.drawerClientId;
  return {
    phase: st.phase,
    playerCount: room.clients.size,
    drawerClientId: st.drawerClientId,
    isDrawer,
    wordOptions: isDrawer && st.phase === 'choosing_word' ? st.wordOptions : null,
    // The word itself is only ever exposed to the drawer while play is live; everyone sees it
    // once the round ends (win, all-guessed, or timeout — doesn't matter which).
    word: st.phase === 'round_over' ? st.lastRoundWord : (isDrawer ? st.word : null),
    history: st.history,
    scores: { ...st.scores },
    correctGuessers: st.correctGuessers.slice(),
    guessLog: st.guessLog.slice(-MAX_GUESS_LOG),
    roundEndsAt: st.roundEndsAt,
  };
}

function broadcastState(room) {
  for (const clientId of room.clients.keys()) {
    room.sendTo(clientId, {
      v: 1,
      type: 'game.event',
      payload: { gameType: 'pictionary', data: { kind: 'state', view: buildView(room, clientId) } },
    });
  }
}

function clearTimers(st) {
  if (st._chooseTimer) {
    clearTimeout(st._chooseTimer);
    st._chooseTimer = null;
  }
  if (st._roundTimer) {
    clearTimeout(st._roundTimer);
    st._roundTimer = null;
  }
  if (st._nextRoundTimer) {
    clearTimeout(st._nextRoundTimer);
    st._nextRoundTimer = null;
  }
}

function goToLobby(room) {
  const st = room.state;
  clearTimers(st);
  st.phase = 'lobby';
  st.drawerClientId = null;
  st.word = null;
  st.wordOptions = [];
  st.history = [];
  st.correctGuessers = [];
  st.guessLog = [];
  st.lastRoundWord = null;
  st.roundEndsAt = null;
  broadcastState(room);
}

// Rotates the drawer to the next connected player after the current one (or the first connected
// player if there was no previous drawer), prunes anyone who's left from playerOrder, and enters
// the 'choosing_word' phase. If fewer than 2 players are left connected, falls back to the lobby
// instead — a round with no possible guesser has nothing to do.
function startNewRound(room) {
  const st = room.state;
  clearTimers(st);
  st.playerOrder = st.playerOrder.filter((id) => room.clients.has(id));
  if (st.playerOrder.length < 2) {
    goToLobby(room);
    return;
  }
  const idx = st.drawerClientId ? st.playerOrder.indexOf(st.drawerClientId) : -1;
  st.drawerClientId = st.playerOrder[(idx + 1) % st.playerOrder.length];
  st.wordOptions = pickRandomWords(3);
  st.word = null;
  st.history = [];
  st.correctGuessers = [];
  st.guessLog = [];
  st.lastRoundWord = null;
  st.roundEndsAt = null;
  st.phase = 'choosing_word';
  st._chooseTimer = setTimeout(() => {
    st._chooseTimer = null;
    if (st.phase === 'choosing_word') beginDrawingPhase(room, st.wordOptions[0]);
  }, CHOOSE_MS);
  broadcastState(room);
}

function beginDrawingPhase(room, word) {
  const st = room.state;
  clearTimers(st);
  st.word = word;
  st.wordOptions = [];
  st.history = [];
  st.correctGuessers = [];
  st.guessLog = [];
  st.phase = 'drawing';
  st.roundEndsAt = Date.now() + ROUND_MS;
  st._roundTimer = setTimeout(() => {
    st._roundTimer = null;
    if (st.phase === 'drawing') endRound(room, 'timeout');
  }, ROUND_MS);
  broadcastState(room);
}

function endRound(room, reason) {
  const st = room.state;
  clearTimers(st);
  st.phase = 'round_over';
  st.lastRoundWord = st.word;
  st.roundEndsAt = null;
  broadcastState(room);
  st._nextRoundTimer = setTimeout(() => {
    st._nextRoundTimer = null;
    if (room.clients.size < 2) {
      goToLobby(room);
    } else {
      startNewRound(room);
    }
  }, ROUND_OVER_PAUSE_MS);
}

module.exports = {
  type: 'pictionary',

  createInitialState() {
    return {
      phase: 'lobby',
      playerOrder: [],
      drawerClientId: null,
      word: null,
      wordOptions: [],
      history: [],
      scores: {},
      correctGuessers: [],
      guessLog: [],
      lastRoundWord: null,
      roundEndsAt: null,
      _chooseTimer: null,
      _roundTimer: null,
      _nextRoundTimer: null,
    };
  },

  serializeSnapshot(room, client) {
    return buildView(room, client ? client.clientId : null);
  },

  onJoin(room, client) {
    const st = room.state;
    if (!st.playerOrder.includes(client.clientId)) st.playerOrder.push(client.clientId);
    if (st.phase === 'lobby' && !st.drawerClientId && room.clients.size >= 2) {
      startNewRound(room);
    } else {
      broadcastState(room);
    }
  },

  onLeave(room, client) {
    const st = room.state;
    const idx = st.playerOrder.indexOf(client.clientId);
    if (idx !== -1) st.playerOrder.splice(idx, 1);

    if (st.drawerClientId === client.clientId) {
      // The drawer left mid-round — nobody can finish this round, so skip straight to picking a
      // new drawer (or the lobby, if that drops us below 2 players) rather than limping along
      // with an un-drawable round.
      if (st.playerOrder.length < 2) {
        goToLobby(room);
      } else {
        clearTimers(st);
        st.drawerClientId = null; // so startNewRound's rotation just picks playerOrder[0]
        startNewRound(room);
      }
      return;
    }

    if (room.clients.size < 2 && st.phase !== 'lobby') {
      goToLobby(room);
      return;
    }

    broadcastState(room);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;

    if (data.kind === 'chooseWord') {
      if (st.phase !== 'choosing_word') return;
      if (ctx.senderId !== st.drawerClientId) return;
      const word = typeof data.word === 'string' ? data.word : '';
      if (!st.wordOptions.includes(word)) {
        ctx.sendTo(ctx.senderId, {
          v: 1,
          type: 'game.event',
          payload: { gameType: 'pictionary', data: { kind: 'actionRejected', reason: 'invalid_word_choice' } },
        });
        return;
      }
      beginDrawingPhase(room, word);
      return;
    }

    if (data.kind === 'segment') {
      if (st.phase !== 'drawing') return;
      if (ctx.senderId !== st.drawerClientId) return;
      const seg = data.segment;
      if (!seg || [seg.x0, seg.y0, seg.x1, seg.y1].some((n) => typeof n !== 'number')) return;
      const record = {
        strokeId: String(seg.strokeId || ''),
        clientId: ctx.senderId,
        x0: seg.x0,
        y0: seg.y0,
        x1: seg.x1,
        y1: seg.y1,
        color: typeof seg.color === 'string' ? seg.color.slice(0, 20) : '#39ff14',
        size: typeof seg.size === 'number' ? Math.min(Math.max(seg.size, 1), 50) : 3,
      };
      st.history.push(record);
      if (st.history.length > MAX_HISTORY) st.history = st.history.slice(-TRIM_TO);
      ctx.broadcast({ v: 1, type: 'game.event', payload: { gameType: 'pictionary', data: { kind: 'segment', segment: record } } }, ctx.senderId);
      return;
    }

    if (data.kind === 'clear') {
      if (st.phase !== 'drawing') return;
      if (ctx.senderId !== st.drawerClientId) return;
      st.history = [];
      ctx.broadcast({ v: 1, type: 'game.event', payload: { gameType: 'pictionary', data: { kind: 'clear' } } }, ctx.senderId);
      return;
    }

    if (data.kind === 'guess') {
      if (st.phase !== 'drawing') return;
      if (ctx.senderId === st.drawerClientId) return;
      if (!room.clients.has(ctx.senderId)) return;
      if (st.correctGuessers.includes(ctx.senderId)) return;
      const text = typeof data.text === 'string' ? data.text.trim().slice(0, MAX_GUESS_LEN) : '';
      if (!text) return;

      const correct = st.word != null && normalize(text) === normalize(st.word);
      if (correct) {
        st.correctGuessers.push(ctx.senderId);
        const points = st.correctGuessers.length === 1 ? FIRST_GUESS_POINTS : LATER_GUESS_POINTS;
        st.scores[ctx.senderId] = (st.scores[ctx.senderId] || 0) + points;
        if (st.correctGuessers.length === 1 && st.drawerClientId) {
          st.scores[st.drawerClientId] = (st.scores[st.drawerClientId] || 0) + DRAWER_BONUS_POINTS;
        }
        st.guessLog.push({ clientId: ctx.senderId, nickname: client.nickname, correct: true, text: null });
        if (st.guessLog.length > MAX_GUESS_LOG) st.guessLog = st.guessLog.slice(-MAX_GUESS_LOG);

        const nonDrawerConnected = [...room.clients.keys()].filter((id) => id !== st.drawerClientId);
        const allGuessed = nonDrawerConnected.length > 0 && nonDrawerConnected.every((id) => st.correctGuessers.includes(id));
        if (allGuessed) {
          endRound(room, 'all_guessed');
        } else {
          broadcastState(room);
        }
      } else {
        st.guessLog.push({ clientId: ctx.senderId, nickname: client.nickname, correct: false, text });
        if (st.guessLog.length > MAX_GUESS_LOG) st.guessLog = st.guessLog.slice(-MAX_GUESS_LOG);
        broadcastState(room);
      }
    }
  },
};
