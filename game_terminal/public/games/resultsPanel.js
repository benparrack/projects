// Shared end-of-game results panel: a modal card that pops in over the table with the outcome,
// a staggered standings list, confetti on a win and a pulsing REMATCH button. Clients rebuild
// their DOM every render, so this lives beside it: create once in mount(), call
// `results.update(opts | null)` from every render (null = not game over) and `destroy()` on unmount.
// It pops in once per game over; if dismissed, a small "RESULTS" pill brings it back.

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CSS = `
.gt-res-back {
  position: fixed; inset: 0; z-index: 900; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 50% 45%, rgba(0,40,0,.55), rgba(0,0,0,.82));
  animation: gt-res-fade .3s ease-out backwards; font-family: monospace;
}
.gt-res-back.out { animation: gt-res-fade .2s ease-in reverse forwards; }
@keyframes gt-res-fade { from { opacity: 0; } }
.gt-res-confetti { position: absolute; inset: 0; pointer-events: none; }
.gt-res-card {
  position: relative; min-width: 280px; max-width: min(420px, calc(100vw - 32px)); box-sizing: border-box;
  padding: 22px 22px 18px; border: 2px solid var(--gt-res-c); border-radius: 10px; text-align: center;
  background: linear-gradient(180deg, #0c160c, #050805); color: #d8ffd0;
  box-shadow: 0 0 0 1px rgba(0,0,0,.6), 0 0 32px -4px var(--gt-res-c), inset 0 0 40px -18px var(--gt-res-c);
  animation: gt-res-pop .5s cubic-bezier(.2,1.4,.4,1) .08s backwards;
}
.gt-res-card.lose { animation: gt-res-pop .5s cubic-bezier(.2,1.4,.4,1) .08s backwards, gt-res-shake .4s ease-in-out .55s; }
@keyframes gt-res-pop { from { opacity: 0; transform: scale(.6) translateY(30px); } }
@keyframes gt-res-shake {
  20% { transform: translateX(-7px); } 40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); } 80% { transform: translateX(2px); }
}
.gt-res-badge { font-size: 40px; line-height: 1; animation: gt-res-badge .7s cubic-bezier(.2,1.6,.4,1) .3s backwards; }
@keyframes gt-res-badge { from { opacity: 0; transform: scale(0) rotate(-40deg); } }
.gt-res-title {
  margin: 8px 0 2px; font-size: 26px; font-weight: bold; letter-spacing: 2px; color: var(--gt-res-c);
  text-shadow: 0 0 12px var(--gt-res-c); animation: gt-res-glow 1.8s ease-in-out .9s infinite alternate;
}
@keyframes gt-res-glow { to { text-shadow: 0 0 22px var(--gt-res-c), 0 0 4px #fff; } }
.gt-res-sub { font-size: 13px; opacity: .75; margin-bottom: 12px; }
.gt-res-rows { display: flex; flex-direction: column; gap: 5px; margin: 10px 0 16px; text-align: left; }
.gt-res-row {
  display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 5px;
  background: rgba(57,255,20,.06); border: 1px solid rgba(57,255,20,.15);
  animation: gt-res-row .35s ease-out backwards;
}
@keyframes gt-res-row { from { opacity: 0; transform: translateX(-24px); } }
.gt-res-row.win { background: rgba(255,200,40,.13); border-color: rgba(255,200,40,.55); color: #ffe27a; }
.gt-res-row.you .gt-res-name::after { content: ' (you)'; opacity: .6; font-size: 11px; }
.gt-res-place { width: 22px; text-align: center; font-weight: bold; opacity: .8; }
.gt-res-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gt-res-val { font-weight: bold; }
.gt-res-btns { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.gt-res-btns button { font-family: monospace; font-size: 14px; padding: 8px 16px; cursor: pointer; border-radius: 5px; }
.gt-res-btns .primary {
  background: #39ff14; color: #041004; border: 1px solid #39ff14; font-weight: bold;
  animation: gt-res-pulse 1.4s ease-in-out 1s infinite;
}
@keyframes gt-res-pulse { 50% { box-shadow: 0 0 0 6px rgba(57,255,20,0), 0 0 18px rgba(57,255,20,.8); } 0%, 100% { box-shadow: 0 0 0 0 rgba(57,255,20,.6); } }
.gt-res-btns .ghost { background: transparent; color: #9fd89a; border: 1px solid #3a5a36; }
.gt-res-btns .primary:disabled { animation: none; opacity: .55; cursor: default; }
.gt-res-pill {
  position: fixed; right: 16px; bottom: 16px; z-index: 899; font-family: monospace; cursor: pointer;
  background: #0c160c; color: #39ff14; border: 1px solid #39ff14; border-radius: 16px; padding: 7px 14px;
  box-shadow: 0 0 14px -2px #39ff14; animation: gt-res-pop .35s cubic-bezier(.2,1.4,.4,1) backwards;
}
@media (prefers-reduced-motion: reduce) {
  .gt-res-back, .gt-res-card, .gt-res-card.lose, .gt-res-badge, .gt-res-title, .gt-res-row, .gt-res-btns .primary, .gt-res-pill { animation: none; }
}
`;

let styled = false;
function ensureStyles() {
  if (styled) return;
  styled = true;
  const tag = document.createElement('style');
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

const OUTCOME = {
  win: { color: '#ffd23f', badge: '🏆' },
  lose: { color: '#ff4d4d', badge: '💀' },
  draw: { color: '#7fd7ff', badge: '🤝' },
  over: { color: '#39ff14', badge: '🏁' },
};
const CONFETTI = ['#39ff14', '#ffd23f', '#ff4dd2', '#4dd2ff', '#ff7b39', '#ffffff'];

function confetti(canvas) {
  if (reduced()) return () => {};
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bits = [];
  for (let i = 0; i < 160; i++) {
    const side = i % 2 ? 1 : -1;
    bits.push({
      x: side > 0 ? w * 0.1 : w * 0.9, y: h * 0.75,
      vx: -side * (120 + Math.random() * 380), vy: -(500 + Math.random() * 520),
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 14,
      w: 5 + Math.random() * 6, h: 3 + Math.random() * 4,
      c: CONFETTI[i % CONFETTI.length], delay: Math.random() * 0.35,
    });
  }
  let last = performance.now();
  let age = 0;
  let raf = requestAnimationFrame(function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    age += dt;
    ctx.clearRect(0, 0, w, h);
    for (const b of bits) {
      if (age < b.delay) continue;
      b.vy += 900 * dt;
      b.vx *= 1 - 1.2 * dt;
      b.vy = Math.min(b.vy, 260 + (b.w * 10));
      b.x += b.vx * dt + Math.sin(age * 6 + b.r) * 0.8;
      b.y += b.vy * dt;
      b.r += b.vr * dt;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, (4.2 - age) / 0.8));
      ctx.translate(b.x, b.y);
      ctx.rotate(b.r);
      ctx.scale(1, Math.cos(age * 8 + b.r));
      ctx.fillStyle = b.c;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    raf = age < 4.2 ? requestAnimationFrame(tick) : 0;
  });
  return () => cancelAnimationFrame(raf);
}

// opts: { title, subtitle?, outcome: 'win'|'lose'|'draw'|'over', rows?: [{ name, value?, win?, you? }],
//         rematch?: { label?, onClick } }  — rows are shown in the given order, numbered 1..n.
export function createResults(container) {
  ensureStyles();
  let back = null;
  let pill = null;
  let stopConfetti = () => {};
  let active = false;
  let lastOpts = null;

  function close(animate) {
    stopConfetti();
    if (back) {
      const b = back;
      back = null;
      if (animate && !reduced()) {
        b.classList.add('out');
        setTimeout(() => b.remove(), 200);
      } else b.remove();
    }
  }
  function removePill() { if (pill) { pill.remove(); pill = null; } }

  function open(opts, celebrate) {
    removePill();
    close(false);
    const o = OUTCOME[opts.outcome] || OUTCOME.over;
    back = document.createElement('div');
    back.className = 'gt-res-back';
    back.addEventListener('click', (e) => { if (e.target === back) dismiss(); });
    const cv = document.createElement('canvas');
    cv.className = 'gt-res-confetti';
    back.appendChild(cv);

    const card = document.createElement('div');
    card.className = `gt-res-card ${opts.outcome || ''}`;
    card.style.setProperty('--gt-res-c', o.color);
    const badge = document.createElement('div');
    badge.className = 'gt-res-badge';
    badge.textContent = o.badge;
    const title = document.createElement('div');
    title.className = 'gt-res-title';
    title.textContent = opts.title;
    card.append(badge, title);
    if (opts.subtitle) {
      const sub = document.createElement('div');
      sub.className = 'gt-res-sub';
      sub.textContent = opts.subtitle;
      card.appendChild(sub);
    }
    if (opts.rows && opts.rows.length) {
      const list = document.createElement('div');
      list.className = 'gt-res-rows';
      opts.rows.forEach((r, i) => {
        const row = document.createElement('div');
        row.className = `gt-res-row${r.win ? ' win' : ''}${r.you ? ' you' : ''}`;
        row.style.animationDelay = `${0.35 + i * 0.09}s`;
        const place = document.createElement('span');
        place.className = 'gt-res-place';
        place.textContent = r.win ? '👑' : String(i + 1);
        const name = document.createElement('span');
        name.className = 'gt-res-name';
        name.textContent = r.name;
        row.append(place, name);
        if (r.value != null) {
          const val = document.createElement('span');
          val.className = 'gt-res-val';
          val.textContent = r.value;
          row.appendChild(val);
        }
        list.appendChild(row);
      });
      card.appendChild(list);
    }
    const btns = document.createElement('div');
    btns.className = 'gt-res-btns';
    if (opts.rematch) {
      const again = document.createElement('button');
      again.className = 'primary';
      again.textContent = opts.rematch.label || 'REMATCH';
      again.addEventListener('click', () => {
        again.disabled = true;
        opts.rematch.onClick();
      });
      btns.appendChild(again);
    }
    const view = document.createElement('button');
    view.className = 'ghost';
    view.textContent = 'VIEW TABLE';
    view.addEventListener('click', dismiss);
    btns.appendChild(view);
    card.appendChild(btns);
    back.appendChild(card);
    container.appendChild(back);
    stopConfetti = celebrate && opts.outcome === 'win' ? confetti(cv) : () => {};
  }

  function dismiss() {
    close(true);
    removePill();
    pill = document.createElement('button');
    pill.className = 'gt-res-pill';
    pill.textContent = '🏁 RESULTS';
    pill.addEventListener('click', () => open(lastOpts, false));
    container.appendChild(pill);
  }

  return {
    update(opts) {
      if (!opts) {
        if (active) { close(true); removePill(); }
        active = false;
        lastOpts = null;
        return;
      }
      lastOpts = opts;
      if (!active) {
        active = true;
        open(opts, true);
      }
    },
    destroy() {
      close(false);
      removePill();
    },
  };
}

// Options for a two-seat colour game (chess, checkers, connect 4, backgammon). `winner` is a
// colour, or 'draw'/null for a draw; `players` maps colour -> clientId; `me` is my colour or null.
export function duelResults({ winner, colors, players, me, nameFor, subtitle, onRematch }) {
  const draw = !winner || winner === 'draw';
  const order = draw ? colors : [winner, ...colors.filter((c) => c !== winner)];
  return {
    title: draw ? "IT'S A DRAW" : me === winner ? 'YOU WIN!' : me ? 'YOU LOSE' : `${winner.toUpperCase()} WINS!`,
    subtitle,
    outcome: draw ? 'draw' : me == null ? 'over' : me === winner ? 'win' : 'lose',
    rows: order.map((c) => ({
      name: `${nameFor(players[c])}`, value: c.toUpperCase(), win: !draw && c === winner, you: c === me,
    })),
    rematch: me ? { label: 'REMATCH', onClick: onRematch } : null,
  };
}

// Options for a seat-array card game. `winners` is the list of winning seat indexes; rows are the
// occupied seats sorted by `rank(i)` (lower first) with `value(i)` shown on the right.
export function seatResults({ seats, winners, me, nameFor, value, rank, winTitle, subtitle, onRematch, rematchLabel }) {
  const idxs = seats.map((_, i) => i).filter((i) => seats[i]);
  idxs.sort((a, b) => rank(a) - rank(b));
  const iWon = winners.includes(me);
  const seated = me != null && me >= 0;
  return {
    title: seated ? (iWon ? 'YOU WIN!' : 'YOU LOSE') : winTitle,
    subtitle,
    outcome: seated ? (iWon ? 'win' : 'lose') : 'over',
    rows: idxs.map((i) => ({ name: `${nameFor(seats[i])}`, value: value(i), win: winners.includes(i), you: i === me })),
    rematch: seated ? { label: rematchLabel || 'PLAY AGAIN', onClick: onRematch } : null,
  };
}
