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
};
