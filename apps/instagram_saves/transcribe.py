"""data/audio/*.m4a → data/transcripts/*.txt with faster-whisper. Skips ones already done.
Uses clip-studio's venv, which already has faster-whisper + the GPU setup:
  ../money/clip-studio/.venv/bin/python transcribe.py"""

import glob
import os

from faster_whisper import WhisperModel

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def load():
    try:
        return WhisperModel("large-v3-turbo", device="cuda", compute_type="float16")
    except Exception as e:  # noqa: BLE001 - no usable GPU
        print(f"GPU unavailable ({e}); using CPU small model")
        return WhisperModel("small", device="cpu", compute_type="int8")


def main():
    out_dir = os.path.join(DATA, "transcripts")
    os.makedirs(out_dir, exist_ok=True)
    todo = [p for p in sorted(glob.glob(os.path.join(DATA, "audio", "*.m4a")))
            if not os.path.exists(os.path.join(out_dir, os.path.basename(p)[:-4] + ".txt"))]
    print(f"{len(todo)} to transcribe")
    model = load()
    for i, path in enumerate(todo, 1):
        sc = os.path.basename(path)[:-4]
        try:
            segs, info = model.transcribe(path, vad_filter=True)
            text = " ".join(s.text.strip() for s in segs)
        except Exception as e:  # noqa: BLE001 - corrupt/empty audio
            text = f"[transcription failed: {e}]"
        with open(os.path.join(out_dir, sc + ".txt"), "w") as f:
            f.write(text)
        print(f"{i}/{len(todo)} {sc}: {text[:70]}")


if __name__ == "__main__":
    main()
