# claude-control

How Ben's Claude Code setup is wired: scheduled "hello" pings and the add-ons
installed on top of Claude Code.

## Morning hello (starts the 5-hour usage window early)

Two independent pings at **08:00 Europe/Stockholm**, so one still fires if the other fails.

| Piece | Where it runs | What it does |
|---|---|---|
| `systemd/claude-morning.{service,timer}` | laptop | `claude -p "hello"` daily at 08:00. `Persistent=true` sends it on boot/wake if the laptop was off. Waits ~2 min for network. Log: `~/claude-morning.log` |
| Cloud routine **morning hello** (`trig_011uNvaikxjTu1qf73qfMA63`) | Anthropic cloud | Sends "hello" on Sonnet 5.5 even when the laptop is off. Manage at <https://claude.ai/code/routines/trig_011uNvaikxjTu1qf73qfMA63> |
| `bin/claude-hello-dst` + `systemd/claude-hello-dst.{service,timer}` | laptop | Cloud cron is UTC-only, so once a day (12:00, or on wake) this checks the UTC offset and, only if it changed, runs headless `claude` to set the routine to `0 6 * * *` (summer, +2) or `0 7 * * *` (winter, +1). Last confirmed value: `~/.cache/claude-hello-cron` |

Install on a new machine (needs `claude` at `~/.local/bin/claude`, logged in):

```sh
./install.sh
```

Change the time: edit `OnCalendar=` in `systemd/claude-morning.timer` and the two
UTC hours in `bin/claude-hello-dst`, then rerun `./install.sh` and
`rm ~/.cache/claude-hello-cron` so the cloud routine is updated.

Check: `systemctl --user list-timers 'claude-*'`, `tail ~/claude-morning.log`.

## Add-ons installed (2026-10-11)

### Ponytail (plugin)
"Lazy senior dev" mode: the smallest complete change, plus a short note of what was skipped.
- Source: <https://github.com/DietrichGebert/ponytail>, v5.1.0, user scope.
- Install: `/plugin marketplace add DietrichGebert/ponytail`, then `/plugin install ponytail@ponytail`.
  This adds `extraKnownMarketplaces.ponytail` and `enabledPlugins."ponytail@ponytail"` to `~/.claude/settings.json`.
- A SessionStart hook turns it on in every session. Commands: `/ponytail lite|full|ultra`,
  `stop ponytail`, `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt` (lists `shortcut:` comments), `/ponytail-help`.

### graphify (code knowledge graph)
Builds a graph of a codebase so Claude can query structure instead of doing many Read/Grep calls.
- Install: `uv tool install graphifyy` (note: two y's), then `graphify install` (adds the `graphify` skill to `~/.claude/skills/`). Version 0.9.85.
- Use per sub-project, never at the repo root: `cd <subproject> && graphify update .`, then
  `graphify query/explain/path`. `graphify-out/` is gitignored. The rules are in the root `CLAUDE.md`
  under "Token/context discipline".

### Agent skills pack
21 engineering-workflow skills from Addy Osmani (TDD, debugging, code review, planning,
security, spec-driven development, `interview-me`, `doubt-driven-development`, etc.).
- Install: `npx skills add addyosmani/agent-skills`, which installs them into `~/.claude/skills/`.
- Claude loads them automatically when they fit the task, or you can ask for one by name. Start with `using-agent-skills`.

### OmniRoute (researched, NOT installed)
An AI gateway/proxy that routes Claude Code requests through other providers to get around rate limits
(<https://omniroute.online>). We looked into it on 2026-10-11 and decided not to install it. If you revisit it:
it works by changing `ANTHROPIC_BASE_URL`, so check what it does with your account credentials and
whether that fits Anthropic's terms before you route traffic through it.
