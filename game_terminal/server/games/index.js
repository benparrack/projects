// Registry of game plugins. Adding a new mini-game means adding one require + one entry here,
// plus a matching public/games/<name>/client.js and a menu entry in public/hub.js — nothing else
// in server/ needs to change.
const drawing = require('./drawing');
const hangman = require('./hangman');
const checkers = require('./checkers');
const chess = require('./chess');

module.exports = {
  [drawing.type]: drawing,
  [hangman.type]: hangman,
  [checkers.type]: checkers,
  [chess.type]: chess,
};
