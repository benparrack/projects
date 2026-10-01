// Dev tool: find wait timings that make a heist plan work.
//   node tools/search.mjs <level-id> [--all]
// Reads DRAFTS[level-id] from tools/drafts.mjs: crew scripts whose numbers may be
// '$name' placeholders, plus `params: { name: [values...] }`. Members are recorded in
// order (like a player would); each member's own take must stay clean (no alarm,
// no paradox, escapes) before the next is tried. Prints the first full success as a
// ready-to-paste SOLUTIONS entry, or the most common failure.
import { parseLevel } from '../src/sim/level.js';
import { Sim } from '../src/sim/sim.js';
import { Bot, runBot } from '../src/sim/bot.js';
import { LEVELS } from '../src/levels/campaign.js';
import { DRAFTS } from './drafts.mjs';

const id = process.argv[2];
const def = LEVELS.find((l) => l.id === id.split('#')[0]);
const draft = DRAFTS[id];
if (!def || !draft) { console.error('unknown level/draft', id); process.exit(1); }
const L = parseLevel(def);

const fill = (v, env) => (typeof v === 'string' && v.startsWith('$') ? env[v.slice(1)] : Array.isArray(v) ? v.map((x) => fill(x, env)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, env)])) : v);
const paramsOf = (m) => [...new Set(JSON.stringify(m.cmds).match(/"\$\w+"/g)?.map((s) => s.slice(2, -1)) ?? [])];

const fails = new Map();
let tries = 0;
const all = process.argv.includes('--all');
let wins = 0;
const winEnvs = [];

function* combos(names) {
  if (!names.length) { yield {}; return; }
  const [n, ...rest] = names;
  for (const v of draft.params[n]) for (const c of combos(rest)) yield { [n]: v, ...c };
}

function dfs(k, crew, env) {
  const m = draft.crew[k];
  for (const c of combos(paramsOf(m))) {
    const e = { ...env, ...c };
    const cmds = fill(m.cmds, e);
    const sim = new Sim(L, [...crew, { role: m.role, rec: null }]);
    const rec = runBot(sim, new Bot(cmds));
    tries++;
    const last = k === draft.crew.length - 1;
    const bad = sim.S.actors.find((a) => a.lost);
    let why = null;
    if (bad) why = `m${k}: paradox ${bad.lost.why}`;
    else if (rec.escapedAt == null) why = `m${k}: didn't escape (${sim.over?.reason ?? 'still inside'})`;
    else if (sim.over && sim.over.t <= rec.escapedAt + 1 && sim.over.kind === 'alarm') why = `m${k}: ${sim.over.reason}`;
    else if (sim.S.alarm && !last) why = `m${k}: alarm ${sim.S.alarm.reason ?? ''}`;
    if (!why && last && !process.env.PARTIAL) {
      const full = new Sim(L, [...crew, { role: m.role, rec }]);
      full.runToEnd(L.loopTicks + 5);
      if (full.over.kind === 'success' && !full.S.actors.some((a) => a.lost)) {
        wins++;
        winEnvs.push(e);
        if (wins <= 5 || process.env.VERBOSE) console.log(`SUCCESS t=${full.over.t} params=${JSON.stringify(e)}`);
        if (!all || wins >= (process.env.MAXWINS ?? 5)) return true;
        continue;
      }
      why = `final: ${full.over.kind} ${full.over.reason ?? ''}`;
    }
    if (!why && last && process.env.PARTIAL) { wins++; winEnvs.push(e); if (process.env.VERBOSE) console.log(`OK ${JSON.stringify(e)}`); continue; }
    if (why) { fails.set(why, (fails.get(why) ?? 0) + 1); continue; }
    if (dfs(k + 1, [...crew, { role: m.role, rec }], e)) return true;
  }
  return false;
}

const ok = dfs(0, [], {});
console.log(ok || wins ? `found ${wins} (${tries} takes)` : `no solution in ${tries} takes`);
if (!ok) console.log([...fails].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w, n]) => `${n}× ${w}`).join('\n'));
// EMIT=1: print the median winning plan as a SOLUTIONS entry (median = most robust guess).
if (process.env.EMIT && winEnvs.length) {
  const e = winEnvs[winEnvs.length >> 1];
  console.log(`// params ${JSON.stringify(e)}`);
  console.log(JSON.stringify(draft.crew.map((m) => ({ role: m.role, cmds: fill(m.cmds, e) }))).replace(/"(\w+)":/g, '$1: '));
}
