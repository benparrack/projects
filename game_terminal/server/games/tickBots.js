// Shared bits for CPU players in the real-time tick games (TRON, Slither, Maze Dash, ...). A bot
// is an ordinary player record whose clientId starts with 'bot-' and which carries `bot: level`;
// each game steers its bots from its own tick(). Bots never outlive the last human in a room.

'use strict';

const { normLevel } = require('./ai/levels');

const BOT_NAMES = ['Ace', 'Byte', 'Chip', 'Dot', 'Echo', 'Flux', 'Gizmo', 'Hex'];
const LEVEL_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
const MAX_BOTS = 6;

const isBotId = (id) => typeof id === 'string' && id.startsWith('bot-');

// Returns { clientId, nickname, level } for a new bot, or null when the room already has enough.
function newBot(players, level) {
  const ids = [...players.keys()];
  if (ids.filter(isBotId).length >= MAX_BOTS) return null;
  const name = BOT_NAMES.find((n) => !players.has(`bot-${n}`));
  if (!name) return null;
  const lv = normLevel(level);
  return { clientId: `bot-${name}`, nickname: `🤖 ${name} (${LEVEL_LABEL[lv]})`, level: lv };
}

const humanCount = (players) => [...players.keys()].filter((id) => !isBotId(id)).length;

// Call from onLeave: once no humans remain, drop every bot so an empty room doesn't simulate.
function dropBotsIfAlone(players) {
  if (humanCount(players) > 0) return;
  for (const id of [...players.keys()]) if (isBotId(id)) players.delete(id);
}

module.exports = { isBotId, newBot, humanCount, dropBotsIfAlone, MAX_BOTS };
