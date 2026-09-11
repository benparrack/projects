"""
Hand Paintbrush — turn your hand into a watercolor brush.

Tracks your index fingertip via a webcam and leaves a soft, flowing
watercolor-style stroke behind it: a crisp core line with a slow-spreading
color wash underneath, plus little droplets of color that break off the
stroke and drift outward as it dries. Pinch (thumb + index finger
together) to lift the brush without drawing, like lifting a pen off paper.

Controls:
  c        clear the canvas
  b        toggle blending the trail over the camera feed vs. plain black
  s        save a snapshot of the current artwork to snapshots/
  ESC / q  quit
"""

import os
import random
import threading
import time
import urllib.request

import cv2
import numpy as np
from mediapipe import Image, ImageFormat
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import (
    HandLandmarker,
    HandLandmarkerOptions,
    RunningMode,
)

MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "hand_landmarker.task")
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)
SNAPSHOT_DIR = os.path.join(os.path.dirname(__file__), "snapshots")

INDEX_TIP = 8
THUMB_TIP = 4
PINCH_THRESHOLD = 0.06  # normalized landmark distance to count as "pinched"
HUE_CYCLE_SECONDS = 10.0  # time to cycle the full rainbow

# Core stroke (the crisp line directly under the fingertip)
CORE_DECAY = 0.95
CORE_MIN_THICKNESS = 6
CORE_MAX_THICKNESS = 20
CORE_GLOW_KSIZE = 15
CORE_GLOW_WEIGHT = 0.5

# Wash (the soft, slow-spreading watercolor bleed)
WASH_DECAY = 0.985
WASH_DIFFUSE_KSIZE = 7  # small blur applied every frame, simulates pigment spreading
WASH_STROKE_WIDTH_MULT = 3.0  # how much wider than the core the wash stroke is
WASH_STROKE_OPACITY = 55  # 0-255, how strongly each wash stroke is laid down

# Droplet particles that break off the stroke and drift
MAX_PARTICLES = 220
PARTICLES_PER_STEP = (1, 3)  # random range spawned per moving frame
PARTICLE_SPEED_SCALE = 0.35  # fraction of finger speed inherited as jitter energy
PARTICLE_DRIFT_SPEED = (0.4, 2.2)  # px/frame random outward drift
PARTICLE_FRICTION = 0.94
PARTICLE_MIN_LIFE = 20  # frames
PARTICLE_MAX_LIFE = 55
PARTICLE_MIN_RADIUS = 2
PARTICLE_MAX_RADIUS = 6
PARTICLE_HUE_JITTER = 18  # degrees of hue variation from the stroke color

BACKGROUND_CAMERA_OPACITY = 0.35

FPS_SMOOTHING = 0.9  # exponential moving average factor for the on-screen FPS counter


class ThreadedCamera:
    """Reads frames in a background thread so the main loop never blocks on
    camera I/O — it just grabs whatever the most recently captured frame is."""

    def __init__(self, src=0):
        self.cap = cv2.VideoCapture(src)
        if not self.cap.isOpened():
            raise RuntimeError(f"Could not open webcam (device {src}).")
        ret, frame = self.cap.read()
        if not ret:
            raise RuntimeError("Could not read a frame from the webcam.")
        self._frame = frame
        self._lock = threading.Lock()
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self):
        while self._running:
            ret, frame = self.cap.read()
            if ret:
                with self._lock:
                    self._frame = frame

    def read(self):
        with self._lock:
            return self._frame

    def release(self):
        self._running = False
        self._thread.join(timeout=1)
        self.cap.release()


class ThreadedDetector:
    """Runs hand-landmark detection in a background thread. Inference is by
    far the slowest step in this pipeline (~20-30ms), so decoupling it from
    the render loop lets rendering (capture/blur/composite/display, ~15ms)
    run at its own, much higher frame rate instead of waiting on it."""

    def __init__(self, landmarker, camera):
        self.landmarker = landmarker
        self.camera = camera
        self._start_time = time.time()
        self._lock = threading.Lock()
        self._result = None
        self._seq = 0
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self):
        while self._running:
            frame = cv2.flip(self.camera.read(), 1)
            mp_image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB).astype(np.uint8)
            image = Image(image_format=ImageFormat.SRGB, data=mp_image)
            timestamp_ms = int((time.time() - self._start_time) * 1000)
            result = self.landmarker.detect_for_video(image, timestamp_ms)
            with self._lock:
                self._result = result
                self._seq += 1

    def read(self):
        """Returns (result, seq). seq increments each time a new detection
        completes, so callers can tell a fresh result from a repeat of the
        last one they already processed."""
        with self._lock:
            return self._result, self._seq

    def stop(self):
        self._running = False
        self._thread.join(timeout=1)


def ensure_model():
    if os.path.exists(MODEL_PATH):
        return
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    print("Downloading hand landmark model (first run only)...")
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)


def make_landmarker():
    options = HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=RunningMode.VIDEO,
        num_hands=2,
        min_hand_detection_confidence=0.5,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    return HandLandmarker.create_from_options(options)


def hue_to_bgr(hue_deg, sat=255, val=255):
    hsv = np.uint8([[[hue_deg % 180, sat, val]]])
    bgr = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)[0][0]
    return int(bgr[0]), int(bgr[1]), int(bgr[2])


def spawn_particles(x, y, vx, vy, hue, count):
    particles = []
    speed = (vx ** 2 + vy ** 2) ** 0.5
    for _ in range(count):
        angle = random.uniform(0, 2 * 3.14159265)
        drift = random.uniform(*PARTICLE_DRIFT_SPEED) + speed * PARTICLE_SPEED_SCALE * random.uniform(0.2, 0.8)
        particle_hue = hue + random.uniform(-PARTICLE_HUE_JITTER, PARTICLE_HUE_JITTER)
        color = hue_to_bgr(particle_hue, sat=random.randint(160, 230), val=255)
        particles.append(
            {
                "x": float(x),
                "y": float(y),
                "vx": drift * (0.5 * vx / (speed + 1e-6) + 0.5 * np.cos(angle)),
                "vy": drift * (0.5 * vy / (speed + 1e-6) + 0.5 * np.sin(angle)),
                "color": color,
                "radius": random.uniform(PARTICLE_MIN_RADIUS, PARTICLE_MAX_RADIUS),
                "life": 0,
                "max_life": random.randint(PARTICLE_MIN_LIFE, PARTICLE_MAX_LIFE),
            }
        )
    return particles


def update_and_draw_particles(particles, wash):
    alive = []
    for p in particles:
        p["life"] += 1
        if p["life"] >= p["max_life"]:
            continue
        p["x"] += p["vx"]
        p["y"] += p["vy"]
        p["vx"] *= PARTICLE_FRICTION
        p["vy"] *= PARTICLE_FRICTION

        fade = 1.0 - (p["life"] / p["max_life"])
        radius = max(1, int(p["radius"] * (0.6 + 0.4 * fade)))
        color = tuple(c * fade for c in p["color"])
        cv2.circle(wash, (int(p["x"]), int(p["y"])), radius, color, -1, lineType=cv2.LINE_AA)
        alive.append(p)
    return alive[-MAX_PARTICLES:]


def main():
    ensure_model()
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)

    landmarker = make_landmarker()
    camera = ThreadedCamera(0)
    detector = ThreadedDetector(landmarker, camera)
    height, width = camera.read().shape[:2]

    core = np.zeros((height, width, 3), dtype=np.float32)
    wash = np.zeros((height, width, 3), dtype=np.float32)
    particles = []
    prev_points = {}  # hand index -> last drawn (x, y) pixel position
    blend_with_camera = True

    start_time = time.time()
    last_frame_time = start_time
    last_seq = -1
    fps = 0.0
    show_fps = True

    print("Hand Paintbrush running. Press 'c' to clear, 'b' to toggle background, 'f' to toggle FPS, 's' to save, 'q' to quit.")

    try:
        while True:
            frame = camera.read()
            frame = cv2.flip(frame, 1)
            result, seq = detector.read()
            is_new_detection = seq != last_seq
            last_seq = seq

            core *= CORE_DECAY
            wash = cv2.GaussianBlur(wash, (WASH_DIFFUSE_KSIZE, WASH_DIFFUSE_KSIZE), 0)
            wash *= WASH_DECAY

            # Only lay down new ink when a fresh detection has actually arrived —
            # detection runs slower than this render loop, so re-processing the
            # same stale landmarks every render frame would stamp a pile of
            # circles on top of each other instead of a continuous line.
            seen_hands = set()
            if is_new_detection and result is not None and result.hand_landmarks:
                elapsed = time.time() - start_time
                for hand_index, landmarks in enumerate(result.hand_landmarks):
                    seen_hands.add(hand_index)
                    index_lm = landmarks[INDEX_TIP]
                    thumb_lm = landmarks[THUMB_TIP]

                    px = int(index_lm.x * width)
                    py = int(index_lm.y * height)

                    pinch_dist = (
                        (index_lm.x - thumb_lm.x) ** 2 + (index_lm.y - thumb_lm.y) ** 2
                    ) ** 0.5
                    drawing = pinch_dist > PINCH_THRESHOLD

                    hue = (elapsed / HUE_CYCLE_SECONDS * 180 + hand_index * 90) % 180
                    color = hue_to_bgr(hue)
                    wash_color = hue_to_bgr(hue + 12, sat=180)

                    if drawing and hand_index in prev_points:
                        prev_x, prev_y = prev_points[hand_index]
                        dx, dy = px - prev_x, py - prev_y
                        speed = (dx ** 2 + dy ** 2) ** 0.5

                        thickness = int(
                            np.clip(CORE_MAX_THICKNESS - speed * 0.3, CORE_MIN_THICKNESS, CORE_MAX_THICKNESS)
                        )
                        cv2.line(core, (prev_x, prev_y), (px, py), color, thickness, lineType=cv2.LINE_AA)

                        wash_thickness = max(1, int(thickness * WASH_STROKE_WIDTH_MULT))
                        wash_bgr = tuple(c * (WASH_STROKE_OPACITY / 255.0) for c in wash_color)
                        cv2.line(wash, (prev_x, prev_y), (px, py), wash_bgr, wash_thickness, lineType=cv2.LINE_AA)

                        if speed > 1.0:
                            spawn_count = random.randint(*PARTICLES_PER_STEP)
                            particles.extend(spawn_particles(px, py, dx, dy, hue, spawn_count))

                    if drawing:
                        cv2.circle(core, (px, py), max(2, CORE_MIN_THICKNESS // 2), color, -1, lineType=cv2.LINE_AA)
                        prev_points[hand_index] = (px, py)
                    else:
                        prev_points.pop(hand_index, None)

            if is_new_detection:
                for hand_index in list(prev_points.keys()):
                    if hand_index not in seen_hands:
                        prev_points.pop(hand_index, None)

            particles = update_and_draw_particles(particles, wash)

            core_glow = cv2.GaussianBlur(core, (CORE_GLOW_KSIZE, CORE_GLOW_KSIZE), 0)
            art = cv2.add(wash, core)
            art = cv2.scaleAdd(core_glow, CORE_GLOW_WEIGHT, art)
            art = cv2.convertScaleAbs(art)

            if blend_with_camera:
                background = cv2.convertScaleAbs(frame, alpha=BACKGROUND_CAMERA_OPACITY)
            else:
                background = np.zeros_like(frame)

            output = cv2.add(background, art)

            now = time.time()
            frame_dt = now - last_frame_time
            last_frame_time = now
            if frame_dt > 0:
                fps = fps * FPS_SMOOTHING + (1.0 / frame_dt) * (1.0 - FPS_SMOOTHING)

            display = output
            if show_fps:
                display = output.copy()
                cv2.putText(
                    display, f"{fps:4.1f} FPS", (10, 24),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA,
                )

            cv2.imshow("Hand Paintbrush", display)
            key = cv2.waitKey(1) & 0xFF
            if key in (27, ord("q")):
                break
            elif key == ord("c"):
                core[:] = 0
                wash[:] = 0
                particles = []
            elif key == ord("b"):
                blend_with_camera = not blend_with_camera
            elif key == ord("f"):
                show_fps = not show_fps
            elif key == ord("s"):
                filename = os.path.join(SNAPSHOT_DIR, f"artwork_{int(time.time())}.png")
                cv2.imwrite(filename, output)
                print(f"Saved {filename}")
    finally:
        detector.stop()
        camera.release()
        cv2.destroyAllWindows()
        landmarker.close()


if __name__ == "__main__":
    main()
