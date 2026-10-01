// The deterministic heist simulation.
//
// One Sim runs one loop of the heist: the world resets to the level's initial
// state, and every crew member either replays a recording (a clone) or takes
// input from the player (the live crew member). The live member's inputs,
// positions and interaction results are recorded so they can become a clone.
//
// A replayed clone is checked every tick against what it saw when it was
// recorded. If it ends up somewhere else, or an interaction turns out
// differently (a door that was shut is now open, a terminal is already used),
// the clone is LOST: a paradox. It stops following its recording and just
// stands there, confused, where guards can still find it.
import { SUB, tileCenter, toTile, dist } from './fixed.js';
import {
  IN, MOVE_MASK, WALK_SPEED, SNEAK_SPEED, GHOST_SNEAK_SPEED, CARRY_FACTOR, DIAG,
  WALK_NOISE, CARRY_NOISE, DESYNC_DIST, TICK_RATE, WHISTLE_NOISE,
} from './constants.js';
import { moveBox, onExit } from './world.js';
import { gatherTargets, performInstant, completeHold, dropLoot } from './interact.js';
import { initGuards, updateGuards } from './guards.js';
import { initSecurity, updateSecurity } from './security.js';
import { Rng } from './rng.js';

// Facing angle for each combination of movement bits (index = input & 15).
const DIR_ANGLE = [-1, 192, 64, -1, 128, 160, 96, 128, 0, 224, 32, 0, -1, 192, 64, -1];

export function newRecording(role) {
  return { role, inputs: [], trace: [], events: [], len: 0 };
}

export function initialState(L, crew) {
  const S = {
    tick: 0,
    rng: { s: (L.seed * 2654435761) >>> 0 },
    over: null,
    alarm: null,
    log: [],        // global event log for the UI: {t, k, a, id}
    noises: [],     // noises made this tick, heard by guards next tick
    actors: crew.map((c, i) => {
      const [sx, sy] = L.spawns[(c.slot ?? i) % L.spawns.length];
      return {
        i, role: c.role, slot: c.slot ?? i,
        x: tileCenter(sx), y: tileCenter(sy), facing: 0,
        carrying: -1, body: -1, keys: [],
        using: null, prev: 0, cooldown: 0,
        escaped: false, lost: null, evCursor: 0, moving: false, sneaking: false,
      };
    }),
    doors: L.doors.map((d) => ({ id: d.id, open: !!d.open, locked: d.locked ?? null })),
    items: L.items.map((it) => ({
      id: it.id, kind: it.type, color: it.color ?? null, value: it.value ?? 0,
      required: !!it.required, x: tileCenter(it.x), y: tileCenter(it.y),
      carrier: -1, secured: false, vault: it.vault ?? null, hidden: !!(it.hidden || it.vault),
    })),
  };
  initSecurity(L, S);
  initGuards(L, S);
  return S;
}

export class Sim {
  // crew: [{ role, rec }] — rec is a recording to replay, or null for the live member.
  constructor(level, crew, state = null) {
    this.L = level;
    this.crew = crew;
    this.live = crew.findIndex((c) => !c.rec);
    this.liveRec = this.live >= 0 ? newRecording(crew[this.live].role) : null;
    this.S = state ?? initialState(level, crew);
  }

  get tick() { return this.S.tick; }
  get over() { return this.S.over; }

  // Input for crew member i at the current tick.
  inputFor(i, liveInput) {
    const a = this.S.actors[i];
    if (a.escaped || a.lost) return 0;
    if (i === this.live) return liveInput & 0xff;
    const rec = this.crew[i].rec;
    return this.S.tick < rec.inputs.length ? rec.inputs[this.S.tick] : 0;
  }

  step(liveInput = 0) {
    const S = this.S, L = this.L;
    if (S.over) return;
    const t = S.tick;
    S.prevNoises = S.noises;
    S.noises = [];

    for (const a of S.actors) {
      const input = this.inputFor(a.i, liveInput);
      if (!a.escaped) this.stepActor(a, input);
      a.prev = input;
    }

    updateSecurity(this);
    updateGuards(this);

    // Paradox detection for replayed clones.
    for (const a of S.actors) {
      if (a.i === this.live || a.escaped || a.lost) continue;
      const rec = this.crew[a.i].rec;
      if (t < rec.len) {
        const ex = rec.trace[t * 2], ey = rec.trace[t * 2 + 1];
        if (Math.abs(a.x - ex) > DESYNC_DIST || Math.abs(a.y - ey) > DESYNC_DIST) {
          this.loseClone(a, 'blocked', `couldn't follow its path`);
          continue;
        }
      }
      const next = rec.events[a.evCursor];
      if (next && next.t <= t) this.loseClone(a, 'missed', describeMissed(next));
    }

    if (this.liveRec) {
      const a = S.actors[this.live];
      const r = this.liveRec;
      if (r.escapedAt == null) {
        r.inputs.push(liveInput & 0xff);
        r.trace.push(a.x, a.y);
        r.len = r.inputs.length;
        if (a.escaped) r.escapedAt = t;
      }
    }

    S.tick++;
    this.checkOutcome();
  }

  stepActor(a, input) {
    const S = this.S, L = this.L;
    if (a.cooldown > 0) a.cooldown--;
    const pressed = input & ~a.prev;
    const mv = input & MOVE_MASK;
    a.sneaking = !!(input & IN.SNEAK);

    // Movement (not while busy with a timed action).
    a.moving = false;
    if (mv && !a.using) {
      let dx = ((input & IN.RIGHT) ? 1 : 0) - ((input & IN.LEFT) ? 1 : 0);
      let dy = ((input & IN.DOWN) ? 1 : 0) - ((input & IN.UP) ? 1 : 0);
      if (dx || dy) {
        let sp = a.sneaking ? (a.role === 'ghost' ? GHOST_SNEAK_SPEED : SNEAK_SPEED) : WALK_SPEED;
        if (a.carrying >= 0 || a.body >= 0) sp = (sp * CARRY_FACTOR) >> 2;
        if (dx && dy) sp = (sp * DIAG) >> 8;
        const [nx, ny] = moveBox(L, S, a.x, a.y, dx * sp, dy * sp);
        a.moving = nx !== a.x || ny !== a.y;
        a.x = nx; a.y = ny;
        a.facing = DIR_ANGLE[mv];
        if (a.moving && !a.sneaking && S.tick % 4 === 0) {
          const loud = a.carrying >= 0 || a.body >= 0;
          this.noise(a.x, a.y, loud ? CARRY_NOISE : WALK_NOISE, 'step', a.i);
        }
      }
    }

    // Role ability.
    if (pressed & IN.ABILITY) this.ability(a);

    // Interactions.
    if (a.using) {
      const u = a.using;
      const still = (input & IN.USE) && !mv;
      const target = still ? gatherTargets(this, a).find((c) => c.kind === u.kind && c.idx === u.idx) : null;
      if (!target) {
        a.using = null;
      } else if (++u.progress >= u.need) {
        a.using = null;
        completeHold(this, a, target);
      }
    } else if (pressed & IN.USE) {
      const targets = gatherTargets(this, a);
      const tgt = targets[0];
      if (tgt && tgt.hold) {
        a.using = { kind: tgt.kind, idx: tgt.idx, progress: 0, need: tgt.hold };
      } else if (tgt) {
        performInstant(this, a, tgt);
      } else if (a.carrying >= 0 || a.body >= 0) {
        dropLoot(this, a);
      }
    }
  }

  ability(a) {
    if (a.cooldown > 0) return;
    if (a.role === 'ghost') {
      a.cooldown = 60;
      this.noise(a.x, a.y, WHISTLE_NOISE, 'whistle', a.i);
      this.event(a, 'whistle', '');
    }
  }

  noise(x, y, r, kind, src) {
    this.S.noises.push({ x, y, r, kind, src });
  }

  // Record an interaction outcome. Live: appended to the recording. Clone: must
  // match the recording or the clone is lost.
  event(a, k, id) {
    const S = this.S, t = S.tick;
    S.log.push({ t, k, a: a.i, id });
    if (a.i === this.live) {
      if (this.liveRec.escapedAt == null) this.liveRec.events.push({ t, k, id });
      return;
    }
    if (a.lost || this.crew[a.i] === undefined) return;
    const rec = this.crew[a.i].rec;
    const exp = rec.events[a.evCursor];
    if (exp && exp.t === t && exp.k === k && exp.id === id) { a.evCursor++; return; }
    this.loseClone(a, 'diverged', exp ? describeDiverged(exp, k, id) : `did something unplanned (${k} ${id})`);
  }

  loseClone(a, kind, why) {
    if (a.lost) return;
    a.lost = { t: this.S.tick, kind, why };
    a.using = null;
    this.S.log.push({ t: this.S.tick, k: 'paradox', a: a.i, id: why });
  }

  raiseAlarm(reason, x, y, by) {
    const S = this.S;
    if (S.alarm) return;
    S.alarm = { t: S.tick, reason, x, y, by };
    S.log.push({ t: S.tick, k: 'alarm', a: -1, id: reason });
  }

  checkOutcome() {
    const S = this.S, L = this.L;
    if (S.over) return;
    if (S.alarm) { S.over = { kind: 'alarm', t: S.tick, reason: S.alarm.reason }; return; }
    const allOut = S.actors.every((a) => a.escaped);
    const loot = S.items.filter((it) => it.kind === 'loot');
    const required = loot.filter((it) => it.required);
    if (allOut && S.actors.length) {
      const ok = required.every((it) => it.secured);
      S.over = ok
        ? { kind: 'success', t: S.tick, take: loot.filter((it) => it.secured).reduce((s, it) => s + it.value, 0) }
        : { kind: 'nolot', t: S.tick, reason: 'Everyone left without the target.' };
      return;
    }
    if (S.tick >= L.loopTicks) {
      const left = S.actors.filter((a) => !a.escaped).length;
      S.over = { kind: 'timeout', t: S.tick, reason: `${left} crew member${left > 1 ? 's' : ''} still inside when the loop reset.` };
    }
  }

  // Run with no live input until the loop ends (used after the live member escapes).
  runToEnd(maxTicks = 1e6) {
    let n = 0;
    while (!this.S.over && n++ < maxTicks) this.step(0);
    return this.S.over;
  }

  snapshot() {
    return {
      S: structuredClone(this.S),
      rec: this.liveRec && {
        ...this.liveRec,
        inputs: this.liveRec.inputs.slice(), trace: this.liveRec.trace.slice(),
        events: this.liveRec.events.slice(),
      },
    };
  }

  restore(snap) {
    this.S = structuredClone(snap.S);
    if (snap.rec) {
      this.liveRec = {
        ...snap.rec,
        inputs: snap.rec.inputs.slice(), trace: snap.rec.trace.slice(),
        events: snap.rec.events.slice(),
      };
    }
  }

  rng() { return new RngView(this.S.rng); }
}

class RngView extends Rng {
  constructor(st) { super(0); this.st = st; }
}

function describeMissed(exp) {
  return {
    open: `expected to open door ${exp.id}`,
    close: `expected to close door ${exp.id}`,
    escape: 'never made it to the van',
  }[exp.k] ?? `expected to ${exp.k.replace('done:', 'finish ')} ${exp.id}`.trim();
}

function describeDiverged(exp, k, id) {
  if (exp.k === 'open' && k === 'close') return `door ${id} was already open`;
  if (exp.k === 'open' && k === 'locked') return `door ${id} was locked`;
  if (exp.k === 'close' && k === 'open') return `door ${id} was already shut`;
  return `expected "${exp.k} ${exp.id}" but got "${k} ${id}"`;
}

export const secondsOf = (ticks) => ticks / TICK_RATE;
export { toTile, dist };
