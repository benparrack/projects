# Future Ideas

Brainstormed feature ideas for the dashboard, not yet decided or scheduled.
Pick whatever sounds fun for a future session, ignore the rest.

---

## Now Playing / Spotify (cheapest wins, API already wired up)

- **Progress bar** under the track — Spotify's response already includes
  `progress_ms` + the track's duration, just needs a thin bar/percentage.
- **Volume control** — `/me/player/volume` endpoint, `+`/`-` keys.
- **Shuffle/repeat toggle** — `/me/player/shuffle` and `/me/player/repeat`.
- **Device switcher** — list available devices (`/me/player/devices`) and
  press a key to transfer playback between phone/desktop/speaker, instead
  of always targeting "whatever was last active."

## New panels

- **"Needs attention" digest** — a panel that pulls from data the other
  panels already fetch and surfaces only what's actionable: uncommitted
  changes sitting too long, a calendar event starting in <15 min, low
  disk space. Cuts across panels instead of adding a new data source.
- **GitHub panel** — open PRs/issues via `gh api` (already used day to
  day for this repo), notification count.
- **Weather forecast strip** — Open-Meteo already returns hourly data;
  a small sparkline of the next 24h temps next to the current conditions.
- **Sunrise/sunset or moon phase** — small, thematic, and genuinely useful
  ("will it be dark when I'm done").
- **Pomodoro/focus timer** — start/stop keybinding, panel counts down,
  notifies when done. Actually useful daily, not just decorative.
- **"On this day"** — git commits from N days/months ago in this repo.
  This is literally `IDEAS.md` #18 in the parent repo, already scoped there.
- **Repo stats** — total lines of code, number of projects, longest daily
  commit streak. Pure fun/vanity metric, ties into the rest of the repo.
- **Launcher** — press a key to open one of the other projects
  (physics_sandbox, generative_art_gallery, etc.) in Chromium directly
  from the dashboard, turning it into an actual front door to the repo.

## Multiple pages/screens

- **Cycle through different screens for different use cases** — distinct
  from the existing `l` layout cycle (grid/sidebar/stacked), which just
  rearranges the *same* fixed panel set. This would be multiple different
  *pages*, each with its own chosen subset/arrangement of panels for a
  different purpose (e.g. a "focus" page with just Clock/Pomodoro/Up
  Next/Notes, a "full status" page with everything, maybe a "media" page
  built around Now Playing) — cycled with their own key, independent of
  the layout cycle. Needs: a page definition (which panels, what
  arrangement) separate from the current fixed `LAYOUTS` list in
  `screens.py`, and a second keybinding/indicator distinct from `l` so the
  two cycles (layout shape vs. page content) don't collide in the UI.

## Visual/aesthetic

- **Theme cycling** — same pattern as the layout cycle (`l`), but for
  color themes: current "mission-control" cyan/amber/purple palette,
  plus 1-2 alternates (warmer, or minimal monochrome).
- **Per-panel refresh indicator** — subtle flash or spinner in the
  border subtitle while a panel's worker is actively fetching, so it's
  clear when data is live vs. stale.
- **ASCII weather icons** — small icons built from box-drawing/block
  characters (not emoji — deliberately dropped emoji earlier for
  font-compatibility reasons) for sun/cloud/rain.
- **Ambient background flourish** — a subtle animated starfield or
  scanline effect behind panels, leaning into the "mission control"
  sci-fi framing. Purely decorative, could be fun or could be too much.

## Quality of life

- **Help overlay** — `?` shows all keybindings and which panels are
  configured vs. not, instead of needing the README.
- **Remember last layout** — persist the chosen layout name so relaunching
  doesn't always start on sidebar if you've switched away from it.
- **Auto-pick layout by terminal size** — narrow/short terminal defaults
  to `stacked` automatically instead of requiring a manual `l` press.

## Top picks if narrowing down

1. Now Playing progress bar + device switcher (small, high value, reuses
   the Spotify integration already working).
2. "Needs attention" digest panel (genuinely useful daily-glance value,
   not just another data source).
3. Theme cycling (mirrors the layout-cycle pattern already in place).
