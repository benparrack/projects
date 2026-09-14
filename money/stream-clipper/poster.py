"""Posts approved clips to their configured target platforms. The review
workflow is deliberately a plain filesystem convention, not a UI: `run`
renders clips into staging/<date>/pending/; a human reviews them and moves
(not copies) any they're happy with into staging/<date>/approved/ — this
module only ever posts a clip that exists in `approved/`, and only once per
platform (tracked both in the date's manifest.json and in state.py's
posts log, so a re-run is idempotent).

Posting itself requires BOTH `--post` on the CLI *and*
`ALLOW_AUTO_POST=true` in .env — checked in main.py before this module is
even called, plus state.can_post_now()'s daily-cap/spacing check here. A
`dry_run=True` call (the default from `main.py post` without `--post`)
logs exactly what it would do without calling any upload API, so the gate
itself is easy to prove before trusting it live.
"""

import os
from dataclasses import dataclass, field

import config
import instagram_uploader
import manifest
import state
import youtube_uploader


@dataclass
class PostSummary:
    posted: list = field(default_factory=list)  # list of (clip_id, platform)
    skipped: list = field(default_factory=list)  # list of (clip_id, platform, reason)
    errors: list = field(default_factory=list)  # list of (clip_id, platform, error)


def _approved_path(date_dir: str, filename: str) -> str:
    return os.path.join(date_dir, "approved", filename)


def _post_one(entry: dict, date_dir: str, platform: str, logger) -> str:
    video_path = _approved_path(date_dir, entry["filename"])
    if platform == "youtube":
        return youtube_uploader.upload_short(video_path, entry["title"], entry["caption"])
    if platform == "instagram":
        raise InstagramNeedsHostedURL(
            f"{entry['clip_id']}: Instagram posting needs a publicly-reachable video_url, not a local "
            "path — this project doesn't assume how you host clips for Meta to fetch. Host "
            f"{video_path} somewhere reachable and call instagram_uploader.publish_reel(url, caption) "
            "directly, or wire that hosting step in here once you've picked an approach. See "
            "README.md's Instagram section."
        )
    raise ValueError(f"Unknown platform {platform!r}")


class InstagramNeedsHostedURL(RuntimeError):
    pass


def post_approved(logger, dry_run: bool = True) -> PostSummary:
    summary = PostSummary()

    for date_dir in manifest.all_date_dirs(config.STAGING_DIR):
        entries = manifest.read_manifest(date_dir)
        if not entries:
            continue
        changed = False

        for entry in entries:
            approved_path = _approved_path(date_dir, entry["filename"])
            if not os.path.exists(approved_path):
                continue  # not yet reviewed/approved

            for platform in entry.get("target_platforms", []):
                if platform in entry.get("posted", {}):
                    continue  # already posted to this platform

                allowed, reason = state.can_post_now(platform)
                if not allowed:
                    summary.skipped.append((entry["clip_id"], platform, reason))
                    logger.info(f"Skipping {entry['clip_id']} -> {platform}: {reason}")
                    continue

                if dry_run:
                    summary.skipped.append((entry["clip_id"], platform, "dry run"))
                    logger.info(f"[dry run] Would post {entry['clip_id']} -> {platform}")
                    continue

                try:
                    remote_id = _post_one(entry, date_dir, platform, logger)
                except Exception as e:
                    summary.errors.append((entry["clip_id"], platform, str(e)))
                    logger.error(f"Failed posting {entry['clip_id']} -> {platform}: {e}")
                    continue

                posted_at = state._now_iso()
                entry.setdefault("posted", {})[platform] = {"posted_at": posted_at, "remote_id": remote_id}
                state.record_post(platform, entry["clip_id"], posted_at)
                summary.posted.append((entry["clip_id"], platform))
                logger.info(f"Posted {entry['clip_id']} -> {platform} (remote id {remote_id})")
                changed = True

        if changed:
            manifest.write_manifest(date_dir, entries)

    return summary
