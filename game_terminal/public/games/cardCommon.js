// Shared rendering helper for the standard-52-card games (War, Crazy Eights, BS, Poker) — one
// small DOM building block so all four don't reinvent "draw a card face".

export const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED_SUITS = new Set(['H', 'D']);

export function renderCard(card, { faceDown = false, small = false } = {}) {
  const el = document.createElement('div');
  const w = small ? 34 : 46;
  const h = small ? 48 : 64;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.borderRadius = '4px';
  el.style.display = 'flex';
  el.style.boxSizing = 'border-box';
  el.style.fontWeight = 'bold';
  el.style.flexShrink = '0';
  if (faceDown || !card) {
    el.style.background = 'repeating-linear-gradient(45deg, #1f8f0c, #1f8f0c 4px, #0a2e05 4px, #0a2e05 8px)';
    el.style.border = '1px solid #1f8f0c';
    return el;
  }
  el.style.background = '#f2f2f2';
  el.style.border = '1px solid #999';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.flexDirection = 'column';
  el.style.color = RED_SUITS.has(card.suit) ? '#c1121f' : '#111';
  el.style.fontSize = small ? '12px' : '15px';
  const rank = document.createElement('div');
  rank.textContent = card.rank;
  const suit = document.createElement('div');
  suit.textContent = SUIT_GLYPH[card.suit];
  suit.style.fontSize = small ? '14px' : '18px';
  el.appendChild(rank);
  el.appendChild(suit);
  return el;
}

export function renderHand(cards, opts) {
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '4px';
  row.style.flexWrap = 'wrap';
  for (const card of cards) row.appendChild(renderCard(card, opts));
  return row;
}
