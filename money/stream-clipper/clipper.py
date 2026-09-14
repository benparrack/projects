"""Builds and runs the ffmpeg command that turns one selected highlight
window into a rendered vertical clip: cut -> crop -> scale -> burn in
subtitles. Command *construction* (`build_crop_filter`, `build_clip_command`)
is pure and unit-tested (tests/test_clipper.py); `render_clip` is the thin,
untested I/O wrapper that actually shells out, same split as the rest of
this project's network/binary-touching modules.
"""

import subprocess

import config


def build_crop_filter(source_width: int, source_height: int, target_aspect=config.TARGET_ASPECT) -> str:
    """Compute an ffmpeg crop filter string for a centered crop of
    source_width x source_height down to target_aspect (e.g. 9:16). Crops
    width if the source is wider than the target ratio, or height if the
    source is narrower/taller than it — always keeping the full extent of
    whichever dimension doesn't need cropping, centered on the other."""
    target_w_ratio, target_h_ratio = target_aspect
    target_ratio = target_w_ratio / target_h_ratio
    source_ratio = source_width / source_height

    if source_ratio > target_ratio:
        crop_h = source_height
        crop_w = int(round(source_height * target_ratio))
    else:
        crop_w = source_width
        crop_h = int(round(source_width / target_ratio))

    crop_w -= crop_w % 2
    crop_h -= crop_h % 2
    x = (source_width - crop_w) // 2
    y = (source_height - crop_h) // 2
    return f"crop={crop_w}:{crop_h}:{x}:{y}"


def build_clip_command(
    input_path: str,
    start: float,
    end: float,
    output_path: str,
    *,
    crop_filter: str = None,
    subtitles_path: str = None,
    scale=(config.OUTPUT_WIDTH, config.OUTPUT_HEIGHT),
) -> list:
    """Build the ffmpeg argv list to cut [start, end) from input_path, apply
    an optional crop filter and burned-in .ass subtitles, scale to the
    target output resolution, and write output_path. Returns a list (never a
    shell string) so callers never need shell=True."""
    if end <= start:
        raise ValueError(f"end ({end}) must be after start ({start})")

    filters = []
    if crop_filter:
        filters.append(crop_filter)
    filters.append(f"scale={scale[0]}:{scale[1]}")
    if subtitles_path:
        # ffmpeg's filter-graph parser treats ':' as an option separator, so a
        # path containing one (e.g. most absolute Windows paths, or an ass=
        # filter's own syntax) must have it escaped.
        escaped = subtitles_path.replace(":", "\\:")
        filters.append(f"ass={escaped}")
    filter_chain = ",".join(filters)

    return [
        "ffmpeg",
        "-y",
        "-ss", f"{start:.3f}",
        "-to", f"{end:.3f}",
        "-i", input_path,
        "-vf", filter_chain,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "128k",
        output_path,
    ]


def render_clip(
    input_path: str,
    start: float,
    end: float,
    output_path: str,
    *,
    crop_filter: str = None,
    subtitles_path: str = None,
) -> None:
    """Actually invoke ffmpeg. Raises subprocess.CalledProcessError on
    failure (caller decides whether to skip this one clip or abort)."""
    cmd = build_clip_command(
        input_path, start, end, output_path,
        crop_filter=crop_filter, subtitles_path=subtitles_path,
    )
    subprocess.run(cmd, check=True, capture_output=True, text=True)


def probe_dimensions(input_path: str) -> tuple:
    """Return (width, height) of a video file via ffprobe."""
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=s=x:p=0",
        input_path,
    ]
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    width_str, height_str = result.stdout.strip().split("x")
    return int(width_str), int(height_str)
