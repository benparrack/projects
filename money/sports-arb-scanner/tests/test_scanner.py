import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scanner import _is_pre_match


def test_future_event_is_pre_match():
    future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat().replace("+00:00", "Z")
    assert _is_pre_match({"commence_time": future}) is True


def test_past_event_is_not_pre_match():
    past = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat().replace("+00:00", "Z")
    assert _is_pre_match({"commence_time": past}) is False


def test_missing_commence_time_defaults_to_pre_match():
    assert _is_pre_match({}) is True
