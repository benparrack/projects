"""ffmpeg / ffprobe / yt-dlp helpers: downloading, probing, making a
browser-playable proxy when needed, extracting audio, thumbnails, and the
audio loudness envelope the clip finder scores with."""

import json
import os
import re
import subprocess

import numpy as np

BROWSER_VIDEO = {"h264", "vp9", "av1", "vp8"}
BROWSER_AUDIO = {"aac", "mp3", "opus", "vorbis"}


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def probe(path):
    out = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path]).stdout
    info = json.loads(out)
    v = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
    a = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    if not v:
        raise ValueError("No video stream found in that file")
    num, den = (v.get("avg_frame_rate") or "30/1").split("/")
    fps = float(num) / float(den) if float(den) else 30.0
    w, h = int(v["width"]), int(v["height"])
    rot = 0
    for sd in v.get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = int(sd["rotation"])
    if abs(rot) in (90, 270):
        w, h = h, w
    return {
        "duration": float(info["format"].get("duration") or v.get("duration") or 0),
        "width": w,
        "height": h,
        "fps": round(fps, 3) if fps > 0 else 30.0,
        "vcodec": v.get("codec_name"),
        "acodec": a.get("codec_name") if a else None,
        "has_audio": a is not None,
        "format": info["format"].get("format_name", ""),
    }


def needs_proxy(info, path):
    ext = os.path.splitext(path)[1].lower()
    if ext not in (".mp4", ".webm", ".m4v", ".mov"):
        return True
    if info["vcodec"] not in BROWSER_VIDEO:
        return True
    if info["acodec"] and info["acodec"] not in BROWSER_AUDIO:
        return True
    return False


def ffmpeg_with_progress(cmd, duration, on_progress):
    """Runs an ffmpeg command with -progress on stdout, reporting 0..1."""
    cmd = cmd[:1] + ["-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats"] + cmd[1:]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    for line in proc.stdout:
        if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
            try:
                t = int(line.split("=")[1]) / 1e6
            except ValueError:
                continue
            if duration > 0:
                on_progress(min(1.0, t / duration))
    err = proc.stderr.read()
    if proc.wait() != 0:
        raise RuntimeError(f"ffmpeg failed: {err.strip()[-800:]}")


def make_proxy(src, dst, duration, on_progress):
    ffmpeg_with_progress(
        ["ffmpeg", "-y", "-i", src, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", dst],
        duration, on_progress)


def extract_audio(src, dst):
    run(["ffmpeg", "-y", "-v", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", dst])


def thumbnail(src, t, dst, width=360):
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{max(0, t):.3f}", "-i", src, "-frames:v", "1",
         "-vf", f"scale={width}:-2", "-q:v", "4", dst])


def loudness_envelope(wav_path, hop=0.25):
    """RMS loudness (dB) per `hop` seconds from the 16 kHz mono wav."""
    import wave
    with wave.open(wav_path) as w:
        sr = w.getframerate()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    n = int(sr * hop)
    frames = len(data) // n
    if frames == 0:
        return np.zeros(1), hop
    rms = np.sqrt(np.mean(data[: frames * n].reshape(frames, n) ** 2, axis=1) + 1e-10)
    return 20 * np.log10(rms), hop


def download(url, out_dir, on_progress):
    """Downloads with yt-dlp (≤1080p, H.264 preferred so no proxy is needed).
    Returns (path, title)."""
    import yt_dlp

    def hook(d):
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                on_progress(d.get("downloaded_bytes", 0) / total)

    opts = {
        "outtmpl": os.path.join(out_dir, "source.%(ext)s"),
        "format": "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [hook],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    title = info.get("title") or "video"
    for f in os.listdir(out_dir):
        if f.startswith("source.") and not f.endswith(".part"):
            return os.path.join(out_dir, f), title
    raise RuntimeError("yt-dlp finished but no source file was found")


def safe_name(s, n=60):
    s = re.sub(r"[^\w\- ]+", "", s).strip().replace(" ", "_")
    return (s or "clip")[:n]
