# /home/ben/projects

This directory is Ben's personal sandbox for playing around with Claude Code and
testing its limits by building random project ideas — a single git repo containing
many unrelated, self-contained sub-projects (games, visualizers, tools, etc.), not
one cohesive product.

## Start of session

Before starting work on anything here, read `IDEAS.md` and `TODO_FIRST.md` in this
directory to get current on where things stand:
- `IDEAS.md` — the full backlog of project ideas, each with enough context to pick
  back up cold. Ideas are numbered; sub-projects reference their originating idea
  number (e.g. "IDEAS.md #11").
- `TODO_FIRST.md` — the short list of ideas currently picked from `IDEAS.md` as
  next up to build, plus a "Done" log of what's shipped so far.

Skim both fully rather than grepping for a keyword — they're short enough to read
end-to-end and the point is situational awareness across *all* the sub-projects,
not just the one you're about to touch.

## Browser automation

Default browser is **Firefox**, not Chrome/Chromium — the `claude-in-chrome`
extension doesn't work in this environment (Chromium here is snap-packaged, so its
native messaging host can't reach the extension). For any browser automation or
testing of a web-based project in here, use the **`playwright` MCP server**
(configured with `--browser firefox`), not `claude-in-chrome`.

**Exception — pointer-lock / mouse-look games:** Firefox has a confirmed
Firefox+X11 bug where the pointer-lock cursor gets stuck at a screen edge after a
direction reversal (hit in `3dgames/shooter/`; not reproducible in Chromium on the
same machine). For any project using `requestPointerLock` (FPS-style mouselook,
etc.), default to testing/playing in **Chromium** instead, and mention this
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

## Working across sub-projects

- Each top-level directory is its own self-contained project (own README/assets/
  build as needed) — don't assume shared tooling, package.json, or conventions
  across them unless a project explicitly says otherwise.
- Check a sub-project's own directory for a README or CLAUDE.md before assuming
  how to run/build it; add project-specific instructions there rather than here
  as new projects gain their own conventions.
- `game_terminal/` is deployed (Render, see `TODO_FIRST.md`/`IDEAS.md` #11) — treat
  changes there as touching a live, shared, real-time multiplayer service, not a
  local-only demo.
- When picking up new work, prefer finishing/polishing an in-progress idea from
  `TODO_FIRST.md` over starting something new from `IDEAS.md`, unless Ben asks
  otherwise.
