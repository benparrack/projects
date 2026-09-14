import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import highlights


def test_bin_timestamps_counts_events_per_bucket():
    # duration=20, bin_seconds=5 -> 4 bins: [0-5) [5-10) [10-15) [15-20)
    timestamps = [1.0, 2.0, 4.9, 6.0, 19.9, 100.0, -1.0]
    counts = highlights.bin_timestamps(timestamps, duration=20, bin_seconds=5)
    assert counts == [3, 1, 0, 1]


def test_bin_timestamps_empty_duration():
    assert highlights.bin_timestamps([1.0], duration=0, bin_seconds=5) == []


def test_bin_samples_max_aggregation():
    times = [0.5, 1.5, 6.0, 6.5]
    values = [1.0, 3.0, 10.0, 2.0]
    binned = highlights.bin_samples(times, values, duration=10, bin_seconds=5, agg="max")
    assert binned == [3.0, 10.0]


def test_bin_samples_mean_aggregation():
    times = [0.0, 1.0]
    values = [2.0, 4.0]
    binned = highlights.bin_samples(times, values, duration=5, bin_seconds=5, agg="mean")
    assert binned == [3.0]


def test_zscore_constant_input_is_all_zero():
    z = highlights.zscore([5.0, 5.0, 5.0])
    assert list(z) == [0.0, 0.0, 0.0]


def test_zscore_empty_input():
    assert highlights.zscore([]).size == 0


def test_find_spike_bins_flags_the_outlier():
    values = [1, 1, 1, 1, 20, 1, 1, 1]
    spikes = highlights.find_spike_bins(values, min_zscore=1.5)
    assert spikes == [4]


def test_find_spike_bins_no_spike_in_flat_signal():
    assert highlights.find_spike_bins([3, 3, 3, 3], min_zscore=1.5) == []


def test_combine_signal_scores_weights_and_pads():
    signals = {"a": [1.0, 2.0, 3.0], "b": [1.0]}  # b is shorter -> zero-padded
    combined = highlights.combine_signal_scores(signals, weights={"a": 1.0, "b": 2.0})
    assert list(combined) == [1.0 * 1 + 1.0 * 2, 2.0 * 1, 3.0 * 1]


def test_combine_signal_scores_missing_signal_defaults_weight_one():
    combined = highlights.combine_signal_scores({"a": [1.0, 2.0]})
    assert list(combined) == [1.0, 2.0]


def test_combine_signal_scores_all_empty_returns_empty():
    combined = highlights.combine_signal_scores({"a": [], "b": []})
    assert combined.size == 0


def test_select_windows_picks_highest_scoring_non_overlapping():
    # 10 bins of 5s each = 50s of VOD. Put a strong peak early and a stronger one late.
    composite = [0, 0, 5, 0, 0, 0, 0, 0, 10, 0]
    windows = highlights.select_windows(
        composite, bin_seconds=5, window_seconds=10, top_n=2, min_gap_seconds=10
    )
    assert len(windows) == 2
    # chronological order
    assert windows[0].start < windows[1].start
    # the later window should be the one containing the score-10 bin (bin 8 -> 40s)
    assert windows[1].start <= 40.0 < windows[1].end


def test_select_windows_respects_min_gap():
    # Two adjacent hot bins right next to each other should only yield one
    # window when min_gap_seconds spans both.
    composite = [0, 10, 10, 0, 0, 0]
    windows = highlights.select_windows(
        composite, bin_seconds=5, window_seconds=5, top_n=5, min_gap_seconds=25
    )
    assert len(windows) == 1


def test_select_windows_empty_composite():
    assert highlights.select_windows([], bin_seconds=5, window_seconds=15, top_n=3) == []


def test_select_windows_top_n_zero():
    assert highlights.select_windows([1, 2, 3], bin_seconds=5, window_seconds=5, top_n=0) == []


def test_snap_to_segment_boundaries_moves_to_nearest_edge():
    window = highlights.Window(start=10.0, end=25.0, score=1.0)
    segments = [(0.0, 9.2), (9.2, 24.5), (24.5, 40.0)]
    snapped = highlights.snap_to_segment_boundaries(window, segments, max_shift_seconds=3.0)
    assert snapped.start == 9.2
    assert snapped.end == 24.5


def test_snap_to_segment_boundaries_falls_back_when_nothing_close():
    window = highlights.Window(start=10.0, end=25.0, score=1.0)
    segments = [(0.0, 1.0), (50.0, 51.0)]  # nothing within max_shift_seconds
    snapped = highlights.snap_to_segment_boundaries(window, segments, max_shift_seconds=3.0)
    assert snapped.start == 10.0
    assert snapped.end == 25.0


def test_snap_to_segment_boundaries_never_produces_invalid_window():
    window = highlights.Window(start=10.0, end=10.5, score=1.0)
    # A boundary that would collapse start >= end should be rejected, keeping the original.
    segments = [(10.4, 10.4)]
    snapped = highlights.snap_to_segment_boundaries(window, segments, max_shift_seconds=1.0)
    assert snapped.end > snapped.start
