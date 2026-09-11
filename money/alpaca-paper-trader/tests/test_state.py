import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import state


def test_default_disabled_when_missing(tmp_path):
    path = str(tmp_path / "state.json")
    assert state.is_enabled(path) is False


def test_set_enabled_round_trip(tmp_path):
    path = str(tmp_path / "state.json")
    state.set_enabled(True, path)
    assert state.is_enabled(path) is True
    state.set_enabled(False, path)
    assert state.is_enabled(path) is False


def test_corrupt_json_does_not_raise(tmp_path):
    path = tmp_path / "state.json"
    path.write_text("{not valid json")
    assert state.is_enabled(str(path)) is False
