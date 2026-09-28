# +1 Jump Tower

Your jump gets +1 every second. Climb a spiral of pillars rising out of a lava sea,
through 8 zones (Meadow → Space, ~8,800 studs up). Each zone needs more Jump.

## Loop
- **Jump** grows every second (AFK too) and sets how high you jump. Height is
  `8 + 3·√Jump` studs, applied as `Humanoid.JumpPower`.
- **Win pads** at the end of each zone pay Wins once per climb and set your lava
  checkpoint. Clearing zone 8 teleports you home.
- **Rebirth** costs `300·(r+1)²` Jump, resets Jump to 0 and adds +1x gain.
- **Trails** are bought with Wins and give a +10% to +200% gain bonus while equipped.
- **Retention:** a playtime gift every 5 min (8 per session) and a daily streak (5 → 35 Wins).

## Money
Passes: 2x Jump (149), 2x Wins (99), VIP (249: +50% gain, gold trail, crown).
Products: +5 min of Jump (25), +60 min (149), Skip a Zone (49). "Minutes of Jump"
scale with your current gain, so they stay worth buying late game.

Item ids in `src/shared/Config.luau` are `0` until they're created on the Creator
Dashboard. Until then the shop shows them as "SOON".

## Layout
- `src/shared/`: Config, Formulas, TowerLayout. Pure modules, also loaded by the Lune tests.
- `src/server/World.luau`: builds the whole map from code (lighting, plaza, lava, pillars, pads).
- `src/server/Main.server.luau`: player state, +1 tick, pads/lava, remotes, purchases.
- `src/client/`: HUD and panels, built in code.
- Saves and receipts use the studio-wide `lib/server` (SaveStore, Monetization).

`../../tools/check.sh jump-tower` runs type check, lint, tests and build.
