"""Clip Studio — local web app. Run with ./run.sh, then open http://localhost:5055"""

import os
import shutil
import threading
import time

from flask import Flask, abort, jsonify, request, send_file, send_from_directory

from . import autopilot, faces, jobs, publish, render, social, store
from . import edit as E
from .finder import claude_available
from .social import caption

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
    return send_from_directory(STATIC, f, max_age=0)  # always revalidate so updates show up


@app.get("/fonts/<path:f>")
def fonts(f):
    return send_from_directory(store.FONTS, f, max_age=86400)


@app.get("/api/config")
def config():
    return jsonify({
        "presets": E.PRESETS, "hookStyles": E.HOOK_STYLES, "aspects": E.ASPECTS,
        "fonts": {k: {"ass": v[0], "css": v[1]} for k, v in E.FONTS.items()},
        "music": sorted(f for f in os.listdir(store.MUSIC) if os.path.splitext(f)[1].lower() in MUSIC_EXT),
        "claude": claude_available(), "models": WHISPER_MODELS, "autopilot": publish.settings()["auto_new"],
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
    settings = _settings(request.form)
    url = (request.form.get("url") or "").strip()
    auto = request.form.get("autopilot") in ("1", "true", "on")
    if url:
        if not url.startswith(("http://", "https://")):
            return jsonify(error="That doesn't look like a link"), 400
        return jsonify(jobs.new_project(settings, url=url, autopilot=auto))
    f = request.files.get("file")
    ext = os.path.splitext(f.filename if f else "")[1].lower()
    if not f or ext not in VIDEO_EXT:
        return jsonify(error="Upload a video file (mp4, mov, mkv, webm…)"), 400
    p = jobs.new_project(settings, autopilot=auto, name=os.path.splitext(f.filename)[0],
                         source={"type": "file"}, source_file=f"source{ext}")
    f.save(store.pdir(p["id"], f"source{ext}"))
    jobs.submit(p["id"])
    return jsonify(p)


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


# ------------------------------------------------------------------ social accounts

def _redirect(platform):
    return f"{request.host_url.rstrip('/')}/api/social/oauth/{platform}/callback"


@app.get("/api/social")
def social_state():
    return jsonify({"platforms": social.platform_info(), "accounts": [social.public(a) for a in social.accounts()],
                    "redirects": {k: _redirect(k) for k, m in social.PLATFORMS.items() if m.KIND == "oauth"}})


@app.post("/api/social/apps/<platform>")
def social_app(platform):
    if platform not in social.PLATFORMS:
        abort(404)
    if request.files.get("client"):
        import json
        try:
            client = json.load(request.files["client"])
            assert "installed" in client or "web" in client
        except Exception:  # noqa: BLE001
            return jsonify(error="That isn't a Google OAuth client JSON (it should contain “installed” or “web”)"), 400
        social.set_app(platform, {"client": client})
    else:
        body = request.json or {}
        if body.get("clear"):
            social.set_app(platform, None)
        else:
            fields = {f["name"]: str(body.get(f["name"], "")).strip() for f in social.PLATFORMS[platform].APP_FIELDS}
            if not all(v for k, v in fields.items() if k != "redirect_uri"):
                return jsonify(error="Fill in all the fields"), 400
            social.set_app(platform, fields)
    return social_state()


@app.post("/api/social/connect/<platform>")
def social_connect(platform):
    m = social.PLATFORMS.get(platform) or abort(404)
    try:
        if m.KIND == "oauth":
            return jsonify(url=social.oauth_start(platform, _redirect(platform)))
        return jsonify(account=social.public(social.connect_direct(platform, request.json or {})))
    except Exception as e:  # noqa: BLE001
        return jsonify(error=str(e)[:400]), 400


@app.get("/api/social/oauth/<platform>/callback")
def social_callback(platform):
    try:
        a = social.oauth_finish(request.url, request.args.to_dict())
        msg, ok = f"Connected {a['name']} ✓", True
    except Exception as e:  # noqa: BLE001
        msg, ok = f"Couldn't connect: {e}", False
    color = "#22c55e" if ok else "#ef4444"
    return (f"<!doctype html><meta charset=utf-8><title>Clip Studio</title><body style='background:#0e0f13;"
            f"color:#eee;font:16px system-ui;display:grid;place-items:center;height:90vh'><div style='text-align:center'>"
            f"<h2 style='color:{color}'>{msg}</h2><p>You can close this tab.</p><a style='color:#a78bfa' "
            f"href='/#/accounts'>Back to Clip Studio</a></div><script>try{{opener&&opener.postMessage('social-connected','*')}}"
            f"catch(e){{}}{'setTimeout(()=>window.close(),1500)' if ok else ''}</script>")


@app.post("/api/social/oauth/paste")
def social_paste():
    from urllib.parse import parse_qs, urlparse
    url = ((request.json or {}).get("url") or "").strip()
    params = {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}
    if "code" not in params and "error" not in params:
        return jsonify(error="That address has no ?code=… in it — paste the full URL from the address bar"), 400
    try:
        return jsonify(account=social.public(social.oauth_finish(url, params)))
    except Exception as e:  # noqa: BLE001
        return jsonify(error=str(e)[:400]), 400


@app.post("/api/social/import/stream-clipper")
def social_import():
    try:
        return jsonify(account=social.public(social.import_stream_clipper_youtube()))
    except Exception as e:  # noqa: BLE001
        return jsonify(error=str(e)[:400]), 400


@app.post("/api/social/accounts/<aid>/check")
def social_check(aid):
    social.account(aid) or abort(404)
    try:
        return jsonify(account=social.public(social.check(aid)))
    except Exception as e:  # noqa: BLE001
        a = social.account(aid)
        a["error"] = str(e)[:300]
        social.save_account(a)
        return jsonify(error=a["error"]), 400


@app.delete("/api/social/accounts/<aid>")
def social_remove(aid):
    social.remove_account(aid)
    s = publish.settings()
    s["accounts"] = [a for a in s["accounts"] if a != aid]
    publish.save_settings(s)
    return jsonify(ok=True)


# ------------------------------------------------------------------ posts

def _post_out(p):
    names = {a["id"]: a for a in social.accounts()}
    out = {**p, "targets": [{**t, "name": names.get(t["account"], {}).get("name", "(removed account)"),
                             "platform": names.get(t["account"], {}).get("platform")} for t in p["targets"]]}
    job = jobs.exports.get(p.get("export"))
    if p["status"] == "rendering" and job:
        out["progress"] = job.get("progress", 0)
    proj = store.get_project(p["pid"]) or {}
    out["project"] = proj.get("name")
    return out


@app.get("/api/posts")
def post_list():
    return jsonify([_post_out(p) for p in sorted(publish.posts(), key=lambda p: p.get("at") or p["created"], reverse=True)])


def _when(v):
    if v in ("now", "slot"):
        return v
    try:
        return float(v)
    except (TypeError, ValueError):
        return "slot"


@app.post("/api/posts")
def post_create():
    b = request.json or {}
    try:
        p = publish.create(b["pid"], b["cid"], b.get("accounts", []), b.get("title", ""), b.get("text", ""),
                           b.get("hashtags", []), b.get("privacy"), _when(b.get("when")), bool(b.get("rerender")),
                           bool(b.get("approval")), tiktok_mode=b.get("tiktok_mode"))
        return jsonify(_post_out(p))
    except (KeyError, ValueError) as e:
        return jsonify(error=str(e)), 400


@app.patch("/api/posts/<post_id>")
def post_edit(post_id):
    b = request.json or {}
    publish.get(post_id) or abort(404)
    act = b.get("action")
    if act == "approve":
        p = publish.approve(post_id, _when(b["when"]) if "when" in b else None)
    elif act == "publish_now":
        p = publish.publish_now(post_id)
    elif act == "reject":
        p = publish.update(post_id, lambda x: x.update(status="rejected"))
    else:
        def mut(x):
            if x["status"] in ("approval", "scheduled", "rendering", "error", "rejected"):
                for k in ("title", "text", "privacy"):
                    if k in b:
                        x[k] = str(b[k])[:2000]
                if "hashtags" in b:
                    x["hashtags"] = [h.strip().lstrip("#") for h in b["hashtags"] if h.strip()][:30]
                if "at" in b and x["status"] == "scheduled":
                    x["at"] = float(b["at"])
        p = publish.update(post_id, mut)
    return jsonify(_post_out(p))


@app.delete("/api/posts/<post_id>")
def post_delete(post_id):
    publish.delete(post_id)
    return jsonify(ok=True)


@app.get("/api/posts/next-slot")
def post_next_slot():
    return jsonify(at=publish.next_slot())


@app.post("/api/projects/<pid>/clips/<cid>/caption")
def clip_caption(pid, cid):
    _project_or_404(pid)
    clip = store.get_clip(pid, cid) or abort(404)
    s = publish.settings()
    engine = (request.json or {}).get("engine") or s["caption_engine"]
    return jsonify(caption.generate(pid, clip, publish.base_tags(s), engine))


# ------------------------------------------------------------------ autopilot

@app.get("/api/autopilot")
def autopilot_get():
    return jsonify(publish.settings())


@app.put("/api/autopilot")
def autopilot_put():
    b = request.json or {}
    s = publish.settings()
    for k in ("auto_new", "auto_publish", "approval"):
        if k in b:
            s[k] = bool(b[k])
    for k, lo, hi in (("export_top", 1, 20), ("min_score", 0, 99), ("watch_interval", 5, 1440), ("max_video_min", 1, 1440)):
        if k in b:
            try:
                s[k] = max(lo, min(hi, float(b[k])))
            except (TypeError, ValueError):
                pass
    for k in ("privacy", "tiktok_mode", "hashtags", "caption_engine", "ntfy"):
        if k in b:
            s[k] = str(b[k]).strip()[:300]
    if "slots" in b:
        s["slots"] = [x for x in (str(v).strip() for v in b["slots"]) if publish._parse_slot(x)][:24]
    if "accounts" in b:
        s["accounts"] = [a for a in b["accounts"] if social.account(a)]
    if "project" in b:
        s["project"] = {**s["project"], **_settings({**s["project"], **b["project"]})}
    publish.save_settings(s)
    return jsonify(s)


@app.post("/api/autopilot/sources")
def source_add():
    b = request.json or {}
    url = (b.get("url") or "").strip()
    if not url.startswith(("http://", "https://")):
        return jsonify(error="Paste a channel / playlist link"), 400
    s = publish.settings()
    src = {"id": store.new_id(4), "url": autopilot.normalize_source(url), "enabled": True, "added": time.time(),
           "backfill": int(max(0, min(10, float(b.get("backfill") or 0)))), "autopilot": True, "seen": []}
    s["sources"].append(src)
    publish.save_settings(s)
    threading.Thread(target=autopilot.check_source, args=(src["id"],), daemon=True).start()
    return jsonify(src)


@app.patch("/api/autopilot/sources/<sid>")
def source_edit(sid):
    b = request.json or {}
    s = publish.settings()
    for src in s["sources"]:
        if src["id"] == sid:
            for k in ("enabled", "autopilot"):
                if k in b:
                    src[k] = bool(b[k])
            if "project" in b:
                src["project"] = {k: v for k, v in (b["project"] or {}).items() if k in s["project"]}
    publish.save_settings(s)
    return jsonify(ok=True)


@app.delete("/api/autopilot/sources/<sid>")
def source_delete(sid):
    s = publish.settings()
    s["sources"] = [x for x in s["sources"] if x["id"] != sid]
    publish.save_settings(s)
    return jsonify(ok=True)


@app.post("/api/autopilot/sources/<sid>/check")
def source_check(sid):
    return jsonify(new=autopilot.check_source(sid))


@app.post("/api/projects/<pid>/autopilot")
def project_autopilot(pid):
    p = _project_or_404(pid)
    if p.get("status") != "ready":
        store.update_project(pid, autopilot=True)
        return jsonify(n=0, later=True)
    return jsonify(n=autopilot.run_on_project(pid, force=True))


def main():
    jobs.start()
    publish.start()
    autopilot.start()
    port = int(os.environ.get("PORT", 5055))
    print(f"\n  Clip Studio running at http://localhost:{port}\n")
    app.run(host="127.0.0.1", port=port, threaded=True, debug=False)


if __name__ == "__main__":
    main()
