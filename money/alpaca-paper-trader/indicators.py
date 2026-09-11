"""Pure technical indicator math — no network calls, fully unit-testable."""


def sma_series(closes: list, window: int) -> list:
    """Simple moving average, index-aligned with `closes`. Entries before
    `window` data points are available are None.
    """
    if window <= 0:
        raise ValueError("window must be positive")

    result = [None] * len(closes)
    running_sum = 0.0
    for i, price in enumerate(closes):
        running_sum += price
        if i >= window:
            running_sum -= closes[i - window]
        if i >= window - 1:
            result[i] = running_sum / window
    return result
