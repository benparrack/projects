# Claude Usage Analyst

A local dashboard for your own Claude Code usage. It reads the transcripts in
`~/.claude/projects/**/*.jsonl` and shows:

- **where the cost went**, by project, sub-project, session, day, model and cost type
- **how close you are to your plan limit**, as a live 5-hour window with burn rate and projected hit time
- **what was avoidable**, found by replaying real sessions with cheaper habits
- **per-session drill-downs** showing context growth, each prompt and its cost, subagents and the heaviest tool results
- **how many tokens you've used**: a total-tokens tile and an all-time cumulative growth chart with milestone markers (100M, 1B, …) and a "next milestone in ~N days" pace estimate

It uses only the Python standard library and a single-page HTML UI, with no build step and no dependencies.
Everything stays on `127.0.0.1`.

## Run

```bash
claude-usage              # start the dashboard and open it in the browser (http://127.0.0.1:8765)
claude-usage summary      # quick terminal summary: today, 7 days, current 5h window, top saving
claude-usage calibrate 44 # record what /usage says (current session %) to sharpen the estimate
claude-usage validate     # check the cost math against Claude Code's own per-session totals
claude-usage --port 9000 --no-open
```

`claude-usage` is a symlink in `~/.local/bin` pointing at `bin/claude-usage`. If a
dashboard server is already running, running the command again just reopens the page.

Tests: `python3 -m unittest discover -s tests`

## How the numbers work

**Cost** is the API-equivalent price (see `claude_usage/pricing.py`). On Pro you don't
pay it; it measures usage. Streamed duplicate lines are deduplicated per
`message.id + requestId`, keeping the largest output count. Claude Code also makes calls
that never reach the transcript: the auto-mode permission classifier, title generation
and Haiku side-queries. Its own `cost-state` total includes them, so the gap is
spread over each session's requests as **"Background calls"**. Afterwards, session
totals match Claude Code's exactly (`claude-usage validate`).

**Live limits.** The current 5-hour and weekly percentages come straight from the
endpoint Claude Code's `/usage` calls (`claude_usage/live.py`), so they match `/usage`
exactly and include claude.ai usage. The OAuth token is read from
`~/.claude/.credentials.json` for each fetch (at most once a minute), is sent only to
`api.anthropic.com`, and is never stored or refreshed. If it has expired or the fetch
fails, the dashboard falls back to the estimate below. Turn it off with
`"live_usage": false` in settings. Burn rate and "you'll hit the limit at…" still come
from the unit model, rescaled to the live %. Each window's live reading is also saved
as a calibration point (marked "auto"), which keeps the fallback estimate honest.

**Estimated limits.** 5-hour windows start at your first message, rounded down to 10 minutes. That
matches the reset times in the "You've hit your session limit · resets 9:20pm" messages,
and each hit's reset time also anchors its window exactly. Anthropic doesn't publish Pro
limits in tokens, so the limit is *learned from your limit hits*:

- API-dollar cost is a bad predictor. Real hits ranged from $22 to $87, and one $80 window never hit.
- `units = output + 0.2 × (fresh input + cache writes)` fits all clean hits within 8%, and no
  non-hit window exceeds it.
- Model price is *not* a guide to model weight. An all-Opus-5.5 window read 44% on `/usage`,
  while a 2× (price-ratio) weight predicted 84%. Per-model weights start at 1× and are fit from
  **`/usage` readings**: enter the "current session" % in the Limits page, or run
  `claude-usage calibrate 44`. Each reading is an exact data point for whatever models ran
  in that window (Opus 5.5 currently fits at 1.04× Sonnet).
- The weights and the limit refit automatically on every new hit. Hits where the window
  started well before any local activity mean usage happened on claude.ai, which can't be
  seen here, so those count only as lower bounds.

You can override the limit, or set a weekly budget, in Settings
(`~/.config/claude-usage/settings.json`). While the server runs it sends a desktop
notification at 80% and 95% of the window.

**Avoidable cost** (Insights) comes from simulations over each session's real request sequence:

| finding | model |
|---|---|
| Compact earlier | once context passes the threshold (default 120K), pretend `/compact` ran and kept ~30K tokens; the saving is the cache reads avoided on later turns, minus the compaction's own cost |
| /clear on switch | work moved to a different sub-project with 60K+ tokens of old context |
| Big tool results | result tokens × turns carried × cache-read price (a leaner call keeps ~15%) |
| Idle rewrite | the cache expired (5m/1h TTL) and a big context was re-written at write price |
| Explore inline | 40+ read/search calls in the main thread instead of a subagent |
| Repeat reads | the same file read in full 3+ times |

**Sub-projects.** For sessions started in a directory like `~/projects`, each
request is attributed to the sub-directory its most recent tool call touched,
so a session that moves from `game_terminal` to `mission_control` is split correctly.

## Layout

```
claude_usage/parser.py    transcript → compact per-file records (cached in ~/.cache/claude-usage)
claude_usage/analysis.py  sessions, blocks, calibration, waste simulation, API payloads
claude_usage/pricing.py   per-model rates
claude_usage/live.py      exact % from Anthropic's usage endpoint (same as /usage)
claude_usage/server.py    stdlib HTTP server + JSON API + notifier
claude_usage/cli.py       serve / summary / validate
web/                      index.html, app.js, app.css (hand-rolled SVG charts)
tests/test_usage.py       synthetic-transcript tests
```
