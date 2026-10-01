// Dev tool: run one draft member with given params and print a trace.
//   node tools/trace.mjs <draft-id> <member-index> '{"a":0,...}' [every=40]
// Earlier members are replayed using the same params.
import { parseLevel } from '../src/sim/level.js';
import { Sim } from '../src/sim/sim.js';
import { Bot, runBot } from '../src/sim/bot.js';
import { LEVELS } from '../src/levels/campaign.js';
import { DRAFTS } from './drafts.mjs';

const [id, k = '0', envJson = '{}', every = '40'] = process.argv.slice(2);
const L = parseLevel(LEVELS.find((l) => l.id === id.split('#')[0]));
const draft = DRAFTS[id], env = JSON.parse(envJson);
const fill = (v) => (typeof v === 'string' && v.startsWith('$') ? env[v.slice(1)] : Array.isArray(v) ? v.map(fill) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([q, x]) => [q, fill(x)])) : v);
const crew = [];
for (let i = 0; i < +k; i++) {
  const m = draft.crew[i];
  crew.push({ role: m.role, rec: runBot(new Sim(L, [...crew, { role: m.role, rec: null }]), new Bot(fill(m.cmds))) });
}
const m = draft.crew[+k];
const sim = new Sim(L, [...crew, { role: m.role, rec: null }]);
const bot = new Bot(fill(m.cmds));
const f = (v) => (v / 256).toFixed(1);
while (!sim.over) {
  const a = sim.S.actors[+k];
  sim.step(a.escaped ? 0 : bot.input(a));
  if (sim.tick % +every === 0) {
    console.log(sim.tick, 'me', f(a.x), f(a.y), a.lost ? 'LOST' : '', '|', sim.S.guards.map((g) => `${g.id}:${g.state} ${f(g.x)},${f(g.y)} sus${g.sus} f${g.facing}`).join(' '));
  }
}
console.log(JSON.stringify(sim.over));
console.log(sim.S.log.map((e) => `${e.t}:${e.k}:${e.a}:${e.id}`).join('\n'));
