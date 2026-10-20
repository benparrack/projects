// Shared engine for "same puzzle, six tries" games (Wordle): everyone in the room gets the
// same hidden answer and guesses at their own pace. Fewest guesses wins, and a tie goes to whoever
// solved it first. The round ends once every player has solved it or run out of guesses. Answers
// and other players' guesses stay server-side until the round is over.
//
// A game supplies:
//   makePuzzle(rand)              -> puzzle (any shape; must include `answer` for the reveal)
//   check(puzzle, raw)            -> { error } | { guess, mark, solved }  (`guess: null` = a skip)
//   view(puzzle, player, over)    -> extra per-viewer fields (e.g. how many frames to show)
//   peek(entry)                   -> what other players may see of a guess mid-round (default: nothing)

'use strict';

const { reportRanked } = require('./wordResults');
const { mulberry32 } = require('../daily');

const COLOR_PALETTE = ['#00eaff', '#ff2fb0', '#39ff14', '#ffb000', '#8c52ff', '#ff4d4d', '#ffee58', '#00ffa2'];

function createGuessGame({ type, maxGuesses = 6, makePuzzle, check, view = () => ({}), peek = () => null, extraSnapshot = () => ({}) }) {
  const done = (p) => p.solved || p.guesses.length >= maxGuesses;

  function endRound(room) {
    const st = room.state;
    if (st.phase !== 'playing') return;
    st.phase = 'results';
    st.endedAt = Date.now();
    const ranked = [...st.players.values()].filter((p) => p.inRound);
    // Score = guesses used (lower is better); a miss scores maxGuesses + 1.
    if (ranked.length) reportRanked(room, ranked.map((p) => ({ id: p.clientId, rank: -(score(p) * 1e10 + (p.finishedAt || st.endedAt) - st.startedAt), score: score(p) })));
    const best = Math.min(...ranked.map(score));
    if (best <= maxGuesses) for (const p of ranked) if (score(p) === best) p.wins += 1;
  }
  const score = (p) => (p.solved ? p.guesses.length : maxGuesses + 1);

  function maybeFinish(room) {
    const inRound = [...room.state.players.values()].filter((p) => p.inRound);
    if (inRound.length && inRound.every(done)) endRound(room);
  }

  function startRound(room) {
    const st = room.state;
    st.puzzle = makePuzzle(room.daily ? mulberry32(room.daily.seed) : Math.random); // daily: same answer for everyone
    st.roundId += 1;
    st.phase = 'playing';
    st.startedAt = Date.now();
    st.endedAt = null;
    for (const p of st.players.values()) Object.assign(p, { guesses: [], solved: false, finishedAt: null, inRound: true });
  }

  function buildView(room, forId) {
    const st = room.state;
    const over = st.phase === 'results';
    const me = st.players.get(forId);
    return {
      kind: 'state',
      phase: st.phase,
      roundId: st.roundId,
      maxGuesses,
      startedAt: st.startedAt,
      endedAt: st.endedAt,
      answer: over ? st.puzzle.answer : null,
      ...(st.puzzle ? view(st.puzzle, me, over) : {}),
      myGuesses: me ? me.guesses : [],
      players: [...st.players.values()].map((p) => ({
        clientId: p.clientId, nickname: p.nickname, color: p.color, wins: p.wins, inRound: p.inRound,
        solved: p.solved, done: done(p), count: p.guesses.length, finishedAt: p.finishedAt,
        guesses: over || p.clientId === forId ? p.guesses : p.guesses.map(peek),
      })),
    };
  }

  function broadcastState(room) {
    for (const id of room.clients.keys()) room.sendTo(id, { v: 1, type: 'game.event', payload: { gameType: type, data: buildView(room, id) } });
  }

  return {
    type,
    stats: { rated: true, score: { label: 'Guesses', better: 'low', format: 'int' } },

    createInitialState() {
      return { phase: 'waiting', roundId: 0, puzzle: null, startedAt: null, endedAt: null, nextColorIdx: 0, players: new Map() };
    },

    serializeSnapshot(room, client) {
      return { ...buildView(room, client ? client.clientId : null), ...extraSnapshot() };
    },

    onJoin(room, client) {
      const st = room.state;
      st.players.set(client.clientId, {
        clientId: client.clientId, nickname: client.nickname, color: COLOR_PALETTE[st.nextColorIdx++ % COLOR_PALETTE.length],
        guesses: [], solved: false, finishedAt: null, wins: 0,
        inRound: st.phase === 'playing', // joining mid-round: you get the same puzzle and all six tries
      });
      broadcastState(room);
    },

    onLeave(room, client) {
      room.state.players.delete(client.clientId);
      if (room.state.phase === 'playing') maybeFinish(room); // the last one still guessing may have left
      broadcastState(room);
    },

    onMessage(room, client, data, ctx) {
      if (!data || typeof data.kind !== 'string') return;
      const st = room.state;
      const me = st.players.get(ctx.senderId);
      if (!me) return;
      if (data.kind === 'start') {
        if (st.phase === 'playing') return;
        startRound(room);
        broadcastState(room);
        return;
      }
      if (data.kind === 'guess') {
        if (st.phase !== 'playing' || !me.inRound || done(me)) return;
        const res = check(st.puzzle, data.guess);
        if (res.error) {
          ctx.sendTo(ctx.senderId, { v: 1, type: 'game.event', payload: { gameType: type, data: { kind: 'error', error: res.error } } });
          return;
        }
        me.guesses.push({ guess: res.guess, mark: res.mark });
        if (res.solved) me.solved = true;
        if (done(me)) me.finishedAt = Date.now();
        maybeFinish(room);
        broadcastState(room);
      }
    },

    _internals: { score, done },
  };
}

module.exports = { createGuessGame };
