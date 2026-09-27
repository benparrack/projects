// Worker thread that runs the board-game engines, so a bot's ~1s search never blocks the main
// event loop (which is also ticking TRON/Slither/Shooter rooms). See ./index.js for the client.

'use strict';

const { parentPort } = require('worker_threads');

const engines = {
  chess: require('./chessEngine'),
  connect4: require('./connect4Engine'),
  checkers: require('./checkersEngine'),
  backgammon: require('./backgammonEngine'),
};

parentPort.on('message', ({ id, engine, input }) => {
  try {
    parentPort.postMessage({ id, result: engines[engine].bestMove(input) });
  } catch (err) {
    parentPort.postMessage({ id, error: String((err && err.stack) || err) });
  }
});
