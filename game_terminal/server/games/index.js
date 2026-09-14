// Registry of game plugins. Adding a new mini-game means adding one require + one entry here,
// plus a matching public/games/<name>/client.js and a menu entry in public/hub.js — nothing else
// in server/ needs to change.
const drawing = require('./drawing');
const hangman = require('./hangman');
const checkers = require('./checkers');
const chess = require('./chess');
const slither = require('./slither');
const connect4 = require('./connect4');
const shooter = require('./shooter');

module.exports = {
  [drawing.type]: drawing,
  [hangman.type]: hangman,
  [checkers.type]: checkers,
  [chess.type]: chess,
  [slither.type]: slither,
  [connect4.type]: connect4,
  [shooter.type]: shooter,
};
