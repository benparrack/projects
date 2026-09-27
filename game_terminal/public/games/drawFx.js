// Shared juice for the drawing games (Pictionary, Gartic Phone): a draining round timer bar,
// floating "+points" text, confetti bursts, a letter-by-letter word reveal, slide-in/bump
// helpers, and a throttled pencil-scribble sound while drawing. CSS is injected once.

import { sfx } from './sfx.js';

const CSS = `
.dfx-timer { width: 100%; height: 8px; background: #1a1e24; border: 1px solid #333; border-radius: 4px; overflow: hidden; }
.dfx-timer > div { height: 100%; background: linear-gradient(90deg, #39ff14, #00e5ff); transition: width 0.5s linear, background 0.3s; }
.dfx-timer.warn > div { background: #ffb000; }
.dfx-timer.danger { animation: dfx-pulse 0.5s ease-in-out infinite alternate; }
.dfx-timer.danger > div { background: #ff4d4d; }
.dfx-stage { position: relative; }
.dfx-float { position: absolute; left: 50%; top: 45%; pointer-events: none; font-weight: bold; font-size: 30px; color: #39ff14; text-shadow: 0 0 12px rgba(57,255,20,.8), 0 0 3px #000; transform: translateX(-50%); animation: dfx-float 1.3s ease-out forwards; white-space: nowrap; z-index: 5; }
.dfx-float.small { font-size: 18px; color: #00e5ff; text-shadow: 0 0 10px rgba(0,229,255,.8), 0 0 3px #000; }
.dfx-bit { position: absolute; width: 8px; height: 8px; pointer-events: none; z-index: 5; animation: dfx-bit 1s cubic-bezier(.15,.6,.4,1) forwards; }
.dfx-reveal { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: rgba(0,0,0,.72); pointer-events: none; z-index: 4; animation: dfx-fade 0.3s ease-out; }
.dfx-reveal .lbl { font-size: 14px; opacity: .8; letter-spacing: 2px; }
.dfx-reveal .word { display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; }
.dfx-reveal .word span { display: inline-block; min-width: 22px; padding: 4px 6px; font-size: 32px; font-weight: bold; color: #ffe066; border: 1px solid #ffe066; border-radius: 4px; text-shadow: 0 0 10px rgba(255,224,102,.7); animation: dfx-flip 0.45s cubic-bezier(.2,1.5,.4,1) both; }
.dfx-reveal .word span.gap { border-color: transparent; }
.dfx-slide { animation: dfx-slide 0.3s ease-out; }
.dfx-bump { animation: dfx-bump 0.35s cubic-bezier(.2,1.6,.4,1); }
.dfx-pop { animation: dfx-pop 0.4s cubic-bezier(.2,1.6,.4,1) both; }
.dfx-flash { animation: dfx-flash 0.6s ease-out; }
.dfx-stamp { display: inline-block; padding: 6px 14px; border: 2px solid #39ff14; color: #39ff14; font-weight: bold; letter-spacing: 3px; transform: rotate(-4deg); animation: dfx-stamp 0.4s cubic-bezier(.2,1.6,.4,1) both; }
@keyframes dfx-pulse { from { box-shadow: 0 0 0 rgba(255,77,77,0); } to { box-shadow: 0 0 10px rgba(255,77,77,.9); } }
@keyframes dfx-float { 0% { opacity: 0; transform: translate(-50%, 10px) scale(.6); } 15% { opacity: 1; transform: translate(-50%, 0) scale(1.15); } 100% { opacity: 0; transform: translate(-50%, -70px) scale(1); } }
@keyframes dfx-bit { from { transform: translate(0,0) rotate(0); opacity: 1; } to { transform: translate(var(--x), var(--y)) rotate(var(--r)); opacity: 0; } }
@keyframes dfx-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes dfx-flip { from { transform: rotateX(90deg) scale(.6); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes dfx-slide { from { transform: translateX(-14px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes dfx-bump { 0% { transform: scale(1.35); } 100% { transform: scale(1); } }
@keyframes dfx-pop { from { transform: scale(.4) translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes dfx-flash { 0% { box-shadow: 0 0 0 3px #39ff14, 0 0 30px rgba(57,255,20,.8); } 100% { box-shadow: 0 0 0 0 transparent; } }
@keyframes dfx-stamp { from { transform: rotate(-4deg) scale(2.4); opacity: 0; } to { transform: rotate(-4deg) scale(1); opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .dfx-float, .dfx-bit, .dfx-reveal, .dfx-reveal .word span, .dfx-slide, .dfx-bump, .dfx-pop, .dfx-flash, .dfx-stamp, .dfx-timer.danger { animation: none; }
  .dfx-bit { display: none; }
}`;

let injected = false;
function injectCss() {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}
injectCss();

// Restart a one-shot animation class on an element.
export function replay(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

export function timerBar() {
  const el = document.createElement('div');
  el.className = 'dfx-timer';
  const fill = document.createElement('div');
  el.appendChild(fill);
  let lastSecs = null;
  return {
    el,
    // frac: 0..1 of time remaining. Ticks the last 10 seconds (louder in the last 5).
    update(frac, secsLeft) {
      fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
      el.classList.toggle('warn', secsLeft <= 20 && secsLeft > 10);
      el.classList.toggle('danger', secsLeft <= 10);
      if (lastSecs !== null && secsLeft !== lastSecs && secsLeft > 0 && secsLeft <= 10) sfx.play(secsLeft <= 5 ? 'beep' : 'tick');
      lastSecs = secsLeft;
    },
    reset() { lastSecs = null; },
  };
}

export function floatText(stage, text, small = false) {
  const el = document.createElement('div');
  el.className = `dfx-float${small ? ' small' : ''}`;
  el.textContent = text;
  stage.appendChild(el);
  setTimeout(() => el.remove(), 1350);
}

const BIT_COLORS = ['#39ff14', '#ffb000', '#00e5ff', '#ff4dd2', '#ffe066'];
export function burst(stage, count = 28) {
  const w = stage.clientWidth || 300, h = stage.clientHeight || 200;
  for (let i = 0; i < count; i++) {
    const b = document.createElement('div');
    b.className = 'dfx-bit';
    b.style.left = `${w / 2}px`;
    b.style.top = `${h * 0.45}px`;
    b.style.background = BIT_COLORS[i % BIT_COLORS.length];
    const ang = Math.random() * Math.PI * 2, dist = 60 + Math.random() * Math.min(w, h) * 0.5;
    b.style.setProperty('--x', `${Math.cos(ang) * dist}px`);
    b.style.setProperty('--y', `${Math.sin(ang) * dist + 40}px`);
    b.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
    b.style.animationDelay = `${Math.random() * 0.08}s`;
    if (Math.random() < 0.5) b.style.borderRadius = '50%';
    stage.appendChild(b);
    setTimeout(() => b.remove(), 1200);
  }
}

// Letter-by-letter reveal overlay; returns the element (remove it when the round moves on).
export function revealWord(stage, word, label = 'THE WORD WAS') {
  const el = document.createElement('div');
  el.className = 'dfx-reveal';
  const lbl = document.createElement('div');
  lbl.className = 'lbl';
  lbl.textContent = label;
  const letters = document.createElement('div');
  letters.className = 'word';
  [...String(word).toUpperCase()].forEach((ch, i) => {
    const s = document.createElement('span');
    s.textContent = ch === ' ' ? ' ' : ch;
    if (ch === ' ') s.className = 'gap';
    s.style.animationDelay = `${0.15 + i * 0.07}s`;
    letters.appendChild(s);
    if (ch !== ' ') setTimeout(() => sfx.play('blip'), 150 + i * 70);
  });
  el.appendChild(lbl);
  el.appendChild(letters);
  stage.appendChild(el);
  return el;
}

// Call on every pointermove while drawing; plays a soft pencil scratch at most every ~90ms.
let lastScribble = 0;
export function scribble() {
  const now = performance.now();
  if (now - lastScribble < 90) return;
  lastScribble = now;
  sfx.play('scribble');
}
