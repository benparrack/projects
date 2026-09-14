"""Orchestrates one full run: for each configured source channel, find new
VODs, download them, score highlight windows from chat/audio/transcript
signals, render each selected window to a vertical clip — with a
silence-trim pacing pass, face-tracking dynamic crop, kinetic captions, and
a transcript-derived title (see pacing.py, face_track.py, transcribe.py,
titling.py) — and write it to staging/<date>/pending/ with a manifest
entry. No posting happens here — see poster.py, which is gated separately.
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
import face_track
import highlights
import manifest
import pacing
import state
import titling
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


def _compute_keep_segments(window, audio_times, audio_values, logger, clip_id) -> list:
    """Returns the pacing keep-segments for `window`, or just [(window.start,
    window.end)] unchanged if pacing is disabled or there's no silence
    worth trimming."""
    if not config.ENABLE_PACING_TRIM:
        return [(window.start, window.end)]

    window_values = [v for t, v in zip(audio_times, audio_values) if window.start <= t < window.end]
    if not window_values:
        return [(window.start, window.end)]

    threshold = max(window_values) * config.SILENCE_RELATIVE_THRESHOLD
    gaps = pacing.find_silence_gaps(
        audio_times, audio_values, window.start, window.end, threshold, config.MIN_SILENCE_GAP_SECONDS
    )
    keep_segments = pacing.keep_segments_from_gaps(
        window.start, window.end, gaps,
        min_segment_seconds=config.MIN_KEPT_SEGMENT_SECONDS,
        gap_padding_seconds=config.SILENCE_GAP_PADDING_SECONDS,
    )
    if len(keep_segments) > 1:
        logger.info(f"Pacing: trimming {len(keep_segments) - 1} silence gap(s) out of {clip_id}")
    return keep_segments


def _resolve_crop(render_input, detect_start, detect_end, width, height, logger, clip_id) -> str:
    crop_w, crop_h, static_x, static_y = clipper.compute_crop_box(width, height)
    if config.ENABLE_FACE_TRACKING:
        try:
            return face_track.dynamic_crop_for_clip(render_input, detect_start, detect_end, width, height, crop_w, crop_h)
        except Exception as e:
            logger.warning(f"Face tracking failed for {clip_id}, falling back to a static crop: {e}")
    return f"crop={crop_w}:{crop_h}:{static_x}:{static_y}"


def render_window(window, video_path, audio_times, audio_values, transcript, width, height, work_dir, pending_dir, clip_id, source_label, logger) -> str:
    """Renders one selected highlight window to a finished clip file and
    returns (filename, title, caption). Handles the pacing/no-pacing branch
    (see module docstring) so process_video itself stays about
    orchestration, not rendering mechanics."""
    keep_segments = _compute_keep_segments(window, audio_times, audio_values, logger, clip_id)
    trimmed = len(keep_segments) > 1

    if trimmed:
        render_input = os.path.join(work_dir, f"{clip_id}_paced.mp4")
        clipper.render_trimmed_clip(video_path, keep_segments, render_input)
        detect_start, detect_end = 0.0, pacing.total_duration(keep_segments)
        caption_words = pacing.remap_words(transcript["words"], keep_segments)
    else:
        render_input = video_path
        detect_start, detect_end = window.start, window.end
        caption_words = transcript["words"]

    crop_filter = _resolve_crop(render_input, detect_start, detect_end, width, height, logger, clip_id)

    title = titling.title_from_transcript(caption_words, detect_start, detect_end, source_label=source_label)
    caption = titling.caption_text(title, source_label=source_label)

    subtitles_path = os.path.join(work_dir, f"{clip_id}.ass")
    with open(subtitles_path, "w") as f:
        f.write(transcribe.build_ass_subtitles(caption_words, detect_start, detect_end))

    filename = f"{clip_id}.mp4"
    output_path = os.path.join(pending_dir, filename)
    clipper.render_clip(render_input, detect_start, detect_end, output_path, crop_filter=crop_filter, subtitles_path=subtitles_path)

    return filename, title, caption


def process_video(platform: str, video_id: str, video_url: str, logger, source_label: str = None) -> list:
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

    date_dir = _today_dir()
    pending_dir = os.path.join(date_dir, "pending")
    os.makedirs(pending_dir, exist_ok=True)

    results = []
    for window in windows:
        clip_id = _clip_id(platform, video_id, window)
        logger.info(f"Rendering clip {clip_id} ({window.start:.1f}-{window.end:.1f}, score={window.score:.2f})")

        try:
            filename, title, caption = render_window(
                window, video_path, audio_times, audio_values, transcript,
                width, height, work_dir, pending_dir, clip_id, source_label, logger,
            )
        except Exception as e:
            logger.error(f"Failed rendering {clip_id}, skipping this clip: {e}")
            continue

        manifest.append_entry(date_dir, {
            "clip_id": clip_id,
            "source_platform": platform,
            "source_video_id": video_id,
            "start": window.start,
            "end": window.end,
            "score": window.score,
            "filename": filename,
            "title": title,
            "caption": caption,
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
        source_label = source.get("label")
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
                results = process_video(platform, video_id, video["url"], logger, source_label=source_label)
                summary.clips_rendered += len(results)
                summary.videos_processed += 1
                state.mark_video_processed(platform, video_id)
            except Exception as e:  # one bad VOD shouldn't abort the whole run
                logger.error(f"Failed processing {platform} video {video_id}: {e}")
                summary.errors.append(f"{platform}/{video_id}: {e}")

    return summary
