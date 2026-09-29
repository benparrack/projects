# Repo City

This repo's git history, replayed as a city that builds itself.

- **One building per file.** Height grows with line count, and color is the language. Grey warehouses are vendored libraries, word lists, type stubs and binaries. They're kept low so a 60k-line `three.core.js` doesn't tower over real code.
- **One district per project.** Each top-level dir is a district, `money/*` and `3dgames/*` go one level deeper, and Roblox games get their own blocks. Districts are placed on a spiral in the order they were founded, so the oldest projects are downtown.
- **The sky follows the commit's wall clock.** Daytime commits get a blue sky and night commits get lit windows. The hour histogram in the ledger shows how much of this repo was built after midnight.
- Each commit sends a construction beam up from the districts it touched and makes the changed buildings glow.

Live (private) artifact: https://claude.ai/artifact/TWY6WNwkudsNQGhtT6fNmP

Controls: **Play/Replay**, speed (½–4×), drag the timeline to scrub, and ←/→ to step (Shift for ×10). Hover a building to see its file, line count, how many commits touched it and when it was built. Add `#still` to the URL to skip the auto-replay.

## Build

```sh
python3 repo_city/extract.py      # reads git log, bakes it into index.html
xdg-open repo_city/index.html     # works from file://, three.js loads from jsDelivr
```

`template.html` is the viewer and `extract.py` inlines the data. Re-run it any time to rebuild the city with the latest commits. `artifact.html` (gitignored) is the same page without the doctype wrapper, for publishing as a claude.ai artifact.
