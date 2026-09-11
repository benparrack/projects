"""Orchestration: fetch account/positions state, build the universe, evaluate
signals, and place paper orders — with tiered error handling so a failure
in one place doesn't silently take down unrelated parts of the run.
"""

from dataclasses import dataclass, field
from datetime import date

import config
import universe as universe_module
from alpaca_client import AlpacaAPIError
from strategy import Signal, sma_crossover_signal


@dataclass
class RunSummary:
    symbols_scanned: int = 0
    buys: int = 0
    sells: int = 0
    holds: int = 0
    errors: int = 0
    decisions: list = field(default_factory=list)  # list of str, for reporting


def run_cycle(
    client,
    logger,
    sample_size: int = config.UNIVERSE_SAMPLE_SIZE,
    notional_per_trade: float = config.NOTIONAL_PER_TRADE,
    max_positions: int = config.MAX_CONCURRENT_POSITIONS,
    symbols: list = None,
) -> RunSummary:
    summary = RunSummary()

    account = client.get_account()
    if account is None:
        raise AlpacaAPIError("Could not fetch account info.")
    if account.get("trading_blocked") or account.get("account_blocked"):
        logger.error(
            "Account is trading_blocked/account_blocked — aborting run without evaluating any signals."
        )
        return summary

    positions = {p["symbol"]: p for p in client.get_positions()}
    open_symbols = {o["symbol"] for o in client.get_open_orders()}

    open_position_count = len(positions)

    if symbols:
        market_universe = universe_module.build_universe_from_symbols(client, symbols, logger=logger)
    else:
        market_universe = universe_module.build_universe(client, sample_size, logger=logger)
    summary.symbols_scanned = len(market_universe)

    for symbol, bars in market_universe.items():
        try:
            closes = [b["c"] for b in bars]
            signal = sma_crossover_signal(closes)

            if symbol in open_symbols:
                summary.holds += 1
                summary.decisions.append(f"{symbol}: {signal.value} -> SKIP (open order pending)")
                continue

            held = positions.get(symbol)

            if signal == Signal.BUY:
                if held is not None:
                    summary.holds += 1
                    summary.decisions.append(f"{symbol}: BUY signal -> HOLD (already held)")
                elif open_position_count >= max_positions:
                    summary.holds += 1
                    summary.decisions.append(f"{symbol}: BUY signal -> SKIP (position cap reached)")
                else:
                    client_order_id = f"papertrader-{symbol}-{date.today().isoformat()}-buy"
                    client.submit_order(
                        symbol,
                        "buy",
                        type_="market",
                        time_in_force="day",
                        notional=notional_per_trade,
                        client_order_id=client_order_id,
                    )
                    open_position_count += 1
                    summary.buys += 1
                    summary.decisions.append(f"{symbol}: BUY -> order submitted (${notional_per_trade:.2f})")

            elif signal == Signal.SELL:
                if held is not None:
                    client_order_id = f"papertrader-{symbol}-{date.today().isoformat()}-sell"
                    client.submit_order(
                        symbol,
                        "sell",
                        type_="market",
                        time_in_force="day",
                        qty=held["qty"],
                        client_order_id=client_order_id,
                    )
                    open_position_count -= 1
                    summary.sells += 1
                    summary.decisions.append(f"{symbol}: SELL -> order submitted (qty {held['qty']})")
                else:
                    summary.holds += 1
                    summary.decisions.append(f"{symbol}: SELL signal -> HOLD (no position held)")

            else:
                summary.holds += 1
                summary.decisions.append(f"{symbol}: HOLD")

        except AlpacaAPIError as e:
            summary.errors += 1
            logger.error(f"[{symbol}] Skipping — {e}")
            continue

    return summary
