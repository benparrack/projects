// Bot difficulty levels shared by every game with CPU players. A room keeps st.botLevels
// ({ [seat]: level }) and exposes it in its public state; the client's botLevel.js renders the
// picker. Each engine maps a level to its own search depth / noise / time budget.

'use strict';

const LEVELS = ['easy', 'medium', 'hard', 'expert'];
const DEFAULT_LEVEL = 'hard';

const normLevel = (l) => (LEVELS.includes(l) ? l : DEFAULT_LEVEL);

function setBotLevel(st, seat, level) {
  if (!st.botLevels) st.botLevels = {};
  st.botLevels[seat] = normLevel(level);
}

const botLevelOf = (st, seat) => normLevel(st.botLevels && st.botLevels[seat]);

module.exports = { LEVELS, DEFAULT_LEVEL, normLevel, setBotLevel, botLevelOf };
