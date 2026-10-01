"""Builds and runs the ffmpeg export for one clip: concatenates the kept
segments, reframes (face-tracked fill, blurred-background fit, two-speaker
split, or static center), burns the ASS captions/hook/watermark with the
bundled fonts, overlays an optional progress bar and mixes optional music."""

import os

from . import edit as E
from . import faces, media, store

OUT_FPS = 30


def _even(x):
    return max(2, int(x) // 2 * 2)


def _lerp_tree(keys, lo, hi):
    """Balanced if() tree over segments lo..hi-1 so expression depth is
    log2(n) rather than n (ffmpeg's parser recurses per nesting level)."""
    if hi - lo == 1:
        (t0, v0), (t1, v1) = keys[lo], keys[lo + 1]
        if t1 - t0 < 1e-6 or abs(v1 - v0) < 1e-6:
            return f"{v1:.5f}"
        return f"({v0:.5f}+({v1 - v0:.5f})*clip((t-{t0:.4f})/{t1 - t0:.4f},0,1))"
    mid = (lo + hi) // 2
    return f"if(lt(t,{keys[mid][0]:.4f}),{_lerp_tree(keys, lo, mid)},{_lerp_tree(keys, mid, hi)})"


def piecewise(keys):
    if not keys:
        return "0.5"
    if len(keys) == 1:
        return f"{keys[0][1]:.5f}"
    return _lerp_tree(keys, 0, len(keys) - 1)


def sample_track(track, t, default=0.5):
    if not track:
        return default
    if t <= track[0][0]:
        return track[0][1]
    for (t0, v0), (t1, v1) in zip(track, track[1:]):
        if t <= t1:
            return v0 + (v1 - v0) * ((t - t0) / (t1 - t0) if t1 > t0 else 1)
    return track[-1][1]


def out_track(track, keep, default=0.5):
    """Maps a source-time track onto the output timeline (cuts collapse time,
    so each kept segment contributes its own keyframes and boundaries)."""
    out, acc = [], 0.0
    for a, b in keep:
        pts = [a] + [t for t, _ in track if a < t < b] + [b]
        for k, t in enumerate(pts):
            ot = acc + t - a
            if k == 0 and out:
                ot += 0.001
            out.append((round(ot, 4), sample_track(track, t, default)))
        acc += b - a
    # drop consecutive duplicates
    ded = [out[0]]
    for p in out[1:]:
        if p[0] > ded[-1][0]:
            ded.append(p)
    return ded


def track_for_preview(tracks, keep):
    return {k: out_track(tracks.get(k) or [], keep) for k in ("main", "main_y", "a", "b")}


def build_filter(info, ed, tl, tracks, ass_path, dur, has_music):
    Ws, Hs = info["width"], info["height"]
    W, H = E.ASPECTS.get(ed["layout"].get("aspect", "9:16"), E.ASPECTS["9:16"])
    lay = ed["layout"]
    mode = lay.get("mode", "fill")
    keep = tl["keep"]
    ss0 = max(0.0, keep[0][0] - 1.0)
    parts, vlab, alab = [], [], []
    for i, (a, b) in enumerate(keep):
        ra, rb = a - ss0, b - ss0
        parts.append(f"[0:v]trim=start={ra:.3f}:end={rb:.3f},setpts=PTS-STARTPTS[v{i}]")
        if info["has_audio"]:
            ln = b - a
            parts.append(f"[0:a]atrim=start={ra:.3f}:end={rb:.3f},asetpts=PTS-STARTPTS,"
                         f"afade=t=in:d=0.012,afade=t=out:st={max(0, ln - 0.015):.3f}:d=0.015[a{i}]")
        vlab.append(f"[v{i}]")
        alab.append(f"[a{i}]")
    n = len(keep)
    if info["has_audio"]:
        parts.append("".join(v + a for v, a in zip(vlab, alab)) + f"concat=n={n}:v=1:a=1[vc][ac]")
    else:
        parts.append("".join(vlab) + f"concat=n={n}:v=1:a=0[vc]")
        parts.append(f"anullsrc=r=48000:cl=stereo,atrim=0:{dur:.3f}[ac]")
    parts.append(f"[vc]fps={OUT_FPS},setsar=1[vf]")
    zoom = max(1.0, float(lay.get("zoom", 1.0)))
    offset = float(lay.get("offset", 0.0))

    def tracked_crop(label_in, label_out, ow, oh, track_key, y_key=None):
        ar = ow / oh
        ch = Hs / zoom
        cw = ch * ar
        if cw > Ws:
            cw = Ws
            ch = cw / ar
        cw, ch = _even(cw), _even(ch)
        if mode == "center" or not tracks.get("found"):
            cx = f"{0.5 + offset * 0.5:.4f}"
        else:
            cx = f"({piecewise(out_track(tracks.get(track_key) or [], keep))}+{offset * 0.5:.4f})"
        x = f"clip({cx}*{Ws}-{cw}/2,0,{Ws - cw})"
        if y_key and zoom > 1.0 and tracks.get("found") and mode != "center":
            cy = piecewise(out_track(tracks.get(y_key) or [], keep))
            y = f"clip({cy}*{Hs}-{ch}*0.42,0,{Hs - ch})"
        else:
            y = f"{(Hs - ch) / 2:.1f}"
        return f"[{label_in}]crop=w={cw}:h={ch}:x='{x}':y='{y}',scale={ow}:{oh}:flags=lanczos[{label_out}]"

    if mode == "fit":
        sw, sh = _even(W / 8), _even(H / 8)
        fy = float(lay.get("fitY", 0.5))
        parts.append("[vf]split[bgi][fgi]")
        parts.append(f"[bgi]scale={sw}:{sh}:force_original_aspect_ratio=increase,crop={sw}:{sh},"
                     f"gblur=sigma=5,scale={W}:{H},eq=brightness=-0.07:saturation=1.1[bg]")
        parts.append(f"[fgi]scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos[fg]")
        parts.append(f"[bg][fg]overlay=x=(W-w)/2:y=(H-h)*{fy:.3f}[lv]")
    elif mode == "split" and tracks.get("found"):
        hh = _even(H / 2)
        parts.append("[vf]split[ta][tb]")
        parts.append(tracked_crop("ta", "top", W, hh, "a" if tracks.get("two") else "main"))
        parts.append(tracked_crop("tb", "bot", W, H - hh, "b" if tracks.get("two") else "main"))
        parts.append("[top][bot]vstack[lv]")
    else:
        parts.append(tracked_crop("vf", "lv", W, H, "main", "main_y"))
    fontsdir = store.FONTS.replace(":", "\\:")
    ass = ass_path.replace(":", "\\:").replace("'", "\\'")
    parts.append(f"[lv]ass=filename='{ass}':fontsdir='{fontsdir}'[sv]")
    last = "sv"
    pr = ed.get("progress", {})
    if pr.get("enabled"):
        bh = _even(H * 0.008)
        col = pr.get("color", "#FFE600").lstrip("#")
        parts.append(f"color=c=0x{col}:s={W}x{bh}:r={OUT_FPS}:d={dur:.3f}[pb]")
        parts.append(f"[{last}][pb]overlay=x='-w+W*t/{dur:.3f}':y={H - bh}:eof_action=pass[pv]")
        last = "pv"
    parts.append(f"[{last}]format=yuv420p[vout]")
    if has_music:
        vol = float(ed["music"].get("volume", 0.12))
        parts.append(f"[1:a]volume={vol:.3f},atrim=0:{dur:.3f},afade=t=out:st={max(0, dur - 1.5):.3f}:d=1.5[mu]")
        parts.append("[ac][mu]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]")
    else:
        parts.append("[ac]anull[aout]")
    return ";\n".join(parts), ss0


def render(pid, clip, out_path, on_progress=lambda f: None):
    proj = store.get_project(pid)
    info = proj["info"]
    src = store.pdir(pid, proj["source_file"])
    words = store.get_transcript(pid)["words"]
    ed = clip["edit"]
    tl = E.timeline(words, ed)
    tracks = faces.ensure(pid, clip, src, info)
    lay = E.layout(words, ed, tl)
    work = store.pdir(pid, "work")
    os.makedirs(work, exist_ok=True)
    ass_path = os.path.join(work, f"{clip['id']}.ass")
    with open(ass_path, "w") as f:
        f.write(E.to_ass(lay, ed))
    music = ed.get("music", {}).get("file")
    music_path = os.path.join(store.MUSIC, music) if music else None
    has_music = bool(music_path and os.path.exists(music_path))
    dur = tl["duration"]
    graph, ss0 = build_filter(info, ed, tl, tracks, ass_path, dur, has_music)
    script = os.path.join(work, f"{clip['id']}.filter")
    with open(script, "w") as f:
        f.write(graph)
    end_src = tl["keep"][-1][1] - ss0 + 0.5
    cmd = ["ffmpeg", "-y", "-ss", f"{ss0:.3f}", "-t", f"{end_src:.3f}", "-i", src]
    if has_music:
        cmd += ["-stream_loop", "-1", "-i", music_path]
    cmd += ["-filter_complex_script", script, "-map", "[vout]", "-map", "[aout]",
            "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-profile:v", "high",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", f"{dur:.3f}",
            "-movflags", "+faststart", out_path]
    media.ffmpeg_with_progress(cmd, dur, on_progress)
    return out_path
