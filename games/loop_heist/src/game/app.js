// Loop Heist: screens, flow and persistence.
import { parseLevel } from '../sim/level.js';
import { Sim } from '../sim/sim.js';
import { Bot, runBot } from '../sim/bot.js';
import { ROLES, TICK_RATE } from '../sim/constants.js';
import { Renderer } from '../render/render.js';
import { Input } from './input.js';
import { LEVELS } from '../levels/campaign.js';
import { makeJob, TIERS } from '../levels/procgen.js';
import { h, clear, fmtTime, describeEvent, eventClass } from './ui.js';
import { audio } from './audio.js';

const DT = 1 / TICK_RATE;
const SIDE_W = 360;
const cv = document.getElementById('view');
const ui = document.getElementById('ui');
const R = new Renderer(cv);
const input = new Input();

// ---------- persistence ----------
const STORE_KEY = 'loopheist.v1';
const store = (() => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; }
})();
store.progress ??= {};
store.plans ??= {};
store.contracts ??= { done: 0, best: {} };
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* private mode */ } };

// ---------- level context ----------
export function levelDefs() { return LEVELS; }

class Heist {
  constructor(def) {
    this.def = def;
    this.L = parseLevel(def);
    this.crew = (store.plans[def.id] ?? []).filter((c) => c.rec && ROLES[c.role]);
  }
  persist() { store.plans[this.def.id] = this.crew; save(); }
  nextSlot() {
    for (let s = 0; ; s++) if (!this.crew.some((c) => c.slot === s)) return s;
  }
  // Run the full plan headlessly: every crew member replays.
  evaluate() {
    if (!this.crew.length) return null;
    const sim = new Sim(this.L, this.crew);
    sim.runToEnd(this.L.loopTicks + 5);
    return sim;
  }
}

function stars(L, over, crewCount) {
  if (over?.kind !== 'success') return 0;
  let s = 1;
  if (!L.par || crewCount <= L.par.crew) s++;
  if (!L.par || over.t / TICK_RATE <= L.par.seconds) s++;
  return s;
}

function recordWin(heist, over) {
  const id = heist.def.id;
  const st = stars(heist.L, over, heist.crew.length);
  if (heist.def.procedural) {
    const c = store.contracts;
    if (!(id in c.best)) c.done++;
    c.best[id] = Math.max(c.best[id] ?? 0, st);
    save();
    return st;
  }
  const prev = store.progress[id] ?? {};
  store.progress[id] = {
    done: true,
    stars: Math.max(prev.stars ?? 0, st),
    bestTime: Math.min(prev.bestTime ?? Infinity, over.t),
    bestCrew: Math.min(prev.bestCrew ?? Infinity, heist.crew.length),
  };
  save();
  return st;
}

// ---------- screens ----------
let screen = null;
function show(next) {
  screen?.destroy?.();
  clear(ui);
  input.clear();
  screen = next;
  document.body.dataset.screen = next.constructor.name;
  screen.mount?.();
  layout();
}

function layout() {
  R.resize();
  screen?.layout?.();
}
addEventListener('resize', layout);

const sideRect = () => {
  const narrow = innerWidth <= 800;
  return narrow
    ? { x: 8, y: 8, w: innerWidth - 16, h: innerHeight * 0.54 - 16 }
    : { x: 16, y: 16, w: innerWidth - SIDE_W - 32, h: innerHeight - 32 - (screen instanceof ReplayScreen ? 70 : 0) };
};

class MenuScreen {
  constructor() {
    this.bg = new Heist(LEVELS[0]);
    this.sim = null;
  }
  mount() {
    const unlocked = (i) => i === 0 || store.progress[LEVELS[i - 1].id]?.done || store.progress[LEVELS[i].id]?.done;
    ui.append(h('div', { class: 'title-screen' },
      h('div', { class: 'logo' }, h('span', { class: 'loop' }, 'LOOP'), h('br'), h('span', { class: 'heist' }, 'HEIST')),
      h('p', { class: 'tagline' }, 'One loop. One crew. Every member is you. Plan the job one take at a time and watch your past selves replay it, until the past stops agreeing with the present.'),
      h('div', { class: 'levels' },
        ...LEVELS.map((def, i) => {
          const p = store.progress[def.id];
          return h('button', {
            class: 'level-card', disabled: !unlocked(i),
            onclick: () => { audio.click(); show(new PlanScreen(new Heist(def))); },
          },
            h('span', { class: 'num' }, `HEIST ${String(i + 1).padStart(2, '0')}`),
            h('span', { class: 'name' }, def.name),
            h('span', { class: 'stars' }, p?.done ? '★'.repeat(p.stars) + '☆'.repeat(3 - p.stars) : unlocked(i) ? 'new' : 'locked'),
          );
        }),
      ),
      h('div', { class: 'contracts' },
        h('div', { class: 'section-title' }, `Contracts · generated jobs, each one checked beatable${store.contracts.done ? ` · ${store.contracts.done} pulled` : ''}`),
        h('div', { class: 'levels' },
          h('button', { class: 'level-card procedural daily', onclick: () => { audio.click(); openContract(todaySeed(), 2); } },
            h('span', { class: 'num' }, 'DAILY JOB'),
            h('span', { class: 'name' }, new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
            h('span', { class: 'stars' }, (() => { const b = store.contracts.best[`job-2-${todaySeed()}`]; return b ? '★'.repeat(b) + '☆'.repeat(3 - b) : 'same building for everyone today'; })())),
          ...[1, 2, 3].map((tier) => h('button', { class: 'level-card procedural', onclick: () => { audio.click(); newContract(tier); } },
            h('span', { class: 'num' }, `CONTRACT · ${TIERS[tier].name.toUpperCase()}`),
            h('span', { class: 'name' }, ['', 'Smash and grab', 'Keycard job', 'Full security'][tier]),
            h('span', { class: 'stars' }, 'new building every time'))),
          store.contract && store.plans[`job-${store.contract.tier}-${store.contract.seed}`]?.length
            ? h('button', { class: 'level-card procedural', onclick: () => { audio.click(); openContract(store.contract.seed, store.contract.tier); } },
              h('span', { class: 'num' }, 'IN PROGRESS'),
              h('span', { class: 'name' }, 'Resume last contract'),
              h('span', { class: 'stars' }, TIERS[store.contract.tier].name))
            : null)),
      h('div', { class: 'footer-note' }, 'WASD move · Shift sneak · E use · Q ability · Backspace rewind'),
    ));
  }
  layout() { R.fit(this.bg.L, { x: 0, y: 0, w: innerWidth, h: innerHeight }); }
  frame(dt) {
    R.draw(this.sim ??= new Sim(this.bg.L, []), { dt, prompt: false });
    if (this.sim.tick < this.sim.L.loopTicks) { R.capture(this.sim.S); this.sim.step(); R.collectEffects(this.sim.S); }
    else this.sim = null;
  }
}

class PlanScreen {
  constructor(heist) {
    this.heist = heist;
    this.result = heist.evaluate();
    this.preview = null;
    this.acc = 0;
    this.pause = 0;
  }
  mount() {
    const { heist } = this;
    const L = heist.L;
    const res = this.result;
    const full = heist.crew.length >= L.maxCrew;
    const crewRows = heist.crew.map((c, i) => {
      const a = res?.S.actors[i];
      let status = 'recorded', cls = '';
      if (a?.lost) { status = `PARADOX at ${fmtTime(a.lost.t)}: ${a.lost.why}`; cls = 'bad'; }
      else if (a?.escaped) { status = `in sync · out at ${fmtTime(c.rec.escapedAt)}`; cls = 'ok'; }
      else if (res?.S.alarm) status = 'alarm went off first';
      return h('div', { class: `crew-row ${a?.lost ? 'lost' : ''}` },
        h('div', { class: 'crew-dot', style: `background:${ROLES[c.role].color}` }, String(i + 1)),
        h('div', { class: 'crew-info' },
          h('div', { class: 'role' }, ROLES[c.role].name),
          h('div', { class: `status ${cls}` }, status)),
        h('div', { class: 'crew-actions' },
          h('button', { class: 'btn small ghost', title: 'Re-record this crew member', onclick: () => this.take(i) }, '↻'),
          h('button', { class: 'btn small danger', title: 'Remove', onclick: () => { heist.crew.splice(i, 1); heist.persist(); show(new PlanScreen(heist)); } }, '✕')),
      );
    });

    let verdict = h('div', { class: 'verdict' }, h('b', {}, 'No crew yet.'), 'Pick a role below to record your first take.');
    if (res) {
      const o = res.over;
      const lost = res.S.actors.find((a) => a.lost);
      if (o.kind === 'success') verdict = h('div', { class: 'verdict ok' }, h('b', {}, `✔ The plan works. Out at ${fmtTime(o.t)}.`), `Take: $${o.take.toLocaleString()} · ${'★'.repeat(stars(L, o, heist.crew.length))}`);
      else if (o.kind === 'alarm') verdict = h('div', { class: 'verdict bad' }, h('b', {}, `✖ Alarm at ${fmtTime(o.t)}`), o.reason);
      else if (lost) verdict = h('div', { class: 'verdict paradox' }, h('b', {}, `✖ Paradox: crew member ${lost.i + 1} lost the plot`), lost.lost.why);
      else verdict = h('div', { class: 'verdict bad' }, h('b', {}, '✖ Not done yet'), o.reason);
    }

    ui.append(h('aside', { class: 'side' },
      h('header', {},
        h('div', { class: 'section-title' }, `${heistLabel(heist.def)} · ${L.loopTicks / TICK_RATE}s loop · up to ${L.maxCrew} crew`),
        h('h1', {}, L.name),
        h('p', { class: 'brief' }, L.brief)),
      h('div', { class: 'scroll' },
        verdict,
        h('div', {}, h('div', { class: 'section-title' }, 'Crew'),
          h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, ...crewRows,
            crewRows.length ? null : h('div', { class: 'dim', style: 'font-size:.85rem' }, 'Every crew member is you, in an earlier take.'))),
        h('div', {}, h('div', { class: 'section-title' }, full ? 'Crew is full' : `Add crew member ${heist.crew.length + 1}`),
          h('div', { class: 'roles' }, ...['ghost', 'hacker', 'cracker', 'muscle'].map((r) =>
            h('button', {
              class: 'role-card', style: `color:${ROLES[r].color}`, disabled: full || !L.roles.includes(r),
              onclick: () => this.take(heist.crew.length, r),
            }, h('span', { class: 'rn' }, ROLES[r].name), h('span', { class: 'rb' }, L.roles.includes(r) ? ROLES[r].blurb : 'Not on this job.'))))),
        L.tips.length ? h('div', {}, h('div', { class: 'section-title' }, 'Notes'), h('ul', { class: 'tips' }, ...L.tips.map((t) => h('li', {}, t)))) : null,
        heist.def.solution ? h('div', {}, h('div', { class: 'section-title' }, 'Stuck?'),
          this.hintBtn = h('button', { class: `btn small ghost hint-btn ${this.hint ? 'on' : ''}`, onclick: () => this.toggleHint() },
            this.hint ? '◼ Stop the walkthrough' : '◉ Show me a way in'),
          h('div', { class: 'dim', style: 'font-size:.8rem;margin-top:6px' }, 'The building was checked with a lone sneaking Ghost. Watch the route on the map.')) : null,
      ),
      h('footer', {},
        h('button', { class: 'btn ghost', onclick: () => show(new MenuScreen()) }, '← Heists'),
        h('button', { class: 'btn', disabled: !res, onclick: () => show(new ReplayScreen(heist)) }, '▶ Watch the plan'),
        res?.over.kind === 'success' && nextLevel(heist.def)
          ? h('button', { class: 'btn', onclick: () => show(new PlanScreen(new Heist(nextLevel(heist.def)))) }, 'Next heist →') : null,
        res?.over.kind === 'success' && heist.def.procedural
          ? h('button', { class: 'btn', onclick: () => newContract(heist.def.procedural.tier) }, 'New contract →') : null,
      ),
    ));
    this.unkey = input.onKey((e) => {
      if (e.code === 'Escape') show(new MenuScreen());
      if (e.code === 'Enter' && res) show(new ReplayScreen(heist));
    });
  }
  destroy() { this.unkey?.(); document.body.classList.remove('hinting'); }
  toggleHint() {
    audio.click();
    this.hint = !this.hint;
    this.preview = null;
    if (this.hint && !this.hintCrew) {
      const sim = new Sim(this.heist.L, [{ role: 'ghost', rec: null }]);
      this.hintCrew = [{ role: 'ghost', rec: runBot(sim, new Bot(this.heist.def.solution[0].cmds)) }];
    }
    this.hintBtn.textContent = this.hint ? '◼ Stop the walkthrough' : '◉ Show me a way in';
    this.hintBtn.classList.toggle('on', this.hint);
    document.body.classList.toggle('hinting', this.hint);
  }
  take(index, role) {
    audio.click();
    show(new TakeScreen(this.heist, index, role ?? this.heist.crew[index].role));
  }
  layout() { R.fit(this.heist.L, sideRect()); }
  frame(dt) {
    // The plan replays in the background on a loop.
    if (!this.preview) { this.preview = new Sim(this.heist.L, this.hint ? this.hintCrew : this.heist.crew); this.acc = 0; R.prev = null; }
    const sim = this.preview;
    if (sim.over) {
      if ((this.pause += dt) > 1.5) { this.preview = null; this.pause = 0; }
    } else {
      this.acc += dt;
      while (this.acc >= DT && !sim.over) { this.acc -= DT; R.capture(sim.S); sim.step(); R.collectEffects(sim.S); }
    }
    R.draw(sim, { dt, alpha: this.acc / DT, prompt: false });
  }
}

const nextLevel = (def) => (def.procedural ? null : LEVELS[LEVELS.indexOf(def) + 1] ?? null);
const heistLabel = (def) => (def.procedural ? `Contract · ${TIERS[def.procedural.tier].name}` : `Heist ${LEVELS.indexOf(def) + 1}`);

// ---------- contracts (procedural jobs) ----------
const todaySeed = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };

// Generating + verifying takes up to a second or two, so show a card first.
function openContract(seed, tier) {
  clear(ui);
  ui.append(h('div', { class: 'title-screen' }, h('div', { class: 'center-card casing' },
    h('div', { class: 'section-title' }, `Contract · ${TIERS[tier].name}`),
    h('h2', {}, 'Casing the building…'),
    h('div', { class: 'dim' }, 'Mapping patrols and checking there is a way in.'))));
  setTimeout(() => {
    const def = makeJob(seed, tier);
    if (!def) { show(new MenuScreen()); return; }
    for (const id of Object.keys(store.plans)) if (id.startsWith('job-') && id !== def.id) delete store.plans[id];
    store.contract = { seed, tier };
    save();
    show(new PlanScreen(new Heist(def)));
  }, 60);
}
const newContract = (tier) => openContract(1 + Math.floor(Math.random() * 999999), tier);

class TakeScreen {
  constructor(heist, index, role) {
    this.heist = heist;
    this.index = index;
    this.role = role;
    this.oldRec = heist.crew[index]?.rec ?? null;
    const slot = heist.crew[index]?.slot ?? heist.nextSlot();
    this.crew = heist.crew.map((c) => c);
    this.crew[index] = { role, slot, rec: null };
    this.reset();
  }
  reset() {
    this.sim = new Sim(this.heist.L, this.crew);
    this.snaps = [this.sim.snapshot()];
    this.started = false;
    this.acc = 0;
    this.logCursor = 0;
    this.ended = null;
    this.rewindAcc = 0;
    R.prev = null;
    R.fx = [];
  }
  mount() {
    this.el = {
      crew: h('div', { class: 'hud-crew' }),
      timer: h('div', { class: 'timer' }, '0:00'),
      fill: h('div', { class: 'fill' }),
      bar: null,
      toasts: h('div', { class: 'toasts' }),
      card: h('div'),
    };
    this.el.bar = h('div', { class: 'timebar' }, this.el.fill);
    // Clone event marks on the timeline.
    const total = this.heist.L.loopTicks;
    this.crew.forEach((c, i) => {
      if (!c.rec) return;
      for (const e of c.rec.events) this.el.bar.append(h('div', { class: 'mark', style: `left:${(e.t / total) * 100}%;background:${ROLES[c.role].color}`, title: `${i + 1}: ${e.k} ${e.id}` }));
    });
    // Radio check-ins: any guard who is out cold at one of these raises the alarm.
    const ri = this.heist.L.radioInterval;
    if (ri > 0) for (let t = ri; t < total; t += ri) this.el.bar.append(h('div', { class: 'mark radio', style: `left:${(t / total) * 100}%`, title: 'Radio check-in' }));
    ui.append(
      h('div', { class: 'hud-top' },
        h('div', { class: 'who' }, h('div', { class: 'crew-dot', style: `background:${ROLES[this.role].color}` }, String(this.index + 1)), ROLES[this.role].name),
        this.el.bar, this.el.timer),
      this.el.crew,
      this.el.toasts,
      h('div', { class: 'hud-help' },
        h('span', {}, h('kbd', {}, 'WASD'), ' move'), h('span', {}, h('kbd', {}, 'Shift'), ' sneak'),
        h('span', {}, h('kbd', {}, 'E'), ' use / hold'), this.role === 'ghost' ? h('span', {}, h('kbd', {}, 'Q'), ' whistle') : null,
        h('span', {}, h('kbd', {}, 'Backspace'), ' rewind'), h('span', {}, h('kbd', {}, 'F'), ' fast-forward'),
        h('span', {}, h('kbd', {}, 'R'), ' restart take'), h('span', {}, h('kbd', {}, 'Esc'), ' back to plan')),
      this.el.card,
    );
    this.showStartCard();
    this.unkey = input.onKey((e) => this.key(e));
  }
  destroy() { this.unkey?.(); }
  layout() { R.fit(this.heist.L, { x: 12, y: 64, w: innerWidth - 24, h: innerHeight - 110 }); }

  showStartCard() {
    const n = this.crew.filter((c) => c.rec).length;
    this.el.card.replaceChildren(h('div', { class: 'center-card start-hint' },
      h('div', { class: 'section-title' }, this.oldRec ? 'Re-recording' : 'New take'),
      h('h2', { style: `color:${ROLES[this.role].color}` }, `Crew member ${this.index + 1}: ${ROLES[this.role].name}`),
      h('div', { class: 'dim' }, n ? `${n} earlier take${n > 1 ? 's' : ''} will replay alongside you. Dotted lines show where they're going.` : 'You\'re the first one in. Whatever you do now, later crew members will see happen.'),
      h('div', {}, 'Move to start the loop.')));
  }

  key(e) {
    if (e.code === 'Escape') { show(new PlanScreen(this.heist)); return; }
    if (e.code === 'KeyR') { this.reset(); this.el.card.replaceChildren(); this.showStartCard(); return; }
    if (this.ended && e.code === 'Enter') {
      if (this.ended.committed) show(new PlanScreen(this.heist));
      else { this.reset(); this.el.card.replaceChildren(); this.showStartCard(); }
    }
  }

  rewind() {
    if (this.snaps.length <= 1 && this.sim.tick === 0) return;
    // Drop back to the previous snapshot (each is 10 ticks apart).
    let snap = this.snaps[this.snaps.length - 1];
    if (snap.S.tick >= this.sim.tick && this.snaps.length > 1) { this.snaps.pop(); snap = this.snaps[this.snaps.length - 1]; }
    this.sim.restore(snap);
    this.logCursor = Math.min(this.logCursor, this.sim.S.log.length);
    this.ended = null;
    this.el.card.replaceChildren();
    R.prev = null;
    R.fx = [];
  }

  frame(dt) {
    const sim = this.sim;
    if (input.held('Backspace')) {
      if ((this.rewindAcc += dt) >= 0.06) { this.rewindAcc = 0; this.rewind(); audio.tick(); }
      this.started = true;
      this.acc = 0;
    } else if (!this.started) {
      if (input.anyGameKey()) { this.started = true; this.el.card.replaceChildren(); audio.start(); }
    } else if (!this.ended) {
      const live = sim.S.actors[this.index];
      const ff = live.escaped ? 6 : input.held('KeyF') ? 4 : 1;
      this.acc += dt * ff;
      let steps = 0;
      while (this.acc >= DT && !sim.over && steps++ < 12) {
        this.acc -= DT;
        R.capture(sim.S);
        sim.step(live.escaped ? 0 : input.sample());
        this.afterTick();
      }
      if (sim.over) this.finish();
    }
    this.hud();
    R.draw(sim, { dt, alpha: this.started && !this.ended ? Math.min(1, this.acc / DT) : 1, oldRec: this.oldRec });
  }

  afterTick() {
    const sim = this.sim, S = sim.S;
    if (S.tick % 10 === 0) this.snaps.push(sim.snapshot());
    const from = this.logCursor;
    this.logCursor = R.collectEffects(S, from);
    for (let i = from; i < S.log.length; i++) {
      const e = S.log[i];
      const text = describeEvent(e, sim);
      if (e.k === 'paradox') { this.toast(text, 'paradox'); audio.paradox(); }
      else if (e.k === 'alarm') { this.toast(text, 'alarm'); audio.alarm(); }
      else if (e.k === 'escape') { this.toast(text, 'good'); audio.escape(); }
      else if (e.k === 'power-restored' || e.k === 'takedown') this.toast(text, '');
      if (e.a === this.index || e.k.startsWith('gate-')) audio.interact(e.k);
    }
    const ri = this.heist.L.radioInterval, warn = 5 * TICK_RATE;
    if (ri > 0 && S.tick > 0 && (S.tick + warn) % ri === 0 && S.tick + warn < this.heist.L.loopTicks) {
      const out = S.guards.find((g) => g.state === 'ko');
      if (out) { this.toast(`Radio check-in in 5s — ${out.id} won't answer`, 'alarm'); audio.suspicion(30); }
    }
    for (const n of S.noises) if (n.kind === 'whistle') audio.whistle();
    if (S.guards.some((g) => g.seeing >= 0 && g.sus > 0)) audio.suspicion(Math.max(...S.guards.map((g) => g.sus)));
  }

  toast(text, cls) {
    const t = h('div', { class: `toast ${cls}` }, text);
    this.el.toasts.prepend(t);
    setTimeout(() => t.remove(), 3500);
    while (this.el.toasts.children.length > 4) this.el.toasts.lastChild.remove();
  }

  hud() {
    const S = this.sim.S, L = this.heist.L;
    const left = Math.max(0, L.loopTicks - S.tick);
    this.el.timer.textContent = fmtTime(left);
    this.el.timer.classList.toggle('low', left < 10 * TICK_RATE);
    this.el.fill.style.width = `${(S.tick / L.loopTicks) * 100}%`;
    const chips = S.actors.map((a, i) => {
      const c = this.crew[i];
      const st = a.escaped ? 'out' : a.lost ? 'LOST' : i === this.index ? 'you' : 'replaying';
      return h('div', { class: `hud-chip ${a.lost ? 'lost' : ''} ${a.escaped ? 'out' : ''}` },
        h('div', { class: 'crew-dot', style: `background:${ROLES[c.role].color}` }, String(i + 1)),
        `${ROLES[c.role].name} · ${st}`);
    });
    const sig = chips.map((c) => c.textContent).join('|');
    if (sig !== this.chipSig) { this.chipSig = sig; this.el.crew.replaceChildren(...chips); }
  }

  finish() {
    const sim = this.sim, o = sim.over, L = this.heist.L;
    const rec = sim.liveRec;
    const escaped = rec.escapedAt != null;
    this.ended = { committed: escaped };
    if (escaped) {
      this.heist.crew[this.index] = { role: this.role, slot: this.crew[this.index].slot, rec };
      this.heist.persist();
    }
    let card;
    if (o.kind === 'success') {
      const st = recordWin(this.heist, o);
      audio.win();
      card = h('div', { class: 'center-card win' },
        h('div', { class: 'section-title' }, 'Heist complete'),
        h('h2', {}, 'Clean getaway'),
        h('div', { class: 'stars' }, '★'.repeat(st) + '☆'.repeat(3 - st)),
        h('div', { class: 'stats' },
          h('div', {}, h('b', {}, fmtTime(o.t)), h('span', {}, `time${L.par ? ` (par ${L.par.seconds}s)` : ''}`)),
          h('div', {}, h('b', {}, String(this.heist.crew.length)), h('span', {}, `crew${L.par ? ` (par ${L.par.crew})` : ''}`)),
          h('div', {}, h('b', {}, `$${o.take.toLocaleString()}`), h('span', {}, 'take'))),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost', onclick: () => show(new ReplayScreen(this.heist)) }, '▶ Watch it'),
          h('button', { class: 'btn ghost', onclick: () => show(new PlanScreen(this.heist)) }, 'Plan'),
          nextLevel(this.heist.def)
            ? h('button', { class: 'btn big', onclick: () => show(new PlanScreen(new Heist(nextLevel(this.heist.def)))) }, 'Next heist →')
            : this.heist.def.procedural
              ? h('button', { class: 'btn big', onclick: () => newContract(this.heist.def.procedural.tier) }, 'New contract →')
              : h('button', { class: 'btn big', onclick: () => show(new MenuScreen()) }, 'All heists')));
    } else if (escaped) {
      card = h('div', { class: 'center-card' },
        h('div', { class: 'section-title' }, 'Take recorded'),
        h('h2', {}, `${ROLES[this.role].name} made it out`),
        h('div', { class: 'dim' }, o.kind === 'alarm' ? `But then: ${o.reason}.` : o.reason ?? ''),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost', onclick: () => { this.reset(); this.el.card.replaceChildren(); this.showStartCard(); } }, 'Redo take (R)'),
          h('button', { class: 'btn', onclick: () => show(new PlanScreen(this.heist)) }, 'Back to plan (Enter)')));
    } else {
      if (o.kind === 'alarm') audio.alarm();
      card = h('div', { class: `center-card ${o.kind === 'alarm' ? 'alarm' : ''}` },
        h('div', { class: 'section-title' }, `${fmtTime(o.t)} into the loop`),
        h('h2', {}, o.kind === 'alarm' ? 'ALARM' : 'Out of time'),
        h('div', {}, o.reason),
        h('div', { class: 'dim', style: 'font-size:.85rem' }, 'Hold Backspace to rewind and try that bit again.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { this.reset(); this.el.card.replaceChildren(); this.showStartCard(); } }, 'Restart take (R)'),
          h('button', { class: 'btn ghost', onclick: () => show(new PlanScreen(this.heist)) }, 'Back to plan (Esc)')));
    }
    this.el.card.replaceChildren(card);
  }
}

class ReplayScreen {
  constructor(heist) {
    this.heist = heist;
    // Precompute the whole loop with snapshots so scrubbing is instant.
    const sim = new Sim(heist.L, heist.crew);
    this.snaps = [sim.snapshot()];
    while (!sim.over) { sim.step(); if (sim.tick % 10 === 0) this.snaps.push(sim.snapshot()); }
    this.end = sim.tick;
    this.log = sim.S.log;
    this.over = sim.over;
    this.sim = new Sim(heist.L, heist.crew);
    this.playing = true;
    this.speed = 1;
    this.acc = 0;
    this.logCursor = 0;
  }
  mount() {
    const total = this.end;
    this.range = h('input', { type: 'range', min: 0, max: total, value: 0, oninput: (e) => { this.seek(+e.target.value); this.playing = false; this.syncButtons(); } });
    const marks = this.log.filter((e) => ['alarm', 'paradox', 'escape'].includes(e.k)).map((e) =>
      h('div', { class: 'mark', style: `left:${(e.t / Math.max(1, total)) * 100}%;background:${e.k === 'alarm' ? 'var(--red)' : e.k === 'paradox' ? 'var(--purple)' : 'var(--accent)'}` }));
    this.playBtn = h('button', { class: 'btn small', onclick: () => { this.playing = !this.playing; if (this.sim.tick >= this.end) this.seek(0); this.syncButtons(); } });
    this.speedBtn = h('button', { class: 'btn small ghost speed', onclick: () => { this.speed = { 0.5: 1, 1: 2, 2: 4, 4: 0.5 }[this.speed]; this.syncButtons(); } });
    this.clock = h('span', {}, '0:00');
    ui.append(h('div', { class: 'scrubber' }, this.playBtn, this.speedBtn, h('div', { class: 'track' }, this.range, ...marks), this.clock));

    this.feedRows = this.log.filter((e) => !['guard-door', 'whistle'].includes(e.k) || e.k === 'whistle').map((e) => {
      const row = h('div', { class: `ev ${eventClass(e)}`, onclick: () => { this.seek(Math.max(0, e.t - 20)); this.playing = true; this.syncButtons(); } },
        h('span', { class: 't' }, fmtTime(e.t)), h('span', {}, describeEvent(e, this.sim)));
      row.dataset.t = e.t;
      return row;
    });
    const o = this.over;
    ui.append(h('aside', { class: 'side' },
      h('header', {},
        h('div', { class: 'section-title' }, 'Replay'),
        h('h1', {}, this.heist.L.name),
        h('p', { class: 'brief' }, o.kind === 'success' ? `Clean getaway at ${fmtTime(o.t)}. $${o.take.toLocaleString()}.` : `${o.reason ?? o.kind}`)),
      h('div', { class: 'scroll' }, h('div', { class: 'section-title' }, 'Timeline'), h('div', { class: 'feed' }, ...this.feedRows)),
      h('footer', {},
        h('button', { class: 'btn ghost', onclick: () => show(new PlanScreen(this.heist)) }, '← Plan'),
        h('span', { class: 'dim', style: 'font-size:.8rem;align-self:center' }, 'Space play/pause · ←/→ step'))));
    this.syncButtons();
    this.unkey = input.onKey((e) => {
      if (e.code === 'Escape') show(new PlanScreen(this.heist));
      if (e.code === 'Space') { this.playing = !this.playing; this.syncButtons(); }
      if (e.code === 'ArrowRight') { this.seek(Math.min(this.end, this.sim.tick + 20)); }
      if (e.code === 'ArrowLeft') { this.seek(Math.max(0, this.sim.tick - 20)); }
    });
  }
  destroy() { this.unkey?.(); }
  syncButtons() {
    this.playBtn.textContent = this.playing ? '❚❚' : '▶';
    this.speedBtn.textContent = `${this.speed}×`;
  }
  seek(t) {
    const snap = this.snaps[Math.min(this.snaps.length - 1, Math.floor(t / 10))];
    this.sim.restore(snap);
    while (this.sim.tick < t && !this.sim.over) this.sim.step();
    this.logCursor = this.sim.S.log.length;
    R.prev = null; R.fx = [];
  }
  layout() { R.fit(this.heist.L, sideRect()); }
  frame(dt) {
    const sim = this.sim;
    if (this.playing && !sim.over) {
      this.acc += dt * this.speed;
      while (this.acc >= DT && !sim.over) {
        this.acc -= DT;
        R.capture(sim.S); sim.step();
        this.logCursor = R.collectEffects(sim.S, this.logCursor);
      }
    }
    if (sim.over || sim.tick >= this.end) { if (this.playing) { this.playing = false; this.syncButtons(); } }
    this.range.value = sim.tick;
    this.clock.textContent = fmtTime(sim.tick);
    for (const r of this.feedRows) r.classList.toggle('future', +r.dataset.t > sim.tick);
    R.draw(sim, { dt, alpha: this.playing ? Math.min(1, this.acc / DT) : 1, prompt: false });
  }
}

// ---------- mute ----------
const muteBtn = document.getElementById('mute');
const syncMute = () => { muteBtn.textContent = audio.muted ? '🔇' : '🔊'; muteBtn.title = `${audio.muted ? 'Unmute' : 'Mute'} (M)`; };
muteBtn.onclick = () => { audio.toggleMute(); syncMute(); muteBtn.blur(); };
addEventListener('keydown', (e) => { if (e.code === 'KeyM' && !e.repeat && !(e.target instanceof HTMLInputElement)) { audio.toggleMute(); syncMute(); } });
syncMute();

// ---------- main loop ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  screen?.frame(dt);
  requestAnimationFrame(loop);
}

// Debug/test hooks (used by browser tests).
window.loopHeist = {
  get screen() { return screen; },
  open(id) { const def = LEVELS.find((l) => l.id === id); show(new PlanScreen(new Heist(def))); },
  menu() { show(new MenuScreen()); },
  contract(seed, tier) { openContract(seed, tier); },
  store,
  input,
};

show(new MenuScreen());
requestAnimationFrame(loop);
