#!/usr/bin/env python3
"""CLI entry point for the Alpaca paper-trading bot."""

import argparse
import logging
import os
import sys

import config
import state
from alpaca_client import AlpacaAPIError, AlpacaClient, resolve_base_url
from reporter import format_status, report_run_summary
from trader import run_cycle


def setup_logging(log_file: str) -> logging.Logger:
    os.makedirs(os.path.dirname(log_file) or ".", exist_ok=True)

    logger = logging.getLogger("paper_trader")
    logger.setLevel(logging.DEBUG)
    logger.handlers.clear()

    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")

    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    file_handler = logging.FileHandler(log_file, mode="a")
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger


def _require_keys():
    if not config.ALPACA_API_KEY or not config.ALPACA_SECRET_KEY:
        print(
            "ALPACA_API_KEY / ALPACA_SECRET_KEY are not set. Copy .env.example to .env and add your paper keys.\n"
            "Get free paper trading keys at https://alpaca.markets/",
            file=sys.stderr,
        )
        sys.exit(1)


def _build_client(live: bool) -> AlpacaClient:
    try:
        base_url = resolve_base_url(live)
        client = AlpacaClient(config.ALPACA_API_KEY, config.ALPACA_SECRET_KEY, base_url)
    except AlpacaAPIError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)

    if client.is_live:
        print(
            "!!! LIVE TRADING MODE — real money, real orders. !!!",
            file=sys.stderr,
        )
    return client


def _execute_cycle(args, logger):
    client = _build_client(args.live)
    symbols = [s.strip().upper() for s in args.symbols.split(",")] if args.symbols else None
    try:
        summary = run_cycle(client, logger, sample_size=args.sample_size, symbols=symbols)
        account = client.get_account()
        report_run_summary(summary, account, logger)
    except AlpacaAPIError as e:
        logger.error(str(e))
        sys.exit(1)


def cmd_run(args, logger):
    _execute_cycle(args, logger)


def cmd_scheduled_run(args, logger):
    if not state.is_enabled():
        logger.info("Bot is disabled (run `python main.py enable` to turn on). Skipping.")
        sys.exit(0)
    _execute_cycle(args, logger)


def cmd_enable(args, logger):
    state.set_enabled(True)
    print("Scheduled runs enabled. (Manual `run` was already unaffected either way.)")


def cmd_disable(args, logger):
    state.set_enabled(False)
    print("Scheduled runs disabled. (Manual `run` is still unaffected and will still execute.)")


def cmd_status(args, logger):
    client = _build_client(args.live)
    try:
        account = client.get_account()
        positions = client.get_positions()
        open_orders = client.get_open_orders()
    except AlpacaAPIError as e:
        logger.error(str(e))
        sys.exit(1)

    print(format_status(account, positions, open_orders, state.is_enabled()))


def parse_args():
    parser = argparse.ArgumentParser(description="Alpaca paper-trading bot (SMA crossover strategy).")
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_common(sub):
        sub.add_argument("--sample-size", type=int, default=config.UNIVERSE_SAMPLE_SIZE)
        sub.add_argument(
            "--symbols",
            type=str,
            default=None,
            help="Comma-separated tickers to evaluate instead of a random sample (e.g. TSLA,NVDA). "
            "Skips the liquidity/price filter since these are explicitly chosen.",
        )
        sub.add_argument("--live", action="store_true", help="Use the LIVE endpoint (requires ALLOW_LIVE_TRADING=true).")
        sub.add_argument("--log-file", type=str, default=config.LOG_FILE)

    run_parser = subparsers.add_parser("run", help="Run one scan-and-trade cycle immediately.")
    add_common(run_parser)
    run_parser.set_defaults(func=cmd_run)

    scheduled_parser = subparsers.add_parser(
        "scheduled-run", help="Run one cycle only if scheduled runs are enabled."
    )
    add_common(scheduled_parser)
    scheduled_parser.set_defaults(func=cmd_scheduled_run)

    enable_parser = subparsers.add_parser("enable", help="Enable scheduled runs.")
    enable_parser.set_defaults(func=cmd_enable, log_file=config.LOG_FILE)

    disable_parser = subparsers.add_parser("disable", help="Disable scheduled runs.")
    disable_parser.set_defaults(func=cmd_disable, log_file=config.LOG_FILE)

    status_parser = subparsers.add_parser("status", help="Show account, positions, and orders. Read-only.")
    status_parser.add_argument("--live", action="store_true")
    status_parser.set_defaults(func=cmd_status, log_file=config.LOG_FILE)

    return parser.parse_args()


def main():
    args = parse_args()
    logger = setup_logging(args.log_file)
    _require_keys()
    args.func(args, logger)


if __name__ == "__main__":
    main()
