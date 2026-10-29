# /home/ben/projects

This directory is Ben's personal sandbox for playing around with Claude Code and
testing its limits by building random project ideas — a single git repo containing
many unrelated, self-contained sub-projects (games, visualizers, tools, etc.), not
one cohesive product.

## Layout

- `apps/`: tools Ben actually uses (planners, trackers, bots, dashboards).
- `games/`: real games with more than one pass of work.
- `playground/`: one-shot demos and experiments. Kept but rarely touched.
- `money/`: money-making experiments (trading, bots, Roblox).
- `game_terminal/`: the big multiplayer hub, kept at the top level.
- `ideas/`: idea backlogs (`IDEAS.md`, `NEW_IDEAS.md`, `USEFULL_IDEAS.md`,
  `game_ideas.md`, `CV_IDEAS.md`).

New projects go in the matching category folder, not the root. `README.md`
indexes every project. `app-launch` is the shared launcher behind the
`~/.local/share/applications/*.desktop` files.

## Start of session

Before starting work on anything here, read `TODO_FIRST.md` in this directory in
full — it's short (the current picks from `ideas/IDEAS.md`, plus a "Done" log) and gives
situational awareness across all the sub-projects cheaply.

For `ideas/IDEAS.md` (the full numbered backlog, each entry with enough context to pick
back up cold — much longer, and grows over time):
- If Ben already named a sub-project or idea number to work on, don't full-read
  it — just look up that one entry (grep the number/name) plus anything
  `TODO_FIRST.md` already told you.
- If there's no clear target yet (Ben's asking what to work on next, or starting
  something genuinely new), skim `ideas/IDEAS.md` fully — that's what it's for.

## Browser automation

Default browser is **Firefox**, not Chrome/Chromium — the `claude-in-chrome`
extension doesn't work in this environment (Chromium here is snap-packaged, so its
native messaging host can't reach the extension). For any browser automation or
testing of a web-based project in here, use the **`playwright` MCP server**
(configured with `--browser firefox`), not `claude-in-chrome`.

**Exception — pointer-lock / mouse-look / 3D shooter games:** Firefox has a
confirmed Firefox+X11 bug where the pointer-lock cursor gets stuck at a screen
edge after a direction reversal (hit in `games/shooter/`; not reproducible in
Chromium-family browsers on the same machine). For any project using
`requestPointerLock` (FPS-style mouselook, etc.) or 3D shooter games generally,
default to testing/playing in **actual Google Chrome** (not Chromium — Ben has it
installed and it's worked best in practice across these games), and mention this
tradeoff if the user hasn't already made the call for that project. See ideas/IDEAS.md
entry "0. 3D-Rendered Games" for the full writeup.

## Git safety with concurrent sessions

Ben often runs more than one Claude Code session against this repo at the
same time (e.g. one on `game_terminal`, another on `mission_control`),
sharing one working directory and one `.git` index. A plain `git commit`
commits the *entire* index, not just the paths a given session just staged
— so another session's `git add` can land in the gap between this
session's own `git status`/`git add` and its `git commit`, and get swept
into an unrelated commit under an unrelated message. This has actually
happened more than once here.

**Always commit with `git commit --only -- <exact paths>` instead of a
bare `git commit`.** `--only` restricts the commit to just the listed
paths regardless of anything else staged in the index at commit time,
which closes this race entirely rather than just narrowing it (checking
`git status` first helps but is not sufficient on its own). Use this for
every commit in this repo, not just when a collision seems likely.

## Token/context discipline

`ccusage` (`npx ccusage@latest blocks`) usage data from this repo shows the
dominant cost by far is **cache-read tokens**, not big single file reads or a
bloated `CLAUDE.md` — one session alone racked up 35.9M cache-read tokens against
only 158K output tokens. Cache reads scale with *conversation length × number of
turns*, because every tool-call round-trip resends the whole growing context. The
fixes that actually move this number:
- On a long tool-call-heavy stretch (iterative debugging, repeated test/build
  runs, lots of small Read/Bash calls in a row), run `/compact` proactively
  well before it's forced — don't wait for auto-compact.
- **Subagents only when Ben asks, or when clearly cheaper.** Each subagent starts
  cold and re-reads the brief, `CLAUDE.md`, the code and the test harness, so
  fanning out N agents pays that N times. For multi-item requests (bug lists,
  playtest feedback, per-game fixes), work through the items one at a time in the
  main session, finishing and verifying each before the next; commit after each
  (or every few) and `/compact` between groups. A single subagent is fine for one
  big read-only sweep (dozens of Read/Grep calls where only the conclusion
  matters), since its tool calls never get replayed into the main context.
- `/clear` between unrelated sub-projects instead of carrying dead context
  forward into the next task.
- Keep `CLAUDE.md` files and always-loaded memory lean — every line in them gets
  replayed on every single turn of a session, not just paid for once.
- **graphify (on request, per sub-project):** when Ben says to use graphify, build
  a graph for *only the sub-project being worked on*, never the repo root. Run
  `cd <subproject> && graphify update .` (code-only, local, free, takes seconds).
  Then answer codebase questions with narrow `graphify query/explain/path` calls
  before Read/Grep. `graphify-out/` is gitignored repo-wide. If a sub-project
  already has a `graphify-out/`, use it unasked, and run `graphify update .` after
  code changes. Avoid `/graphify` on docs and media, because the semantic pass costs
  tokens.
- **Subagent briefs must say to use graphify** when the target sub-project has a
  `graphify-out/`. Subagents don't reliably follow CLAUDE.md, so put it in the
  prompt itself: "use `graphify query/explain` to locate code before Read/Grep,
  and read only the line ranges you need."

## Working across sub-projects

- Each top-level directory is its own self-contained project (own README/assets/
  build as needed) — don't assume shared tooling, package.json, or conventions
  across them unless a project explicitly says otherwise.
- Check a sub-project's own directory for a README or CLAUDE.md before assuming
  how to run/build it; add project-specific instructions there rather than here
  as new projects gain their own conventions. For notes that only matter when
  touching one sub-project, prefer a path-scoped rule in `.claude/rules/` (see
  `.claude/rules/game_terminal.md` for an example) over adding to this file —
  it only loads into context when that sub-project's files are actually read.
- When picking up new work, prefer finishing/polishing an in-progress idea from
  `TODO_FIRST.md` over starting something new from `ideas/IDEAS.md`, unless Ben asks
  otherwise.
