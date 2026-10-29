// Tuning and enums shared by the sim, the renderer and the tests.
import { SUB } from './fixed.js';

export const TICK_RATE = 20;                  // sim ticks per second

// Input bitmask, one byte per tick per crew member.
export const IN = {
  UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8,
  SNEAK: 16,     // half speed, silent
  USE: 32,       // held; a press triggers instant actions, holding drives timed ones
  ABILITY: 64,   // role ability (press)
};
export const MOVE_MASK = IN.UP | IN.DOWN | IN.LEFT | IN.RIGHT;

export const ACTOR_HALF = 80;                 // collision half-size in sub-units
export const WALK_SPEED = 34;                 // sub-units per tick (~2.7 tiles/s)
export const SNEAK_SPEED = 17;
export const CARRY_FACTOR = 3;                // speed * 3/4 while carrying loot
export const DIAG = 181;                      // 1/sqrt(2) * 256
export const REACH = SUB + 96;                // interaction reach from actor centre
export const WALK_NOISE = SUB * 3;            // footstep hearing radius
export const CARRY_NOISE = SUB * 4;

// Desync tolerance: a clone further than this from its recorded path is lost.
export const DESYNC_DIST = 72;

export const ROLES = {
  ghost:   { name: 'Ghost',   color: '#5ef2c2', blurb: 'Sneaks faster. Ability: whistle to lure guards.' },
  hacker:  { name: 'Hacker',  color: '#5ab8ff', blurb: 'Uses terminals: unlock doors, loop cameras.' },
  cracker: { name: 'Cracker', color: '#ffc94d', blurb: 'Picks locks and cracks vaults.' },
  muscle:  { name: 'Muscle',  color: '#ff7a59', blurb: 'Takes guards down from behind. Can carry bodies.' },
};

// Hold times (ticks) for timed interactions.
export const HOLD = {
  powerbox: 30,
  terminal: 40,
  lockpick: 60,
  vault: 100,
  restorePower: 50,
};

export const WHISTLE_NOISE = SUB * 9;
export const WHISTLE_COOLDOWN = 60;
export const GHOST_SNEAK_SPEED = 26;
