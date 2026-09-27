// Shared synthesized sound effects (Web Audio, no asset files).
// Usage: import { sfx } from '../sfx.js'; sfx.play('move');
// Mute state persists in localStorage and is toggled from the hub titlebar.

const MUTE_KEY = 'gt.muted';
let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* storage blocked */ }
const listeners = new Set();

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Browsers only allow audio after a user gesture; unlock on the first one.
for (const ev of ['pointerdown', 'keydown']) {
  window.addEventListener(ev, () => audio(), { once: true, capture: true });
}

function tone(freq, dur, { type = 'square', vol = 0.3, at = 0, slide = 0 } = {}) {
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

let noiseBuf = null;
function noise(dur, { vol = 0.3, at = 0, filter = 2000, q = 1 } = {}) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = filter;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

const SOUNDS = {
  click:   () => tone(880, 0.04, { vol: 0.12 }),
  select:  () => tone(660, 0.06, { type: 'triangle', vol: 0.25 }),
  move:    () => { noise(0.06, { filter: 900, vol: 0.5 }); tone(180, 0.08, { type: 'sine', vol: 0.3 }); },
  capture: () => { noise(0.12, { filter: 1600, vol: 0.6 }); tone(320, 0.12, { type: 'triangle', slide: -200, vol: 0.3 }); },
  card:    () => noise(0.07, { filter: 3500, q: 0.7, vol: 0.45 }),
  deal:    () => { for (let i = 0; i < 4; i++) noise(0.05, { filter: 3500, q: 0.7, vol: 0.35, at: i * 0.07 }); },
  chips:   () => { for (let i = 0; i < 3; i++) tone(2400 + i * 300, 0.03, { type: 'triangle', vol: 0.15, at: i * 0.04 }); },
  dice:    () => { for (let i = 0; i < 5; i++) noise(0.03, { filter: 2500, vol: 0.4, at: i * 0.045 + Math.random() * 0.02 }); },
  turn:    () => { tone(660, 0.1, { type: 'triangle', vol: 0.25 }); tone(990, 0.16, { type: 'triangle', vol: 0.25, at: 0.1 }); },
  check:   () => { tone(880, 0.08, { vol: 0.2 }); tone(880, 0.08, { vol: 0.2, at: 0.12 }); },
  beep:    () => tone(440, 0.12, { vol: 0.2 }),
  go:      () => tone(880, 0.25, { vol: 0.25 }),
  eat:     () => tone(500, 0.07, { type: 'triangle', slide: 500, vol: 0.2 }),
  crash:   () => { noise(0.4, { filter: 500, q: 0.5, vol: 0.8 }); tone(150, 0.35, { type: 'sawtooth', slide: -110, vol: 0.25 }); },
  point:   () => { tone(784, 0.08, { type: 'triangle', vol: 0.25 }); tone(1175, 0.14, { type: 'triangle', vol: 0.25, at: 0.08 }); },
  error:   () => tone(140, 0.18, { type: 'sawtooth', vol: 0.2 }),
  win:     () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.3, at: i * 0.11 })),
  lose:    () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.25, at: i * 0.14 })),
};

// Throttle identical sounds fired in the same burst (e.g. several events per frame).
const lastPlayed = {};

export const sfx = {
  play(name) {
    if (muted || !SOUNDS[name]) return;
    const now = performance.now();
    if (now - (lastPlayed[name] || 0) < 40) return;
    lastPlayed[name] = now;
    if (!audio() || ctx.state !== 'running') return;
    try { SOUNDS[name](); } catch { /* ignore audio errors */ }
  },
  get muted() { return muted; },
  setMuted(m) {
    muted = !!m;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
    listeners.forEach((fn) => fn(muted));
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

// Standard sounds for two-player board games whose state has {board?, turn, winner, phase}.
// `seat` is this viewer's seat (null for spectators). Call with the previous and new view.
export function boardSounds(prev, next, seat, { inCheck = false } = {}) {
  if (!prev || !next) return;
  if (next.winner && !prev.winner) {
    if (next.winner === 'draw' || !seat) sfx.play('point');
    else sfx.play(next.winner === seat ? 'win' : 'lose');
    return;
  }
  const count = (b) => (Array.isArray(b) ? b.flat().filter(Boolean).length : 0);
  const moved = prev.turn !== next.turn || JSON.stringify(prev.board) !== JSON.stringify(next.board);
  if (!moved) return;
  if (next.board && count(next.board) < count(prev.board)) sfx.play('capture');
  else sfx.play('move');
  if (inCheck) setTimeout(() => sfx.play('check'), 120);
}

// Card-table sounds. `pick(view)` returns {played, hand, myTurn, result}: `played` is any value that
// changes whenever a card hits the table, `hand` is this viewer's hand size, `result` is
// 'win' | 'lose' | 'point' (spectator/draw) once the game is decided, else null.
export function tableSounds(prev, next, pick) {
  if (!prev || !next) return;
  const a = pick(prev);
  const b = pick(next);
  if (b.result && !a.result) { sfx.play(b.result); return; }
  if (b.hand > a.hand + 1) sfx.play('deal');
  else if (b.played !== a.played) sfx.play('card');
  if (b.myTurn && !a.myTurn) setTimeout(() => sfx.play('turn'), 150);
}

export function seatResult(winner, me) {
  if (winner == null || winner === -1) return null;
  if (me == null || me < 0) return 'point';
  return winner === me ? 'win' : 'lose';
}
