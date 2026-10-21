const { DICTIONARY, DICT_LIST, COMMON } = require('./words');
const { reportRanked } = require('./wordResults');

const MAX_WRONG_GUESSES = 6;
const MAX_WORD_LENGTH = 40;

// Server-authoritative word validation ("spellcheck") against the hub's shared dictionary
// (server/games/words.js: ENABLE + system list, every inflection — the old hangman-only list was
// missing even "and"). A picked word/phrase is accepted only if every space-separated token is a
// real dictionary word.

// Guessers race (playtest: "compete to guess first instead of together"): each has their own
// letters and gallows. The first to solve gets the win; once every guesser who started is hanged,
// the picker gets it (they stumped the room). Wins are kept while a player stays in the room.

// --- CPU players. A bot can be the word picker (so one person can play solo) or a fellow guesser.
// As picker its level sets the word: short and friendly on Easy, up to short words full of rare
// letters on Expert (the genuinely hard kind in hangman). As guesser: Easy guesses near-randomly,
// Medium by English letter frequency, Hard by frequency among dictionary words of the right
// lengths, Expert filters the dictionary by the revealed pattern and wrong letters.
const BOT_NAMES = ['Ace', 'Byte', 'Chip', 'Dot', 'Echo', 'Flux'];
const LEVEL_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
// Bot picker words come from the everyday COMMON list (so answers are words people know), filtered
// per level: Easy short and friendly, Medium mid-length, Hard long, Expert short words heavy in
// rare letters (few vowels, J/Q/X/Z/... — the genuinely hard kind in hangman). The top ~200 are
// skipped: they're mostly function words (THAT, WHICH, ...) that make dull puzzles.
const RARE = 'JQXZVKWYFBGP';
const rareScore = (w) => [...w].reduce((s, ch) => s + (RARE.includes(ch) ? 2 : 'AEIOU'.includes(ch) ? -1 : 0), 0);
const COMMON_UP = COMMON.map((w) => w.toUpperCase());
const BOT_WORDS = {
  easy: COMMON_UP.slice(200, 3000).filter((w) => w.length >= 4 && w.length <= 5),
  medium: COMMON_UP.slice(200, 5000).filter((w) => w.length >= 6 && w.length <= 7),
  hard: COMMON_UP.slice(200).filter((w) => w.length >= 7 && w.length <= 10),
  expert: COMMON_UP.slice(200).filter((w) => w.length >= 3 && w.length <= 6 && rareScore(w) >= 2),
};
const EN_FREQ = 'ETAOINSRHLDCUMFPGWYBVKXJQZ';
const isBotId = (id) => typeof id === 'string' && id.startsWith('bot-');
const botLevel = (id) => { const l = id.split('~')[1]; return LEVEL_LABEL[l] ? l : 'hard'; };
const BY_LEN = new Map();
function wordsOfLen(n) {
  if (!BY_LEN.has(n)) BY_LEN.set(n, DICT_LIST.filter((w) => w.length === n).map((w) => w.toUpperCase()));
  return BY_LEN.get(n);
}

function botGuess(word, board, level) {
  const st = { word, guessedLetters: board.guessed };
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
    const guessers = st.pickerOrder.filter((id) => isBotId(id) && id !== st.pickerClientId && !boardFor(st, id).out);
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
    else module.exports.onMessage(room, { clientId: actor }, { kind: 'guessLetter', letter: botGuess(st.word, boardFor(st, actor), level) }, ctx);
  }, delay);
}

// Tokens of a cleaned word/phrase that aren't dictionary words (empty array = valid).
function unknownWords(cleaned) {
  return cleaned.toLowerCase().split(' ').filter(Boolean).filter((tok) => !DICTIONARY.has(tok));
}

function boardFor(st, id) {
  if (!st.boards[id]) st.boards[id] = { guessed: [], wrong: 0, out: false };
  return st.boards[id];
}
const revealedCount = (word, board) => [...word].filter((ch) => ch !== ' ' && board.guessed.includes(ch)).length;

function addWin(st, id) {
  if (!id) return;
  st.wins[id] = (st.wins[id] || 0) + 1;
}

// Everyone currently in the room (pickerOrder holds humans + bots), most wins first.
function scoreboard(st) {
  return st.pickerOrder
    .map((id, i) => ({ clientId: id, wins: st.wins[id] || 0, i }))
    .sort((a, b) => b.wins - a.wins || a.i - b.i)
    .map(({ clientId, wins }) => ({ clientId, wins }));
}

function endRound(room, winner) {
  const st = room.state;
  clearTimeout(st._afkTimer);
  st.phase = 'round_over';
  st.lastResult = winner === st.pickerClientId ? 'lose' : 'win';
  st.roundWinner = winner;
  addWin(st, winner);
  // Result: the solver first, then the picker, then everyone else (by letters revealed). No score.
  reportRanked(room, st.pickerOrder.map((id) => ({
    id,
    rank: id === winner ? 1000 : id === st.pickerClientId ? 500 : (st.boards[id] ? revealedCount(st.word, st.boards[id]) : 0),
    level: isBotId(id) ? botLevel(id) : undefined,
  })));
}

// Picker wins once every guesser is hanged. Guessers who haven't guessed at all get AFK_MS to
// start before the round ends without them.
const AFK_MS = 20000;
function checkAllHanged(room) {
  const st = room.state;
  if (st.phase !== 'guessing') return;
  const guessers = st.pickerOrder.filter((id) => id !== st.pickerClientId);
  const started = guessers.filter((id) => st.boards[id]);
  if (!started.length || !started.every((id) => st.boards[id].out)) return;
  clearTimeout(st._afkTimer);
  if (started.length === guessers.length) { endRound(room, st.pickerClientId); return; }
  const word = st.word;
  st._afkTimer = setTimeout(() => {
    if (room.state !== st || st.phase !== 'guessing' || st.word !== word) return;
    const left = st.pickerOrder.filter((id) => id !== st.pickerClientId);
    if (left.every((id) => !st.boards[id] || st.boards[id].out)) {
      endRound(room, st.pickerClientId);
      broadcastState(room, { sendTo: (id, env) => room.sendTo(id, env) });
    }
  }, AFK_MS);
}

function buildView(room, forClientId) {
  const st = room.state;
  const isPicker = forClientId != null && forClientId === st.pickerClientId;
  const mine = (!isPicker && st.boards[forClientId]) || { guessed: [], wrong: 0, out: false };
  // Even the picker only sees the shared guess-progress mask (not the full word) during play —
  // both so their screen shows "current state" progress like everyone else's (playtest ask), and
  // so it isn't a shoulder-surfing giveaway to guessers sitting next to them. The picker separately
  // gets `pickerWord` below so their own client can offer a "reveal my word" toggle on demand.
  const revealAll = st.phase === 'round_over';
  const mask = st.word
    ? st.word.split('').map((ch) => {
        if (ch === ' ') return ' ';
        if (revealAll || mine.guessed.includes(ch)) return ch;
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
    guessedLetters: mine.guessed,
    wrongGuesses: mine.wrong,
    out: mine.out,
    // Everyone's race progress (counts only, never which letters).
    racers: st.word ? Object.entries(st.boards).filter(([id]) => st.pickerOrder.includes(id)).map(([id, b]) => ({
      clientId: id, revealed: revealedCount(st.word, b), wrong: b.wrong, out: b.out,
    })) : [],
    maxWrongGuesses: st.maxWrongGuesses,
    isPicker,
    pickerWord: isPicker ? st.word : null,
    bots: st.pickerOrder.filter(isBotId).map((id) => ({ clientId: id, nickname: botNickname(id) })),
    result: st.phase === 'round_over' ? st.lastResult : null,
    // Who took the round: the solving guesser on a win, the picker on a loss.
    roundWinner: st.phase === 'round_over' ? st.roundWinner : null,
    scores: scoreboard(st),
  };
}

function botNickname(id) {
  return `${id.slice(4).split('~')[0]} (${LEVEL_LABEL[botLevel(id)]})`;
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
  clearTimeout(st._afkTimer);
  st.word = null;
  st.boards = {};
  st.lastResult = null;
  st.roundWinner = null;
}

module.exports = {
  type: 'hangman',
  stats: { rated: false },

  createInitialState() {
    return {
      phase: 'waiting',
      pickerOrder: [],
      pickerClientId: null,
      word: null,
      boards: {}, // { clientId: { guessed: [letters], wrong, out } } — one per racing guesser
      maxWrongGuesses: MAX_WRONG_GUESSES,
      lastResult: null,
      roundWinner: null,
      wins: {}, // { clientId: total rounds won } — see the scoring note at the top
    };
  },

  serializeSnapshot(room, client) {
    return buildView(room, client ? client.clientId : null);
  },

  onJoin(room, client) {
    const st = room.state;
    if (!st.pickerOrder.includes(client.clientId)) st.pickerOrder.push(client.clientId);
    if (!st.pickerClientId) st.pickerClientId = client.clientId;
    // Everyone else's scoreboard should list the newcomer right away (the joiner gets a snapshot).
    for (const clientId of room.clients.keys()) {
      if (clientId === client.clientId) continue;
      room.sendTo(clientId, {
        v: 1,
        type: 'game.event',
        payload: { gameType: 'hangman', data: { kind: 'state', view: buildView(room, clientId) } },
      });
    }
  },

  onLeave(room, client) {
    const st = room.state;
    const idx = st.pickerOrder.indexOf(client.clientId);
    if (idx !== -1) st.pickerOrder.splice(idx, 1);
    delete st.wins[client.clientId];
    // No humans left: bots go too.
    if (!st.pickerOrder.some((id) => !isBotId(id))) {
      st.pickerOrder = [];
      st.wins = {};
      clearTimeout(st._botTimer);
      if (isBotId(st.pickerClientId)) { resetRound(st); st.pickerClientId = null; }
    }

    delete st.boards[client.clientId];
    checkAllHanged(room);
    if (st.pickerClientId === client.clientId) {
      resetRound(st);
      st.pickerClientId = st.pickerOrder.length > 0 ? st.pickerOrder[0] : null;
    }
    // Always rebroadcast so the scoreboard drops the leaver (and a new picker gets prompted).
    for (const clientId of room.clients.keys()) {
      if (clientId === client.clientId) continue;
      room.sendTo(clientId, {
        v: 1,
        type: 'game.event',
        payload: { gameType: 'hangman', data: { kind: 'state', view: buildView(room, clientId) } },
      });
    }
    scheduleBots(room);
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
      delete st.wins[id];
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
      const unknown = unknownWords(cleaned);
      if (unknown.length) {
        ctx.sendTo(ctx.senderId, {
          v: 1,
          type: 'game.event',
          payload: { gameType: 'hangman', data: { kind: 'wordRejected', unknown: unknown.slice(0, 3) } },
        });
        return;
      }
      st.word = cleaned;
      st.boards = {};
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
      if (!st.pickerOrder.includes(ctx.senderId)) return;
      const board = boardFor(st, ctx.senderId);
      if (board.out || board.guessed.includes(letter)) return;
      board.guessed.push(letter);
      if (!st.word.includes(letter)) board.wrong += 1;
      if (board.wrong >= st.maxWrongGuesses) board.out = true;

      const uniqueLetters = new Set(st.word.replace(/ /g, '').split(''));
      if ([...uniqueLetters].every((ch) => board.guessed.includes(ch))) endRound(room, ctx.senderId);
      else checkAllHanged(room);
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
