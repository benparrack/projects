// Synthesised sound effects (WebAudio, no assets). Silently does nothing until the
// first user gesture unlocks the audio context.
let ctx = null, master = null;
let lastSus = 0;
let muted = false;
try { muted = localStorage.getItem('loopheist.muted') === '1'; } catch { /* ignore */ }

function ac() {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  } catch { ctx = null; }
  return ctx;
}
addEventListener('keydown', () => { ac(); if (ctx?.state === 'suspended') ctx.resume(); });
addEventListener('pointerdown', () => { ac(); if (ctx?.state === 'suspended') ctx.resume(); });

function tone({ f = 440, f2 = null, type = 'sine', dur = 0.12, vol = 0.2, at = 0, attack = 0.005 }) {
  const c = ac();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.2, vol = 0.15, at = 0, hp = 800 }) {
  const c = ac();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime + at;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = hp;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

export const audio = {
  get muted() { return muted; },
  toggleMute() {
    muted = !muted;
    try { localStorage.setItem('loopheist.muted', muted ? '1' : '0'); } catch { /* ignore */ }
    if (master) master.gain.value = muted ? 0 : 0.5;
    return muted;
  },
  click() { tone({ f: 660, dur: 0.05, vol: 0.08, type: 'triangle' }); },
  tick() { tone({ f: 1400, f2: 900, dur: 0.03, vol: 0.04, type: 'square' }); },
  start() { tone({ f: 220, f2: 440, dur: 0.25, vol: 0.12, type: 'sawtooth' }); tone({ f: 330, f2: 660, dur: 0.25, vol: 0.08, at: 0.05 }); },
  whistle() { tone({ f: 1800, f2: 2400, dur: 0.18, vol: 0.12 }); tone({ f: 2400, f2: 1600, dur: 0.22, vol: 0.1, at: 0.2 }); },
  interact(k) {
    if (k === 'open' || k === 'close') noise({ dur: 0.08, vol: 0.12, hp: 1500 });
    else if (k === 'locked') tone({ f: 180, dur: 0.12, vol: 0.12, type: 'square' });
    else if (k === 'key' || k === 'loot') { tone({ f: 880, dur: 0.08, vol: 0.1 }); tone({ f: 1320, dur: 0.12, vol: 0.1, at: 0.07 }); }
    else if (k.startsWith('done:')) { tone({ f: 523, dur: 0.1, vol: 0.1, type: 'triangle' }); tone({ f: 784, dur: 0.16, vol: 0.1, type: 'triangle', at: 0.09 }); }
    else if (k === 'gate-open') { tone({ f: 110, f2: 220, dur: 0.25, vol: 0.12, type: 'sawtooth' }); noise({ dur: 0.2, vol: 0.06, hp: 3000 }); }
    else if (k === 'gate-close') { tone({ f: 220, f2: 70, dur: 0.18, vol: 0.16, type: 'sawtooth' }); noise({ dur: 0.1, vol: 0.2, hp: 400 }); }
    else if (k === 'takedown') { noise({ dur: 0.15, vol: 0.25, hp: 200 }); tone({ f: 90, f2: 50, dur: 0.2, vol: 0.25 }); }
  },
  suspicion(level) {
    const now = performance.now();
    if (now - lastSus < 260) return;
    lastSus = now;
    tone({ f: 300 + level * 25, dur: 0.06, vol: 0.06, type: 'square' });
  },
  paradox() {
    for (let i = 0; i < 6; i++) tone({ f: 900 - i * 110, f2: 200 + i * 150, dur: 0.12, vol: 0.08, type: 'sawtooth', at: i * 0.05 });
    noise({ dur: 0.4, vol: 0.06, hp: 3000 });
  },
  alarm() {
    for (let i = 0; i < 4; i++) { tone({ f: 880, dur: 0.18, vol: 0.14, type: 'square', at: i * 0.36 }); tone({ f: 660, dur: 0.18, vol: 0.14, type: 'square', at: i * 0.36 + 0.18 }); }
  },
  escape() { tone({ f: 392, dur: 0.1, vol: 0.1, type: 'triangle' }); tone({ f: 523, dur: 0.1, vol: 0.1, type: 'triangle', at: 0.08 }); tone({ f: 659, dur: 0.18, vol: 0.1, type: 'triangle', at: 0.16 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone({ f, dur: 0.3, vol: 0.12, type: 'triangle', at: i * 0.11 })); },
};
