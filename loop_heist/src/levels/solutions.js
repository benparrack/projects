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
};
