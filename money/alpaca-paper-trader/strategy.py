"""Pure, network-free trading signal logic."""

from enum import Enum

import config
from indicators import sma_series


class Signal(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


def sma_crossover_signal(
    closes: list,
    short_window: int = config.SMA_SHORT_WINDOW,
    long_window: int = config.SMA_LONG_WINDOW,
) -> Signal:
    """Golden cross (short SMA crosses above long SMA on the latest bar) -> BUY.
    Death cross (short crosses below long) -> SELL.
    Otherwise, or with insufficient history, -> HOLD.

    Only detects a cross that just happened on the most recent bar, not any
    past cross in the history.
    """
    if len(closes) < long_window + 1:
        return Signal.HOLD

    short_sma = sma_series(closes, short_window)
    long_sma = sma_series(closes, long_window)

    prev_short, curr_short = short_sma[-2], short_sma[-1]
    prev_long, curr_long = long_sma[-2], long_sma[-1]

    if None in (prev_short, curr_short, prev_long, curr_long):
        return Signal.HOLD

    crossed_up = prev_short <= prev_long and curr_short > curr_long
    crossed_down = prev_short >= prev_long and curr_short < curr_long

    if crossed_up:
        return Signal.BUY
    if crossed_down:
        return Signal.SELL
    return Signal.HOLD
