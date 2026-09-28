// UI-agnostic emulator host: drives a GameBoy at real-time speed and wires it to a canvas,
// Web Audio, keyboard/gamepad/touch input and IndexedDB persistence (battery saves, save states).
// Used by the standalone page (web/ui.js) and by game_terminal's Game Boy room.

import { GameBoy, BUTTONS } from '../src/gameboy.js';
import { DMG_PALETTES, WIDTH, HEIGHT } from '../src/ppu.js';
import * as store from './storage.js';

const FRAME_MS = 1000 / (4194304 / 70224); // ~16.74ms (59.73 Hz)
const REWIND_EVERY = 3;       // snapshot every N frames
const REWIND_MAX = 360;       // ~18 s of rewind

export const DEFAULT_KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  KeyX: 'a', KeyK: 'a', KeyZ: 'b', KeyJ: 'b',
  Enter: 'start', ShiftRight: 'select', ShiftLeft: 'select', Backspace: 'select',
};

const WORKLET = `
class GBOut extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 32768; this.buf = new Float32Array(this.size * 2);
    this.r = 0; this.n = 0; this.lastL = 0; this.lastR = 0; this.tick = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d === 'clear') { this.n = 0; return; }
      const count = d.length >> 1;
      for (let i = 0; i < count; i++) {
        if (this.n >= this.size) break;
        const w = ((this.r + this.n) % this.size) * 2;
        this.buf[w] = d[i * 2]; this.buf[w + 1] = d[i * 2 + 1];
        this.n++;
      }
    };
  }
  process(_in, outputs) {
    const out = outputs[0]; const L = out[0], R = out[1] || out[0];
    for (let i = 0; i < L.length; i++) {
      if (this.n > 0) {
        this.lastL = this.buf[this.r * 2]; this.lastR = this.buf[this.r * 2 + 1];
        this.r = (this.r + 1) % this.size; this.n--;
      } else { this.lastL *= 0.995; this.lastR *= 0.995; } // underrun: fade instead of clicking
      L[i] = this.lastL; R[i] = this.lastR;
    }
    if ((++this.tick & 7) === 0) this.port.postMessage(this.n);
    return true;
  }
}
registerProcessor('gb-out', GBOut);
`;

export class Player extends EventTarget {
  /**
   * @param {{canvas: HTMLCanvasElement, keyTarget?: EventTarget, keys?: object}} opts
   */
  constructor({ canvas, keyTarget = window, keys = DEFAULT_KEYS }) {
    super();
    this.canvas = canvas;
    canvas.width = WIDTH; canvas.height = HEIGHT;
    this.ctx2d = canvas.getContext('2d');
    this.image = this.ctx2d.createImageData(WIDTH, HEIGHT);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.gb = null;
    this.romKey = null;
    this.romName = '';
    this.running = false;
    this.paused = false;
    this.fastForward = false;
    this.rewinding = false;
    this.speed = 4;               // fast-forward multiplier
    this.volume = 0.8;
    this.muted = false;
    this.palette = 'green';
    this.colorCorrect = true;
    this.lcdBlend = false;
    this.slot = 1;
    this.keys = keys;
    this.inputKeyboard = 0; this.inputTouch = 0; this.inputPad = 0; this.inputRemote = 0; this.applied = 0;
    this.inputEnabled = true;     // set false to make the local player a spectator
    this.rewindBuf = [];
    this.frameCount = 0;
    this.lastTime = 0; this.acc = 0;
    this.audio = null; this.node = null; this.gain = null; this.audioFill = 0;
    this.fps = 0; this.fpsFrames = 0; this.fpsTime = 0;
    this.saveTimer = null;
    this.onFrame = null;          // optional hook (frame index) for netplay/spectating
    this._loop = this._loop.bind(this);
    this._onKey = this._onKey.bind(this);
    this._onVis = () => { if (document.hidden) this.flushSave(); };
    keyTarget.addEventListener('keydown', this._onKey);
    keyTarget.addEventListener('keyup', this._onKey);
    this.keyTarget = keyTarget;
    document.addEventListener('visibilitychange', this._onVis);
    window.addEventListener('pagehide', this._onVis);
    this.clearScreen();
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  toast(msg) { this.emit('toast', msg); }

  // ---------------- ROM lifecycle ----------------

  async loadRom(bytes, name = 'game') {
    await this.flushSave();
    const rom = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let gb;
    try {
      gb = new GameBoy(rom, { sampleRate: this.audio ? this.audio.sampleRate : 48000 });
    } catch (e) {
      this.toast(`Can't load ROM: ${e.message}`);
      throw e;
    }
    this.gb = gb;
    this.romName = name;
    this.romKey = await store.romKey(rom);
    this.applyVideoSettings();
    this.rewindBuf = [];
    this.frameCount = 0;
    this.applied = 0;
    if (gb.cart.hasBattery()) {
      const save = await store.get(`sram:${this.romKey}`);
      if (save) { gb.cart.importSave(save); this.toast('Save data loaded'); }
    }
    clearInterval(this.saveTimer);
    this.saveTimer = setInterval(() => this.flushSave(), 2000);
    this.paused = false;
    this.emit('romloaded', { title: gb.cart.header.title || name, cgb: gb.cgb, header: gb.cart.header });
    this.start();
    return gb;
  }

  reset() {
    if (!this.gb) return;
    const save = this.gb.cart.hasBattery() ? this.gb.cart.exportSave() : null;
    const rom = this.gb.cart.rom;
    this.gb = new GameBoy(rom.slice(), { sampleRate: this.audio ? this.audio.sampleRate : 48000 });
    if (save) this.gb.cart.importSave(save);
    this.applyVideoSettings();
    this.rewindBuf = [];
    this.toast('Reset');
  }

  async flushSave() {
    const gb = this.gb;
    if (!gb || !gb.cart.hasBattery() || !gb.cart.ramDirty) return;
    gb.cart.ramDirty = false;
    await store.set(`sram:${this.romKey}`, gb.cart.exportSave());
  }

  exportBatterySave() { return this.gb && this.gb.cart.hasBattery() ? this.gb.cart.exportSave() : null; }
  async importBatterySave(bytes) {
    if (!this.gb) return;
    this.gb.cart.importSave(new Uint8Array(bytes));
    this.gb.cart.ramDirty = true;
    await this.flushSave();
    this.reset();
    this.toast('Save imported');
  }

  // ---------------- save states ----------------

  async saveState(slot = this.slot) {
    if (!this.gb) return;
    const state = this.gb.saveState();
    const thumb = this.pixels.slice();
    await store.set(`state:${this.romKey}:${slot}`, { state, thumb, time: Date.now() });
    this.toast(`Saved state ${slot}`);
    this.emit('stateschanged');
  }

  async loadState(slot = this.slot) {
    if (!this.gb) return;
    const rec = await store.get(`state:${this.romKey}:${slot}`);
    if (!rec) { this.toast(`State ${slot} is empty`); return; }
    try { this.gb.loadState(rec.state); } catch (e) { this.toast(e.message); return; }
    this.rewindBuf = [];
    this.toast(`Loaded state ${slot}`);
  }

  async stateInfo(slot) {
    if (!this.romKey) return null;
    const rec = await store.get(`state:${this.romKey}:${slot}`);
    return rec ? { thumb: rec.thumb, time: rec.time } : null;
  }

  // ---------------- settings ----------------

  applyVideoSettings() {
    if (!this.gb) return;
    this.gb.ppu.shades = DMG_PALETTES[this.palette] || DMG_PALETTES.green;
    if (this.gb.ppu.colorCorrect !== this.colorCorrect) this.gb.ppu.setColorCorrection(this.colorCorrect);
  }
  setPalette(name) { this.palette = name; this.applyVideoSettings(); if (this.paused) this.draw(); }
  setColorCorrection(on) { this.colorCorrect = on; this.applyVideoSettings(); }
  setVolume(v) { this.volume = v; this.updateGain(); }
  setMuted(m) { this.muted = m; this.updateGain(); }
  updateGain() { if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume * this.volume; }

  // ---------------- audio ----------------

  /** Must be called from a user gesture at least once (autoplay policy). */
  async initAudio() {
    if (this.audio) { if (this.audio.state !== 'running') await this.audio.resume(); return; }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(ctx, 'gb-out', { outputChannelCount: [2] });
      const gain = ctx.createGain();
      node.connect(gain).connect(ctx.destination);
      node.port.onmessage = (e) => { this.audioFill = e.data; };
      this.audio = ctx; this.node = node; this.gain = gain;
      this.updateGain();
      if (this.gb) this.gb.apu.setSampleRate(ctx.sampleRate);
      if (ctx.state !== 'running') await ctx.resume();
    } catch (e) {
      console.warn('Audio unavailable', e);
    }
  }

  pushAudio() {
    const gb = this.gb;
    const samples = gb.apu.takeSamples();
    if (!this.node || this.audio.state !== 'running' || this.fastForward || this.rewinding || this.paused) return;
    const rate = this.audio.sampleRate;
    const target = rate * 0.06; // aim for ~60 ms buffered
    this.audioFill += samples.length >> 1;
    if (this.audioFill > rate * 0.25) { this.node.port.postMessage('clear'); this.audioFill = 0; }
    // Dynamic rate control: nudge the resampler so the buffer hovers around the target.
    const err = Math.max(-1, Math.min(1, (this.audioFill - target) / target));
    gb.apu.setSampleRate(rate * (1 - 0.006 * err));
    this.node.port.postMessage(samples, [samples.buffer]);
  }

  // ---------------- main loop ----------------

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.acc = 0;
    requestAnimationFrame(this._loop);
  }

  stop() { this.running = false; }

  setPaused(p) {
    if (!this.gb) return;
    this.paused = p;
    if (p) this.flushSave();
    if (this.node) this.node.port.postMessage('clear');
    this.emit('pausechange', p);
  }
  togglePause() { this.setPaused(!this.paused); }

  _loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    const dt = Math.min(now - this.lastTime, 100);
    this.lastTime = now;
    this.pollGamepads();
    if (!this.gb || this.paused) return;

    if (this.rewinding) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= FRAME_MS * 1.5 && steps < 2) { // rewind at ~2/3 speed x REWIND_EVERY
        this.acc -= FRAME_MS * 1.5; steps++;
        const snap = this.rewindBuf.pop();
        if (snap) { this.gb.loadState(snap); this.gb.runFrame(); this.gb.apu.takeSamples(); }
      }
      this.draw();
      return;
    }

    this.acc += dt * (this.fastForward ? this.speed : 1);
    let frames = 0;
    const maxFrames = this.fastForward ? this.speed + 1 : 3;
    while (this.acc >= FRAME_MS && frames < maxFrames) {
      this.acc -= FRAME_MS;
      this.stepFrame();
      frames++;
    }
    if (this.acc > FRAME_MS * 4) this.acc = 0; // fell far behind (tab was hidden): don't spiral
    if (frames) {
      this.pushAudio();
      this.draw();
      this.fpsFrames += frames;
      if (now - this.fpsTime > 1000) {
        this.fps = Math.round(this.fpsFrames * 1000 / (now - this.fpsTime));
        this.fpsFrames = 0; this.fpsTime = now;
        this.emit('fps', this.fps);
      }
    }
  }

  stepFrame() {
    const gb = this.gb;
    this.applyInput();
    if (this.onFrame) this.onFrame(this.frameCount);
    gb.runFrame();
    this.frameCount++;
    if (this.frameCount % REWIND_EVERY === 0) {
      this.rewindBuf.push(gb.saveState());
      if (this.rewindBuf.length > REWIND_MAX) this.rewindBuf.shift();
    }
    if (gb.cart.rumble && navigator.vibrate) navigator.vibrate(20);
  }

  setRewinding(on) {
    if (on && !this.rewindBuf.length) return;
    this.rewinding = on;
    if (this.node) this.node.port.postMessage('clear');
  }

  draw() {
    const src = this.gb.ppu.frame;
    const px = this.pixels;
    if (this.lcdBlend) {
      for (let i = 0; i < px.length; i++) {
        const a = px[i], b = src[i];
        // average each channel of two ABGR pixels
        px[i] = (((a & 0xfefefefe) >>> 1) + ((b & 0xfefefefe) >>> 1)) | 0xff000000;
      }
    } else px.set(src);
    this.ctx2d.putImageData(this.image, 0, 0);
  }

  clearScreen() {
    this.pixels.fill(0xff1a1a1a);
    this.ctx2d.putImageData(this.image, 0, 0);
  }

  screenshot() {
    const c = document.createElement('canvas');
    c.width = WIDTH * 4; c.height = HEIGHT * 4;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    x.drawImage(this.canvas, 0, 0, c.width, c.height);
    const a = document.createElement('a');
    a.download = `${(this.romName || 'gameboy').replace(/\.[^.]+$/, '')}-${Date.now()}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
  }

  // ---------------- input ----------------

  _onKey(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const down = e.type === 'keydown';
    const btn = this.keys[e.code];
    if (btn) {
      const bit = 1 << BUTTONS.indexOf(btn);
      if (down) this.inputKeyboard |= bit; else this.inputKeyboard &= ~bit;
      e.preventDefault();
      return;
    }
    switch (e.code) {
      case 'Space': case 'Tab': this.fastForward = down; e.preventDefault(); break;
      case 'KeyR': if (!e.ctrlKey && !e.metaKey) { this.setRewinding(down); e.preventDefault(); } break;
      case 'KeyP': case 'Escape': if (down && !e.repeat) this.togglePause(); break;
      case 'F5': if (down) { this.saveState(); e.preventDefault(); } break;
      case 'F8': if (down) { this.loadState(); e.preventDefault(); } break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
        if (down) { this.slot = +e.code.slice(5); this.emit('slotchange', this.slot); this.toast(`Slot ${this.slot}`); }
        break;
    }
  }

  /** For on-screen/touch controls. */
  setTouchButton(name, down) {
    const bit = 1 << BUTTONS.indexOf(name);
    if (down) this.inputTouch |= bit; else this.inputTouch &= ~bit;
  }

  /** Overrides input with a remote bitmask (netplay / "pass the controller"). */
  setRemoteInput(mask) { this.inputRemote = mask; }

  localInputMask() { return this.inputKeyboard | this.inputTouch | this.inputPad; }

  pollGamepads() {
    if (!navigator.getGamepads) return;
    let mask = 0, ff = false, rw = false;
    for (const pad of navigator.getGamepads()) {
      if (!pad) continue;
      const b = i => pad.buttons[i] && pad.buttons[i].pressed;
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      if (b(0) || b(3)) mask |= 1 << 4;              // A
      if (b(1) || b(2)) mask |= 1 << 5;              // B
      if (b(8)) mask |= 1 << 6;                      // select
      if (b(9)) mask |= 1 << 7;                      // start
      if (b(15) || ax > 0.5) mask |= 1;              // right
      if (b(14) || ax < -0.5) mask |= 2;             // left
      if (b(12) || ay < -0.5) mask |= 4;             // up
      if (b(13) || ay > 0.5) mask |= 8;              // down
      if (b(7) || b(5)) ff = true;
      if (b(6) || b(4)) rw = true;
    }
    this.inputPad = mask;
    if (ff !== this.padFF) { this.padFF = ff; this.fastForward = ff; }
    if (rw !== this.padRW) { this.padRW = rw; this.setRewinding(rw); }
  }

  applyInput() {
    const mask = this.inputEnabled ? (this.localInputMask() | this.inputRemote) : this.inputRemote;
    if (mask === this.applied) return;
    const changed = mask ^ this.applied;
    for (let i = 0; i < 8; i++) if (changed & (1 << i)) this.gb.setButton(BUTTONS[i], (mask >> i) & 1);
    this.applied = mask;
  }

  destroy() {
    this.flushSave();
    this.running = false;
    clearInterval(this.saveTimer);
    this.keyTarget.removeEventListener('keydown', this._onKey);
    this.keyTarget.removeEventListener('keyup', this._onKey);
    document.removeEventListener('visibilitychange', this._onVis);
    window.removeEventListener('pagehide', this._onVis);
    if (this.audio) this.audio.close();
  }
}
