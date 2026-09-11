import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from indicators import sma_series


def test_sma_basic_sequence():
    closes = [1, 2, 3, 4, 5]
    result = sma_series(closes, window=3)
    assert result == [None, None, 2, 3, 4]


def test_sma_window_larger_than_input():
    closes = [1, 2, 3]
    result = sma_series(closes, window=5)
    assert result == [None, None, None]


def test_sma_window_one_equals_input():
    closes = [1.0, 2.0, 3.0]
    result = sma_series(closes, window=1)
    assert result == [1.0, 2.0, 3.0]


def test_sma_invalid_window_raises():
    import pytest

    with pytest.raises(ValueError):
        sma_series([1, 2, 3], window=0)
