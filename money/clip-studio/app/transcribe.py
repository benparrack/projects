"""Local speech-to-text with faster-whisper (word timestamps). Models are
cached per size so a second project doesn't reload weights."""

import os
import threading

_models = {}
_lock = threading.Lock()


def _model(size):
    from faster_whisper import WhisperModel
    with _lock:
        if size not in _models:
            _models[size] = WhisperModel(size, device="cpu", compute_type="int8",
                                         cpu_threads=max(4, (os.cpu_count() or 8) - 2))
        return _models[size]


def transcribe(wav_path, duration, size="small", language=None, on_progress=lambda f: None):
    """Returns {"language", "words": [{"w","s","e"}], "segments": [{"s","e","text"}]}."""
    model = _model(size)
    segs, info = model.transcribe(
        wav_path, word_timestamps=True, language=language or None,
        vad_filter=True, vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=False,
    )
    words, segments = [], []
    for seg in segs:
        segments.append({"s": round(seg.start, 3), "e": round(seg.end, 3), "text": seg.text.strip()})
        for w in seg.words or []:
            text = w.word.strip()
            if not text:
                continue
            # whisper marks a new word with a leading space; tokens without one
            # ("-time" after "real", "%" after "50") continue the previous word
            if words and not w.word.startswith(" ") and w.start - words[-1]["e"] < 0.3:
                words[-1]["w"] += text
                words[-1]["e"] = round(w.end, 3)
            else:
                words.append({"w": text, "s": round(w.start, 3), "e": round(w.end, 3)})
        if duration:
            on_progress(min(1.0, seg.end / duration))
    return {"language": info.language, "words": words, "segments": segments}
