"""Extracts a loudness-over-time envelope from an audio file, for the
audio-energy-spike highlight signal (laughter, reactions, yelling). Not
unit-tested — real audio decoding — same convention as downloader.py.
"""

import config


def loudness_envelope(audio_path: str, frame_seconds: float = 0.5) -> tuple:
    """Returns (sample_times, sample_values): the RMS loudness of
    `audio_path` in successive `frame_seconds`-wide frames, as parallel
    lists ready for highlights.bin_samples()."""
    import librosa
    import numpy as np

    y, sr = librosa.load(audio_path, sr=None, mono=True)
    frame_length = max(1, int(frame_seconds * sr))
    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=frame_length)[0]
    times = (np.arange(len(rms)) * frame_length / sr).tolist()
    return times, rms.tolist()
