// Server-side CPU players for the card games. A bot is just a fake seat id ('bot-<Name>') that
// acts by feeding the plugin the exact same actions a human client would send, through the
// plugin's own onMessage — so every rule/validation path is shared and a bot can never make an
// illegal move the server wouldn't also reject from a person.
//
// `withBots(plugin, brain)` patches plugin.onMessage in place to understand two extra actions:
//   { kind: 'addBot', seat? }   — seat a new bot (seat index only matters for fixed-seat games)
//   { kind: 'removeBot', seat } — the bot in that seat leaves (its own 'leaveSeat')
// and, while a room has any bots seated and anyone watching, polls `brain.decide` for each bot
// and plays what it returns after a short "thinking" delay. The decision is re-made when the
// delay fires, so a state change in between (a human acted, a trick resolved) can't go stale.

const { rankValue, SUITS, RANKS } = require('./cardCommon');
const { normLevel } = require('./ai/levels');

const BOT_NAMES = ['Ace', 'Byte', 'Chip', 'Dot', 'Echo', 'Flux', 'Gizmo'];
const POLL_MS = 250;

const isBot = (id) => typeof id === 'string' && id.startsWith('bot-');
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
// A bot's difficulty rides in its id ('bot-Ace~expert') so every client can show it without each
// game's public state having to carry it. Levels as in ai/levels.js.
const botBase = (id) => id.slice(4).split('~')[0];
const levelOfId = (id) => normLevel(id.split('~')[1]);
// Chance per decision that a bot plays a random legal move instead of its considered one.
const BLUNDER = { easy: 0.4, medium: 0.15, hard: 0, expert: 0 };

function botCtx(room, botId) {
  return {
    broadcast: (env, excludeId) => room.broadcast(env, excludeId),
    sendTo: (id, env) => room.sendTo(id, env),
    senderId: botId,
  };
}

function withBots(plugin, brain) {
  const seatsOf = brain.seatsOf || ((st) => st.seats);
  const original = plugin.onMessage;

  function decide(st, i, id) {
    const level = levelOfId(id);
    if (brain.random && Math.random() < BLUNDER[level]) {
      const r = brain.random(st, i);
      if (r) return r;
    }
    return brain.decide(st, i, level);
  }

  function dispatch(room, botId, data) {
    original.call(plugin, room, { clientId: botId, nickname: botBase(botId) }, data, botCtx(room, botId));
  }

  function stopLoop(room) {
    clearInterval(room._botLoop);
    clearTimeout(room._botPending);
    room._botLoop = null;
    room._botPending = null;
  }

  function ensureLoop(room) {
    if (room._botLoop) return;
    room._botLoop = setInterval(() => {
      const seats = seatsOf(room.state) || [];
      if (room.clients.size === 0 || !seats.some(isBot)) return stopLoop(room);
      if (room._botPending) return;
      for (let i = 0; i < seats.length; i++) {
        if (!isBot(seats[i])) continue;
        const first = decide(room.state, i, seats[i]);
        if (!first) continue;
        const botId = seats[i];
        const wait = first.wait || rand(...(brain.thinkMs || [650, 1250]));
        room._botPending = setTimeout(() => {
          room._botPending = null;
          // Re-seat lookup + fresh decision: the bot may have been removed or the state moved on.
          const now = seatsOf(room.state) || [];
          const idx = now.indexOf(botId);
          if (idx === -1) return;
          const action = decide(room.state, idx, botId);
          if (action) {
            const { wait: _w, ...data } = action;
            dispatch(room, botId, data);
          }
        }, wait);
        return;
      }
    }, POLL_MS);
  }

  plugin.onMessage = function (room, client, data, ctx) {
    if (data && data.kind === 'addBot') {
      const seats = seatsOf(room.state) || [];
      const used = new Set(seats.filter(isBot).map(botBase));
      const name = BOT_NAMES.find((n) => !used.has(n));
      const sit = name && brain.sitData(room.state, data.seat);
      if (!sit) return;
      dispatch(room, brain.noLevels ? `bot-${name}` : `bot-${name}~${normLevel(data.level)}`, sit);
      if ((seatsOf(room.state) || []).some(isBot)) ensureLoop(room);
      return;
    }
    if (data && data.kind === 'removeBot') {
      const id = (seatsOf(room.state) || [])[Number(data.seat)];
      if (isBot(id)) dispatch(room, id, { kind: 'leaveSeat' });
      return;
    }
    original.call(plugin, room, client, data, ctx);
    if ((seatsOf(room.state) || []).some(isBot)) ensureLoop(room);
  };
  return plugin;
}

// ---------------------------------------------------------------------------------------------
// Shared little helpers for the brains.

const rv = (c) => rankValue(c.rank);
const byRank = (a, b) => rv(a) - rv(b);
const lowest = (cards) => cards.slice().sort(byRank)[0];
const highest = (cards) => cards.slice().sort(byRank).pop();
const idxOf = (hand, card) => hand.findIndex((c) => c.suit === card.suit && c.rank === card.rank);
const suitCounts = (cards) => {
  const n = { S: 0, H: 0, D: 0, C: 0 };
  for (const c of cards) n[c.suit]++;
  return n;
};
const fixedSeat = (key) => (st, seat) => {
  if (st.phase !== 'waiting') return null;
  let s = Number.isInteger(Number(seat)) && seat !== undefined && seat !== null ? Number(seat) : st.seats.indexOf(null);
  if (s < 0 || s > 3 || st.seats[s]) return null;
  return { kind: 'sit', [key]: s };
};
const HAND_OVER_WAIT = 5000;

// --- War: nothing to decide, just flip when it's your go. ---
const war = {
  noLevels: true, // nothing to decide in War
  thinkMs: [350, 750],
  sitData: (st) => (st.seats.length < 2 ? { kind: 'sit' } : null),
  decide(st, i) {
    if (st.phase === 'playing' && !st.pendingFlips[i] && !st.pendingResolveTimeout) return { kind: 'flip' };
    return null;
  },
};

// --- Crazy Eights: keep your 8s for emergencies, follow your longest suit, draw then pass. ---
const crazyeights = {
  sitData: (st) => (st.phase === 'waiting' && st.seats.length < 6 ? { kind: 'sit' } : null),
  random(st, i) {
    if (st.phase !== 'playing' || st.turnIdx !== i) return null;
    const top = st.discardPile[st.discardPile.length - 1];
    const ok = st.hands[i].map((c, idx) => ({ c, idx })).filter(({ c }) => c.rank === '8' || c.rank === top.rank || c.suit === st.currentSuit);
    if (!ok.length) return null;
    const { c, idx } = pick(ok);
    return c.rank === '8' ? { kind: 'play', cardIndex: idx, declaredSuit: pick(SUITS) } : { kind: 'play', cardIndex: idx };
  },
  decide(st, i, level) {
    if (st.phase !== 'playing' || st.turnIdx !== i) return null;
    const hand = st.hands[i];
    const top = st.discardPile[st.discardPile.length - 1];
    const counts = suitCounts(hand);
    const plain = hand
      .map((c, idx) => ({ c, idx }))
      .filter(({ c }) => c.rank !== '8' && (c.rank === top.rank || c.suit === st.currentSuit));
    const n = st.seats.length;
    const nextCards = st.hands[(i + 1) % n].length;
    if (plain.length) {
      // Prefer switching into the suit we hold most of, then dumping the highest card.
      plain.sort((a, b) => counts[b.c.suit] - counts[a.c.suit] || rv(b.c) - rv(a.c));
      if (level === 'expert') {
        // Expert: with the next player about to go out, knock the suit off whatever they've been
        // following; and with several plain options, keep a card that can follow each suit we hold.
        const change = plain.filter(({ c }) => c.suit !== st.currentSuit);
        if (nextCards <= 2 && change.length) return { kind: 'play', cardIndex: change[0].idx };
      }
      return { kind: 'play', cardIndex: plain[0].idx };
    }
    const eight = hand.findIndex((c) => c.rank === '8');
    if (eight !== -1) {
      const rest = hand.filter((_, k) => k !== eight);
      const c2 = suitCounts(rest);
      let declaredSuit = ['S', 'H', 'D', 'C'].sort((a, b) => c2[b] - c2[a])[0];
      // Expert: never name the suit the next player just proved they hold plenty of — i.e. avoid
      // the current suit when they're low, since they've been following it.
      if (level === 'expert' && nextCards <= 2 && declaredSuit === st.currentSuit) {
        declaredSuit = ['S', 'H', 'D', 'C'].filter((x) => x !== st.currentSuit).sort((a, b) => c2[b] - c2[a])[0];
      }
      return { kind: 'play', cardIndex: eight, declaredSuit };
    }
    return st.hasDrawnThisTurn ? { kind: 'pass' } : { kind: 'draw' };
  },
};

// --- BS: play the truth when you can, bluff your least-useful card when you can't, call BS
// when the claim is impossible given your own hand or would hand someone the win. ---
const BS_SEQ = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const bs = {
  sitData: (st) => (st.phase === 'waiting' && st.seats.length < 6 ? { kind: 'sit' } : null),
  random(st, i) {
    const hand = st.hands[i];
    if (!hand || !hand.length) return null;
    if (st.phase === 'playing' && st.turnIdx === i) {
      const ks = hand.map((_, k) => k).sort(() => Math.random() - 0.5);
      return { kind: 'play', cardIndices: ks.slice(0, 1 + Math.floor(Math.random() * Math.min(3, hand.length))) };
    }
    if (st.phase === 'challenge' && st.lastPlay && st.lastPlay.playerIdx !== i && (st.lastPlay.playerIdx + 1) % st.seats.length === i) {
      return { kind: Math.random() < 0.3 ? 'callBS' : 'passChallenge' };
    }
    return null;
  },
  decide(st, i, level) {
    const hand = st.hands[i];
    if (!hand) return null;
    const expert = level === 'expert';
    if (st.phase === 'playing' && st.turnIdx === i) {
      const truth = hand.map((c, k) => (c.rank === st.requiredRank ? k : -1)).filter((k) => k !== -1);
      if (truth.length) {
        // Occasionally sneak an extra card in with the truth.
        // (Expert never pads a play it could win with honestly, and pads only early on.)
        const padOk = expert ? hand.length > truth.length + 3 && Math.random() < 0.2 : Math.random() < 0.25;
        const extra = truth.length < 4 && hand.length > truth.length + 1 && padOk
          ? [bluffCard(hand, st.requiredRank, truth)] : [];
        return { kind: 'play', cardIndices: [...truth, ...extra].slice(0, 4) };
      }
      const picks = [bluffCard(hand, st.requiredRank, [])];
      if (hand.length > 3 && !expert && Math.random() < 0.3) picks.push(bluffCard(hand, st.requiredRank, picks));
      return { kind: 'play', cardIndices: picks };
    }
    if (st.phase === 'challenge' && st.lastPlay && st.lastPlay.playerIdx !== i) {
      const { playerIdx, count, claimedRank } = st.lastPlay;
      const mine = hand.filter((c) => c.rank === claimedRank).length;
      if (mine + count > 4) return { kind: 'callBS' };
      const isNext = (playerIdx + 1) % st.seats.length === i;
      const left = st.hands[playerIdx].length;
      // Expert calls from any seat when the player is about to go out.
      if (expert && left === 0) return { kind: 'callBS' };
      if (!isNext) return null;
      if (left === 0) return { kind: 'callBS' };
      if (expert) {
        // How many of the claimed rank could they plausibly hold, given what we hold? A claim that
        // uses up most of the unseen copies is likely a lie; a small pile isn't worth the risk.
        const unseen = 4 - mine;
        let p = 0.05 + 0.5 * (count / Math.max(1, unseen)) ** 2;
        if (left <= 2) p += 0.25;
        if (st.pile.length > 8) p -= 0.08;
        return { kind: Math.random() < p ? 'callBS' : 'passChallenge' };
      }
      const suspicion = 0.08 + 0.12 * (count - 1) + 0.1 * mine + (st.pile.length > 10 ? -0.05 : 0);
      return { kind: Math.random() < suspicion ? 'callBS' : 'passChallenge' };
    }
    return null;
  },
};
// The card whose rank comes up furthest in the future — least likely to be needed soon.
function bluffCard(hand, required, exclude) {
  const r = BS_SEQ.indexOf(required);
  let best = -1;
  let bestDist = -1;
  hand.forEach((c, k) => {
    if (exclude.includes(k)) return;
    const d = (BS_SEQ.indexOf(c.rank) - r + 13) % 13;
    if (d > bestDist) { bestDist = d; best = k; }
  });
  return best;
}

// --- Poker: rough hand strength vs. pot odds, with a little noise so it isn't a robot. ---
function pokerBrain() {
  const { evaluate7, compareHandTuples, BIG_BLIND } = require('./poker')._internal;
  const DECK = [];
  for (const suit of SUITS) for (const rank of RANKS) DECK.push({ rank, suit });
  // Expert: Monte Carlo win probability against `opps` random hands (ties count half).
  function equity(hole, community, opps, sims = 300) {
    const known = new Set([...hole, ...community].map((c) => c.rank + c.suit));
    const rest = DECK.filter((c) => !known.has(c.rank + c.suit));
    let won = 0;
    for (let n = 0; n < sims; n++) {
      const need = 5 - community.length + opps * 2;
      for (let k = 0; k < need; k++) {
        const j = k + Math.floor(Math.random() * (rest.length - k));
        const t = rest[k]; rest[k] = rest[j]; rest[j] = t;
      }
      const board = [...community, ...rest.slice(0, 5 - community.length)];
      const mine = evaluate7([...hole, ...board]);
      let beat = false; let ties = 0;
      for (let o = 0; o < opps && !beat; o++) {
        const off = 5 - community.length + o * 2;
        const cmp = compareHandTuples(mine, evaluate7([rest[off], rest[off + 1], ...board]));
        if (cmp < 0) beat = true; else if (cmp === 0) ties++;
      }
      if (!beat) won += ties ? 1 / (ties + 1) : 1;
    }
    return won / sims;
  }
  const NOISE = { easy: 0.22, medium: 0.14, hard: 0.08 };
  const POSTFLOP = [0.22, 0.5, 0.68, 0.78, 0.84, 0.87, 0.93, 0.97, 1];
  function strength(hole, community) {
    if (community.length === 0) {
      const [a, b] = hole.map(rv).sort((x, y) => y - x);
      if (a === b) return 0.55 + (a / 14) * 0.4;
      let s = ((a + b) / 28) * 0.62;
      if (hole[0].suit === hole[1].suit) s += 0.05;
      if (a - b === 1) s += 0.04;
      if (a === 14) s += 0.06;
      return s;
    }
    const cat = evaluate7([...hole, ...community])[0];
    let s = POSTFLOP[cat];
    // Made entirely by the board? Everyone has it — worth much less.
    let boardCat;
    if (community.length >= 5) boardCat = evaluate7(community)[0];
    else {
      const freq = {};
      for (const c of community) freq[c.rank] = (freq[c.rank] || 0) + 1;
      const most = Math.max(...Object.values(freq));
      boardCat = most >= 3 ? 3 : most === 2 ? 1 : 0;
    }
    if (cat > 0 && boardCat >= cat) s -= 0.25;
    return s;
  }
  return {
    sitData: (st) => (st.phase === 'waiting' && st.seats.length < 6 ? { kind: 'sit' } : null),
    random(st, i) {
      const h = st.hand;
      if (st.phase !== 'playing' || !h || h.toAct !== i) return null;
      return { kind: h.currentBet > h.bets[i] ? pick(['call', 'call', 'fold']) : 'check' };
    },
    decide(st, i, level) {
      if (st.phase === 'hand_over') return { kind: 'nextHand', wait: HAND_OVER_WAIT };
      const h = st.hand;
      if (st.phase !== 'playing' || !h || h.toAct !== i) return null;
      const toCall = h.currentBet - h.bets[i];
      const pot = h.totalContributed.reduce((a, b) => a + b, 0);
      const canRaise = h.bets[i] + st.chips[i] > h.currentBet;
      const raiseTo = (mult) => ({
        kind: 'raise',
        amount: h.currentBet + Math.max(BIG_BLIND, Math.round((pot * mult) / 10) * 10),
      });
      if (level === 'expert') {
        // Real equity vs. the players still in, compared with pot odds; value-bet strong hands in
        // proportion to how far ahead we are, semi-bluff now and then with live draws.
        const opps = h.folded.filter((f, k) => !f && k !== i).length;
        if (!opps) return { kind: toCall ? 'call' : 'check' };
        const eq = equity(h.holeCards[i], h.community, opps);
        const fair = 1 / (opps + 1);
        const edge = eq - fair; // how far above an even share of the pot we are
        if (canRaise && edge > 0.18 && Math.random() < 0.75) return raiseTo(Math.min(1.2, 0.4 + edge * 2));
        if (toCall === 0) {
          if (canRaise && h.community.length && h.community.length < 5 && eq > fair * 0.8 && Math.random() < 0.15) return raiseTo(0.5);
          return { kind: 'check' };
        }
        const odds = toCall / (pot + toCall);
        if (eq >= odds + 0.03) return { kind: 'call' };
        return { kind: 'fold' };
      }
      const noise = NOISE[level] || NOISE.hard;
      const s = strength(h.holeCards[i], h.community) + rand(-noise, noise);
      if (level === 'easy' && toCall > 0) {
        // A calling station: rarely raises, rarely folds.
        const odds = toCall / (pot + toCall);
        return { kind: s > odds - 0.15 || Math.random() < 0.4 ? 'call' : 'fold' };
      }
      if (canRaise && s > 0.78 && Math.random() < 0.7) return raiseTo(rand(0.5, 1));
      if (toCall === 0) {
        if (canRaise && s > 0.55 && Math.random() < 0.3) return raiseTo(0.5);
        if (canRaise && Math.random() < 0.06) return raiseTo(0.6); // the odd bluff
        return { kind: 'check' };
      }
      const odds = toCall / (pot + toCall);
      if (s >= odds + 0.12 || (toCall <= BIG_BLIND && s > 0.3)) return { kind: 'call' };
      return { kind: 'fold' };
    },
  };
}

// --- Hearts: pass the dangerous cards, duck under the winning card, dump points when void. ---
function heartsBrain() {
  const { legalCards } = require('./hearts')._internal;
  const isQS = (c) => c.suit === 'S' && c.rank === 'Q';
  const points = (c) => (isQS(c) ? 13 : c.suit === 'H' ? 1 : 0);
  function passDanger(c) {
    if (isQS(c)) return 100;
    if (c.suit === 'S' && rv(c) > 12) return 90;
    return rv(c) + (c.suit === 'H' ? 8 : 0);
  }
  function choosePlay(st, i) {
    const legal = legalCards(st, i);
    if (legal.length === 1) return legal[0];
    const trick = st.currentTrick;
    if (trick.length === 0) {
      // Lead low, and don't lead spades while the queen is still loose unless we're safe.
      const safe = legal.filter((c) => !(c.suit === 'S' && rv(c) >= 12));
      return lowest(safe.length ? safe : legal);
    }
    const led = trick[0].card.suit;
    const winning = highest(trick.filter((t) => t.card.suit === led).map((t) => t.card));
    const following = legal[0].suit === led;
    if (!following) {
      const qs = legal.find(isQS);
      if (qs) return qs;
      const hearts = legal.filter((c) => c.suit === 'H');
      if (hearts.length) return highest(hearts);
      return highest(legal);
    }
    const qs = legal.find(isQS);
    if (qs && rv(winning) > 12) return qs;
    const under = legal.filter((c) => rv(c) < rv(winning));
    if (under.length) return highest(under);
    // Forced to win it — if we're last and it's clean, win it with our biggest card.
    const trickPoints = trick.reduce((a, t) => a + points(t.card), 0);
    if (trick.length === 3 && trickPoints === 0) return highest(legal.filter((c) => !isQS(c)).length ? legal.filter((c) => !isQS(c)) : legal);
    return lowest(legal);
  }
  // Expert: counts every card already played this hand (tricks taken + the trick on the table).
  function expertPlay(st, i) {
    const legal = legalCards(st, i);
    if (legal.length === 1) return legal[0];
    const hand = st.hands[i];
    const gone = new Set();
    for (const pile of st.tricksTaken) for (const c of pile) gone.add(c.rank + c.suit);
    for (const t of st.currentTrick) gone.add(t.card.rank + t.card.suit);
    const mine = new Set(hand.map((c) => c.rank + c.suit));
    // Cards still in other players' hands, per suit.
    const out = (suit) => RANKS.filter((r) => !gone.has(r + suit) && !mine.has(r + suit)).map((r) => rankValue(r));
    const qsOut = !gone.has('QS') && !mine.has('QS');
    const trick = st.currentTrick;
    // Moon watch: one other player has every point so far and plenty of them — take a heart off them.
    const pts = st.tricksTaken.map((p) => p.reduce((a, c) => a + points(c), 0));
    const total = pts.reduce((a, b) => a + b, 0);
    const shooter = total >= 14 && pts.findIndex((p) => p === total);
    const moonThreat = shooter !== false && shooter !== -1 && shooter !== i;
    if (trick.length === 0) {
      // Safe leads first: a card lower than everything anyone else still holds in its suit.
      const scored = legal.map((c) => {
        const o = out(c.suit);
        const under = o.filter((v) => v < rv(c)).length; // cards that duck under ours
        let risk = o.length ? under / o.length : 0;
        if (c.suit === 'S' && qsOut && rv(c) < 12) risk -= 0.3; // smoke out the queen
        if (c.suit === 'S' && rv(c) >= 12 && qsOut) risk += 1;
        if (isQS(c)) risk += 2;
        if (c.suit === 'H') risk += 0.15;
        if (!o.length) risk += 0.5; // nobody can follow: we win it and eat whatever gets dumped
        return { c, risk: risk + rv(c) / 100 };
      });
      scored.sort((a, b) => a.risk - b.risk);
      return scored[0].c;
    }
    const led = trick[0].card.suit;
    const winning = highest(trick.filter((t) => t.card.suit === led).map((t) => t.card));
    const trickPoints = trick.reduce((a, t) => a + points(t.card), 0);
    const following = legal[0].suit === led;
    if (moonThreat && trickPoints > 0) {
      const beaters = legal.filter((c) => c.suit === led && rv(c) > rv(winning) && !isQS(c));
      if (beaters.length) return highest(beaters);
    }
    if (!following) {
      const qs = legal.find(isQS);
      if (qs && !moonThreat) return qs;
      if (qsOut) { const big = legal.filter((c) => c.suit === 'S' && rv(c) > 12); if (big.length) return highest(big); }
      // Dump the card most likely to win a later trick: highest relative to what's still out.
      const danger = (c) => out(c.suit).filter((v) => v < rv(c)).length * 2 + rv(c) + (c.suit === 'H' ? 6 : 0);
      return legal.slice().sort((a, b) => danger(b) - danger(a))[0];
    }
    const qs = legal.find(isQS);
    if (qs && rv(winning) > 12) return qs;
    const under = legal.filter((c) => rv(c) < rv(winning));
    if (under.length) return highest(under);
    const last = trick.length === 3;
    const safe = legal.filter((c) => !isQS(c));
    if (last && trickPoints === 0) return highest(safe.length ? safe : legal);
    // Can't duck: if the queen could still land on this spade trick, don't win it with a big one
    // we'd rather keep — otherwise win it high and keep the low cards for later.
    if (!last && led === 'S' && qsOut) return lowest(legal);
    return !last ? highest(safe.length ? safe : legal) : lowest(legal);
  }
  return {
    thinkMs: [550, 1000],
    sitData: fixedSeat('seatIdx'),
    random(st, i) {
      if (st.phase === 'passing' && !st.passSubmissions[i]) {
        const ks = st.hands[i].map((_, k) => k).sort(() => Math.random() - 0.5);
        return { kind: 'submitPass', cardIndices: ks.slice(0, 3) };
      }
      if (st.phase === 'playing' && st.turnSeat === i) return { kind: 'play', cardIndex: idxOf(st.hands[i], pick(legalCards(st, i))) };
      return null;
    },
    decide(st, i, level) {
      if (st.phase === 'hand_over') return { kind: 'nextHand', wait: HAND_OVER_WAIT };
      if (st.phase === 'passing' && !st.passSubmissions[i]) {
        let danger = passDanger;
        if (level === 'expert') {
          // Keep the queen when well guarded by low spades; voiding a short suit beats passing
          // middling cards.
          const n = suitCounts(st.hands[i]);
          const lowSpades = st.hands[i].filter((c) => c.suit === 'S' && rv(c) < 12).length;
          danger = (c) => {
            if (isQS(c) && lowSpades >= 4) return 5;
            if (c.suit === 'S' && rv(c) > 12 && lowSpades >= 4) return 6;
            return passDanger(c) + (c.suit !== 'S' && n[c.suit] <= 2 ? 12 : 0);
          };
        }
        const order = st.hands[i].map((c, k) => ({ k, d: danger(c) })).sort((a, b) => b.d - a.d);
        return { kind: 'submitPass', cardIndices: order.slice(0, 3).map((o) => o.k) };
      }
      if (st.phase === 'playing' && st.turnSeat === i) {
        const card = level === 'expert' ? expertPlay(st, i) : choosePlay(st, i);
        return { kind: 'play', cardIndex: idxOf(st.hands[i], card) };
      }
      return null;
    },
  };
}

// --- Spades: count sure-ish tricks to bid, then win only what the team still needs. ---
function spadesBrain() {
  const { legalCardIndices, trickWinnerSeat } = require('./spades')._internal;
  function estimateBid(hand) {
    const n = suitCounts(hand);
    let t = 0;
    for (const c of hand) {
      const v = rv(c);
      if (c.suit === 'S') {
        if (v === 14) t += 1;
        else if (v === 13) t += n.S >= 2 ? 0.9 : 0.4;
        else if (v === 12) t += n.S >= 3 ? 0.6 : 0.2;
      } else if (v === 14) t += n[c.suit] <= 5 ? 0.95 : 0.6;
      else if (v === 13) t += n[c.suit] >= 2 && n[c.suit] <= 4 ? 0.7 : 0.25;
    }
    if (n.S > 3) t += (n.S - 3) * 0.7;
    if (n.S >= 3) for (const s of ['H', 'D', 'C']) t += n[s] === 0 ? 0.8 : n[s] === 1 ? 0.4 : 0;
    return Math.max(1, Math.min(13, Math.round(t)));
  }
  function choosePlay(st, i) {
    const hand = st.hands[i];
    const legal = legalCardIndices(hand, st.currentTrick, st.spadesBroken).map((k) => ({ k, c: hand[k] }));
    const low = (xs) => xs.slice().sort((a, b) => (a.c.suit === 'S') - (b.c.suit === 'S') || rv(a.c) - rv(b.c))[0];
    const trick = st.currentTrick;
    const team = i % 2;
    const teamBid = (st.bids[team] || 0) + (st.bids[team + 2] || 0);
    const needMore = st.tricksWon[team] + st.tricksWon[team + 2] < teamBid;
    const nilMe = st.bids[i] === 0;
    if (trick.length === 0) {
      if (nilMe) return low(legal).k;
      const aces = legal.filter((x) => x.c.suit !== 'S' && rv(x.c) === 14);
      if (needMore && aces.length) return aces[0].k;
      return low(legal).k;
    }
    const winner = trickWinnerSeat(trick);
    const partnerWinning = winner === (i + 2) % 4;
    const winners = legal.filter((x) => trickWinnerSeat([...trick, { seatIdx: i, card: x.c }]) === i);
    if (nilMe) {
      const losers = legal.filter((x) => !winners.includes(x));
      return (losers.length ? losers.sort((a, b) => rv(b.c) - rv(a.c))[0] : low(legal)).k;
    }
    if (partnerWinning || !needMore || !winners.length) return low(legal).k;
    return low(winners).k;
  }
  // Expert: knows which cards are gone (st.playedCards), so it can cash sure winners, cover a nil
  // partner and avoid wasting a high card when partner already has the trick locked.
  function expertPlay(st, i) {
    const hand = st.hands[i];
    const legal = legalCardIndices(hand, st.currentTrick, st.spadesBroken).map((k) => ({ k, c: hand[k] }));
    if (legal.length === 1) return legal[0].k;
    const gone = new Set((st.playedCards || []).map((c) => c.rank + c.suit));
    for (const t of st.currentTrick) gone.add(t.card.rank + t.card.suit);
    const mine = new Set(hand.map((c) => c.rank + c.suit));
    const topOut = (suit) => RANKS.filter((r) => !gone.has(r + suit) && !mine.has(r + suit)).map(rankValue).pop() || 0;
    const sure = (c) => rv(c) > topOut(c.suit);
    const low = (xs) => xs.slice().sort((a, b) => (a.c.suit === 'S') - (b.c.suit === 'S') || rv(a.c) - rv(b.c))[0];
    const trick = st.currentTrick;
    const team = i % 2;
    const partner = (i + 2) % 4;
    const teamBid = (st.bids[team] || 0) + (st.bids[team + 2] || 0);
    const needMore = st.tricksWon[team] + st.tricksWon[team + 2] < teamBid;
    const partnerNil = st.bids[partner] === 0;
    if (st.bids[i] === 0) return choosePlay(st, i);
    if (trick.length === 0) {
      if (needMore || partnerNil) {
        // Cash a side-suit card that nobody can beat by following; spades only when trumps are drawn.
        const cash = legal.filter((x) => x.c.suit !== 'S' && sure(x.c));
        if (cash.length) return cash[0].k;
        if (partnerNil) return legal.slice().sort((a, b) => rv(b.c) - rv(a.c))[0].k;
      }
      return low(legal).k;
    }
    const winner = trickWinnerSeat(trick);
    const winners = legal.filter((x) => trickWinnerSeat([...trick, { seatIdx: i, card: x.c }]) === i);
    const last = trick.length === 3;
    if (partnerNil && winners.length) {
      // Cover partner: take the trick if they're winning it or haven't played yet.
      const partnerPlayed = trick.some((t) => t.seatIdx === partner);
      if (winner === partner || !partnerPlayed) return (last ? low(winners) : winners.sort((a, b) => rv(b.c) - rv(a.c))[0]).k;
    }
    if (winner === partner) {
      const pc = trick.find((t) => t.seatIdx === partner).card;
      if (last || sure(pc)) return low(legal).k;
    }
    if (!needMore || !winners.length) return low(legal).k;
    // Second/third seat: win with a card high enough that the remaining players can't overtake.
    if (!last) {
      const solid = winners.filter((x) => sure(x.c));
      if (solid.length) return low(solid).k;
    }
    return low(winners).k;
  }
  return {
    thinkMs: [550, 1000],
    sitData: fixedSeat('seat'),
    random(st, i) {
      if (st.phase === 'playing' && st.turnIdx === i && st.currentTrick.length < 4) {
        return { kind: 'play', cardIndex: pick(legalCardIndices(st.hands[i], st.currentTrick, st.spadesBroken)) };
      }
      return null;
    },
    decide(st, i, level) {
      if (st.phase === 'hand_over') return { kind: 'nextHand', wait: HAND_OVER_WAIT };
      if (st.phase === 'bidding' && st.biddingTurnIdx === i) {
        let bid = estimateBid(st.hands[i]);
        if (level === 'easy') bid = Math.max(1, Math.min(13, bid + pick([-2, -1, 0, 1, 2])));
        else if (level === 'medium') bid = Math.max(1, Math.min(13, bid + pick([-1, 0, 0, 1])));
        return { kind: 'bid', amount: bid };
      }
      if (st.phase === 'playing' && st.turnIdx === i && st.currentTrick.length < 4) {
        return { kind: 'play', cardIndex: level === 'expert' ? expertPlay(st, i) : choosePlay(st, i) };
      }
      return null;
    },
  };
}

function installCardBots(registry) {
  if (registry.war) withBots(registry.war, war);
  if (registry.crazyeights) withBots(registry.crazyeights, crazyeights);
  if (registry.bs) withBots(registry.bs, bs);
  if (registry.poker) withBots(registry.poker, pokerBrain());
  if (registry.hearts) withBots(registry.hearts, heartsBrain());
  if (registry.spades) withBots(registry.spades, spadesBrain());
}

module.exports = { withBots, installCardBots, isBot, _test: { war, crazyeights, bs, pokerBrain, heartsBrain, spadesBrain } };
