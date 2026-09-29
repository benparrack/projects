# Roblox studio (money/roblox/)

A small "game studio": several Roblox experiences, all written as code in this
repo, aimed at earning Robux (game passes, developer products, Premium Payouts →
DevEx).

## Pipeline (all on Linux)

| Step | Tool | Notes |
|---|---|---|
| Write game code | `.luau` files under `games/<name>/src` | Everything lives in git. Studio is never the source of truth. |
| Build place file | **Rojo** (`rojo build`) | `default.project.json` per game maps folders → Roblox services. |
| Live-sync into Studio | `rojo serve` + Rojo Studio plugin | Studio runs through **Vinegar** (Flatpak/Wine). |
| Drive Studio directly | Studio's built-in **MCP server** (Assistant → Manage MCP Servers → Claude Code) | Lets Claude inspect/edit the open place and run playtests. Only works if Studio runs under Vinegar. |
| Pure-logic tests | **Lune** (`lune run`) | Economy math, save-data migration, etc., headless. |
| Lint / format | selene, StyLua | `selene games/` / `stylua games/` |
| Publish | Studio, or Open Cloud place-publish API with a `.env` API key | |

Tools are pinned in `rokit.toml`; `rokit install` restores them.

## Money facts to design around
- Game pass / developer product sales pay about 70% to the creator.
- DevEx cash-out needs at least 30,000 earned Robux (about $114 at $0.0038/R$), age 13+, and a verified account.
- The discovery algorithm rewards retention and session length. Retention loops come before monetization.

## Daily workflow
1. `tools/check.sh <game>` runs the type check (luau-lsp), selene, the Lune tests and the build.
   The build lands in `build/` and is copied into Studio's Documents folder.
2. Start Studio: `flatpak run org.vinegarhq.Vinegar run`. Use File → Open → Documents/<game>.rbxl.
3. Live sync: `cd games/<game> && rojo serve`, then Plugins → Rojo → Connect in Studio.
4. Claude ↔ Studio: `tools/studio-mcp.sh` runs Studio's own `StudioMCP.exe` inside the running
   Vinegar sandbox. It's registered with Claude Code as the `roblox-studio` MCP server
   (local scope for /home/ben/projects). In Studio, enable it under Assistant → Manage MCP Servers.
   If the tools don't appear in a Claude session (e.g. `/mcp` connected before Studio registered),
   `tools/mcp-call.py <tool> '<json>'` calls them from the shell through a background daemon.
   Screenshots land in `build/shots/`.
5. Studio playtests: `tools/studio-run.sh <file>` runs a Luau file in the running playtest. The file's
   `.client`/`.server` suffix picks the datamodel. Each game keeps these in `tests/studio/`.

Gotcha: never kill Vinegar mid-download. It then treats the half-written Studio as installed
("Bad EXE format"). Fix it by deleting `~/.var/app/org.vinegarhq.Vinegar/data/vinegar/versions/<ver>`.

## Games
| Game | Status |
|---|---|
| `games/jump-tower` (+1 Jump Tower) | v1 playtested in Studio: all 40 steps physically climbable, server flow verified. Next: publish, then fill in the pass/product ids. |
| `games/steal-a-satellite` (Steal a Satellite) | v1 playtested in Studio. Verified: buy, collect, lock, zap, stealing, space-pirate bases, drone raids and the first-time hints. Promo shots are in `marketing/`. Next: publish with max players 8, then fill in the pass/product ids. |
