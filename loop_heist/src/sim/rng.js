// Seeded integer PRNG (mulberry32). State is a single uint32 so it snapshots trivially.
export function rngNext(state) {
  // state: { s: uint32 } — mutated in place; returns uint32
  let t = (state.s = (state.s + 0x6D2B79F5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

export const rngInt = (state, n) => rngNext(state) % n;

export class Rng {
  constructor(seed) { this.st = { s: seed >>> 0 }; }
  next() { return rngNext(this.st); }
  int(n) { return rngNext(this.st) % n; }
  range(a, b) { return a + this.int(b - a + 1); }
  pick(arr) { return arr[this.int(arr.length)]; }
  chance(p100) { return this.int(100) < p100; }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
