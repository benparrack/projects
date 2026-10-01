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
};
