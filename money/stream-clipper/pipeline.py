"""Orchestrates one full run: for each configured source channel, find new
VODs, download them, score highlight windows from chat/audio/transcript
signals, render each selected window to a vertical clip with burned-in
captions, and write it to staging/<date>/pending/ with a manifest entry.
No posting happens here — see poster.py, which is gated separately.
"""

import os
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone

import audio_signal
import chat_client
import clipper
import config
import downloader
import highlights
import manifest
import state
import transcribe


@dataclass
class ClipResult:
    clip_id: str
    source_platform: str
    source_video_id: str
    start: float
    end: float
    score: float
    filename: str


@dataclass
class RunSummary:
    videos_checked: int = 0
    videos_processed: int = 0
    clips_rendered: int = 0
    errors: list = field(default_factory=list)


def _today_dir() -> str:
    date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    return os.path.join(config.STAGING_DIR, date_str)


def _clip_id(platform: str, video_id: str, window) -> str:
    return f"{platform}_{video_id}_{window.start:.1f}-{window.end:.1f}"


def _probe_duration(video_path: str) -> float:
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        video_path,
    ]
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return float(result.stdout.strip())


def process_video(platform: str, video_id: str, video_url: str, logger) -> list:
    """Downloads one VOD, scores it, renders its selected clips, and returns
    the list of ClipResult produced (possibly empty, e.g. a very short or
    low-signal VOD)."""
    work_dir = os.path.join(config.WORK_DIR, f"{platform}_{video_id}")
    os.makedirs(work_dir, exist_ok=True)
    video_path = os.path.join(work_dir, "source.mp4")
    audio_path = os.path.join(work_dir, "audio.wav")

    logger.info(f"Downloading {platform} video {video_id}")
    downloader.download_video(video_url, video_path)
    downloader.extract_audio(video_path, audio_path)

    width, height = clipper.probe_dimensions(video_path)
    duration = _probe_duration(video_path)

    logger.info(f"Fetching chat replay for {video_id}")
    chat_timestamps = []
    try:
        chat_timestamps = chat_client.fetch_message_timestamps(video_url)
    except chat_client.ChatFetchError as e:
        logger.warning(f"Chat fetch failed for {video_id}, continuing without it: {e}")

    logger.info(f"Extracting audio-energy signal for {video_id}")
    audio_times, audio_values = audio_signal.loudness_envelope(audio_path)

    logger.info(f"Transcribing {video_id}")
    transcript = transcribe.transcribe_audio(audio_path)

    chat_bins = highlights.bin_timestamps(chat_timestamps, duration)
    audio_bins = highlights.bin_samples(audio_times, audio_values, duration)
    transcript_bins = highlights.bin_timestamps([w["start"] for w in transcript["words"]], duration)

    composite = highlights.combine_signal_scores(
        {
            "chat": highlights.zscore(chat_bins),
            "audio": highlights.zscore(audio_bins),
            "transcript": highlights.zscore(transcript_bins),
        },
        weights=config.SIGNAL_WEIGHTS,
    )
    windows = highlights.select_windows(
        composite,
        bin_seconds=config.BIN_SECONDS,
        window_seconds=config.WINDOW_SECONDS,
        top_n=config.TOP_N_CLIPS_PER_VOD,
        min_gap_seconds=config.MIN_GAP_SECONDS,
    )
    windows = [highlights.snap_to_segment_boundaries(w, transcript["segments"]) for w in windows]

    crop_filter = clipper.build_crop_filter(width, height)
    date_dir = _today_dir()
    pending_dir = os.path.join(date_dir, "pending")
    os.makedirs(pending_dir, exist_ok=True)

    results = []
    for window in windows:
        clip_id = _clip_id(platform, video_id, window)
        filename = f"{clip_id}.mp4"
        output_path = os.path.join(pending_dir, filename)
        subtitles_path = os.path.join(work_dir, f"{clip_id}.ass")

        with open(subtitles_path, "w") as f:
            f.write(transcribe.build_ass_subtitles(transcript["words"], window.start, window.end))

        logger.info(
            f"Rendering clip {clip_id} ({window.start:.1f}-{window.end:.1f}, score={window.score:.2f})"
        )
        clipper.render_clip(
            video_path, window.start, window.end, output_path,
            crop_filter=crop_filter, subtitles_path=subtitles_path,
        )

        manifest.append_entry(date_dir, {
            "clip_id": clip_id,
            "source_platform": platform,
            "source_video_id": video_id,
            "start": window.start,
            "end": window.end,
            "score": window.score,
            "filename": filename,
            "title": f"{video_id} highlight #Shorts",
            "caption": f"Highlight from {video_id} #Shorts #Reels",
            "target_platforms": ["youtube"],
            "posted": {},
        })
        results.append(ClipResult(clip_id, platform, video_id, window.start, window.end, window.score, filename))

    return results


def run_cycle(logger, limit_per_source: int = 3) -> RunSummary:
    summary = RunSummary()

    if not config.SOURCE_CHANNELS:
        logger.warning("No SOURCE_CHANNELS configured in config.py — nothing to do. See README.md Setup.")
        return summary

    for source in config.SOURCE_CHANNELS:
        platform = source["platform"]
        channel_url = source["channel_url"]
        try:
            videos = downloader.list_recent_videos(platform, channel_url, limit=limit_per_source)
        except downloader.DownloadError as e:
            summary.errors.append(str(e))
            logger.error(str(e))
            continue

        for video in videos:
            summary.videos_checked += 1
            video_id = video["id"]
            if state.is_video_processed(platform, video_id):
                continue
            try:
                results = process_video(platform, video_id, video["url"], logger)
                summary.clips_rendered += len(results)
                summary.videos_processed += 1
                state.mark_video_processed(platform, video_id)
            except Exception as e:  # one bad VOD shouldn't abort the whole run
                logger.error(f"Failed processing {platform} video {video_id}: {e}")
                summary.errors.append(f"{platform}/{video_id}: {e}")

    return summary
