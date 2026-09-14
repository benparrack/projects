"""Pure scoring/window-selection logic for picking highlight moments out of a
VOD timeline. No network/ffmpeg/whisper calls live here — those produce the
raw per-signal time series (chat message timestamps, audio loudness samples,
transcript segments) that this module scores and windows, so this file is
fully unit-testable with hand-built fixtures (see tests/test_highlights.py).
"""

import math
from dataclasses import dataclass, field

import numpy as np
from scipy.signal import find_peaks

import config


@dataclass
class Window:
    start: float
    end: float
    score: float
    signals: dict = field(default_factory=dict)


def bin_timestamps(timestamps, duration, bin_seconds=config.BIN_SECONDS):
    """Bucket a list of event timestamps (seconds into the VOD) into
    fixed-width bins covering [0, duration), returning one count per bin."""
    if duration <= 0:
        return []
    n_bins = max(1, math.ceil(duration / bin_seconds))
    counts = [0] * n_bins
    for t in timestamps:
        if t < 0 or t >= duration:
            continue
        counts[int(t // bin_seconds)] += 1
    return counts


def bin_samples(sample_times, sample_values, duration, bin_seconds=config.BIN_SECONDS, agg="max"):
    """Bucket a (time, value) series — e.g. per-frame audio RMS — into
    fixed-width bins, aggregating each bin with max or mean."""
    if duration <= 0 or not sample_times:
        return []
    n_bins = max(1, math.ceil(duration / bin_seconds))
    buckets = [[] for _ in range(n_bins)]
    for t, v in zip(sample_times, sample_values):
        if t < 0 or t >= duration:
            continue
        buckets[int(t // bin_seconds)].append(v)
    agg_fn = max if agg == "max" else (lambda vs: sum(vs) / len(vs))
    return [agg_fn(b) if b else 0.0 for b in buckets]


def zscore(values):
    arr = np.asarray(values, dtype=float)
    if arr.size == 0:
        return arr
    std = arr.std()
    if std == 0:
        return np.zeros_like(arr)
    return (arr - arr.mean()) / std


def find_spike_bins(values, min_zscore=config.SPIKE_MIN_ZSCORE, min_distance_bins=1):
    """Return indices of bins that spike at least `min_zscore` standard
    deviations above the mean, as local peaks — a sustained high plateau
    registers once per `min_distance_bins` rather than every bin in it."""
    z = zscore(values)
    if z.size == 0:
        return []
    peak_indices, _ = find_peaks(z, height=min_zscore, distance=max(1, min_distance_bins))
    return [int(i) for i in peak_indices]


def combine_signal_scores(signals, weights=None):
    """Elementwise-weighted-sum combine of one or more equal-length (or
    shorter, zero-padded) zscore arrays into a single composite score array.
    `signals` is a dict of name -> list[float]; `weights` a dict of name ->
    float (default 1.0 for any signal not named in `weights`). A source with
    no data at all for a given signal (empty list) contributes zero for every
    bin rather than raising — e.g. a VOD with no chat data still scores on
    audio/transcript alone."""
    named = [(name, np.asarray(vals, dtype=float)) for name, vals in signals.items() if len(vals) > 0]
    if not named:
        return np.array([])
    length = max(len(arr) for _, arr in named)
    total = np.zeros(length)
    for name, arr in named:
        w = 1.0 if weights is None else weights.get(name, 1.0)
        padded = np.pad(arr, (0, length - len(arr)))
        total += padded * w
    return total


def select_windows(composite, bin_seconds, window_seconds, top_n, min_gap_seconds=None):
    """Greedily pick the top-N non-overlapping windows by composite score.

    Each candidate window covers `window_seconds` of VOD time starting at a
    bin boundary; its score is the sum of composite scores for the bins it
    spans. Windows are selected highest-score-first, skipping any candidate
    that starts within `min_gap_seconds` of an already-selected window's
    start, so results spread across the VOD instead of clustering around one
    loud moment. Returned windows are in chronological order.
    """
    composite = np.asarray(composite, dtype=float)
    n_bins = len(composite)
    if n_bins == 0 or top_n <= 0:
        return []
    bins_per_window = max(1, int(round(window_seconds / bin_seconds)))
    if min_gap_seconds is None:
        min_gap_seconds = window_seconds
    min_gap_bins = max(1, int(round(min_gap_seconds / bin_seconds)))

    last_start = max(1, n_bins - bins_per_window + 1)
    candidates = []
    for start_bin in range(0, last_start):
        end_bin = min(start_bin + bins_per_window, n_bins)
        score = float(composite[start_bin:end_bin].sum())
        candidates.append((score, start_bin, end_bin))
    candidates.sort(key=lambda c: c[0], reverse=True)

    selected = []
    for score, start_bin, end_bin in candidates:
        if any(abs(start_bin - s[1]) < min_gap_bins for s in selected):
            continue
        selected.append((score, start_bin, end_bin))
        if len(selected) >= top_n:
            break

    selected.sort(key=lambda c: c[1])
    return [
        Window(start=start_bin * bin_seconds, end=end_bin * bin_seconds, score=score)
        for score, start_bin, end_bin in selected
    ]


def snap_to_segment_boundaries(window, segments, max_shift_seconds=config.SNAP_MAX_SHIFT_SECONDS):
    """Nudge a window's start/end to the nearest transcript segment boundary
    within `max_shift_seconds`, so clips don't cut mid-sentence. `segments`
    is a list of (start, end) tuples from the transcription step. Falls back
    to the original edge if no segment boundary is close enough."""

    def nearest_edge(target):
        best = target
        best_dist = max_shift_seconds
        for seg_start, seg_end in segments:
            for edge in (seg_start, seg_end):
                dist = abs(edge - target)
                if dist < best_dist:
                    best = edge
                    best_dist = dist
        return best

    new_start = nearest_edge(window.start)
    new_end = nearest_edge(window.end)
    if new_end <= new_start:
        return window
    return Window(start=new_start, end=new_end, score=window.score, signals=window.signals)
