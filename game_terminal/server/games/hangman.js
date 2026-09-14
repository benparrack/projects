const fs = require('fs');
const path = require('path');

const MAX_WRONG_GUESSES = 6;
const MAX_WORD_LENGTH = 40;

// Server-authoritative word validation ("spellcheck") — a fixed English wordlist loaded once at
// startup (~73k words, from this repo's own server/games/data/hangman_words.txt so it's portable
// across hosts rather than relying on an OS dictionary that may not exist on the deploy target).
// A picked word/phrase is accepted only if every space-separated token is a real dictionary word.
const DICTIONARY = new Set(
  fs.readFileSync(path.join(__dirname, 'data', 'hangman_words.txt'), 'utf8').split('\n').filter(Boolean)
);

function isValidWordOrPhrase(cleaned) {
  const tokens = cleaned.toLowerCase().split(' ').filter(Boolean);
  return tokens.length > 0 && tokens.every((tok) => DICTIONARY.has(tok));
}

function buildView(room, forClientId) {
  const st = room.state;
  const isPicker = forClientId != null && forClientId === st.pickerClientId;
  const revealAll = isPicker || st.phase === 'round_over';
  const mask = st.word
    ? st.word.split('').map((ch) => {
        if (ch === ' ') return ' ';
        if (revealAll || st.guessedLetters.includes(ch)) return ch;
        return null;
      })
    : [];
  return {
    phase: st.phase,
    pickerClientId: st.pickerClientId,
    wordLength: st.word ? st.word.length : 0,
    mask,
    guessedLetters: st.guessedLetters,
    wrongGuesses: st.wrongGuesses,
    maxWrongGuesses: st.maxWrongGuesses,
    isPicker,
    result: st.phase === 'round_over' ? st.lastResult : null,
  };
}

function broadcastState(room, ctx) {
  for (const clientId of room.clients.keys()) {
    ctx.sendTo(clientId, {
      v: 1,
      type: 'game.event',
      payload: { gameType: 'hangman', data: { kind: 'state', view: buildView(room, clientId) } },
    });
  }
}

function resetRound(st) {
  st.phase = 'waiting';
  st.word = null;
  st.guessedLetters = [];
  st.wrongGuesses = 0;
  st.lastResult = null;
}

module.exports = {
  type: 'hangman',

  createInitialState() {
    return {
      phase: 'waiting',
      pickerOrder: [],
      pickerClientId: null,
      word: null,
      guessedLetters: [],
      wrongGuesses: 0,
      maxWrongGuesses: MAX_WRONG_GUESSES,
      lastResult: null,
    };
  },

  serializeSnapshot(room, client) {
    return buildView(room, client ? client.clientId : null);
  },

  onJoin(room, client) {
    const st = room.state;
    if (!st.pickerOrder.includes(client.clientId)) st.pickerOrder.push(client.clientId);
    if (!st.pickerClientId) st.pickerClientId = client.clientId;
  },

  onLeave(room, client) {
    const st = room.state;
    const idx = st.pickerOrder.indexOf(client.clientId);
    if (idx !== -1) st.pickerOrder.splice(idx, 1);

    if (st.pickerClientId === client.clientId) {
      resetRound(st);
      st.pickerClientId = st.pickerOrder.length > 0 ? st.pickerOrder[0] : null;
      for (const clientId of room.clients.keys()) {
        room.sendTo(clientId, {
          v: 1,
          type: 'game.event',
          payload: { gameType: 'hangman', data: { kind: 'state', view: buildView(room, clientId) } },
        });
      }
    }
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;

    if (data.kind === 'setWord') {
      if (st.phase !== 'waiting') return;
      if (ctx.senderId !== st.pickerClientId) return;
      const raw = typeof data.word === 'string' ? data.word.trim().toUpperCase() : '';
      const cleaned = raw.replace(/[^A-Z ]/g, '').replace(/ {2,}/g, ' ');
      if (!cleaned.replace(/ /g, '').length) return;
      if (cleaned.length > MAX_WORD_LENGTH) return;
      if (!isValidWordOrPhrase(cleaned)) {
        ctx.sendTo(ctx.senderId, {
          v: 1,
          type: 'game.event',
          payload: { gameType: 'hangman', data: { kind: 'wordRejected' } },
        });
        return;
      }
      st.word = cleaned;
      st.guessedLetters = [];
      st.wrongGuesses = 0;
      st.lastResult = null;
      st.phase = 'guessing';
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'guessLetter') {
      if (st.phase !== 'guessing') return;
      if (ctx.senderId === st.pickerClientId) return;
      const letter = typeof data.letter === 'string' ? data.letter.trim().toUpperCase() : '';
      if (!/^[A-Z]$/.test(letter)) return;
      if (st.guessedLetters.includes(letter)) return;
      st.guessedLetters.push(letter);
      if (!st.word.includes(letter)) st.wrongGuesses += 1;

      const uniqueLetters = new Set(st.word.replace(/ /g, '').split(''));
      const allGuessed = [...uniqueLetters].every((ch) => st.guessedLetters.includes(ch));
      if (allGuessed) {
        st.phase = 'round_over';
        st.lastResult = 'win';
      } else if (st.wrongGuesses >= st.maxWrongGuesses) {
        st.phase = 'round_over';
        st.lastResult = 'lose';
      }
      broadcastState(room, ctx);
      return;
    }

    if (data.kind === 'nextRound') {
      if (st.phase !== 'round_over') return;
      const order = st.pickerOrder;
      if (order.length > 0) {
        const curIdx = order.indexOf(st.pickerClientId);
        st.pickerClientId = order[curIdx === -1 ? 0 : (curIdx + 1) % order.length];
      }
      resetRound(st);
      broadcastState(room, ctx);
    }
  },
};
