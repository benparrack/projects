# /home/ben/projects

This directory is Ben's personal sandbox for playing around with Claude Code and
testing its limits by building random project ideas — a single git repo containing
many unrelated, self-contained sub-projects (games, visualizers, tools, etc.), not
one cohesive product.

## Start of session

Before starting work on anything here, read `TODO_FIRST.md` in this directory in
full — it's short (the current picks from `IDEAS.md`, plus a "Done" log) and gives
situational awareness across all the sub-projects cheaply.

For `IDEAS.md` (the full numbered backlog, each entry with enough context to pick
back up cold — much longer, and grows over time):
- If Ben already named a sub-project or idea number to work on, don't full-read
  it — just look up that one entry (grep the number/name) plus anything
  `TODO_FIRST.md` already told you.
- If there's no clear target yet (Ben's asking what to work on next, or starting
  something genuinely new), skim `IDEAS.md` fully — that's what it's for.

## Browser automation

Default browser is **Firefox**, not Chrome/Chromium — the `claude-in-chrome`
extension doesn't work in this environment (Chromium here is snap-packaged, so its
native messaging host can't reach the extension). For any browser automation or
testing of a web-based project in here, use the **`playwright` MCP server**
(configured with `--browser firefox`), not `claude-in-chrome`.

**Exception — pointer-lock / mouse-look / 3D shooter games:** Firefox has a
confirmed Firefox+X11 bug where the pointer-lock cursor gets stuck at a screen
edge after a direction reversal (hit in `3dgames/shooter/`; not reproducible in
Chromium-family browsers on the same machine). For any project using
`requestPointerLock` (FPS-style mouselook, etc.) or 3D shooter games generally,
default to testing/playing in **actual Google Chrome** (not Chromium — Ben has it
installed and it's worked best in practice across these games), and mention this
tradeoff if the user hasn't already made the call for that project. See IDEAS.md
entry "0. 3D-Rendered Games" for the full writeup.

## Session terminal

A `SessionStart` hook in `.claude/settings.local.json` automatically opens a
separate `gnome-terminal` window (working directory `/home/ben/projects`) whenever
a Claude Code session starts here, so Ben always has a normal shell on hand
alongside the Claude session. This is best-effort/fire-and-forget — it won't error
or block startup if it fires more than once (e.g. on `--resume`/`--continue`).

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
- Push exploration/research-heavy work into a subagent or fork rather than doing
  dozens of Read/Grep calls in the main conversation — a subagent's tool calls
  never get replayed into the parent's growing context, only its final summary
  does.
- `/clear` between unrelated sub-projects instead of carrying dead context
  forward into the next task.
- Keep `CLAUDE.md` files and always-loaded memory lean — every line in them gets
  replayed on every single turn of a session, not just paid for once.

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
  `TODO_FIRST.md` over starting something new from `IDEAS.md`, unless Ben asks
  otherwise.
