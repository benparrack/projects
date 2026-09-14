import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import state


def test_video_not_processed_when_missing(tmp_path):
    path = str(tmp_path / "state.json")
    assert state.is_video_processed("youtube", "abc123", path) is False


def test_mark_and_check_video_processed(tmp_path):
    path = str(tmp_path / "state.json")
    state.mark_video_processed("youtube", "abc123", path)
    assert state.is_video_processed("youtube", "abc123", path) is True
    assert state.is_video_processed("twitch", "abc123", path) is False  # scoped per source


def test_mark_video_processed_is_idempotent(tmp_path):
    path = str(tmp_path / "state.json")
    state.mark_video_processed("youtube", "abc123", path)
    state.mark_video_processed("youtube", "abc123", path)
    data = state.read_state(path)
    assert data["processed_videos"]["youtube"].count("abc123") == 1


def test_corrupt_json_does_not_raise(tmp_path):
    path = tmp_path / "state.json"
    path.write_text("{not valid json")
    assert state.is_video_processed("youtube", "abc123", str(path)) is False


def test_record_post_and_posts_today(tmp_path):
    path = str(tmp_path / "state.json")
    now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    state.record_post("youtube", "clip1", posted_at=now.isoformat(), path=path)
    assert state.posts_today("youtube", path, now=now) == 1
    # a post from yesterday shouldn't count toward "today"
    yesterday = now - timedelta(days=1)
    assert state.posts_today("youtube", path, now=yesterday) == 0


def test_seconds_since_last_post(tmp_path):
    path = str(tmp_path / "state.json")
    posted_at = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    state.record_post("youtube", "clip1", posted_at=posted_at.isoformat(), path=path)
    assert state.seconds_since_last_post("youtube", path, now=now) == 7200.0


def test_seconds_since_last_post_none_when_no_posts(tmp_path):
    path = str(tmp_path / "state.json")
    assert state.seconds_since_last_post("youtube", path) is None


def test_can_post_now_blocks_over_daily_cap(tmp_path, monkeypatch):
    import config

    monkeypatch.setattr(config, "MAX_POSTS_PER_DAY", {"youtube": 1})
    monkeypatch.setattr(config, "MIN_SECONDS_BETWEEN_POSTS", {})
    path = str(tmp_path / "state.json")
    now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    state.record_post("youtube", "clip1", posted_at=now.isoformat(), path=path)
    allowed, reason = state.can_post_now("youtube", path, now=now)
    assert allowed is False
    assert "1/1" in reason


def test_can_post_now_blocks_within_min_gap(tmp_path, monkeypatch):
    import config

    monkeypatch.setattr(config, "MAX_POSTS_PER_DAY", {})
    monkeypatch.setattr(config, "MIN_SECONDS_BETWEEN_POSTS", {"youtube": 3600})
    path = str(tmp_path / "state.json")
    posted_at = datetime(2026, 1, 1, 11, 30, tzinfo=timezone.utc)
    now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)  # only 30 min later
    state.record_post("youtube", "clip1", posted_at=posted_at.isoformat(), path=path)
    allowed, reason = state.can_post_now("youtube", path, now=now)
    assert allowed is False
    assert "minimum gap" in reason


def test_can_post_now_allowed_when_clear(tmp_path, monkeypatch):
    import config

    monkeypatch.setattr(config, "MAX_POSTS_PER_DAY", {"youtube": 3})
    monkeypatch.setattr(config, "MIN_SECONDS_BETWEEN_POSTS", {"youtube": 3600})
    path = str(tmp_path / "state.json")
    allowed, reason = state.can_post_now("youtube", path)
    assert allowed is True
    assert reason is None
