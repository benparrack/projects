// A scripted crew member: turns a list of high-level commands into per-tick
// inputs by reading the live sim state. Used by tests and the level solver.
//
// Commands:
//   { to: [tx, ty], sneak? }   walk to a tile centre (straight line + axis steering)
//   { path: [[tx,ty], ...] }  several `to`s in a row
//   { use: true }             tap USE once
//   { hold: ticks }           hold USE for n ticks (timed interactions)
//   { wait: ticks }           do nothing
//   { ability: true }         tap ABILITY
import { tileCenter } from './fixed.js';
import { IN } from './constants.js';

export class Bot {
  constructor(cmds) {
    this.cmds = [];
    for (const c of cmds) {
      if (c.path) for (const p of c.path) this.cmds.push({ to: p, sneak: c.sneak });
      else this.cmds.push({ ...c });
    }
    this.i = 0;
    this.n = 0;
    this.stuck = 0;
  }

  get done() { return this.i >= this.cmds.length; }

  input(actor) {
    while (this.i < this.cmds.length) {
      const c = this.cmds[this.i];
      if (c.to) {
        const tx = tileCenter(c.to[0]), ty = tileCenter(c.to[1]);
        const dx = tx - actor.x, dy = ty - actor.y;
        const tol = 18; // > half the walk speed, so we never oscillate around the target
        if (Math.abs(dx) <= tol && Math.abs(dy) <= tol) { this.next(); continue; }
        let inp = c.sneak ? IN.SNEAK : 0;
        if (dx > tol) inp |= IN.RIGHT; else if (dx < -tol) inp |= IN.LEFT;
        if (dy > tol) inp |= IN.DOWN; else if (dy < -tol) inp |= IN.UP;
        if (++this.stuck > 600) { this.next(); continue; } // give up on unreachable spots
        return inp;
      }
      // Taps last two ticks (press, release) so consecutive taps register.
      if (c.use || c.ability) {
        if (this.n++ === 0) return c.use ? IN.USE : IN.ABILITY;
        this.next(); return 0;
      }
      if (c.hold != null) {
        if (this.n++ < c.hold) return IN.USE;
        this.next(); return 0;
      }
      if (c.wait != null) {
        if (this.n++ < c.wait) return 0;
        this.next(); continue;
      }
      this.next();
    }
    return 0;
  }

  next() { this.i++; this.n = 0; this.stuck = 0; }
}

// Play a take with a bot as the live crew member; returns the recording.
export function runBot(sim, bot, maxTicks = 100000) {
  let n = 0;
  while (!sim.over && n++ < maxTicks) {
    const a = sim.S.actors[sim.live];
    sim.step(a.escaped ? 0 : bot.input(a));
  }
  return sim.liveRec;
}
