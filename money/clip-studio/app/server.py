"""Clip Studio — local web app. Run with ./run.sh, then open http://localhost:5055"""

import os
import shutil
import threading
import time

from flask import Flask, abort, jsonify, request, send_file, send_from_directory

from . import edit as E
from . import faces, jobs, render, store
from .finder import claude_available

STATIC = os.path.join(os.path.dirname(__file__), "static")
app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 ** 3

VIDEO_EXT = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi", ".flv", ".ts", ".mpg", ".mpeg", ".wmv"}
MUSIC_EXT = {".mp3", ".m4a", ".wav", ".ogg", ".aac", ".flac"}
WHISPER_MODELS = ["base", "small", "medium", "large-v3-turbo"]


def _project_or_404(pid):
    p = store.get_project(pid)
    if not p or "/" in pid or ".." in pid:
        abort(404)
    return p


def _settings(form):
    def num(k, d, lo, hi):
        try:
            return max(lo, min(hi, float(form.get(k, d))))
        except (TypeError, ValueError):
            return d
    mn = num("minLen", 20, 5, 170)
    return {
        "minLen": mn, "maxLen": max(mn + 5, num("maxLen", 60, 10, 180)),
        "count": int(num("count", 10, 1, 40)),
        "model": form.get("model") if form.get("model") in WHISPER_MODELS else "small",
        "language": (form.get("language") or "").strip()[:5],
        "engine": "claude" if form.get("engine") == "claude" else "local",
        "focus": (form.get("focus") or "").strip()[:300],
    }


# ------------------------------------------------------------------ pages

@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.get("/static/<path:f>")
def static_files(f):
    return send_from_directory(STATIC, f)


@app.get("/fonts/<path:f>")
def fonts(f):
    return send_from_directory(store.FONTS, f, max_age=86400)


@app.get("/api/config")
def config():
    return jsonify({
        "presets": E.PRESETS, "hookStyles": E.HOOK_STYLES, "aspects": E.ASPECTS,
        "fonts": {k: {"ass": v[0], "css": v[1]} for k, v in E.FONTS.items()},
        "music": sorted(f for f in os.listdir(store.MUSIC) if os.path.splitext(f)[1].lower() in MUSIC_EXT),
        "claude": claude_available(), "models": WHISPER_MODELS,
    })


# ------------------------------------------------------------------ projects

@app.get("/api/projects")
def projects():
    out = []
    for p in store.list_projects():
        p["clipCount"] = len(store.get_clips(p["id"]))
        out.append(p)
    return jsonify(out)


@app.post("/api/projects")
def create_project():
    pid = store.new_id()
    os.makedirs(store.pdir(pid))
    settings = _settings(request.form)
    url = (request.form.get("url") or "").strip()
    base = {"id": pid, "created": time.time(), "status": "processing", "stage": "Queued", "progress": 0,
            "settings": settings}
    if url:
        if not url.startswith(("http://", "https://")):
            shutil.rmtree(store.pdir(pid))
            return jsonify(error="That doesn't look like a link"), 400
        store.write_json(store.pdir(pid, "project.json"), {**base, "name": url, "source": {"type": "url", "url": url}})
    else:
        f = request.files.get("file")
        ext = os.path.splitext(f.filename if f else "")[1].lower()
        if not f or ext not in VIDEO_EXT:
            shutil.rmtree(store.pdir(pid))
            return jsonify(error="Upload a video file (mp4, mov, mkv, webm…)"), 400
        f.save(store.pdir(pid, f"source{ext}"))
        name = os.path.splitext(f.filename)[0]
        store.write_json(store.pdir(pid, "project.json"),
                         {**base, "name": name, "source": {"type": "file"}, "source_file": f"source{ext}"})
    jobs.submit(pid)
    return jsonify(store.get_project(pid))


@app.get("/api/projects/<pid>")
def project(pid):
    p = _project_or_404(pid)
    return jsonify({"project": p, "clips": store.get_clips(pid)})


@app.patch("/api/projects/<pid>")
def rename_project(pid):
    _project_or_404(pid)
    name = (request.json or {}).get("name", "").strip()
    return jsonify(store.update_project(pid, name=name[:200]) if name else store.get_project(pid))


@app.delete("/api/projects/<pid>")
def delete_project(pid):
    _project_or_404(pid)
    shutil.rmtree(store.pdir(pid))
    return jsonify(ok=True)


@app.post("/api/projects/<pid>/refind")
def refind(pid):
    p = _project_or_404(pid)
    if p.get("status") == "processing":
        return jsonify(error="Still processing"), 409
    settings = {**p["settings"], **_settings({**p["settings"], **(request.json or {})})}
    keep_old = bool((request.json or {}).get("append"))
    store.update_project(pid, settings=settings, status="processing", stage="Finding viral moments", progress=0)

    def go():
        try:
            jobs.find_clips(pid, settings, replace=not keep_old)
            store.update_project(pid, status="ready", stage="Done", progress=1)
        except Exception as e:  # noqa: BLE001
            store.update_project(pid, status="error", error=str(e)[:500])
    threading.Thread(target=go, daemon=True).start()
    return jsonify(ok=True)


@app.get("/api/projects/<pid>/video")
def video(pid):
    p = _project_or_404(pid)
    f = p.get("play_file") or p.get("source_file")
    if not f:
        abort(404)
    return send_file(store.pdir(pid, f), conditional=True)


@app.get("/api/projects/<pid>/thumb")
def thumb(pid):
    _project_or_404(pid)
    path = store.pdir(pid, "thumb.jpg")
    return send_file(path) if os.path.exists(path) else ("", 404)


@app.get("/api/projects/<pid>/thumbs/<cid>.jpg")
def clip_thumb(pid, cid):
    _project_or_404(pid)
    return send_from_directory(store.pdir(pid, "thumbs"), f"{cid}.jpg")


@app.get("/api/projects/<pid>/transcript")
def transcript(pid):
    _project_or_404(pid)
    return jsonify(store.get_transcript(pid) or {"words": []})


# ------------------------------------------------------------------ clips

def _editor_payload(pid, clip, with_faces=True):
    p = store.get_project(pid)
    words = store.get_transcript(pid)["words"]
    ed = clip["edit"]
    tl = E.timeline(words, ed)
    out = {"clip": clip, "timeline": tl, "layout": E.layout(words, ed, tl)}
    if with_faces:
        tracks = faces.ensure(pid, clip, store.pdir(pid, p["source_file"]), p["info"])
        out["tracks"] = {**render.track_for_preview(tracks, tl["keep"]),
                         "found": tracks.get("found"), "two": tracks.get("two")}
    return out


@app.get("/api/projects/<pid>/clips/<cid>")
def get_clip(pid, cid):
    p = _project_or_404(pid)
    clip = store.get_clip(pid, cid) or abort(404)
    words = store.get_transcript(pid)["words"]
    s, e = clip["edit"]["start"] - 60, clip["edit"]["end"] + 60
    near = [{"i": i, **w} for i, w in enumerate(words) if s <= w["s"] <= e]
    return jsonify({**_editor_payload(pid, clip), "words": near, "project": p})


@app.put("/api/projects/<pid>/clips/<cid>")
def save_clip(pid, cid):
    p = _project_or_404(pid)
    body = request.json or {}
    dur = p["info"]["duration"]

    def mutate(c):
        if "title" in body:
            c["title"] = str(body["title"])[:200]
        if "edit" in body:
            ed = body["edit"]
            ed["start"] = max(0.0, min(float(ed["start"]), dur - 0.5))
            ed["end"] = max(ed["start"] + 0.5, min(float(ed["end"]), dur))
            c["edit"] = ed
    clip = store.update_clip(pid, cid, mutate) or abort(404)
    return jsonify(_editor_payload(pid, clip, with_faces=bool(body.get("faces"))))


@app.post("/api/projects/<pid>/clips")
def new_clip(pid):
    p = _project_or_404(pid)
    b = request.json or {}
    s = max(0.0, float(b.get("start", 0)))
    e = min(p["info"]["duration"], float(b.get("end", s + 30)))
    if e - s < 1:
        return jsonify(error="Clip must be at least 1 second"), 400
    return jsonify(jobs.add_manual_clip(pid, s, e, b.get("title") or "Custom clip"))


@app.post("/api/projects/<pid>/clips/<cid>/duplicate")
def duplicate_clip(pid, cid):
    _project_or_404(pid)
    import copy
    c = copy.deepcopy(store.get_clip(pid, cid) or abort(404))
    old = c["id"]
    c.update(id=store.new_id(4), title=c["title"] + " (copy)", exports=[], created=time.time())
    clips = store.get_clips(pid)
    clips.insert(next(i for i, x in enumerate(clips) if x["id"] == old) + 1, c)
    store.save_clips(pid, clips)
    for sub, ext in (("thumbs", "jpg"), ("faces", "json")):
        src = store.pdir(pid, sub, f"{old}.{ext}")
        if os.path.exists(src):
            shutil.copy(src, store.pdir(pid, sub, f"{c['id']}.{ext}"))
    return jsonify(c)


@app.delete("/api/projects/<pid>/clips/<cid>")
def delete_clip(pid, cid):
    _project_or_404(pid)
    store.save_clips(pid, [c for c in store.get_clips(pid) if c["id"] != cid])
    return jsonify(ok=True)


@app.post("/api/projects/<pid>/clips/<cid>/reset")
def reset_clip(pid, cid):
    _project_or_404(pid)

    def mutate(c):
        keep = {k: c["edit"][k] for k in ("start", "end")}
        c["edit"] = {**E.default_edit(c), **keep}
    clip = store.update_clip(pid, cid, mutate) or abort(404)
    return jsonify(_editor_payload(pid, clip))


# ------------------------------------------------------------------ exports

@app.post("/api/projects/<pid>/clips/<cid>/export")
def export(pid, cid):
    _project_or_404(pid)
    store.get_clip(pid, cid) or abort(404)
    return jsonify(jobs.queue_export(pid, cid))


@app.get("/api/exports")
def export_list():
    return jsonify(sorted(jobs.exports.values(), key=lambda j: j["created"], reverse=True))


@app.get("/api/projects/<pid>/exports/<path:f>")
def export_file(pid, f):
    _project_or_404(pid)
    return send_from_directory(store.pdir(pid, "exports"), f, as_attachment=request.args.get("dl") == "1",
                               conditional=True)


# ------------------------------------------------------------------ music

@app.get("/api/music/<path:f>")
def music_file(f):
    return send_from_directory(store.MUSIC, f, conditional=True)


@app.post("/api/music")
def upload_music():
    f = request.files.get("file")
    ext = os.path.splitext(f.filename if f else "")[1].lower()
    if not f or ext not in MUSIC_EXT:
        return jsonify(error="Upload an audio file (mp3, m4a, wav, ogg)"), 400
    name = os.path.basename(f.filename).replace("/", "_")
    f.save(os.path.join(store.MUSIC, name))
    return jsonify(file=name)


def main():
    jobs.start()
    port = int(os.environ.get("PORT", 5055))
    print(f"\n  Clip Studio running at http://localhost:{port}\n")
    app.run(host="127.0.0.1", port=port, threaded=True, debug=False)


if __name__ == "__main__":
    main()
