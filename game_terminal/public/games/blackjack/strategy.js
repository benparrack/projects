// Client copy of the server's blackjack math (server/games/blackjack.js) for hand totals and the
// basic-strategy hint. Kept tiny and pure; test/blackjack.test.js checks the two copies agree on
// every hand/upcard combination.

export const cardValue = (c) => (c.rank === 'A' ? 11 : ['10', 'J', 'Q', 'K'].includes(c.rank) ? 10 : Number(c.rank));

export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (!c) continue;
    total += cardValue(c);
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

// 6 decks, dealer stands on soft 17, double after split, no surrender.
export function basicStrategy(cards, up, { canDouble = true, canSplit = true } = {}) {
  const { total, soft } = handValue(cards);
  if (canSplit && cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1])) {
    const p = cardValue(cards[0]);
    const split =
      p === 11 || p === 8 ||
      (p === 9 && up !== 7 && up !== 10 && up !== 11) ||
      ((p === 7 || p === 3 || p === 2) && up <= 7) ||
      (p === 6 && up <= 6) ||
      (p === 4 && (up === 5 || up === 6));
    if (split) return 'split';
  }
  const dbl = (cond, otherwise) => (cond ? (canDouble ? 'double' : otherwise) : null);
  if (soft && total <= 21 && cards.length >= 2) {
    if (total >= 19) return 'stand';
    if (total === 18) return dbl(up >= 3 && up <= 6, 'stand') || (up <= 8 ? 'stand' : 'hit');
    if (total === 17) return dbl(up >= 3 && up <= 6, 'hit') || 'hit';
    if (total === 15 || total === 16) return dbl(up >= 4 && up <= 6, 'hit') || 'hit';
    if (total === 13 || total === 14) return dbl(up >= 5 && up <= 6, 'hit') || 'hit';
    return 'hit';
  }
  if (total >= 17) return 'stand';
  if (total >= 13) return up <= 6 ? 'stand' : 'hit';
  if (total === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit';
  if (total === 11) return dbl(up <= 10, 'hit') || 'hit';
  if (total === 10) return dbl(up <= 9, 'hit') || 'hit';
  if (total === 9) return dbl(up >= 3 && up <= 6, 'hit') || 'hit';
  return 'hit';
}

const WHY = {
  split: 'Split this pair',
  double: 'Double down',
  hit: 'Hit',
  stand: 'Stand',
};
export const adviceLabel = (a) => WHY[a] || a;
