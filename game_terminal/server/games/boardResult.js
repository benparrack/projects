// End-of-match reporting + replay helpers shared by the two-seat board games (chess, checkers,
// connect4, reversi, gomoku, mancala, dotsboxes, blockade, backgammon, codemaster). See
// server/report.js for the result contract.

'use strict';

const { report } = require('../report');
const { botLevelOf } = require('./ai/levels');

const BOT = 'BOT';

// `seats` lists the two seat keys of st.players; `winner` is one of them, or anything else (null /
// 'draw') for a draw. `scores` is keyed by seat. Reports at most once per match: st.reported must be
// cleared wherever the plugin starts a new game.
function reportDuel(room, seats, winner, { scores, replay } = {}) {
  const st = room.state;
  if (st.reported) return;
  st.reported = true;
  const id = (seat) => (st.players[seat] === BOT ? BOT : st.players[seat]);
  const result = {
    placements: seats.includes(winner) ? [[id(winner)], [id(seats.find((s) => s !== winner))]] : [seats.map(id)],
  };
  if (scores) result.scores = Object.fromEntries(seats.map((s) => [id(s), scores[s]]));
  const botSeat = seats.find((s) => st.players[s] === BOT);
  if (botSeat) result.botLevel = botLevelOf(st, botSeat);
  if (replay) result.replay = replay;
  report(room, result);
}

// Replay frames are deep copies: the engines mutate boards in place between moves.
const frameOf = (snapshot) => JSON.parse(JSON.stringify(snapshot));

module.exports = { reportDuel, frameOf };
