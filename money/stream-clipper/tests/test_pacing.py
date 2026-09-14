import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pacing


def test_find_silence_gaps_detects_one_long_gap():
    # samples every 0.5s from 0 to 10s; silent (0.0) from 3.0 to 6.0
    times = [i * 0.5 for i in range(21)]
    values = [0.0 if 3.0 <= t <= 6.0 else 1.0 for t in times]
    gaps = pacing.find_silence_gaps(times, values, start=0.0, end=10.0, threshold=0.1, min_gap_seconds=1.0)
    assert len(gaps) == 1
    gap_start, gap_end = gaps[0]
    assert 2.9 <= gap_start <= 3.1
    assert 5.9 <= gap_end <= 6.1


def test_find_silence_gaps_ignores_short_gaps():
    times = [i * 0.5 for i in range(21)]
    values = [0.0 if 3.0 <= t <= 3.4 else 1.0 for t in times]  # ~0.4s gap
    gaps = pacing.find_silence_gaps(times, values, start=0.0, end=10.0, threshold=0.1, min_gap_seconds=1.0)
    assert gaps == []


def test_find_silence_gaps_respects_window_bounds():
    times = [i * 0.5 for i in range(21)]
    values = [0.0 if t < 2.0 else 1.0 for t in times]  # silence only before the window
    gaps = pacing.find_silence_gaps(times, values, start=2.0, end=10.0, threshold=0.1, min_gap_seconds=1.0)
    assert gaps == []


def test_find_silence_gaps_no_silence_at_all():
    times = [0.0, 1.0, 2.0]
    values = [1.0, 1.0, 1.0]
    assert pacing.find_silence_gaps(times, values, 0.0, 3.0, threshold=0.1, min_gap_seconds=0.5) == []


def test_keep_segments_from_gaps_no_gaps_returns_full_span():
    assert pacing.keep_segments_from_gaps(0.0, 15.0, []) == [(0.0, 15.0)]


def test_keep_segments_from_gaps_inverts_a_single_gap():
    segments = pacing.keep_segments_from_gaps(0.0, 15.0, [(5.0, 8.0)], gap_padding_seconds=0.0)
    assert segments == [(0.0, 5.0), (8.0, 15.0)]


def test_keep_segments_from_gaps_applies_padding():
    segments = pacing.keep_segments_from_gaps(0.0, 15.0, [(5.0, 8.0)], gap_padding_seconds=0.2)
    assert segments == [(0.0, 5.2), (7.8, 15.0)]


def test_keep_segments_from_gaps_drops_too_short_padded_gap():
    # a 0.2s gap with 0.15s padding on each side would invert -> skipped entirely
    segments = pacing.keep_segments_from_gaps(0.0, 15.0, [(5.0, 5.2)], gap_padding_seconds=0.15)
    assert segments == [(0.0, 15.0)]


def test_keep_segments_from_gaps_drops_tiny_resulting_segment():
    # gap near the very start leaves only a 0.1s sliver before it
    segments = pacing.keep_segments_from_gaps(
        0.0, 15.0, [(0.1, 5.0)], min_segment_seconds=0.3, gap_padding_seconds=0.0
    )
    assert segments == [(5.0, 15.0)]


def test_keep_segments_from_gaps_never_returns_empty():
    # a gap spanning almost the entire window would otherwise trim it to nothing
    segments = pacing.keep_segments_from_gaps(0.0, 15.0, [(0.0, 15.0)], gap_padding_seconds=0.0)
    assert segments == [(0.0, 15.0)]


def test_keep_segments_from_gaps_multiple_gaps():
    segments = pacing.keep_segments_from_gaps(
        0.0, 20.0, [(5.0, 7.0), (12.0, 14.0)], gap_padding_seconds=0.0
    )
    assert segments == [(0.0, 5.0), (7.0, 12.0), (14.0, 20.0)]


def test_remap_time_within_first_segment():
    keep = [(5.0, 10.0), (15.0, 20.0)]
    assert pacing.remap_time(6.0, keep) == 1.0


def test_remap_time_within_second_segment_offsets_by_first():
    keep = [(5.0, 10.0), (15.0, 20.0)]
    assert pacing.remap_time(16.0, keep) == 6.0  # 5.0 (first segment) + 1.0


def test_remap_time_inside_gap_returns_none():
    keep = [(5.0, 10.0), (15.0, 20.0)]
    assert pacing.remap_time(12.0, keep) is None


def test_remap_time_before_everything_returns_none():
    keep = [(5.0, 10.0)]
    assert pacing.remap_time(1.0, keep) is None


def test_remap_time_after_everything_returns_none():
    keep = [(5.0, 10.0)]
    assert pacing.remap_time(11.0, keep) is None


def test_total_duration_sums_segments():
    assert pacing.total_duration([(0.0, 5.0), (7.0, 12.0), (14.0, 20.0)]) == 16.0


def test_remap_words_shifts_and_drops_gap_words():
    keep = [(5.0, 10.0), (15.0, 20.0)]
    words = [
        {"word": "kept1", "start": 6.0, "end": 6.5},
        {"word": "dropped", "start": 11.0, "end": 11.5},  # entirely in the gap
        {"word": "kept2", "start": 16.0, "end": 16.5},
    ]
    remapped = pacing.remap_words(words, keep)
    assert [w["word"] for w in remapped] == ["kept1", "kept2"]
    assert remapped[0]["start"] == 1.0
    assert remapped[1]["start"] == 6.0  # 5.0 offset + 1.0


def test_remap_words_drops_straddling_word():
    keep = [(5.0, 10.0), (15.0, 20.0)]
    straddler = [{"word": "straddle", "start": 9.5, "end": 10.5}]  # ends past the segment boundary
    assert pacing.remap_words(straddler, keep) == []
