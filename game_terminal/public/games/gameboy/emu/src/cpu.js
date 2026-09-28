// Sharp SM83 CPU. Every memory access and internal delay advances the rest of the system by one
// M-cycle (via gb.tick()), so instruction timing is exact at memory-access granularity.

const FZ = 0x80, FN = 0x40, FH = 0x20, FC = 0x10;

export class CPU {
  constructor(gb) {
    this.gb = gb;
    this.a = 0; this.f = 0; this.b = 0; this.c = 0; this.d = 0; this.e = 0; this.h = 0; this.l = 0;
    this.sp = 0xfffe; this.pc = 0x100;
    this.ime = false;
    this.eiDelay = 0;
    this.halted = false;
    this.haltBug = false;
    this.stopped = false;
    this.breakHook = null; // called on LD B,B (Mooneye test-pass convention)
  }

  // ---- bus helpers ----
  rd(addr) { this.gb.tick(); return this.gb.read(addr); }
  wr(addr, v) { this.gb.tick(); this.gb.write(addr, v); }
  idle() { this.gb.tick(); }
  fetch() {
    const v = this.rd(this.pc);
    if (this.haltBug) this.haltBug = false;
    else this.pc = (this.pc + 1) & 0xffff;
    return v;
  }
  fetch16() { const lo = this.fetch(); return lo | (this.fetch() << 8); }
  push(v) {
    this.sp = (this.sp - 1) & 0xffff; this.wr(this.sp, v >> 8);
    this.sp = (this.sp - 1) & 0xffff; this.wr(this.sp, v & 0xff);
  }
  pop() {
    const lo = this.rd(this.sp); this.sp = (this.sp + 1) & 0xffff;
    const hi = this.rd(this.sp); this.sp = (this.sp + 1) & 0xffff;
    return lo | (hi << 8);
  }

  get bc() { return (this.b << 8) | this.c; }
  set bc(v) { this.b = (v >> 8) & 0xff; this.c = v & 0xff; }
  get de() { return (this.d << 8) | this.e; }
  set de(v) { this.d = (v >> 8) & 0xff; this.e = v & 0xff; }
  get hl() { return (this.h << 8) | this.l; }
  set hl(v) { this.h = (v >> 8) & 0xff; this.l = v & 0xff; }
  get af() { return (this.a << 8) | this.f; }
  set af(v) { this.a = (v >> 8) & 0xff; this.f = v & 0xf0; }

  getR(i) {
    switch (i) {
      case 0: return this.b; case 1: return this.c; case 2: return this.d; case 3: return this.e;
      case 4: return this.h; case 5: return this.l; case 6: return this.rd(this.hl); default: return this.a;
    }
  }
  setR(i, v) {
    switch (i) {
      case 0: this.b = v; break; case 1: this.c = v; break; case 2: this.d = v; break; case 3: this.e = v; break;
      case 4: this.h = v; break; case 5: this.l = v; break; case 6: this.wr(this.hl, v); break; default: this.a = v;
    }
  }

  // ---- ALU ----
  add(v, carry) {
    const c = carry && (this.f & FC) ? 1 : 0;
    const r = this.a + v + c;
    this.f = ((r & 0xff) ? 0 : FZ) | (((this.a & 0xf) + (v & 0xf) + c) > 0xf ? FH : 0) | (r > 0xff ? FC : 0);
    this.a = r & 0xff;
  }
  sub(v, carry, store = true) {
    const c = carry && (this.f & FC) ? 1 : 0;
    const r = this.a - v - c;
    this.f = ((r & 0xff) ? 0 : FZ) | FN | (((this.a & 0xf) - (v & 0xf) - c) < 0 ? FH : 0) | (r < 0 ? FC : 0);
    if (store) this.a = r & 0xff;
  }
  alu(op, v) {
    switch (op) {
      case 0: this.add(v, false); break;
      case 1: this.add(v, true); break;
      case 2: this.sub(v, false); break;
      case 3: this.sub(v, true); break;
      case 4: this.a &= v; this.f = (this.a ? 0 : FZ) | FH; break;
      case 5: this.a ^= v; this.f = this.a ? 0 : FZ; break;
      case 6: this.a |= v; this.f = this.a ? 0 : FZ; break;
      case 7: this.sub(v, false, false); break;
    }
  }
  inc(v) {
    const r = (v + 1) & 0xff;
    this.f = (this.f & FC) | (r ? 0 : FZ) | ((v & 0xf) === 0xf ? FH : 0);
    return r;
  }
  dec(v) {
    const r = (v - 1) & 0xff;
    this.f = (this.f & FC) | (r ? 0 : FZ) | FN | ((v & 0xf) === 0 ? FH : 0);
    return r;
  }
  addHL(v) {
    const hl = this.hl, r = hl + v;
    this.f = (this.f & FZ) | (((hl & 0xfff) + (v & 0xfff)) > 0xfff ? FH : 0) | (r > 0xffff ? FC : 0);
    this.hl = r & 0xffff;
  }
  addSP(e) { // e is a signed offset; flags come from the unsigned low-byte add
    const sp = this.sp, u = e & 0xff;
    this.f = (((sp & 0xf) + (u & 0xf)) > 0xf ? FH : 0) | (((sp & 0xff) + u) > 0xff ? FC : 0);
    return (sp + ((e << 24) >> 24)) & 0xffff;
  }
  daa() {
    let a = this.a, f = this.f;
    if (!(f & FN)) {
      if ((f & FC) || a > 0x99) { a += 0x60; f |= FC; }
      if ((f & FH) || (a & 0x0f) > 0x09) a += 0x6;
    } else {
      if (f & FC) a -= 0x60;
      if (f & FH) a -= 0x6;
    }
    a &= 0xff;
    this.f = (f & (FN | FC)) | (a ? 0 : FZ);
    this.a = a;
  }
  cb(op, v) {
    const x = op >> 6, y = (op >> 3) & 7;
    const c = (this.f & FC) ? 1 : 0;
    let r;
    if (x === 0) {
      let carry;
      switch (y) {
        case 0: carry = v >> 7; r = ((v << 1) | carry) & 0xff; break;          // RLC
        case 1: carry = v & 1; r = (v >> 1) | (carry << 7); break;             // RRC
        case 2: carry = v >> 7; r = ((v << 1) | c) & 0xff; break;              // RL
        case 3: carry = v & 1; r = (v >> 1) | (c << 7); break;                 // RR
        case 4: carry = v >> 7; r = (v << 1) & 0xff; break;                    // SLA
        case 5: carry = v & 1; r = (v >> 1) | (v & 0x80); break;               // SRA
        case 6: carry = 0; r = ((v << 4) | (v >> 4)) & 0xff; break;            // SWAP
        default: carry = v & 1; r = v >> 1; break;                             // SRL
      }
      this.f = (r ? 0 : FZ) | (carry ? FC : 0);
      return r;
    }
    if (x === 1) { this.f = (this.f & FC) | FH | ((v >> y) & 1 ? 0 : FZ); return -1; } // BIT
    if (x === 2) return v & ~(1 << y);  // RES
    return v | (1 << y);                // SET
  }
  cond(y) {
    switch (y) {
      case 0: return !(this.f & FZ); case 1: return !!(this.f & FZ);
      case 2: return !(this.f & FC); default: return !!(this.f & FC);
    }
  }

  // ---- execution ----
  step() {
    const gb = this.gb;
    if (this.halted) {
      this.idle();
      if (!(gb.ie & gb.if & 0x1f)) return;
      this.halted = false;
      // The cycle that notices the wake-up is also the next opcode fetch: discarded by an
      // interrupt dispatch when IME=1, or the real fetch of the next instruction when IME=0.
      if (this.ime) { this.interrupt(); return; }
      const op = gb.read(this.pc);
      this.pc = (this.pc + 1) & 0xffff;
      this.exec(op);
      if (this.eiDelay && --this.eiDelay === 0) this.ime = true;
      return;
    }
    // Interrupts are sampled at the end of the opcode-fetch cycle; a dispatch discards that fetch
    // (it becomes the first of the dispatch's 5 M-cycles).
    const pc = this.pc;
    const op = this.fetch();
    if (this.ime && (gb.ie & gb.if & 0x1f)) { this.pc = pc; this.interrupt(); return; }
    this.exec(op);
    if (this.eiDelay && --this.eiDelay === 0) this.ime = true;
  }

  interrupt() {
    const gb = this.gb;
    this.ime = false;
    this.idle();
    this.sp = (this.sp - 1) & 0xffff; this.wr(this.sp, this.pc >> 8);
    // IE/IF are re-sampled after the high-byte push (it may have overwritten IE at 0xFFFF).
    const pending = gb.ie & gb.if & 0x1f;
    this.sp = (this.sp - 1) & 0xffff; this.wr(this.sp, this.pc & 0xff);
    this.idle(); // load PC with the vector
    if (!pending) { this.pc = 0; return; }
    const bit = 31 - Math.clz32(pending & -pending);
    gb.if &= ~(1 << bit);
    this.pc = 0x40 + bit * 8;
  }

  exec(op) {
    // LD r,r' block
    if (op >= 0x40 && op < 0x80) {
      if (op === 0x76) { this.halt(); return; }
      if (op === 0x40 && this.breakHook) this.breakHook(this);
      this.setR((op >> 3) & 7, this.getR(op & 7));
      return;
    }
    // ALU A,r block
    if (op >= 0x80 && op < 0xc0) { this.alu((op >> 3) & 7, this.getR(op & 7)); return; }

    switch (op) {
      case 0x00: return;
      case 0x01: this.bc = this.fetch16(); return;
      case 0x11: this.de = this.fetch16(); return;
      case 0x21: this.hl = this.fetch16(); return;
      case 0x31: this.sp = this.fetch16(); return;
      case 0x02: this.wr(this.bc, this.a); return;
      case 0x12: this.wr(this.de, this.a); return;
      case 0x22: { const hl = this.hl; this.wr(hl, this.a); this.hl = (hl + 1) & 0xffff; return; }
      case 0x32: { const hl = this.hl; this.wr(hl, this.a); this.hl = (hl - 1) & 0xffff; return; }
      case 0x0a: this.a = this.rd(this.bc); return;
      case 0x1a: this.a = this.rd(this.de); return;
      case 0x2a: { const hl = this.hl; this.a = this.rd(hl); this.hl = (hl + 1) & 0xffff; return; }
      case 0x3a: { const hl = this.hl; this.a = this.rd(hl); this.hl = (hl - 1) & 0xffff; return; }
      case 0x03: this.idle(); this.bc = (this.bc + 1) & 0xffff; return;
      case 0x13: this.idle(); this.de = (this.de + 1) & 0xffff; return;
      case 0x23: this.idle(); this.hl = (this.hl + 1) & 0xffff; return;
      case 0x33: this.idle(); this.sp = (this.sp + 1) & 0xffff; return;
      case 0x0b: this.idle(); this.bc = (this.bc - 1) & 0xffff; return;
      case 0x1b: this.idle(); this.de = (this.de - 1) & 0xffff; return;
      case 0x2b: this.idle(); this.hl = (this.hl - 1) & 0xffff; return;
      case 0x3b: this.idle(); this.sp = (this.sp - 1) & 0xffff; return;
      case 0x09: this.idle(); this.addHL(this.bc); return;
      case 0x19: this.idle(); this.addHL(this.de); return;
      case 0x29: this.idle(); this.addHL(this.hl); return;
      case 0x39: this.idle(); this.addHL(this.sp); return;
      case 0x04: case 0x0c: case 0x14: case 0x1c: case 0x24: case 0x2c: case 0x3c: {
        const r = (op >> 3) & 7; this.setR(r, this.inc(this.getR(r))); return;
      }
      case 0x05: case 0x0d: case 0x15: case 0x1d: case 0x25: case 0x2d: case 0x3d: {
        const r = (op >> 3) & 7; this.setR(r, this.dec(this.getR(r))); return;
      }
      case 0x34: { const hl = this.hl; this.wr(hl, this.inc(this.rd(hl))); return; }
      case 0x35: { const hl = this.hl; this.wr(hl, this.dec(this.rd(hl))); return; }
      case 0x06: case 0x0e: case 0x16: case 0x1e: case 0x26: case 0x2e: case 0x36: case 0x3e:
        this.setR((op >> 3) & 7, this.fetch()); return;
      case 0x07: { const c = this.a >> 7; this.a = ((this.a << 1) | c) & 0xff; this.f = c ? FC : 0; return; }
      case 0x0f: { const c = this.a & 1; this.a = (this.a >> 1) | (c << 7); this.f = c ? FC : 0; return; }
      case 0x17: { const c = this.a >> 7; this.a = ((this.a << 1) | ((this.f & FC) ? 1 : 0)) & 0xff; this.f = c ? FC : 0; return; }
      case 0x1f: { const c = this.a & 1; this.a = (this.a >> 1) | ((this.f & FC) ? 0x80 : 0); this.f = c ? FC : 0; return; }
      case 0x08: { const a = this.fetch16(); this.wr(a, this.sp & 0xff); this.wr((a + 1) & 0xffff, this.sp >> 8); return; }
      case 0x10: this.stop(); return;
      case 0x18: { const e = this.fetch(); this.idle(); this.pc = (this.pc + ((e << 24) >> 24)) & 0xffff; return; }
      case 0x20: case 0x28: case 0x30: case 0x38: {
        const e = this.fetch();
        if (this.cond((op >> 3) & 3)) { this.idle(); this.pc = (this.pc + ((e << 24) >> 24)) & 0xffff; }
        return;
      }
      case 0x27: this.daa(); return;
      case 0x2f: this.a ^= 0xff; this.f |= FN | FH; return;
      case 0x37: this.f = (this.f & FZ) | FC; return;
      case 0x3f: this.f = (this.f & FZ) | ((this.f & FC) ? 0 : FC); return;

      // 0xC0-0xFF
      case 0xc0: case 0xc8: case 0xd0: case 0xd8:
        this.idle();
        if (this.cond((op >> 3) & 3)) { this.pc = this.pop(); this.idle(); }
        return;
      case 0xc9: this.pc = this.pop(); this.idle(); return;
      case 0xd9: this.pc = this.pop(); this.idle(); this.ime = true; this.eiDelay = 0; return;
      case 0xc1: this.bc = this.pop(); return;
      case 0xd1: this.de = this.pop(); return;
      case 0xe1: this.hl = this.pop(); return;
      case 0xf1: this.af = this.pop(); return;
      case 0xc5: this.idle(); this.push(this.bc); return;
      case 0xd5: this.idle(); this.push(this.de); return;
      case 0xe5: this.idle(); this.push(this.hl); return;
      case 0xf5: this.idle(); this.push(this.af); return;
      case 0xc2: case 0xca: case 0xd2: case 0xda: {
        const a = this.fetch16();
        if (this.cond((op >> 3) & 3)) { this.idle(); this.pc = a; }
        return;
      }
      case 0xc3: { const a = this.fetch16(); this.idle(); this.pc = a; return; }
      case 0xe9: this.pc = this.hl; return;
      case 0xc4: case 0xcc: case 0xd4: case 0xdc: {
        const a = this.fetch16();
        if (this.cond((op >> 3) & 3)) { this.idle(); this.push(this.pc); this.pc = a; }
        return;
      }
      case 0xcd: { const a = this.fetch16(); this.idle(); this.push(this.pc); this.pc = a; return; }
      case 0xc7: case 0xcf: case 0xd7: case 0xdf: case 0xe7: case 0xef: case 0xf7: case 0xff:
        this.idle(); this.push(this.pc); this.pc = op & 0x38; return;
      case 0xc6: case 0xce: case 0xd6: case 0xde: case 0xe6: case 0xee: case 0xf6: case 0xfe:
        this.alu((op >> 3) & 7, this.fetch()); return;
      case 0xe0: this.wr(0xff00 | this.fetch(), this.a); return;
      case 0xf0: this.a = this.rd(0xff00 | this.fetch()); return;
      case 0xe2: this.wr(0xff00 | this.c, this.a); return;
      case 0xf2: this.a = this.rd(0xff00 | this.c); return;
      case 0xea: this.wr(this.fetch16(), this.a); return;
      case 0xfa: this.a = this.rd(this.fetch16()); return;
      case 0xe8: { const e = this.fetch(); this.sp = this.addSP(e); this.idle(); this.idle(); return; }
      case 0xf8: { const e = this.fetch(); this.hl = this.addSP(e); this.idle(); return; }
      case 0xf9: this.idle(); this.sp = this.hl; return;
      case 0xf3: this.ime = false; this.eiDelay = 0; return;
      case 0xfb: if (!this.ime && !this.eiDelay) this.eiDelay = 2; return;
      case 0xcb: {
        const o = this.fetch();
        const r = o & 7;
        const v = this.getR(r);
        const res = this.cb(o, v);
        if (res >= 0) this.setR(r, res);
        return;
      }
      default:
        // Illegal opcodes (D3, DB, DD, E3, E4, EB, EC, ED, F4, FC, FD) lock up the CPU.
        this.halted = true;
        this.gb.ie = 0;
        this.pc = (this.pc - 1) & 0xffff;
        this.locked = true;
        return;
    }
  }

  halt() {
    const gb = this.gb;
    if (!this.ime && (gb.ie & gb.if & 0x1f)) this.haltBug = true; // PC fails to increment
    else this.halted = true;
  }

  stop() {
    this.fetch(); // STOP is two bytes
    const gb = this.gb;
    if (gb.cgb && (gb.key1 & 1)) {
      gb.doubleSpeed = !gb.doubleSpeed;
      gb.key1 = 0;
      gb.timer.counter = 0;
      return;
    }
    gb.timer.counter = 0;
    this.stopped = true;
    this.halted = true; // wakes on joypad interrupt (close enough for software that uses STOP)
  }

  saveState() {
    const s = {};
    for (const k of ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'sp', 'pc', 'ime', 'eiDelay', 'halted', 'haltBug', 'stopped']) s[k] = this[k];
    return s;
  }
  loadState(s) { Object.assign(this, s); }
}
