# Steal a Satellite

A "Steal a Brainrot"-style tycoon in space. Satellites ride a conveyor belt out of a
Launch Bay. Buy them and they earn cash on your pads. Steal other players' satellites,
and zap anyone who tries to steal yours.

## Loop
- **Belt:** a satellite spawns every 2.2 s and rides to the Recycler. There are 19
  satellites in 8 rarities, from Tin Can ($15, $1/s) to The Monolith ($32M, 1 in 1,000
  on the belt). Hold E to buy.
- **Base:** each of the 8 bases has 8 pads. Rebirths and the Bigger Base pass unlock
  up to 16. Satellites fill a green collect plate that you step on to cash out. Hold F
  on your own satellite to sell it for 50%.
- **Steal:** hold E on someone else's satellite. It rides above your head, you slow to
  15 speed, and you have 120 s to bring it inside your own base.
- **Defend:**
  - Step on the red pad to lock your base for 60 s. The lock is a laser curtain that
    pushes intruders out.
  - Zap thieves with the Zapper to stun them; the satellite flies home.
- **Space pirates** squat in up to 3 empty bases so a quiet server still has something
  to steal. Captain Bolts guards 6 loot pads, including one "treasure" satellite one
  tier above the best one in the server. Their shield opens for 35 s, then locks for
  15 s. Pads restock every 40 s. When a player needs a base, the pirates warp out.
- **Pirate raids:** about every 90 s a pirate drone flies to someone's base. It picks a player
  with 3+ satellites and 3+ minutes of play, not locked, at most once per 5 min per player.
  - It beams up any satellite except their best one and crawls home at speed 9.
  - Zap it for a 5% bounty and the satellite comes back.
  - Locking your base during the beam bounces the drone.
  - If it gets home, the satellite becomes pirate loot you can steal back.
- **Rebirth:** costs 1M × 4ʳ. Each rebirth adds +0.5x income and +1 pad (up to +4).
- **Retention:** offline earnings (10% for up to 2 h), a daily streak, the Index
  (found / odds), and leaderboards for top steals and top earned.

## Money
Passes:
- 2x Cash (199)
- Bigger Base (149, +4 pads)
- Speedy Thief (99, carry speed 21)
- VIP (249: +50% income, gold trim)

Products:
- Cash: 10 min of income (29) or 2 h (199)
- 10 min Shield (39)
- 15 min Server Luck (79, ×2 odds for the lucky tiers, for everyone)

Item ids in `src/shared/Config.luau` are `0` until they're created on the Creator
Dashboard. Until then the shop shows them as "SOON".
**Set the place's max players to 8** (one base each).

## Layout
- `src/shared/`: pure modules, also loaded by the Lune tests.
  - Config
  - Formulas (economy and odds)
  - Rules (slots and steal checks)
  - SatModel (builds any satellite from parts)
- `src/server/World.luau`: builds the map from code (lighting, belt, bases, decor).
- `src/server/Main.server.luau`: sessions, belt, stealing, zapper, pirates, purchases.
  - In Studio it also puts a `ServerStorage.Debug` BindableFunction: `Debug:Invoke(player, {cash = 1e6, give = "spyeye"})`.
- `src/client/`:
  - `Main.client.luau`: HUD and panels
  - `Juice.client.luau`: effects, prompts, floating pads, carry guide

## Testing
- `../../tools/check.sh steal-a-satellite` runs the type check, lint, Lune tests and build.
- `../../tools/studio-sync.py steal-a-satellite` pushes the scripts into the open Studio place over MCP.
- `tests/studio/*.client.luau` are playtest scripts for `tools/studio-run.sh`. They cover:
  - buy from the belt
  - collect and lock
  - zap
  - pirate steal and delivery
  - drone zap: run `Debug:Invoke(player, {raid = true})` first
