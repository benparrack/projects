// Paintball (GamePigeon style) — shared shooting-gallery model. Loaded by the browser as a plain
// <script> (window.PaintballSim) and by the server with require() (server/games/paintball.js), so
// a run scores the same for the shooter's instant local feedback, the authoritative server, the
// spectators' replay and the bots' planning.
//
// The gallery is a fixed 800 x 500 logical stage with three lanes (back / mid / front), each a
// barricade that cardboard targets rise from behind or slide along. A run's target schedule is a
// pure function of a seed, so both players face exactly the same run. A run is a list of events
// { type: 'shot', t, x, y } / { type: 'reload', t } (t = ms since the run started); applyEvent()
// enforces the paint-gun rules (clip, reload time, max fire rate, monotonic time) and scores hits.

(function (root) {
  'use strict';

  const W = 800;
  const H = 500;
  const RUN_MS = 45000;
  const CLIP = 8;
  const RELOAD_MS = 1000;
  const FIRE_MIN_MS = 120; // ~8 shots/s at most: anything faster is rejected
  const RISE_MS = 170; // pop-up / drop-down time
  const MAX_EVENTS = 600;

  // y = barricade top edge (targets are only visible above it), barH = barricade height.
  const LANES = [
    { top: 225, barH: 40, scale: 0.62 },
    { top: 330, barH: 50, scale: 0.8 },
    { top: 432, barH: 68, scale: 1 },
  ];
  const BASE_H = 118;
  const BASE_W = 64;
  const POINTS = { pop: [200, 150, 100], slideBonus: 100, head: 50, civ: -300, gold: 500 };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sizeOf(tg) {
    const s = LANES[tg.lane].scale;
    if (tg.kind === 'gold') return { h: 74 * s, w: 40 * s };
    return { h: BASE_H * s, w: BASE_W * s };
  }

  // ---- schedule ----------------------------------------------------------------------------------
  // Each target: { id, kind: 'bad'|'civ'|'gold', lane, move: 'pop'|'slide', t0, t1, x0, x1 }.
  // Pop-ups stand at x0, rise over RISE_MS from t0 and are fully down again at t1. Sliders ride a
  // rail fully raised from x0 (off one edge) to x1 (off the other) between t0 and t1.
  function makeSchedule(seed) {
    const rand = mulberry32(seed);
    const out = [];
    let id = 0;
    const between = (a, b) => a + rand() * (b - a);
    const overlapsPop = (lane, x, t0, t1, w) => out.some((o) => o.lane === lane && o.move === 'pop'
      && o.t0 < t1 + 120 && t0 < o.t1 + 120 && Math.abs(o.x0 - x) < w + 14);
    const laneSliding = (lane, t0, t1) => out.some((o) => o.lane === lane && o.move === 'slide' && o.t0 < t1 && t0 < o.t1);

    function addPop(lane, t0, stay, kind) {
      const w = BASE_W * LANES[lane].scale;
      const t1 = Math.round(t0 + RISE_MS * 2 + stay);
      for (let tries = 0; tries < 12; tries++) {
        const slot = Math.floor(rand() * 6);
        const x = Math.round(90 + slot * 124 + between(-18, 18));
        if (!overlapsPop(lane, x, t0, t1, w)) {
          out.push({ id: id++, kind, lane, move: 'pop', t0: Math.round(t0), t1, x0: x, x1: x });
          return true;
        }
      }
      return false;
    }
    function addSlide(lane, t0, speed, kind) {
      const { w } = sizeOf({ lane, kind });
      const dir = rand() < 0.5 ? 1 : -1;
      const x0 = dir > 0 ? -w : W + w;
      const x1 = dir > 0 ? W + w : -w;
      const t1 = Math.round(t0 + (Math.abs(x1 - x0) / speed) * 1000);
      if (laneSliding(lane, t0 - 300, t1 + 300)) return false;
      out.push({ id: id++, kind, lane, move: 'slide', t0: Math.round(t0), t1, x0, x1 });
      return true;
    }

    let t = 1200;
    while (t < RUN_MS - 3800) {
      const p = t / RUN_MS; // 0 -> 1 over the run: things get quicker and busier
      const stay = () => between(1250, 1850) - p * 650;
      const speed = (lane) => (between(150, 210) + p * 140) * (0.75 + LANES[lane].scale * 0.35);
      const civ = (pr) => (rand() < pr ? 'civ' : 'bad');
      const r = rand();
      let made = 0;
      if (r < 0.42) {
        // a row of pop-ups in one lane, staggered
        const lane = Math.floor(rand() * 3);
        const n = 2 + Math.floor(rand() * (2 + p * 1.6));
        for (let i = 0; i < n; i++) {
          const kind = i === 0 ? 'bad' : civ(0.38);
          if (addPop(lane, t + i * between(80, 420), stay(), kind)) made++;
        }
      } else if (r < 0.7) {
        // sliders on different lanes
        const lanes = [0, 1, 2].sort(() => rand() - 0.5);
        const n = 1 + Math.floor(rand() * (1.6 + p * 1.2));
        for (let i = 0; i < n; i++) {
          if (addSlide(lanes[i], t + i * between(150, 700), speed(lanes[i]), i === 0 ? 'bad' : civ(0.38))) made++;
        }
      } else {
        // mixed: one slider plus pop-ups in the other lanes
        const sl = Math.floor(rand() * 3);
        if (addSlide(sl, t, speed(sl), civ(0.3))) made++;
        for (let l = 0; l < 3; l++) {
          if (l === sl || rand() < 0.3) continue;
          if (addPop(l, t + between(200, 900), stay(), made ? civ(0.38) : 'bad')) made++;
        }
      }
      t += between(2200, 2900) - p * 700 + (made ? 0 : -1200);
    }
    // three golden stars zipping along the back rail
    for (const at of [between(9000, 13000), between(21000, 26000), between(32000, 38000)]) {
      const sp = between(340, 420);
      // retry later / on the mid rail if a slider already occupies the back rail
      for (let k = 0; k < 8 && !addSlide(k % 2, at + k * 450, sp, 'gold'); k++);
    }
    out.sort((a, b) => a.t0 - b.t0 || a.id - b.id);
    return out;
  }

  // ---- geometry ----------------------------------------------------------------------------------
  // Pose of a target at time t, ignoring hits: { x, raise (0..1), bottom, top, h, w } or null.
  function pose(tg, t) {
    if (t < tg.t0 || t > tg.t1) return null;
    const lane = LANES[tg.lane];
    const { h, w } = sizeOf(tg);
    let raise = 1;
    let x = tg.x0;
    if (tg.move === 'pop') raise = clamp(Math.min((t - tg.t0) / RISE_MS, (tg.t1 - t) / RISE_MS), 0, 1);
    else x = tg.x0 + ((tg.x1 - tg.x0) * (t - tg.t0)) / Math.max(1, tg.t1 - tg.t0);
    const bottom = lane.top + 10 * lane.scale + (1 - raise) * (h + 4);
    return { x, raise, bottom, top: bottom - h, h, w };
  }

  // Which zone of a target (at pose p) the point hits: 'head', 'body' or null.
  function zoneAt(tg, p, x, y) {
    if (y >= LANES[tg.lane].top) return null; // hidden behind its barricade
    if (tg.kind === 'gold') {
      const r = p.w * 0.5;
      return Math.hypot(x - p.x, y - (p.top + r)) <= r * 1.12 ? 'body' : null;
    }
    const hr = p.h * 0.17;
    if (Math.hypot(x - p.x, y - (p.top + p.h * 0.18)) <= hr) return 'head';
    if (y >= p.top + p.h * 0.33 && y <= p.bottom && Math.abs(x - p.x) <= p.w / 2) return 'body';
    return null;
  }

  function valueOf(tg, zone) {
    if (tg.kind === 'civ') return POINTS.civ;
    if (tg.kind === 'gold') return POINTS.gold;
    return POINTS.pop[tg.lane] + (tg.move === 'slide' ? POINTS.slideBonus : 0) + (zone === 'head' ? POINTS.head : 0);
  }

  // First target hit by a shot at (x, y) at time t: front lane first, later targets on top within a
  // lane. `hit` is the set/map of already-hit target ids (they're falling and can't be hit again).
  function hitTest(schedule, t, x, y, hit) {
    let best = null;
    for (const tg of schedule) {
      if (tg.t0 > t) break; // sorted by t0
      if (t > tg.t1 || (hit && hit.has(tg.id))) continue;
      const p = pose(tg, t);
      if (!p) continue;
      const zone = zoneAt(tg, p, x, y);
      if (!zone) continue;
      if (!best || tg.lane > best.tg.lane || (tg.lane === best.tg.lane && tg.id > best.tg.id)) best = { tg, p, zone };
    }
    if (!best) return null;
    return {
      id: best.tg.id, kind: best.tg.kind, head: best.zone === 'head', pts: valueOf(best.tg, best.zone),
      dx: x - best.p.x, dy: y - best.p.bottom,
    };
  }

  // ---- runs --------------------------------------------------------------------------------------
  function newRun(seed, schedule) {
    return {
      seed, schedule: schedule || makeSchedule(seed),
      ammo: CLIP, reloadEnd: 0, lastShot: -1e9, lastT: 0, count: 0,
      hit: new Map(), // id -> { t, dx, dy, pts, head, kind }
      score: 0,
      stats: { shots: 0, hits: 0, heads: 0, civs: 0, golds: 0, reloads: 0 },
    };
  }

  function settle(run, t) {
    if (run.reloadEnd && t >= run.reloadEnd) {
      run.ammo = CLIP;
      run.reloadEnd = 0;
    }
  }
  // Ammo / reload status at time t without changing the run.
  function gunAt(run, t) {
    if (run.reloadEnd && t >= run.reloadEnd) return { ammo: CLIP, reloading: false, reloadEnd: 0 };
    return { ammo: run.ammo, reloading: !!run.reloadEnd, reloadEnd: run.reloadEnd };
  }

  function normEvent(ev) {
    if (!ev || (ev.type !== 'shot' && ev.type !== 'reload')) return null;
    const t = Number(ev.t);
    if (!Number.isFinite(t)) return null;
    const out = { type: ev.type, t: Math.round(t) };
    if (ev.type === 'shot') {
      const x = Number(ev.x);
      const y = Number(ev.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      out.x = Math.round(clamp(x, 0, W) * 10) / 10;
      out.y = Math.round(clamp(y, 0, H) * 10) / 10;
    }
    return out;
  }

  // Validate + apply one event. Returns { ok: true, ev, res } (res = hit record or null for a shot)
  // or { ok: false, reason }.
  function applyEvent(run, raw) {
    const ev = normEvent(raw);
    if (!ev) return { ok: false, reason: 'invalid' };
    if (ev.t < 0 || ev.t > RUN_MS) return { ok: false, reason: 'time_up' };
    if (ev.t < run.lastT) return { ok: false, reason: 'bad_time' };
    if (run.count >= MAX_EVENTS) return { ok: false, reason: 'too_many' };
    settle(run, ev.t);
    if (ev.type === 'reload') {
      if (run.reloadEnd) return { ok: false, reason: 'reloading' };
      if (run.ammo >= CLIP) return { ok: false, reason: 'full' };
      run.ammo = 0;
      run.reloadEnd = ev.t + RELOAD_MS;
      run.stats.reloads++;
      run.lastT = ev.t;
      run.count++;
      return { ok: true, ev, res: null };
    }
    if (run.reloadEnd) return { ok: false, reason: 'reloading' };
    if (run.ammo <= 0) return { ok: false, reason: 'empty' };
    if (ev.t - run.lastShot < FIRE_MIN_MS) return { ok: false, reason: 'too_fast' };
    run.ammo--;
    run.lastShot = ev.t;
    run.lastT = ev.t;
    run.count++;
    run.stats.shots++;
    const res = hitTest(run.schedule, ev.t, ev.x, ev.y, run.hit);
    if (res) {
      run.hit.set(res.id, { t: ev.t, ...res });
      run.score += res.pts;
      if (res.kind === 'civ') run.stats.civs++;
      else {
        run.stats.hits++;
        if (res.head) run.stats.heads++;
        if (res.kind === 'gold') run.stats.golds++;
      }
    }
    return { ok: true, ev, res };
  }

  // ---- bots --------------------------------------------------------------------------------------
  // rt = reaction time to a newly visible target, gap = time to swing to the next target, sigma =
  // aim scatter (px), lead = how badly moving targets are led, notice = chance a target is seen at
  // all, civ = chance of blasting a civilian, headAim = how often it goes for the +50 head shot.
  const BOT = {
    easy: { rt: 720, gap: 430, sigma: 20, lead: 0.11, notice: 0.62, civ: 0.3, headAim: 0, tactical: false },
    medium: { rt: 520, gap: 310, sigma: 12, lead: 0.07, notice: 0.8, civ: 0.14, headAim: 0.1, tactical: false },
    hard: { rt: 360, gap: 210, sigma: 7, lead: 0.035, notice: 0.93, civ: 0.05, headAim: 0.3, tactical: true },
    expert: { rt: 250, gap: 150, sigma: 3.5, lead: 0.012, notice: 1, civ: 0, headAim: 0.55, tactical: true },
  };
  function gauss(rand) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  // Window [from, until] in which a target is comfortably shootable (mostly raised & on screen).
  function shootWindow(tg) {
    if (tg.move === 'pop') return { from: tg.t0 + RISE_MS * 0.7, until: tg.t1 - RISE_MS * 0.9 };
    const { w } = sizeOf(tg);
    const span = Math.abs(tg.x1 - tg.x0);
    const dur = tg.t1 - tg.t0;
    const inAt = ((w * 1.2) / span) * dur;
    return { from: tg.t0 + inAt, until: tg.t1 - inAt };
  }

  // Plans a whole run for a bot: the list of events it will fire, already validated against the
  // gun rules (the server still replays them through applyEvent as they come due).
  function botPlan(seed, level, rand) {
    rand = rand || Math.random;
    const L = BOT[level] || BOT.hard;
    const run = newRun(seed);
    const events = [];
    const wants = new Map(); // id -> { tries, rt }
    for (const tg of run.schedule) {
      const seen = rand() < L.notice;
      const blast = tg.kind === 'civ' && rand() < L.civ;
      if ((tg.kind !== 'civ' && seen) || blast) wants.set(tg.id, { tries: 0, rt: L.rt * (0.75 + rand() * 0.5), max: tg.kind === 'civ' ? 1 : 2 });
    }
    const win = new Map(run.schedule.map((tg) => [tg.id, shootWindow(tg)]));
    let tCur = 250;
    const fire = (ev) => {
      const r = applyEvent(run, ev);
      if (r.ok) events.push(r.ev);
      return r;
    };
    for (let guard = 0; guard < 2000 && tCur < RUN_MS; guard++) {
      settle(run, tCur);
      if (run.reloadEnd) { tCur = run.reloadEnd; continue; }
      let pick = null;
      let pickT = Infinity;
      let nextVisible = Infinity;
      for (const tg of run.schedule) {
        const wnt = wants.get(tg.id);
        if (!wnt || wnt.tries >= wnt.max || run.hit.has(tg.id)) continue;
        const w = win.get(tg.id);
        const te = Math.max(tCur, wnt.tries ? tCur : w.from + wnt.rt);
        if (te > w.until) continue;
        if (te > tCur) nextVisible = Math.min(nextVisible, te);
        if (te < pickT || (te === pickT && pick && valueOf(tg, 'body') > valueOf(pick, 'body'))) { pick = tg; pickT = te; }
      }
      if (!pick || pickT > tCur + 40) {
        // nothing to shoot right now: top up the clip if it's low, then wait for the next target
        if (L.tactical && run.ammo <= CLIP / 2 && run.ammo < CLIP && (!pick || pickT - tCur > RELOAD_MS + 150)) {
          fire({ type: 'reload', t: tCur });
          continue;
        }
        if (!pick) {
          if (nextVisible === Infinity) break;
          tCur = nextVisible;
        } else tCur = pickT;
        continue;
      }
      if (run.ammo <= 0) {
        fire({ type: 'reload', t: tCur });
        continue;
      }
      const t = Math.max(Math.ceil(pickT), run.lastShot + FIRE_MIN_MS);
      const p = pose(pick, t);
      if (!p) { wants.get(pick.id).tries = 9; continue; }
      const vx = pick.move === 'slide' ? ((pick.x1 - pick.x0) / (pick.t1 - pick.t0)) * 1000 : 0;
      const head = pick.kind === 'bad' && rand() < L.headAim;
      const ay = pick.kind === 'gold' ? p.top + p.w * 0.5 : head ? p.top + p.h * 0.18 : p.top + p.h * 0.62;
      const sc = LANES[pick.lane].scale;
      const x = p.x + gauss(rand) * L.sigma * sc + vx * gauss(rand) * L.lead;
      const y = Math.min(ay + gauss(rand) * L.sigma * sc, LANES[pick.lane].top - 2);
      wants.get(pick.id).tries++;
      fire({ type: 'shot', t, x, y });
      tCur = t + L.gap * (0.8 + rand() * 0.4);
    }
    return events;
  }

  // Replays a list of events from scratch (invalid ones skipped).
  function replay(seed, events, schedule) {
    const run = newRun(seed, schedule);
    for (const ev of events) applyEvent(run, ev);
    return run;
  }

  const api = {
    W, H, RUN_MS, CLIP, RELOAD_MS, FIRE_MIN_MS, RISE_MS, MAX_EVENTS, LANES, POINTS, BOT_LEVELS: Object.keys(BOT),
    mulberry32, makeSchedule, sizeOf, pose, zoneAt, valueOf, hitTest, newRun, gunAt, normEvent, applyEvent,
    botPlan, replay, shootWindow,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PaintballSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
