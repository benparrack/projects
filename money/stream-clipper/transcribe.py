"""Local speech-to-text via faster-whisper (no API cost, CPU-capable) plus
building the burned-in .ass caption file for one rendered clip from the
word-level timestamps it produces. `transcribe_audio` is the untested I/O
wrapper (loads a real model); everything else here is pure and unit-tested
(tests/test_transcribe.py).

Captions render as short multi-word phrases using ASS's native `\\k` simple
karaoke tags, rather than one word alone on screen at a time — each word
turns from white to yellow the instant it's spoken, staying visible next to
the words around it (the "kinetic captions" look most Shorts/Reels editors
use), instead of the plain single-word-at-a-time style this project shipped
with initially.
"""

import config

# DejaVu Sans is the confirmed-installed bold sans-serif on this machine's
# libass setup (Arial itself usually isn't present on Linux) — checked via
# `fc-list`. SecondaryColour is what unspoken text in a \\k phrase starts as;
# PrimaryColour is what it turns as each word's karaoke timer elapses, per
# the ASS simple-karaoke spec (Secondary -> Primary on each \\kN boundary).
ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Outline, Shadow, Alignment, MarginV
Style: Default,DejaVu Sans,88,&H0000FFFF,&H00FFFFFF,&H00000000,&H00000000,1,4,1,2,160

[Events]
Format: Layer, Start, End, Style, Text
"""


def transcribe_audio(audio_path: str, model_size: str = config.WHISPER_MODEL_SIZE) -> dict:
    """Runs faster-whisper over the given audio file and returns
    {"segments": [(start, end), ...], "words": [{"word", "start", "end"}, ...],
    "language": str}. Imports faster_whisper lazily so the rest of this
    module (and its pure functions) stay importable without the model
    package/weights installed."""
    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device=config.WHISPER_DEVICE, compute_type=config.WHISPER_COMPUTE_TYPE)
    segments_iter, info = model.transcribe(audio_path, word_timestamps=True)

    segments = []
    words = []
    for seg in segments_iter:
        segments.append((seg.start, seg.end))
        if seg.words:
            for w in seg.words:
                words.append({"word": w.word, "start": w.start, "end": w.end})

    return {"segments": segments, "words": words, "language": info.language}


def _ass_timestamp(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _clean_word(raw: str) -> str:
    return raw.strip().replace("\n", " ").replace("{", "(").replace("}", ")")


def _words_in_window(words: list, window_start: float, window_end: float) -> list:
    """Filters to words overlapping [window_start, window_end), clipped to
    it, with times shifted to be relative to window_start (0.00 = clip
    start). Drops anything that cleans to empty text."""
    result = []
    for w in words:
        if w["end"] <= window_start or w["start"] >= window_end:
            continue
        rel_start = max(0.0, w["start"] - window_start)
        rel_end = min(window_end - window_start, w["end"] - window_start)
        if rel_end <= rel_start:
            continue
        text = _clean_word(w["word"])
        # Same fix as titling.py's title_from_transcript: whisper can emit
        # punctuation-only tokens ("...", ".") for near-silent/music audio —
        # a caption showing just "." is worse than no caption at all there.
        if not text or not any(c.isalnum() for c in text):
            continue
        result.append({"word": text, "start": rel_start, "end": rel_end})
    return result


def _centiseconds(seconds: float) -> int:
    return max(0, round(seconds * 100))


def _karaoke_line(chunk: list) -> str:
    """Builds one ASS event's Text field for a chunk of words: a leading
    {\\kN} tag per word for its own spoken duration, plus a zero-text {\\kN}
    tag for any gap before it, so the highlight timing tracks real speech
    rather than assuming words are back-to-back."""
    parts = []
    prev_end = chunk[0]["start"]
    for w in chunk:
        gap = w["start"] - prev_end
        if gap > 0:
            parts.append(f"{{\\k{_centiseconds(gap)}}}")
        parts.append(f"{{\\k{_centiseconds(w['end'] - w['start'])}}}{w['word']} ")
        prev_end = w["end"]
    return "".join(parts).rstrip()


def build_ass_subtitles(
    words: list,
    window_start: float,
    window_end: float,
    width: int = config.OUTPUT_WIDTH,
    height: int = config.OUTPUT_HEIGHT,
    words_per_chunk: int = 4,
) -> str:
    """Build an .ass subtitle document as short multi-word karaoke-highlight
    phrases (see module docstring), timed relative to the *clip's own*
    start. Words outside [window_start, window_end) are dropped; a word
    spanning the boundary is clipped to it. `words_per_chunk` controls how
    many words share one on-screen line before the next phrase replaces it —
    lower reads punchier, higher keeps more context on screen at once."""
    in_window = _words_in_window(words, window_start, window_end)
    lines = [ASS_HEADER.format(width=width, height=height)]
    for i in range(0, len(in_window), max(1, words_per_chunk)):
        chunk = in_window[i : i + words_per_chunk]
        text = _karaoke_line(chunk)
        if not text:
            continue
        start = chunk[0]["start"]
        end = chunk[-1]["end"]
        lines.append(f"Dialogue: 0,{_ass_timestamp(start)},{_ass_timestamp(end)},Default,{text}")
    return "\n".join(lines) + "\n"
