// Preview-video recorder (dev tool). Frame-steps the game under Playwright's fake clock (page.clock) and
// pauses/advances CSS animations by hand, so the video plays at true real-time speed at any capture rate.
// Usage: serve cosmic_forge/ on :8931, copy this with __SEG__ replaced by A, B or C, run it via the Playwright
// MCP browser_run_code_unsafe tool; frames land in .playwright-mcp/frames/<SEG>/ (2880x1620 JPEGs).
// Then encode with make_videos.sh.
async (page) => {
  const SEG = '__SEG__';
  const FRAMES = 196;           // 6.5s at 30fps
  const dir = `/home/ben/projects/.playwright-mcp/frames/${SEG}`;
  const segs = {
    A: {
      setup: () => { debug.own('dust', 9); debug.addEnergy(420); },
      act: (f) => {
        if (f % 4 === 0) { const c = coreCenter(); doIgnite(c.x + Math.random() * 30 - 15, c.y + Math.random() * 30 - 15); }
        if (f === 40) { runtime.buyMode = 1; buyGenerator('dust'); }
        if (f === 95) { runtime.buyMode = 1; buyGenerator('protostar'); }
      },
    },
    B: {
      setup: () => { for (const id of ['dust','protostar','fusion','forge','galactic']) debug.own(id, 25); debug.addEnergy(2e6); debug.unlockAbilities(); debug.relic(3); debug.zone(14); },
      act: (f) => {
        if (f % 3 === 0) { const c = coreCenter(); doIgnite(c.x + Math.random() * 30 - 15, c.y + Math.random() * 30 - 15); }
        if (f === 12) useAbility('lance');
        if (f === 45) useAbility('overdrive');
        if (f === 80) debug.gilded();
        if (f === 110) useAbility('plunder');
      },
    },
    C: {
      setup: () => {
        debug.ownAll(40); debug.addEnergy(5e14); debug.unlockAbilities(); debug.relic(6);
        const dps = currentDps(); let best = 5;
        for (let z = 5; z <= 200; z += 5) { const e = bossKillEstimate(z, dps); if (e.time <= 7) best = z; }
        window.__bossZone = best; debug.zone(best - 1);
      },
      act: (f) => {
        if (f % 2 === 0) { const c = coreCenter(); doIgnite(c.x + Math.random() * 30 - 15, c.y + Math.random() * 30 - 15); }
        if (f === 6) debug.surge();
        if (f === 14) debug.zone(window.__bossZone);
        if (f === 22) useAbility('overdrive');
        if (f === 30) useAbility('cascade');
        if (f === 40) useAbility('lance');
        if (f === 70) useAbility('lance');
      },
    },
  };
  const S = segs[SEG];
  const ctx = await page.context().browser().newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1.5 });
  const p = await ctx.newPage();
  await p.clock.install();
  await p.goto('http://localhost:8931/index.html?v=rec');
  await p.clock.runFor(1500);
  await p.evaluate(`closeModal(); state.settings.muted = true; state.tutorial.step = 99; saveDisabled = true; (${S.setup.toString()})(); closeModal();`);
  await p.clock.runFor(4000);
  await p.evaluate(() => { closeModal(); el('toastLog').innerHTML = ''; });
  await p.clock.runFor(300);
  const act = S.act.toString();
  const t0 = Date.now();
  for (let f = 0; f < FRAMES; f++) {
    await p.evaluate(`(${act})(${f})`);
    await p.clock.runFor(33.333);
    await p.evaluate(() => {
      for (const a of document.getAnimations()) {
        if (a.__v === undefined) { a.pause(); a.__v = 0; a.currentTime = 0; }
        else { a.__v += 33.333; a.currentTime = a.__v; }
      }
    });
    await p.screenshot({ path: `${dir}/${String(f).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 93, scale: 'device' });
  }
  const info = await p.evaluate(() => ({ zone: state.void.zone, boss: window.__bossZone, stage: el('stageName').textContent }));
  await ctx.close();
  return { SEG, secs: (Date.now() - t0) / 1000, info };
}
