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

`config.toml` is gitignored — it can hold private tokens (calendar URL,
Spotify credentials).

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
- **Now Playing** uses the Spotify Web API, so it shows playback from any
  device (phone included), not just this computer:
  1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).
  2. In its settings, add redirect URI `http://127.0.0.1:53219/callback` exactly
     (port chosen to avoid colliding with Jupyter's default 8888 — if 53219
     is somehow also taken on your machine, change `PORT` at the top of
     `spotify_auth.py` and update the redirect URI here to match).
  3. Enable the Web API checkbox, save, then grab the app's Client ID and
     Client Secret from Settings.
  4. Run `.venv/bin/python spotify_auth.py`, paste in the Client ID/Secret
     when prompted, and approve access in the browser tab that opens.
     This writes a `[spotify]` section into `config.toml` for you — you
     never need to hand-edit it.
  Leave it unrun to just show "not configured".

## Run

```bash
.venv/bin/python app.py
```

| Key | Action |
|---|---|
| `r` | Refresh all panels now |
| `q` | Quit |
