"""Autopilot: watches channels/playlists for new videos, imports them, and when
a project finishes processing, renders its best clips and queues them for
publishing (optionally waiting for your approval) into the next free time slots."""

import threading
import time
import traceback

from . import jobs, notify, publish, store
from .social import caption

_check_lock = threading.Lock()


def normalize_source(url):
    url = url.strip()
    low = url.lower().rstrip("/")
    if "youtube.com/" in low and any(k in low for k in ("/@", "/channel/", "/c/", "/user/")) \
            and not any(low.endswith(t) for t in ("/videos", "/streams", "/shorts", "/featured", "/live")):
        return url.rstrip("/") + "/videos"
    if "twitch.tv/" in low and low.count("/") == 3:  # twitch.tv/name → its VODs
        return url.rstrip("/") + "/videos?filter=archives&sort=time"
    return url


def run_on_project(pid, force=False):
    """Renders the top clips and queues posts for them. Returns how many."""
    s = publish.settings()
    p = store.get_project(pid)
    if not p or (p.get("autopilot_done") and not force):
        return 0
    clips = [c for c in store.get_clips(pid) if c.get("score") is not None and c["score"] >= s["min_score"]]
    clips = sorted(clips, key=lambda c: c["score"], reverse=True)[: int(s["export_top"])]
    accounts = [a for a in s["accounts"] if publish.social.account(a)]
    tags = publish.base_tags(s)
    n = 0
    for c in clips:
        if s["auto_publish"] and accounts:
            cap = caption.generate(pid, c, tags, s["caption_engine"])
            publish.create(pid, c["id"], accounts, cap["title"], cap["text"], cap["hashtags"],
                           when="slot", rerender=True, approval=s["approval"], origin="autopilot")
        else:
            jobs.queue_export(pid, c["id"])
        n += 1
    store.update_project(pid, autopilot_done=time.time())
    if n:
        what = ("queued for approval" if s["approval"] else "scheduled") if s["auto_publish"] and accounts else "exported"
        notify.send("Autopilot", f"{n} clips from “{p.get('name', '')}” {what}", tags=["robot"])
    return n


def on_ready(pid):
    p = store.get_project(pid) or {}
    if p.get("autopilot"):
        run_on_project(pid)


def latest_videos(url, n=10):
    import yt_dlp
    opts = {"extract_flat": "in_playlist", "playlistend": n, "quiet": True, "no_warnings": True, "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    out = []
    for e in (info.get("entries") or [])[:n]:
        if not e or e.get("_type") == "playlist":
            continue
        u = e.get("url") or e.get("webpage_url")
        if u and not u.startswith("http"):
            u = f"https://www.youtube.com/watch?v={e.get('id')}"
        out.append({"id": e.get("id") or u, "url": u, "title": e.get("title") or u, "duration": e.get("duration"),
                    "live": e.get("live_status") in ("is_live", "is_upcoming")})
    return out, info.get("title") or info.get("uploader") or url


def check_source(sid):
    """Looks for new videos on one watched source and imports them."""
    with _check_lock:
        s = publish.settings()
        src = next((x for x in s["sources"] if x["id"] == sid), None)
        if not src:
            return 0
        new = []
        try:
            vids, title = latest_videos(src["url"])
            seen = set(src.get("seen", []))
            first = not src.get("checked")
            fresh = [v for v in vids if v["id"] not in seen and not v["live"]]
            if first:  # don't import a whole back catalogue on the first check
                fresh = fresh[: int(src.get("backfill", 0))]
            maxd = s["max_video_min"] * 60
            for v in fresh:
                if v["duration"] and (v["duration"] > maxd or v["duration"] < 120):  # too long / already a short
                    continue
                new.append(v)
            src.update(name=src.get("name") or title, checked=time.time(), error=None,
                       seen=(list(seen) + [v["id"] for v in vids if not v["live"]])[-300:])
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            src.update(checked=time.time(), error=str(e)[:300])
        for v in new:
            settings = {**s["project"], **{k: v2 for k, v2 in (src.get("project") or {}).items() if v2 not in (None, "")}}
            jobs.new_project(settings, url=v["url"], name=v["title"], autopilot=src.get("autopilot", True),
                             watched=src["id"])
        src["imported"] = src.get("imported", 0) + len(new)
        cur = publish.settings()  # re-read so edits made meanwhile aren't clobbered
        cur["sources"] = [src if x["id"] == sid else x for x in cur["sources"]]
        publish.save_settings(cur)
        if new:
            notify.send("New video found", f"{src.get('name')}: importing {len(new)} video(s)", tags=["tv"])
        return len(new)


def _loop():
    while True:
        time.sleep(60)
        try:
            s = publish.settings()
            every = max(5, float(s["watch_interval"])) * 60
            for src in s["sources"]:
                if src.get("enabled", True) and time.time() - src.get("checked", 0) >= every:
                    check_source(src["id"])
        except Exception:  # noqa: BLE001
            traceback.print_exc()


def start():
    jobs.ready_hooks.append(on_ready)
    threading.Thread(target=_loop, daemon=True).start()
