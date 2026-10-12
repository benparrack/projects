// Pure logic shared by the app and test.js (no DOM).
(function (root) {
  const DAY = 864e5, TAU = Math.PI * 2;
  const RUN_DAYS = 7;

  // The skill currently being learned: the latest run, if its 7 days aren't up and it wasn't ended.
  function currentRun(runs, now) {
    const r = runs[runs.length - 1];
    return r && r.status === 'active' && now < r.start + RUN_DAYS * DAY ? r : null;
  }

  // 0-based plan day for a run (clamped to the 7-day plan).
  function dayIndex(run, now) {
    const d0 = new Date(run.start); d0.setHours(0, 0, 0, 0);
    return Math.max(0, Math.min(RUN_DAYS - 1, Math.floor((now - d0) / DAY)));
  }

  // Skills eligible for the wheel given settings and history.
  function buildPool(skills, runs, s) {
    const learned = new Set(runs.filter(r => r.status === 'done').map(r => r.id));
    const last = runs.length ? runs[runs.length - 1].id : null;
    return skills.filter(k =>
      s.cats[k.cat] !== false &&
      !(s.excluded || []).includes(k.id) &&
      (!s.quickOnly || k.wk[1] <= 2) &&
      (!s.freeOnly || k.cost === 0) &&
      (s.allowRepeats || !learned.has(k.id)) &&
      k.id !== last);
  }

  // Round-robin by category so neighbouring segments differ in colour.
  function interleave(skills) {
    const groups = {};
    skills.forEach(k => (groups[k.cat] = groups[k.cat] || []).push(k));
    const lists = Object.values(groups).sort((a, b) => b.length - a.length);
    const out = [];
    for (let i = 0; out.length < skills.length; i++)
      lists.forEach(l => { if (l[i]) out.push(l[i]); });
    // Wrap-around neighbours can still match; rotate a tail item in if so.
    if (out.length > 2 && out[0].cat === out[out.length - 1].cat) {
      const j = out.findIndex((k, i) => i > 0 && i < out.length - 1 && k.cat !== out[0].cat &&
        out[i - 1].cat !== out[out.length - 1].cat && out[i + 1].cat !== out[out.length - 1].cat);
      if (j > 0) out.push(out.splice(j, 1)[0]);
    }
    return out;
  }

  // Segment i spans [i*seg, (i+1)*seg) clockwise from 12 o'clock at rotation 0.
  // The pointer sits at 12 o'clock, so after rotating by `rot` it reads angle -rot.
  function indexAt(rot, n) {
    const a = ((-rot % TAU) + TAU) % TAU;
    return Math.floor(a / (TAU / n)) % n;
  }

  // Spin curve: position eases out cubically, so speed decays smoothly to zero.
  const ease = x => 1 - Math.pow(1 - x, 3);

  // Consecutive completed runs, newest first; the run still in progress doesn't break it.
  function streak(runs, now) {
    let n = 0;
    for (let i = runs.length - 1; i >= 0; i--) {
      if (runs[i].status === 'done') n++;
      else if (!(i === runs.length - 1 && currentRun(runs, now))) break;
    }
    return n;
  }

  root.Logic = { DAY, TAU, RUN_DAYS, currentRun, dayIndex, buildPool, interleave, indexAt, ease, streak };
})(typeof window !== 'undefined' ? window : globalThis);
