// Reference solutions: one bot script per crew member, in recording order. The
// level tests replay these to prove every handcrafted heist is beatable, and they
// double as a sanity check whenever guard or security tuning changes.
export const SOLUTIONS = {
  'night-shift': [
    { role: 'ghost', cmds: [
      { to: [8, 2] }, { use: true }, { wait: 44 }, { path: [[10, 2], [17, 2]] }, { use: true },
      { path: [[19, 2], [23, 3]] }, { use: true }, { wait: 8 }, { path: [[19, 2], [10, 2], [2, 2]] }, { use: true },
    ] },
  ],
  'double-act': [
    { role: 'ghost', cmds: [
      { path: [[1, 5], [11, 5]] }, { use: true }, { path: [[13, 5], [15, 6]] }, { ability: true },
      { path: [[13, 5], [6, 5]] }, { wait: 150 },
      { path: [[11, 5], [13, 5], [15, 6]] }, { ability: true }, { path: [[13, 5], [6, 5], [2, 3], [2, 2]] }, { use: true },
    ] },
    { role: 'cracker', cmds: [
      { wait: 40 }, { path: [[2, 2], [7, 2]] }, { use: true }, { path: [[9, 2], [23, 2]] }, { use: true },
      { path: [[25, 2], [26, 3], [28, 5]] }, { hold: 62 }, { to: [27, 6] }, { use: true },
      { to: [26, 3] }, { wait: 60 }, { path: [[25, 2], [9, 2], [2, 2]] }, { use: true },
    ] },
  ],
  keycard: [
    { role: 'ghost', cmds: [
      { to: [7, 2] }, { use: true }, { wait: 72 }, { path: [[9, 2], [16, 1]] }, { use: true }, { wait: 70 },
      { path: [[12, 3]] }, { use: true }, { path: [[12, 5], [21, 6]] }, { use: true }, { wait: 230 },
      { path: [[12, 5], [12, 3], [9, 2], [2, 2]] }, { use: true },
    ] },
  ],
  // Alternative routes ('level#variant') are checked by the tests too.
  'keycard#crack': [
    { role: 'cracker', cmds: [
      { to: [7, 2] }, { use: true }, { wait: 80 }, { path: [[9, 2], [12, 3]] }, { hold: 62 },
      { path: [[12, 5], [21, 6]] }, { use: true }, { wait: 240 },
      { path: [[12, 5], [12, 3], [9, 2], [2, 2]] }, { use: true },
    ] },
  ],
  'closed-circuit': [
    { role: 'hacker', cmds: [
      { to: [4, 6] }, { hold: 42 }, { wait: 190 }, { hold: 42 }, { path: [[2, 3], [2, 2]] }, { use: true },
    ] },
    { role: 'ghost', cmds: [
      { path: [[2, 4], [6, 4]] }, { use: true }, { wait: 60 }, { path: [[8, 4], [24, 4]] }, { use: true },
      { path: [[8, 4], [5, 4], [2, 2]] }, { use: true },
    ] },
  ],
  blackout: [
    { role: 'ghost', cmds: [
      { to: [5, 2] }, { use: true }, { path: [[7, 2], [10, 2], [10, 3]] }, { use: true }, { path: [[10, 5], [8, 5]] }, { hold: 32 },
      { path: [[10, 5], [10, 2], [19, 2]] }, { use: true }, { path: [[21, 2], [24, 2]] }, { use: true }, { wait: 60 },
      { path: [[21, 2], [7, 2], [5, 2], [2, 2]] }, { use: true },
    ] },
  ],
  'heavy-hands': [
    { role: 'muscle', cmds: [
      { wait: 480 }, { path: [[6, 2]] }, { use: true }, { path: [[8, 2], [12, 2]] }, { to: [15, 2], sneak: true }, { use: true },
      { wait: 2 }, { use: true }, { to: [17, 2] }, { use: true }, { path: [[19, 2], [19, 5]] }, { use: true }, { wait: 20 },
      { path: [[23, 5]], sneak: true }, { use: true }, { path: [[24, 2], [24, 1]] }, { use: true },
      { path: [[24, 2], [8, 2], [2, 2]] }, { use: true },
    ] },
  ],
  // Hacker unlocks the strongroom, Ghost walks Rex all the way to the van with three
  // whistles, Cracker hides in the office, cracks the vault and waits out Rex's return.
  relay: [
    { role: 'hacker', cmds: [
      { to: [6, 2] }, { use: true }, { path: [[8, 2], [12, 2], [12, 3]] }, { use: true }, { path: [[12, 5], [9, 5]] }, { hold: 42 },
      { path: [[12, 5], [12, 3], [8, 2], [2, 2]] }, { use: true },
    ] },
    { role: 'ghost', cmds: [
      { wait: 60 }, { path: [[6, 2], [17, 2]] }, { use: true }, { to: [15, 2] }, { wait: 20 }, { ability: true },
      { to: [8, 2] }, { wait: 10 }, { ability: true }, { path: [[6, 2], [4, 5]] }, { wait: 20 }, { ability: true },
      { path: [[2, 3], [2, 2]] }, { use: true },
    ] },
    { role: 'cracker', cmds: [
      { wait: 60 }, { path: [[6, 2], [12, 2], [12, 5], [15, 6]] }, { wait: 130 },
      { path: [[12, 5], [12, 2], [19, 2], [22, 5], [26, 3]] }, { hold: 72 }, { use: true },
      { path: [[22, 6], [19, 6]] }, { wait: 340 },
      { path: [[19, 3], [19, 2], [17, 2]], sneak: true }, { path: [[6, 2], [2, 2]] }, { use: true },
    ] },
  ],
  // Hacker keeps the gallery cameras looped, Ghost whistles Nell out and hides, Muscle
  // ambushes her as she returns (just after the 45s radio check) and cuts the laser
  // power, Cracker waits in the antechamber for the grid to drop.
  'grand-vault': [
    { role: 'hacker', cmds: [
      { to: [6, 2] }, { use: true }, { wait: 90 }, { path: [[8, 2], [11, 2], [11, 3]] }, { use: true }, { path: [[11, 5], [10, 6]] }, { hold: 42 },
      { wait: 420 }, { hold: 42 }, { wait: 420 }, { hold: 42 }, { wait: 40 }, { path: [[11, 5], [11, 2], [8, 2], [2, 2]] }, { use: true },
    ] },
    { role: 'ghost', cmds: [
      { wait: 800 }, { path: [[6, 2], [15, 2]] }, { wait: 10 }, { ability: true }, { path: [[12, 2], [11, 3], [11, 5], [13, 7]] },
      { wait: 300 }, { path: [[11, 5], [11, 2], [6, 2], [2, 2]] }, { use: true },
    ] },
    { role: 'muscle', cmds: [
      { wait: 500 }, { path: [[6, 2], [11, 2], [11, 5], [12, 5]] }, { wait: 358 }, { path: [[11, 3], [15, 3]], sneak: true },
      { use: true }, { wait: 2 }, { use: true }, { path: [[16, 2], [16, 5], [17, 6]] }, { use: true }, { to: [19, 6] }, { hold: 32 },
      { path: [[16, 5], [16, 2], [6, 2], [2, 2]] }, { use: true },
    ] },
    { role: 'cracker', cmds: [
      { wait: 450 }, { path: [[6, 2], [20, 2]] }, { use: true }, { path: [[22, 2], [24, 3]] }, { wait: 700 },
      { path: [[26, 3], [29, 3]] }, { hold: 102 }, { use: true }, { path: [[26, 3], [22, 2], [20, 2], [6, 2], [2, 2]] }, { use: true },
    ] },
  ],
  showroom: [
    { role: 'ghost', cmds: [
      { path: [[2, 3], [4, 3]], sneak: true }, { use: true }, { wait: 320 },
      { path: [[6, 3], [26, 3], [27, 4]], sneak: true }, { use: true }, { wait: 180 },
      { path: [[27, 3], [6, 3], [2, 3], [2, 2]], sneak: true }, { use: true },
    ] },
  ],
  'showroom#loop': [
    { role: 'hacker', cmds: [{ to: [2, 6] }, { wait: 60 }, { hold: 42 }, { path: [[2, 3], [2, 2]] }, { use: true }] },
    { role: 'ghost', cmds: [
      { path: [[2, 3], [4, 3]], sneak: true }, { use: true }, { wait: 110 },
      { path: [[6, 3], [26, 3], [27, 4]], sneak: true }, { use: true },
      { path: [[27, 3], [6, 3], [2, 3], [2, 2]], sneak: true }, { use: true },
    ] },
  ],
};
