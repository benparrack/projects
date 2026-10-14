// Codemaster (Mastermind): crack a hidden 4-peg code of 6 colours in at most 10 guesses. Each
// guess is scored with GREEN pegs (right colour, right spot) and YELLOW pegs (right colour, wrong
// spot). Three modes:
//   duel — two seats each set a secret code for the other, then both race to crack theirs.
//          Solving beats not solving, fewer guesses beats more, and a tie on guesses goes to
//          whoever finished faster. Either seat can be a CPU code-breaker (Easy..Expert).
//   race — the computer sets one code; everyone who joins cracks it on their own board.
//          Other racers' boards only show their feedback pegs (their colours stay hidden until
//          the end, since everyone is cracking the same code).
//   coop — the computer sets a code; everyone in the room shares one board and any of them
//          can submit the next guess.
// Secret codes never leave the server until game over (per-client views, like hangman/bs).

'use strict';

const { setBotLevel, botLevelOf } = require('./ai/levels');
const { report } = require('../report');
const { frameOf } = require('./boardResult');

const TYPE = 'codemaster';
const COLORS = 6;
const PEGS = 4;
const MAX_GUESSES = 10;
const MODES = ['duel', 'race', 'coop'];
const SEATS = ['a', 'b'];
const BOT = 'BOT';
const MAX_RACERS = 12;

// ---- Scoring ----------------------------------------------------------------------------------

// Returns { exact, near }: exact = right colour in the right spot; near = right colour, wrong spot
// (each secret peg matched at most once, so duplicates are counted correctly).
function score(secret, guess) {
  let exact = 0;
  const sc = new Array(COLORS).fill(0);
  const gc = new Array(COLORS).fill(0);
  for (let i = 0; i < PEGS; i++) {
    if (secret[i] === guess[i]) exact++;
    else {
      sc[secret[i]]++;
      gc[guess[i]]++;
    }
  }
  let near = 0;
  for (let c = 0; c < COLORS; c++) near += Math.min(sc[c], gc[c]);
  return { exact, near };
}

const hasDup = (code) => new Set(code).size !== code.length;

function validCode(code, allowDup) {
  return Array.isArray(code) && code.length === PEGS
    && code.every((c) => Number.isInteger(c) && c >= 0 && c < COLORS)
    && (allowDup || !hasDup(code));
}

function randomCode(allowDup, rng = Math.random) {
  if (allowDup) return Array.from({ length: PEGS }, () => Math.floor(rng() * COLORS));
  const pool = [...Array(COLORS).keys()];
  const out = [];
  for (let i = 0; i < PEGS; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

// ---- Solver (bots) ----------------------------------------------------------------------------
// Codes are indexed 0..1295 (base-6 digits). Feedback is packed as exact*5+near. A full
// 1296x1296 feedback table makes Knuth's minimax cheap, and decisions are memoised by history,
// so the whole game tree is only ever computed once per process.

const ALL = [];
for (let i = 0; i < COLORS ** PEGS; i++) {
  const code = [];
  let n = i;
  for (let p = 0; p < PEGS; p++) { code.unshift(n % COLORS); n = Math.floor(n / COLORS); }
  ALL.push(code);
}
const codeIndex = (code) => code.reduce((a, c) => a * COLORS + c, 0);
const NODUP = ALL.map((_, i) => i).filter((i) => !hasDup(ALL[i]));
const DUPSPACE = ALL.map((_, i) => i);

let table = null;
function fb(a, b) {
  if (!table) {
    table = new Uint8Array(ALL.length * ALL.length);
    for (let i = 0; i < ALL.length; i++) {
      for (let j = i; j < ALL.length; j++) {
        const { exact, near } = score(ALL[i], ALL[j]);
        table[i * ALL.length + j] = table[j * ALL.length + i] = exact * 5 + near;
      }
    }
  }
  return table[a * ALL.length + b];
}
const SOLVED = PEGS * 5;

// Candidates still consistent with every (guess, feedback) seen so far.
function consistent(space, history) {
  return space.filter((c) => history.every((h) => fb(h.g, c) === h.f));
}

// Knuth minimax: choose the guess whose worst-case feedback bucket is smallest, preferring a
// guess that could itself be the answer, then the lowest index (deterministic). `pool` is the set
// of guesses considered (all codes for Expert, only candidates for Hard).
function minimaxGuess(pool, cands) {
  if (cands.length <= 2) return cands[0];
  const candSet = new Set(cands);
  let best = -1;
  let bestWorst = Infinity;
  let bestIsCand = false;
  const counts = new Uint16Array(25);
  for (const g of pool) {
    counts.fill(0);
    let worst = 0;
    for (const c of cands) {
      const k = ++counts[fb(g, c)];
      if (k > worst) { worst = k; if (worst > bestWorst) break; }
    }
    const isCand = candSet.has(g);
    if (worst < bestWorst || (worst === bestWorst && isCand && !bestIsCand)) {
      best = g; bestWorst = worst; bestIsCand = isCand;
    }
  }
  return best;
}

const memo = new Map();
function firstGuess(allowDup) {
  return codeIndex(allowDup ? [0, 0, 1, 1] : [0, 1, 2, 3]);
}

// Next guess (as a colour array) for a bot at `level`, given history [{ code, exact, near }].
function botGuess(level, allowDup, guesses, rng = Math.random) {
  const space = allowDup ? DUPSPACE : NODUP;
  const history = guesses.map((g) => ({ g: codeIndex(g.code), f: g.exact * 5 + g.near }));
  const tried = new Set(history.map((h) => h.g));
  const cands = consistent(space, history);
  const pickRandom = (arr) => arr[Math.floor(rng() * arr.length)];
  if (!cands.length) return ALL[pickRandom(space)];

  if (level === 'easy') {
    // Forgetful: only keeps the last guess's feedback in mind, like a distracted human.
    const recent = consistent(space, history.slice(-1)).filter((c) => !tried.has(c));
    return ALL[pickRandom(cands.length === 1 ? cands : recent.length ? recent : cands)];
  }
  if (level === 'medium') {
    // Remembers the last three clues, then plays any code that fits them.
    const recent = consistent(space, history.slice(-3)).filter((c) => !tried.has(c));
    return ALL[pickRandom(cands.length === 1 ? cands : recent.length ? recent : cands)];
  }

  const key = `${level}|${allowDup ? 1 : 0}|${history.map((h) => `${h.g}:${h.f}`).join(',')}`;
  if (memo.has(key)) return ALL[memo.get(key)];
  let g;
  if (!history.length) g = level === 'expert' ? firstGuess(allowDup) : pickRandom(cands);
  // Hard: remembers everything; minimax over the remaining candidates most of the time, a random candidate otherwise.
  else if (level === 'hard') g = rng() < 0.6 ? minimaxGuess(cands, cands) : pickRandom(cands);
  else g = minimaxGuess(space, cands);
  // Only Expert is fully deterministic, so only its decisions are memoised.
  if (level === 'expert') memo.set(key, g);
  return ALL[g];
}

// ---- State ------------------------------------------------------------------------------------

function freshBoard() {
  return { guesses: [], solved: false, done: false, finishedAt: null, startedAt: null };
}

function createInitialState() {
  return {
    mode: 'duel',
    allowDup: true,
    phase: 'waiting', // waiting -> (setting, duel only) -> playing -> game_over
    players: { a: null, b: null }, // duel seats
    botLevels: {},
    racers: [], // race mode clientIds in join order
    boards: {}, // key ('a'|'b' | clientId | 'team') -> board
    secrets: {}, // key -> code to crack on that board
    setBy: {}, // duel: seat -> true once it has locked in a code for the other seat
    startedAt: null,
    endedAt: null,
    result: null, // { ranking: [key...], winners: [key...], reason }
    gameId: 0,
  };
}

const other = (seat) => (seat === 'a' ? 'b' : 'a');

function seatOf(st, id) {
  if (st.players.a === id) return 'a';
  if (st.players.b === id) return 'b';
  return null;
}

// The board key a client plays on (or null if they can't guess right now).
function boardKeyFor(st, id) {
  if (st.mode === 'duel') return seatOf(st, id);
  if (st.mode === 'race') return st.racers.includes(id) ? id : null;
  return 'team';
}

function clearTimers(st) {
  st.gameId++; // every pending bot timer checks this and no-ops
}

function resetToWaiting(st) {
  clearTimers(st);
  st.phase = 'waiting';
  st.boards = {};
  st.secrets = {};
  st.setBy = {};
  st.startedAt = null;
  st.endedAt = null;
  st.result = null;
}

function startPlaying(room) {
  const st = room.state;
  st.phase = 'playing';
  st.startedAt = Date.now();
  for (const b of Object.values(st.boards)) b.startedAt = st.startedAt;
  // Replay: [setup, ...events], times in ms since the start. Events: [t, key, code, by] a guess,
  // [t, key, null, by] a give-up, [t, '+' | '-', clientId] a racer joining / leaving mid-race.
  st.log = [{ mode: st.mode, allowDup: st.allowDup, players: { ...st.players }, racers: st.racers.slice(),
    // In board order: the replay rebuilds boards from these keys, and ranking ties keep that order.
    secrets: Object.fromEntries(Object.keys(st.boards).map((k) => [k, st.secrets[k]])) }];
  st.reported = false;
  scheduleBots(room);
}

function beginGame(room) {
  const st = room.state;
  clearTimers(st);
  st.boards = {};
  st.secrets = {};
  st.setBy = {};
  st.result = null;
  st.endedAt = null;
  if (st.mode === 'duel') {
    for (const s of SEATS) st.boards[s] = freshBoard();
    // A bot "sets" a random code for its opponent right away.
    for (const s of SEATS) {
      if (st.players[s] === BOT) {
        st.secrets[other(s)] = randomCode(st.allowDup);
        st.setBy[s] = true;
      }
    }
    st.phase = 'setting';
    if (st.setBy.a && st.setBy.b) startPlaying(room);
    return;
  }
  const code = randomCode(st.allowDup);
  if (st.mode === 'race') {
    for (const id of st.racers) { st.boards[id] = freshBoard(); st.secrets[id] = code; }
  } else {
    st.boards.team = freshBoard();
    st.secrets.team = code;
  }
  st.sharedSecret = code;
  startPlaying(room);
}

function boardRank(b) {
  // Lower is better: solved first, then fewer guesses, then faster.
  const time = b.finishedAt && b.startedAt ? b.finishedAt - b.startedAt : Infinity;
  return [b.solved ? 0 : 1, b.solved ? b.guesses.length : 0, b.solved ? time : 0];
}
function cmpRank(x, y) {
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

function maybeFinish(room, now = Date.now()) {
  const st = room.state;
  const keys = Object.keys(st.boards);
  if (!keys.length || !keys.every((k) => st.boards[k].done)) return false;
  st.phase = 'game_over';
  st.endedAt = now;
  const ranking = keys.slice().sort((x, y) => cmpRank(boardRank(st.boards[x]), boardRank(st.boards[y])));
  const top = ranking[0];
  let winners = [];
  if (st.boards[top].solved) {
    winners = ranking.filter((k) => cmpRank(boardRank(st.boards[k]), boardRank(st.boards[top])) === 0);
  }
  st.result = { ranking, winners };
  clearTimers(st);
  reportResult(room, ranking);
  return true;
}

// Places follow the ranking (equal rank = shared place; two unsolved boards tie). Duel keys are
// seats, race keys are clientIds; coop is one shared place for everyone who guessed. Scores are
// guesses used, for solved boards only.
function reportResult(room, ranking) {
  const st = room.state;
  if (st.reported) return;
  st.reported = true;
  const idsOf = (k) => (st.mode === 'duel' ? [st.players[k] === BOT ? BOT : st.players[k]]
    : st.mode === 'race' ? [k] : [...new Set(st.boards[k].guesses.map((g) => g.by).filter(Boolean))]);
  const placements = [];
  const scores = {};
  ranking.forEach((k, i) => {
    const ids = idsOf(k);
    if (i && cmpRank(boardRank(st.boards[k]), boardRank(st.boards[ranking[i - 1]])) === 0) placements[placements.length - 1].push(...ids);
    else placements.push(ids);
    if (st.boards[k].solved) for (const id of ids) scores[id] = st.boards[k].guesses.length;
  });
  if (!placements.flat().length) return;
  const result = { placements, scores, replay: st.log };
  const botSeat = st.mode === 'duel' && SEATS.find((s) => st.players[s] === BOT);
  if (botSeat) result.botLevel = botLevelOf(st, botSeat);
  report(room, result);
}

function logEvent(st, ...ev) {
  if (st.log) st.log.push(ev);
}

function applyGuess(st, key, code, by, now = Date.now()) {
  const b = st.boards[key];
  const { exact, near } = score(st.secrets[key], code);
  b.guesses.push({ code: code.slice(), exact, near, at: now, by: by || null });
  logEvent(st, now - st.startedAt, key, code.slice(), by || null);
  if (exact === PEGS) b.solved = true;
  if (b.solved || b.guesses.length >= MAX_GUESSES) {
    b.done = true;
    b.finishedAt = now;
  }
}

function giveUp(room, key, by, now = Date.now()) {
  const st = room.state;
  const b = st.boards[key];
  b.done = true;
  b.finishedAt = now;
  logEvent(st, now - st.startedAt, key, null, by);
  maybeFinish(room, now);
}

// ---- Bots -------------------------------------------------------------------------------------

const BOT_DELAY = { easy: [2500, 5000], medium: [3000, 6000], hard: [3500, 7000], expert: [4000, 8000] };

function scheduleBots(room) {
  const st = room.state;
  if (st.mode !== 'duel' || st.phase !== 'playing') return;
  for (const seat of SEATS) {
    if (st.players[seat] !== BOT) continue;
    const b = st.boards[seat];
    if (!b || b.done || b.pending) continue;
    const level = botLevelOf(st, seat);
    const [lo, hi] = BOT_DELAY[level] || BOT_DELAY.hard;
    const gid = st.gameId;
    b.pending = true;
    const timer = setTimeout(() => {
      const s2 = room.state;
      if (s2.gameId !== gid || s2.phase !== 'playing' || s2.players[seat] !== BOT) return;
      const bb = s2.boards[seat];
      bb.pending = false;
      if (bb.done) return;
      const guess = botGuess(botLevelOf(s2, seat), s2.allowDup, bb.guesses);
      applyGuess(s2, seat, guess, BOT);
      maybeFinish(room);
      broadcastState(room);
      scheduleBots(room);
    }, lo + Math.random() * (hi - lo));
    if (timer.unref) timer.unref();
  }
}

// ---- Views ------------------------------------------------------------------------------------

function buildView(room, forId) {
  const st = room.state;
  const over = st.phase === 'game_over';
  const myKey = boardKeyFor(st, forId);
  const mySeat = st.mode === 'duel' ? seatOf(st, forId) : null;
  const boards = {};
  for (const [k, b] of Object.entries(st.boards)) {
    // In race mode everyone cracks the same code, so another racer's colours are hidden.
    const hideColors = st.mode === 'race' && !over && k !== myKey;
    boards[k] = {
      guesses: b.guesses.map((g) => ({ code: hideColors ? null : g.code, exact: g.exact, near: g.near, by: g.by })),
      solved: b.solved,
      done: b.done,
      startedAt: b.startedAt,
      finishedAt: b.finishedAt,
    };
  }
  // Secrets: everything at game over; in duel, the code I set (= the one on my opponent's board).
  const secrets = {};
  if (over) Object.assign(secrets, st.secrets);
  else if (mySeat && st.secrets[other(mySeat)]) secrets[other(mySeat)] = st.secrets[other(mySeat)];
  return {
    mode: st.mode,
    allowDup: st.allowDup,
    phase: st.phase,
    players: st.players,
    botLevels: st.botLevels || {},
    racers: st.racers,
    boards,
    secrets,
    setBy: st.setBy,
    startedAt: st.startedAt,
    endedAt: st.endedAt,
    result: st.result,
    gameId: st.gameId,
    maxGuesses: MAX_GUESSES,
    now: Date.now(),
  };
}

function broadcastState(room) {
  for (const id of room.clients.keys()) {
    room.sendTo(id, { v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'state', ...buildView(room, id) } } });
  }
}

// ---- Plugin -----------------------------------------------------------------------------------

module.exports = {
  type: TYPE,
  // exported for tests
  _internal: { score, randomCode, botGuess, validCode, ALL, codeIndex, NODUP, MAX_GUESSES },

  createInitialState,

  isRoomFull(room) {
    const st = room.state;
    return st.mode === 'duel' && !!(st.players.a && st.players.b);
  },

  serializeSnapshot(room, client) {
    return buildView(room, client && client.clientId);
  },

  stats: { rated: true, score: { label: 'GUESSES', better: 'low', format: 'int' } },

  // Re-plays [setup, ...events] from the start of play (the secrets are in the setup); one
  // spectator view per event, timestamps relative to the start (startedAt 0, `now` = event time).
  replayFrames(replay) {
    const [setup, ...events] = replay;
    const room = { state: createInitialState() };
    const st = room.state;
    Object.assign(st, { mode: setup.mode, allowDup: setup.allowDup, players: { ...setup.players }, racers: setup.racers.slice(), secrets: { ...setup.secrets } });
    st.sharedSecret = Object.values(setup.secrets)[0];
    for (const k of Object.keys(setup.secrets)) st.boards[k] = { ...freshBoard(), startedAt: 0 };
    st.phase = 'playing';
    st.startedAt = 0;
    st.log = [setup];
    const frame = (t) => frameOf({ ...buildView(room, null), now: t });
    const frames = [frame(0)];
    for (const [t, key, code, by] of events) {
      if (key === '+') {
        st.racers.push(code);
        st.boards[code] = { ...freshBoard(), startedAt: t };
        st.secrets[code] = st.sharedSecret;
      } else if (key === '-') {
        st.racers.splice(st.racers.indexOf(code), 1);
        delete st.boards[code];
        delete st.secrets[code];
        maybeFinish(room, t);
      } else if (!st.boards[key]) break;
      else if (code) { applyGuess(st, key, code, by, t); maybeFinish(room, t); }
      else giveUp(room, key, by, t);
      frames.push(frame(t));
    }
    return frames;
  },

  onJoin(room) {
    broadcastState(room);
  },

  onLeave(room, client) {
    const st = room.state;
    const id = client.clientId;
    const seat = seatOf(st, id);
    if (seat) {
      st.players[seat] = null;
      if (st.phase !== 'game_over') resetToWaiting(st);
    }
    const ri = st.racers.indexOf(id);
    if (ri !== -1) {
      st.racers.splice(ri, 1);
      if (st.phase === 'playing') {
        logEvent(st, Date.now() - st.startedAt, '-', id);
        delete st.boards[id];
        delete st.secrets[id];
        if (!st.racers.length) resetToWaiting(st);
        else maybeFinish(room);
      }
    }
    if (st.mode === 'coop' && room.clients.size === 0 && st.phase === 'playing') resetToWaiting(st);
    broadcastState(room);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;
    const me = ctx.senderId;
    const reject = (reason) => ctx.sendTo(me, { v: 1, type: 'game.event', payload: { gameType: TYPE, data: { kind: 'moveRejected', reason } } });
    const done = () => broadcastState(room);
    const configurable = st.phase === 'waiting' || st.phase === 'game_over';

    switch (data.kind) {
      case 'setMode': {
        if (!configurable || !MODES.includes(data.mode) || data.mode === st.mode) return;
        // Changing the mode clears seats/racers so nobody ends up in a mode they didn't pick.
        // Only someone taking part can switch modes — or anyone, if no human is taking part.
        const humans = [st.players.a, st.players.b].filter((p) => p && p !== BOT).concat(st.racers);
        if (humans.length && !humans.includes(me)) return reject('not_participant');
        st.mode = data.mode;
        st.players = { a: null, b: null };
        st.racers = [];
        resetToWaiting(st);
        return done();
      }
      case 'setDup': {
        if (!configurable) return;
        st.allowDup = !!data.allowDup;
        if (st.phase === 'game_over') resetToWaiting(st);
        return done();
      }
      case 'sit': {
        if (st.mode !== 'duel' || !SEATS.includes(data.seat) || st.players[data.seat]) return;
        if (data.bot) {
          if (st.players[other(data.seat)] === BOT) return reject('two_bots');
          st.players[data.seat] = BOT;
          setBotLevel(st, data.seat, data.level);
          // One click to play a bot: an unseated sender takes the other seat if it's free.
          if (!seatOf(st, me) && !st.players[other(data.seat)]) st.players[other(data.seat)] = me;
        } else {
          if (seatOf(st, me)) return;
          st.players[data.seat] = me;
        }
        if (st.phase === 'game_over') resetToWaiting(st);
        if (st.players.a && st.players.b) beginGame(room);
        return done();
      }
      case 'leaveSeat': {
        const seat = seatOf(st, me);
        if (!seat) return;
        st.players[seat] = null;
        resetToWaiting(st);
        return done();
      }
      case 'removeBot': {
        if (!SEATS.includes(data.seat) || st.players[data.seat] !== BOT) return;
        st.players[data.seat] = null;
        resetToWaiting(st);
        return done();
      }
      case 'setBotLevel': {
        if (!SEATS.includes(data.seat) || st.players[data.seat] !== BOT) return;
        setBotLevel(st, data.seat, data.level);
        return done();
      }
      case 'joinRace': {
        if (st.mode !== 'race' || st.racers.includes(me) || st.racers.length >= MAX_RACERS) return;
        st.racers.push(me);
        if (st.phase === 'playing') {
          // Late joiners crack the same code; their own clock starts now.
          st.boards[me] = freshBoard();
          st.boards[me].startedAt = Date.now();
          st.secrets[me] = st.sharedSecret;
          logEvent(st, st.boards[me].startedAt - st.startedAt, '+', me);
        }
        return done();
      }
      case 'leaveRace': {
        const i = st.racers.indexOf(me);
        if (i === -1) return;
        st.racers.splice(i, 1);
        if (st.phase === 'playing') {
          logEvent(st, Date.now() - st.startedAt, '-', me);
          delete st.boards[me];
          delete st.secrets[me];
          if (!st.racers.length) resetToWaiting(st);
          else maybeFinish(room);
        }
        return done();
      }
      case 'start': {
        // race/coop start (and the "new game" button for every mode).
        if (st.phase === 'playing' || st.phase === 'setting') return;
        if (st.mode === 'duel') {
          if (!(st.players.a && st.players.b)) return;
          if (!seatOf(st, me)) return reject('not_participant');
        } else if (st.mode === 'race') {
          if (!st.racers.includes(me)) return reject('not_participant');
        }
        beginGame(room);
        return done();
      }
      case 'setSecret': {
        if (st.mode !== 'duel' || st.phase !== 'setting') return;
        const seat = seatOf(st, me);
        if (!seat || st.setBy[seat]) return;
        if (!validCode(data.code, st.allowDup)) return reject('bad_code');
        st.secrets[other(seat)] = data.code.slice();
        st.setBy[seat] = true;
        if (st.setBy.a && st.setBy.b) startPlaying(room);
        return done();
      }
      case 'guess': {
        if (st.phase !== 'playing') return reject('not_playing');
        const key = boardKeyFor(st, me);
        if (!key || !st.boards[key]) return reject('not_participant');
        const b = st.boards[key];
        if (b.done) return reject('board_done');
        if (!validCode(data.code, st.allowDup)) return reject(st.allowDup ? 'bad_code' : 'no_dups');
        applyGuess(st, key, data.code, me);
        maybeFinish(room);
        done();
        scheduleBots(room);
        return;
      }
      case 'giveUp': {
        if (st.phase !== 'playing') return;
        const key = boardKeyFor(st, me);
        if (!key || !st.boards[key] || st.boards[key].done) return;
        giveUp(room, key, me);
        return done();
      }
      default:
    }
  },
};
