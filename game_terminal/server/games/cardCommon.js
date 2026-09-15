// Shared helpers for the standard-52-card games (War, Crazy Eights, BS, Poker) — deck creation,
// shuffling, and rank comparison. Kept separate from any one game's file since all four need it.

const SUITS = ['S', 'H', 'D', 'C']; // spades, hearts, diamonds, clubs
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED_SUITS = new Set(['H', 'D']);

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit });
  }
  return deck;
}

// Fisher-Yates. Math.random is fine here — these are casual friend games, not anything where
// shuffle unpredictability needs to be cryptographically defensible.
function shuffle(deck) {
  const arr = deck.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// '2'->2 ... '10'->10, 'J'->11, 'Q'->12, 'K'->13, 'A'->14 (ace-high; games needing ace-low handle
// that themselves rather than complicating this shared helper).
function rankValue(rank) {
  return RANKS.indexOf(rank) + 2;
}

module.exports = { SUITS, RANKS, SUIT_GLYPH, RED_SUITS, createDeck, shuffle, rankValue };
