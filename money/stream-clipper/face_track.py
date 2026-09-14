"""Face-tracking dynamic vertical crop: samples the speaker's face position
across a clip and produces a smoothly panning ffmpeg crop expression that
follows them, instead of clipper.py's static center crop. Detection
(`detect_face_centers`) is the untested I/O part (OpenCV + MediaPipe);
everything downstream — smoothing raw samples into a stable camera path and
building the ffmpeg expression from it — is pure and unit-tested
(tests/test_face_track.py).
"""

import os

import config


def _ensure_model() -> str:
    """Downloads MediaPipe's face-detector .tflite model to config.MODELS_DIR
    on first use and caches it there (gitignored — this is a ~1MB binary
    asset, not source). MediaPipe's newer Tasks API (1.x) doesn't bundle a
    model the way the older `mp.solutions` API did."""
    path = os.path.join(config.MODELS_DIR, "blaze_face_full_range.tflite")
    if not os.path.exists(path):
        import urllib.request

        os.makedirs(config.MODELS_DIR, exist_ok=True)
        urllib.request.urlretrieve(config.FACE_TRACK_MODEL_URL, path)
    return path


def detect_face_centers(video_path: str, start: float, end: float, sample_interval: float = 0.5) -> list:
    """Samples frames from [start, end) of video_path every
    sample_interval seconds, running MediaPipe's face detector on each.
    Returns a list of (local_t, cx, cy) — local_t relative to `start` (0.0 =
    first sample), cx/cy the most-confident detected face's center as a 0-1
    fraction of frame width/height, or (local_t, None, None) when no face
    was found in that sample."""
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    base_options = mp_python.BaseOptions(model_asset_path=_ensure_model())
    options = vision.FaceDetectorOptions(base_options=base_options, min_detection_confidence=config.FACE_TRACK_MIN_CONFIDENCE)
    detector = vision.FaceDetector.create_from_options(options)

    cap = cv2.VideoCapture(video_path)
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        samples = []
        t = start
        while t < end:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
            ok, frame = cap.read()
            if not ok:
                break
            frame_h, frame_w = frame.shape[:2]
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = detector.detect(mp_image)
            if result.detections:
                best = max(result.detections, key=lambda d: d.categories[0].score)
                box = best.bounding_box
                cx = (box.origin_x + box.width / 2) / frame_w
                cy = (box.origin_y + box.height / 2) / frame_h
                samples.append((t - start, cx, cy))
            else:
                samples.append((t - start, None, None))
            t += sample_interval
        return samples
    finally:
        cap.release()
        # NOTE: FaceDetector's own __del__ raises a harmless TypeError on
        # this MediaPipe version's cleanup path (a known cosmetic bug, not
        # something calling code can prevent) — not caught here since it
        # doesn't propagate into this function's control flow either way.


def fill_missing(samples: list):
    """Forward-fills (t, None, None) samples with the last known face
    center; any leading gap before the first real detection is back-filled
    with that first detection (hold-at-first-known-position). Returns None
    if no sample in the whole clip ever detected a face — the caller should
    fall back to a static crop in that case."""
    detected = [(cx, cy) for _, cx, cy in samples if cx is not None]
    if not detected:
        return None
    last_cx, last_cy = detected[0]
    filled = []
    for t, cx, cy in samples:
        if cx is not None:
            last_cx, last_cy = cx, cy
        filled.append((t, last_cx, last_cy))
    return filled


def smooth_face_track(filled_samples: list, deadzone_frac: float = 0.15) -> list:
    """Applies a deadzone to (t, cx, cy) samples (0-1 fractions of frame
    width/height): the tracked camera center only moves once a new sample
    drifts more than `deadzone_frac` away from the *current camera
    center* (not the previous raw sample), so ordinary small head movement
    doesn't cause constant micro-panning. Returns one (t, camera_cx,
    camera_cy) keyframe per input sample."""
    if not filled_samples:
        return []
    cam_x, cam_y = filled_samples[0][1], filled_samples[0][2]
    keyframes = []
    for t, cx, cy in filled_samples:
        if abs(cx - cam_x) > deadzone_frac or abs(cy - cam_y) > deadzone_frac:
            cam_x, cam_y = cx, cy
        keyframes.append((t, cam_x, cam_y))
    return keyframes


def build_dynamic_crop_expr(keyframes: list, frame_width: int, frame_height: int, crop_width: int, crop_height: int) -> str:
    """Builds an ffmpeg `crop` filter whose x/y are time-based expressions
    panning the crop window's top-left corner so its center tracks
    `keyframes` ((t, cx, cy), cx/cy as 0-1 frame fractions) — linearly
    interpolated between consecutive keyframes, held constant before the
    first and after the last. Falls back to `clipper.build_crop_filter`'s
    plain centered crop when there are no keyframes at all (no face ever
    detected in the clip)."""
    if not keyframes:
        import clipper

        return clipper.build_crop_filter(frame_width, frame_height, target_aspect=config.TARGET_ASPECT)

    def clamp_x(px):
        return max(0.0, min(frame_width - crop_width, px))

    def clamp_y(px):
        return max(0.0, min(frame_height - crop_height, px))

    points = [
        (t, clamp_x(cx * frame_width - crop_width / 2), clamp_y(cy * frame_height - crop_height / 2))
        for t, cx, cy in keyframes
    ]

    def axis_expr(index):
        if len(points) == 1:
            return f"{points[0][index]:.1f}"
        expr = f"{points[-1][index]:.1f}"  # hold the last value after the final keyframe
        for i in range(len(points) - 1, 0, -1):
            t0, v0 = points[i - 1][0], points[i - 1][index]
            t1, v1 = points[i][0], points[i][index]
            if t1 <= t0:
                continue
            lerp = f"({v0:.1f}+({v1:.1f}-{v0:.1f})*(t-{t0:.3f})/({t1:.3f}-{t0:.3f}))"
            expr = f"if(between(t,{t0:.3f},{t1:.3f}),{lerp},{expr})"
        t0, v0 = points[0][0], points[0][index]
        return f"if(lt(t,{t0:.3f}),{v0:.1f},{expr})"

    return f"crop={crop_width}:{crop_height}:'{axis_expr(1)}':'{axis_expr(2)}'"


def dynamic_crop_for_clip(video_path: str, start: float, end: float, frame_width: int, frame_height: int, crop_width: int, crop_height: int) -> str:
    """End-to-end helper: detect -> fill -> smooth -> build expression. The
    one function pipeline.py actually calls; everything above exists
    separately so the pure parts are unit-testable without a real video."""
    samples = detect_face_centers(video_path, start, end, sample_interval=config.FACE_TRACK_SAMPLE_INTERVAL)
    filled = fill_missing(samples)
    keyframes = smooth_face_track(filled or [], deadzone_frac=config.FACE_TRACK_DEADZONE_FRAC)
    return build_dynamic_crop_expr(keyframes, frame_width, frame_height, crop_width, crop_height)
