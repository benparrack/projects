// Style combos. Everything you do off the ground (swings, big flings, tricks,
// near misses, street swoops, wall runs, tokens, race rings) adds points to a
// running combo, and the multiplier grows with the number of moves chained. Stay
// on the ground for a moment and the combo banks; bail a trick or fall in the
// river and it's lost. Pure JS (no three.js) so it runs headless.

export const TRICKS = {
  front: ["Front flip", 250], back: ["Backflip", 300],
  twistL: ["Corkscrew", 300], twistR: ["Corkscrew", 300], spin: ["360", 200],
};
const RANKS = [[0, "Nice"], [2000, "Great"], [6000, "Awesome"], [15000, "Spectacular"], [40000, "Amazing"], [100000, "Legendary"]];
export const rankOf = (pts) => RANKS.filter((r) => pts >= r[0]).pop()[1];

export class Style {
  constructor(world) {
    this.w = world;
    this.best = 0; this.total = 0;
    this.feed = [];            // {name, pts, t} most recent first (for the HUD)
    this.banked = null;        // {pts, rank, best} set for one frame when a combo banks
    this.lost = null;          // {pts, why} set for one frame when a combo is lost
    this.probeT = 0; this.closeCD = 0; this.fastT = 0; this.fastDone = false;
    this.swoop = false; this.swingT = 0;
    this.sfx = [];             // sounds for main to play
    this.reset();
  }

  reset() { this.points = 0; this.count = 0; this.mult = 1; this.active = false; this.recent = []; }

  add(name, pts, repeatable = false) {
    // variety pays: the same move twice in a row is worth less each time
    const reps = repeatable ? 0 : this.recent.filter((n) => n === name).length;
    const p = Math.round(pts * 0.5 ** reps / 5) * 5;
    this.recent.push(name); if (this.recent.length > 4) this.recent.shift();
    this.active = true;
    this.points += p;
    this.count++;
    this.mult = Math.min(10, 1 + Math.floor(this.count / 3));
    this.feed.unshift({ name, pts: p, t: 0 });
    if (this.feed.length > 5) this.feed.pop();
    return p;
  }

  bank() {
    if (!this.active) return;
    const pts = this.points * this.mult;
    this.total += pts;
    const best = pts > this.best;
    if (best) this.best = pts;
    this.banked = { pts, rank: rankOf(pts), best, mult: this.mult };
    this.feed.length = 0;
    this.reset();
  }

  lose(why) {
    if (this.active) this.lost = { pts: this.points * this.mult, why };
    this.feed.length = 0;
    this.reset();
  }

  /** player events for this frame (call before they are cleared) */
  events(evs, pl) {
    const hs = Math.hypot(pl.v.x, pl.v.z);
    for (const e of evs) {
      switch (e) {
        case "thwip": this.swingT = 0; this.swoop = false; break;
        case "release": case "releaseJump":
          if (this.swingT > 0.45) this.add("Swing", 25 + Math.round(hs * 3), true);
          if (hs > 42) this.add("Big fling", 200);
          else if (e === "releaseJump" && hs > 22) this.add("Jump-off", 80);
          break;
        case "trickDone": { const t = TRICKS[pl.lastTrick]; if (t) this.add(t[0], t[1]); break; }
        case "graze": this.add("Near miss", 150); break;
        case "wall": if (this.active) this.add("Wall run", 60); break;
        case "launch": this.add("Launch", 150); break;
        case "superjump": this.add("Super jump", 100); break;
        case "dash": if (this.active) this.add("Web dash", 40); break;
        case "vault": if (this.active) this.add("Vault", 60); break;
        case "bail": this.lose("Bailed"); break;
        case "respawn": this.lose("Wiped out"); break;
      }
    }
  }

  update(dt, pl) {
    this.banked = null; this.lost = null;
    for (const f of this.feed) f.t += dt;
    const st = pl.state, sp = Math.hypot(pl.v.x, pl.v.y, pl.v.z);
    if (st === "swing") this.swingT += dt;
    // bank once you've been on your feet for a moment
    if (st === "ground" && pl.stateT > 0.6 && this.active) this.bank();
    this.closeCD -= dt;
    // sustained speed
    if (st !== "ground" && sp > 45) { this.fastT += dt; if (this.fastT > 2 && !this.fastDone) { this.fastDone = true; this.add("Top speed", 300); } }
    else if (sp < 35) { this.fastT = 0; this.fastDone = false; }
    // probes: close calls with walls beside you, and swooping low over the street
    this.probeT -= dt;
    if (this.probeT > 0 || st === "ground" || st === "wall") return;
    this.probeT = 0.08;
    const hs = Math.hypot(pl.v.x, pl.v.z);
    if (hs > 28 && this.closeCD <= 0) {
      const sx = -pl.v.z / hs, sz = pl.v.x / hs;
      for (const s of [-1, 1]) {
        const h = this.w.raycast(pl.p.x, pl.p.y, pl.p.z, sx * s, 0, sz * s, 4.5);
        if (h && h.t > 0.6) { this.add("Close call", 150); this.sfx.push("closeCall"); this.closeCD = 1.5; break; }
      }
    }
    if (st === "swing" && !this.swoop && hs > 24) {
      const f = this.w.floorBelow(pl.p.x, pl.p.z, pl.p.y);
      if (pl.p.y - f < 8) { this.swoop = true; this.add(f > 2 ? "Rooftop skim" : "Street swoop", 200); }
    }
  }
}
