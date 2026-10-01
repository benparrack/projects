import { Sim } from '../src/sim/sim.js';
import { Bot, runBot } from '../src/sim/bot.js';

// Record each crew member in turn, exactly like a player would.
export function playSolution(L, sol) {
  const crew = [];
  for (const m of sol) {
    const sim = new Sim(L, [...crew, { role: m.role, rec: null }]);
    const rec = runBot(sim, new Bot(m.cmds));
    crew.push({ role: m.role, rec });
  }
  const sim = new Sim(L, crew);
  sim.runToEnd(L.loopTicks + 5);
  return sim;
}
