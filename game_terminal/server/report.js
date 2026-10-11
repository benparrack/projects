// The one call every game plugin makes when a match ends:
//
//   report(room, {
//     placements: [[idA], [idB, idC], ...],  // best first; one inner array per place. Ties and
//                                            // teammates share a place. Ids are clientIds or 'BOT'.
//     scores:  { [clientId]: number },       // optional; meaning declared by plugin.stats.score
//     botLevel: 'easy'|'medium'|'hard'|'expert', // optional; when a 'BOT' took part
//     replay:  [...],                        // optional; turn-based games only (see plugin.replayFrames)
//   })
//
// A single-player result (one place holding one human) counts as "played" + best score only,
// never a win or loss. Plugins never touch accounts directly — the room's owner (server/index.js)
// sets room.onResult. In unit tests a fake room can set it to capture results.
function report(room, result) {
  if (typeof room.onResult === 'function') room.onResult(result);
}

module.exports = { report };
