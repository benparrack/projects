"""Tracks which source VODs have already been processed and a rolling log of
posts per platform, so a scheduled run doesn't reprocess old VODs or blow
past each platform's daily-post cap. Atomic write (tempfile + os.replace)
same pattern as alpaca-paper-trader/state.py.
"""

import json
import os
import tempfile
from datetime import datetime, timezone

import config

_DEFAULT = {"processed_videos": {}, "posts": {}}


def read_state(path: str = config.STATE_FILE) -> dict:
    if not os.path.exists(path):
        return json.loads(json.dumps(_DEFAULT))
    try:
        with open(path) as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return json.loads(json.dumps(_DEFAULT))
        data.setdefault("processed_videos", {})
        data.setdefault("posts", {})
        return data
    except (json.JSONDecodeError, OSError):
        return json.loads(json.dumps(_DEFAULT))


def _write_state(data: dict, path: str = config.STATE_FILE) -> None:
    directory = os.path.dirname(os.path.abspath(path))
    fd, tmp_path = tempfile.mkstemp(dir=directory, prefix=".state_", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def is_video_processed(source: str, video_id: str, path: str = config.STATE_FILE) -> bool:
    state = read_state(path)
    return video_id in state["processed_videos"].get(source, [])


def mark_video_processed(source: str, video_id: str, path: str = config.STATE_FILE) -> None:
    state = read_state(path)
    ids = state["processed_videos"].setdefault(source, [])
    if video_id not in ids:
        ids.append(video_id)
    _write_state(state, path)


def record_post(platform: str, clip_id: str, posted_at: str = None, path: str = config.STATE_FILE) -> None:
    state = read_state(path)
    entries = state["posts"].setdefault(platform, [])
    entries.append({"clip_id": clip_id, "posted_at": posted_at or _now_iso()})
    _write_state(state, path)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts)


def posts_today(platform: str, path: str = config.STATE_FILE, now: datetime = None) -> int:
    now = now or datetime.now(timezone.utc)
    state = read_state(path)
    today = now.date()
    return sum(
        1
        for entry in state["posts"].get(platform, [])
        if _parse_iso(entry["posted_at"]).date() == today
    )


def seconds_since_last_post(platform: str, path: str = config.STATE_FILE, now: datetime = None):
    now = now or datetime.now(timezone.utc)
    state = read_state(path)
    entries = state["posts"].get(platform, [])
    if not entries:
        return None
    last = max(_parse_iso(e["posted_at"]) for e in entries)
    return (now - last).total_seconds()


def can_post_now(platform: str, path: str = config.STATE_FILE, now: datetime = None) -> tuple:
    """Returns (allowed: bool, reason: str | None). Pure policy check against
    config.MAX_POSTS_PER_DAY / MIN_SECONDS_BETWEEN_POSTS — does not itself
    check config.ALLOW_AUTO_POST, which is the separate, explicit top-level
    gate checked in main.py."""
    max_per_day = config.MAX_POSTS_PER_DAY.get(platform)
    min_gap = config.MIN_SECONDS_BETWEEN_POSTS.get(platform)

    if max_per_day is not None:
        count = posts_today(platform, path, now)
        if count >= max_per_day:
            return False, f"{platform}: already posted {count}/{max_per_day} today"

    if min_gap is not None:
        since = seconds_since_last_post(platform, path, now)
        if since is not None and since < min_gap:
            return False, f"{platform}: last post was {int(since)}s ago, minimum gap is {int(min_gap)}s"

    return True, None
