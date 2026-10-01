// Draft crew scripts for tools/search.mjs. '$x' values are searched over params.x.
const R = (a, b, s) => { const o = []; for (let v = a; v <= b; v += s) o.push(v); return o; };

export const DRAFTS = {
  keycard: {
    params: { a: R(0, 120, 6), b: R(0, 200, 10), c: R(0, 240, 10) },
    crew: [
      { role: 'ghost', cmds: [
        { to: [7, 2] }, { use: true }, { wait: '$a' }, { path: [[9, 2], [16, 1]] }, { use: true }, { wait: '$b' },
        { path: [[12, 3]] }, { use: true }, { path: [[12, 5], [21, 6]] }, { use: true }, { wait: '$c' },
        { path: [[12, 5], [12, 3], [9, 2], [2, 2]] }, { use: true },
      ] },
    ],
  },
  'keycard#crack': {
    params: { a: R(0, 120, 10), c: R(0, 240, 20) },
    crew: [
      { role: 'cracker', cmds: [
        { to: [7, 2] }, { use: true }, { wait: '$a' }, { path: [[9, 2], [12, 3]] }, { hold: 62 },
        { path: [[12, 5], [21, 6]] }, { use: true }, { wait: '$c' },
        { path: [[12, 5], [12, 3], [9, 2], [2, 2]] }, { use: true },
      ] },
    ],
  },
  'closed-circuit': {
    params: { a: R(0, 300, 20), h: R(150, 260, 10), w: R(0, 80, 10) },
    crew: [
      { role: 'hacker', cmds: [
        { to: [4, 6] }, { hold: 42 }, { wait: '$h' }, { hold: 42 }, { path: [[2, 3], [2, 2]] }, { use: true },
      ] },
      { role: 'ghost', cmds: [
        { path: [[2, 4], [6, 4]] }, { use: true }, { wait: '$w' }, { path: [[8, 4], [24, 4]] }, { use: true },
        { path: [[8, 4], [5, 4], [2, 2]] }, { use: true },
      ] },
    ],
  },
  blackout: {
    params: { b: R(0, 300, 5) },
    crew: [
      { role: 'ghost', cmds: [
        { to: [5, 2] }, { use: true }, { path: [[7, 2], [10, 2], [10, 3]] }, { use: true }, { path: [[10, 5], [8, 5]] }, { hold: 32 },
        { path: [[10, 5], [10, 2], [19, 2]] }, { use: true }, { path: [[21, 2], [24, 2]] }, { use: true }, { wait: '$b' },
        { path: [[21, 2], [7, 2], [5, 2], [2, 2]] }, { use: true },
      ] },
    ],
  },
  'heavy-hands': {
    params: { a: R(300, 1000, 5), b: R(0, 60, 10) },
    crew: [
      { role: 'muscle', cmds: [
        { wait: '$a' }, { path: [[6, 2]] }, { use: true }, { path: [[8, 2], [12, 2]] }, { to: [15, 2], sneak: true }, { use: true },
        { wait: 2 }, { use: true }, { to: [17, 2] }, { use: true }, { path: [[19, 2], [19, 5]] }, { use: true }, { wait: '$b' },
        { path: [[23, 5]], sneak: true }, { use: true },
        { path: [[24, 2], [24, 1]] }, { use: true }, { path: [[24, 2], [8, 2], [2, 2]] }, { use: true },
      ] },
    ],
  },
};
