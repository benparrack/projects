import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import transcribe


def test_build_ass_subtitles_includes_header():
    result = transcribe.build_ass_subtitles([], window_start=0.0, window_end=15.0)
    assert "[Script Info]" in result
    assert "[Events]" in result


def test_build_ass_subtitles_times_are_relative_to_window_start():
    words = [{"word": "hello", "start": 120.0, "end": 120.5}]
    result = transcribe.build_ass_subtitles(words, window_start=120.0, window_end=135.0)
    # relative start should be 0:00:00.00, not the absolute VOD timestamp
    assert "Dialogue: 0,0:00:00.00,0:00:00.50,Default,hello" in result


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
    # Word starts before the window but ends inside it -> should be clipped to start at 0.
    words = [{"word": "spanning", "start": -1.0, "end": 1.0}]
    result = transcribe.build_ass_subtitles(words, window_start=0.0, window_end=5.0)
    assert "Dialogue: 0,0:00:00.00,0:00:01.00,Default,spanning" in result


def test_build_ass_subtitles_escapes_curly_braces():
    words = [{"word": "{weird}", "start": 0.0, "end": 0.5}]
    result = transcribe.build_ass_subtitles(words, window_start=0.0, window_end=5.0)
    assert "{" not in result.split("[Events]")[1]
    assert "(weird)" in result


def test_build_ass_subtitles_skips_blank_words():
    words = [{"word": "   ", "start": 0.0, "end": 0.5}, {"word": "real", "start": 1.0, "end": 1.5}]
    result = transcribe.build_ass_subtitles(words, window_start=0.0, window_end=5.0)
    events = result.split("[Events]")[1]
    assert events.count("Dialogue:") == 1
    assert "real" in events
