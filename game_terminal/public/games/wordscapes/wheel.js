// Pure helpers for the Wordscapes client (no DOM) — imported by client.js and by
// test/wordscapes.test.js.

// n points evenly around a circle, first one at 12 o'clock.
export function wheelPositions(n, cx, cy, r) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    out.push({ x: Math.round((cx + r * Math.cos(a)) * 10) / 10, y: Math.round((cy + r * Math.sin(a)) * 10) / 10 });
  }
  return out;
}

// Index of the position within `radius` of point p (closest wins), or -1.
export function hitNode(positions, p, radius) {
  let best = -1;
  let bestD = radius * radius;
  positions.forEach((q, i) => {
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d <= bestD) { bestD = d; best = i; }
  });
  return best;
}

// Dragging over letter `idx`: append it if unused; dragging back onto the previous letter undoes
// the last one (like Wordscapes). Returns the SAME array when nothing changes.
export function applyDragNode(sel, idx) {
  if (sel[sel.length - 1] === idx) return sel;
  if (sel.length >= 2 && sel[sel.length - 2] === idx) return sel.slice(0, -1);
  if (sel.includes(idx)) return sel;
  return [...sel, idx];
}

// Typing letter `ch`: the first unused wheel index holding it, or -1.
export function keyPick(letters, sel, ch) {
  for (let i = 0; i < letters.length; i++) if (letters[i] === ch && !sel.includes(i)) return i;
  return -1;
}

// Largest cell size (px, 18..46) so a cols x rows grid with 3px gaps fits maxW x maxH.
export function fitCell(maxW, cols, rows, maxH) {
  const byW = Math.floor((maxW - (cols - 1) * 3) / cols);
  const byH = Math.floor((maxH - (rows - 1) * 3) / rows);
  return Math.max(18, Math.min(46, byW, byH));
}

const SCENES = [
  { name: 'DAWN MEADOW', sky: 'linear-gradient(180deg,#ff9a8b 0%,#ff6a88 45%,#5b3a7a 100%)', sun: 'radial-gradient(circle,#fff5c0,#ffcf6b 60%,transparent 70%)', hill: '#3b6e4f', hill2: '#24493a' },
  { name: 'OCEAN CLIFFS', sky: 'linear-gradient(180deg,#5ee7df 0%,#3a8fd9 50%,#14306b 100%)', sun: 'radial-gradient(circle,#ffffff,#d6f6ff 55%,transparent 70%)', hill: '#1e5f74', hill2: '#123c52' },
  { name: 'PINE FOREST', sky: 'linear-gradient(180deg,#a8e063 0%,#3f8f5a 55%,#0f2f24 100%)', sun: 'radial-gradient(circle,#fdffd8,#e7f59e 55%,transparent 70%)', hill: '#1d4a32', hill2: '#0e2c1e' },
  { name: 'DESERT DUNES', sky: 'linear-gradient(180deg,#ffd194 0%,#e8915a 50%,#7a3b2e 100%)', sun: 'radial-gradient(circle,#fffbe0,#ffd36b 55%,transparent 70%)', hill: '#b4683f', hill2: '#7d4128' },
  { name: 'NORTHERN LIGHTS', sky: 'linear-gradient(180deg,#0f2027 0%,#1f6f5c 45%,#2c1f5b 100%)', sun: 'radial-gradient(circle,#c9ffe8,#58f5b8 50%,transparent 70%)', hill: '#13283a', hill2: '#0a1622' },
  { name: 'LAVENDER FIELDS', sky: 'linear-gradient(180deg,#e0c3fc 0%,#a37bd8 50%,#3d2a6b 100%)', sun: 'radial-gradient(circle,#fff,#ffe1f3 55%,transparent 70%)', hill: '#5c3f8f', hill2: '#3b2763' },
  { name: 'CANYON SUNSET', sky: 'linear-gradient(180deg,#f83600 0%,#c2410c 45%,#3b1305 100%)', sun: 'radial-gradient(circle,#fff3c4,#ffb347 55%,transparent 70%)', hill: '#7a2a12', hill2: '#4a170a' },
  { name: 'ALPINE LAKE', sky: 'linear-gradient(180deg,#c9e8ff 0%,#6aa7d8 50%,#22406b 100%)', sun: 'radial-gradient(circle,#fff,#eaf6ff 55%,transparent 70%)', hill: '#46607a', hill2: '#2b3e52' },
];

export function sceneFor(level) {
  return SCENES[((Math.max(1, level | 0) - 1) % SCENES.length + SCENES.length) % SCENES.length];
}
