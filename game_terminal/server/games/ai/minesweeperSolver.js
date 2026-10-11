// Minesweeper bot brain. Works only from what a player can see: a cell array of codes
// (-1 hidden, -2 flagged, -3 exploded mine, 0..8 opened number), never the mine layout.
// Deduction = single-cell rules + (optionally) the subset rule; when stuck it guesses the hidden
// cell least likely to be a mine. Level sets how far the deduction goes and how often it slips.

'use strict';

const LEVEL = {
  easy: { ms: [1000, 1600], subset: false, slip: 0.06, smartGuess: false },
  medium: { ms: [650, 1000], subset: false, slip: 0.02, smartGuess: true },
  hard: { ms: [380, 600], subset: true, slip: 0, smartGuess: true },
  expert: { ms: [200, 320], subset: true, slip: 0, smartGuess: true },
};

function neighbors(cols, rows, i) {
  const r = Math.floor(i / cols);
  const c = i % cols;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push(rr * cols + cc);
    }
  }
  return out;
}

// Returns { safe: Set, mines: Set, constraints } deduced from the visible cells.
function deduce({ cols, rows, cell }, subset) {
  const mines = new Set();
  const safe = new Set();
  cell.forEach((v, i) => { if (v === -3) mines.add(i); });
  const unknown = (j) => (cell[j] === -1 || cell[j] === -2) && !mines.has(j) && !safe.has(j);
  let changed = true;
  let cons = [];
  while (changed) {
    changed = false;
    cons = [];
    for (let i = 0; i < cell.length; i++) {
      if (cell[i] < 1) continue;
      const nb = neighbors(cols, rows, i);
      const set = nb.filter(unknown);
      if (!set.length) continue;
      const need = cell[i] - nb.filter((j) => mines.has(j)).length;
      if (need <= 0) { set.forEach((j) => safe.add(j)); changed = true; continue; }
      if (need === set.length) { set.forEach((j) => mines.add(j)); changed = true; continue; }
      cons.push({ set, need });
    }
    if (changed || !subset) continue;
    for (const a of cons) {
      for (const b of cons) {
        if (a === b || a.set.length >= b.set.length || !a.set.every((j) => b.set.includes(j))) continue;
        const rest = b.set.filter((j) => !a.set.includes(j));
        const m = b.need - a.need;
        if (m === 0) { rest.forEach((j) => safe.add(j)); changed = true; }
        else if (m === rest.length) { rest.forEach((j) => mines.add(j)); changed = true; }
      }
      if (changed) break;
    }
  }
  return { safe, mines, cons };
}

// Next cell to open. totalMines lets the guesser price non-frontier cells.
function pickMove(view, level, rng = Math.random) {
  const cfg = LEVEL[level] || LEVEL.hard;
  const { safe, mines, cons } = deduce(view, cfg.subset);
  const hidden = [];
  view.cell.forEach((v, i) => { if (v === -1 && !mines.has(i)) hidden.push(i); });
  if (!hidden.length) return null;
  if (rng() < cfg.slip) return hidden[Math.floor(rng() * hidden.length)];
  const safeHidden = [...safe].filter((i) => view.cell[i] === -1);
  if (safeHidden.length) return safeHidden[0];
  if (!cfg.smartGuess) return hidden[Math.floor(rng() * hidden.length)];
  const risk = new Map();
  for (const { set, need } of cons) for (const j of set) risk.set(j, Math.max(risk.get(j) || 0, need / set.length));
  const left = view.mines - mines.size;
  // shortcut: off-frontier risk = mine density over all hidden cells, not an exact count.
  const restRisk = Math.max(0, left) / hidden.length;
  let best = null;
  let bestP = Infinity;
  for (const i of hidden) {
    const p = (risk.has(i) ? risk.get(i) : restRisk) + rng() * 0.01;
    if (p < bestP) { bestP = p; best = i; }
  }
  return best;
}

module.exports = { LEVEL, neighbors, deduce, pickMove };
