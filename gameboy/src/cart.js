// Cartridge: header parsing + memory bank controllers (ROM-only, MBC1, MBC2, MBC3+RTC, MBC5).
// The cart owns 0x0000-0x7FFF (ROM) and 0xA000-0xBFFF (external RAM / RTC registers).

const RAM_SIZES = [0, 2048, 8192, 32768, 131072, 65536];

export function parseHeader(rom) {
  let title = '';
  for (let i = 0x134; i < 0x144; i++) {
    const c = rom[i];
    if (c === 0) break;
    if (c < 0x20 || c > 0x7e) { if (i >= 0x13f) break; continue; }
    title += String.fromCharCode(c);
  }
  const cgbFlag = rom[0x143];
  const type = rom[0x147];
  const romBanks = Math.max(2, rom.length >> 14);
  let ramSize = RAM_SIZES[rom[0x149]] ?? 0;
  let mbc = 0, battery = false, rtc = false, rumble = false;
  switch (type) {
    case 0x00: case 0x08: case 0x09: mbc = 0; battery = type === 0x09; if (type !== 0x00 && !ramSize) ramSize = 8192; break;
    case 0x01: case 0x02: case 0x03: mbc = 1; battery = type === 0x03; break;
    case 0x05: case 0x06: mbc = 2; battery = type === 0x06; ramSize = 512; break;
    case 0x0f: case 0x10: mbc = 3; rtc = true; battery = true; break;
    case 0x11: case 0x12: case 0x13: mbc = 3; battery = type === 0x13; break;
    case 0x19: case 0x1a: case 0x1b: mbc = 5; battery = type === 0x1b; break;
    case 0x1c: case 0x1d: case 0x1e: mbc = 5; rumble = true; battery = type === 0x1e; break;
    default: throw new Error(`Unsupported cartridge type 0x${type.toString(16)}`);
  }
  if (mbc === 0 && type === 0x00) ramSize = 0;
  // "+RAM" cart types that declare no RAM size still get 8 KiB (some test ROMs rely on this).
  if (!ramSize && [0x02, 0x03, 0x10, 0x12, 0x13, 0x1a, 0x1b, 0x1d, 0x1e].includes(type)) ramSize = 8192;
  return {
    title: title.trim(),
    cgbFlag,
    cgb: (cgbFlag & 0x80) !== 0,
    cgbOnly: cgbFlag === 0xc0,
    type, mbc, battery, rtc, rumble, romBanks, ramSize,
  };
}

export class Cartridge {
  constructor(romData) {
    // Pad ROM to a power-of-two number of 16 KiB banks so bank masks work.
    const header = parseHeader(romData);
    let banks = 2;
    while (banks < header.romBanks) banks <<= 1;
    this.rom = new Uint8Array(banks * 0x4000);
    this.rom.set(romData.subarray(0, this.rom.length));
    this.header = header;
    this.romBankMask = banks - 1;
    this.ram = new Uint8Array(Math.max(header.ramSize, 0));
    this.ramBankMask = Math.max(1, header.ramSize >> 13) - 1;
    this.mbc = header.mbc;
    // MBC1M multicarts (e.g. Mortal Kombat I&II): 1 MiB with a second Nintendo logo at bank 0x10.
    this.multicart = this.mbc === 1 && this.rom.length === 0x100000 &&
      this.rom[0x40104] === 0xce && this.rom[0x40105] === 0xed && this.rom[0x40134 - 0x30 + 2] === this.rom[0x106];

    this.ramEnable = false;
    this.romBank = 1;     // full bank number for 0x4000-0x7FFF
    this.romBank0 = 0;    // bank mapped at 0x0000-0x3FFF (MBC1 mode 1)
    this.ramBank = 0;
    // MBC1 registers
    this.bank1 = 1; this.bank2 = 0; this.mode = 0;
    // MBC5 registers
    this.romLo = 1; this.romHi = 0;
    // MBC3 RTC
    this.rtcSelect = -1;
    this.rtc = { s: 0, m: 0, h: 0, d: 0, halt: false, carry: false, lastTime: Date.now() };
    this.rtcLatched = [0, 0, 0, 0, 0];
    this.latchPrev = 0xff;
    this.ramDirty = false;
    this.rumble = false;
    this.updateBanks();
  }

  updateBanks() {
    if (this.mbc === 1) {
      // bank2 feeds both ROM bits 5-6 and the RAM bank; the masks drop whichever the cart lacks.
      const sh = this.multicart ? 4 : 5;
      const lo = this.multicart ? this.bank1 & 0x0f : this.bank1;
      this.romBank = ((this.bank2 << sh) | lo) & this.romBankMask;
      this.romBank0 = this.mode ? ((this.bank2 << sh) & this.romBankMask) : 0;
      this.ramBank = this.mode ? (this.bank2 & this.ramBankMask) : 0;
    } else if (this.mbc === 5) {
      this.romBank = ((this.romHi << 8) | this.romLo) & this.romBankMask;
    }
  }

  readRom(addr) {
    if (addr < 0x4000) return this.rom[(this.romBank0 << 14) | addr];
    return this.rom[(this.romBank << 14) | (addr & 0x3fff)];
  }

  writeRom(addr, v) {
    switch (this.mbc) {
      case 0: return;
      case 1:
        if (addr < 0x2000) this.ramEnable = (v & 0x0f) === 0x0a;
        else if (addr < 0x4000) { this.bank1 = (v & 0x1f) || 1; this.updateBanks(); }
        else if (addr < 0x6000) { this.bank2 = v & 3; this.updateBanks(); }
        else { this.mode = v & 1; this.updateBanks(); }
        return;
      case 2:
        if (addr < 0x4000) {
          if (addr & 0x100) this.romBank = ((v & 0x0f) || 1) & this.romBankMask;
          else this.ramEnable = (v & 0x0f) === 0x0a;
        }
        return;
      case 3:
        if (addr < 0x2000) this.ramEnable = (v & 0x0f) === 0x0a;
        else if (addr < 0x4000) this.romBank = ((v & 0x7f) || 1) & this.romBankMask;
        else if (addr < 0x6000) {
          if (v <= 3) { this.ramBank = v & this.ramBankMask; this.rtcSelect = -1; }
          else if (v >= 8 && v <= 0x0c && this.header.rtc) this.rtcSelect = v - 8;
        } else {
          if (this.latchPrev === 0 && v === 1) this.latchRtc();
          this.latchPrev = v;
        }
        return;
      case 5:
        if (addr < 0x2000) this.ramEnable = (v & 0x0f) === 0x0a;
        else if (addr < 0x3000) { this.romLo = v; this.updateBanks(); }
        else if (addr < 0x4000) { this.romHi = v & 1; this.updateBanks(); }
        else if (addr < 0x6000) {
          if (this.header.rumble) { this.rumble = (v & 8) !== 0; v &= 7; }
          this.ramBank = v & 0x0f & this.ramBankMask;
        }
        return;
    }
  }

  readRam(addr) {
    if (!this.ramEnable) return 0xff;
    if (this.mbc === 2) return this.ram[addr & 0x1ff] | 0xf0;
    if (this.mbc === 3 && this.rtcSelect >= 0) return this.rtcLatched[this.rtcSelect];
    if (!this.ram.length) return 0xff;
    return this.ram[((this.ramBank << 13) | (addr & 0x1fff)) & (this.ram.length - 1)];
  }

  writeRam(addr, v) {
    if (!this.ramEnable) return;
    if (this.mbc === 2) { this.ram[addr & 0x1ff] = v & 0x0f; this.ramDirty = true; return; }
    if (this.mbc === 3 && this.rtcSelect >= 0) { this.writeRtc(this.rtcSelect, v); this.ramDirty = true; return; }
    if (!this.ram.length) return;
    this.ram[((this.ramBank << 13) | (addr & 0x1fff)) & (this.ram.length - 1)] = v;
    this.ramDirty = true;
  }

  // ---- MBC3 real-time clock (driven by wall-clock time, so it keeps counting while closed) ----
  updateRtc() {
    const r = this.rtc;
    const now = Date.now();
    if (r.halt) { r.lastTime = now; return; }
    let elapsed = Math.floor((now - r.lastTime) / 1000);
    if (elapsed <= 0) return;
    r.lastTime += elapsed * 1000;
    let total = r.s + elapsed;
    r.s = total % 60; total = Math.floor(total / 60) + r.m;
    r.m = total % 60; total = Math.floor(total / 60) + r.h;
    r.h = total % 24; total = Math.floor(total / 24) + r.d;
    if (total > 511) { r.carry = true; total %= 512; }
    r.d = total;
  }

  latchRtc() {
    this.updateRtc();
    const r = this.rtc;
    this.rtcLatched = [r.s, r.m, r.h, r.d & 0xff,
      ((r.d >> 8) & 1) | (r.halt ? 0x40 : 0) | (r.carry ? 0x80 : 0)];
  }

  writeRtc(reg, v) {
    this.updateRtc();
    const r = this.rtc;
    switch (reg) {
      case 0: r.s = v % 60; r.lastTime = Date.now(); break;
      case 1: r.m = v % 60; break;
      case 2: r.h = v % 24; break;
      case 3: r.d = (r.d & 0x100) | v; break;
      case 4: r.d = (r.d & 0xff) | ((v & 1) << 8); r.halt = (v & 0x40) !== 0; r.carry = (v & 0x80) !== 0; break;
    }
    this.rtcLatched[reg] = v;
  }

  // ---- Battery save (RAM + RTC appended as JSON-free binary trailer) ----
  hasBattery() { return this.header.battery && (this.ram.length > 0 || this.header.rtc); }

  exportSave() {
    if (!this.header.rtc) return this.ram.slice();
    this.updateRtc();
    const r = this.rtc;
    const out = new Uint8Array(this.ram.length + 16);
    out.set(this.ram);
    const dv = new DataView(out.buffer, this.ram.length);
    dv.setUint8(0, r.s); dv.setUint8(1, r.m); dv.setUint8(2, r.h);
    dv.setUint16(3, r.d, true);
    dv.setUint8(5, (r.halt ? 1 : 0) | (r.carry ? 2 : 0));
    dv.setFloat64(8, r.lastTime, true);
    return out;
  }

  importSave(data) {
    this.ram.set(data.subarray(0, this.ram.length));
    if (this.header.rtc && data.length >= this.ram.length + 16) {
      const dv = new DataView(data.buffer, data.byteOffset + this.ram.length);
      const r = this.rtc;
      r.s = dv.getUint8(0); r.m = dv.getUint8(1); r.h = dv.getUint8(2);
      r.d = dv.getUint16(3, true);
      const f = dv.getUint8(5); r.halt = !!(f & 1); r.carry = !!(f & 2);
      r.lastTime = dv.getFloat64(8, true);
    }
  }

  // ---- Save states ----
  saveState() {
    return {
      ram: this.ram.slice(), ramEnable: this.ramEnable, romBank: this.romBank, romBank0: this.romBank0,
      ramBank: this.ramBank, bank1: this.bank1, bank2: this.bank2, mode: this.mode,
      romLo: this.romLo, romHi: this.romHi, rtcSelect: this.rtcSelect, rtc: { ...this.rtc },
      rtcLatched: this.rtcLatched.slice(), latchPrev: this.latchPrev,
    };
  }

  loadState(s) {
    this.ram.set(s.ram);
    Object.assign(this, {
      ramEnable: s.ramEnable, romBank: s.romBank, romBank0: s.romBank0, ramBank: s.ramBank,
      bank1: s.bank1, bank2: s.bank2, mode: s.mode, romLo: s.romLo, romHi: s.romHi,
      rtcSelect: s.rtcSelect, rtcLatched: s.rtcLatched.slice(), latchPrev: s.latchPrev,
    });
    // Keep the wall clock authoritative: a state loaded later shouldn't rewind the RTC's sense of "now".
    this.rtc = { ...s.rtc };
  }
}
