# Cosmic Forge

An idle/incremental game — just open `index.html`, no build step or server
needed. Grow a universe from a single spark of primordial energy through
Dust, Protostars, Stars, Solar Systems, Galaxies, Superclusters, and
finally the Cosmic Web. The clickable core in the middle of the screen is
redrawn for every era (ember → dust swirl → protostar with jets → star →
solar system → spiral galaxy → superclusters → cosmic web), with a
full-screen "A new era" cinematic each time you reach one.

## Core loop

- **Ignite** manually for Energy, or buy **generators** (7 tiers, each
  gated behind owning ~10 of the previous tier) to produce it passively.
- Manual clicking stays relevant late-game: crits (5% base chance, x10
  damage) can drop **Matter**, a scarce secondary currency spent once
  each on permanent **Monuments**.
- Random **events** (Solar Flare, Meteor Shower, Supernova, Wormhole) fire
  every 1–2.5 minutes and reward paying attention, not just idling.
- **Feats** (achievements, 5 categories) grant small permanent production
  bonuses that survive everything below. Feats unlocked within a few seconds
  of each other share one toast, so the early burst isn't a wall of popups.

## The Void Front (combat)

A panel beside the core, in the spirit of Clicker Heroes. Every Ignite fires a
bolt at the current Void enemy, and all Energy production streams into it as
a continuous beam, so each economy upgrade is also a damage upgrade. Enemies
are hex-cell formations that shatter brick-breaker style as their HP drops.

- 10 kills clear a zone. Enemies start at 25 HP, which grows x1.6 per zone up
  to Zone 25 (the economy grows fastest early), then x1.3. Each kill pays about
  2.5 seconds of your current production (bosses about 45 seconds) plus 7% of
  its HP, shown as "Per kill" under the enemy. Enemies you kill in under 2
  seconds pay proportionally less, so farming easy zones never beats pushing.
  Kills end up around 25–45% of income.
  Clearing zones also raises **Dominion**, a permanent +0.5% production per
  zone cleared.
- Every 5th zone is a **boss** (x10 HP) you must beat within 30s. If you
  fail, you drop back to farming the previous zone. The "Challenge" button
  shows the DPS you need, and it glows once you can win. Save your Surge
  for bosses.
- Bosses drop Matter. Each zone cleared adds +0.5% production (**Dominion**).
  Every 2 bosses beaten in a cycle add +1 Singularity on Collapse. A Collapse
  resets the Front to Zone 1.
- **Sectors**: every 10 zones is a new named sector with its own arena tint.
- **Boss affixes** (from Zone 15): Shielded (beam does half damage), Regenerating
  (heals 2%/s), Swift (20s timer, x2 Matter), Armored (x0.7 damage, drops 2 relics).
  The Challenge button shows the effective DPS you need, including the affix
  penalty and a 10% safety margin.
- **Gilded Wisps**: 3% of spawns, pay x10 bounty and have a 25% relic chance.
- **Abilities** (keys 1–6, unlocked permanently by deepest zone reached):
  Nova Lance (Z3), Overdrive (Z10), Chrono Lock (Z20, freezes the boss clock),
  Plunder (Z30), Star Cascade (Z40, auto-ignites), Big Crunch (Z50, resets the
  others). The later ones are meant to land after your first Collapse or two.
- **Relics**: bosses always drop one. Rarity is Common / Rare / Epic / Legendary,
  weighted by relic luck (Lodestar relics, Plunder, zone depth). Duplicates stack
  into 8 permanent bonuses (bolt damage, crit, boss time, bounty, production,
  cooldowns, Matter, luck), and they survive Collapse. Open the ◈ button on the
  Front to see the **Armory** (abilities, relics, current odds).
- There are Void Feats and Goals ("Defeat N enemies", "Reach Zone N", "Use N
  abilities"). Debug helpers: `zone(n)`, `killEnemy()`, `bossNow()`,
  `relic(n)`, `readyAbilities()`, `unlockAbilities()`, `gilded()`.

## Retention systems

- **Goals**: three rotating short objectives (own the next milestone, click
  N times, land crits, earn X Energy, buy an upgrade, trigger a Surge).
  Each pays about 60–120s of production, sometimes plus Matter, and is
  replaced immediately, so there's always a next thing about a minute away.
- **Stellar Surge**: rapid clicking fills a ring around the core; when full,
  you get 12s of x5 click power and x2 production, then a 30s recharge.
- **Daily gift**: a 7-day escalating streak (Matter, a timed x2 Cosmic
  Blessing, and later Singularities). The streak resets if you miss a day.
- **Guidance**: tutorial hints under the core, gold edges on affordable
  generators, per-generator progress bars toward the next efficiency
  upgrade, a locked teaser for the next tier, and tab dots when a Monument,
  Collapse, or new Feat is waiting.

## Pacing

Measured with `pacing_sim.js`, an in-page bot that drives the real game code
(so crits, goals, Surge, feats and Void bounties all count). Playing like a
person (1 click/s, shopping every 5s, claiming goals every 30s) gets:

- The first 6 tiers at roughly 0.25 / 1.2 / 2.3 / 3.2 / 4.6 / 7.2 minutes.
- A first Collapse available at about 8–14 minutes (1B Energy).

Runs vary a lot (crits, drops and events compound), so compare tunings with
`seed:` over several seeds, not one run. A perfect 2-clicks/s bot is roughly
1.5x faster; a 5-clicks/s masher reaches Protostars in about 30s. There is no
pacing display in the game itself: players go at their own pace, and Feats
mark progress.

## The Big Collapse (prestige)

Once you own a Cosmic Web Weaver (or earn 1B Energy in a cycle), you can trigger **The Big Collapse** — a Big Bang reset. Energy,
Matter, and all generators return to zero, but you keep **Singularities**
(spent on a permanent upgrade shop), Monuments, and Feats. Regression here
is the point: each collapse seeds a strictly stronger next universe.

## Controls

| Action | How |
|---|---|
| Ignite | Click the core, or `space` |
| Void abilities | Click the ability bar, or keys `1`–`6` |
| Buy quantity | x1 / x10 / x25 / Max buttons above the shop list |
| Mute | speaker icon, top right |
| Manual save / erase save | 💾 / 🗑 icons, top right. Erase wipes everything and starts a brand-new universe |

## Notes

- Saves to `localStorage`, autosaving every 20s plus on tab-hide/close.
  Reopening after a break calculates offline progress (capped, extendable
  via the Temporal Anchor prestige upgrade) and shows a summary.
- Fully self-contained: no external libraries, no audio assets (sound
  effects are synthesized with the Web Audio API).
- `window.debug` in the console exposes helpers for fast-forwarding state
  (`addEnergy`, `own`, `setTab`, `unlockAchievements`, `forceCollapse`,
  `surge`, `daily`, `stageCard`, `completeGoals`, etc.) — handy for exploring late-game content without the grind.

## Publishing to web-game portals

The game is built to be uploaded as-is to CrazyGames / Poki style portals.
A small `Platform` adapter looks for the CrazyGames SDK v3
(`window.CrazyGames.SDK`) and is a no-op when it's missing. So:

- **Basic Launch**: upload `index.html` unchanged. No ads, and it works as is.
- **Full Launch**: add
  `<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>`
  before the game script. That enables `loadingStop`, `gameplayStart/Stop`
  (on tab hide/show), `happytime` (on new eras and Surges), and **rewarded
  ads**. The rewarded ads appear as "▶ Double it" on the welcome-back screen
  and a "▶ x2 for 10 min" boost button under the era title. Both stay
  hidden when ads aren't available.
