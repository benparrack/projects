"""Walks your saved posts → data/saves.jsonl (+ audio for videos in data/audio/).
Slow on purpose, stops at the first sign Instagram is pushing back (no retrying),
and does at most --max posts per run (default 300). Ctrl+C anytime; rerun resumes.
  .venv/bin/python fetch.py [--max N]"""

import glob
import json
import os
import random
import subprocess
import sys
import time

import instaloader

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
OUT = os.path.join(DATA, "saves.jsonl")
AUDIO = os.path.join(DATA, "audio")
UA = "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0"


class BatchDone(Exception):
    pass


def session_user():
    files = glob.glob(os.path.expanduser("~/.config/instaloader/session-*"))
    if not files:
        sys.exit("No session yet; run login.py first.")
    return os.path.basename(max(files, key=os.path.getmtime))[len("session-"):]


def record(post):
    return {
        "shortcode": post.shortcode,
        "url": f"https://www.instagram.com/p/{post.shortcode}/",
        "owner": post.owner_username,
        "date": post.date_utc.isoformat(),
        "type": post.typename,
        "is_video": post.is_video,
        "duration": post.video_duration,
        "caption": post.caption or "",
        "hashtags": post.caption_hashtags,
        "likes": post.likes,
    }


def grab_audio(post):
    # shortcut: only single videos; videos inside carousels get caption-only, fine unless many are carousels
    dest = os.path.join(AUDIO, post.shortcode + ".m4a")
    if not post.is_video or os.path.exists(dest):
        return
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", post.video_url,
                        "-vn", "-c:a", "copy", dest], capture_output=True, text=True)
    if r.returncode:
        print(f"  audio failed for {post.shortcode}: {r.stderr.strip()[:120]}")


def main():
    limit = int(sys.argv[sys.argv.index("--max") + 1]) if "--max" in sys.argv else 300
    os.makedirs(AUDIO, exist_ok=True)
    done = set()
    if os.path.exists(OUT):
        with open(OUT) as f:
            done = {json.loads(line)["shortcode"] for line in f if line.strip()}

    # same browser identity as the Firefox cookies; a mismatched UA on a borrowed session draws rate limits
    L = instaloader.Instaloader(quiet=True, user_agent=UA, max_connection_attempts=1)
    L.load_session_from_file(session_user())
    posts = instaloader.Profile.own_profile(L.context).get_saved_posts()

    # resumable_iteration stores the page cursor in resume_*.json, so a rerun skips paging from the top
    with instaloader.resumable_iteration(
            context=L.context, iterator=posts,
            load=lambda _, path: instaloader.FrozenNodeIterator(**json.load(open(path))),
            save=lambda fni, path: json.dump(fni._asdict(), open(path, "w")),
            format_path=lambda magic: os.path.join(DATA, f"resume_{magic}.json")), \
            open(OUT, "a") as out:
        fetched = 0
        for post in posts:
            if post.shortcode in done:
                continue
            if fetched >= limit:
                raise BatchDone(fetched)  # an exception (not break) makes instaloader keep the resume cursor
            try:
                out.write(json.dumps(record(post)) + "\n")
                out.flush()
                grab_audio(post)
            except (instaloader.ConnectionException, instaloader.LoginRequiredException):
                raise  # Instagram pushing back: stop, don't keep hammering
            except Exception as e:  # noqa: BLE001 - one broken post shouldn't stop a multi-hour run
                print(f"  skipped {post.shortcode}: {e}")
            done.add(post.shortcode)
            fetched += 1
            print(f"{len(done):5d}  @{post.owner_username}  {(post.caption or '').splitlines()[0][:60] if post.caption else ''}")
            # API calls happen per page of ~12 posts (instaloader rate-limits those); this also spaces the audio fetches (0.5-1.5s tripped a block)
            time.sleep(random.uniform(4, 8))
    print(f"This run: {fetched}. Total: {len(done)} saved posts in {OUT}")


if __name__ == "__main__":
    try:
        main()
    except BatchDone as e:
        print(f"\nBatch of {e} done (progress saved). Run again in a few hours for the next batch.")
    except (instaloader.ConnectionException, instaloader.LoginRequiredException) as e:
        sys.exit(f"\nInstagram pushed back, so I stopped (progress saved).\n  {e}\n"
                 "Wait several hours (ideally until tomorrow) before running again.")
