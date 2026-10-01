"""Face detection and the virtual camera that reframes landscape video to
vertical. Detection runs MediaPipe on low-res frames piped out of ffmpeg
(far faster than seeking with OpenCV). The camera follows the speaker with
a dead zone so small head moves don't cause jitter, eases into new
positions, and hard-cuts instead of panning when the shot itself changes."""

import os
import subprocess
import threading

import numpy as np

from . import store

SAMPLE_FPS = 4
_det_lock = threading.Lock()
_detector = None


def _get_detector():
    global _detector
    if _detector is None:
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision
        opts = vision.FaceDetectorOptions(
            base_options=mp_python.BaseOptions(model_asset_path=os.path.join(store.MODELS, "blaze_face_short_range.tflite")),
            min_detection_confidence=0.45)
        _detector = vision.FaceDetector.create_from_options(opts)
    return _detector


def detect(src, start, end, src_w, src_h):
    """Returns [{"t": source_time, "f": [[cx, cy, w, h], ...]}] normalised 0-1,
    largest face first."""
    import mediapipe as mp
    w = 640
    h = int(round(src_h * w / src_w / 2) * 2)
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}", "-i", src,
           "-vf", f"fps={SAMPLE_FPS},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    size = w * h * 3
    out, k = [], 0
    with _det_lock:
        det = _get_detector()
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            frame = np.frombuffer(buf, np.uint8).reshape(h, w, 3)
            res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(frame)))
            faces = []
            for d in res.detections or []:
                b = d.bounding_box
                faces.append([(b.origin_x + b.width / 2) / w, (b.origin_y + b.height / 2) / h, b.width / w, b.height / h])
            faces.sort(key=lambda f: f[2] * f[3], reverse=True)
            # ignore tiny background faces relative to the main one
            if faces:
                faces = [f for f in faces if f[2] * f[3] > 0.25 * faces[0][2] * faces[0][3]][:3]
            out.append({"t": round(start + k / SAMPLE_FPS, 3), "f": [[round(v, 4) for v in f] for f in faces]})
            k += 1
    proc.wait()
    return out


def _fill(vals):
    """Forward/back-fills None entries; returns None if all are None."""
    idx = [i for i, v in enumerate(vals) if v is not None]
    if not idx:
        return None
    out = list(vals)
    for i in range(idx[0]):
        out[i] = vals[idx[0]]
    last = out[idx[0]]
    for i in range(idx[0], len(out)):
        if out[i] is None:
            out[i] = last
        last = out[i]
    return out


def _camera(times, xs, dead=0.06, cut=0.22):
    """Virtual camera over raw face positions -> list of (t, x) keyframes.
    Holds still inside a dead zone, eases toward the face outside it, and
    hard-cuts when the face jumps by more than `cut` for 2+ samples."""
    if not xs:
        return []
    cam = xs[0]
    keys = [(times[0], cam)]
    i = 1
    while i < len(xs):
        target = xs[i]
        jump = abs(target - cam) > cut and i + 1 < len(xs) and abs(xs[i + 1] - cam) > cut
        if jump:
            keys.append((times[i] - 0.01, cam))
            cam = target
            keys.append((times[i], cam))
        elif abs(target - cam) > dead:
            cam += (target - cam) * 0.45
            keys.append((times[i], cam))
        else:
            keys.append((times[i], cam))
        i += 1
    # light smoothing that preserves hard cuts
    sm = [keys[0]]
    for j in range(1, len(keys) - 1):
        t, x = keys[j]
        if keys[j + 1][0] - t < 0.05 or t - keys[j - 1][0] < 0.05:
            sm.append((t, x))
        else:
            sm.append((t, (keys[j - 1][1] + 2 * x + keys[j + 1][1]) / 4))
    if len(keys) > 1:
        sm.append(keys[-1])
    # drop redundant keyframes (collinear within a tiny tolerance)
    out = [sm[0]]
    for j in range(1, len(sm) - 1):
        (t0, x0), (t1, x1), (t2, x2) = out[-1], sm[j], sm[j + 1]
        if t2 - t0 > 0 and abs(x0 + (x2 - x0) * (t1 - t0) / (t2 - t0) - x1) > 0.002:
            out.append(sm[j])
    if len(sm) > 1:
        out.append(sm[-1])
    return [[round(t, 3), round(x, 4)] for t, x in out]


def build_tracks(samples):
    """-> {"main": [[t,x]...], "main_y": [[t,y]...], "a": [...], "b": [...], "two": bool, "found": bool}"""
    if not samples:
        return {"main": [], "main_y": [], "a": [], "b": [], "two": False, "found": False}
    times = [s["t"] for s in samples]
    main = _fill([s["f"][0][0] if s["f"] else None for s in samples])
    main_y = _fill([s["f"][0][1] if s["f"] else None for s in samples])
    # two-speaker split: left-most / right-most face when 2 are visible
    pairs = [sorted(s["f"][:2], key=lambda f: f[0]) if len(s["f"]) >= 2 else None for s in samples]
    two_ratio = sum(1 for p in pairs if p) / len(samples)
    a = _fill([p[0][0] if p else None for p in pairs])
    b = _fill([p[1][0] if p else None for p in pairs])
    return {
        "main": _camera(times, main) if main else [],
        "main_y": _camera(times, main_y, dead=0.08, cut=0.3) if main_y else [],
        "a": _camera(times, a, dead=0.08) if a else [],
        "b": _camera(times, b, dead=0.08) if b else [],
        "two": two_ratio > 0.35,
        "found": main is not None,
    }


def ensure(pid, clip, src, info, pad=20.0):
    """Makes sure face samples cover the clip's current range (+pad) and
    returns the tracks. Cached in faces/<clip id>.json."""
    path = store.pdir(pid, "faces", f"{clip['id']}.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cached = store.read_json(path)
    s, e = clip["edit"]["start"], clip["edit"]["end"]
    if not cached or cached["from"] > s + 0.01 or cached["to"] < e - 0.01:
        a, b = max(0.0, s - pad), min(info["duration"], e + pad)
        samples = detect(src, a, b, info["width"], info["height"])
        cached = {"from": a, "to": b, "samples": samples, "tracks": build_tracks(samples)}
        store.write_json(path, cached)
    return cached["tracks"]
