"""Publishing queue. A post is one clip going to one or more connected accounts:

  rendering → (approval) → scheduled → publishing → done / partial / error

A background thread publishes scheduled posts when their time comes, retrying
failed uploads a few times. Posts live in data/social/posts.json."""

import datetime as dt
import os
import threading
import time
import traceback

from . import jobs, notify, social, store

POSTS = os.path.join(social.SOCIAL, "posts.json")
SETTINGS = os.path.join(store.DATA, "autopilot.json")
_lock = threading.RLock()
_wake = threading.Event()
MAX_ATTEMPTS = 3
RETRY_AFTER = 600


# ------------------------------------------------------------------ settings (shared with autopilot)

DEFAULTS = {
    "slots": ["12:00", "17:00", "20:30"],  # local times; one post per slot
    "privacy": "public",
    "tiktok_mode": "direct",
    "hashtags": "fyp viral",
    "caption_engine": "auto",
    "ntfy": "",
    # autopilot
    "accounts": [],
    "auto_new": False,
    "export_top": 3,
    "min_score": 70,
    "auto_publish": True,
    "approval": True,
    "watch_interval": 60,
    "max_video_min": 240,
    "project": {"minLen": 20, "maxLen": 60, "count": 10, "model": "small", "language": "", "engine": "local", "focus": ""},
    "sources": [],
}


def settings():
    s = store.read_json(SETTINGS, {})
    return {**DEFAULTS, **s, "project": {**DEFAULTS["project"], **s.get("project", {})}}


def save_settings(s):
    with _lock:
        store.write_json(SETTINGS, s)


def base_tags(s=None):
    return [t.strip().lstrip("#") for t in (s or settings())["hashtags"].replace(",", " ").split() if t.strip()]


# ------------------------------------------------------------------ posts store

def posts():
    return store.read_json(POSTS, [])


def get(post_id):
    return next((p for p in posts() if p["id"] == post_id), None)


def update(post_id, mutate):
    with _lock:
        lst = posts()
        for p in lst:
            if p["id"] == post_id:
                mutate(p)
                p["updated"] = time.time()
                store.write_json(POSTS, lst)
                return p
    return None


def delete(post_id):
    with _lock:
        store.write_json(POSTS, [p for p in posts() if p["id"] != post_id])


# ------------------------------------------------------------------ scheduling

def _parse_slot(s):
    try:
        h, m = s.strip().split(":")
        return int(h) % 24, int(m) % 60
    except ValueError:
        return None


def next_slot(after=None, taken=None):
    """Earliest configured time slot after `after` that no other post already holds."""
    now = max(time.time(), after or 0)
    slots = sorted(filter(None, map(_parse_slot, settings()["slots"])))
    if not slots:
        return now
    if taken is None:
        taken = {round(p["at"] / 60) for p in posts()
                 if p.get("at") and p["status"] in ("scheduled", "publishing", "done", "partial")}
    day = dt.date.fromtimestamp(now)
    for d in range(366):
        for h, m in slots:
            ts = dt.datetime.combine(day + dt.timedelta(days=d), dt.time(h, m)).timestamp()
            if ts > now + 30 and round(ts / 60) not in taken:
                return ts
    return now


def _schedule(p):
    """Gives an approved post its publish time based on its `when` setting."""
    w = p.get("when", "slot")
    p["at"] = time.time() if w == "now" else w if isinstance(w, (int, float)) else next_slot()
    p["status"] = "scheduled"


def _latest_export(pid, cid):
    c = store.get_clip(pid, cid) or {}
    for e in reversed(c.get("exports", [])):
        if os.path.exists(store.pdir(pid, "exports", e["file"])):
            return e["file"]
    return None


def create(pid, cid, accounts, title, text, hashtags, privacy=None, when="slot", rerender=False,
           approval=False, origin="manual", tiktok_mode=None):
    s = settings()
    clip = store.get_clip(pid, cid)
    if not clip:
        raise ValueError("Clip not found")
    accounts = [a for a in accounts if social.account(a)]
    if not accounts:
        raise ValueError("Pick at least one connected account")
    p = {"id": store.new_id(5), "pid": pid, "cid": cid, "created": time.time(), "origin": origin,
         "title": title.strip()[:100] or clip["title"], "text": text.strip()[:2000],
         "hashtags": [h.strip().lstrip("#") for h in hashtags if h.strip()][:30],
         "privacy": privacy or s["privacy"], "tiktok_mode": tiktok_mode or s["tiktok_mode"],
         "when": when, "approval": bool(approval), "at": None, "file": None,
         "targets": [{"account": a, "status": "pending", "attempts": 0} for a in accounts]}
    f = None if rerender else _latest_export(pid, cid)
    if f:
        p["file"] = f
        if approval:
            p["status"] = "approval"
        else:
            _schedule(p)
    else:
        p["status"] = "rendering"
    with _lock:
        lst = posts()
        lst.append(p)
        store.write_json(POSTS, lst)
    if p["status"] == "rendering":
        job = jobs.queue_export(pid, cid, post_id=p["id"])
        update(p["id"], lambda x: x.update(export=job["id"]))
    if p["status"] == "approval":
        _ask_approval(p)
    _wake.set()
    return get(p["id"])


def _ask_approval(p):
    notify.send("Clip ready for approval", f"“{p['title']}” — approve it in Clip Studio → Publish", tags=["eyes"])


def on_export(job):
    if not job.get("post"):
        return
    def mut(p):
        if p["status"] != "rendering":
            return
        if job["status"] == "done":
            p["file"] = job["file"]
            if p.get("approval"):
                p["status"] = "approval"
            else:
                _schedule(p)
        else:
            p["status"], p["error"] = "error", f"Render failed: {job.get('error')}"
    p = update(job["post"], mut)
    if p and p["status"] == "approval":
        _ask_approval(p)
    _wake.set()


def approve(post_id, when=None):
    def mut(p):
        if p["status"] == "approval":
            if when is not None:
                p["when"] = when
            _schedule(p)
    p = update(post_id, mut)
    _wake.set()
    return p


def publish_now(post_id):
    def mut(p):
        if p["status"] in ("approval", "scheduled", "error", "partial"):
            p["at"], p["status"] = time.time(), "scheduled"
            for t in p["targets"]:
                if t["status"] == "error":
                    t.update(status="pending", attempts=0)
    p = update(post_id, mut)
    _wake.set()
    return p


# ------------------------------------------------------------------ worker

def _run(p):
    path = store.pdir(p["pid"], "exports", p["file"])
    if not os.path.exists(path):
        update(p["id"], lambda x: x.update(status="error", error="The exported video file is gone"))
        return
    for t in p["targets"]:
        if t["status"] == "done" or (t["status"] == "error" and (
                t["attempts"] >= MAX_ATTEMPTS or time.time() - t.get("at", 0) < RETRY_AFTER)):
            continue
        acct = social.account(t["account"]) or {}
        _set_target(p["id"], t["account"], status="publishing")
        try:
            res = social.publish(t["account"], path, p)
            _set_target(p["id"], t["account"], status="done", at=time.time(), error=None, **res)
            notify.send(f"Posted to {acct.get('name', 'account')}", f"“{p['title']}”", url=res.get("url"), tags=["rocket"])
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            n = t["attempts"] + 1
            _set_target(p["id"], t["account"], status="error", at=time.time(), attempts=n, error=str(e)[:500])
            if n >= MAX_ATTEMPTS:
                notify.send(f"Publish failed: {acct.get('name', 'account')}", f"“{p['title']}”: {str(e)[:200]}", tags=["warning"])
    _finish(p["id"])


def _set_target(post_id, aid, **kw):
    def mut(p):
        for t in p["targets"]:
            if t["account"] == aid:
                t.update(kw)
    update(post_id, mut)


def _finish(post_id):
    def mut(p):
        st = [t["status"] for t in p["targets"]]
        if all(s == "done" for s in st):
            p["status"] = "done"
        elif any(s == "error" and t["attempts"] < MAX_ATTEMPTS for s, t in zip(st, p["targets"])):
            p["status"] = "scheduled"  # retry later
            p["at"] = time.time() + RETRY_AFTER
        else:
            p["status"] = "partial" if "done" in st else "error"
    update(post_id, mut)


def _loop():
    while True:
        _wake.wait(15)
        _wake.clear()
        try:
            due = [p for p in posts() if p["status"] == "scheduled" and p.get("at") and p["at"] <= time.time()]
            for p in sorted(due, key=lambda p: p["at"]):
                update(p["id"], lambda x: x.update(status="publishing"))
                _run(get(p["id"]))
        except Exception:  # noqa: BLE001
            traceback.print_exc()


def start():
    jobs.export_hooks.append(on_export)
    # recover from a restart: interrupted uploads go back on the schedule, renders are re-queued
    for p in posts():
        if p["status"] == "publishing":
            def mut(x):
                x["status"] = "scheduled"
                for t in x["targets"]:
                    if t["status"] == "publishing":
                        t["status"] = "pending"
            update(p["id"], mut)
        elif p["status"] == "rendering":
            if store.get_clip(p["pid"], p["cid"]):
                job = jobs.queue_export(p["pid"], p["cid"], post_id=p["id"])
                update(p["id"], lambda x, j=job: x.update(export=j["id"]))
            else:
                update(p["id"], lambda x: x.update(status="error", error="Clip was deleted"))
    threading.Thread(target=_loop, daemon=True).start()
