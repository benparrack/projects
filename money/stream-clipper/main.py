#!/usr/bin/env python3
"""CLI entry point for the stream-clipper pipeline."""

import argparse
import logging
import os
import sys

import config
import pipeline
import poster
import reporter


def setup_logging(log_file: str) -> logging.Logger:
    os.makedirs(os.path.dirname(log_file) or ".", exist_ok=True)

    logger = logging.getLogger("stream_clipper")
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


def cmd_run(args, logger):
    summary = pipeline.run_cycle(logger, limit_per_source=args.limit_per_source)
    reporter.report_run_summary(summary, logger)


def cmd_post(args, logger):
    if args.post and not config.ALLOW_AUTO_POST:
        print(
            "--post was given but ALLOW_AUTO_POST is not set to true in .env — refusing to post.\n"
            "Both are required together (same double-gate pattern as this repo's alpaca-paper-trader).",
            file=sys.stderr,
        )
        sys.exit(1)

    dry_run = not args.post  # --post AND ALLOW_AUTO_POST both required to actually post; else always dry-run
    if dry_run:
        logger.info("Dry run (pass --post, with ALLOW_AUTO_POST=true in .env, to actually post).")
    else:
        logger.warning("LIVE POSTING MODE — this will publish to real accounts.")

    summary = poster.post_approved(logger, dry_run=dry_run)
    reporter.report_post_summary(summary, logger)


def cmd_status(args, logger):
    print(reporter.format_status())


def parse_args():
    parser = argparse.ArgumentParser(description="Automated highlight-clip pipeline.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser(
        "run", help="Check configured sources for new VODs, score and render clips to staging/. No posting."
    )
    run_parser.add_argument("--limit-per-source", type=int, default=3, help="Newest N videos to check per source.")
    run_parser.add_argument("--log-file", type=str, default=config.LOG_FILE)
    run_parser.set_defaults(func=cmd_run)

    post_parser = subparsers.add_parser(
        "post", help="Post clips that have been moved into staging/<date>/approved/. Dry-run unless --post is given."
    )
    post_parser.add_argument(
        "--post", action="store_true", help="Actually post (requires ALLOW_AUTO_POST=true in .env too)."
    )
    post_parser.add_argument("--log-file", type=str, default=config.LOG_FILE)
    post_parser.set_defaults(func=cmd_post)

    status_parser = subparsers.add_parser("status", help="Show config and staging/review status. Read-only.")
    status_parser.add_argument("--log-file", type=str, default=config.LOG_FILE)
    status_parser.set_defaults(func=cmd_status)

    return parser.parse_args()


def main():
    args = parse_args()
    logger = setup_logging(args.log_file)
    args.func(args, logger)


if __name__ == "__main__":
    main()
