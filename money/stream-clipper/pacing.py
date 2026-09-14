"""Detects long internal silences within a selected highlight window and
computes which sub-segments to actually keep, so a rendered clip cuts dead
air instead of preserving every pause verbatim — tighter pacing reads
better on Shorts/Reels than a raw, unedited cut. Reuses the audio-loudness
envelope already computed for highlight scoring (audio_signal.py) rather
than a second pass over the audio. All pure functions, fully unit-tested
(tests/test_pacing.py) — the actual ffmpeg trim+concat command this feeds
into lives in clipper.py.
"""


def find_silence_gaps(times: list, values: list, start: float, end: float, threshold: float, min_gap_seconds: float) -> list:
    """`times`/`values`: parallel lists from audio_signal.loudness_envelope
    (absolute-VOD-time RMS samples). Returns sorted (gap_start, gap_end)
    intervals within [start, end) where loudness stays at or below
    `threshold` for a continuous span of at least `min_gap_seconds`."""
    gaps = []
    gap_start = None
    last_silent_t = None
    for t, v in zip(times, values):
        if t < start or t >= end:
            continue
        if v <= threshold:
            if gap_start is None:
                gap_start = t
            last_silent_t = t
        else:
            if gap_start is not None and (last_silent_t - gap_start) >= min_gap_seconds:
                gaps.append((gap_start, last_silent_t))
            gap_start = None
    if gap_start is not None and (last_silent_t - gap_start) >= min_gap_seconds:
        gaps.append((gap_start, last_silent_t))
    return gaps


def keep_segments_from_gaps(
    start: float,
    end: float,
    gaps: list,
    min_segment_seconds: float = 0.3,
    gap_padding_seconds: float = 0.15,
) -> list:
    """Inverts `gaps` within [start, end) into the segments to KEEP, padding
    each gap inward by `gap_padding_seconds` on both sides so a cut doesn't
    clip the leading/trailing edge of speech right next to a pause. Drops
    the padding on a gap too short to survive it (nothing to trim there).
    Never returns an empty list — falls back to the full [start, end) span
    if trimming would remove everything."""
    if not gaps:
        return [(start, end)]

    padded_gaps = []
    for g_start, g_end in sorted(gaps):
        padded_start = g_start + gap_padding_seconds
        padded_end = g_end - gap_padding_seconds
        if padded_end > padded_start:
            padded_gaps.append((padded_start, padded_end))

    segments = []
    cursor = start
    for g_start, g_end in padded_gaps:
        if g_start > cursor:
            segments.append((cursor, g_start))
        cursor = max(cursor, g_end)
    if cursor < end:
        segments.append((cursor, end))

    kept = [s for s in segments if s[1] - s[0] >= min_segment_seconds]
    return kept if kept else [(start, end)]


def remap_time(t: float, keep_segments: list):
    """Maps an absolute VOD time `t` onto the trimmed clip's own timeline
    (0.0 = the start of the first keep segment), or None if `t` falls
    inside a removed gap or past the end of the last segment.
    `keep_segments` must be sorted and non-overlapping."""
    offset = 0.0
    for seg_start, seg_end in keep_segments:
        if t < seg_start:
            return None
        if t <= seg_end:
            return offset + (t - seg_start)
        offset += seg_end - seg_start
    return None


def total_duration(keep_segments: list) -> float:
    return sum(end - start for start, end in keep_segments)


def remap_words(words: list, keep_segments: list) -> list:
    """Shifts each word's (start, end) from absolute VOD time onto the
    trimmed clip's own timeline. A word that falls entirely inside a
    removed gap is dropped; one whose start or end (but not both) maps
    outside a keep segment is dropped too rather than guessed at — a rare
    edge case (silence-detection and word-timing are independent
    heuristics that can disagree right at a boundary), not worth a
    partial-word caption over."""
    remapped = []
    for w in words:
        new_start = remap_time(w["start"], keep_segments)
        new_end = remap_time(w["end"], keep_segments)
        if new_start is None or new_end is None or new_end <= new_start:
            continue
        remapped.append({"word": w["word"], "start": new_start, "end": new_end})
    return remapped
