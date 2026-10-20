// Casino money numbers in one place, so the economy can be tuned without hunting through games.
'use strict';

module.exports = {
  START_BALANCE: 100, // new accounts and every guest visit
  STIPEND: 25, // claimable once per UTC day from the casino lobby
  SHIFT_CAP: 6, // paid work shifts per UTC day
  JACKPOT_SEED: 500, // the site-wide slots jackpot restarts here after a hit
  JACKPOT_CUT: 0.01, // share of every account's slot bet that feeds the jackpot (out of the house's edge)
  VIP_BALANCE: 1000, // balance + money at tables that gets you into the high-roller room without the key
  // Lifetime amount wagered -> tier (going broke never demotes you).
  TIERS: [['Bronze', 0, '🥉'], ['Silver', 1000, '🥈'], ['Gold', 5000, '🥇'], ['Platinum', 25000, '💠'], ['Diamond', 100000, '💎']],
  // The casino shop. One item per slot is equipped; skins show only at casino tables, and nothing changes the odds.
  SHOP: [
    { id: 'felt-blue', slot: 'felt', name: 'Royal blue felt', price: 150 },
    { id: 'felt-red', slot: 'felt', name: 'Crimson felt', price: 150 },
    { id: 'felt-purple', slot: 'felt', name: 'Midnight purple felt', price: 300 },
    { id: 'felt-gold', slot: 'felt', name: 'Gold leaf felt', price: 1000 },
    { id: 'back-red', slot: 'back', name: 'Red classic card backs', price: 100 },
    { id: 'back-gold', slot: 'back', name: 'Gold foil card backs', price: 400 },
    { id: 'slots-neon', slot: 'slots', name: 'Neon slot machine', price: 200 },
    { id: 'slots-ruby', slot: 'slots', name: 'Ruby slot machine', price: 250 },
    { id: 'charm-clover', slot: 'charm', name: 'Four-leaf clover', glyph: '🍀', price: 50 },
    { id: 'charm-dice', slot: 'charm', name: 'Lucky dice', glyph: '🎲', price: 100 },
    { id: 'charm-cat', slot: 'charm', name: 'Black cat', glyph: '🐈‍⬛', price: 250 },
    { id: 'charm-crown', slot: 'charm', name: 'Crown', glyph: '👑', price: 2500 },
    { id: 'vip', slot: 'key', name: 'VIP key: the high-roller room at any balance', price: 750 },
  ],
};
