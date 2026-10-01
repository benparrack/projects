// What a crew member can interact with, and what happens when they do.
// Targets are ordered by distance, then by kind priority, so the choice is
// deterministic. `hold` > 0 means the action needs USE held (and standing still).
import { tileCenter, dist, angleDiff, angleTo } from './fixed.js';
import { REACH, HOLD } from './constants.js';
import { onExit, boxOverlapsTile } from './world.js';

const PRIORITY = { takedown: 0, body: 1, door: 2, key: 3, loot: 4, terminal: 5, powerbox: 6, vault: 7, escape: 9 };

export function gatherTargets(sim, a) {
  const { L, S } = sim;
  const out = [];
  const near = (x, y) => { const d = dist(x - a.x, y - a.y); return d <= REACH ? d : -1; };

  L.doors.forEach((def, i) => {
    const d = near(tileCenter(def.x), tileCenter(def.y));
    if (d < 0) return;
    const door = S.doors[i];
    // Picking a lock is a timed action for the cracker when there's no key.
    if (!door.open && door.locked && !a.keys.includes(door.locked) && a.role === 'cracker' && door.locked !== 'vault') {
      out.push({ kind: 'door', idx: i, d, hold: HOLD.lockpick, pick: true });
    } else {
      out.push({ kind: 'door', idx: i, d, hold: 0 });
    }
  });

  if (a.carrying < 0 && a.body < 0) {
    S.items.forEach((it, i) => {
      if (it.carrier >= 0 || it.secured || it.hidden) return;
      const d = near(it.x, it.y);
      if (d >= 0) out.push({ kind: it.kind, idx: i, d, hold: 0 });
    });
  }

  (S.powerboxes ?? []).forEach((pb, i) => {
    const def = L.powerboxes[i];
    const d = near(tileCenter(def.x), tileCenter(def.y));
    if (d >= 0) out.push({ kind: 'powerbox', idx: i, d, hold: HOLD.powerbox });
  });

  if (a.role === 'hacker') {
    (S.terminals ?? []).forEach((tm, i) => {
      if (tm.used) return;
      const def = L.terminals[i];
      const d = near(tileCenter(def.x), tileCenter(def.y));
      if (d >= 0 && (!def.circuit || S.circuits[def.circuit])) out.push({ kind: 'terminal', idx: i, d, hold: HOLD.terminal });
    });
  }

  if (a.role === 'cracker') {
    (S.vaults ?? []).forEach((v, i) => {
      if (v.open) return;
      const def = L.vaults[i];
      const d = near(tileCenter(def.x), tileCenter(def.y));
      if (d >= 0) out.push({ kind: 'vault', idx: i, d, hold: def.crackTicks ?? HOLD.vault });
    });
  }

  if (a.role === 'muscle' && a.carrying < 0 && a.body < 0) {
    (S.guards ?? []).forEach((g, i) => {
      const d = near(g.x, g.y);
      if (d < 0) return;
      if (g.state === 'ko') {
        if (g.carriedBy < 0) out.push({ kind: 'body', idx: i, d, hold: 0 });
        return;
      }
      // Takedown only from behind and only if the guard isn't onto you.
      const fromGuard = angleTo(a.x - g.x, a.y - g.y);
      if (Math.abs(angleDiff(g.facing, fromGuard)) > 72 && g.state !== 'chase') {
        out.push({ kind: 'takedown', idx: i, d, hold: 0 });
      }
    });
  }

  if (onExit(L, a.x, a.y)) out.push({ kind: 'escape', idx: 0, d: REACH, hold: 0 });

  out.sort((p, q) => (p.d - q.d) || (PRIORITY[p.kind] - PRIORITY[q.kind]) || (p.idx - q.idx));
  return out;
}

export function performInstant(sim, a, tgt) {
  const { L, S } = sim;
  switch (tgt.kind) {
    case 'door': {
      const door = S.doors[tgt.idx];
      const def = L.doors[tgt.idx];
      if (door.open) {
        if (tileOccupied(sim, def.x, def.y)) { sim.event(a, 'blocked', door.id); return; }
        door.open = false;
        sim.event(a, 'close', door.id);
      } else if (door.locked && !a.keys.includes(door.locked)) {
        sim.event(a, 'locked', door.id);
      } else {
        door.locked = null;
        door.open = true;
        sim.event(a, 'open', door.id);
      }
      return;
    }
    case 'key': {
      const it = S.items[tgt.idx];
      it.carrier = a.i;
      it.secured = false;
      a.keys.push(it.color);
      sim.event(a, 'key', it.id);
      return;
    }
    case 'loot': {
      const it = S.items[tgt.idx];
      it.carrier = a.i;
      a.carrying = tgt.idx;
      sim.event(a, 'loot', it.id);
      return;
    }
    case 'takedown': {
      const g = S.guards[tgt.idx];
      g.state = 'ko';
      g.koAt = S.tick;
      sim.noise(g.x, g.y, 256 * 2, 'thud', a.i);
      sim.event(a, 'takedown', g.id);
      return;
    }
    case 'body': {
      const g = S.guards[tgt.idx];
      g.carriedBy = a.i;
      a.body = tgt.idx;
      sim.event(a, 'body', g.id);
      return;
    }
    case 'escape': {
      a.escaped = true;
      if (a.carrying >= 0) {
        const it = S.items[a.carrying];
        it.secured = true;
        it.carrier = -1;
        a.carrying = -1;
      }
      if (a.body >= 0) { dropLoot(sim, a); }
      sim.event(a, 'escape', '');
      return;
    }
  }
}

export function completeHold(sim, a, tgt) {
  const { L, S } = sim;
  switch (tgt.kind) {
    case 'door': { // lockpick
      const door = S.doors[tgt.idx];
      door.locked = null;
      door.open = true;
      sim.event(a, 'done:pick', door.id);
      return;
    }
    case 'powerbox': {
      const pb = S.powerboxes[tgt.idx];
      const circ = L.powerboxes[tgt.idx].circuit;
      S.circuits[circ] = !S.circuits[circ];
      pb.cutAt = S.circuits[circ] ? -1 : S.tick;
      if (S.circuits[circ]) { pb.dispatched = false; pb.needsFix = false; pb.assigned = false; }
      sim.event(a, S.circuits[circ] ? 'done:power-on' : 'done:power-off', pb.id);
      return;
    }
    case 'terminal': {
      const tm = S.terminals[tgt.idx];
      tm.used = true;
      applyTerminal(sim, L.terminals[tgt.idx]);
      sim.event(a, 'done:hack', tm.id);
      return;
    }
    case 'vault': {
      const v = S.vaults[tgt.idx];
      v.open = true;
      for (const it of S.items) if (it.vault === v.id) it.hidden = false;
      sim.noise(tileCenter(L.vaults[tgt.idx].x), tileCenter(L.vaults[tgt.idx].y), 256 * 3, 'vault', a.i);
      sim.event(a, 'done:vault', v.id);
      return;
    }
  }
}

function applyTerminal(sim, def) {
  const { L, S } = sim;
  for (const act of def.actions ?? []) {
    if (act.do === 'unlock' || act.do === 'open') {
      const i = L.doors.findIndex((d) => d.id === act.door);
      if (i >= 0) { S.doors[i].locked = null; if (act.do === 'open') S.doors[i].open = true; }
    } else if (act.do === 'loop-cameras') {
      for (const c of S.cameras) if (!act.cameras || act.cameras.includes(c.id)) c.looped = Math.max(c.looped, act.ticks ?? 400);
    } else if (act.do === 'disable-cameras') {
      for (const c of S.cameras) if (!act.cameras || act.cameras.includes(c.id)) c.disabled = true;
    } else if (act.do === 'lasers-off') {
      for (const l of S.lasers) if (!act.lasers || act.lasers.includes(l.id)) l.off = true;
    } else if (act.do === 'reveal') {
      for (const it of S.items) if (it.id === act.item) it.hidden = false;
    }
  }
}

export function dropLoot(sim, a) {
  const { S } = sim;
  if (a.carrying >= 0) {
    const it = S.items[a.carrying];
    it.carrier = -1; it.x = a.x; it.y = a.y;
    a.carrying = -1;
    sim.event(a, 'drop', it.id);
  } else if (a.body >= 0) {
    const g = S.guards[a.body];
    g.carriedBy = -1; g.x = a.x; g.y = a.y;
    a.body = -1;
    sim.event(a, 'drop', g.id);
  }
}

function tileOccupied(sim, tx, ty) {
  const { S } = sim;
  for (const a of S.actors) if (!a.escaped && boxOverlapsTile(a.x, a.y, tx, ty)) return true;
  for (const g of S.guards ?? []) if (g.carriedBy < 0 && boxOverlapsTile(g.x, g.y, tx, ty)) return true;
  return false;
}
