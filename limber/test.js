// Run: node test.js — checks the stretch data and the routine/streak/program logic.
const assert = require('assert');
global.window = globalThis;
require('./stretches.js'); require('./figure.js'); require('./logic.js');
const L = Logic;

// Data: every stretch complete and well-formed.
const ids = new Set(), SPOTS = ['mat', 'bed', 'stand'], POS = ['stand', 'kneel', 'sit', 'lie'];
for (const s of STRETCHES) {
  assert(!ids.has(s.id), 'duplicate id ' + s.id); ids.add(s.id);
  assert(s.name, s.id + ' name');
  for (const f of ['cue', 'feel', 'avoid', 'easier', 'harder']) assert(s[f] && s[f].length > 8, `${s.id} missing ${f}`);
  assert(['warm', 'hold'].includes(s.kind), s.id + ' kind');
  assert(s.areas.length && s.areas.every(a => AREAS[a]), s.id + ' areas');
  assert(s.spots.length && s.spots.every(p => SPOTS.includes(p)), s.id + ' spots');
  assert(POS.includes(s.pos), s.id + ' pos');
  assert([1, 2, 3].includes(s.effort), s.id + ' effort');
  assert(s.steps.length >= 3, s.id + ' needs 3+ steps');
  assert(Figure.svg(s.pose).includes('<circle'), s.id + ' pose renders');
  if (s.spots.includes('stand')) assert(s.pos === 'stand' || s.id === 'chair-figure-four', s.id + ' "stand" spot must not need the floor');
}
for (const m of Object.values(L.MODES)) assert(STRETCHES.filter(s => s.spots.includes(m.spot) && s.kind === 'hold').length >= 6, m.name + ' pool too small');

// Dates
assert.equal(L.addDays('2026-10-31', 1), '2026-11-01');
assert.equal(L.addDays('2026-03-29', 1), '2026-03-30'); // DST change in Europe
assert.equal(L.daysBetween('2026-12-30', '2027-01-02'), 3);

// Streaks
const S = (...d) => new Set(d);
let st = L.streak(S('2026-10-10', '2026-10-11', '2026-10-12'), '2026-10-13');
assert.deepEqual([st.current, st.doneToday, st.atRisk], [3, false, true]);
st = L.streak(S('2026-10-11', '2026-10-12', '2026-10-13'), '2026-10-13');
assert.deepEqual([st.current, st.doneToday, st.atRisk], [3, true, false]);
st = L.streak(S('2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-11'), '2026-10-13');
assert.deepEqual([st.current, st.best], [0, 4]);
assert.equal(L.streak(S(), '2026-10-13').current, 0);
const wk = L.week(S('2026-10-12'), '2026-10-13'); // Tuesday
assert.equal(wk[0].key, '2026-10-12'); assert(wk[0].done && wk[1].today && wk[6].future);

// Program
assert.equal(L.phaseFor(0).name, 'Foundations'); assert.equal(L.phaseFor(6).toNext, 1);
assert.equal(L.phaseFor(7).name, 'Build'); assert.equal(L.phaseFor(500).name, 'Own it'); assert.equal(L.phaseFor(500).next, null);

// Routines: fit the time, respect the mode, are stable per day and change with a shuffle.
const base = { today: '2026-10-13', daysDone: 10, focus: {}, last: {} };
for (const [mode, m] of Object.entries(L.MODES)) for (const minutes of m.minutes) {
  const r = L.buildRoutine(STRETCHES, { ...base, mode, minutes });
  const sec = L.totalSeconds(r, mode);
  assert(sec <= minutes * 60 + 20, `${mode} ${minutes}m too long: ${sec}s`);
  assert(sec >= minutes * 60 * 0.7, `${mode} ${minutes}m too short: ${sec}s`);
  assert.equal(new Set(r.map(i => i.id)).size, r.length, 'no repeats');
  r.forEach(i => assert(stretchById[i.id].spots.includes(m.spot), `${i.id} doesn't belong in ${mode}`));
  assert.equal(r.filter(i => stretchById[i.id].kind === 'warm').length, m.warm);
  assert.deepEqual(L.buildRoutine(STRETCHES, { ...base, mode, minutes }), r, 'same day, same routine');
}
// late in the program, short sessions still have a handful of stretches
for (const [mode, m] of Object.entries(L.MODES)) for (const minutes of m.minutes)
  assert(L.buildRoutine(STRETCHES, { ...base, daysDone: 60, mode, minutes }).filter(i => stretchById[i.id].kind === 'hold').length >= 3, `${mode} ${minutes}m too few stretches late on`);
const mat = L.buildRoutine(STRETCHES, { ...base, mode: 'mat', minutes: 20 });
assert.notDeepEqual(L.buildRoutine(STRETCHES, { ...base, mode: 'mat', minutes: 20, salt: 1 }).map(i => i.id), mat.map(i => i.id), 'shuffle changes it');
assert(['childs-pose', 'legs-up-wall', 'reclined-butterfly'].includes(mat[mat.length - 1].id), 'mat ends with a cool-down');
// default focus leans on groin + outer hip, Ben's tight spots
const areaHits = a => mat.filter(i => stretchById[i.id].areas[0] === a).length;
assert(areaHits('adductors') + areaHits('abductors') + areaHits('glutes') >= 2, 'groin/hip focus');
// excluded stretches never show up; couch holds are longer than mat holds
const ex = L.buildRoutine(STRETCHES, { ...base, mode: 'couch', minutes: 40, excluded: ['butterfly'] });
assert(!ex.some(i => i.id === 'butterfly'));
assert(ex.find(i => !stretchById[i.id].long).hold > mat.find(i => stretchById[i.id].kind === 'hold').hold);
// swap options stay in-mode and never duplicate
const sw = L.swapOptions(STRETCHES, mat, 3, { mode: 'mat' });
assert(sw.length && sw.every(s => !mat.some(i => i.id === s.id) && s.spots.includes('mat')));

// Player steps: prep, then holds with a switch between sides
const stp = L.steps([{ id: 'pigeon', hold: 30, sides: 2 }, { id: 'butterfly', hold: 45, sides: 1 }], 'mat');
assert.deepEqual(stp.map(s => s.type), ['prep', 'hold', 'switch', 'hold', 'prep', 'hold']);
assert.deepEqual(stp.map(s => s.side), [1, 1, 2, 2, 0, 0]);

// Trends
const t = L.trend([{ date: '2026-10-01', reach: -12 }, { date: '2026-10-08', reach: -9.5 }, { date: '2026-10-05' }], 'reach', true);
assert.deepEqual([t.first, t.last, t.delta, t.improved, t.pts.length], [-12, -9.5, 2.5, true, 2]);
assert.equal(L.trend([], 'reach', true), null);
assert.equal(L.fmtTime(75), '1:15');

console.log('ok:', STRETCHES.length, 'stretches');
