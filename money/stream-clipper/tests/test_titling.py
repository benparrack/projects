import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import titling


def _words(text, start=0.0, step=0.5):
    words = []
    t = start
    for w in text.split():
        words.append({"word": w, "start": t, "end": t + 0.4})
        t += step
    return words


def test_title_from_transcript_basic():
    words = _words("that is actually insane bro")
    title = titling.title_from_transcript(words, start=0.0, end=10.0)
    assert title.startswith("That is actually insane bro")
    assert title.endswith("#Shorts")


def test_title_from_transcript_prefixes_source_label():
    words = _words("no way he just did that")
    title = titling.title_from_transcript(words, start=0.0, end=10.0, source_label="Kai Cenat")
    assert title.startswith("Kai Cenat: No way")


def test_title_from_transcript_strips_leading_trailing_filler():
    words = _words("um like that was crazy uh")
    title = titling.title_from_transcript(words, start=0.0, end=10.0)
    assert not title.lower().startswith("um")
    assert "crazy" in title


def test_title_from_transcript_only_uses_words_within_range():
    words = [
        {"word": "before", "start": 0.0, "end": 0.5},
        {"word": "inside", "start": 5.0, "end": 5.5},
        {"word": "after", "start": 20.0, "end": 20.5},
    ]
    title = titling.title_from_transcript(words, start=4.0, end=6.0)
    assert "inside" in title.lower()
    assert "before" not in title.lower()
    assert "after" not in title.lower()


def test_title_from_transcript_empty_falls_back_to_generic():
    title = titling.title_from_transcript([], start=0.0, end=10.0)
    assert title == "Highlight #Shorts"


def test_title_from_transcript_punctuation_only_falls_back_to_generic():
    # Real bug caught live: faster-whisper can transcribe near-silent/music
    # audio as bare "..." tokens -- non-empty text with no actual words.
    words = [
        {"word": "...", "start": 0.0, "end": 0.5},
        {"word": "...", "start": 1.0, "end": 1.5},
    ]
    title = titling.title_from_transcript(words, start=0.0, end=10.0, source_label="Kai Cenat")
    assert title == "Kai Cenat: Highlight #Shorts"


def test_title_from_transcript_empty_with_source_label():
    title = titling.title_from_transcript([], start=0.0, end=10.0, source_label="Speed")
    assert title == "Speed: Highlight #Shorts"


def test_title_from_transcript_respects_max_length():
    words = _words(" ".join(f"word{i}" for i in range(50)))
    title = titling.title_from_transcript(words, start=0.0, end=100.0, max_length=40)
    assert len(title) <= 40


def test_title_from_transcript_truncation_ends_at_word_boundary():
    words = _words("this sentence is definitely going to need truncating for sure")
    title = titling.title_from_transcript(words, start=0.0, end=100.0, max_length=45)
    # no chopped-mid-word artifact like "trunc…" glued mid-token
    assert "…" in title or title.endswith("#Shorts")
    body = title.split(" #Shorts")[0]
    assert not body.endswith(" ")


def test_caption_text_includes_title_and_hashtags():
    caption = titling.caption_text("Some title #Shorts", source_label="Kai Cenat")
    assert caption.startswith("Some title #Shorts")
    assert "#Shorts" in caption
    assert "#Reels" in caption
    assert "#KaiCenat" in caption


def test_caption_text_strips_non_alphanumeric_from_label_hashtag():
    caption = titling.caption_text("title", source_label="IShowSpeed!")
    assert "#IShowSpeed" in caption


def test_caption_text_dedupes_hashtags_case_insensitively():
    caption = titling.caption_text("title", extra_hashtags=["#shorts", "#Extra"])
    assert caption.lower().count("#shorts") == 1
    assert "#Extra" in caption


def test_caption_text_no_source_label():
    caption = titling.caption_text("title only")
    assert "#Shorts" in caption
    assert "#Reels" in caption
