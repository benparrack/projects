"""Formats pipeline run/post results and status into human-readable output,
same role as alpaca-paper-trader/reporter.py."""

import logging
import os

import config
import manifest


def report_run_summary(summary, logger: logging.Logger) -> None:
    logger.info(
        f"Run complete: {summary.videos_checked} videos checked, "
        f"{summary.videos_processed} newly processed, {summary.clips_rendered} clips rendered, "
        f"{len(summary.errors)} errors."
    )
    for err in summary.errors:
        logger.error(f"  - {err}")


def report_post_summary(summary, logger: logging.Logger) -> None:
    logger.info(
        f"Post pass complete: {len(summary.posted)} posted, "
        f"{len(summary.skipped)} skipped, {len(summary.errors)} errors."
    )
    for clip_id, platform, reason in summary.errors:
        logger.error(f"  - {clip_id} -> {platform}: {reason}")


def format_status() -> str:
    lines = []
    lines.append("=" * 60)
    lines.append("STREAM CLIPPER — STATUS")
    lines.append("=" * 60)
    lines.append(f"Auto-post enabled (ALLOW_AUTO_POST): {config.ALLOW_AUTO_POST}")
    lines.append(f"Configured sources: {len(config.SOURCE_CHANNELS)}")
    for src in config.SOURCE_CHANNELS:
        lines.append(f"  - {src['platform']}: {src['channel_url']}")
    lines.append("-" * 60)

    for date_dir in manifest.all_date_dirs(config.STAGING_DIR):
        entries = manifest.read_manifest(date_dir)
        if not entries:
            continue
        pending_dir = os.path.join(date_dir, "pending")
        approved_dir = os.path.join(date_dir, "approved")
        pending_count = len(os.listdir(pending_dir)) if os.path.isdir(pending_dir) else 0
        approved_count = len(os.listdir(approved_dir)) if os.path.isdir(approved_dir) else 0
        posted_count = sum(1 for e in entries if e.get("posted"))
        lines.append(
            f"{os.path.basename(date_dir)}: {len(entries)} clips "
            f"({pending_count} pending review, {approved_count} approved, {posted_count} posted)"
        )
    lines.append("=" * 60)
    return "\n".join(lines)
