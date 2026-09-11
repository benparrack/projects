"""Builds a randomly-sampled, liquidity-filtered slice of the tradable US
equity market. Kept to a fixed API call budget regardless of market size:
1 assets call + a handful of batched bars calls, never one bars call per
candidate.
"""

import random
import re

import config

SYMBOL_PATTERN = re.compile(r"^[A-Z]{1,5}$")


def fetch_tradable_assets(client) -> list:
    """One /v2/assets call, filtered to the exchange allowlist and a plain
    ticker symbol shape (excludes most class-share/warrant/unit noise —
    a documented approximation, not perfect).
    """
    assets = client.list_assets(status="active", asset_class="us_equity")
    return [
        a
        for a in assets
        if a.get("tradable")
        and a.get("exchange") in config.EXCHANGE_ALLOWLIST
        and SYMBOL_PATTERN.match(a.get("symbol", ""))
    ]


def _chunk(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _passes_liquidity_filter(bars: list) -> bool:
    min_bars_required = config.SMA_LONG_WINDOW + 1
    if not bars or len(bars) < min_bars_required:
        return False
    if bars[-1]["c"] < config.MIN_PRICE:
        return False
    recent = bars[-config.LIQUIDITY_LOOKBACK_BARS :]
    avg_volume = sum(b["v"] for b in recent) / len(recent)
    return avg_volume >= config.MIN_AVG_VOLUME


def build_universe(client, sample_size: int = config.UNIVERSE_SAMPLE_SIZE, rng=None, logger=None) -> dict:
    """Returns {symbol: bars} for up to `sample_size` symbols passing the
    exchange/tradability filter and a liquidity floor. The bars fetched
    here are reused downstream for signal computation — no duplicate fetch.

    Adaptive rather than a fixed candidate multiple: keeps pulling more
    batches from the shuffled pool until `sample_size` symbols pass, the
    pool is exhausted, or MAX_CANDIDATES_EXAMINED is hit (a safety ceiling
    on worst-case API calls/runtime, not a target — most runs should find
    enough symbols well before reaching it).
    """
    rng = rng or random.Random()
    filtered_assets = fetch_tradable_assets(client)
    symbols = [a["symbol"] for a in filtered_assets]
    rng.shuffle(symbols)

    universe = {}
    examined = 0

    for chunk in _chunk(symbols, config.BARS_BATCH_SIZE):
        if len(universe) >= sample_size or examined >= config.MAX_CANDIDATES_EXAMINED:
            break

        examined += len(chunk)
        try:
            # `limit` caps the TOTAL bars returned across the whole
            # multi-symbol response, not per symbol — scale it by chunk
            # size so every symbol in the batch gets its full history
            # instead of the first symbol eating the whole budget.
            batch_bars = client.get_bars(
                chunk,
                timeframe=config.BARS_TIMEFRAME,
                limit=len(chunk) * config.BARS_LIMIT,
            )
        except Exception as e:
            if logger:
                logger.warning(f"Bars batch failed for {len(chunk)} symbols, skipping: {e}")
            continue

        for symbol in chunk:
            if len(universe) >= sample_size:
                break
            bars = batch_bars.get(symbol)
            if _passes_liquidity_filter(bars):
                universe[symbol] = bars

    if logger and len(universe) < sample_size:
        logger.warning(
            f"Only found {len(universe)}/{sample_size} symbols passing filters "
            f"out of {examined} candidates examined "
            f"({'exhausted the pool' if examined < config.MAX_CANDIDATES_EXAMINED else 'hit MAX_CANDIDATES_EXAMINED'})."
        )

    return universe


def build_universe_from_symbols(client, symbols: list, logger=None) -> dict:
    """Returns {symbol: bars} for an explicit, caller-chosen symbol list —
    used for manual/dev testing against specific tickers instead of the
    random sample. Skips the liquidity/price filter (an explicit choice
    is an explicit choice); still requires enough bars to compute a signal.
    """
    min_bars_required = config.SMA_LONG_WINDOW + 1
    universe = {}

    for chunk in _chunk(symbols, config.BARS_BATCH_SIZE):
        try:
            batch_bars = client.get_bars(
                chunk,
                timeframe=config.BARS_TIMEFRAME,
                limit=len(chunk) * config.BARS_LIMIT,
            )
        except Exception as e:
            if logger:
                logger.warning(f"Bars batch failed for {len(chunk)} symbols, skipping: {e}")
            continue

        for symbol in chunk:
            bars = batch_bars.get(symbol)
            if bars and len(bars) >= min_bars_required:
                universe[symbol] = bars
            elif logger:
                logger.warning(f"{symbol}: insufficient bar history ({len(bars) if bars else 0}), skipping.")

    return universe
