"""Tracks only the enabled/disabled toggle for scheduled runs. Alpaca's own
/v2/positions remains the source of truth for actual holdings.
"""

import json
import os
import tempfile

import config


def read_state(path: str = config.STATE_FILE) -> dict:
    if not os.path.exists(path):
        return {"enabled": False}
    try:
        with open(path) as f:
            data = json.load(f)
        if not isinstance(data, dict) or "enabled" not in data:
            return {"enabled": False}
        return data
    except (json.JSONDecodeError, OSError):
        return {"enabled": False}


def is_enabled(path: str = config.STATE_FILE) -> bool:
    return bool(read_state(path).get("enabled", False))


def set_enabled(enabled: bool, path: str = config.STATE_FILE) -> None:
    directory = os.path.dirname(os.path.abspath(path))
    fd, tmp_path = tempfile.mkstemp(dir=directory, prefix=".state_", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump({"enabled": enabled}, f)
        os.replace(tmp_path, path)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise
