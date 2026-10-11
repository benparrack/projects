// Dots and Boxes — 2-4 players (ordered seats, seat order = turn order). Players take turns
// drawing one line between two adjacent dots; whoever draws the fourth side of a box claims it
// and must move again. When every box is claimed, most boxes wins (ties share the win).
// Board size (boxes per side: 4, 5 or 6) is picked while waiting.
//
// Bots are seat ids 'bot-<Name>~<level>' (same convention as cardBots.js, so clients can show the
// name and level straight from the id). Levels:
//   easy   — mostly random lines, grabs a free box only some of the time
//   medium — always takes free boxes, never draws a box's 3rd side unless forced
//   hard   — + when forced, sacrifices the smallest possible chain
//   expert — + full endgame chain control: safe-phase search for the long-chain parity battle,
//            loony-endgame values (Berlekamp's chain/cycle recursion) and double-dealing
'use strict';

const { normLevel, LEVELS } = require('./ai/levels');
const { report } = require('../report');
const { frameOf } = require('./boardResult');

const GAME = 'dotsboxes';
const MIN_SEATS = 2;
const MAX_SEATS = 4;
const SIZES = [4, 5, 6];
const DEFAULT_SIZE = 5;
const BOT_NAMES = ['Ace', 'Byte', 'Chip', 'Dot', 'Echo', 'Flux', 'Gizmo'];
const BOT_DELAY_MS = [380, 720];
const BOT_CHAIN_DELAY_MS = [170, 300]; // quicker while sweeping up a chain of boxes

const isBot = (id) => typeof id === 'string' && id.startsWith('bot-');
const levelOfId = (id) => normLevel(String(id).split('~')[1]);

// ---------------------------------------------------------------------------------------------
// Geometry. n = boxes per side. Edges are one flat array:
//   horizontal h(r,c) = r*n + c                 r in 0..n,   c in 0..n-1
//   vertical   v(r,c) = (n+1)*n + r*(n+1) + c   r in 0..n-1, c in 0..n
// Box b = r*n + c. Message coordinates are { o: 'h'|'v', r, c }.

const geoCache = new Map();
function geometry(n) {
  if (geoCache.has(n)) return geoCache.get(n);
  const H = (n + 1) * n;
  const E = 2 * n * (n + 1);
  const hIdx = (r, c) => r * n + c;
  const vIdx = (r, c) => H + r * (n + 1) + c;
  const boxEdges = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) boxEdges.push([hIdx(r, c), hIdx(r + 1, c), vIdx(r, c), vIdx(r, c + 1)]);
  }
  const edgeBoxes = Array.from({ length: E }, () => []);
  boxEdges.forEach((es, b) => es.forEach((e) => edgeBoxes[e].push(b)));
  const g = { n, H, E, B: n * n, hIdx, vIdx, boxEdges, edgeBoxes };
  geoCache.set(n, g);
  return g;
}

function edgeIndex(g, o, r, c) {
  if (!Number.isInteger(r) || !Number.isInteger(c)) return -1;
  if (o === 'h' && r >= 0 && r <= g.n && c >= 0 && c < g.n) return g.hIdx(r, c);
  if (o === 'v' && r >= 0 && r < g.n && c >= 0 && c <= g.n) return g.vIdx(r, c);
  return -1;
}

function edgeCoords(g, e) {
  if (e < g.H) return { o: 'h', r: Math.floor(e / g.n), c: e % g.n };
  const k = e - g.H;
  return { o: 'v', r: Math.floor(k / (g.n + 1)), c: k % (g.n + 1) };
}

// ---------------------------------------------------------------------------------------------
// Engine (pure; `edges` is an array/Uint8Array of 0/1).

const sidesOf = (g, edges, b) => {
  const es = g.boxEdges[b];
  return edges[es[0]] + edges[es[1]] + edges[es[2]] + edges[es[3]];
};

// Boxes that drawing edge e would complete.
function completes(g, edges, e) {
  let k = 0;
  for (const b of g.edgeBoxes[e]) if (sidesOf(g, edges, b) === 3) k++;
  return k;
}

function undrawn(g, edges) {
  const out = [];
  for (let e = 0; e < g.E; e++) if (!edges[e]) out.push(e);
  return out;
}

const capturingEdges = (g, edges) => undrawn(g, edges).filter((e) => completes(g, edges, e) > 0);
// Safe = gives the opponent nothing: every adjacent box has at most 1 side before the move.
const safeEdges = (g, edges) => undrawn(g, edges).filter((e) => g.edgeBoxes[e].every((b) => sidesOf(g, edges, b) <= 1));

// The undrawn edge of a 3-sided box.
const lastEdgeOf = (g, edges, b) => g.boxEdges[b].find((e) => !edges[e]);
// The box on the other side of edge e from box b (-1 = board border).
const across = (g, e, b) => { const bs = g.edgeBoxes[e]; return bs.length === 2 ? (bs[0] === b ? bs[1] : bs[0]) : -1; };

// Takes every box that can be taken in sequence; returns { taken, edges } (edges is a copy).
function greedyCapture(g, edges) {
  const ed = Uint8Array.from(edges);
  let taken = 0;
  for (;;) {
    const caps = capturingEdges(g, ed);
    if (!caps.length) return { taken, edges: ed };
    for (const e of caps) {
      if (ed[e]) continue;
      taken += completes(g, ed, e);
      ed[e] = 1;
    }
  }
}

// Boxes handed to the opponent by drawing e (they then sweep everything they can).
function giveaway(g, edges, e) {
  const ed = Uint8Array.from(edges);
  ed[e] = 1;
  return greedyCapture(g, ed).taken;
}

// Decompose a loony position into chains and cycles. Boxes with exactly 2 sides drawn link up
// through their undrawn edges; a run ends at the border or at a "junction" box (≤1 side drawn).
// Returns [{ len, cycle, boxes: [ordered], ends: [edge at each end] }].
function components(g, edges) {
  const sides = new Array(g.B);
  for (let b = 0; b < g.B; b++) sides[b] = sidesOf(g, edges, b);
  const seen = new Uint8Array(g.B);
  const out = [];
  const isLink = (b) => b >= 0 && sides[b] === 2;
  for (let b0 = 0; b0 < g.B; b0++) {
    if (seen[b0] || sides[b0] !== 2) continue;
    // Walk both directions from b0.
    const [e1, e2] = g.boxEdges[b0].filter((e) => !edges[e]);
    seen[b0] = 1;
    const walk = (fromBox, viaEdge) => {
      const path = [];
      let prev = fromBox;
      let e = viaEdge;
      for (;;) {
        const nb = across(g, e, prev);
        if (!isLink(nb) || seen[nb]) return { path, end: e, closed: nb === b0 && path.length > 0 };
        seen[nb] = 1;
        path.push(nb);
        const nextE = g.boxEdges[nb].find((x) => !edges[x] && x !== e);
        prev = nb;
        e = nextE;
      }
    };
    const a = walk(b0, e1);
    if (a.closed) {
      out.push({ len: a.path.length + 1, cycle: true, boxes: [b0, ...a.path], ends: [e1, e1] });
      continue;
    }
    const c = walk(b0, e2);
    const boxes = [...a.path.reverse(), b0, ...c.path];
    out.push({ len: boxes.length, cycle: false, boxes, ends: [a.end, c.end] });
  }
  return out;
}

// Value to the CONTROLLER (the player who does not have to move) of a loony endgame made of
// these components, when the mover must open one of them. The mover's net is -f.
//   opened chain of 1 or 2 (2 opened hard-heartedly, in the middle): L - f(rest)
//   chain of 3+ : max(take all: L - f(rest), double-deal: L - 4 + f(rest))
//   cycle of 4+ : max(L - f(rest), L - 8 + f(rest))
function controlValue(comps, memo = new Map()) {
  if (!comps.length) return 0;
  const key = comps.map((c) => (c.cycle ? 'c' : 'p') + c.len).sort().join(',');
  if (memo.has(key)) return memo.get(key);
  let best = Infinity;
  const tried = new Set();
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    const ck = (c.cycle ? 'c' : 'p') + c.len;
    if (tried.has(ck)) continue;
    tried.add(ck);
    const rest = comps.slice(0, i).concat(comps.slice(i + 1));
    const fr = controlValue(rest, memo);
    const v = openValue(c, fr);
    if (v < best) best = v;
  }
  memo.set(key, best);
  return best;
}
function openValue(c, fr) {
  const L = c.len;
  if (c.cycle) return L >= 4 ? Math.max(L - fr, L - 8 + fr) : L - fr;
  if (L <= 2) return L - fr;
  return Math.max(L - fr, L - 4 + fr);
}

// The edge that opens component c as cheaply as possible for the mover.
function openingEdge(g, edges, c) {
  if (c.cycle) return g.boxEdges[c.boxes[0]].find((e) => !edges[e]);
  if (c.len === 2) {
    // Hard-hearted handout: the line between the two boxes, so no double-deal is possible.
    const shared = g.boxEdges[c.boxes[0]].find((e) => !edges[e] && g.edgeBoxes[e].includes(c.boxes[1]));
    if (shared != null) return shared;
  }
  return c.ends.find((e) => e != null && !edges[e]);
}

const loonyValueForMover = (g, edges) => -controlValue(components(g, edges));

// When only a "domino" (2 boxes ending a chain) or a 4-box cycle remnant is left to take, the
// line that declines it and hands it over (double-dealing). Returns { e, given, boxes } or null.
function doubleDealOption(g, edges) {
  const caps3 = [];
  for (let b = 0; b < g.B; b++) if (sidesOf(g, edges, b) === 3) caps3.push(b);
  for (const b of caps3) {
    const e = lastEdgeOf(g, edges, b);
    const n1 = across(g, e, b);
    if (n1 < 0 || sidesOf(g, edges, n1) !== 2) continue;
    const e2 = g.boxEdges[n1].find((x) => !edges[x] && x !== e);
    const n2 = across(g, e2, n1);
    // Chain end: b(3 sides) – n1(2 sides) – border/junction. Declining = drawing e2.
    // (A junction n2 with ≤1 side only goes up to 2 — nothing extra is given away.)
    if (n2 < 0 || sidesOf(g, edges, n2) <= 1) return { e: e2, given: 2, boxes: [b, n1] };
    // Cycle remnant: b(3) – n1(2) – n2(2) – b2(3), b2's only undrawn edge back to n2.
    if (sidesOf(g, edges, n2) === 2) {
      const e3 = g.boxEdges[n2].find((x) => !edges[x] && x !== e2);
      const b2 = across(g, e3, n2);
      if (b2 >= 0 && b2 !== b && sidesOf(g, edges, b2) === 3 && lastEdgeOf(g, edges, b2) === e3) {
        return { e: e2, given: 4, boxes: [b, n1, n2, b2] };
      }
    }
  }
  return null;
}

const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

// Safe-phase negamax: value (net boxes from here, to the player to move) when both sides only
// play safe lines until none are left, then the loony endgame is scored by controlValue.
function safeSearch(g, edges, budget) {
  const memo = new Map();
  let nodes = 0;
  const rec = (ed) => {
    if (++nodes > budget.max) throw new Error('budget');
    const key = Buffer.from(ed).toString('latin1');
    if (memo.has(key)) return memo.get(key);
    const safe = safeEdges(g, ed);
    let v;
    if (!safe.length) v = loonyValueForMover(g, ed);
    else {
      v = -Infinity;
      for (const e of safe) {
        ed[e] = 1;
        const x = -rec(ed);
        ed[e] = 0;
        if (x > v) v = x;
      }
    }
    memo.set(key, v);
    return v;
  };
  const ed = Uint8Array.from(edges);
  const safe = safeEdges(g, ed);
  let best = [];
  let bestV = -Infinity;
  for (const e of safe) {
    ed[e] = 1;
    const v = -rec(ed);
    ed[e] = 0;
    if (v > bestV) { bestV = v; best = [e]; } else if (v === bestV) best.push(e);
  }
  return { edges: best, value: bestV };
}

const SAFE_SEARCH_AT = 12; // search the parity battle once this few safe lines remain
const SAFE_SEARCH_NODES = 40000;

// Pick a line for a bot. Returns an edge index.
function chooseMove(g, edges, level) {
  const free = undrawn(g, edges);
  if (!free.length) return -1;
  const caps = capturingEdges(g, edges);
  const safe = safeEdges(g, edges);

  if (level === 'easy') {
    if (caps.length && Math.random() < 0.55) return pick(caps);
    if (safe.length && Math.random() < 0.5) return pick(safe);
    return pick(free);
  }

  if (level === 'medium' || level === 'hard') {
    if (caps.length) return pick(caps);
    if (safe.length) return pick(safe);
    if (level === 'medium') return pick(free);
    return minGiveaway(g, edges, free);
  }

  // expert
  if (caps.length) {
    const after = greedyCapture(g, edges);
    if (safeEdges(g, after.edges).length) return pick(caps);
    const dd = doubleDealOption(g, edges);
    if (dd) {
      if (giveaway(g, edges, dd.e) === dd.given) {
        // Only the declinable structure is left to take. Compare taking it (then we must open
        // something) with handing it over (then they must).
        const ed2 = Uint8Array.from(edges);
        ed2[dd.e] = 1;
        const fr = controlValue(components(g, greedyCapture(g, ed2).edges));
        if (-dd.given + fr > dd.given - fr) return dd.e;
      } else {
        // Other free boxes are still on the board — take those first, keep the option open.
        const outside = caps.filter((e) => !g.edgeBoxes[e].some((b) => dd.boxes.includes(b)));
        if (outside.length) return outside[0];
      }
    }
    return pick(caps);
  }
  if (safe.length) {
    if (safe.length <= SAFE_SEARCH_AT) {
      try {
        const r = safeSearch(g, edges, { max: SAFE_SEARCH_NODES });
        if (r.edges.length) return pick(r.edges);
      } catch { /* over budget — fall through */ }
    }
    return pick(safe);
  }
  // Loony: open the component that costs least, the right way.
  const comps = components(g, edges);
  let bestE = null;
  let bestV = Infinity;
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    const e = openingEdge(g, edges, c);
    if (e == null || edges[e]) continue;
    const rest = comps.slice(0, i).concat(comps.slice(i + 1));
    const v = openValue(c, controlValue(rest));
    if (v < bestV) { bestV = v; bestE = e; }
  }
  if (bestE != null) return bestE;
  return minGiveaway(g, edges, free);
}

function minGiveaway(g, edges, free) {
  let best = [];
  let bestK = Infinity;
  for (const e of free) {
    const k = giveaway(g, edges, e);
    if (k < bestK) { bestK = k; best = [e]; } else if (k === bestK) best.push(e);
  }
  return pick(best);
}

// Applies a line for the seat at turnIdx. Returns number of boxes completed (or -1 if illegal).
function applyLine(st, e) {
  const g = geometry(st.size);
  if (e < 0 || e >= g.E || st.edges[e]) return -1;
  st.edges[e] = 1;
  st.edgeOwner[e] = st.turnIdx;
  let made = 0;
  for (const b of g.edgeBoxes[e]) {
    if (st.boxes[b] == null && sidesOf(g, st.edges, b) === 4) {
      st.boxes[b] = st.turnIdx;
      made++;
    }
  }
  st.scores[st.turnIdx] += made;
  st.lastLine = { ...edgeCoords(g, e), seat: st.turnIdx, made };
  st.moveCount++;
  if (st.boxes.every((x) => x != null)) {
    st.phase = 'game_over';
    const top = Math.max(...st.scores);
    st.winners = st.scores.map((s, i) => (s === top ? i : -1)).filter((i) => i >= 0);
  } else if (!made) {
    st.turnIdx = (st.turnIdx + 1) % st.seats.length;
  }
  return made;
}

// ---------------------------------------------------------------------------------------------
// Room plumbing.

function newBoard(st) {
  const g = geometry(st.size);
  st.edges = new Array(g.E).fill(0);
  st.edgeOwner = new Array(g.E).fill(null);
  st.boxes = new Array(g.B).fill(null);
  st.scores = st.seats.map(() => 0);
  st.lastLine = null;
  st.winners = [];
  st.moveCount = 0;
  st.gen++;
  // Replay: [{ size, seats, first }, ...edge indices]; filled in by startGame.
  st.moves = null;
  st.reported = false;
}

function startGame(st) {
  newBoard(st);
  st.turnIdx = st.nextStarter % st.seats.length;
  st.nextStarter = (st.nextStarter + 1) % Math.max(1, st.seats.length);
  st.phase = 'playing';
  st.note = null;
  st.moves = [{ size: st.size, seats: st.seats.slice(), first: st.turnIdx }];
}

// The room-level move path (humans and bots): applyLine plus replay recording and, on the last
// box, the end-of-match report — places by box count (ties share), bots reported as 'BOT' (a seat
// a bot took over mid-game counts as the bot's), botLevel = the strongest bot at the table.
function playLine(room, e) {
  const st = room.state;
  const made = applyLine(st, e);
  if (made < 0) return made;
  if (st.moves) st.moves.push(e);
  if (st.phase === 'game_over' && !st.reported) {
    st.reported = true;
    const id = (i) => (isBot(st.seats[i]) ? 'BOT' : st.seats[i]);
    const byScore = [...new Set(st.scores)].sort((a, b) => b - a);
    const result = {
      placements: byScore.map((sc) => st.seats.map((_, i) => i).filter((i) => st.scores[i] === sc).map(id)),
      scores: Object.fromEntries(st.seats.map((_, i) => [id(i), st.scores[i]])),
      replay: st.moves,
    };
    const bots = st.seats.filter(isBot).map((b) => LEVELS.indexOf(levelOfId(b)));
    if (bots.length) result.botLevel = LEVELS[Math.max(...bots)];
    report(room, result);
  }
  return made;
}

function toWaiting(st) {
  st.phase = 'waiting';
  st.turnIdx = 0;
  newBoard(st);
}

function buildPublicState(room) {
  const st = room.state;
  const g = geometry(st.size);
  const lines = [];
  for (let e = 0; e < g.E; e++) if (st.edges[e]) lines.push({ ...edgeCoords(g, e), seat: st.edgeOwner[e] });
  return {
    phase: st.phase,
    seats: st.seats,
    size: st.size,
    lines,
    boxes: st.boxes,
    scores: st.scores,
    turnIdx: st.turnIdx,
    lastLine: st.lastLine,
    winners: st.winners,
    moveCount: st.moveCount,
    note: st.note,
  };
}

function broadcastState(room) {
  room.broadcast({ v: 1, type: 'game.event', payload: { gameType: GAME, data: { kind: 'state', ...buildPublicState(room) } } });
}

function clearBotTimer(room) {
  if (room._dbBotTimer) clearTimeout(room._dbBotTimer);
  room._dbBotTimer = null;
}

function maybeScheduleBot(room) {
  const st = room.state;
  if (st.phase !== 'playing' || !isBot(st.seats[st.turnIdx]) || room._dbBotTimer) return;
  const gen = st.gen;
  const moveCount = st.moveCount;
  const id = st.seats[st.turnIdx];
  const chain = st.lastLine && st.lastLine.made > 0 && st.lastLine.seat === st.turnIdx;
  const [lo, hi] = chain ? BOT_CHAIN_DELAY_MS : BOT_DELAY_MS;
  room._dbBotTimer = setTimeout(() => {
    room._dbBotTimer = null;
    const s = room.state;
    if (s.gen !== gen || s.moveCount !== moveCount || s.phase !== 'playing' || s.seats[s.turnIdx] !== id) return;
    if (room.clients && room.clients.size === 0) return; // nobody watching: pause
    const g = geometry(s.size);
    let e = chooseMove(g, s.edges, levelOfId(id));
    if (e < 0 || s.edges[e]) e = undrawn(g, s.edges)[0];
    if (e == null) return;
    playLine(room, e);
    broadcastState(room);
    maybeScheduleBot(room);
  }, lo + Math.random() * (hi - lo));
}

function newBotId(st, level) {
  const used = new Set(st.seats.filter(isBot).map((id) => id.slice(4).split('~')[0]));
  const name = BOT_NAMES.find((n) => !used.has(n)) || `Bot${st.seats.length + 1}`;
  return `bot-${name}~${normLevel(level)}`;
}

const humansSeated = (st) => st.seats.some((id) => !isBot(id));

// A seat empties (leaveSeat or disconnect). Mid-game with another human still seated, a Medium
// bot takes over that seat so the game can finish; otherwise the table goes back to waiting.
function vacate(room, clientId, nickname) {
  const st = room.state;
  const idx = st.seats.indexOf(clientId);
  if (idx === -1) return false;
  if (st.phase === 'playing') {
    const others = st.seats.filter((id, i) => i !== idx && !isBot(id));
    if (others.length) {
      st.seats[idx] = newBotId(st, 'medium');
      st.note = `${nickname || 'A player'} left — a bot took over their seat`;
      clearBotTimer(room);
      return true;
    }
  }
  st.seats.splice(idx, 1);
  if (!humansSeated(st)) st.seats = [];
  clearBotTimer(room);
  st.note = null;
  if (st.phase !== 'waiting' || st.seats.length < MIN_SEATS) toWaiting(st);
  else newBoard(st);
  return true;
}

module.exports = {
  type: GAME,

  createInitialState() {
    const st = { phase: 'waiting', seats: [], size: DEFAULT_SIZE, turnIdx: 0, nextStarter: 0, gen: 0, note: null };
    newBoard(st);
    return st;
  },

  isRoomFull(room) {
    return room.state.seats.length >= MAX_SEATS;
  },

  serializeSnapshot(room) {
    return buildPublicState(room);
  },

  stats: { rated: true },
  score: { label: 'BOXES', better: 'high', format: 'int' },

  // Re-plays [{ size, seats, first }, ...edges] on a fresh board; one spectator snapshot per
  // position.
  replayFrames(replay) {
    const [setup, ...edges] = replay;
    const room = { state: module.exports.createInitialState() };
    const st = room.state;
    st.size = setup.size;
    st.seats = setup.seats.slice();
    st.nextStarter = setup.first;
    startGame(st);
    const frames = [frameOf(buildPublicState(room))];
    for (const e of edges) {
      if (playLine(room, e) < 0) break;
      frames.push(frameOf(buildPublicState(room)));
    }
    return frames;
  },

  onLeave(room, client) {
    if (vacate(room, client.clientId, client.nickname)) {
      broadcastState(room);
      maybeScheduleBot(room);
    }
  },

  onMessage(room, client, data, ctx) {
    if (!data || typeof data.kind !== 'string') return;
    const st = room.state;
    const me = ctx.senderId;
    const seated = st.seats.includes(me);
    const reject = (reason) => ctx.sendTo(me, { v: 1, type: 'game.event', payload: { gameType: GAME, data: { kind: 'moveRejected', reason } } });

    switch (data.kind) {
      case 'sit': {
        if (st.phase !== 'waiting' || seated || st.seats.length >= MAX_SEATS) return;
        st.seats.push(me);
        newBoard(st);
        break;
      }
      case 'leaveSeat': {
        if (!vacate(room, me, client && client.nickname)) return;
        break;
      }
      case 'addBot': {
        if (st.phase !== 'waiting' || st.seats.length >= MAX_SEATS) return;
        if (!seated) return; // only someone at the table can invite bots
        st.seats.push(newBotId(st, data.level));
        newBoard(st);
        break;
      }
      case 'removeBot': {
        const i = Number(data.seat);
        if (st.phase === 'playing' || !Number.isInteger(i) || !isBot(st.seats[i])) return;
        st.seats.splice(i, 1);
        if (!humansSeated(st)) st.seats = [];
        toWaiting(st);
        break;
      }
      case 'setBotLevel': {
        const i = Number(data.seat);
        if (!Number.isInteger(i) || !isBot(st.seats[i])) return;
        st.seats[i] = `${st.seats[i].split('~')[0]}~${normLevel(data.level)}`;
        if (st.phase === 'playing') clearBotTimer(room);
        break;
      }
      case 'setSize': {
        const n = Number(data.size);
        if (st.phase !== 'waiting' || !seated || !SIZES.includes(n)) return;
        st.size = n;
        newBoard(st);
        break;
      }
      case 'startGame': {
        if (st.phase !== 'waiting' || !seated || st.seats.length < MIN_SEATS) return;
        clearBotTimer(room);
        startGame(st);
        break;
      }
      case 'resetGame': {
        if (st.phase !== 'game_over' || !seated) return;
        clearBotTimer(room);
        if (st.seats.length >= MIN_SEATS) startGame(st);
        else toWaiting(st);
        break;
      }
      case 'move': {
        if (st.phase !== 'playing') return;
        const idx = st.seats.indexOf(me);
        if (idx === -1) return reject('not_seated');
        if (idx !== st.turnIdx) return reject('not_your_turn');
        const g = geometry(st.size);
        const e = edgeIndex(g, data.o, Number(data.r), Number(data.c));
        if (e === -1) return reject('invalid');
        if (st.edges[e]) return reject('taken');
        playLine(room, e);
        break;
      }
      default:
        return;
    }
    broadcastState(room);
    maybeScheduleBot(room);
  },

  // Exposed for tests.
  _internal: {
    geometry, edgeIndex, edgeCoords, sidesOf, capturingEdges, safeEdges, greedyCapture, giveaway,
    components, controlValue, chooseMove, doubleDealOption, applyLine, SIZES,
  },
};
