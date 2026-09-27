// Backgammon engine. Positions are held in the mover's frame: a[1..24] = checkers on each point
// (mine positive, opponent's negative), I move high -> low and bear off past 0, my bar acts like
// point 25. A turn is generated as every full sequence of legs the dice allow (keeping only those
// that use the most dice, as the real rules require), de-duplicated by resulting position, then
// scored by a hand-tuned evaluator (race vs contact: pips, made points, primes, anchors, blot
// exposure counted in real shots out of 36, checkers on the bar vs home-board strength).
// Expert adds a 2-ply look-ahead: the top candidates are re-scored by averaging the opponent's
// best reply over all 21 distinct rolls.

'use strict';

const LEVELS = {
  easy: { noise: 90, random: 0.3, ply2: false },
  medium: { noise: 30, random: 0.05, ply2: false },
  hard: { noise: 0, random: 0, ply2: false },
  expert: { noise: 0, random: 0, ply2: true },
};

// S = { a: Int8Array(26), bar: [mine, opp], off: [mine, opp] }
function clone(S) {
  return { a: Int8Array.from(S.a), bar: [S.bar[0], S.bar[1]], off: [S.off[0], S.off[1]] };
}
function flip(S) {
  const a = new Int8Array(26);
  for (let i = 1; i <= 24; i++) a[i] = -S.a[25 - i];
  return { a, bar: [S.bar[1], S.bar[0]], off: [S.off[1], S.off[0]] };
}
function key(S) {
  return `${S.a.join(',')}|${S.bar[0]},${S.bar[1]}|${S.off[0]}`;
}

function allHome(S) {
  if (S.bar[0]) return false;
  for (let i = 7; i <= 24; i++) if (S.a[i] > 0) return false;
  return true;
}

// Applies one leg in place if legal; returns false otherwise. from 25 = bar.
function leg(S, from, d) {
  const a = S.a;
  if (from === 25) {
    if (!S.bar[0]) return false;
  } else {
    if (S.bar[0] || a[from] <= 0) return false;
  }
  const to = from - d;
  if (to <= 0) {
    if (from === 25 || !allHome(S)) return false;
    if (d !== from) {
      for (let i = from + 1; i <= 6; i++) if (a[i] > 0) return false;
    }
    a[from]--; S.off[0]++;
    return true;
  }
  if (a[to] <= -2) return false;
  if (from === 25) S.bar[0]--; else a[from]--;
  if (a[to] === -1) { a[to] = 0; S.bar[1]++; }
  a[to]++;
  return true;
}

// All end positions for a roll: [{ S, legs: [[from, die], ...] }].
function genTurns(S, dice) {
  const out = new Map();
  let maxLegs = 0;
  const seqs = dice[0] === dice[1] ? [[dice[0], dice[0], dice[0], dice[0]]] : [[dice[0], dice[1]], [dice[1], dice[0]]];
  function rec(cur, rest, legs) {
    let moved = false;
    if (rest.length) {
      const d = rest[0];
      const froms = cur.bar[0] ? [25] : [];
      if (!cur.bar[0]) for (let i = 24; i >= 1; i--) if (cur.a[i] > 0) froms.push(i);
      for (const f of froms) {
        const n = clone(cur);
        if (!leg(n, f, d)) continue;
        moved = true;
        rec(n, rest.slice(1), [...legs, [f, d]]);
      }
    }
    if (!moved) {
      if (legs.length < maxLegs) return;
      if (legs.length > maxLegs) { maxLegs = legs.length; out.clear(); }
      const k = key(cur);
      if (!out.has(k)) out.set(k, { S: cur, legs });
    }
  }
  for (const seq of seqs) rec(S, seq, []);
  let res = [...out.values()].filter((t) => t.legs.length === maxLegs);
  // With only one die playable the higher one must be used when either could be.
  if (maxLegs === 1 && dice[0] !== dice[1]) {
    const hi = Math.max(dice[0], dice[1]);
    if (res.some((t) => t.legs[0][1] === hi)) res = res.filter((t) => t.legs[0][1] === hi);
  }
  return res;
}

// Number of the 36 rolls with which an opponent checker can hit my blot at point i (my frame).
// Opponent checkers sit at j < i (or on their bar, j = 0) and move upward. Blocking by my made
// points is honoured for combination shots.
function shotsAt(S, i) {
  const a = S.a;
  const dists = [];
  for (let j = 0; j < i; j++) {
    if (j === 0 ? S.bar[1] > 0 : a[j] < 0) {
      if (i - j <= 24) dists.push(i - j);
    }
  }
  if (!dists.length) return 0;
  // If the opponent is on the bar only bar checkers can move first; approximate by ignoring.
  let n = 0;
  for (let d1 = 1; d1 <= 6; d1++) {
    for (let d2 = 1; d2 <= 6; d2++) {
      let hit = false;
      for (const d of dists) {
        const from = i - d;
        if (d === d1 || d === d2) { hit = true; break; }
        if (d1 === d2) {
          for (let k = 2; k <= 4 && !hit; k++) {
            if (d !== d1 * k) continue;
            let ok = true;
            for (let s = 1; s < k; s++) if (a[from + d1 * s] >= 2) ok = false;
            if (ok) hit = true;
          }
        } else if (d === d1 + d2 && (a[from + d1] < 2 || a[from + d2] < 2)) hit = true;
        if (hit) break;
      }
      if (hit) n++;
    }
  }
  return n;
}

const HOME_W = [0, 1.0, 1.1, 1.3, 1.5, 1.8, 1.9, 1.6]; // value of owning point i (1..7)

// One side's structural score in its own frame (positive = good for "mine").
function structure(S) {
  const a = S.a;
  let s = 0;
  let run = 0; let bestRun = 0;
  for (let i = 1; i <= 24; i++) {
    if (a[i] >= 2) {
      run++; if (run > bestRun) bestRun = run;
      if (i <= 7) s += HOME_W[i] * 9;
      else if (i <= 12) s += 5;
      else if (i >= 18) s += 7; // anchor in the opponent's home
      else s += 3;
      if (a[i] > 3) s -= (a[i] - 3) * 2.5; // stacking wastes checkers
    } else run = 0;
  }
  s += bestRun >= 3 ? bestRun * bestRun * 3 : 0;
  // Back checkers still trapped behind a long enemy prime are in trouble.
  return s;
}

function homePoints(S) {
  let n = 0;
  for (let i = 1; i <= 6; i++) if (S.a[i] >= 2) n++;
  return n;
}

function pips(S) {
  let p = S.bar[0] * 25;
  for (let i = 1; i <= 24; i++) if (S.a[i] > 0) p += S.a[i] * i;
  return p;
}

// Score of position S (my frame) where I have just moved and the opponent is on roll.
function evaluate(S) {
  const O = flip(S);
  if (S.off[0] === 15) return 100000;
  const myPip = pips(S); const oppPip = pips(O);
  let myBack = S.bar[0] ? 25 : 0; for (let i = 24; i >= 1 && !myBack; i--) if (S.a[i] > 0) myBack = i;
  let oppBack = O.bar[0] ? 25 : 0; for (let i = 24; i >= 1 && !oppBack; i--) if (O.a[i] > 0) oppBack = i;
  const contact = myBack + oppBack > 25;
  if (!contact) {
    // Pure race: pip lead (opponent on roll is worth ~4 pips) plus fewer wasted/unborne checkers.
    let s = (oppPip - myPip - 4) * 6;
    s += (S.off[0] - O.off[0]) * 4;
    for (let i = 1; i <= 6; i++) s -= Math.max(0, S.a[i] - 3) * 1.5;
    return s;
  }
  let s = (oppPip - myPip) * 1.4;
  s += structure(S) - structure(O);
  // Checkers on the bar hurt in proportion to the board they must enter against.
  const myHome = homePoints(S); const oppHome = homePoints(O);
  s += O.bar[0] * (12 + myHome * myHome * 2.2);
  s -= S.bar[0] * (12 + oppHome * oppHome * 2.2);
  if (O.bar[0] && myHome === 6) s += 60; // closed out
  // My blots: the opponent rolls next, so real exposure. Losing a checker costs its progress plus
  // more against a strong enemy board.
  for (let i = 1; i <= 24; i++) {
    if (S.a[i] !== 1) continue;
    const sh = shotsAt(S, i);
    if (!sh) continue;
    s -= (sh / 36) * ((25 - i) * 1.4 + 10 + oppHome * oppHome * 1.8);
  }
  // Opponent blots: they'll often fix them, but they're still a liability for them.
  for (let i = 1; i <= 24; i++) {
    if (O.a[i] !== 1) continue;
    const sh = shotsAt(O, i);
    if (sh) s += (sh / 36) * ((25 - i) * 0.5 + 4);
  }
  return s;
}

function toFrame(input) {
  const me = input.color;
  const a = new Int8Array(26);
  for (let p = 1; p <= 24; p++) {
    const pt = input.points[p];
    if (!pt || !pt.count) continue;
    const i = me === 'white' ? p : 25 - p;
    a[i] = pt.color === me ? pt.count : -pt.count;
  }
  const opp = me === 'white' ? 'black' : 'white';
  return { a, bar: [input.bar[me], input.bar[opp]], off: [input.borneOff[me], input.borneOff[opp]] };
}

const ROLLS = [];
for (let d1 = 1; d1 <= 6; d1++) for (let d2 = d1; d2 <= 6; d2++) ROLLS.push([[d1, d2], d1 === d2 ? 1 : 2]);

// Opponent's expected best reply score (from their view) across all rolls, for position S in my
// frame after my move.
function replyValue(S) {
  const O = flip(S);
  let tot = 0;
  for (const [dice, w] of ROLLS) {
    const turns = genTurns(O, dice);
    let best = -Infinity;
    if (!turns.length) best = -evaluate(S);
    else for (const t of turns) { const v = evaluate(t.S); if (v > best) best = v; }
    tot += best * w;
  }
  return tot / 36;
}

// input: { points, bar, borneOff, color, dice: remaining dice (2 or 4), level }
// returns { legs: [{ from: 'bar'|point, die }] } in server coordinates.
function bestMove(input) {
  const lv = LEVELS[input.level] || LEVELS.hard;
  const S = toFrame(input);
  const d = input.dice;
  const dice = d.length >= 2 ? [d[0], d[1]] : [d[0], d[0]];
  let turns = genTurns(S, dice);
  if (d.length === 1 || d.length === 3) {
    // Mid-turn resume: only the remaining dice.
    turns = [];
    const rest = d.slice();
    const tmp = new Map();
    (function rec(cur, r, legs) {
      let moved = false;
      if (r.length) {
        const froms = cur.bar[0] ? [25] : [];
        if (!cur.bar[0]) for (let i = 24; i >= 1; i--) if (cur.a[i] > 0) froms.push(i);
        for (const f of froms) { const n = clone(cur); if (leg(n, f, r[0])) { moved = true; rec(n, r.slice(1), [...legs, [f, r[0]]]); } }
      }
      if (!moved) tmp.set(key(cur) + legs.length, { S: cur, legs });
    })(S, rest, []);
    const mx = Math.max(...[...tmp.values()].map((t) => t.legs.length));
    turns = [...tmp.values()].filter((t) => t.legs.length === mx);
  }
  if (!turns.length || !turns[0].legs.length) return { legs: [] };
  let pick;
  if (lv.random && Math.random() < lv.random) {
    pick = turns[Math.floor(Math.random() * turns.length)];
  } else {
    for (const t of turns) t.v = evaluate(t.S) + (lv.noise ? (Math.random() * 2 - 1) * lv.noise : 0);
    turns.sort((x, y) => y.v - x.v);
    pick = turns[0];
    if (lv.ply2 && turns.length > 1) {
      let best = -Infinity;
      for (const t of turns.slice(0, 6)) {
        const v = -replyValue(t.S);
        if (v > best) { best = v; pick = t; }
      }
    }
  }
  const white = input.color === 'white';
  return {
    legs: pick.legs.map(([f, die]) => ({ from: f === 25 ? 'bar' : white ? f : 25 - f, die })),
    candidates: turns.length,
  };
}

module.exports = { bestMove, _test: { genTurns, evaluate, toFrame, flip } };
