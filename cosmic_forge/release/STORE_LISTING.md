# Cosmic Forge: release kit

Everything needed to list the game on **CrazyGames** and **itch.io**. Ben does
the uploads from his own accounts.

## Files

| File | Use |
|---|---|
| `build.sh` | Run first. Writes `dist/` (git-ignored) from the current `../index.html` |
| `dist/crazygames/index.html` | CrazyGames upload (game + SDK v3 tag) |
| `dist/cosmic_forge_itch.zip` | itch.io upload (plain `index.html` at the zip root) |
| `cover_1920x1080.png` | CrazyGames landscape cover |
| `cover_800x1200.png` | CrazyGames portrait cover |
| `cover_800x800.png` | CrazyGames square cover |
| `itch_cover_630x500.png` | itch.io cover image |
| `screenshot_1_early.png`, `screenshot_2_void.png`, `screenshot_3_late.png` | Store screenshots (1920×1080), early / mid / late game |

The covers follow CrazyGames' rules: title text only, no borders, no logos or
"Play/New" badges. They are rendered from the game's own sun and planets art.

## Listing text

**Title:** Cosmic Forge

**Short description (one line):**
Grow a universe from a single spark: an idle clicker with a boss-fighting Void Front and a Big Bang prestige.

**Description:**

> Start with a single ember of primordial energy and forge an entire universe.
> Click to ignite, then build Dust Collectors, Protostars, Fusion Cores,
> Planetary Forges, Galactic Cores and more. Each era redraws the cosmos, from a
> swirling dust cloud to a spiral galaxy to the cosmic web itself.
>
> Every click and every point of production also fires into the **Void Front**.
> Shatter enemies for Energy, push through zones and beat timed bosses with six
> hotkey abilities, and collect permanent relics of rising rarity.
>
> When your universe is big enough, trigger **The Big Collapse**. Everything
> resets in a new Big Bang, but you keep Singularities to spend on permanent
> upgrades. Each universe grows faster than the last.
>
> - 7 generator tiers, each with its own animated era
> - Crits, Matter and permanent Monuments
> - Void Front combat: zones, bosses with affixes, abilities, 8 kinds of relics
> - Rotating goals, Stellar Surge, random cosmic events, 7-day daily gift
> - Feats (achievements) that give permanent bonuses
> - Offline progress, autosave, no downloads

**Controls:**
- Click the core (or press `Space`) to ignite
- `1`–`6`: Void abilities
- Mouse: buy generators and upgrades, switch tabs

**Category / genre:** Clicker (CrazyGames) · Simulation / Idle (itch.io)

**Tags:** idle, incremental, clicker, space, universe, prestige, relaxing, singleplayer, boss, upgrade

**Orientation:** landscape · **Age rating:** everyone (no violence beyond abstract shapes shattering, no chat)

## CrazyGames checklist

1. Run `./build.sh`.
2. Sign in at <https://developer.crazygames.com> and choose **Submit a game**.
3. Engine: **HTML5 / other**. Upload `dist/crazygames/index.html` as the build.
   One file, about 220 KB, well under the 50 MB / 1500-file limit.
4. Use the portal's **Preview / QA tool** and play for a minute. Check that:
   - the game opens straight into play (it does, with no menu or modal on a fresh save);
   - `▶ x2 for 10 min` shows under the era title and plays a test ad.
5. Fill in the title, description, controls and tags from above. Upload the
   three covers (1920×1080, 800×1200, 800×800) and the screenshots.
6. Launch type: the build already has the SDK, `loadingStop`, and
   `gameplayStart`/`gameplayStop` (on tab hide/show), so it qualifies for
   **Full Launch** (rewarded ads). Picking **Basic Launch** also works with the
   same file.
7. Optional: a 15–20 s silent preview video (1080p 16:9, opening on the cover
   frame, no cursor). CrazyGames recommends one but doesn't require it.
8. Submit. Review usually takes a few days to a couple of weeks.

Notes:
- The only external request besides the SDK is Google Fonts (Exo 2). If QA
  flags it, the game falls back to a system font.
- Mobile: the layout has a narrow-screen mode, but it hasn't been properly
  playtested on phones. Tick desktop only unless Ben checks it on a phone first.

## itch.io checklist

1. Run `./build.sh`.
2. Go to <https://itch.io/game/new>.
3. Title **Cosmic Forge**. Kind of project: **HTML**. Classification: **Games**.
4. Uploads: add `dist/cosmic_forge_itch.zip` and tick **"This file will be
   played in the browser"**.
5. Embed options:
   - Viewport **1280 × 720**.
   - Tick **Fullscreen button** and **Automatically start on page load**.
   - Leave **Mobile friendly** off until it's tested on a phone.
6. Pricing: **No payments**, or **$0 or donate** (suggested $2) for a small
   income stream.
7. Cover image: `itch_cover_630x500.png`. Screenshots: the three
   `screenshot_*.png` files.
8. Short description, genre (Simulation), and tags from above.
9. Save as **Draft**, open the page and play for a minute to check the embed,
   then set Visibility to **Public**.

Note: saves are per-site `localStorage`, so a CrazyGames save and an itch.io
save are separate.
