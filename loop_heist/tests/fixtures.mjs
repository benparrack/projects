// Small test levels.
export const corridor = {
  id: 'test-corridor',
  loopSeconds: 60,
  map: [
    '##########',
    '#S...#..E#',
    '#S...D..E#',
    '#S...#..E#',
    '##########',
  ],
  entities: [
    { type: 'door', id: 'd1', x: 5, y: 2 },
  ],
};

export const guarded = {
  id: 'test-guarded',
  loopSeconds: 60,
  map: [
    '################',
    '#S.............#',
    '#S.............#',
    '#..............#',
    '#.............E#',
    '################',
  ],
  entities: [
    { type: 'guard', id: 'g1', x: 12, y: 1, route: [[12, 1, 40, 's'], [12, 3, 40, 'w']] },
  ],
};

export const security = {
  id: 'test-security',
  loopSeconds: 60,
  map: [
    '##############',
    '#S...........#',
    '#S...........#',
    '#............#',
    '#...........E#',
    '##############',
  ],
  entities: [
    { type: 'powerbox', id: 'pb', x: 2, y: 3, circuit: 'A', response: 100 },
    { type: 'laser', id: 'L1', x: 7, y: 1, len: 4, dir: 'v', circuit: 'A' },
    { type: 'guard', id: 'g1', x: 12, y: 1, facing: 'n' },
  ],
};

export const vault = {
  id: 'test-vault',
  loopSeconds: 90,
  map: [
    '############',
    '#S........E#',
    '#S........E#',
    '#.....#....#',
    '############',
  ],
  entities: [
    { type: 'vault', id: 'v1', x: 6, y: 3, crackTicks: 40 },
    { type: 'loot', id: 'gold', x: 5, y: 3, value: 5000, required: true, vault: 'v1' },
  ],
};
