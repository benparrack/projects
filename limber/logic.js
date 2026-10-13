// Pure logic shared by the app and test.js (no DOM).
(function (root) {
  const DAY = 864e5;

  const MODES = {
    mat: { name: 'Mat session', short: 'Mat', spot: 'mat', blurb: 'A proper floor session: warm-up, deep holds, cool-down.',
      minutes: [10, 20, 30], def: 20, warm: 2, cool: true, prep: 10, maxMain: { 10: 7, 20: 11, 30: 16 } },
    couch: { name: 'Couch mode', short: 'Couch', spot: 'bed', blurb: 'Long, lazy holds on the bed or sofa. Put an episode on.',
      minutes: [10, 20, 40], def: 20, warm: 0, holdMul: 1.5, minHold: 60, prep: 12, maxMain: { 10: 6, 20: 9, 40: 13 } },
    quick: { name: 'Quick reset', short: 'Quick', spot: 'stand', blurb: 'Standing only, anywhere. No floor, no mat.',
      minutes: [5, 10], def: 5, warm: 1, prep: 6, maxMain: { 5: 4, 10: 8 } },
  };

  // The program: holds get longer as you rack up days stretched (not calendar days, so a missed week doesn't skip you ahead).
  const PHASES = [
    { name: 'Foundations', from: 0, hold: 30, note: 'Learn the shapes and find your edge. Ease in; never bounce or force.' },
    { name: 'Build', from: 7, hold: 45, note: 'Longer holds. Breathe out and let each one go a little deeper.' },
    { name: 'Deepen', from: 21, hold: 60, note: 'Minute-long holds, which is where real range comes from. Deep stretches show up more.' },
    { name: 'Own it', from: 42, hold: 75, note: 'You\'re a stretcher now. Long holds, and keep the streak going.' },
  ];
  const WARM_SEC = 30, SWITCH_SEC = 5;
  const POS_ORDER = { stand: 0, kneel: 1, sit: 2, lie: 3 };
  const COOLDOWNS = ['childs-pose', 'legs-up-wall', 'reclined-butterfly'];
  const DEFAULT_FOCUS = { adductors: 3, abductors: 3, hamstrings: 2, hipflexors: 2, glutes: 2, quads: 1, calves: 1, back: 1 };

  // ---------- dates (local calendar days as 'YYYY-MM-DD') ----------
  const pad = n => String(n).padStart(2, '0');
  const dayKey = (d = new Date()) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return dayKey(d); };
  const daysBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / DAY);

  // ---------- seeded randomness, so today's routine stays the same until you shuffle ----------
  function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ---------- streaks ----------
  // days: Set of day keys with a session. A streak is still alive if yesterday was done and today isn't yet.
  function streak(days, today) {
    const doneToday = days.has(today);
    let cur = 0, k = doneToday ? today : addDays(today, -1);
    while (days.has(k)) { cur++; k = addDays(k, -1); }
    let best = 0, run = 0, prev = null;
    for (const d of [...days].sort()) { run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
    return { current: cur, best, doneToday, atRisk: !doneToday && cur > 0 };
  }

  // Monday-first week containing `today`.
  function week(days, today) {
    const dow = (fromKey(today).getDay() + 6) % 7, start = addDays(today, -dow);
    return Array.from({ length: 7 }, (_, i) => {
      const k = addDays(start, i);
      return { key: k, done: days.has(k), today: k === today, future: k > today };
    });
  }

  // ---------- program ----------
  function phaseFor(daysDone) {
    let i = 0; while (i < PHASES.length - 1 && daysDone >= PHASES[i + 1].from) i++;
    const p = PHASES[i], next = PHASES[i + 1];
    return { ...p, index: i, next: next || null, toNext: next ? next.from - daysDone : 0,
      progress: next ? (daysDone - p.from) / (next.from - p.from) : 1 };
  }

  function holdFor(s, phase, mode) {
    if (s.kind === 'warm') return WARM_SEC;
    let h = Math.max(MODES[mode].minHold || 0, phase.hold * (MODES[mode].holdMul || 1));
    if (s.long) h *= 1.5;
    if (mode === 'quick') h = Math.min(h, 45);
    return Math.min(180, Math.round(h / 15) * 15);
  }

  const itemSeconds = (it, mode) => MODES[mode].prep + it.hold * it.sides + (it.sides - 1) * SWITCH_SEC;
  const totalSeconds = (items, mode) => items.reduce((t, it) => t + itemSeconds(it, mode), 0);

  // ---------- routine builder ----------
  // opts: { mode, minutes, focus, last: {id: dayKey}, excluded: [ids], today, daysDone, salt }
  function buildRoutine(lib, opts) {
    const mode = MODES[opts.mode], phase = phaseFor(opts.daysDone || 0);
    const focus = { ...DEFAULT_FOCUS, ...(opts.focus || {}) }, excluded = new Set(opts.excluded || []);
    const rand = rng(hash(`${opts.today}|${opts.mode}|${opts.minutes}|${opts.salt || 0}`));
    const budget = opts.minutes * 60;
    const pool = lib.filter(s => s.spots.includes(mode.spot) && !excluded.has(s.id));
    // Short sessions cap the hold so long-phase holds don't squeeze a routine down to two stretches.
    const cap = Math.max(30, Math.floor(budget / (opts.minutes <= 10 ? 5 : 7) / 1.6 / 15) * 15);
    const mk = s => ({ id: s.id, hold: Math.min(cap, holdFor(s, phase, opts.mode)), sides: s.sides ? 2 : 1 });
    const fresh = s => { const l = opts.last && opts.last[s.id]; return l ? Math.min(7, daysBetween(l, opts.today)) : 7; };
    const weight = { ...focus };
    const score = s => {
      const f = s.areas.reduce((t, a, i) => t + (weight[a] || 0) * (i === 0 ? 1 : 0.4), 0);
      const effort = phase.index === 0 && s.effort === 3 ? 0.5 : 1; // go easy on the deep ones at first
      return f * (0.55 + fresh(s) * 0.07) * effort * (0.7 + rand() * 0.6);
    };

    // warm-ups first
    const warm = pool.filter(s => s.kind === 'warm').map(s => [score(s), s]).sort((a, b) => b[0] - a[0])
      .slice(0, mode.warm).map(([, s]) => mk(s));
    // a cool-down to finish a mat session
    let cool = null;
    if (mode.cool) {
      const c = COOLDOWNS.map(id => pool.find(s => s.id === id)).filter(Boolean);
      if (c.length) cool = mk(c[Math.floor(rand() * c.length)]);
    }
    let used = totalSeconds(warm, opts.mode) + (cool ? itemSeconds(cool, opts.mode) : 0);
    const taken = new Set([...warm, ...(cool ? [cool] : [])].map(i => i.id));
    const main = [];
    const holds = pool.filter(s => s.kind === 'hold' && !taken.has(s.id));
    while (holds.length && main.length < (mode.maxMain[opts.minutes] || 10)) {
      const ranked = holds.map(s => [score(s), s]).sort((a, b) => b[0] - a[0]);
      const pick = ranked.find(([, s]) => used + itemSeconds(mk(s), opts.mode) <= budget + 20);
      if (!pick) break;
      const s = pick[1], it = mk(s);
      main.push({ it, s }); used += itemSeconds(it, opts.mode);
      holds.splice(holds.indexOf(s), 1);
      for (const [i, a] of s.areas.entries()) weight[a] *= i === 0 ? 0.55 : 0.8; // spread the session across areas
    }
    // Time left over goes into longer holds on your focus areas, rather than yet more different stretches.
    // Your top-focus areas grow first, then everything, within limits that rise with your phase.
    const top = Math.max(...Object.values(focus));
    const base = Math.max(mode.minHold || 0, phase.hold * (mode.holdMul || 1));
    for (const [only, cap] of [[top, Math.min(150, base * 2.5)], [0, Math.min(180, base * 3)]]) {
      for (let grew = true; grew;) {
        grew = false;
        for (const { it, s } of main) {
          const extra = 15 * it.sides;
          if ((focus[s.areas[0]] || 0) >= only && it.hold < cap && used + extra <= budget + 20) { it.hold += 15; used += extra; grew = true; }
        }
      }
    }
    // group by body position so you're not up and down every stretch
    main.sort((a, b) => POS_ORDER[a.s.pos] - POS_ORDER[b.s.pos]);
    return [...warm, ...main.map(m => m.it), ...(cool ? [cool] : [])];
  }

  // Alternatives for one slot: same mode, not already in the routine, sharing its main area first.
  function swapOptions(lib, routine, index, opts) {
    const cur = lib.find(s => s.id === routine[index].id), mode = MODES[opts.mode];
    const inUse = new Set(routine.map(r => r.id)), excluded = new Set(opts.excluded || []);
    return lib.filter(s => s.kind === cur.kind && s.spots.includes(mode.spot) && !inUse.has(s.id) && !excluded.has(s.id))
      .sort((a, b) => (b.areas.includes(cur.areas[0]) - a.areas.includes(cur.areas[0])) || a.name.localeCompare(b.name));
  }

  // The play-through as a flat list of timed steps: prep -> hold (-> switch -> hold).
  function steps(items, mode) {
    const out = [];
    items.forEach((it, i) => {
      out.push({ type: 'prep', item: i, side: it.sides > 1 ? 1 : 0, sec: MODES[mode].prep });
      for (let side = 1; side <= it.sides; side++) {
        if (side > 1) out.push({ type: 'switch', item: i, side, sec: SWITCH_SEC });
        out.push({ type: 'hold', item: i, side: it.sides > 1 ? side : 0, sec: it.hold });
      }
    });
    return out;
  }

  // ---------- stats ----------
  const sessionDays = sessions => new Set(sessions.map(s => s.date));

  // Seconds spent per area over the last `n` days (primary area gets full credit, others half).
  function areaSeconds(sessions, lib, today, n = 14) {
    const out = {}, from = addDays(today, -(n - 1)), byId = Object.fromEntries(lib.map(s => [s.id, s]));
    for (const ses of sessions) {
      if (ses.date < from) continue;
      for (const it of ses.items || []) {
        const s = byId[it.id]; if (!s) continue;
        s.areas.forEach((a, i) => { out[a] = (out[a] || 0) + it.sec * (i === 0 ? 1 : 0.5); });
      }
    }
    return out;
  }

  // Trend for one check-in measure: first vs latest, and whether that's an improvement.
  function trend(checks, key, higherIsBetter) {
    const pts = checks.filter(c => typeof c[key] === 'number').sort((a, b) => a.date < b.date ? -1 : 1);
    if (!pts.length) return null;
    const first = pts[0][key], last = pts[pts.length - 1][key], delta = +(last - first).toFixed(1);
    return { pts: pts.map(c => ({ date: c.date, v: c[key] })), first, last, delta,
      improved: pts.length > 1 && (higherIsBetter ? delta > 0 : delta < 0) };
  }

  const fmtTime = sec => { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${pad(s)}`; };
  const fmtMin = sec => { const m = Math.round(sec / 60); return m < 1 ? '<1 min' : `${m} min`; };

  root.Logic = { DAY, MODES, PHASES, WARM_SEC, SWITCH_SEC, DEFAULT_FOCUS, dayKey, fromKey, addDays, daysBetween, hash, rng,
    streak, week, phaseFor, holdFor, itemSeconds, totalSeconds, buildRoutine, swapOptions, steps, sessionDays,
    areaSeconds, trend, fmtTime, fmtMin };
})(typeof window !== 'undefined' ? window : globalThis);
