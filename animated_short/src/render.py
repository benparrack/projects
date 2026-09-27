#!/usr/bin/env python3
"""LANTERN renderer. Every frame is render(t): deterministic, offline, GPU (EGL).

Usage (run from anywhere, with the project venv python):
  render.py still 41.0 [--scale .5]                -> output/stills/t0041.00.png
  render.py sheet [--every 2] [--start a --end b]  -> output/sheets/sheet_<a>_<b>.png
  render.py shot <name|index> [--profile preview|final]
  render.py film [--profile preview|final]         -> renders missing shots, concats, muxes audio
"""
import argparse
import os
import subprocess
import sys
import time

import numpy as np
import moderngl
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import timeline as TL  # noqa: E402
import scene  # noqa: E402
import text as textcards  # noqa: E402
from mathutil import halton  # noqa: E402

OUT_W, OUT_H = 1920, 1080
SCENE_ASPECT = 2.39

PROFILES = {
    # scale of the 1920x1080 frame, fps, samples per frame (AA + motion blur)
    "preview": dict(scale=1 / 3, fps=30, samples=1, crf=23, preset="veryfast"),
    "final": dict(scale=1.0, fps=60, samples=6, crf=15, preset="slow"),
}


def _src(name):
    with open(os.path.join(HERE, "shaders", name)) as f:
        return f.read()


class Engine:
    def __init__(self, out_w, out_h):
        self.ctx = moderngl.create_context(standalone=True, backend="egl", require=330)
        self.out_w, self.out_h = out_w, out_h
        self.sw = out_w
        self.sh = int(round(out_w / SCENE_ASPECT))
        ctx = self.ctx
        vs = _src("fullscreen.vert")
        self.p_scene = ctx.program(vertex_shader=vs, fragment_shader=_src("scene.frag"))
        self.p_down = ctx.program(vertex_shader=vs, fragment_shader=_src("down.frag"))
        self.p_up = ctx.program(vertex_shader=vs, fragment_shader=_src("up.frag"))
        self.p_comp = ctx.program(vertex_shader=vs, fragment_shader=_src("composite.frag"))
        vbo = ctx.buffer(np.array([-1, -1, 3, -1, -1, 3], dtype="f4").tobytes())
        self.vaos = {p: ctx.vertex_array(p, [(vbo, "2f", "in_pos")])
                     for p in (self.p_scene, self.p_down, self.p_up, self.p_comp)}
        self.hdr = ctx.texture((self.sw, self.sh), 4, dtype="f4")
        self.hdr.filter = (moderngl.LINEAR, moderngl.LINEAR)
        self.hdr.repeat_x = self.hdr.repeat_y = False
        self.fbo_hdr = ctx.framebuffer([self.hdr])
        self.levels = []
        w, h = self.sw, self.sh
        for i in range(7):
            w, h = max(w // 2, 1), max(h // 2, 1)
            d = ctx.texture((w, h), 4, dtype="f2")
            u = ctx.texture((w, h), 4, dtype="f2")
            for t in (d, u):
                t.filter = (moderngl.LINEAR, moderngl.LINEAR)
                t.repeat_x = t.repeat_y = False
            self.levels.append((d, ctx.framebuffer([d]), u, ctx.framebuffer([u]), (w, h)))
        self.out = ctx.texture((out_w, out_h), 4)
        self.fbo_out = ctx.framebuffer([self.out])
        self.text_tex = {}
        self.empty_text = ctx.texture((1, 1), 4, np.zeros(4, "u1").tobytes())

    def _text(self, name):
        if name is None:
            return self.empty_text
        if name not in self.text_tex:
            img = textcards.card(name, self.out_w, self.out_h)
            t = self.ctx.texture(img.size, 4, img.tobytes())
            t.filter = (moderngl.LINEAR, moderngl.LINEAR)
            self.text_tex[name] = t
        return self.text_tex[name]

    @staticmethod
    def _set(prog, name, val):
        if name not in prog:
            return
        m = prog[name]
        if isinstance(val, np.ndarray):
            if val.shape == (3, 3):
                m.write(val.T.astype("f4").tobytes())
            elif val.ndim == 2:
                m.write(val.astype("f4").tobytes())
            else:
                m.value = tuple(float(x) for x in val)
        elif isinstance(val, int) and not isinstance(val, bool):
            m.value = val
        else:
            m.value = float(val)

    def render(self, t, fps, samples, frame_index=0, shutter=0.5):
        """Render the frame at time t; returns (H, W, 3) uint8."""
        ctx = self.ctx
        shot = TL.shot_at(t)[1]
        self.fbo_hdr.use()
        ctx.viewport = (0, 0, self.sw, self.sh)
        self.fbo_hdr.clear(0, 0, 0, 0)
        ctx.enable(moderngl.BLEND)
        ctx.blend_func = moderngl.ONE, moderngl.ONE
        post = None
        for j in range(samples):
            if samples > 1:
                dt = ((j + 0.5) / samples - 0.5) * shutter / fps
                jit = (halton(j + 1, 2) - 0.5, halton(j + 1, 3) - 0.5)
            else:
                dt, jit = 0.0, (0.0, 0.0)
            st = scene.world_state(t + dt, shot)
            uni, p = scene.finalize(st)
            if j == samples // 2 or post is None:
                post = p
            uni["uExposure"] = uni["uExposure"] / samples
            uni["uRes"] = (float(self.sw), float(self.sh))
            uni["uJitter"] = jit
            for k, v in uni.items():
                self._set(self.p_scene, k, v if not isinstance(v, tuple) else np.array(v))
            self.vaos[self.p_scene].render()
        ctx.disable(moderngl.BLEND)
        # bloom: downsample chain
        src, first = self.hdr, 1
        for d, fd, u, fu, (w, h) in self.levels:
            fd.use()
            ctx.viewport = (0, 0, w, h)
            src.use(0)
            self.p_down["uTex"].value = 0
            self.p_down["uTexel"].value = (1.0 / src.width, 1.0 / src.height)
            self.p_down["uFirst"].value = first
            self.vaos[self.p_down].render()
            src, first = d, 0
        # upsample chain
        n = len(self.levels)
        coarse = self.levels[-1][0]
        for i in range(n - 2, -1, -1):
            d, fd, u, fu, (w, h) = self.levels[i]
            fu.use()
            ctx.viewport = (0, 0, w, h)
            coarse.use(0)
            d.use(1)
            self.p_up["uCoarse"].value = 0
            self.p_up["uFine"].value = 1
            self.p_up["uTexel"].value = (1.0 / coarse.width, 1.0 / coarse.height)
            self.p_up["uRadius"].value = 1.0
            self.vaos[self.p_up].render()
            coarse = u
        # composite
        self.fbo_out.use()
        ctx.viewport = (0, 0, self.out_w, self.out_h)
        self.hdr.use(0)
        coarse.use(1)
        self._text(post["text"]).use(2)
        pc = self.p_comp
        pc["uHdr"].value, pc["uBloom"].value, pc["uText"].value = 0, 1, 2
        pc["uOutRes"].value = (float(self.out_w), float(self.out_h))
        pc["uSceneAspect"].value = SCENE_ASPECT
        pc["uBloomAmt"].value = post["bloom"]
        pc["uFade"].value = post["fade"]
        pc["uTextA"].value = post["text_a"]
        pc["uFrame"].value = float(frame_index % 997)
        pc["uGrain"].value = post["grain"]
        pc["uCA"].value = post["ca"] + 0.012
        pc["uLetterbox"].value = 1.0
        self.vaos[pc].render()
        data = self.fbo_out.read(components=3)
        return np.frombuffer(data, dtype=np.uint8).reshape(self.out_h, self.out_w, 3)


def out_dir(*p):
    d = os.path.join(ROOT, "output", *p)
    os.makedirs(d, exist_ok=True)
    return d


def make_engine(scale):
    return Engine(int(round(OUT_W * scale / 2)) * 2, int(round(OUT_H * scale / 2)) * 2)


def cmd_still(args):
    eng = make_engine(args.scale)
    for tt in args.times:
        img = eng.render(tt, 60, args.samples)
        path = os.path.join(out_dir("stills"), f"t{tt:07.2f}.png")
        Image.fromarray(img).save(path)
        print(path)


def cmd_sheet(args):
    eng = make_engine(args.scale)
    ts = list(np.arange(args.start, args.end + 1e-6, args.every))
    tiles = []
    t0 = time.time()
    for tt in ts:
        tt = float(min(tt, TL.DURATION - 0.01))
        tiles.append((tt, Image.fromarray(eng.render(tt, 60, args.samples))))
    print(f"{len(ts)} frames in {time.time() - t0:.1f}s")
    cols = args.cols
    w, h = tiles[0][1].size
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * w, rows * h), (40, 40, 40))
    d = ImageDraw.Draw(sheet)
    font = ImageFont.truetype(textcards.FONT, max(12, h // 12))
    for i, (tt, im) in enumerate(tiles):
        x, y = (i % cols) * w, (i // cols) * h
        sheet.paste(im, (x, y))
        d.text((x + 6, y + 4), f"{tt:.1f}s {TL.shot_at(tt)[1]}", fill=(255, 255, 0), font=font)
    path = args.out or os.path.join(out_dir("sheets"), f"sheet_{args.start:05.1f}_{args.end:05.1f}.png")
    sheet.save(path)
    print(path)


def encoder(path, w, h, fps, crf, preset):
    return subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{w}x{h}", "-r", str(fps), "-i", "-", "-c:v", "libx264", "-preset", preset,
         "-crf", str(crf), "-pix_fmt", "yuv420p", "-g", str(fps * 2), path],
        stdin=subprocess.PIPE)


def render_shot(eng, idx, prof, profile_name, force=False):
    name, a, b = TL.SHOTS[idx]
    path = os.path.join(out_dir(profile_name, "shots"), f"{idx:02d}_{name}.mp4")
    if os.path.exists(path) and not force:
        print(f"skip {path} (exists)")
        return path
    fps = prof["fps"]
    n0, n1 = int(round(a * fps)), int(round(b * fps))
    tmp = path + ".part.mp4"
    enc = encoder(tmp, eng.out_w, eng.out_h, fps, prof["crf"], prof["preset"])
    t0 = time.time()
    for fi in range(n0, n1):
        img = eng.render(fi / fps, fps, prof["samples"], frame_index=fi)
        enc.stdin.write(img.tobytes())
    enc.stdin.close()
    enc.wait()
    os.replace(tmp, path)
    dt = time.time() - t0
    print(f"shot {idx:02d} {name}: {n1 - n0} frames in {dt:.1f}s ({(n1 - n0) / dt:.1f} fps)", flush=True)
    return path


def cmd_shot(args):
    prof = PROFILES[args.profile]
    eng = make_engine(prof["scale"])
    names = [s[0] for s in TL.SHOTS]
    for sh in args.shots:
        idx = int(sh) if sh.isdigit() else names.index(sh)
        render_shot(eng, idx, prof, args.profile, force=True)


def cmd_film(args):
    prof = PROFILES[args.profile]
    eng = make_engine(prof["scale"])
    t0 = time.time()
    paths = [render_shot(eng, i, prof, args.profile, force=args.force) for i in range(len(TL.SHOTS))]
    lst = os.path.join(out_dir(args.profile), "concat.txt")
    with open(lst, "w") as f:
        for p in paths:
            f.write(f"file '{p}'\n")
    video = os.path.join(out_dir(args.profile), "video.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst,
                    "-c", "copy", video], check=True)
    wav = os.path.join(ROOT, "output", "audio", "score.wav")
    final = os.path.join(ROOT, "output", "film.mp4" if args.profile == "final" else f"{args.profile}.mp4")
    if os.path.exists(wav):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", video, "-i", wav, "-c:v", "copy",
                        "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", final],
                       check=True)
    else:
        os.replace(video, final)
        print("warning: no audio found at", wav)
    print(f"wrote {final} in {time.time() - t0:.0f}s")


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    a = sp.add_parser("still")
    a.add_argument("times", type=float, nargs="+")
    a.add_argument("--scale", type=float, default=0.5)
    a.add_argument("--samples", type=int, default=1)
    a = sp.add_parser("sheet")
    a.add_argument("--start", type=float, default=0.0)
    a.add_argument("--end", type=float, default=TL.DURATION)
    a.add_argument("--every", type=float, default=2.0)
    a.add_argument("--scale", type=float, default=0.2)
    a.add_argument("--samples", type=int, default=1)
    a.add_argument("--cols", type=int, default=6)
    a.add_argument("--out", default=None)
    a = sp.add_parser("shot")
    a.add_argument("shots", nargs="+")
    a.add_argument("--profile", default="preview")
    a = sp.add_parser("film")
    a.add_argument("--profile", default="preview")
    a.add_argument("--force", action="store_true")
    args = ap.parse_args()
    {"still": cmd_still, "sheet": cmd_sheet, "shot": cmd_shot, "film": cmd_film}[args.cmd](args)


if __name__ == "__main__":
    main()
