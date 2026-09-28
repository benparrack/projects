// Top-level machine: memory map, interrupts, OAM DMA, CGB HDMA, joypad, serial and the
// per-M-cycle tick that keeps every component in lockstep with the CPU.

import { CPU } from './cpu.js';
import { PPU } from './ppu.js';
import { APU } from './apu.js';
import { Timer } from './timer.js';
import { Cartridge } from './cart.js';

export const BUTTONS = ['right', 'left', 'up', 'down', 'a', 'b', 'select', 'start'];
export const CYCLES_PER_FRAME = 70224; // T-cycles at normal speed (~59.73 Hz)

export class GameBoy {
  /**
   * @param {Uint8Array} rom
   * @param {{mode?: 'auto'|'dmg'|'cgb', sampleRate?: number}} opts
   */
  constructor(rom, opts = {}) {
    this.cart = new Cartridge(rom);
    const mode = opts.mode || 'auto';
    this.cgb = mode === 'cgb' || (mode === 'auto' && this.cart.header.cgb);
    this.doubleSpeed = false;
    this.key1 = 0;

    this.wram = new Uint8Array(0x8000);
    this.hram = new Uint8Array(0x7f);
    this.wramBank = 1;
    this.ie = 0;
    this.if = 0xe1;

    this.cpu = new CPU(this);
    this.ppu = new PPU(this);
    this.apu = new APU(this, opts.sampleRate || 48000);
    this.timer = new Timer(this);

    // Joypad: bit set = pressed (inverted when read).
    this.buttons = 0;
    this.joypSelect = 0x30;

    // Serial
    this.sb = 0; this.sc = 0; this.serialBits = 0;
    this.onSerialByte = null; // (byte) => incoming byte or undefined (0xFF = nothing connected)

    // OAM DMA
    this.dmaSource = 0; this.dmaIndex = -1; this.dmaDelay = 0; this.dmaReg = 0xff;
    // CGB HDMA
    this.hdmaSrc = 0; this.hdmaDst = 0; this.hdmaLen = 0; this.hdmaActive = false; this.hdmaPending = false;

    this.cycles = 0; // total CPU M-cycles * 4
    this.initPostBoot();
  }

  initPostBoot() {
    const cpu = this.cpu;
    cpu.pc = 0x100; cpu.sp = 0xfffe;
    if (this.cgb) {
      cpu.a = 0x11; cpu.f = 0x80; cpu.b = 0; cpu.c = 0; cpu.d = 0xff; cpu.e = 0x56; cpu.h = 0; cpu.l = 0x0d;
      this.timer.counter = 0x1ea0;
      this.ppu.bgPal.fill(0xff);
      this.ppu.objPal.fill(0xff);
    } else {
      cpu.a = 0x01; cpu.f = 0xb0; cpu.b = 0; cpu.c = 0x13; cpu.d = 0; cpu.e = 0xd8; cpu.h = 0x01; cpu.l = 0x4d;
      this.timer.counter = 0xabc8; // DIV phase from Mooneye boot_div (DMG ABC/MGB)
    }
    this.timer.tac = 0;
    this.joypSelect = 0; // P1 reads $CF: the boot ROM leaves both select lines low
    const apuInit = [[0xff26, 0x80], [0xff10, 0x80], [0xff11, 0xbf], [0xff12, 0xf3], [0xff13, 0xff], [0xff14, 0x3f],
      [0xff16, 0x3f], [0xff17, 0x00], [0xff18, 0xff], [0xff19, 0xbf & 0x7f], [0xff1a, 0x7f], [0xff1b, 0xff], [0xff1c, 0x9f],
      [0xff1d, 0xff], [0xff1e, 0x3f], [0xff20, 0xff], [0xff21, 0], [0xff22, 0], [0xff23, 0x3f], [0xff24, 0x77], [0xff25, 0xf3]];
    for (const [a, v] of apuInit) this.apu.write(a, v);
    this.apu.ch1.enabled = true; // boot beep leaves channel 1 "on" at zero volume
    const p = this.ppu;
    p.lcdc = 0x91; p.bgp = 0xfc; p.statBits = 0;
    p.line = 0; p.ly = 0; p.dot = 0; p.mode = 2; p.startOamScan();
  }

  // ---------------- clocking ----------------

  tick() {
    this.cycles += 4;
    this.timer.tick();
    if (this.dmaIndex >= 0 || this.dmaDelay) this.dmaStep();
    const dots = this.doubleSpeed ? 2 : 4;
    this.ppu.step(dots);
    this.apu.step(dots);
  }

  requestInterrupt(bit) { this.if |= 1 << bit; }

  hblank() { if (this.hdmaActive) this.hdmaPending = true; }

  /** Runs until the PPU finishes a frame (or one frame's worth of cycles if the LCD is off). */
  runFrame() {
    const cpu = this.cpu;
    const ppu = this.ppu;
    ppu.frameReady = false;
    const limit = this.cycles + CYCLES_PER_FRAME * (this.doubleSpeed ? 2 : 1);
    while (!ppu.frameReady && this.cycles < limit) {
      if (this.hdmaPending) this.runHdmaBlock();
      cpu.step();
    }
  }

  /** Runs roughly `n` CPU M-cycles (for headless tests). */
  runCycles(n) {
    const end = this.cycles + n * 4;
    while (this.cycles < end) {
      if (this.hdmaPending) this.runHdmaBlock();
      this.cpu.step();
    }
  }

  // ---------------- memory map ----------------

  read(addr) {
    if (addr < 0x8000) return this.cart.readRom(addr);
    if (addr < 0xa000) return this.ppu.readVram(addr);
    if (addr < 0xc000) return this.cart.readRam(addr);
    if (addr < 0xfe00) {
      addr &= 0x1fff; // C000-DFFF + echo at E000-FDFF
      if (addr < 0x1000) return this.wram[addr];
      return this.wram[(this.wramBank << 12) | (addr & 0xfff)];
    }
    if (addr < 0xfea0) return this.dmaIndex >= 0 ? 0xff : this.ppu.readOam(addr);
    if (addr < 0xff00) return 0; // unusable region
    if (addr >= 0xff80) return addr === 0xffff ? this.ie : this.hram[addr - 0xff80];
    return this.readIO(addr);
  }

  write(addr, v) {
    if (addr < 0x8000) { this.cart.writeRom(addr, v); return; }
    if (addr < 0xa000) { this.ppu.writeVram(addr, v); return; }
    if (addr < 0xc000) { this.cart.writeRam(addr, v); return; }
    if (addr < 0xfe00) {
      addr &= 0x1fff;
      if (addr < 0x1000) this.wram[addr] = v;
      else this.wram[(this.wramBank << 12) | (addr & 0xfff)] = v;
      return;
    }
    if (addr < 0xfea0) { if (this.dmaIndex < 0) this.ppu.writeOam(addr, v); return; }
    if (addr < 0xff00) return;
    if (addr >= 0xff80) { if (addr === 0xffff) this.ie = v; else this.hram[addr - 0xff80] = v; return; }
    this.writeIO(addr, v);
  }

  readIO(addr) {
    switch (addr) {
      case 0xff00: {
        let lo = 0x0f;
        if (!(this.joypSelect & 0x10)) lo &= ~(this.buttons & 0x0f);
        if (!(this.joypSelect & 0x20)) lo &= ~(this.buttons >> 4);
        return 0xc0 | this.joypSelect | lo;
      }
      case 0xff01: return this.sb;
      case 0xff02: return this.sc | (this.cgb ? 0x7c : 0x7e);
      case 0xff04: case 0xff05: case 0xff06: case 0xff07: return this.timer.read(addr);
      case 0xff0f: return this.if | 0xe0;
      case 0xff46: return this.dmaReg;
      case 0xff4d: return this.cgb ? (0x7e | this.key1 | (this.doubleSpeed ? 0x80 : 0)) : 0xff;
      case 0xff55: return this.cgb ? (this.hdmaActive ? ((this.hdmaLen - 1) & 0x7f) : 0xff) : 0xff;
      case 0xff70: return this.cgb ? (0xf8 | this.wramBank) : 0xff;
      case 0xff76: case 0xff77: return this.cgb ? this.apu.readPcm(addr) : 0xff;
    }
    if (addr >= 0xff10 && addr < 0xff40) return this.apu.read(addr);
    if (addr >= 0xff40 && addr < 0xff70) return this.ppu.read(addr);
    return 0xff;
  }

  writeIO(addr, v) {
    switch (addr) {
      case 0xff00: this.joypSelect = v & 0x30; return;
      case 0xff01: this.sb = v; return;
      case 0xff02:
        this.sc = v & (this.cgb ? 0x83 : 0x81);
        if ((v & 0x81) === 0x81) this.serialBits = 0;
        return;
      case 0xff04: case 0xff05: case 0xff06: case 0xff07: this.timer.write(addr, v); return;
      case 0xff0f: this.if = v & 0x1f; return;
      case 0xff46: this.dmaReg = v; this.dmaSource = v << 8; this.dmaDelay = 2; return;
      case 0xff4d: if (this.cgb) this.key1 = v & 1; return;
      case 0xff51: this.hdmaSrc = (this.hdmaSrc & 0xff) | (v << 8); return;
      case 0xff52: this.hdmaSrc = (this.hdmaSrc & 0xff00) | (v & 0xf0); return;
      case 0xff53: this.hdmaDst = (this.hdmaDst & 0xff) | ((v & 0x1f) << 8); return;
      case 0xff54: this.hdmaDst = (this.hdmaDst & 0x1f00) | (v & 0xf0); return;
      case 0xff55: if (this.cgb) this.startHdma(v); return;
      case 0xff70: if (this.cgb) this.wramBank = (v & 7) || 1; return;
    }
    if (addr >= 0xff10 && addr < 0xff40) { this.apu.write(addr, v); return; }
    if (addr >= 0xff40 && addr < 0xff70) this.ppu.write(addr, v);
  }

  // ---------------- DMA ----------------

  dmaStep() {
    if (this.dmaIndex === 160) { this.dmaIndex = -1; if (!this.dmaDelay) return; }
    if (this.dmaDelay) {
      if (--this.dmaDelay === 0) this.dmaIndex = 0;
      if (this.dmaIndex !== 0) return;
    }
    // Source reads bypass the OAM lockout; E000+ sources mirror WRAM.
    let src = this.dmaSource + this.dmaIndex;
    if (src >= 0xe000) src -= 0x2000;
    const saved = this.dmaIndex;
    this.dmaIndex = -1;
    const v = this.read(src);
    this.dmaIndex = saved;
    this.ppu.oam[this.dmaIndex] = v;
    this.dmaIndex++; // stays at 160 (OAM still locked) for one more cycle
  }

  startHdma(v) {
    if (this.hdmaActive && !(v & 0x80)) { this.hdmaActive = false; this.hdmaPending = false; return; }
    this.hdmaLen = (v & 0x7f) + 1;
    if (v & 0x80) {
      this.hdmaActive = true;
      // If we're already in HBlank, the first block goes immediately.
      if (this.ppu.enabled && this.ppu.mode === 0) this.hdmaPending = true;
      if (!this.ppu.enabled) this.hdmaPending = true;
    } else {
      // General-purpose DMA: whole transfer now, CPU stalled.
      while (this.hdmaLen > 0) this.copyHdmaBlock();
    }
  }

  copyHdmaBlock() {
    for (let i = 0; i < 16; i++) {
      const s = (this.hdmaSrc + i) & 0xffff;
      const b = (s >= 0x8000 && s < 0xa000) ? 0xff : this.read(s);
      this.ppu.vram[(this.ppu.vbk << 13) | ((this.hdmaDst + i) & 0x1fff)] = b;
    }
    this.hdmaSrc = (this.hdmaSrc + 16) & 0xffff;
    this.hdmaDst = (this.hdmaDst + 16) & 0x1fff;
    this.hdmaLen--;
    // 8 M-cycles per block at normal speed (16 in double speed).
    const n = this.doubleSpeed ? 16 : 8;
    for (let i = 0; i < n; i++) this.tick();
  }

  runHdmaBlock() {
    this.hdmaPending = false;
    if (!this.hdmaActive) return;
    this.copyHdmaBlock();
    if (this.hdmaLen <= 0) { this.hdmaActive = false; this.hdmaLen = 0; }
  }

  // ---------------- serial ----------------

  // Internal-clock transfers shift one bit per falling edge of a divider bit (8192 Hz, or 262144 Hz in
  // CGB fast mode), so bit timing aligns to the system counter, not to the SC write. Called by the timer.
  // External-clock transfers wait for a partner that never arrives when unlinked.
  serialEdge(oldCounter, newCounter) {
    const bit = (this.cgb && (this.sc & 2)) ? 0x8 : 0x100;
    if (!(oldCounter & bit) || (newCounter & bit)) return;
    if (++this.serialBits < 8) return;
    const out = this.sb;
    let incoming = 0xff;
    if (this.onSerialByte) { const r = this.onSerialByte(out); if (r !== undefined) incoming = r & 0xff; }
    this.sb = incoming;
    this.sc &= 0x7f;
    this.requestInterrupt(3);
  }

  // ---------------- input ----------------

  setButton(name, pressed) {
    const bit = BUTTONS.indexOf(name);
    if (bit < 0) return;
    const was = this.buttons;
    if (pressed) this.buttons |= 1 << bit; else this.buttons &= ~(1 << bit);
    if (pressed && !(was & (1 << bit))) {
      this.requestInterrupt(4);
      if (this.cpu.stopped) { this.cpu.stopped = false; this.cpu.halted = false; }
    }
  }

  // ---------------- persistence ----------------

  saveState() {
    return {
      version: 1,
      title: this.cart.header.title,
      cgb: this.cgb,
      gb: {
        doubleSpeed: this.doubleSpeed, key1: this.key1, wramBank: this.wramBank, ie: this.ie, if: this.if,
        joypSelect: this.joypSelect, sb: this.sb, sc: this.sc, serialBits: this.serialBits,
        dmaSource: this.dmaSource, dmaIndex: this.dmaIndex, dmaDelay: this.dmaDelay, dmaReg: this.dmaReg,
        hdmaSrc: this.hdmaSrc, hdmaDst: this.hdmaDst, hdmaLen: this.hdmaLen, hdmaActive: this.hdmaActive,
        hdmaPending: this.hdmaPending, cycles: this.cycles,
      },
      wram: this.wram.slice(), hram: this.hram.slice(),
      cpu: this.cpu.saveState(), ppu: this.ppu.saveState(), apu: this.apu.saveState(),
      timer: this.timer.saveState(), cart: this.cart.saveState(),
    };
  }

  loadState(s) {
    if (s.cgb !== this.cgb) throw new Error('Save state is for a different hardware mode');
    Object.assign(this, s.gb);
    this.wram.set(s.wram); this.hram.set(s.hram);
    this.cpu.loadState(s.cpu); this.ppu.loadState(s.ppu); this.apu.loadState(s.apu);
    this.timer.loadState(s.timer); this.cart.loadState(s.cart);
  }
}
