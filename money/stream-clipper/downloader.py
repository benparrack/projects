"""Wraps yt-dlp for listing and downloading VODs from a YouTube channel or a
Twitch channel's past-broadcasts. Shells out to the `yt-dlp` binary rather
than importing it as a library, so a version bump is a plain `pip install -U
yt-dlp` with no code changes needed here.

Not unit-tested (network + external binary) — same convention this repo's
other money/ projects use for their live API-client modules
(odds_client.py, alpaca_client.py aren't unit-tested either; only the pure
logic that consumes their output is).
"""

import json
import subprocess

import config


class DownloadError(RuntimeError):
    pass


def _canonical_url(platform: str, entry: dict) -> str:
    """yt-dlp's --flat-playlist JSON doesn't reliably include a full playable
    URL per entry across extractors/versions (sometimes just an ID, sometimes
    a webpage_url) — build a canonical one from the ID for the two platforms
    this project targets rather than trust whichever shape shows up, falling
    back to whatever yt-dlp did give us for anything else."""
    video_id = entry.get("id")
    if platform == "youtube" and video_id:
        return f"https://www.youtube.com/watch?v={video_id}"
    if platform == "twitch" and video_id:
        return f"https://www.twitch.tv/videos/{video_id}"
    return entry.get("url") or entry.get("webpage_url")


def list_recent_videos(platform: str, channel_url: str, limit: int = 10) -> list:
    """Returns up to `limit` most recent videos/VODs for a channel as
    [{"id": ..., "title": ..., "url": ..., "upload_date": ...}, ...],
    newest first. Uses --flat-playlist so this is a fast metadata-only call,
    no video data downloaded. `platform` ("youtube" or "twitch") is used to
    build a canonical per-video URL — see _canonical_url."""
    cmd = [
        "yt-dlp",
        "--flat-playlist",
        "--playlist-end", str(limit),
        "-J",
        channel_url,
    ]
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=60)
    except subprocess.CalledProcessError as e:
        raise DownloadError(f"yt-dlp failed listing {channel_url}: {e.stderr}") from e
    except subprocess.TimeoutExpired as e:
        raise DownloadError(f"yt-dlp timed out listing {channel_url}") from e

    data = json.loads(result.stdout)
    entries = data.get("entries", [])
    return [
        {
            "id": entry.get("id"),
            "title": entry.get("title"),
            "url": _canonical_url(platform, entry),
            "upload_date": entry.get("upload_date"),
        }
        for entry in entries
        if entry.get("id")
    ]


def download_video(video_url: str, output_path: str) -> None:
    """Downloads the best available video+audio to output_path (an exact
    file path, not a yt-dlp output template — this function appends no
    extension logic, so pass the real final path including extension)."""
    cmd = [
        "yt-dlp",
        "-f", "bv*+ba/b",
        "--merge-output-format", "mp4",
        "-o", output_path,
        video_url,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=3600)
    except subprocess.CalledProcessError as e:
        raise DownloadError(f"yt-dlp failed downloading {video_url}: {e.stderr}") from e
    except subprocess.TimeoutExpired as e:
        raise DownloadError(f"yt-dlp timed out downloading {video_url}") from e


def extract_audio(input_path: str, output_path: str) -> None:
    """Extracts a mono 16kHz WAV track from a downloaded video, suitable for
    both whisper transcription and audio-energy scoring."""
    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-vn", "-ac", "1", "-ar", "16000",
        output_path,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=600)
    except subprocess.CalledProcessError as e:
        raise DownloadError(f"ffmpeg failed extracting audio from {input_path}: {e.stderr}") from e
