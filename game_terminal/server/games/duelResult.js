// End-of-match reporting for the two-seat duel plugins (pool, darts, cup pong, basketball, tanks,
// mini golf, archery, shuffleboard, bowling, knockout, paintball, skee-ball). They all keep
// st.players { seat: clientId | 'BOT' }, st.winner = seat | 'draw' once st.phase is 'game_over',
// and bump st.gameId for every new game. Each calls reportDuel from its broadcastState, the one
// place every finished game passes through; st.reportedGameId makes repeat calls no-ops, and a
// rematch's new gameId re-arms it. Leaving mid-game resets the table in these plugins, so an
// aborted game never reaches game_over and is never reported.

'use strict';

const { report } = require('../report');
const { botLevelOf } = require('./ai/levels');

const BOT = 'BOT';

// scoreOf(seat) -> number (optional) adds `scores` for the human seats.
function reportDuel(room, scoreOf) {
  const st = room.state;
  if (st.phase !== 'game_over' || !st.winner || st.reportedGameId === st.gameId) return;
  st.reportedGameId = st.gameId;
  const seats = Object.keys(st.players).filter((s) => st.players[s]); // a solo run leaves one seat empty
  const placements = (st.winner === 'draw'
    ? [seats.map((s) => st.players[s])]
    : [[st.players[st.winner]], seats.filter((s) => s !== st.winner).map((s) => st.players[s])]).filter((g) => g.length);
  const result = { placements };
  const botSeat = seats.find((s) => st.players[s] === BOT);
  if (botSeat) result.botLevel = botLevelOf(st, botSeat);
  if (scoreOf) {
    result.scores = {};
    for (const s of seats) if (st.players[s] !== BOT) result.scores[st.players[s]] = scoreOf(s);
  }
  report(room, result);
}

module.exports = { reportDuel };
