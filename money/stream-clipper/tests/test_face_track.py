import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import face_track


def test_fill_missing_forward_fills():
    samples = [(0.0, 0.5, 0.5), (0.5, None, None), (1.0, 0.6, 0.4)]
    filled = face_track.fill_missing(samples)
    assert filled == [(0.0, 0.5, 0.5), (0.5, 0.5, 0.5), (1.0, 0.6, 0.4)]


def test_fill_missing_backfills_leading_gap():
    samples = [(0.0, None, None), (0.5, None, None), (1.0, 0.6, 0.4)]
    filled = face_track.fill_missing(samples)
    assert filled == [(0.0, 0.6, 0.4), (0.5, 0.6, 0.4), (1.0, 0.6, 0.4)]


def test_fill_missing_no_detections_returns_none():
    samples = [(0.0, None, None), (0.5, None, None)]
    assert face_track.fill_missing(samples) is None


def test_smooth_face_track_ignores_small_drift():
    filled = [(0.0, 0.5, 0.5), (0.5, 0.52, 0.51), (1.0, 0.48, 0.49)]
    keyframes = face_track.smooth_face_track(filled, deadzone_frac=0.15)
    # all drift within 0.15 of the original 0.5,0.5 -> camera never moves
    assert all(cx == 0.5 and cy == 0.5 for _, cx, cy in keyframes)


def test_smooth_face_track_follows_large_movement():
    filled = [(0.0, 0.2, 0.2), (0.5, 0.8, 0.8)]
    keyframes = face_track.smooth_face_track(filled, deadzone_frac=0.15)
    assert keyframes[0] == (0.0, 0.2, 0.2)
    assert keyframes[1] == (0.5, 0.8, 0.8)


def test_smooth_face_track_empty_input():
    assert face_track.smooth_face_track([]) == []


def test_smooth_face_track_camera_only_moves_past_deadzone_from_current_position():
    # drift accumulates in small steps that individually stay under the
    # deadzone from the *current camera position* -> camera should stay put
    # the whole time, not slowly creep with the raw signal.
    filled = [(float(i) * 0.5, 0.5 + i * 0.04, 0.5) for i in range(4)]  # 0.5, 0.54, 0.58, 0.62 -- all < 0.15 drift
    keyframes = face_track.smooth_face_track(filled, deadzone_frac=0.15)
    assert all(cx == 0.5 for _, cx, _ in keyframes)


def test_build_dynamic_crop_expr_no_keyframes_falls_back_to_static():
    expr = face_track.build_dynamic_crop_expr([], frame_width=1920, frame_height=1080, crop_width=608, crop_height=1080)
    assert expr.startswith("crop=608:1080:")
    assert "if(" not in expr  # static, not a time expression


def test_build_dynamic_crop_expr_single_keyframe_is_constant():
    expr = face_track.build_dynamic_crop_expr(
        [(0.0, 0.5, 0.5)], frame_width=1920, frame_height=1080, crop_width=608, crop_height=1080
    )
    assert expr.startswith("crop=608:1080:")
    assert "if(" not in expr  # no interpolation needed for a single point


def test_build_dynamic_crop_expr_multiple_keyframes_builds_time_expression():
    keyframes = [(0.0, 0.2, 0.5), (1.0, 0.8, 0.5)]
    expr = face_track.build_dynamic_crop_expr(
        keyframes, frame_width=1920, frame_height=1080, crop_width=608, crop_height=1080
    )
    assert expr.startswith("crop=608:1080:")
    assert "if(between(t," in expr
    assert "lt(t," in expr  # holds the pre-first-keyframe value


def test_build_dynamic_crop_expr_clamps_to_frame_bounds():
    # a face pinned at the very edge (cx=0.0) would put the crop window's
    # left edge off-frame if not clamped
    keyframes = [(0.0, 0.0, 0.5)]
    expr = face_track.build_dynamic_crop_expr(
        keyframes, frame_width=1920, frame_height=1080, crop_width=608, crop_height=1080
    )
    # clamped x should be 0.0 (can't go negative), not a negative pixel value
    assert "'-" not in expr
