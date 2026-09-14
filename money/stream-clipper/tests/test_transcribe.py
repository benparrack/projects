import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import transcribe


def test_build_ass_subtitles_includes_header():
    result = transcribe.build_ass_subtitles([], window_start=0.0, window_end=15.0)
    assert "[Script Info]" in result
    assert "[Events]" in result


def test_build_ass_subtitles_groups_words_into_chunks():
    words = [{"word": f"w{i}", "start": float(i), "end": i + 0.5} for i in range(5)]
    result = transcribe.build_ass_subtitles(words, window_start=0.0, window_end=10.0, words_per_chunk=4)
    events = [l for l in result.split("\n") if l.startswith("Dialogue:")]
    assert len(events) == 2  # 4 words + 1 leftover word
    assert "w0" in events[0] and "w3" in events[0]
    assert "w4" in events[1]


def test_build_ass_subtitles_karaoke_tags_carry_word_duration():
    words = [{"word": "hello", "start": 1.0, "end": 1.5}]
    result = transcribe.build_ass_subtitles(words, window_start=0.0, window_end=5.0, words_per_chunk=4)
    # 0.5s word duration -> 50 centiseconds; a 1.0s leading gap (word starts
    # at rel 1.0, chunk baseline is the first word's own start) -> no gap tag
    # since prev_end starts equal to the first word's start.
    assert "{\\k50}hello" in result


def test_build_ass_subtitles_inserts_gap_tag_between_words():
    words = [
        {"word": "one", "start": 0.0, "end": 0.3},
        {"word": "two", "start": 1.3, "end": 1.6},  # 1.0s silent gap before it
    ]
    result = transcribe.build_ass_subtitles(words, window_start=0.0, window_end=5.0, words_per_chunk=4)
    assert "{\\k30}one" in result
    assert "{\\k100}{\\k30}two" in result


def test_build_ass_subtitles_drops_words_outside_window():
    words = [
        {"word": "before", "start": 0.0, "end": 1.0},
        {"word": "inside", "start": 5.0, "end": 5.5},
        {"word": "after", "start": 100.0, "end": 100.5},
    ]
    result = transcribe.build_ass_subtitles(words, window_start=4.0, window_end=6.0)
    assert "inside" in result
    assert "before" not in result
    assert "after" not in result


def test_build_ass_subtitles_clips_word_spanning_boundary():
    words = [{"word": "spanning", "start": -1.0, "end": 1.0}]
    result = transcribe.build_ass_subtitles(words, window_start=0.0, window_end=5.0)
    # clipped to start at rel 0.0 -> duration 1.0s -> 100 centiseconds
    assert "{\\k100}spanning" in result
    assert "Dialogue: 0,0:00:00.00,0:00:01.00" in result


def test_build_ass_subtitles_escapes_curly_braces_in_word_text():
    words = [{"word": "{weird}", "start": 0.0, "end": 0.5}]
    result = transcribe.build_ass_subtitles(words, window_start=0.0, window_end=5.0)
    events_section = result.split("[Events]")[1]
    # the only literal braces allowed are the karaoke override tags themselves
    assert "(weird)" in events_section
    assert "{weird}" not in events_section


def test_build_ass_subtitles_skips_punctuation_only_words():
    # Real bug caught live: faster-whisper can transcribe near-silent/music
    # audio as bare "." or "..." tokens -- a caption showing just "." reads
    # worse than no caption at all.
    words = [{"word": ".", "start": 0.0, "end": 0.5}, {"word": "real", "start": 1.0, "end": 1.5}]
    result = transcribe.build_ass_subtitles(words, window_start=0.0, window_end=5.0)
    events = [l for l in result.split("\n") if l.startswith("Dialogue:")]
    assert len(events) == 1
    assert "real" in events[0]


def test_build_ass_subtitles_skips_blank_words():
    words = [{"word": "   ", "start": 0.0, "end": 0.5}, {"word": "real", "start": 1.0, "end": 1.5}]
    result = transcribe.build_ass_subtitles(words, window_start=0.0, window_end=5.0)
    events = [l for l in result.split("\n") if l.startswith("Dialogue:")]
    assert len(events) == 1
    assert "real" in events[0]


def test_build_ass_subtitles_empty_words_produces_no_events():
    result = transcribe.build_ass_subtitles([], window_start=0.0, window_end=5.0)
    events = [l for l in result.split("\n") if l.startswith("Dialogue:")]
    assert events == []
