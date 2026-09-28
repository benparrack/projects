// Two Game Boys joined by a link cable, both emulated on this machine.
//
// Netplay model: every client runs *both* consoles in lockstep and only button presses cross the
// network, so the cable itself never has latency. Machines take turns running LINK_SLICE dots,
// which keeps them within a few M-cycles of each other — close enough for any handshake a game
// can do, including CGB fast serial. Transfers are byte-level: when the clocking side (SC=$81)
// finishes a byte, the partner's SB is swapped with it if the partner is listening (SC=$80).

import { CYCLES_PER_FRAME } from './gameboy.js';

export const LINK_SLICE = 32; // dots each machine runs before handing over

export class Link {
  /** @param {import('./gameboy.js').GameBoy} a player 1 @param {import('./gameboy.js').GameBoy} b player 2 */
  constructor(a, b) {
    this.gbs = [a, b];
    this.time = Math.max(a.dots, b.dots);
    // Completed frames, captured at VBlank; the machines' own buffers are mid-draw between frames.
    this.shown = [a.ppu.frame.slice(), b.ppu.frame.slice()];
    a.onSerialByte = (out) => this.exchange(b, out);
    b.onSerialByte = (out) => this.exchange(a, out);
  }

  exchange(peer, out) {
    if ((peer.sc & 0x81) !== 0x80) return 0xff; // partner isn't listening: the line floats high
    const incoming = peer.sb;
    peer.sb = out;
    peer.sc &= 0x7f;
    peer.requestInterrupt(3);
    return incoming;
  }

  /** Advances both machines by one frame's worth of real time (70224 dots). */
  runFrame() {
    const end = this.time + CYCLES_PER_FRAME;
    const [a, b] = this.gbs;
    for (let t = this.time + LINK_SLICE; ; t += LINK_SLICE) {
      if (t > end) t = end;
      a.runUntil(t); this.capture(0);
      b.runUntil(t); this.capture(1);
      if (t === end) break;
    }
    this.time = end;
  }

  capture(i) {
    const ppu = this.gbs[i].ppu;
    if (!ppu.frameReady) return;
    ppu.frameReady = false;
    this.shown[i].set(ppu.frame);
  }

  saveState() {
    return { time: this.time, a: this.gbs[0].saveState(), b: this.gbs[1].saveState() };
  }

  loadState(s) {
    this.gbs[0].loadState(s.a);
    this.gbs[1].loadState(s.b);
    this.time = s.time;
  }

  /** Cheap fingerprint of emulation-relevant state, for desync detection between netplay peers. */
  hash() {
    let h = 0x811c9dc5 | 0;
    const mix = (v) => { h = Math.imul(h ^ v, 0x01000193); };
    for (const gb of this.gbs) {
      for (const arr of [gb.wram, gb.hram, gb.ppu.vram]) for (let i = 0; i < arr.length; i++) mix(arr[i]);
      const c = gb.cpu;
      mix(c.a); mix(c.f); mix(c.b); mix(c.c); mix(c.d); mix(c.e); mix(c.h); mix(c.l); mix(c.sp); mix(c.pc);
      mix(gb.sb); mix(gb.sc); mix(gb.dots & 0xffffff);
    }
    return h >>> 0;
  }
}
