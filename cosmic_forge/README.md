# Cosmic Forge

An idle/incremental game — just open `index.html`, no build step or server
needed. Grow a universe from a single spark of primordial energy through
Dust, Protostars, Stars, Solar Systems, Galaxies, Superclusters, and
finally the Cosmic Web, watching the full-screen backdrop visibly evolve
at every stage.

## Core loop

- **Ignite** manually for Energy, or buy **generators** (7 tiers, each
  gated behind owning ~10 of the previous tier) to produce it passively.
- Manual clicking stays relevant late-game: crits (5% base chance, x10
  damage) can drop **Matter**, a scarce secondary currency spent once
  each on permanent **Monuments**.
- Random **events** (Solar Flare, Meteor Shower, Supernova, Wormhole) fire
  every 1–2.5 minutes and reward paying attention, not just idling.
- **Feats** (achievements) grant small permanent production bonuses that
  survive everything below.

## The Big Collapse (prestige)

Once you own a Cosmic Web Weaver (or hit 1 trillion lifetime Energy in a
cycle), you can trigger **The Big Collapse** — a Big Bang reset. Energy,
Matter, and all generators return to zero, but you keep **Singularities**
(spent on a permanent upgrade shop), Monuments, and Feats. Regression here
is the point: each collapse seeds a strictly stronger next universe.

## Controls

| Action | How |
|---|---|
| Ignite | Click the sun, or `space` |
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
  etc.) — handy for exploring late-game content without the grind.
