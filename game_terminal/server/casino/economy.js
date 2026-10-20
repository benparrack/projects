// Casino money numbers in one place, so the economy can be tuned without hunting through games.
'use strict';

module.exports = {
  START_BALANCE: 100, // new accounts and every guest visit
  STIPEND: 25, // claimable once per UTC day from the casino lobby
  SHIFT_CAP: 6, // paid work shifts per UTC day
  JACKPOT_SEED: 500, // the site-wide slots jackpot restarts here after a hit
  JACKPOT_CUT: 0.01, // share of every account's slot bet that feeds the jackpot (out of the house's edge)
};
