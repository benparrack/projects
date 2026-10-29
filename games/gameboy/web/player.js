// UI-agnostic emulator host: drives a GameBoy at real-time speed and wires it to a canvas,
// Web Audio, keyboard/gamepad/touch input and IndexedDB persistence (battery saves, save states).
// Used by the standalone page (web/ui.js) and by game_terminal's Game Boy room.

import { GameBoy, BUTTONS } from '../src/gameboy.js';
import { Link } from '../src/link.js';
import { DMG_PALETTES, WIDTH, HEIGHT } from '../src/ppu.js';
import * as store from './storage.js';

const FRAME_MS = 1000 / (4194304 / 70224); // ~16.74ms (59.73 Hz)
const REWIND_EVERY = 3;       // snapshot every N frames
const REWIND_MAX = 360;       // ~18 s of rewind
const HASH_EVERY = 120;       // link netplay: compare state fingerprints this often (frames)

/** Link netplay input delay (frames) for a measured round-trip time: one-way latency plus margin. */
export function linkDelayFor(rttMs) {
  return Math.min(15, Math.max(3, Math.ceil(rttMs / 2 / FRAME_MS) + 2));
}

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
    this.onInput = null;          // (frame, mask) whenever the applied input changes — for streaming to spectators
    this.remote = null;           // spectator mode: { upTo, inputs: Map<frame, mask> } fed by pushRemote()
    this.link = null;             // link-cable netplay session, see startLink()
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
    this.stopLink();
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
    if (!this.gb || this.link) return;
    const save = this.gb.cart.hasBattery() ? this.gb.cart.exportSave() : null;
    const rom = this.gb.cart.rom;
    this.gb = new GameBoy(rom.slice(), { sampleRate: this.audio ? this.audio.sampleRate : 48000 });
    if (save) this.gb.cart.importSave(save);
    this.applyVideoSettings();
    this.rewindBuf = [];
    this.frameCount = 0;
    this.applied = 0;
    this.toast('Reset');
    this.emit('discontinuity');
  }

  async flushSave() {
    const gb = this.gb;
    if (this.remote || this.link) return; // spectated/linked sessions start fresh and aren't saved
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
    if (!this.gb || this.link) return;
    const state = this.gb.saveState();
    const thumb = this.pixels.slice();
    await store.set(`state:${this.romKey}:${slot}`, { state, thumb, time: Date.now() });
    this.toast(`Saved state ${slot}`);
    this.emit('stateschanged');
  }

  async loadState(slot = this.slot) {
    if (!this.gb || this.link) return;
    const rec = await store.get(`state:${this.romKey}:${slot}`);
    if (!rec) { this.toast(`State ${slot} is empty`); return; }
    try { this.gb.loadState(rec.state); } catch (e) { this.toast(e.message); return; }
    this.rewindBuf = [];
    this.toast(`Loaded state ${slot}`);
    this.emit('discontinuity');
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
    if (!this.gb || this.link) return;
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

    if (this.link) { this._linkLoop(dt); return; }
    if (this.remote) { this._remoteLoop(dt, now); return; }

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
    gb.runFrame();
    this.frameCount++;
    if (!this.remote && this.frameCount % REWIND_EVERY === 0) {
      this.rewindBuf.push(gb.saveState());
      if (this.rewindBuf.length > REWIND_MAX) this.rewindBuf.shift();
    }
    if (gb.cart.rumble && navigator.vibrate) navigator.vibrate(20);
  }

  setRewinding(on) {
    if (this.remote || (on && !this.rewindBuf.length)) return;
    const was = this.rewinding;
    this.rewinding = on;
    if (was && !on) this.emit('discontinuity');
    if (this.node) this.node.port.postMessage('clear');
  }

  draw() {
    const src = this.link ? this.link.core.shown[this.link.side] : this.gb.ppu.frame;
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
    if (this.remote || !this.gb) return;
    const down = e.type === 'keydown';
    const btn = this.keys[e.code];
    if (btn) {
      const bit = 1 << BUTTONS.indexOf(btn);
      if (down) this.inputKeyboard |= bit; else this.inputKeyboard &= ~bit;
      e.preventDefault();
      return;
    }
    if (this.link) return; // no pausing, rewinding or save states while linked
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

  pollGamepadsFF(ff, rw) {
    if (this.link) return;
    if (ff !== this.padFF) { this.padFF = ff; this.fastForward = ff; }
    if (rw !== this.padRW) { this.padRW = rw; this.setRewinding(rw); }
  }

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
    this.pollGamepadsFF(ff, rw);
  }

  applyInput() {
    let mask;
    if (this.remote) {
      const m = this.remote.inputs.get(this.frameCount);
      if (m === undefined) return;
      this.remote.inputs.delete(this.frameCount);
      mask = m;
    } else mask = this.inputEnabled ? (this.localInputMask() | this.inputRemote) : this.inputRemote;
    if (mask === this.applied) return;
    this.setMask(mask);
    if (this.onInput && !this.remote) this.onInput(this.frameCount, mask);
  }

  setMask(mask) {
    const changed = mask ^ this.applied;
    for (let i = 0; i < 8; i++) if (changed & (1 << i)) this.gb.setButton(BUTTONS[i], (mask >> i) & 1);
    this.applied = mask;
  }

  // ---------------- spectating (lockstep replay of someone else's inputs) ----------------

  /** Snapshot for a spectator: state + the frame it's at + currently held buttons. */
  keyframe() {
    return { state: this.gb.saveState(), frame: this.frameCount, mask: this.applied };
  }

  /** Enter spectator mode on the already-loaded ROM, starting from a keyframe. */
  startRemote({ state, frame, mask }) {
    this.link = null;
    this.gb.loadState(state);
    this.remote = { upTo: frame, inputs: new Map() };
    this.frameCount = frame;
    this.applied = 0;
    this.setMask(mask);
    this.rewindBuf = [];
    this.paused = false;
    this.acc = 0;
  }

  /** Feed more of the streamer's input log; the spectator may simulate up to (not including) `upTo`. */
  pushRemote(inputs, upTo) {
    if (!this.remote) return;
    for (const [f, m] of inputs) if (f >= this.frameCount) this.remote.inputs.set(f, m);
    this.remote.upTo = Math.max(this.remote.upTo, upTo);
  }

  stopRemote() { this.remote = null; }

  _remoteLoop(dt, now) {
    // Hold ~6 frames of buffer to absorb network jitter; speed up when further behind.
    const backlog = this.remote.upTo - this.frameCount;
    if (backlog <= 0) { this.acc = 0; return; }
    this.acc += dt * (backlog > 30 ? 4 : backlog > 12 ? 1.25 : 1);
    let frames = 0;
    while (this.acc >= FRAME_MS && this.frameCount < this.remote.upTo && frames < 5) {
      this.acc -= FRAME_MS;
      this.stepFrame();
      frames++;
    }
    if (backlog > 600) { // hopelessly behind (tab was hidden): jump by simulating without drawing
      while (this.frameCount < this.remote.upTo - 6) this.stepFrame();
    }
    if (frames) { this.pushAudio(); this.draw(); }
  }

  // ---------------- link-cable netplay ----------------
  //
  // Both peers emulate *both* consoles (src/link.js) from a fresh power-on, and exchange only
  // their button masks. Input sampled while stepping frame f is applied at frame f + delay, which
  // gives the peer `delay` frames to receive it; a peer that hasn't heard about frame f yet waits.
  // Messages (sent with `send`, delivered with linkReceive):
  //   { t: 'in', c: [[frame, mask], ...], upTo }  input changes; the sender's input is final below upTo
  //   { t: 'hash', f, h }                          state fingerprint after frame f, for desync detection

  /** Starts a link session on `rom`. side 0 = player 1 (drives the link clock in most games). */
  startLink(rom, { side, delay = 4, send, name = 'game' }) {
    this.stopRemote();
    this.flushSave();
    clearInterval(this.saveTimer);
    const rate = this.audio ? this.audio.sampleRate : 48000;
    const gbs = [new GameBoy(rom.slice(), { sampleRate: rate }), new GameBoy(rom.slice(), { sampleRate: rate })];
    this.link = {
      core: new Link(gbs[0], gbs[1]), side, delay, send,
      mine: [], theirs: [],           // pending input changes [frame, mask], oldest first
      lastMine: 0, sentUpTo: delay, outbox: [], theirUpTo: delay,
      masks: [0, 0], hashes: new Map(), peerHashes: new Map(), waiting: 0, stuck: false,
    };
    this.gb = gbs[side];
    this.romName = name;
    this.romKey = null;
    this.applyVideoSettings();
    this.rewindBuf = [];
    this.frameCount = 0;
    this.applied = 0;
    this.fastForward = false; this.rewinding = false;
    this.paused = false;
    this.emit('romloaded', { title: this.gb.cart.header.title || name, cgb: this.gb.cgb, header: this.gb.cart.header, link: true });
    this.start();
  }

  stopLink() {
    if (!this.link) return;
    this.link = null;
    this.gb = null;
    this.clearScreen();
    if (this.node) this.node.port.postMessage('clear');
  }

  linkReceive(msg) {
    const L = this.link;
    if (!L || !msg) return;
    if (msg.t === 'in' && Array.isArray(msg.c) && Number.isInteger(msg.upTo)) {
      for (const [f, m] of msg.c) if (Number.isInteger(f) && f >= this.frameCount) L.theirs.push([f, m & 0xff]);
      L.theirUpTo = Math.max(L.theirUpTo, msg.upTo);
    } else if (msg.t === 'hash' && Number.isInteger(msg.f)) {
      L.peerHashes.set(msg.f, msg.h);
      this._checkHash(msg.f);
    }
  }

  _checkHash(f) {
    const L = this.link;
    if (!L.hashes.has(f) || !L.peerHashes.has(f)) return;
    const ok = L.hashes.get(f) === L.peerHashes.get(f);
    L.hashes.delete(f); L.peerHashes.delete(f);
    if (!ok) this.emit('linkdesync', f);
  }

  _linkStep() {
    const L = this.link, f = this.frameCount;
    // This frame's local sample is scheduled `delay` frames ahead.
    const mask = this.inputEnabled ? this.localInputMask() : 0;
    if (mask !== L.lastMine) { L.lastMine = mask; L.mine.push([f + L.delay, mask]); L.outbox.push([f + L.delay, mask]); }
    L.sentUpTo = f + L.delay + 1;
    const next = (q, cur) => { while (q.length && q[0][0] <= f) cur = q.shift()[1]; return cur; };
    const me = next(L.mine, L.masks[L.side]);
    const peer = next(L.theirs, L.masks[1 - L.side]);
    const masks = [0, 0];
    masks[L.side] = me; masks[1 - L.side] = peer;
    L.core.gbs.forEach((gb, i) => {
      const changed = masks[i] ^ L.masks[i];
      for (let b = 0; b < 8; b++) if (changed & (1 << b)) gb.setButton(BUTTONS[b], (masks[i] >> b) & 1);
    });
    L.masks = masks;
    L.core.runFrame();
    L.core.gbs[1 - L.side].apu.takeSamples(); // only this side's console is heard
    this.frameCount++;
    if (this.frameCount % HASH_EVERY === 0) {
      const h = L.core.hash();
      L.hashes.set(this.frameCount, h);
      L.send({ t: 'hash', f: this.frameCount, h });
      this._checkHash(this.frameCount);
    }
  }

  _linkLoop(dt) {
    const L = this.link;
    // Run slightly fast when the peer is ahead of us so the two stay in step.
    const slack = L.theirUpTo - this.frameCount;
    this.acc += dt * (slack > L.delay + 3 ? 1.08 : 1);
    let frames = 0;
    while (this.acc >= FRAME_MS && frames < 4) {
      if (this.frameCount >= L.theirUpTo) { this.acc = Math.min(this.acc, FRAME_MS); break; }
      this.acc -= FRAME_MS;
      this._linkStep();
      frames++;
    }
    if (this.acc > FRAME_MS * 8) this.acc = FRAME_MS * 8;
    L.waiting = this.frameCount >= L.theirUpTo ? L.waiting + 1 : 0;
    const stuck = L.waiting >= 30; // half a second without the peer's input
    if (stuck !== L.stuck) { L.stuck = stuck; this.emit('linkwait', stuck); }
    if (frames) {
      L.send({ t: 'in', c: L.outbox, upTo: L.sentUpTo });
      L.outbox = [];
      this.pushAudio();
      this.draw();
    }
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
