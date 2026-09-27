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

// --- CPU players. A bot can be the word picker (so one person can play solo) or a fellow guesser.
// As picker its level sets the word: short and friendly on Easy, up to short words full of rare
// letters on Expert (the genuinely hard kind in hangman). As guesser: Easy guesses near-randomly,
// Medium by English letter frequency, Hard by frequency among dictionary words of the right
// lengths, Expert filters the dictionary by the revealed pattern and wrong letters.
const BOT_NAMES = ['Ace', 'Byte', 'Chip', 'Dot', 'Echo', 'Flux'];
const LEVEL_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
const BOT_WORDS = {
  easy: 'APPLE HOUSE WATER PIZZA TIGER CHAIR BEACH TRAIN MOUSE CLOUD HAPPY PLANT RIVER SMILE BREAD STONE GRAPE LEMON PAPER HORSE TABLE BIRD FISH MOON STAR TREE BOAT CAKE DOOR RAIN SNOW BALL KITE FROG DUCK LION BEAR MILK SHOE HAT GAME SONG RING GIFT COIN'.split(' '),
  medium: 'GARDEN PENCIL ROCKET CASTLE GUITAR ORANGE BASKET WINDOW PLANET BRIDGE DRAGON JUNGLE ISLAND CAMERA TURTLE PUZZLE SCHOOL FOREST SUMMER MARKET PARROT BUTTON HAMMER BOTTLE CANDLE DESERT FLOWER GALAXY KITTEN MIRROR PEPPER ROBOT SILVER TICKET VOLCANO WIZARD BLANKET PIRATE'.split(' '),
  hard: 'RHYTHM OXYGEN JOCKEY QUARTZ WALTZ ZEPHYR BUZZARD GLYPH SPHINX KAYAK JIGSAW PUZZLED VORTEX WHISKEY ZODIAC BANJO FJORD GAZEBO JACKPOT KNAPSACK MYSTIFY OBJECT PIXEL QUIVER SQUAWK TOPAZ VODKA WRISTWATCH YACHT ZIGZAG ABYSS CRYPT GYPSUM HYPHEN LYNX NYMPH'.split(' '),
  expert: 'JAZZ FUZZ BUZZ JINX QUIZ FIZZ HYMN LYMPH CRYPT GYPSY MYTH NYMPH PYGMY SHY WAXY JUKEBOX KIWI VEX JAB ZIP YAK WOK IVY FOX JAW HOAX JOWL QUAY VIXEN ZYGOTE WHIZ OXBOW'.split(' '),
};
const EN_FREQ = 'ETAOINSRHLDCUMFPGWYBVKXJQZ';
const isBotId = (id) => typeof id === 'string' && id.startsWith('bot-');
const botLevel = (id) => { const l = id.split('~')[1]; return LEVEL_LABEL[l] ? l : 'hard'; };
const BY_LEN = new Map();
function wordsOfLen(n) {
  if (!BY_LEN.has(n)) BY_LEN.set(n, [...DICTIONARY].filter((w) => w.length === n && /^[a-z]+$/.test(w)).map((w) => w.toUpperCase()));
  return BY_LEN.get(n);
}

function botGuess(st, level) {
  const left = [...EN_FREQ].filter((ch) => !st.guessedLetters.includes(ch));
  if (level === 'easy') return Math.random() < 0.5 ? left[Math.floor(Math.random() * left.length)] : left[Math.floor(Math.random() * Math.min(8, left.length))];
  if (level === 'medium') return left[Math.random() < 0.8 ? 0 : Math.min(left.length - 1, 1 + Math.floor(Math.random() * 3))];
  const words = st.word.split(' ');
  const wrong = st.guessedLetters.filter((ch) => !st.word.includes(ch));
  const counts = {};
  for (const w of words) {
    let cands = wordsOfLen(w.length);
    if (level === 'expert') {
      cands = cands.filter((c) => {
        for (let i = 0; i < w.length; i++) {
          const known = st.guessedLetters.includes(w[i]);
          if (known ? c[i] !== w[i] : st.guessedLetters.includes(c[i])) return false;
        }
        return !wrong.some((ch) => c.includes(ch));
      });
      if (cands.every((c) => c === w) && cands.length) {
        // Solved this word already — no information here.
        continue;
      }
    }
    for (const c of cands) for (const ch of new Set(c)) if (!st.guessedLetters.includes(ch)) counts[ch] = (counts[ch] || 0) + 1;
  }
  const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  return best || left[0];
}

function botPick(level) {
  const list = BOT_WORDS[level] || BOT_WORDS.hard;
  return list[Math.floor(Math.random() * list.length)];
}

// Re-checked on every state change: a bot picker picks, and bot guessers take a turn every few
// seconds (slow enough that humans in the room still get to play).
function scheduleBots(room) {
  const st = room.state;
  clearTimeout(st._botTimer);
  let actor = null; let delay = 0;
  if (st.phase === 'waiting' && isBotId(st.pickerClientId)) { actor = st.pickerClientId; delay = 1200; }
  else if (st.phase === 'guessing') {
    const guessers = st.pickerOrder.filter((id) => isBotId(id) && id !== st.pickerClientId);
    if (guessers.length) {
      actor = guessers[Math.floor(Math.random() * guessers.length)];
      const humans = st.pickerOrder.filter((id) => !isBotId(id) && id !== st.pickerClientId).length;
      delay = humans ? 3500 + Math.random() * 2500 : 1300 + Math.random() * 900;
    }
  }
  if (!actor) return;
  const phase = st.phase;
  st._botTimer = setTimeout(() => {
    if (room.state !== st || st.phase !== phase || !st.pickerOrder.includes(actor)) return;
    const ctx = { senderId: actor, sendTo: (id, env) => room.sendTo(id, env), broadcast: (env) => room.broadcast(env) };
    const level = botLevel(actor);
    if (phase === 'waiting') module.exports.onMessage(room, { clientId: actor }, { kind: 'setWord', word: botPick(level) }, ctx);
    else module.exports.onMessage(room, { clientId: actor }, { kind: 'guessLetter', letter: botGuess(st, level) }, ctx);
  }, delay);
}

function isValidWordOrPhrase(cleaned) {
  const tokens = cleaned.toLowerCase().split(' ').filter(Boolean);
  return tokens.length > 0 && tokens.every((tok) => DICTIONARY.has(tok));
}

function buildView(room, forClientId) {
  const st = room.state;
  const isPicker = forClientId != null && forClientId === st.pickerClientId;
  // Even the picker only sees the shared guess-progress mask (not the full word) during play —
  // both so their screen shows "current state" progress like everyone else's (playtest ask), and
  // so it isn't a shoulder-surfing giveaway to guessers sitting next to them. The picker separately
  // gets `pickerWord` below so their own client can offer a "reveal my word" toggle on demand.
  const revealAll = st.phase === 'round_over';
  const mask = st.word
    ? st.word.split('').map((ch) => {
        if (ch === ' ') return ' ';
        if (revealAll || st.guessedLetters.includes(ch)) return ch;
        return null;
      })
    : [];
  const wordCounts = st.word ? st.word.split(' ').map((w) => w.length) : [];
  return {
    phase: st.phase,
    pickerClientId: st.pickerClientId,
    letterCount: st.word ? st.word.replace(/ /g, '').length : 0,
    wordCounts,
    mask,
    guessedLetters: st.guessedLetters,
    wrongGuesses: st.wrongGuesses,
    maxWrongGuesses: st.maxWrongGuesses,
    isPicker,
    pickerWord: isPicker ? st.word : null,
    bots: st.pickerOrder.filter(isBotId).map((id) => ({ clientId: id, nickname: botNickname(id) })),
    result: st.phase === 'round_over' ? st.lastResult : null,
  };
}

function botNickname(id) {
  return `🤖 ${id.slice(4).split('~')[0]} (${LEVEL_LABEL[botLevel(id)]})`;
}

function broadcastState(room, ctx) {
  scheduleBots(room);
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
    // No humans left: bots go too.
    if (!st.pickerOrder.some((id) => !isBotId(id))) {
      st.pickerOrder = [];
      clearTimeout(st._botTimer);
      if (isBotId(st.pickerClientId)) { resetRound(st); st.pickerClientId = null; }
    }

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

    if (data.kind === 'addBot') {
      if (isBotId(ctx.senderId) || st.pickerOrder.filter(isBotId).length >= 3) return;
      const used = new Set(st.pickerOrder.filter(isBotId).map((id) => id.slice(4).split('~')[0]));
      const name = BOT_NAMES.find((n) => !used.has(n));
      const level = LEVEL_LABEL[data.level] ? data.level : 'hard';
      const id = `bot-${name}~${level}`;
      st.pickerOrder.push(id);
      // Playing alone and nobody has picked yet: the bot picks, so the human gets to guess.
      if (st.phase === 'waiting' && st.pickerOrder.filter((x) => !isBotId(x)).length === 1 && !isBotId(st.pickerClientId)) {
        st.pickerClientId = id;
      }
      broadcastState(room, ctx);
      return;
    }
    if (data.kind === 'removeBot') {
      const id = data.clientId;
      const i = st.pickerOrder.indexOf(id);
      if (!isBotId(id) || i === -1) return;
      st.pickerOrder.splice(i, 1);
      if (st.pickerClientId === id) {
        resetRound(st);
        st.pickerClientId = st.pickerOrder[i % Math.max(1, st.pickerOrder.length)] || null;
      }
      broadcastState(room, ctx);
      return;
    }

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
