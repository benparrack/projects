// Turns a level definition (ASCII map + entity list) into static, immutable data.
//
// Map legend:
//   '#' wall      'w' window (blocks movement, not sight)
//   'o' furniture: crates, desks, display cases (blocks movement and sight; cover)
//   '.' floor     'S' crew spawn (floor)     'E' getaway van / exit (floor)
//   ' ' outside void (solid)
// Every door, item, guard and security device is an entity; see docs in README.

export const T = { FLOOR: 0, WALL: 1, WINDOW: 2, VOID: 3, EXIT: 4, PROP: 5 };

export function parseLevel(def) {
  const rows = def.map;
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const tiles = new Uint8Array(w * h);
  const spawns = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x] ?? ' ';
      let t;
      switch (c) {
        case '#': t = T.WALL; break;
        case 'w': t = T.WINDOW; break;
        case 'o': t = T.PROP; break;
        case ' ': t = T.VOID; break;
        case 'E': t = T.EXIT; break;
        case 'S': t = T.FLOOR; spawns.push([x, y]); break;
        default: t = T.FLOOR; // '.', and any letter used to annotate floor
      }
      tiles[y * w + x] = t;
    }
  }
  if (!spawns.length) throw new Error(`level ${def.id}: no spawn 'S'`);

  const ents = def.entities ?? [];
  const byType = (type) => ents.filter((e) => e.type === type);
  const doorIndex = new Int16Array(w * h).fill(-1);
  const doors = byType('door');
  doors.forEach((d, i) => { doorIndex[d.y * w + d.x] = i; });

  return {
    id: def.id,
    name: def.name ?? def.id,
    brief: def.brief ?? '',
    tips: def.tips ?? [],
    w, h, tiles, spawns, doorIndex,
    loopTicks: (def.loopSeconds ?? 90) * 20,
    maxCrew: def.maxCrew ?? 4,
    roles: def.roles ?? ['ghost', 'hacker', 'cracker', 'muscle'],
    seed: def.seed ?? 1,
    radioInterval: def.radioInterval ?? 0, // ticks between guard check-ins (0 = none)
    par: def.par ?? null,
    doors,
    items: [...byType('key'), ...byType('loot')],
    guards: byType('guard'),
    cameras: byType('camera'),
    lasers: byType('laser'),
    powerboxes: byType('powerbox'),
    terminals: byType('terminal'),
    vaults: byType('vault'),
    circuits: def.circuits ?? [],
    def,
  };
}

export const tileAt = (L, x, y) =>
  (x < 0 || y < 0 || x >= L.w || y >= L.h) ? T.VOID : L.tiles[y * L.w + x];
