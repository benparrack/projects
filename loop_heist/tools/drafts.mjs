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
  relay: {
    params: { g: R(40, 80, 20), w: R(0, 40, 20), x: R(0, 60, 20), c: R(20, 60, 20), d: R(110, 150, 10), e: R(0, 400, 20) },
    crew: [
      { role: 'hacker', cmds: [
        { to: [6, 2] }, { use: true }, { path: [[8, 2], [12, 2], [12, 3]] }, { use: true }, { path: [[12, 5], [9, 5]] }, { hold: 42 },
        { path: [[12, 5], [12, 3], [8, 2], [2, 2]] }, { use: true },
      ] },
      { role: 'ghost', cmds: [
        { wait: '$g' }, { path: [[6, 2], [17, 2]] }, { use: true }, { to: [15, 2] }, { wait: '$w' }, { ability: true }, { to: [8, 2] }, { wait: 10 }, { ability: true },
        { path: [[6, 2], [4, 5]] }, { wait: '$x' }, { ability: true }, { path: [[2, 3], [2, 2]] }, { use: true },
      ] },
      { role: 'cracker', cmds: [
        { wait: '$c' }, { path: [[6, 2], [12, 2], [12, 5], [15, 6]] }, { wait: '$d' },
        { path: [[12, 5], [12, 2], [19, 2], [22, 5], [26, 3]] }, { hold: 72 }, { use: true },
        { path: [[22, 6], [19, 6]] }, { wait: '$e' },
        { path: [[19, 3], [19, 2], [17, 2]], sneak: true }, { path: [[6, 2], [2, 2]] }, { use: true },
      ] },
    ],
  },
};
DRAFTS['grand-vault'] = {
  params: { a: R(0, 120, 10) },
  crew: [
    { role: 'hacker', cmds: [
      { to: [6, 2] }, { use: true }, { wait: '$a' }, { path: [[8, 2], [11, 2], [11, 3]] }, { use: true }, { path: [[11, 5], [10, 6]] }, { hold: 42 },
      { wait: 2000 },
    ] },
  ],
};
DRAFTS['grand-vault'].params = { a: [90], b: R(380, 500, 20), g: R(0, 300, 20), w: R(0, 60, 20) };
DRAFTS['grand-vault'].crew = [
  { role: 'hacker', cmds: [
    { to: [6, 2] }, { use: true }, { wait: '$a' }, { path: [[8, 2], [11, 2], [11, 3]] }, { use: true }, { path: [[11, 5], [10, 6]] }, { hold: 42 },
    { wait: '$b' }, { hold: 42 }, { wait: '$b' }, { hold: 42 }, { wait: 40 }, { path: [[11, 5], [11, 2], [8, 2], [2, 2]] }, { use: true },
  ] },
  { role: 'ghost', cmds: [
    { wait: 600 }, { wait: '$g' }, { path: [[6, 2], [15, 2]] }, { wait: '$w' }, { ability: true }, { path: [[6, 2], [2, 2]] }, { use: true },
  ] },
];
DRAFTS['grand-vault'].params = { a: [90], b: [420], g: [200], w: [20], m: [600], k: R(150, 400, 5) };
DRAFTS['grand-vault'].crew.push(
  { role: 'muscle', cmds: [
    { wait: '$m' }, { path: [[6, 2], [20, 1]] }, { wait: '$k' }, { to: [17, 2], sneak: true }, { use: true }, { wait: 2 }, { use: true },
    { path: [[16, 2], [16, 5], [17, 5]] }, { use: true }, { to: [19, 6] }, { hold: 32 },
    { path: [[16, 5], [16, 2], [6, 2], [2, 2]] }, { use: true },
  ] },
);
DRAFTS['grand-vault'].params = { a: [90], b: [420], g: R(150, 250, 25), w: [10], v: R(0, 60, 20), m: [600], k: R(0, 300, 10), t: R(0, 300, 10) };
DRAFTS['grand-vault'].crew[1] = { role: 'ghost', cmds: [
  { wait: 600 }, { wait: '$g' }, { path: [[6, 2], [15, 2]] }, { wait: '$w' }, { ability: true }, { to: [8, 2] }, { wait: '$v' }, { ability: true },
  { path: [[6, 2], [2, 2]] }, { use: true },
] };
DRAFTS['grand-vault'].crew[2] = { role: 'muscle', cmds: [
  { wait: '$m' }, { path: [[6, 2], [20, 1], [22, 1]] }, { wait: '$k' }, { path: [[20, 2], [16, 2], [16, 5], [19, 6]], sneak: true }, { wait: '$t' },
  { to: [17, 7], sneak: true }, { use: true }, { to: [19, 6] }, { hold: 32 },
  { path: [[16, 5], [16, 2], [6, 2], [2, 2]] }, { use: true },
] };
DRAFTS['grand-vault'].params = { a: [90], b: [420], g: R(150, 250, 50), w: [10], m: [500], k: R(280, 400, 2), q: [[15, 3], [16, 3], [15, 2]] };
DRAFTS['grand-vault'].crew[1] = { role: 'ghost', cmds: [
  { wait: 600 }, { wait: '$g' }, { path: [[6, 2], [15, 2]] }, { wait: '$w' }, { ability: true }, { path: [[12, 2], [11, 3], [11, 5], [13, 7]] },
  { wait: 300 }, { path: [[11, 5], [11, 2], [6, 2], [2, 2]] }, { use: true },
] };
DRAFTS['grand-vault'].crew[2] = { role: 'muscle', cmds: [
  { wait: '$m' }, { path: [[6, 2], [11, 2], [11, 5], [12, 5]] }, { wait: '$k' }, { path: [[11, 3], '$q'], sneak: true }, { use: true }, { wait: 2 }, { use: true },
  { path: [[16, 2], [16, 5], [17, 6]] }, { use: true }, { to: [19, 6] }, { hold: 32 },
  { path: [[16, 5], [16, 2], [6, 2], [2, 2]] }, { use: true },
] };
DRAFTS['grand-vault'].params = { a: [90], b: [420], g: [200], w: [10], m: [500], k: [358], q: [[15, 3]], c: R(300, 800, 50), d: R(400, 900, 20) };
DRAFTS['grand-vault'].crew[3] = { role: 'cracker', cmds: [
  { wait: '$c' }, { path: [[6, 2], [20, 2], [22, 2], [24, 3]] }, { wait: '$d' },
  { path: [[26, 3], [29, 3]] }, { hold: 102 }, { use: true },
  { path: [[26, 3], [22, 2], [20, 2], [6, 2], [2, 2]] }, { use: true },
] };
DRAFTS['grand-vault'].crew[3].cmds.splice(1, 1, { path: [[6, 2], [20, 2]] }, { use: true }, { path: [[22, 2], [24, 3]] });
DRAFTS['grand-vault'].params.k = R(340, 380, 2);
DRAFTS['grand-vault'].params.c = R(300, 700, 50);
DRAFTS['grand-vault'].params.d = R(400, 800, 20);
