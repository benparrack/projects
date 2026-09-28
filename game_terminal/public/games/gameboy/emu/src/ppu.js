// Picture processing unit. Timing is dot-accurate at the mode-transition level
// (OAM scan / pixel transfer / HBlank / VBlank, STAT IRQ edge logic, LY=153 quirk);
// pixels are produced one full scanline at a time at the start of mode 3.

export const WIDTH = 160, HEIGHT = 144;

// DMG shade palettes (ABGR little-endian for ImageData). Index = shade 0..3.
const rgb = (r, g, b) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
export const DMG_PALETTES = {
  green: [rgb(0xe0, 0xf8, 0xd0), rgb(0x88, 0xc0, 0x70), rgb(0x34, 0x68, 0x56), rgb(0x08, 0x18, 0x20)],
  gray: [rgb(0xff, 0xff, 0xff), rgb(0xaa, 0xaa, 0xaa), rgb(0x55, 0x55, 0x55), rgb(0, 0, 0)],
  pocket: [rgb(0xc5, 0xcf, 0xa1), rgb(0x8b, 0x95, 0x6d), rgb(0x4d, 0x53, 0x3c), rgb(0x1f, 0x1f, 0x1f)],
};

export class PPU {
  constructor(gb) {
    this.gb = gb;
    this.cgb = gb.cgb;
    this.vram = new Uint8Array(0x4000);
    this.oam = new Uint8Array(160);
    this.bgPal = new Uint8Array(64);
    this.objPal = new Uint8Array(64);
    this.frame = new Uint32Array(WIDTH * HEIGHT);
    this.shades = DMG_PALETTES.green;
    this.colorCorrect = true;
    this.cgbLut = new Uint32Array(32768);
    this.buildCgbLut();

    this.lcdc = 0x91; this.statBits = 0; this.scy = 0; this.scx = 0;
    this.ly = 0; this.lyc = 0; this.bgp = 0xfc; this.obp0 = 0xff; this.obp1 = 0xff;
    this.wy = 0; this.wx = 0; this.vbk = 0; this.bcps = 0; this.ocps = 0; this.opri = 0;

    this.line = 0;        // internal line counter (0..153); LY register can differ on line 153
    this.dot = 0;         // dot within current line (0..455)
    this.mode = 0;
    this.mode3Len = 172;
    this.statLine = false;
    this.windowLine = 0;
    this.wyTriggered = false;
    this.frameReady = false;
    this.lcdJustOn = false;
    this.lycMatch = false;

    // Scratch buffers for scanline rendering.
    this.bgIdx = new Uint8Array(WIDTH);
    this.bgAttrPrio = new Uint8Array(WIDTH);
    this.objColor = new Int16Array(WIDTH);
    this.objAttrBuf = new Uint8Array(WIDTH);
    this.lineSprites = [];
  }

  buildCgbLut() {
    for (let c = 0; c < 32768; c++) {
      const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
      let R, G, B;
      if (this.colorCorrect) {
        // Gentle LCD-style correction (desaturate + gamma) so CGB colors aren't neon on modern screens.
        R = (r * 26 + g * 4 + b * 2) >> 5; G = (g * 24 + b * 8) >> 5; B = (r * 6 + g * 4 + b * 22) >> 5;
        R = Math.min(255, Math.round(Math.pow(R / 31, 0.9) * 255));
        G = Math.min(255, Math.round(Math.pow(G / 31, 0.9) * 255));
        B = Math.min(255, Math.round(Math.pow(B / 31, 0.9) * 255));
      } else {
        R = (r << 3) | (r >> 2); G = (g << 3) | (g >> 2); B = (b << 3) | (b >> 2);
      }
      this.cgbLut[c] = rgb(R, G, B);
    }
  }

  setColorCorrection(on) { this.colorCorrect = on; this.buildCgbLut(); }

  get enabled() { return (this.lcdc & 0x80) !== 0; }

  // ---------------- timing ----------------

  step(dots) {
    if (!this.enabled) return;
    while (dots > 0) {
      const target = this.nextEventDot();
      const adv = Math.min(dots, target - this.dot);
      this.dot += adv;
      dots -= adv;
      if (this.dot === target) this.event();
    }
  }

  nextEventDot() {
    if (this.line < 144) {
      if (this.mode === 2) return 80;
      if (this.mode === 3) return 80 + this.mode3Len;
      return 456;
    }
    if (this.line === 153 && this.dot < 4) return 4;
    return 456;
  }

  event() {
    if (this.line < 144) {
      if (this.mode === 2 && this.dot === 80) {
        this.mode = 3;
        this.renderLine();
        this.updateStat();
        return;
      }
      if (this.mode === 3) {
        this.mode = 0;
        this.updateStat();
        this.gb.hblank();
        return;
      }
    }
    if (this.line === 153 && this.dot === 4) {
      this.ly = 0;           // LY reads 0 for almost all of line 153
      this.updateStat();
      return;
    }
    if (this.dot >= 456) {
      this.dot = 0;
      this.line++;
      this.lcdJustOn = false;
      if (this.line === 154) {
        this.line = 0;
        this.windowLine = 0;
        this.wyTriggered = false;
      }
      this.ly = this.line;
      if (this.line < 144) {
        this.mode = 2;
        this.startOamScan();
      } else if (this.line === 144) {
        this.mode = 1;
        this.gb.requestInterrupt(0);
        this.frameReady = true;
        // Quirk: the mode-2 STAT source also fires at the start of VBlank.
        if (this.statBits & 0x20 && !this.statLine) this.gb.requestInterrupt(1);
      }
      this.updateStat();
    }
  }

  // Recompute the combined STAT interrupt line; IRQ fires on its rising edge ("STAT blocking").
  updateStat() {
    this.lycMatch = this.ly === this.lyc;
    const s = this.statBits;
    const line = (this.lycMatch && (s & 0x40) !== 0) ||
      (this.mode === 0 && (s & 0x08) !== 0) ||
      (this.mode === 1 && (s & 0x10) !== 0) ||
      (this.mode === 2 && !this.lcdJustOn && (s & 0x20) !== 0) ||
      (this.mode === 2 && this.lcdJustOn && (s & 0x08) !== 0);
    if (line && !this.statLine) this.gb.requestInterrupt(1);
    this.statLine = line;
  }

  startOamScan() {
    if (this.ly === this.wy) this.wyTriggered = true;
    // Select up to 10 sprites overlapping this line (in OAM order).
    const h = (this.lcdc & 4) ? 16 : 8;
    const ly = this.line;
    const list = this.lineSprites;
    list.length = 0;
    for (let i = 0; i < 40 && list.length < 10; i++) {
      const y = this.oam[i * 4] - 16;
      if (ly >= y && ly < y + h) list.push(i);
    }
    // Approximate mode-3 length: base + fine scroll + window + per-sprite penalty.
    let len = 172 + (this.scx & 7);
    if ((this.lcdc & 0x20) && this.wyTriggered && this.wx <= 166) len += 6;
    if (this.lcdc & 2) len += list.length * 6;
    this.mode3Len = Math.min(len, 289);
  }

  // ---------------- rendering ----------------

  renderLine() {
    const ly = this.line;
    const out = this.frame;
    const base = ly * WIDTH;
    const lcdc = this.lcdc;
    const bgIdx = this.bgIdx, bgAttrPrio = this.bgAttrPrio;

    const bgOn = this.cgb || (lcdc & 1);
    const colorOut = this.lineColors || (this.lineColors = new Uint32Array(WIDTH));

    if (bgOn) {
      const unsignedTiles = (lcdc & 0x10) !== 0;
      const winOn = (lcdc & 0x20) && this.wyTriggered && this.wx <= 166;
      const winStart = winOn ? this.wx - 7 : WIDTH;
      // Background part
      const bgMap = (lcdc & 0x08) ? 0x1c00 : 0x1800;
      const y = (ly + this.scy) & 0xff;
      this.drawTiles(0, Math.min(WIDTH, Math.max(winStart, 0)), bgMap, y, this.scx, unsignedTiles, colorOut);
      if (winOn) {
        const winMap = (lcdc & 0x40) ? 0x1c00 : 0x1800;
        this.drawTiles(Math.max(winStart, 0), WIDTH, winMap, this.windowLine, -winStart, unsignedTiles, colorOut);
        this.windowLine++;
      }
    } else {
      const c = this.shades[this.bgp & 3];
      for (let x = 0; x < WIDTH; x++) { bgIdx[x] = 0; bgAttrPrio[x] = 0; colorOut[x] = c; }
    }

    if (lcdc & 2) this.drawSprites(colorOut);

    out.set(colorOut, base);
  }

  // Draws background/window pixels [x0,x1) using map `map`, map-row `y`, horizontal offset `scroll`
  // (pixel x reads map column (x + scroll)).
  drawTiles(x0, x1, map, y, scroll, unsignedTiles, colorOut) {
    if (x0 >= x1) return;
    const vram = this.vram, cgb = this.cgb;
    const bgIdx = this.bgIdx, bgAttrPrio = this.bgAttrPrio;
    const rowBase = map + ((y >> 3) & 31) * 32;
    let x = x0;
    while (x < x1) {
      const mx = (x + scroll) & 0xff;
      const tileNum = vram[rowBase + (mx >> 3)];
      const attr = cgb ? vram[0x2000 + rowBase + (mx >> 3)] : 0;
      let tileAddr = unsignedTiles ? tileNum * 16 : 0x1000 + ((tileNum << 24) >> 24) * 16;
      if (attr & 0x08) tileAddr += 0x2000;
      let ty = y & 7;
      if (attr & 0x40) ty = 7 - ty;
      const lo = vram[tileAddr + ty * 2], hi = vram[tileAddr + ty * 2 + 1];
      const flipX = (attr & 0x20) !== 0;
      const pal = (attr & 7) * 8;
      let px = mx & 7;
      for (; px < 8 && x < x1; px++, x++) {
        const bit = flipX ? px : 7 - px;
        const ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
        bgIdx[x] = ci;
        if (cgb) {
          bgAttrPrio[x] = attr & 0x80;
          const o = pal + ci * 2;
          colorOut[x] = this.cgbLut[(this.bgPal[o] | (this.bgPal[o + 1] << 8)) & 0x7fff];
        } else {
          bgAttrPrio[x] = 0;
          colorOut[x] = this.shades[(this.bgp >> (ci * 2)) & 3];
        }
      }
    }
  }

  drawSprites(colorOut) {
    const list = this.lineSprites;
    if (!list.length) return;
    const cgb = this.cgb;
    const dmgOrder = !cgb || (this.opri & 1);
    // Priority order: CGB = OAM index; DMG = lower X first, ties by OAM index.
    const order = list.slice();
    if (dmgOrder) order.sort((a, b) => (this.oam[a * 4 + 1] - this.oam[b * 4 + 1]) || (a - b));
    const objColor = this.objColor, objAttr = this.objAttrBuf;
    objColor.fill(-1);
    const h = (this.lcdc & 4) ? 16 : 8;
    const ly = this.line;
    const vram = this.vram;
    for (const i of order) {
      const sy = this.oam[i * 4] - 16;
      const sx = this.oam[i * 4 + 1] - 8;
      let tile = this.oam[i * 4 + 2];
      const attr = this.oam[i * 4 + 3];
      if (h === 16) tile &= 0xfe;
      let row = ly - sy;
      if (attr & 0x40) row = h - 1 - row;
      let addr = tile * 16 + row * 2;
      if (cgb && (attr & 0x08)) addr += 0x2000;
      const lo = vram[addr], hi = vram[addr + 1];
      for (let px = 0; px < 8; px++) {
        const x = sx + px;
        if (x < 0 || x >= WIDTH || objColor[x] >= 0) continue;
        const bit = (attr & 0x20) ? px : 7 - px;
        const ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
        if (!ci) continue;
        objColor[x] = ci;
        objAttr[x] = attr;
      }
    }
    const bgIdx = this.bgIdx, bgAttrPrio = this.bgAttrPrio;
    const master = this.lcdc & 1; // CGB: when clear, sprites always on top
    for (let x = 0; x < WIDTH; x++) {
      const ci = objColor[x];
      if (ci < 0) continue;
      const attr = objAttr[x];
      if (cgb) {
        if (master && bgIdx[x] && ((attr & 0x80) || bgAttrPrio[x])) continue;
        const o = (attr & 7) * 8 + ci * 2;
        colorOut[x] = this.cgbLut[(this.objPal[o] | (this.objPal[o + 1] << 8)) & 0x7fff];
      } else {
        if ((attr & 0x80) && bgIdx[x]) continue;
        const pal = (attr & 0x10) ? this.obp1 : this.obp0;
        colorOut[x] = this.shades[(pal >> (ci * 2)) & 3];
      }
    }
  }

  // ---------------- registers ----------------

  canAccessVram() { return !this.enabled || this.mode !== 3; }
  canAccessOam() { return !this.enabled || this.mode < 2 || (this.lcdJustOn && this.mode === 2); }

  readVram(addr) {
    if (!this.canAccessVram()) return 0xff;
    return this.vram[(this.vbk << 13) | (addr & 0x1fff)];
  }
  writeVram(addr, v) {
    if (!this.canAccessVram()) return;
    this.vram[(this.vbk << 13) | (addr & 0x1fff)] = v;
  }
  readOam(addr) {
    if (!this.canAccessOam()) return 0xff;
    return this.oam[addr & 0xff];
  }
  writeOam(addr, v) {
    if (!this.canAccessOam()) return;
    this.oam[addr & 0xff] = v;
  }

  read(addr) {
    switch (addr) {
      case 0xff40: return this.lcdc;
      case 0xff41: {
        const mode = !this.enabled || (this.lcdJustOn && this.mode === 2) ? 0 : this.mode;
        return 0x80 | this.statBits | (this.lycMatch ? 4 : 0) | mode;
      }
      case 0xff42: return this.scy;
      case 0xff43: return this.scx;
      case 0xff44: return this.enabled ? this.ly : 0;
      case 0xff45: return this.lyc;
      case 0xff47: return this.bgp;
      case 0xff48: return this.obp0;
      case 0xff49: return this.obp1;
      case 0xff4a: return this.wy;
      case 0xff4b: return this.wx;
    }
    if (!this.cgb) return 0xff;
    switch (addr) {
      case 0xff4f: return 0xfe | this.vbk;
      case 0xff68: return this.bcps | 0x40;
      case 0xff69: return this.canAccessVram() ? this.bgPal[this.bcps & 0x3f] : 0xff;
      case 0xff6a: return this.ocps | 0x40;
      case 0xff6b: return this.canAccessVram() ? this.objPal[this.ocps & 0x3f] : 0xff;
      case 0xff6c: return 0xfe | this.opri;
    }
    return 0xff;
  }

  write(addr, v) {
    switch (addr) {
      case 0xff40: {
        const wasOn = this.enabled;
        this.lcdc = v;
        if (wasOn && !this.enabled) {
          this.ly = 0; this.line = 0; this.dot = 0; this.mode = 0;
          this.windowLine = 0; this.wyTriggered = false;
          this.statLine = false;
          // Blank screen while LCD is off.
          this.frame.fill(this.cgb ? 0xffffffff : this.shades[0]);
          this.frameReady = true;
        } else if (!wasOn && this.enabled) {
          // The first line after enabling skips the OAM scan: STAT reports mode 0 until
          // pixel transfer starts (internally we still run the mode-2 timer).
          this.ly = 0; this.line = 0; this.dot = 4; this.mode = 2;
          this.lcdJustOn = true;
          this.lineSprites.length = 0;
          this.mode3Len = 172 + (this.scx & 7);
          this.updateStat();
        }
        return;
      }
      case 0xff41: this.statBits = v & 0x78; if (this.enabled) this.updateStat(); return;
      case 0xff42: this.scy = v; return;
      case 0xff43: this.scx = v; return;
      case 0xff44: return;
      case 0xff45: this.lyc = v; if (this.enabled) this.updateStat(); return;
      case 0xff47: this.bgp = v; return;
      case 0xff48: this.obp0 = v; return;
      case 0xff49: this.obp1 = v; return;
      case 0xff4a: this.wy = v; return;
      case 0xff4b: this.wx = v; return;
    }
    if (!this.cgb) return;
    switch (addr) {
      case 0xff4f: this.vbk = v & 1; return;
      case 0xff68: this.bcps = v & 0xbf; return;
      case 0xff69:
        if (this.canAccessVram()) this.bgPal[this.bcps & 0x3f] = v;
        if (this.bcps & 0x80) this.bcps = 0x80 | ((this.bcps + 1) & 0x3f);
        return;
      case 0xff6a: this.ocps = v & 0xbf; return;
      case 0xff6b:
        if (this.canAccessVram()) this.objPal[this.ocps & 0x3f] = v;
        if (this.ocps & 0x80) this.ocps = 0x80 | ((this.ocps + 1) & 0x3f);
        return;
      case 0xff6c: this.opri = v & 1; return;
    }
  }

  saveState() {
    const s = {};
    for (const k of ['lcdc', 'statBits', 'scy', 'scx', 'ly', 'lyc', 'bgp', 'obp0', 'obp1', 'wy', 'wx', 'vbk',
      'bcps', 'ocps', 'opri', 'line', 'dot', 'mode', 'mode3Len', 'statLine', 'windowLine', 'wyTriggered', 'lycMatch']) s[k] = this[k];
    s.vram = this.vram.slice(); s.oam = this.oam.slice(); s.bgPal = this.bgPal.slice(); s.objPal = this.objPal.slice();
    s.lineSprites = this.lineSprites.slice();
    return s;
  }
  loadState(s) {
    const { vram, oam, bgPal, objPal, lineSprites, ...rest } = s;
    Object.assign(this, rest);
    this.vram.set(vram); this.oam.set(oam); this.bgPal.set(bgPal); this.objPal.set(objPal);
    this.lineSprites = lineSprites.slice();
  }
}
