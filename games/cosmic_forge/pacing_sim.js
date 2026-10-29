// Pacing bot (dev tool, not loaded by the game): drives the real game functions at 100ms ticks.
// Usage: serve this folder, open index.html on a fresh save, then in the console:
//   const s = document.createElement("script"); s.src = "pacing_sim.js"; document.body.appendChild(s);
//   await runSim(40, { clickEvery: 10, buyEvery: 50, goalEvery: 300 })   // human-like: 1 click/s, shop every 5s
// Pass seed: N to make crits/drops repeatable when comparing two tunings (runs vary a lot otherwise).
// Wall-clock systems (events, ability cooldowns) don't fast-forward, so their effect is only approximate.
window.runSim = async function (minutes, opts = {}) {
  closeModal();
  if (opts.seed != null) { let a = opts.seed >>> 0; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const errs = [];
  state.settings.muted = true; state.tutorial.step = 99;
  const src = { click: 0, bounty: 0, goal: 0 };
  const wrap = (name, key) => { const f = window[name]; window[name] = function (...a) { const e0 = state.stats.lifetimeEnergyEarned; const r = f.apply(this, a); src[key] += state.stats.lifetimeEnergyEarned - e0; return r; }; };
  wrap('doIgnite', 'click'); wrap('defeatEnemy', 'bounty'); wrap('claimGoal', 'goal');
  const c = coreCenter();
  const samples = []; let lastTier = -1, collapseAt = null; const tiers = [];
  const total = minutes * 600;
  for (let i = 0; i < total; i++) {
    try {
      simTick(100);
      drawVoid(0.1);
      if (i % (opts.clickEvery || 5) === 0) doIgnite(c.x, c.y, true);
      if (i % (opts.buyEvery || 10) === 0) {
        for (let k = 0; k < 40; k++) {
          const o = [];
          for (const g of GENERATORS) if (isGeneratorUnlocked(g)) o.push([generatorCost(g, ownedOf(state, g.id), 1), () => { runtime.buyMode = 1; buyGenerator(g.id); }]);
          for (const gu of GENERATOR_UPGRADES) if (isGeneratorUpgradeAvailable(gu)) o.push([generatorUpgradeCost(gu), () => buyGeneratorUpgrade(gu.id)]);
          if (state.clickUpgrades.ignitionFocusLevel < 8) o.push([ignitionFocusCost(state.clickUpgrades.ignitionFocusLevel), buyIgnitionFocus]);
          const aff = o.filter(x => x[0] <= state.resources.energy).sort((a, b) => a[0] - b[0]);
          if (!aff.length) break; aff[0][1]();
        }
        if (opts.goals !== false && i % (opts.goalEvery || 10) === 0) for (const g of [...state.goals]) if (goalProgress(g) >= 1) claimGoal(g.id);
        if (state.void.farming) { const est = bossKillEstimate(state.void.maxCleared + 1, currentDps()); if (est.time <= est.limit * 0.9) challengeBoss(); }
        if (collapseAt === null && canCollapse()) collapseAt = +(state.stats.playTimeSeconds / 60).toFixed(1);
      }
      if (i % 600 === 0) samples.push([i / 600, +totalProductionPerSecond().toPrecision(3), state.void.zone]);
      const t = highestOwnedTierIndex(); if (t > lastTier) { lastTier = t; tiers.push(+(state.stats.playTimeSeconds / 60).toFixed(1)); }
    } catch (e) { errs.push(e.message + ' ' + (e.stack || '').split('\n')[1]); if (errs.length > 5) break; }
    if (i % 2000 === 0) await new Promise(r => setTimeout(r, 0));
  }
  const tot = state.stats.lifetimeEnergyEarned;
  const pct = k => (100 * src[k] / tot).toFixed(1) + '%';
  return { tiers, collapseAt, errs, samples, share: { click: pct('click'), bounty: pct('bounty'), goal: pct('goal') },
    zone: state.void.zone, best: state.stats.bestZone, bosses: state.stats.bossesDefeated, relics: totalRelicsFound(), goals: state.stats.goalsCompleted };
};
