import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import clipper


def test_build_crop_filter_wide_source_crops_width():
    # 1920x1080 (16:9) source down to 9:16 target -> crop width, keep full height
    result = clipper.build_crop_filter(1920, 1080, target_aspect=(9, 16))
    assert result.startswith("crop=")
    w, h, x, y = result.replace("crop=", "").split(":")
    assert int(h) == 1080
    assert int(w) < 1920
    # centered
    assert int(x) == (1920 - int(w)) // 2
    assert int(y) == 0


def test_build_crop_filter_already_narrow_source_crops_height():
    # A source already narrower than 9:16 (e.g. a portrait 1080x1920 exactly) needs no crop
    result = clipper.build_crop_filter(1080, 1920, target_aspect=(9, 16))
    w, h, x, y = result.replace("crop=", "").split(":")
    assert int(w) == 1080
    assert int(h) == 1920


def test_build_crop_filter_dimensions_are_even():
    result = clipper.build_crop_filter(1921, 1081, target_aspect=(9, 16))
    w, h, x, y = result.replace("crop=", "").split(":")
    assert int(w) % 2 == 0
    assert int(h) % 2 == 0


def test_build_clip_command_basic_structure():
    cmd = clipper.build_clip_command("in.mp4", 10.0, 25.0, "out.mp4")
    assert cmd[0] == "ffmpeg"
    assert "-i" in cmd
    assert cmd[cmd.index("-i") + 1] == "in.mp4"
    assert cmd[-1] == "out.mp4"
    assert "10.000" in cmd
    assert "25.000" in cmd


def test_build_clip_command_includes_crop_and_subtitles_in_filter_chain():
    cmd = clipper.build_clip_command(
        "in.mp4", 0.0, 15.0, "out.mp4",
        crop_filter="crop=608:1080:656:0",
        subtitles_path="/tmp/clip.ass",
    )
    vf_index = cmd.index("-vf") + 1
    filter_chain = cmd[vf_index]
    assert "crop=608:1080:656:0" in filter_chain
    assert "scale=" in filter_chain
    assert "ass=/tmp/clip.ass" in filter_chain


def test_build_clip_command_rejects_non_positive_duration():
    with pytest.raises(ValueError):
        clipper.build_clip_command("in.mp4", 10.0, 10.0, "out.mp4")
    with pytest.raises(ValueError):
        clipper.build_clip_command("in.mp4", 10.0, 5.0, "out.mp4")


def test_build_clip_command_never_uses_shell_string():
    cmd = clipper.build_clip_command("in.mp4", 0.0, 1.0, "out.mp4")
    assert isinstance(cmd, list)
    assert all(isinstance(part, str) for part in cmd)


def test_build_trimmed_clip_command_seeks_to_first_segment_start():
    cmd = clipper.build_trimmed_clip_command("in.mp4", [(100.0, 110.0), (115.0, 120.0)], "out.mp4")
    assert cmd[cmd.index("-ss") + 1] == "100.000"


def test_build_trimmed_clip_command_trims_are_relative_to_seek_offset():
    cmd = clipper.build_trimmed_clip_command("in.mp4", [(100.0, 110.0), (115.0, 120.0)], "out.mp4")
    filter_complex = cmd[cmd.index("-filter_complex") + 1]
    # first segment relative to itself starts at 0, second starts 15s later (115-100)
    assert "trim=start=0.000:end=10.000" in filter_complex
    assert "trim=start=15.000:end=20.000" in filter_complex


def test_build_trimmed_clip_command_concat_filter_matches_segment_count():
    cmd = clipper.build_trimmed_clip_command("in.mp4", [(0.0, 5.0), (8.0, 12.0), (20.0, 25.0)], "out.mp4")
    filter_complex = cmd[cmd.index("-filter_complex") + 1]
    assert "concat=n=3:v=1:a=1" in filter_complex
    assert "[v0][a0][v1][a1][v2][a2]" in filter_complex


def test_build_trimmed_clip_command_maps_named_outputs():
    cmd = clipper.build_trimmed_clip_command("in.mp4", [(0.0, 5.0)], "out.mp4")
    assert "-map" in cmd
    map_indices = [i for i, part in enumerate(cmd) if part == "-map"]
    mapped = {cmd[i + 1] for i in map_indices}
    assert mapped == {"[vout]", "[aout]"}


def test_build_trimmed_clip_command_rejects_empty_segments():
    with pytest.raises(ValueError):
        clipper.build_trimmed_clip_command("in.mp4", [], "out.mp4")


def test_build_trimmed_clip_command_rejects_invalid_segment():
    with pytest.raises(ValueError):
        clipper.build_trimmed_clip_command("in.mp4", [(10.0, 5.0)], "out.mp4")
