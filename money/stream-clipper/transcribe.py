"""Local speech-to-text via faster-whisper (no API cost, CPU-capable) plus
building the burned-in .ass caption file for one rendered clip from the
word-level timestamps it produces. `transcribe_audio` is the untested I/O
wrapper (loads a real model); `build_ass_subtitles` is pure and unit-tested
(tests/test_transcribe.py).
"""

import config

ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, Bold, Outline, Alignment, MarginV
Style: Default,Arial,72,&H00FFFFFF,&H00000000,1,3,2,140

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


def build_ass_subtitles(
    words: list,
    window_start: float,
    window_end: float,
    width: int = config.OUTPUT_WIDTH,
    height: int = config.OUTPUT_HEIGHT,
) -> str:
    """Build an .ass subtitle document with one caption event per word, timed
    relative to the *clip's own* start (0.00 = first frame of the rendered
    clip, not the source VOD). Words outside [window_start, window_end) are
    dropped; words spanning the boundary are clipped to it."""
    lines = [ASS_HEADER.format(width=width, height=height)]
    for w in words:
        if w["end"] <= window_start or w["start"] >= window_end:
            continue
        rel_start = max(0.0, w["start"] - window_start)
        rel_end = min(window_end - window_start, w["end"] - window_start)
        if rel_end <= rel_start:
            continue
        text = w["word"].strip().replace("\n", " ").replace("{", "(").replace("}", ")")
        if not text:
            continue
        lines.append(f"Dialogue: 0,{_ass_timestamp(rel_start)},{_ass_timestamp(rel_end)},Default,{text}")
    return "\n".join(lines) + "\n"
