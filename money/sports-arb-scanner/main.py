#!/usr/bin/env python3
"""CLI entry point for the sports arbitrage scanner."""

import argparse
import logging
import os
import sys

import config
from odds_client import OddsAPIClient, OddsAPIError
from reporter import report
from scanner import run_scan


def setup_logging(log_file: str) -> logging.Logger:
    os.makedirs(os.path.dirname(log_file) or ".", exist_ok=True)

    logger = logging.getLogger("arb_scanner")
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


def parse_args():
    parser = argparse.ArgumentParser(description="Sports betting arbitrage scanner (soccer).")
    parser.add_argument(
        "--leagues",
        type=str,
        default=None,
        help="Comma-separated Odds API sport keys, e.g. soccer_epl,soccer_italy_serie_a "
        "(default: a preset list of major leagues; run --list-sports to see valid keys).",
    )
    parser.add_argument(
        "--regions",
        type=str,
        default=config.DEFAULT_REGIONS,
        help=f"Comma-separated bookmaker regions (default: {config.DEFAULT_REGIONS}).",
    )
    parser.add_argument(
        "--bankroll",
        type=float,
        default=config.DEFAULT_BANKROLL,
        help=f"Example bankroll for stake sizing (default: {config.DEFAULT_BANKROLL}).",
    )
    parser.add_argument(
        "--min-margin",
        type=float,
        default=config.DEFAULT_MIN_MARGIN,
        help="Minimum profit margin percent to report (default: 0, i.e. any arbitrage).",
    )
    parser.add_argument(
        "--log-file",
        type=str,
        default=config.LOG_FILE,
        help=f"Path to log file (default: {config.LOG_FILE}).",
    )
    parser.add_argument(
        "--list-sports",
        action="store_true",
        help="List currently active soccer league keys (free call) and exit.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    logger = setup_logging(args.log_file)

    if not config.API_KEY:
        print(
            "ODDS_API_KEY is not set. Copy .env.example to .env and add your key.\n"
            "Get a free API key at https://the-odds-api.com/",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        client = OddsAPIClient(config.API_KEY)

        if args.list_sports:
            sports = client.get_soccer_sports()
            print(f"{'key':<35}{'title'}")
            for s in sports:
                print(f"{s['key']:<35}{s['title']}")
            sys.exit(0)

        leagues = (
            args.leagues.split(",") if args.leagues else config.DEFAULT_LEAGUES
        )
        league_titles = {key: key for key in leagues}

        opportunities, quota_info, events_analyzed = run_scan(
            client,
            leagues,
            league_titles,
            args.regions,
            args.bankroll,
            logger,
            commissions=config.EXCHANGE_COMMISSIONS,
        )

        min_margin_fraction = args.min_margin / 100.0
        filtered = [
            o for o in opportunities if o.profit_margin >= min_margin_fraction
        ]

        report(filtered, logger)

        remaining = quota_info.get("remaining") if quota_info else "unknown"
        logger.info(
            f"Scan complete: {len(leagues)} leagues checked, "
            f"{events_analyzed} events analyzed, "
            f"{len(filtered)} arbitrage opportunit{'y' if len(filtered) == 1 else 'ies'} found. "
            f"API credits remaining: {remaining}."
        )

    except OddsAPIError as e:
        logger.error(str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
