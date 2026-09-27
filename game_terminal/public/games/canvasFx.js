// Shared 2D-canvas juice for the real-time games: particle bursts, expanding rings, floating
// text, screen shake and a big countdown pop. One `createFx()` per game; call `fx.draw(ctx)`
// once per frame after drawing the scene (in whatever coordinate space the effects were
// spawned in) and wrap the scene in `fx.applyShake(ctx)` / `ctx.restore()` for shake.

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createFx() {
  const parts = [];
  const rings = [];
  const texts = [];
  let shakeMag = 0;
  let last = performance.now();
  let big = null; // { label, color, born }

  function step() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    return { now, dt };
  }

  return {
    // Spray `count` particles from (x, y). `speed` is px/s, `life` seconds.
    burst(x, y, color, { count = 24, speed = 160, life = 0.6, size = 3, gravity = 0, spread = Math.PI * 2, angle = 0 } = {}) {
      if (reduced()) count = Math.min(count, 6);
      for (let i = 0; i < count; i++) {
        const a = angle + (Math.random() - 0.5) * spread;
        const v = speed * (0.35 + Math.random() * 0.65);
        parts.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, gravity,
          life: life * (0.6 + Math.random() * 0.4), age: 0, size: size * (0.6 + Math.random() * 0.8), color,
        });
      }
      if (parts.length > 900) parts.splice(0, parts.length - 900);
    },
    ring(x, y, color, { radius = 40, life = 0.45, width = 3 } = {}) {
      rings.push({ x, y, color, radius, life, width, age: 0 });
    },
    text(x, y, str, color, { life = 0.9, size = 14 } = {}) {
      texts.push({ x, y, str, color, life, size, age: 0 });
    },
    shake(mag) {
      if (!reduced()) shakeMag = Math.max(shakeMag, mag);
    },
    // Large centered label (countdown numbers, "GO!") that pops in and fades.
    bigLabel(label, color = '#39ff14') {
      big = { label, color, born: performance.now() };
    },
    // ctx.save() + a random offset; caller must ctx.restore() after drawing the scene.
    applyShake(ctx) {
      ctx.save();
      if (shakeMag > 0.3) {
        ctx.translate((Math.random() - 0.5) * 2 * shakeMag, (Math.random() - 0.5) * 2 * shakeMag);
      }
    },
    get active() { return parts.length + rings.length + texts.length > 0 || shakeMag > 0.3 || !!big; },
    draw(ctx) {
      const { now, dt } = step();
      shakeMag *= Math.pow(0.0015, dt); // ~decays to nothing in ~0.4s
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age >= p.life) { parts.splice(i, 1); continue; }
        p.vy += p.gravity * dt;
        p.vx *= 1 - 1.8 * dt;
        p.vy *= 1 - 1.8 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const k = 1 - p.age / p.life;
        ctx.globalAlpha = k;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * k), 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.age += dt;
        if (r.age >= r.life) { rings.splice(i, 1); continue; }
        const k = r.age / r.life;
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = r.width * (1 - k) + 0.5;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius * (0.2 + 0.8 * (1 - (1 - k) * (1 - k))), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.textAlign = 'center';
      for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i];
        t.age += dt;
        if (t.age >= t.life) { texts.splice(i, 1); continue; }
        const k = t.age / t.life;
        ctx.globalAlpha = 1 - k * k;
        ctx.fillStyle = t.color;
        ctx.font = `bold ${t.size}px monospace`;
        ctx.fillText(t.str, t.x, t.y - k * 26);
      }
      ctx.restore();
    },
    // Draw the big label in screen space (call after restoring any camera transform).
    drawOverlay(ctx, w, h) {
      if (!big) return;
      const age = (performance.now() - big.born) / 1000;
      if (age > 0.85) { big = null; return; }
      const pop = age < 0.15 ? 0.6 + (age / 0.15) * 0.6 : 1.2 - Math.min(0.2, (age - 0.15) * 0.5);
      ctx.save();
      ctx.globalAlpha = age < 0.5 ? 1 : 1 - (age - 0.5) / 0.35;
      ctx.translate(w / 2, h / 2);
      ctx.scale(pop, pop);
      ctx.font = `bold ${Math.round(h * 0.2)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = big.color;
      ctx.shadowBlur = 24;
      ctx.fillStyle = big.color;
      ctx.fillText(big.label, 0, 0);
      ctx.restore();
    },
  };
}

// Brief full-element flash (e.g. red on your own death) via a CSS overlay.
export function flashEl(el, color = 'rgba(255,40,40,0.45)', ms = 260) {
  if (!el || reduced()) return;
  const f = document.createElement('div');
  Object.assign(f.style, { position: 'absolute', inset: '0', background: color, pointerEvents: 'none', zIndex: '5' });
  el.appendChild(f);
  f.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-out' }).onfinish = () => f.remove();
}

// Size a fixed-layout canvas for the screen's pixel density so it isn't blurry on HiDPI/zoomed
// displays. The canvas keeps its CSS size of w×h and the returned context is pre-scaled, so all
// drawing code keeps working in w×h units (it must not call setTransform/resetTransform).
export function sharpCanvas(canvas, w, h) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
