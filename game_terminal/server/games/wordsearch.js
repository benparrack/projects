// Word Search: a multiplayer find-the-words race. Everyone in the room shares ONE generated grid
// (10x10 / 12x12 / 15x15) hiding 8-15 everyday words in all 8 directions. Drag from a word's first
// letter to its last; the first player to find a word claims it (their colour, their name on the
// list) and scores points that grow with its length. The round ends when every word is claimed or
// the clock runs out. Event-driven (no tick loop), like Maze Dash.
//
// Generation guarantees every target word appears in the grid EXACTLY once (filler letters are
// re-rolled until no word shows up a second time, forwards or backwards), so a claim can be
// checked purely by its letters + cells. Unfound words' positions are never sent to clients until
// the round is over.

'use strict';

const { COMMON, isWord } = require('./words');
const { isBotId, newBot, dropBotsIfAlone } = require('./tickBots');
const { reportRanked } = require('./wordResults');

const TYPE = 'wordsearch';
const SIZES = {
  10: { words: 9, minLen: 3, maxLen: 8, timeMs: 4 * 60 * 1000 },
  12: { words: 12, minLen: 3, maxLen: 10, timeMs: 5 * 60 * 1000 },
  15: { words: 15, minLen: 4, maxLen: 12, timeMs: 7 * 60 * 1000 },
};
const DEFAULT_SIZE = 12;
const COUNTDOWN_MS = 3000;
const COLOR_PALETTE = ['#00eaff', '#ff2fb0', '#39ff14', '#ffb000', '#8c52ff', '#ff4d4d', '#ffee58', '#00ffa2'];

// Everyday-word themes (each word is also checked against the shared dictionary at load, so a
// typo here can't sneak into a puzzle). 'surprise' picks a theme per round, 'random' draws plain
// everyday words from words.js COMMON instead.
const THEMES = {
  animals: ['tiger', 'zebra', 'giraffe', 'monkey', 'rabbit', 'turtle', 'dolphin', 'penguin', 'koala', 'panda', 'eagle', 'parrot', 'lizard', 'camel', 'horse', 'moose', 'otter', 'beaver', 'badger', 'ferret', 'hamster', 'lion', 'wolf', 'bear', 'deer', 'goat', 'sheep', 'mouse', 'squirrel', 'elephant', 'kangaroo', 'cheetah', 'leopard', 'gorilla', 'hippo', 'raccoon', 'skunk', 'donkey', 'llama', 'buffalo'],
  food: ['pizza', 'pasta', 'burger', 'salad', 'bread', 'cheese', 'butter', 'apple', 'banana', 'cherry', 'grape', 'lemon', 'mango', 'orange', 'peach', 'carrot', 'potato', 'tomato', 'onion', 'garlic', 'pepper', 'cookie', 'muffin', 'pancake', 'waffle', 'noodle', 'taco', 'burrito', 'sushi', 'bacon', 'honey', 'yogurt', 'cereal', 'donut', 'pickle', 'popcorn', 'sandwich', 'chicken', 'steak', 'soup'],
  sports: ['soccer', 'tennis', 'hockey', 'golf', 'rugby', 'boxing', 'karate', 'skiing', 'surfing', 'rowing', 'cycling', 'archery', 'bowling', 'cricket', 'baseball', 'football', 'swimming', 'running', 'diving', 'sailing', 'fencing', 'judo', 'wrestling', 'skating', 'climbing', 'volleyball', 'polo', 'darts', 'squash', 'badminton', 'goal', 'referee', 'trophy', 'medal', 'stadium', 'coach', 'team', 'score'],
  space: ['planet', 'comet', 'galaxy', 'nebula', 'orbit', 'rocket', 'moon', 'star', 'meteor', 'asteroid', 'saturn', 'jupiter', 'mars', 'venus', 'mercury', 'neptune', 'uranus', 'pluto', 'eclipse', 'gravity', 'cosmos', 'shuttle', 'alien', 'crater', 'telescope', 'satellite', 'astronaut', 'universe', 'quasar', 'pulsar', 'solar', 'lunar', 'launch', 'capsule', 'station'],
  ocean: ['whale', 'shark', 'squid', 'coral', 'reef', 'wave', 'tide', 'shell', 'crab', 'lobster', 'oyster', 'clam', 'seal', 'walrus', 'starfish', 'jellyfish', 'octopus', 'anchor', 'harbor', 'island', 'beach', 'sand', 'kelp', 'salmon', 'tuna', 'pearl', 'sailor', 'current', 'lagoon', 'shrimp', 'turtle', 'dolphin', 'diver', 'boat', 'ship', 'buoy', 'surf', 'gull'],
  weather: ['rain', 'snow', 'hail', 'sleet', 'storm', 'thunder', 'lightning', 'cloud', 'wind', 'breeze', 'tornado', 'hurricane', 'cyclone', 'fog', 'mist', 'frost', 'drizzle', 'sunny', 'rainbow', 'climate', 'forecast', 'humid', 'chilly', 'blizzard', 'drought', 'flood', 'thermometer', 'umbrella', 'puddle', 'icicle', 'gust', 'heat', 'cold', 'warm', 'shower', 'monsoon'],
  music: ['guitar', 'piano', 'drums', 'violin', 'cello', 'flute', 'trumpet', 'trombone', 'tuba', 'harp', 'banjo', 'ukulele', 'melody', 'rhythm', 'chorus', 'verse', 'song', 'band', 'concert', 'singer', 'tempo', 'note', 'chord', 'opera', 'jazz', 'blues', 'rock', 'piano', 'radio', 'album', 'lyrics', 'harmony', 'beat', 'bass', 'organ', 'clarinet', 'saxophone', 'microphone'],
  nature: ['forest', 'river', 'mountain', 'valley', 'meadow', 'desert', 'canyon', 'glacier', 'volcano', 'jungle', 'lake', 'pond', 'stream', 'waterfall', 'tree', 'flower', 'grass', 'leaf', 'branch', 'root', 'seed', 'moss', 'fern', 'rock', 'stone', 'pebble', 'cliff', 'hill', 'cave', 'island', 'prairie', 'swamp', 'marsh', 'oak', 'pine', 'maple', 'willow', 'birch'],
  jobs: ['doctor', 'nurse', 'teacher', 'farmer', 'pilot', 'chef', 'baker', 'artist', 'writer', 'lawyer', 'judge', 'dentist', 'plumber', 'carpenter', 'painter', 'police', 'firefighter', 'soldier', 'sailor', 'driver', 'banker', 'singer', 'actor', 'dancer', 'engineer', 'scientist', 'barber', 'butcher', 'tailor', 'waiter', 'cashier', 'mechanic', 'electrician', 'architect', 'author', 'coach', 'vet'],
  home: ['kitchen', 'bedroom', 'bathroom', 'garage', 'garden', 'window', 'door', 'roof', 'chimney', 'stairs', 'table', 'chair', 'sofa', 'couch', 'pillow', 'blanket', 'lamp', 'mirror', 'carpet', 'curtain', 'shelf', 'closet', 'oven', 'fridge', 'sink', 'shower', 'toilet', 'basement', 'attic', 'porch', 'fence', 'mailbox', 'bed', 'desk', 'clock', 'drawer', 'cupboard', 'kettle'],
  travel: ['airport', 'ticket', 'passport', 'luggage', 'suitcase', 'hotel', 'beach', 'cruise', 'train', 'plane', 'taxi', 'subway', 'map', 'compass', 'journey', 'voyage', 'tourist', 'camera', 'museum', 'castle', 'island', 'resort', 'border', 'visa', 'flight', 'pilot', 'route', 'highway', 'bridge', 'tunnel', 'station', 'hostel', 'backpack', 'souvenir', 'postcard', 'guide'],
  colors: ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'black', 'white', 'gray', 'silver', 'gold', 'violet', 'indigo', 'crimson', 'scarlet', 'maroon', 'navy', 'teal', 'turquoise', 'lime', 'olive', 'beige', 'ivory', 'lavender', 'magenta', 'cyan', 'amber', 'coral', 'peach', 'mint', 'ruby', 'emerald', 'bronze', 'copper'],
};
const THEME_LABELS = {
  surprise: 'Surprise me', random: 'Random words', animals: 'Animals', food: 'Food', sports: 'Sports',
  space: 'Space', ocean: 'Ocean', weather: 'Weather', music: 'Music', nature: 'Nature', jobs: 'Jobs',
  home: 'Around the house', travel: 'Travel', colors: 'Colors',
};
for (const k of Object.keys(THEMES)) THEMES[k] = [...new Set(THEMES[k].filter((w) => isWord(w)))];

// Plain everyday words for 'random': skip the first few hundred (the, and, with...) which make
// dull, short targets, and anything that looks like web boilerplate.
const RANDOM_POOL = COMMON.slice(250, 4500).filter((w) => w.length >= 4 && w.length <= 12);

// 8 directions; on the small grid backwards/upwards words are rarer (gentler for beginners).
const DIRS = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]];
const FORWARD = new Set(['0,1', '1,0', '1,1', '-1,1']);

// English letter frequency for filler, so the grid looks like real text rather than X/Q/Z noise.
const FREQ = 'eeeeeeeeeeeetttttttttaaaaaaaaooooooooiiiiiiinnnnnnnsssssshhhhhhrrrrrrddddlllluuummmwwffggyyppbbvkjxqz';

function shuffle(arr, rand = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const reverse = (w) => w.split('').reverse().join('');

// Every (r, c, dr, dc) at which `word` reads in the grid, in any of the 8 directions.
function findAll(grid, word) {
  const n = grid.length;
  const hits = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (grid[r][c] !== word[0]) continue;
      for (const [dr, dc] of DIRS) {
        const er = r + dr * (word.length - 1);
        const ec = c + dc * (word.length - 1);
        if (er < 0 || er >= n || ec < 0 || ec >= n) continue;
        let ok = true;
        for (let i = 1; i < word.length && ok; i++) if (grid[r + dr * i][c + dc * i] !== word[i]) ok = false;
        if (ok) hits.push({ r, c, dr, dc });
      }
    }
  }
  return hits;
}

function cellsOf(p, len) {
  const out = [];
  for (let i = 0; i < len; i++) out.push([p.r + p.dr * i, p.c + p.dc * i]);
  return out;
}

// Picks the target words: distinct, no palindromes (they'd read twice from one placement) and no
// word contained in another forwards or backwards (CAR inside CART would be found twice).
function pickWords(theme, size, rand) {
  const cfg = SIZES[size];
  const pool = theme === 'random' ? RANDOM_POOL : THEMES[theme];
  const cands = shuffle(pool.filter((w) => w.length >= cfg.minLen && w.length <= Math.min(cfg.maxLen, size)), rand);
  // Bias toward a nice spread of lengths: take long words first, then fill with any.
  cands.sort((a, b) => (b.length >= 6) - (a.length >= 6));
  const chosen = [];
  for (const w of cands) {
    if (chosen.length >= cfg.words) break;
    if (w === reverse(w)) continue;
    const clash = chosen.some((o) => o.includes(w) || w.includes(o) || o.includes(reverse(w)) || w.includes(reverse(o)));
    if (!clash) chosen.push(w);
  }
  return shuffle(chosen, rand);
}

// Places the words (longest first, preferring spots that cross an existing letter) and fills the
// rest, re-rolling filler until every word occurs exactly once. Returns null on a dead end so the
// caller can retry with fresh randomness.
function tryBuild(words, size, rand) {
  const grid = Array.from({ length: size }, () => Array(size).fill(null));
  const fixed = Array.from({ length: size }, () => Array(size).fill(false));
  const placed = [];
  const order = words.slice().sort((a, b) => b.length - a.length);
  for (const word of order) {
    const options = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        for (const [dr, dc] of DIRS) {
          const er = r + dr * (word.length - 1);
          const ec = c + dc * (word.length - 1);
          if (er < 0 || er >= size || ec < 0 || ec >= size) continue;
          let overlap = 0;
          let ok = true;
          for (let i = 0; i < word.length; i++) {
            const ch = grid[r + dr * i][c + dc * i];
            if (ch === null) continue;
            if (ch !== word[i]) { ok = false; break; }
            overlap++;
          }
          if (!ok || overlap === word.length) continue;
          const fwd = FORWARD.has(`${dr},${dc}`);
          const w = (size <= 10 ? (fwd ? 3 : 1) : (fwd ? 1.4 : 1)) * (1 + overlap * 2);
          options.push({ r, c, dr, dc, w });
        }
      }
    }
    if (!options.length) return null;
    let total = options.reduce((s, o) => s + o.w, 0) * rand();
    let pick = options[options.length - 1];
    for (const o of options) { total -= o.w; if (total <= 0) { pick = o; break; } }
    for (let i = 0; i < word.length; i++) {
      grid[pick.r + pick.dr * i][pick.c + pick.dc * i] = word[i];
      fixed[pick.r + pick.dr * i][pick.c + pick.dc * i] = true;
    }
    placed.push({ word, r: pick.r, c: pick.c, dr: pick.dr, dc: pick.dc });
  }
  const rollFiller = (r, c) => { grid[r][c] = FREQ[Math.floor(rand() * FREQ.length)]; };
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!fixed[r][c]) rollFiller(r, c);

  for (let pass = 0; pass < 200; pass++) {
    let clean = true;
    for (const p of placed) {
      const hits = findAll(grid, p.word);
      for (const h of hits) {
        if (h.r === p.r && h.c === p.c && h.dr === p.dr && h.dc === p.dc) continue;
        clean = false;
        const free = cellsOf(h, p.word.length).filter(([r, c]) => !fixed[r][c]);
        if (!free.length) return null; // the extra copy is made only of placed letters
        for (const [r, c] of free) rollFiller(r, c);
      }
    }
    if (clean) return { grid: grid.map((row) => row.join('')), placed };
  }
  return null;
}

function generatePuzzle(theme, size, rand = Math.random) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const words = pickWords(theme, size, rand);
    const built = tryBuild(words, size, rand);
    if (built) return built;
  }
  throw new Error('wordsearch: could not generate a puzzle');
}

const pointsFor = (word) => 10 * word.length + 5 * Math.max(0, word.length - 5);

function freshPlayer(clientId, nickname, colorIdx) {
  return { clientId, nickname, color: COLOR_PALETTE[colorIdx % COLOR_PALETTE.length], score: 0, found: 0, wins: 0, bot: null };
}

// --- CPU racers: each picks an unclaimed word and "finds" it after a level-dependent delay that
// grows with grid size and shrinks with word length (long words are easier to spot).
const BOT = {
  easy: { base: 30000, spread: 0.6 },
  medium: { base: 18000, spread: 0.5 },
  hard: { base: 10500, spread: 0.45 },
  expert: { base: 5500, spread: 0.4 },
};

function scheduleBot(room, clientId) {
  const st = room.state;
  const p = st.players.get(clientId);
  if (!p || !p.bot || st.phase !== 'playing') return;
  const lv = BOT[p.bot] || BOT.hard;
  const sizeK = st.size / 12;
  const delay = lv.base * sizeK * (1 - lv.spread / 2 + Math.random() * lv.spread);
  const roundId = st.roundId;
  const wait = Math.max(0, st.startedAt - Date.now()) + delay;
  if (p.botTimer) clearTimeout(p.botTimer);
  p.botTimer = setTimeout(() => {
    p.botTimer = null;
    if (st.roundId !== roundId || st.phase !== 'playing' || !st.players.has(clientId)) return;
    const open = st.words.filter((w) => !w.foundBy);
    if (!open.length) return;
    // Long words are spotted sooner: weight by length.
    let t = open.reduce((s, w) => s + w.word.length, 0) * Math.random();
    let target = open[0];
    for (const w of open) { t -= w.word.length; if (t <= 0) { target = w; break; } }
    claimWord(room, p, target);
    broadcastState(room);
    if (st.phase === 'playing') scheduleBot(room, clientId);
  }, wait);
}

function clearBotTimers(st) {
  for (const p of st.players.values()) {
    if (p.botTimer) { clearTimeout(p.botTimer); p.botTimer = null; }
  }
}

function claimWord(room, p, w) {
  const st = room.state;
  w.foundBy = p.clientId;
  w.foundName = p.nickname;
  w.foundColor = p.color;
  w.foundAt = Date.now() - st.startedAt;
  w.points = pointsFor(w.word);
  p.score += w.points;
  p.found += 1;
  st.lastClaim = { word: w.word, clientId: p.clientId, seq: (st.lastClaim ? st.lastClaim.seq : 0) + 1 };
  if (st.words.every((x) => x.foundBy)) endRound(room, 'all_found');
}

function endRound(room, reason) {
  const st = room.state;
  if (st.phase !== 'playing') return;
  st.phase = 'results';
  st.endReason = reason;
  st.endedAt = Date.now();
  clearTimeout(st.roundTimer);
  st.roundTimer = null;
  clearBotTimers(st);
  const ranked = [...st.players.values()].filter((p) => p.inRound).sort((a, b) => b.score - a.score);
  if (ranked.length) reportRanked(room, ranked.map((p) => ({ id: p.clientId, rank: p.score, score: p.score, level: p.bot })));
  if (ranked.length && ranked[0].score > 0) {
    for (const p of ranked) if (p.score === ranked[0].score) p.wins += 1;
  }
}

function startRound(room, size, theme) {
  const st = room.state;
  st.size = SIZES[size] ? size : DEFAULT_SIZE;
  st.themeChoice = THEME_LABELS[theme] ? theme : 'surprise';
  const keys = Object.keys(THEMES);
  st.theme = st.themeChoice === 'surprise' ? keys[Math.floor(Math.random() * keys.length)] : st.themeChoice;
  const puzzle = generatePuzzle(st.theme, st.size);
  st.grid = puzzle.grid;
  st.words = puzzle.placed.map((p) => ({ ...p, foundBy: null, foundName: null, foundColor: null, foundAt: null, points: 0 }))
    .sort((a, b) => a.word.localeCompare(b.word));
  st.roundId += 1;
  st.phase = 'playing';
  st.startedAt = Date.now() + COUNTDOWN_MS;
  st.endsAt = st.startedAt + SIZES[st.size].timeMs;
  st.endedAt = null;
  st.endReason = null;
  st.lastClaim = null;
  for (const p of st.players.values()) { p.score = 0; p.found = 0; p.inRound = true; }
  clearTimeout(st.roundTimer);
  const roundId = st.roundId;
  st.roundTimer = setTimeout(() => {
    if (st.roundId !== roundId || st.phase !== 'playing') return;
    endRound(room, 'time');
    broadcastState(room);
  }, st.endsAt - Date.now());
  for (const p of st.players.values()) if (p.bot) scheduleBot(room, p.clientId);
}

function buildPublicState(room) {
  const st = room.state;
  const over = st.phase === 'results';
  return {
    kind: 'state',
    phase: st.phase,
    size: st.size,
    themeChoice: st.themeChoice,
    theme: st.theme,
    themeLabel: st.theme ? THEME_LABELS[st.theme] : null,
    themes: THEME_LABELS,
    sizes: Object.keys(SIZES).map(Number),
    roundId: st.roundId,
    grid: st.grid,
    words: (st.words || []).map((w) => ({
      word: w.word,
      len: w.word.length,
      foundBy: w.foundBy,
      foundName: w.foundName,
      foundColor: w.foundColor,
      foundAt: w.foundAt,
      points: w.points,
      // Position only once it's public: claimed, or the round is over (to show what was missed).
      pos: w.foundBy || over ? { r: w.r, c: w.c, dr: w.dr, dc: w.dc } : null,
    })),
    startedAt: st.startedAt,
    endsAt: st.endsAt,
    endedAt: st.endedAt,
    endReason: st.endReason,
    serverNow: Date.now(),
    lastClaim: st.lastClaim,
    players: [...st.players.values()].map((p) => ({
      clientId: p.clientId, nickname: p.nickname, color: p.color, bot: p.bot || undefined,
      score: p.score, found: p.found, wins: p.wins, inRound: !!p.inRound,
    })),
  };
}

function broadcastState(room) {
  const envelope = { v: 1, type: 'game.event', payload: { gameType: TYPE, data: buildPublicState(room) } };
  for (const id of room.clients.keys()) room.sendTo(id, envelope);
}

function reply(ctx, data) {
  ctx.sendTo(ctx.senderId, { v: 1, type: 'game.event', payload: { gameType: TYPE, data } });
}

const isInt = (v) => Number.isInteger(v);

module.exports = {
  type: TYPE,
  stats: { rated: true, score: { label: 'Points', better: 'high', format: 'pts' } },

  createInitialState() {
    return {
      phase: 'waiting', // 'waiting' | 'playing' | 'results'
      size: DEFAULT_SIZE,
      themeChoice: 'surprise',
      theme: null,
      grid: null,
      words: [],
      roundId: 0,
      startedAt: null,
      endsAt: null,
      endedAt: null,
      endReason: null,
      roundTimer: null,
      lastClaim: null,
      nextColorIdx: 0,
      players: new Map(),
    };
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  onJoin(room, client) {
    const st = room.state;
    const p = freshPlayer(client.clientId, client.nickname, st.nextColorIdx++);
    p.bot = client.bot || null;
    // Joining mid-round: you can start finding words straight away.
    p.inRound = st.phase === 'playing';
    st.players.set(client.clientId, p);
    if (p.bot && st.phase === 'playing') scheduleBot(room, p.clientId);
  },

  onLeave(room, client) {
    const st = room.state;
    const p = st.players.get(client.clientId);
    if (p && p.botTimer) clearTimeout(p.botTimer);
    st.players.delete(client.clientId);
    dropBotsIfAlone(st.players);
    if (![...st.players.keys()].some((id) => !isBotId(id))) {
      // Nobody human left: stop the round so no timers keep running for an empty room.
      clearBotTimers(st);
      clearTimeout(st.roundTimer);
      st.roundTimer = null;
      if (st.phase === 'playing') { st.phase = 'waiting'; st.roundId += 1; }
      return;
    }
    broadcastState(room);
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;
    const me = st.players.get(ctx.senderId);
    if (!me) return;

    if (data.kind === 'start') {
      if (st.phase === 'playing') return;
      const size = Number(data.size);
      startRound(room, SIZES[size] ? size : st.size, typeof data.theme === 'string' ? data.theme : st.themeChoice);
      broadcastState(room);
      return;
    }

    if (data.kind === 'addBot') {
      const b = newBot(st.players, data.level);
      if (!b) return;
      module.exports.onJoin(room, { clientId: b.clientId, nickname: b.nickname, bot: b.level });
      broadcastState(room);
      return;
    }
    if (data.kind === 'removeBot') {
      if (!isBotId(data.clientId)) return;
      const b = st.players.get(data.clientId);
      if (!b) return;
      if (b.botTimer) clearTimeout(b.botTimer);
      st.players.delete(data.clientId);
      broadcastState(room);
      return;
    }

    if (data.kind === 'claim') {
      const { r1, c1, r2, c2 } = data;
      if (![r1, c1, r2, c2].every(isInt)) return;
      if (st.phase !== 'playing' || Date.now() < st.startedAt) return reply(ctx, { kind: 'miss', reason: 'not_playing' });
      const n = st.size;
      if ([r1, c1, r2, c2].some((v) => v < 0 || v >= n)) return;
      const dr = Math.sign(r2 - r1);
      const dc = Math.sign(c2 - c1);
      const len = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1)) + 1;
      const straight = r1 === r2 || c1 === c2 || Math.abs(r2 - r1) === Math.abs(c2 - c1);
      if (!straight || len < 2) return reply(ctx, { kind: 'miss', reason: 'not_a_line' });
      let letters = '';
      for (let i = 0; i < len; i++) letters += st.grid[r1 + dr * i][c1 + dc * i];
      // Accept a drag in either direction along the word.
      const w = st.words.find((x) => {
        if (x.word.length !== len) return false;
        const fwd = x.r === r1 && x.c === c1 && x.dr === dr && x.dc === dc;
        const back = x.r === r2 && x.c === c2 && x.dr === -dr && x.dc === -dc;
        return fwd || back;
      });
      if (!w) return reply(ctx, { kind: 'miss', reason: 'not_a_word', letters });
      if (w.foundBy) return reply(ctx, { kind: 'miss', reason: 'taken', word: w.word, by: w.foundName });
      me.inRound = true;
      claimWord(room, me, w);
      broadcastState(room);
      return;
    }
  },

  // Exposed for tests.
  _internals: { generatePuzzle, findAll, pickWords, pointsFor, THEMES, SIZES, BOT },
};
