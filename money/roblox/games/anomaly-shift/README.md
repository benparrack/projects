# Anomaly Shift

An "Exit 8"-style anomaly-spotting horror game. You work the night shift at Night
Shift Inc. and you're stuck in a looping office corridor. Every loop is the same
hallway, except when it isn't.

## Loop
- **Lobby:** walk into the elevator to start a shift. Each player gets a private
  corridor (up to 12 slots). Other players walk around the lobby.
- **Corridor:** Floor 0 is always normal, so learn it. From floor 1 on, each floor
  has a 60% chance of one anomaly, and never more than 2 calm floors in a row.
  - Spot an anomaly: turn back to the **STAIRS**.
  - Nothing wrong: walk through the **EXIT** at the end.
  - Right choice: next floor (+5 coins). Wrong choice: back to floor 0, and the game
    tells you what you missed.
  - A correct choice on floor 8 escapes: +100 coins, a speed bonus (up to +100) and
    the escape counts toward your title.
- **28 anomalies in 3 tiers.** Floors 1–2 only roll easy and medium ones. Examples:
  - red lights, a flickering hall
  - a man at the end of the hall
  - a stalker who creeps closer when you look away
  - a runner who charges at you (turn back!)
  - an extra door, a missing door, room 666
  - a clock running backwards, a TIXE sign
  - a security camera that follows you
  - you as Employee of the Month
- **Index:** found anomalies show up by name. Unseen ones roll twice as often.
- **Radar:** tells you whether this floor has an anomaly (you start with 2).
- **Second Chance:** after a mistake, keep your floor within 8 s (you start with 1).
- **Retention:**
  - Titles, from Intern to CEO of Nowhere
  - a daily reward streak
  - leaderboards for fastest escape, most escapes and anomalies found

## Money
Passes:
- 2x Coins (149)
- Lucky Badge (199: a free Second Chance every run)
- Radar Pro (249: a free radar every floor)

Products:
- Second Chance (25)
- 3 Radars (39)
- 3 Second Chances (59)

Coins also buy radars (80) and Second Chances (150).

Item ids in `src/shared/Config.luau` are `0` until they're created on the Creator
Dashboard. Until then the shop shows them as "SOON".
**Set the place's max players to 12** (one corridor each).

## Layout
- `src/shared/`: pure modules, also loaded by the Lune tests.
  - `Config`: tuning, anomalies, titles, items
  - `Rules`: decisions, anomaly picking, rewards, daily streak
- `src/server/World.luau`: builds everything from code.
  - lobby and lighting
  - the corridor shell (built once per slot, so the Future-lighting lights stay warm)
  - `dress`: rebuilds the props each floor
  - `Anomalies`: one apply function per anomaly
- `src/server/Main.server.luau`: sessions, the shift state machine, walk triggers,
  revive/radar, purchases, leaderboards.
  - In Studio it also adds a `ServerStorage.Debug` BindableFunction:
    `Debug:Invoke(player, {floor = 3, anomaly = "clock", choose = "forward"})`.
- `src/client/`:
  - `Main.client.luau`: HUD, verdict screens, revive offer, shop, Index, tutorial
  - `Juice.client.luau`: first-person camera, ambience, and anomaly animation for
    anything tagged with an `Fx` attribute

## Testing
- `../../tools/check.sh anomaly-shift` runs the type check, lint, Lune tests and build.
- `../../tools/studio-sync.py anomaly-shift` pushes the scripts into the open Studio
  place over MCP.
- `tests/studio/walk.client.luau` takes the elevator, then walks the real EXIT and
  STAIRS triggers.
- Marketing shots are in `marketing/`.
