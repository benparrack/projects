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
  bonuses that survive everything below.

## The Void Front (combat)

A panel beside the core, in the spirit of Clicker Heroes. Every Ignite fires a
bolt at the current Void enemy, and all Energy production streams into it as
a continuous beam, so each economy upgrade is also a damage upgrade. Enemies
are hex-cell formations that shatter brick-breaker style as their HP drops.

- 10 kills clear a zone. Enemy HP grows x1.33 per zone, and each kill pays
  a bounty of Energy.
- Every 5th zone is a **boss** (x10 HP) you must beat within 30s. If you
  fail, you drop back to farming the previous zone. The "Challenge" button
  shows the DPS you need, and it glows once you can win. Save your Surge
  for bosses.
- Bosses drop Matter. Each zone cleared adds +0.5% production (**Dominion**).
  Every 2 bosses beaten in a cycle add +1 Singularity on Collapse. A Collapse
  resets the Front to Zone 1.
- There are new Void Feats and Goals ("Defeat N enemies", "Reach Zone N").
  Debug helpers: `zone(n)`, `killEnemy()`, `bossNow()`.

## Retention systems

- **Goals**: three rotating short objectives (own the next milestone, click
  N times, land crits, earn X Energy, buy an upgrade, trigger a Surge).
  Each pays about 30–60s of production, sometimes plus Matter, and is
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

Tuned with a greedy-buyer simulation at about 2 clicks/s: the 7 tiers
unlock at roughly 0.5 / 2 / 4 / 9 / 15 / 24 / 38 minutes, and a first
Collapse is available in well under an hour.

## The Big Collapse (prestige)

Once you own a Cosmic Web Weaver (or earn 1B Energy in a cycle), you can trigger **The Big Collapse** — a Big Bang reset. Energy,
Matter, and all generators return to zero, but you keep **Singularities**
(spent on a permanent upgrade shop), Monuments, and Feats. Regression here
is the point: each collapse seeds a strictly stronger next universe.

## Controls

| Action | How |
|---|---|
| Ignite | Click the core, or `space` |
| Buy quantity | x1 / x10 / x25 / Max buttons above the shop list |
| Mute | speaker icon, top right |
| Manual save / erase save | 💾 / 🗑 icons, top right |

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
