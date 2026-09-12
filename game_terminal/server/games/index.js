// Registry of game plugins. Adding a new mini-game means adding one require + one entry here,
// plus a matching public/games/<name>/client.js and a menu entry in public/hub.js — nothing else
// in server/ needs to change.
const drawing = require('./drawing');

module.exports = {
  [drawing.type]: drawing,
};
