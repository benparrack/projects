// Pixel-art avatars (8x8), rendered as crisp inline SVG. Ids are kept in sync by hand with
// AVATAR_IDS in server/accounts.js (test/accounts.test.js checks it).

const PAL = {
  K: '#14161a', W: '#f2f5f0', R: '#ff4d5e', O: '#ff9a1f', Y: '#ffd23f', G: '#3fd34f', L: '#a6ff4d',
  C: '#5ce1ff', B: '#3a7bff', P: '#b45cff', S: '#b8c4cc', T: '#d9b48a', N: '#8a5a2b', I: '#ff7ac8',
};

// [id, label, body color for 'X', pixel rows]
const DEFS = [
  ['invader', 'Invader', '#39ff14', ['..X..X..', '...XX...', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', 'X.XXXX.X', 'X.X..X.X', '..X..X..']],
  ['ghost', 'Ghost', '#ff4d5e', ['..XXXX..', '.XXXXXX.', 'XWBXXWBX', 'XWWXXWWX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'X.XX.XX.']],
  ['skull', 'Skull', null, ['.WWWWWW.', 'WWWWWWWW', 'WKKWWKKW', 'WKKWWKKW', 'WWWKKWWW', '.WWWWWW.', '..W.W.W.', '..WWWWW.']],
  ['robot', 'Robot', null, ['...YY...', '...SS...', '.SSSSSS.', '.SRSSRS.', '.SSSSSS.', '.SKKKKS.', '.SSSSSS.', '..S..S..']],
  ['cat', 'Cat', null, ['O......O', 'OO....OO', 'OOOOOOOO', 'OKOOOOKO', 'OOOIIOOO', 'OOOOOOOO', '.OOOOOO.', '..O..O..']],
  ['frog', 'Frog', null, ['.WW..WW.', 'WKWGGWKW', 'GGGGGGGG', 'GGGGGGGG', 'GRRRRRRG', 'GGGGGGGG', '.GG..GG.', 'GG....GG']],
  ['alien', 'Alien', null, ['..LLLL..', '.LLLLLL.', 'LLLLLLLL', 'LKKLLKKL', 'LKKLLKKL', '.LLLLLL.', '..LLLL..', '...LL...']],
  ['knight', 'Knight', null, ['...RR...', '..RRSS..', '.SSSSSS.', '.SKKKKS.', '.SSSSSS.', '.SKSSKS.', '.SSSSSS.', '..SSSS..']],
  ['heart', 'Heart', null, ['.RR..RR.', 'RWRRRRRR', 'RRRRRRRR', 'RRRRRRRR', '.RRRRRR.', '..RRRR..', '...RR...', '........']],
  ['star', 'Star', null, ['...YY...', '...YY...', 'YYYYYYYY', '.YYYYYY.', '..YYYY..', '.YYYYYY.', '.YY..YY.', 'YY....YY']],
  ['bolt', 'Bolt', null, ['....YYY.', '...YYY..', '..YYY...', '.YYYYYY.', '....YYY.', '...YYY..', '..YY....', '.Y......']],
  ['crown', 'Crown', null, ['........', 'Y..YY..Y', 'YY.YY.YY', 'YYYYYYYY', 'YRYYBYRY', 'YYYYYYYY', 'YYYYYYYY', '........']],
  ['sword', 'Sword', null, ['.......S', '......SS', '.....SS.', 'Y..SS...', '.YSS....', '..YY....', '.N..Y...', 'N.......']],
  ['potion', 'Potion', null, ['...NN...', '...SS...', '...SS...', '..SPPS..', '.SPPPPS.', '.PWPPPP.', '.PPPPPP.', '..PPPP..']],
  ['mushroom', 'Mushroom', null, ['..RRRR..', '.RWRRWR.', 'RRRRRRRR', 'RWRRRRWR', 'RRRRRRRR', '..TTTT..', '..TKKT..', '..TTTT..']],
  ['rocket', 'Rocket', null, ['...WW...', '..WWWW..', '..WBBW..', '..WWWW..', '..WWWW..', '.RWWWWR.', 'RR.OO.RR', '...OO...']],
  ['snake', 'Snake', null, ['.GGGG...', 'GKGGGG..', 'GGGGGG..', 'RR..GG..', '.....GG.', '..GGGGG.', '.GG.....', '.GGGGGG.']],
  ['ufo', 'UFO', null, ['...CC...', '..CCCC..', '.SSSSSS.', 'SSSSSSSS', 'SYSYSYSY', '.SSSSSS.', '..Y..Y..', '.Y....Y.']],
  ['dice', 'Dice', null, ['WWWWWWWW', 'WKKWWKKW', 'WKKWWKKW', 'WWWWWWWW', 'WWWWWWWW', 'WKKWWKKW', 'WKKWWKKW', 'WWWWWWWW']],
  ['joystick', 'Joystick', null, ['..RR....', '.RRRR...', '.RRRR...', '..KK....', '..KK....', 'BBBBBBB.', '.BBBBRB.', 'BBBBBBBB']],
  ['cherry', 'Cherry', null, ['.....GG.', '....G...', '...G.G..', '..G...G.', '.RR..RR.', 'RWRRRWRR', 'RRRRRRRR', '.RR..RR.']],
  ['diamond', 'Diamond', null, ['........', '.CCCCCC.', 'CWWCCCCB', 'CCCCCCCB', '.CCCCCB.', '..CCCB..', '...CB...', '........']],
  ['flame', 'Flame', null, ['...R....', '..RR.R..', '..RRRR..', '.RRORRR.', '.RROORR.', 'RROYYORR', 'RROYYORR', '.RRRRRR.']],
  ['moon', 'Moon', null, ['..YYY...', '.YYY....', 'YYY.....', 'YYY.....', 'YYY.....', 'YYYY....', '.YYYYYY.', '..YYYY..']],
];

export const AVATARS = DEFS.map(([id, label]) => ({ id, label }));

const cache = new Map();
function svgMarkup(id) {
  if (cache.has(id)) return cache.get(id);
  const def = DEFS.find((d) => d[0] === id) || DEFS[0];
  const [, label, body, rows] = def;
  let rects = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < 8; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      rects += `<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="${ch === 'X' ? body : PAL[ch]}"/>`;
    }
  });
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" shape-rendering="crispEdges" role="img" aria-label="${label} avatar">${rects}</svg>`;
  cache.set(id, markup);
  return markup;
}

// An <span class="avatar"> element holding the avatar at the given CSS pixel size.
// Equipped cosmetics (from publicUser().cosmetics) as CSS classes; null when nothing is equipped.
// The current room's signed-in players by nickname, so shared game UI (results) can show cosmetics.
let roomAccounts = new Map();
export const setRoomRoster = (roster) => { roomAccounts = new Map(roster.filter((e) => e.account).map((e) => [e.nickname, e.account])); };
export const roomAccount = (nickname) => roomAccounts.get(nickname) || null;

export const nameColor = (c) => (c && c.nameColor ? `nc-${c.nameColor}` : null);

export function avatarEl(id, size = 32, cosmetics = null) {
  const span = document.createElement('span');
  span.className = cosmetics && cosmetics.frame ? `avatar af af-${cosmetics.frame}` : 'avatar';
  span.style.width = span.style.height = `${size}px`;
  span.innerHTML = svgMarkup(id);
  return span;
}
