// Keyboard → per-tick input bitmask. Presses are latched until the next sample so a
// tap shorter than one sim tick still registers.
import { IN } from '../sim/constants.js';

const BIND = {
  KeyW: IN.UP, ArrowUp: IN.UP, KeyS: IN.DOWN, ArrowDown: IN.DOWN,
  KeyA: IN.LEFT, ArrowLeft: IN.LEFT, KeyD: IN.RIGHT, ArrowRight: IN.RIGHT,
  ShiftLeft: IN.SNEAK, ShiftRight: IN.SNEAK,
  KeyE: IN.USE, Space: IN.USE, KeyQ: IN.ABILITY,
};
const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace', 'Tab']);

export class Input {
  constructor() {
    this.down = new Set();
    this.latched = 0;
    this.listeners = [];
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
      if (BLOCK.has(e.code)) e.preventDefault();
      if (!e.repeat && BIND[e.code]) this.latched |= BIND[e.code];
      this.down.add(e.code);
      for (const fn of this.listeners) fn(e);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
  }

  onKey(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }

  held(code) { return this.down.has(code); }

  sample() {
    let bits = this.latched;
    for (const code of this.down) bits |= BIND[code] ?? 0;
    this.latched = 0;
    return bits;
  }

  anyGameKey() {
    for (const code of this.down) if (BIND[code]) return true;
    return false;
  }

  clear() { this.latched = 0; }
}
