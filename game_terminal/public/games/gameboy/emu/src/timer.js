// DIV/TIMA timer. Modeled on the internal 16-bit counter whose falling edges clock TIMA,
// so DIV-reset glitches and TAC-change glitches fall out naturally.

const TAC_BITS = [1 << 9, 1 << 3, 1 << 5, 1 << 7];

export class Timer {
  constructor(gb) {
    this.gb = gb;
    this.counter = 0;   // internal 16-bit divider; DIV = counter >> 8
    this.tima = 0;
    this.tma = 0;
    this.tac = 0;
    this.overflow = 0;  // M-cycles until the delayed TMA reload (1 = reload happening this cycle)
    this.reloading = false; // true during the cycle TIMA gets reloaded (writes to TIMA are ignored)
  }

  signal(counter = this.counter, tac = this.tac) {
    return (tac & 4) !== 0 && (counter & TAC_BITS[tac & 3]) !== 0;
  }

  incTima() {
    this.tima = (this.tima + 1) & 0xff;
    if (this.tima === 0) this.overflow = 1;
  }

  // One M-cycle (4 ticks of the CPU clock).
  tick() {
    this.reloading = false;
    if (this.overflow) {
      this.overflow = 0;
      this.tima = this.tma;
      this.reloading = true;
      this.gb.requestInterrupt(2);
    }
    const old = this.counter;
    this.counter = (old + 4) & 0xffff;
    if (this.signal(old) && !this.signal(this.counter)) this.incTima();
    // DIV-APU: frame sequencer steps on the falling edge of bit 12 (bit 13 in double speed).
    const apuBit = this.gb.doubleSpeed ? 0x2000 : 0x1000;
    if ((old & apuBit) && !(this.counter & apuBit)) this.gb.apu.frameSequencerStep();
    if ((this.gb.sc & 0x81) === 0x81) this.gb.serialEdge(old, this.counter);
  }

  read(addr) {
    switch (addr) {
      case 0xff04: return this.counter >> 8;
      case 0xff05: return this.tima;
      case 0xff06: return this.tma;
      case 0xff07: return this.tac | 0xf8;
    }
    return 0xff;
  }

  write(addr, v) {
    switch (addr) {
      case 0xff04: {
        const old = this.counter;
        if (this.signal(old)) this.incTima();
        const apuBit = this.gb.doubleSpeed ? 0x2000 : 0x1000;
        if (old & apuBit) this.gb.apu.frameSequencerStep();
        if ((this.gb.sc & 0x81) === 0x81) this.gb.serialEdge(old, 0);
        this.counter = 0;
        break;
      }
      case 0xff05:
        if (this.reloading) return;      // write during the reload cycle is ignored
        this.tima = v;
        this.overflow = 0;               // write during the "TIMA reads 0" cycle cancels the reload
        break;
      case 0xff06:
        this.tma = v;
        if (this.reloading) this.tima = v;
        break;
      case 0xff07: {
        const was = this.signal();
        this.tac = v & 7;
        if (was && !this.signal()) this.incTima();
        break;
      }
    }
  }

  saveState() {
    return { counter: this.counter, tima: this.tima, tma: this.tma, tac: this.tac, overflow: this.overflow, reloading: this.reloading };
  }
  loadState(s) { Object.assign(this, s); }
}
