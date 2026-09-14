"""Builds and runs the ffmpeg commands that turn one selected highlight
window into a rendered vertical clip: an optional pacing (silence-trim)
pass (`build_trimmed_clip_command`), then cut -> crop -> scale -> burn in
subtitles (`build_clip_command`). All command-*construction* functions are
pure and unit-tested (tests/test_clipper.py); `render_clip`/
`render_trimmed_clip` are the thin, untested I/O wrappers that actually
shell out, same split as the rest of this project's network/binary-touching
modules.
"""

import subprocess

import config


def compute_crop_box(source_width: int, source_height: int, target_aspect=config.TARGET_ASPECT) -> tuple:
    """Compute (crop_w, crop_h, x, y) for a centered crop of source_width x
    source_height down to target_aspect (e.g. 9:16). Crops width if the
    source is wider than the target ratio, or height if the source is
    narrower/taller than it — always keeping the full extent of whichever
    dimension doesn't need cropping, centered on the other. Split out from
    build_crop_filter so face_track.py can get the target crop *dimensions*
    (crop_w/crop_h) without parsing a formatted filter string back apart."""
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
    return crop_w, crop_h, x, y


def build_crop_filter(source_width: int, source_height: int, target_aspect=config.TARGET_ASPECT) -> str:
    """Static centered-crop ffmpeg filter string — see compute_crop_box."""
    crop_w, crop_h, x, y = compute_crop_box(source_width, source_height, target_aspect)
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


def build_trimmed_clip_command(input_path: str, keep_segments: list, output_path: str) -> list:
    """Build an ffmpeg command that keeps only `keep_segments` (sorted,
    non-overlapping (start, end) tuples in input_path's own absolute time)
    and concatenates them — pacing.py's silence-trim edit — writing a plain
    video+audio intermediate with no crop/scale/subtitles yet (those apply
    in a second pass via build_clip_command, once face-tracking has run on
    *this* trimmed output — see pipeline.py). Seeks to the first segment's
    start before decoding (`-ss` before `-i`) so a trim deep into an
    hours-long source VOD doesn't require decoding everything before it."""
    if not keep_segments:
        raise ValueError("keep_segments must not be empty")

    seek_offset = keep_segments[0][0]
    trim_filters = []
    concat_inputs = []
    for i, (seg_start, seg_end) in enumerate(keep_segments):
        if seg_end <= seg_start:
            raise ValueError(f"invalid segment {seg_start}-{seg_end}")
        rel_start = seg_start - seek_offset
        rel_end = seg_end - seek_offset
        trim_filters.append(f"[0:v]trim=start={rel_start:.3f}:end={rel_end:.3f},setpts=PTS-STARTPTS[v{i}]")
        trim_filters.append(f"[0:a]atrim=start={rel_start:.3f}:end={rel_end:.3f},asetpts=PTS-STARTPTS[a{i}]")
        concat_inputs.append(f"[v{i}][a{i}]")

    concat_filter = f"{''.join(concat_inputs)}concat=n={len(keep_segments)}:v=1:a=1[vout][aout]"
    filter_complex = ";".join(trim_filters + [concat_filter])

    return [
        "ffmpeg",
        "-y",
        "-ss", f"{seek_offset:.3f}",
        "-i", input_path,
        "-filter_complex", filter_complex,
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-c:a", "aac", "-b:a", "128k",
        output_path,
    ]


def render_trimmed_clip(input_path: str, keep_segments: list, output_path: str) -> None:
    """Actually invoke ffmpeg for build_trimmed_clip_command. Raises
    subprocess.CalledProcessError on failure."""
    cmd = build_trimmed_clip_command(input_path, keep_segments, output_path)
    subprocess.run(cmd, check=True, capture_output=True, text=True)


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
