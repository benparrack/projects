# Mission Control

A glanceable terminal dashboard: system stats (with rolling CPU/memory
history sparklines), weather, calendar, git/project status across `../`
(this repo), what's next on `TODO_FIRST.md`, and what's currently playing.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp config.example.toml config.toml   # then fill in your calendar URL, etc.
```

`config.toml` is gitignored — it can hold a private Google Calendar URL.

- **Weather** auto-detects your location via IP geolocation by default.
  Override it in `config.toml` if that's inaccurate (e.g. on a VPN).
- **Calendar** needs a Google Calendar secret iCal URL: on
  calendar.google.com, open your calendar's Settings, scroll to
  "Integrate calendar", and copy "Secret address in iCal format" into
  `config.toml`'s `[calendar].ics_url`. Read-only, no OAuth setup needed.
  Leave it blank to just show "not configured".
- **Projects/Git panel** assumes `../` is a single git repo containing
  project folders (as this repo is) and reports overall repo status plus
  which folder was touched most recently.
- **Now Playing** shells out to `playerctl` (Linux media-player control via
  MPRIS/dbus — works with Spotify, browsers, VLC, etc.). Install it with
  `sudo apt install playerctl` (or your distro's equivalent); the panel
  shows "not installed" until then.

## Run

```bash
.venv/bin/python app.py
```

| Key | Action |
|---|---|
| `r` | Refresh all panels now |
| `q` | Quit |
