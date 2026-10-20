// Bot difficulty picker shared by every game with CPU players (server side: server/games/ai/
// levels.js). The last level picked is remembered per browser and used for the next "add bot".

export const LEVELS = [
  ['easy', 'Easy'],
  ['medium', 'Medium'],
  ['hard', 'Hard'],
  ['expert', 'Expert'],
];
const KEY = 'gt-bot-level';
const LABEL = Object.fromEntries(LEVELS);

export function preferredLevel() {
  try { return LABEL[localStorage.getItem(KEY)] ? localStorage.getItem(KEY) : 'hard'; } catch { return 'hard'; }
}

export const levelLabel = (level) => LABEL[level] || LABEL.hard;

// `level`, raised to `min` if it's easier (for money tables where easy bots would be free cash).
const ORDER = LEVELS.map(([v]) => v);
export const atLeast = (level, min) => (min && ORDER.indexOf(level) < ORDER.indexOf(min) ? min : level);

// <select> of levels (from `min` up). onChange(level) fires after the choice is remembered as the preference.
export function levelSelect(value, onChange, min) {
  const sel = document.createElement('select');
  sel.className = 'gt-bot-level';
  sel.title = 'Bot difficulty';
  sel.style.cssText = 'background:#0d1117;color:#3ad7ff;border:1px solid #3ad7ff;border-radius:4px;font:inherit;padding:2px 4px;cursor:pointer';
  for (const [v, label] of LEVELS.slice(min ? ORDER.indexOf(min) : 0)) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    sel.appendChild(o);
  }
  sel.value = atLeast(LABEL[value] ? value : 'hard', min);
  sel.addEventListener('change', () => {
    try { localStorage.setItem(KEY, sel.value); } catch { /* private mode */ }
    if (onChange) onChange(sel.value);
  });
  return sel;
}
