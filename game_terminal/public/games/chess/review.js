// Pure helpers for Chess's post-game review (no DOM) — FEN parsing, eval formatting and move
// classification. Kept separate from client.js so Node tests can import them directly.

const FEN_TYPES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

// FEN piece placement -> board[r][c] = { color, type } | null (r = 0 is rank 8, like the server).
export function fenToBoard(fen) {
  const rows = String(fen || '').split(' ')[0].split('/');
  const board = [];
  for (let r = 0; r < 8; r++) {
    const row = [];
    for (const ch of rows[r] || '') {
      if (/[1-8]/.test(ch)) for (let i = 0; i < Number(ch); i++) row.push(null);
      else if (FEN_TYPES[ch.toLowerCase()]) row.push({ color: ch === ch.toUpperCase() ? 'white' : 'black', type: FEN_TYPES[ch.toLowerCase()] });
    }
    while (row.length < 8) row.push(null);
    board.push(row.slice(0, 8));
  }
  return board;
}

export const fenTurn = (fen) => (String(fen || '').split(' ')[1] === 'b' ? 'black' : 'white');

// Engine evals are { cp } or { mate } from White's point of view; { mate: 0, winner } = checkmated.
// Expected score for White in percent (lichess's logistic curve), mates pinned to 0/100.
export function whiteWinPct(ev) {
  if (!ev) return 50;
  if (ev.mate != null) {
    if (ev.mate === 0) return ev.winner === 'white' ? 100 : ev.winner === 'black' ? 0 : 50;
    return ev.mate > 0 ? 100 : 0;
  }
  const cp = Math.max(-2000, Math.min(2000, ev.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function formatEval(ev) {
  if (!ev) return '…';
  if (ev.mate != null) {
    if (ev.mate === 0) return ev.winner === 'white' ? '1-0' : ev.winner === 'black' ? '0-1' : '½-½';
    return `${ev.mate > 0 ? '+' : '-'}M${Math.abs(ev.mate)}`;
  }
  const p = ev.cp / 100;
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(1)}`;
}

export const CLASSES = {
  best: { label: 'Best', mark: '★', color: '#39ff14' },
  good: { label: 'Good', mark: '', color: '#9fd89a' },
  inaccuracy: { label: 'Inaccuracy', mark: '?!', color: '#ffd23f' },
  mistake: { label: 'Mistake', mark: '?', color: '#ff9f3f' },
  blunder: { label: 'Blunder', mark: '??', color: '#ff4d4d' },
};

const sameMove = (a, b) => a && b && a.from.r === b.from.r && a.from.c === b.from.c && a.to.r === b.to.r && a.to.c === b.to.c
  && (a.promotion || null) === (b.promotion || null);

// Classify the move played from analysis[i] (position before) to analysis[i + 1] (position after),
// by how much of the mover's expected score it threw away. null until both evals are in.
export function classifyMove(move, before, after) {
  if (!move || !before || !after || !before.eval || !after.eval) return null;
  if (before.best && sameMove(before.best, move)) return 'best';
  const mover = move.color === 'white' ? 1 : -1;
  const pBefore = mover > 0 ? whiteWinPct(before.eval) : 100 - whiteWinPct(before.eval);
  const pAfter = mover > 0 ? whiteWinPct(after.eval) : 100 - whiteWinPct(after.eval);
  const drop = pBefore - pAfter;
  // Delivering mate is always Best.
  if (after.eval.mate === 0 && after.eval.winner === move.color) return 'best';
  if (drop >= 30) return 'blunder';
  if (drop >= 18) return 'mistake';
  if (drop >= 9) return 'inaccuracy';
  return drop <= 1 ? 'best' : 'good';
}

// Accuracy-ish summary per side: counts of each class over the classified moves.
export function summarize(moves, analysis) {
  const out = { white: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }, black: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 } };
  moves.forEach((m, i) => {
    const k = classifyMove(m, analysis[i], analysis[i + 1]);
    if (k) out[m.color][k]++;
  });
  return out;
}

// Clamp a review index into [0, plies] — used by every navigation key/button.
export const clampIndex = (i, plies) => Math.max(0, Math.min(plies, i | 0));
