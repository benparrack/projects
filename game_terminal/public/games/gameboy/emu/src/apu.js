// Audio processing unit: 2 pulse channels (one with sweep), a wave channel and a noise channel,
// clocked by the DIV-driven frame sequencer. Output is box-filtered down to `sampleRate` stereo floats.

const DUTY = [
  [0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 0],
];
const NOISE_DIV = [8, 16, 32, 48, 64, 80, 96, 112];
const CLOCK = 4194304;

class Envelope {
  constructor() { this.initial = 0; this.up = false; this.period = 0; this.volume = 0; this.timer = 0; }
  write(v) { this.initial = v >> 4; this.up = (v & 8) !== 0; this.period = v & 7; }
  read() { return (this.initial << 4) | (this.up ? 8 : 0) | this.period; }
  get dacOn() { return (this.initial | (this.up ? 1 : 0)) !== 0; }
  trigger() { this.volume = this.initial; this.timer = this.period || 8; }
  clock() {
    if (!this.period) return;
    if (--this.timer <= 0) {
      this.timer = this.period || 8;
      if (this.up && this.volume < 15) this.volume++;
      else if (!this.up && this.volume > 0) this.volume--;
    }
  }
}

class Channel {
  constructor(apu, maxLen) {
    this.apu = apu; this.maxLen = maxLen;
    this.enabled = false; this.length = 0; this.lengthEnable = false;
    this.freq = 0; this.timer = 0;
  }
  clockLength() {
    if (this.lengthEnable && this.length > 0 && --this.length === 0) this.enabled = false;
  }
  // Shared NRx4 handling (length-enable quirks + trigger) — returns true if triggered.
  writeControl(v) {
    const firstHalf = (this.apu.seqStep & 1) === 1; // next step does not clock length
    const wasEnabled = this.lengthEnable;
    this.lengthEnable = (v & 0x40) !== 0;
    this.freq = (this.freq & 0xff) | ((v & 7) << 8);
    if (firstHalf && !wasEnabled && this.lengthEnable && this.length > 0) {
      if (--this.length === 0 && !(v & 0x80)) this.enabled = false;
    }
    if (v & 0x80) {
      if (this.length === 0) {
        this.length = this.maxLen;
        if (this.lengthEnable && firstHalf) this.length--;
      }
      return true;
    }
    return false;
  }
}

class Pulse extends Channel {
  constructor(apu, hasSweep) {
    super(apu, 64);
    this.hasSweep = hasSweep;
    this.duty = 0; this.dutyPos = 0; this.env = new Envelope();
    this.sweepPeriod = 0; this.sweepNeg = false; this.sweepShift = 0;
    this.sweepTimer = 0; this.sweepEnabled = false; this.shadow = 0; this.negUsed = false;
  }
  get period() { return (2048 - this.freq) * 4; }
  trigger() {
    this.enabled = this.env.dacOn;
    this.timer = this.period;
    this.env.trigger();
    if (this.hasSweep) {
      this.shadow = this.freq;
      this.sweepTimer = this.sweepPeriod || 8;
      this.sweepEnabled = this.sweepPeriod !== 0 || this.sweepShift !== 0;
      this.negUsed = false;
      if (this.sweepShift) this.sweepCalc();
    }
  }
  sweepCalc() {
    let delta = this.shadow >> this.sweepShift;
    if (this.sweepNeg) { delta = -delta; this.negUsed = true; }
    const f = this.shadow + delta;
    if (f > 2047) this.enabled = false;
    return f;
  }
  clockSweep() {
    if (--this.sweepTimer <= 0) {
      this.sweepTimer = this.sweepPeriod || 8;
      if (this.sweepEnabled && this.sweepPeriod) {
        const f = this.sweepCalc();
        if (f <= 2047 && this.sweepShift) {
          this.shadow = f; this.freq = f;
          this.sweepCalc();
        }
      }
    }
  }
  step(cycles) {
    this.timer -= cycles;
    while (this.timer <= 0) { this.timer += this.period; this.dutyPos = (this.dutyPos + 1) & 7; }
  }
  get output() {
    if (!this.enabled) return 0;
    return DUTY[this.duty][this.dutyPos] ? this.env.volume : 0;
  }
  get dacOn() { return this.env.dacOn; }
}

class Wave extends Channel {
  constructor(apu) {
    super(apu, 256);
    this.dac = false; this.volCode = 0; this.pos = 0; this.sample = 0; this.ram = new Uint8Array(16);
    this.justRead = 0;
  }
  get period() { return (2048 - this.freq) * 2; }
  trigger() {
    this.enabled = this.dac;
    this.timer = this.period + 6; // small startup delay
    this.pos = 0;
  }
  step(cycles) {
    this.justRead = 0;
    this.timer -= cycles;
    while (this.timer <= 0) {
      this.timer += this.period;
      this.pos = (this.pos + 1) & 31;
      const b = this.ram[this.pos >> 1];
      this.sample = (this.pos & 1) ? b & 0x0f : b >> 4;
      this.justRead = 2;
    }
  }
  get output() {
    if (!this.enabled || !this.volCode) return 0;
    return this.sample >> (this.volCode - 1);
  }
  get dacOn() { return this.dac; }
}

class Noise extends Channel {
  constructor(apu) {
    super(apu, 64);
    this.env = new Envelope(); this.shift = 0; this.width7 = false; this.divCode = 0; this.lfsr = 0x7fff;
  }
  get period() { return NOISE_DIV[this.divCode] << this.shift; }
  trigger() {
    this.enabled = this.env.dacOn;
    this.timer = this.period;
    this.env.trigger();
    this.lfsr = 0x7fff;
  }
  step(cycles) {
    this.timer -= cycles;
    while (this.timer <= 0) {
      this.timer += this.period;
      if (this.shift >= 14) continue; // shifts 14/15 stop the LFSR
      const bit = (this.lfsr ^ (this.lfsr >> 1)) & 1;
      this.lfsr = (this.lfsr >> 1) | (bit << 14);
      if (this.width7) this.lfsr = (this.lfsr & ~0x40) | (bit << 6);
    }
  }
  get output() {
    if (!this.enabled) return 0;
    return (this.lfsr & 1) ? 0 : this.env.volume;
  }
  get dacOn() { return this.env.dacOn; }
}

// Read-back OR masks for FF10-FF2F (unused bits read as 1).
const READ_MASK = [
  0x80, 0x3f, 0x00, 0xff, 0xbf, 0xff, 0x3f, 0x00, 0xff, 0xbf, 0x7f, 0xff, 0x9f, 0xff, 0xbf, 0xff,
  0xff, 0x00, 0x00, 0xbf, 0x00, 0x00, 0x70, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
];

export class APU {
  constructor(gb, sampleRate = 48000) {
    this.gb = gb;
    this.cgb = gb.cgb;
    this.ch1 = new Pulse(this, true);
    this.ch2 = new Pulse(this, false);
    this.ch3 = new Wave(this);
    this.ch4 = new Noise(this);
    this.chs = [this.ch1, this.ch2, this.ch3, this.ch4];
    this.regs = new Uint8Array(0x30);
    this.power = true;
    this.seqStep = 0;
    this.nr50 = 0x77; this.nr51 = 0xf3;
    this.setSampleRate(sampleRate);
    this.bufSize = 8192;
    this.buffer = new Float32Array(this.bufSize * 2);
    this.bufPos = 0;
    this.accL = 0; this.accR = 0; this.accN = 0; this.phase = 0;
    this.hpL = 0; this.hpR = 0;
    this.enabledOutput = true;
    this.channelMute = [false, false, false, false];
  }

  setSampleRate(rate) {
    this.sampleRate = rate;
    this.cyclesPerSample = CLOCK / rate;
    this.hpCharge = Math.pow(0.999958, this.cyclesPerSample); // DMG-ish DC-blocking capacitor
  }

  frameSequencerStep() {
    if (!this.power) return;
    const s = this.seqStep;
    if ((s & 1) === 0) {
      this.ch1.clockLength(); this.ch2.clockLength(); this.ch3.clockLength(); this.ch4.clockLength();
    }
    if (s === 2 || s === 6) this.ch1.clockSweep();
    if (s === 7) { this.ch1.env.clock(); this.ch2.env.clock(); this.ch4.env.clock(); }
    this.seqStep = (s + 1) & 7;
  }

  // Advance by `cycles` T-cycles at the normal-speed 4 MiHz clock.
  step(cycles) {
    if (this.power) {
      this.ch1.step(cycles); this.ch2.step(cycles); this.ch3.step(cycles); this.ch4.step(cycles);
    }
    if (!this.enabledOutput) return;
    // Mix
    let l = 0, r = 0;
    if (this.power) {
      const chs = this.chs;
      const pan = this.nr51;
      for (let i = 0; i < 4; i++) {
        const ch = chs[i];
        if (!ch.dacOn || this.channelMute[i]) continue;
        const a = ch.output / 7.5 - 1; // DAC: 0..15 -> +1..-1 (inverted doesn't matter)
        if (pan & (0x10 << i)) l += a;
        if (pan & (1 << i)) r += a;
      }
      l *= (((this.nr50 >> 4) & 7) + 1) / 8;
      r *= ((this.nr50 & 7) + 1) / 8;
    }
    this.accL += l * cycles; this.accR += r * cycles; this.accN += cycles;
    this.phase += cycles;
    if (this.phase >= this.cyclesPerSample) {
      this.phase -= this.cyclesPerSample;
      let outL = this.accL / this.accN / 4, outR = this.accR / this.accN / 4;
      this.accL = this.accR = this.accN = 0;
      // High-pass filter removes the DAC's DC offset.
      const fl = outL - this.hpL; this.hpL = outL - fl * this.hpCharge;
      const fr = outR - this.hpR; this.hpR = outR - fr * this.hpCharge;
      if (this.bufPos < this.bufSize) {
        this.buffer[this.bufPos * 2] = fl;
        this.buffer[this.bufPos * 2 + 1] = fr;
        this.bufPos++;
      }
    }
  }

  // Returns the interleaved stereo samples produced since the last call.
  takeSamples() {
    const out = this.buffer.slice(0, this.bufPos * 2);
    this.bufPos = 0;
    return out;
  }

  read(addr) {
    if (addr >= 0xff30 && addr <= 0xff3f) {
      if (this.ch3.enabled) {
        // While playing, reads see the byte the wave channel is currently reading (DMG: only right at the access).
        if (this.cgb || this.ch3.justRead) return this.ch3.ram[this.ch3.pos >> 1];
        return 0xff;
      }
      return this.ch3.ram[addr - 0xff30];
    }
    const i = addr - 0xff10;
    if (addr === 0xff26) {
      return (this.power ? 0x80 : 0) | 0x70 |
        (this.ch1.enabled ? 1 : 0) | (this.ch2.enabled ? 2 : 0) | (this.ch3.enabled ? 4 : 0) | (this.ch4.enabled ? 8 : 0);
    }
    if (i < 0 || i >= 0x20) return 0xff;
    return this.regs[i] | READ_MASK[i];
  }

  write(addr, v) {
    if (addr >= 0xff30 && addr <= 0xff3f) {
      if (this.ch3.enabled) {
        if (this.cgb || this.ch3.justRead) this.ch3.ram[this.ch3.pos >> 1] = v;
        return;
      }
      this.ch3.ram[addr - 0xff30] = v;
      return;
    }
    if (addr === 0xff26) {
      const on = (v & 0x80) !== 0;
      if (this.power && !on) this.powerOff();
      else if (!this.power && on) { this.power = true; this.seqStep = 0; }
      return;
    }
    if (!this.power) {
      // DMG allows length writes while powered off.
      if (!this.cgb) {
        if (addr === 0xff11) this.ch1.length = 64 - (v & 0x3f);
        else if (addr === 0xff16) this.ch2.length = 64 - (v & 0x3f);
        else if (addr === 0xff1b) this.ch3.length = 256 - v;
        else if (addr === 0xff20) this.ch4.length = 64 - (v & 0x3f);
      }
      return;
    }
    const i = addr - 0xff10;
    if (i < 0 || i >= 0x20) return;
    this.regs[i] = v;
    const { ch1, ch2, ch3, ch4 } = this;
    switch (addr) {
      case 0xff10:
        ch1.sweepPeriod = (v >> 4) & 7; ch1.sweepShift = v & 7;
        const neg = (v & 8) !== 0;
        if (ch1.sweepNeg && !neg && ch1.negUsed) ch1.enabled = false;
        ch1.sweepNeg = neg;
        break;
      case 0xff11: ch1.duty = v >> 6; ch1.length = 64 - (v & 0x3f); break;
      case 0xff12: ch1.env.write(v); if (!ch1.env.dacOn) ch1.enabled = false; break;
      case 0xff13: ch1.freq = (ch1.freq & 0x700) | v; break;
      case 0xff14: if (ch1.writeControl(v)) ch1.trigger(); break;
      case 0xff16: ch2.duty = v >> 6; ch2.length = 64 - (v & 0x3f); break;
      case 0xff17: ch2.env.write(v); if (!ch2.env.dacOn) ch2.enabled = false; break;
      case 0xff18: ch2.freq = (ch2.freq & 0x700) | v; break;
      case 0xff19: if (ch2.writeControl(v)) ch2.trigger(); break;
      case 0xff1a: ch3.dac = (v & 0x80) !== 0; if (!ch3.dac) ch3.enabled = false; break;
      case 0xff1b: ch3.length = 256 - v; break;
      case 0xff1c: ch3.volCode = (v >> 5) & 3; break;
      case 0xff1d: ch3.freq = (ch3.freq & 0x700) | v; break;
      case 0xff1e: {
        if (ch3.writeControl(v)) {
          // DMG quirk: retriggering while the channel is reading corrupts wave RAM.
          if (!this.cgb && ch3.enabled && ch3.timer === 2) {
            const p = ((ch3.pos + 1) & 31) >> 1;
            if (p < 4) ch3.ram[0] = ch3.ram[p];
            else { const b = p & ~3; for (let k = 0; k < 4; k++) ch3.ram[k] = ch3.ram[b + k]; }
          }
          ch3.trigger();
        }
        break;
      }
      case 0xff20: ch4.length = 64 - (v & 0x3f); break;
      case 0xff21: ch4.env.write(v); if (!ch4.env.dacOn) ch4.enabled = false; break;
      case 0xff22: ch4.shift = v >> 4; ch4.width7 = (v & 8) !== 0; ch4.divCode = v & 7; break;
      case 0xff23: if (ch4.writeControl(v)) ch4.trigger(); break;
      case 0xff24: this.nr50 = v; break;
      case 0xff25: this.nr51 = v; break;
    }
  }

  powerOff() {
    for (let a = 0xff10; a <= 0xff25; a++) this.write(a, 0);
    const lens = [this.ch1.length, this.ch2.length, this.ch3.length, this.ch4.length];
    this.power = false;
    for (const ch of [this.ch1, this.ch2, this.ch3, this.ch4]) { ch.enabled = false; ch.lengthEnable = false; }
    this.ch1.duty = 0; this.ch2.duty = 0;
    if (!this.cgb) { // DMG keeps length counters across power cycles
      this.ch1.length = lens[0]; this.ch2.length = lens[1]; this.ch3.length = lens[2]; this.ch4.length = lens[3];
    } else {
      this.ch1.length = this.ch2.length = this.ch4.length = 0; this.ch3.length = 0;
    }
    this.regs.fill(0);
  }

  // CGB PCM12/PCM34 registers.
  readPcm(addr) {
    if (addr === 0xff76) return this.ch1.output | (this.ch2.output << 4);
    return this.ch3.output | (this.ch4.output << 4);
  }

  saveState() {
    const ch = c => {
      const o = {};
      for (const [k, v] of Object.entries(c)) {
        if (k === 'apu') continue;
        if (v instanceof Envelope) o[k] = { ...v };
        else if (v instanceof Uint8Array) o[k] = v.slice();
        else o[k] = v;
      }
      return o;
    };
    return {
      ch1: ch(this.ch1), ch2: ch(this.ch2), ch3: ch(this.ch3), ch4: ch(this.ch4),
      regs: this.regs.slice(), power: this.power, seqStep: this.seqStep, nr50: this.nr50, nr51: this.nr51,
    };
  }
  loadState(s) {
    for (const n of ['ch1', 'ch2', 'ch3', 'ch4']) {
      const c = this[n];
      for (const [k, v] of Object.entries(s[n])) {
        if (k === 'env') Object.assign(c.env, v);
        else if (k === 'ram') c.ram.set(v);
        else c[k] = v;
      }
    }
    this.regs.set(s.regs);
    Object.assign(this, { power: s.power, seqStep: s.seqStep, nr50: s.nr50, nr51: s.nr51 });
  }
}
