# instagram_saves

One-off: recap every saved Instagram post (categories, what they're about, why you
saved them) as one self-contained page, `data/report.html`. Works from Instagram's
own data export only. Nothing touches Instagram.

1. Instagram → Accounts Center → *Download your information* → JSON, include "Saved".
   Unzip it into `data/export/`.
2. Run:

       python3 prepare.py                                  # export → data/posts.jsonl
       ../money/clip-studio/.venv/bin/python summarize.py  # local Qwen on the GPU, ~hours; rerun resumes
       ../money/clip-studio/.venv/bin/python quests.py     # the one doable thing per learn/try/buy save, ~1 h
       python3 build_report.py                             # → data/report.html + data/wrapped.html

`data/wrapped.html` is a tap-through "Wrapped" story of the stats, then the someday list: every
song, recipe, move, title, skill, product and place you saved, merged across duplicate saves, with
checkboxes (kept in that browser's localStorage) and a "pick one for me" button.

`categories.json` is hand-written: topic → category mapping, the write-ups and the
curated picks. `build_report.py` fails if a pick links a post that isn't in the export.

`login.py`, `fetch.py` and `transcribe.py` are the abandoned instaloader route
(scraping got the account flagged for automated activity). Don't run them.

`data/` holds your posts and is gitignored, so it never gets committed.
