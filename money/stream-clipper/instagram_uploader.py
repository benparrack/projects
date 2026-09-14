"""Publishes a rendered clip to Instagram Reels via the Graph API's Content
Publishing endpoint — a two-step process (create a media container, then
publish it). Requires (all one-time, Ben-only setup — see README.md's
Instagram section): an Instagram **Business** account linked to a Facebook
Page, a Meta developer app with `instagram_business_basic` +
`instagram_business_content_publish` approved via App Review, and a
long-lived access token.

Important constraint this module can't work around: the container-creation
call takes a **publicly reachable HTTPS video_url**, not raw file bytes — the
Graph API fetches the video itself. This project's clips render to a local
`staging/` folder, so posting to Instagram means briefly hosting the
specific clip somewhere Meta's servers can reach (e.g. a short-lived signed
URL on any object store you already use, or exposing this machine's staging
dir through a tunnel) — that hosting step is intentionally left to the
caller via `video_url` rather than guessed at here, since which approach
makes sense depends on what Ben already has (see README.md).

Not unit-tested (network) — same convention as downloader.py.
"""

import time

import requests

import config

GRAPH_API_BASE = "https://graph.facebook.com/v19.0"


class InstagramUploadError(RuntimeError):
    pass


def _require_config():
    missing = [
        name
        for name, val in [
            ("IG_USER_ID", config.IG_USER_ID),
            ("IG_ACCESS_TOKEN", config.IG_ACCESS_TOKEN),
        ]
        if not val
    ]
    if missing:
        raise InstagramUploadError(
            f"Missing Instagram config: {', '.join(missing)}. "
            "These require completing Meta's App Review first — see README.md's Instagram section."
        )


def publish_reel(video_url: str, caption: str, poll_interval: int = 5, max_wait: int = 300) -> str:
    """Creates a Reels media container from a publicly-hosted video_url,
    polls until Meta finishes processing it, then publishes. Returns the
    resulting Instagram media ID."""
    _require_config()

    create_resp = requests.post(
        f"{GRAPH_API_BASE}/{config.IG_USER_ID}/media",
        data={
            "media_type": "REELS",
            "video_url": video_url,
            "caption": caption[:2200],
            "access_token": config.IG_ACCESS_TOKEN,
        },
        timeout=config.REQUEST_TIMEOUT,
    )
    if not create_resp.ok:
        raise InstagramUploadError(f"Failed to create media container: {create_resp.text}")
    container_id = create_resp.json()["id"]

    waited = 0
    while waited < max_wait:
        status_resp = requests.get(
            f"{GRAPH_API_BASE}/{container_id}",
            params={"fields": "status_code", "access_token": config.IG_ACCESS_TOKEN},
            timeout=config.REQUEST_TIMEOUT,
        )
        if not status_resp.ok:
            raise InstagramUploadError(f"Failed to poll container status: {status_resp.text}")
        status_code = status_resp.json().get("status_code")
        if status_code == "FINISHED":
            break
        if status_code == "ERROR":
            raise InstagramUploadError(f"Instagram failed processing container {container_id}")
        time.sleep(poll_interval)
        waited += poll_interval
    else:
        raise InstagramUploadError(f"Timed out waiting for container {container_id} to finish processing")

    publish_resp = requests.post(
        f"{GRAPH_API_BASE}/{config.IG_USER_ID}/media_publish",
        data={"creation_id": container_id, "access_token": config.IG_ACCESS_TOKEN},
        timeout=config.REQUEST_TIMEOUT,
    )
    if not publish_resp.ok:
        raise InstagramUploadError(f"Failed to publish container {container_id}: {publish_resp.text}")

    return publish_resp.json()["id"]
