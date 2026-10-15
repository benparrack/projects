// Crux: pure logic (no DOM). Grades are stored as an index into the discipline's scale.
(function () {
  const SCALES = {
    boulder: { name: 'Bouldering (Font)', short: 'Font', grades: ['3', '4', '4+', '5', '5+', '6A', '6A+', '6B', '6B+', '6C', '6C+', '7A', '7A+', '7B', '7B+', '7C', '7C+', '8A', '8A+', '8B', '8B+', '8C'] },
    // Gyms that grade by tag colour instead of numbers, easiest first. shortcut: one fixed circuit, make it per-gym if a second gym differs.
    tags: { name: 'Bouldering (tags)', short: 'Tags', grades: ['Green', 'Blue', 'Red', 'Black', 'White', 'Gray'] },
    rope: { name: 'Routes (rope)', short: 'Rope', grades: ['3', '4a', '4b', '4c', '5a', '5b', '5c', '6a', '6a+', '6b', '6b+', '6c', '6c+', '7a', '7a+', '7b', '7b+', '7c', '7c+', '8a', '8a+', '8b', '8b+', '8c'] },
  };
  const gradeName = (disc, i) => SCALES[disc].grades[i] ?? '?';

  // One route's history across all logs: total tries, sent or not, and whether the first try went.
  function routeStatus(routeId, logs) {
    const mine = logs.filter(l => l.routeId === routeId).sort((a, b) => a.ts - b.ts);
    const firstSend = mine.find(l => l.sent);
    return {
      tries: mine.reduce((a, l) => a + l.tries, 0),
      sessions: new Set(mine.map(l => l.sessionId)).size,
      sent: !!firstSend,
      sentTs: firstSend ? firstSend.ts : null,
      flash: !!mine[0] && mine[0].sent && mine[0].tries === 1,
      // tries up to and including the first send
      triesToSend: firstSend ? mine.slice(0, mine.indexOf(firstSend) + 1).reduce((a, l) => a + l.tries, 0) : null,
      last: mine.length ? mine[mine.length - 1].ts : null,
    };
  }

  const projects = (routes, logs) => routes.filter(r => !r.archived && !routeStatus(r.id, logs).sent);

  // Sent routes per grade for one discipline (flashes split out), from the highest to the lowest grade climbed.
  function pyramid(routes, logs, disc) {
    const counts = {}, flashes = {};
    for (const r of routes) {
      const st = r.disc === disc && routeStatus(r.id, logs);
      if (!st || !st.sent) continue;
      counts[r.grade] = (counts[r.grade] || 0) + 1;
      if (st.flash) flashes[r.grade] = (flashes[r.grade] || 0) + 1;
    }
    const gs = Object.keys(counts).map(Number);
    if (!gs.length) return [];
    const out = [];
    for (let g = Math.max(...gs); g >= Math.min(...gs); g--) out.push({ grade: g, label: gradeName(disc, g), n: counts[g] || 0, flash: flashes[g] || 0 });
    return out;
  }

  // routeId -> the log where it was first sent.
  function firstSends(logs) {
    const m = new Map();
    for (const l of [...logs].sort((a, b) => a.ts - b.ts)) if (l.sent && !m.has(l.routeId)) m.set(l.routeId, l);
    return m;
  }

  // Hardest grade sent in each session (first sends only), oldest first, for one discipline.
  function hardestBySession(sessions, routes, logs, disc) {
    const byId = Object.fromEntries(routes.map(r => [r.id, r])), fs = firstSends(logs);
    return [...sessions].sort((a, b) => a.start - b.start).map(s => {
      let best = null;
      for (const l of fs.values()) {
        const r = byId[l.routeId];
        if (l.sessionId === s.id && r && r.disc === disc && (best === null || r.grade > best)) best = r.grade;
      }
      return { start: s.start, grade: best };
    }).filter(p => p.grade !== null);
  }

  // Grades this session beat your previous hardest send at (per discipline). Needs an earlier send to beat.
  function personalBests(session, routes, logs) {
    const byId = Object.fromEntries(routes.map(r => [r.id, r])), before = {}, now = {};
    for (const l of firstSends(logs).values()) {
      const r = byId[l.routeId]; if (!r) continue;
      const into = l.sessionId === session.id ? now : l.ts < session.start ? before : null;
      if (into && !(into[r.disc] >= r.grade)) into[r.disc] = r.grade;
    }
    return Object.keys(SCALES).filter(d => d in now && d in before && now[d] > before[d])
      .map(d => ({ disc: d, grade: now[d], label: gradeName(d, now[d]), prev: gradeName(d, before[d]) }));
  }

  // Sessions per week (weeks start Monday), the last n weeks up to and including the one holding `now`.
  function weekly(sessions, now, n = 12) {
    const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    const weeks = [];
    for (let i = n - 1; i >= 0; i--) { const s = new Date(d); s.setDate(d.getDate() - 7 * i); weeks.push({ start: s.getTime(), n: 0 }); }
    for (const s of sessions) { const i = weeks.findLastIndex(w => s.start >= w.start); if (i >= 0) weeks[i].n++; }
    return weeks;
  }

  function summary(routes, logs, disc) {
    const mine = routes.filter(r => r.disc === disc).map(r => ({ r, st: routeStatus(r.id, logs) }));
    const sent = mine.filter(x => x.st.sent);
    return {
      sends: sent.length,
      flashes: sent.filter(x => x.st.flash).length,
      flashRate: sent.length ? sent.filter(x => x.st.flash).length / sent.length : 0,
      hardest: sent.length ? Math.max(...sent.map(x => x.r.grade)) : null,
      projects: mine.filter(x => !x.st.sent && !x.r.archived).length,
    };
  }

  function sessionSummary(session, routes, logs) {
    const byId = Object.fromEntries(routes.map(r => [r.id, r]));
    const mine = logs.filter(l => l.sessionId === session.id);
    const sends = mine.filter(l => l.sent);
    const best = {}; // per discipline, since the two scales don't compare
    for (const l of sends) {
      const r = byId[l.routeId];
      if (r && !(best[r.disc] >= r.grade)) best[r.disc] = r.grade;
    }
    const fs = firstSends(logs);
    return { climbs: mine.length, tries: mine.reduce((a, l) => a + l.tries, 0), sends: sends.length,
      flashes: sends.filter(l => fs.get(l.routeId) === l && routeStatus(l.routeId, logs).flash).length,
      hardest: Object.keys(SCALES).filter(d => d in best).map(d => gradeName(d, best[d])).join(' · ') || null,
      minutes: session.end ? Math.round((session.end - session.start) / 60000) : null };
  }

  window.Logic = { SCALES, gradeName, routeStatus, projects, pyramid, hardestBySession, personalBests, weekly, summary, sessionSummary };
})();
