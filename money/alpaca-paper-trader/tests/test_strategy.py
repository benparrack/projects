import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from strategy import Signal, sma_crossover_signal

SHORT, LONG = 3, 5


def test_golden_cross_triggers_buy():
    # Flat, then a jump on the last bar pulls the short SMA above the long SMA.
    closes = [10, 10, 10, 10, 10, 10, 20]
    assert sma_crossover_signal(closes, SHORT, LONG) == Signal.BUY


def test_death_cross_triggers_sell():
    # Flat, then a drop on the last bar pulls the short SMA below the long SMA.
    closes = [10, 10, 10, 10, 10, 10, 0]
    assert sma_crossover_signal(closes, SHORT, LONG) == Signal.SELL


def test_flat_series_holds():
    closes = [10, 10, 10, 10, 10, 10, 10]
    assert sma_crossover_signal(closes, SHORT, LONG) == Signal.HOLD


def test_insufficient_history_holds():
    closes = [10, 10, 10, 10, 10]  # len < LONG + 1
    assert sma_crossover_signal(closes, SHORT, LONG) == Signal.HOLD
