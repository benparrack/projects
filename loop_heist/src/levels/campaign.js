// Handcrafted heists. Each introduces one idea. Coordinates are tiles (x, y).
// Guard routes are [x, y, waitTicks, facingWhileWaiting].

export const LEVELS = [
  {
    id: 'night-shift',
    name: 'Night Shift',
    brief: 'One guard, one office, one envelope of cash. Learn to move, sneak and time a patrol.',
    tips: [
      'WASD / arrows move. Hold Shift to sneak (silent, slower).',
      'E / Space: use, open doors, pick up loot. Walk into the van and press E to escape.',
      'Guards see in a cone and notice anyone right next to them. Their "?" fills before the "!"',
    ],
    loopSeconds: 60,
    maxCrew: 1,
    roles: ['ghost'],
    par: { crew: 1, seconds: 30 },
    map: [
      '############################',
      '#EE......#........#........#',
      '#EE......D........D........#',
      '#S.......#........#........#',
      '#........#........#........#',
      '#........#........#........#',
      '############################',
    ],
    entities: [
      { type: 'door', id: 'A', x: 9, y: 2 },
      { type: 'door', id: 'B', x: 18, y: 2 },
      { type: 'guard', id: 'Walt', x: 13, y: 1, route: [[13, 1, 20, 's'], [13, 5, 80, 'e']] },
      { type: 'loot', id: 'envelope', x: 24, y: 3, value: 2500, required: true },
    ],
  },
  {
    id: 'double-act',
    name: 'Double Act',
    brief: 'A guard never leaves the hallway. You can\'t get past him alone... but you are never alone. Record one crew member to make noise, then send another past while he looks.',
    tips: [
      'Each crew member plays the same loop. Earlier ones replay exactly what you did.',
      'The Ghost can whistle (Q) to lure a guard to the spot.',
      'Everyone has to make it back to the van before the loop ends.',
    ],
    loopSeconds: 60,
    maxCrew: 2,
    roles: ['ghost', 'cracker'],
    par: { crew: 2, seconds: 40 },
    map: [
      '##############################',
      '#EE.....#...............#....#',
      '#EE.....D...............D....#',
      '#S......#...............#....#',
      '#S......###########.#####....#',
      '#...........D.........##.....#',
      '#...........#.........##.....#',
      '##############################',
    ],
    entities: [
      { type: 'door', id: 'hall', x: 8, y: 2 },
      { type: 'door', id: 'store', x: 12, y: 5 },
      { type: 'door', id: 'safe-room', x: 24, y: 2 },
      { type: 'guard', id: 'Rudy', x: 19, y: 2, facing: 'w' },
      { type: 'vault', id: 'safe', x: 29, y: 5, crackTicks: 60 },
      { type: 'loot', id: 'bonds', x: 27, y: 6, value: 12000, required: true, vault: 'safe' },
    ],
  },
];
