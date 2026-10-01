"""Background work: one thread processes new projects (download, transcribe,
find clips, track faces), another works through the export queue so several
exports don't fight over the CPU at once."""

import os
import queue
import shutil
import threading
import time
import traceback

from . import edit as E
from . import faces, finder, media, store
from . import transcribe as T

_process_q = queue.Queue()
_export_q = queue.Queue()
exports = {}  # export id -> status dict
_exports_lock = threading.Lock()
# callbacks other modules register: fn(pid) when a project finishes processing,
# fn(job) when an export finishes (job["status"] is "done" or "error")
ready_hooks = []
export_hooks = []


def _fire(hooks, *a):
    for fn in hooks:
        try:
            fn(*a)
        except Exception:  # noqa: BLE001 - a hook must never break the pipeline
            traceback.print_exc()


def new_project(settings, url=None, name=None, autopilot=False, **extra):
    """Creates the project folder + project.json. For URL projects it is queued
    straight away; uploads call submit() after saving the file."""
    pid = store.new_id()
    os.makedirs(store.pdir(pid))
    p = {"id": pid, "created": time.time(), "status": "processing", "stage": "Queued", "progress": 0,
         "settings": settings, "autopilot": bool(autopilot), **extra}
    if url:
        p.update(name=name or url, source={"type": "url", "url": url})
    store.write_json(store.pdir(pid, "project.json"), p)
    if url:
        submit(pid)
    return p


def stage(pid, name, progress, **kw):
    store.update_project(pid, stage=name, progress=round(progress, 3), **kw)


def process(pid):
    p = store.get_project(pid)
    opts = p["settings"]
    d = store.pdir(pid)
    try:
        if p["source"]["type"] == "url":
            stage(pid, "Downloading video", 0)
            path, title = media.download(p["source"]["url"], d, lambda f: stage(pid, "Downloading video", f))
            if p.get("name", "").startswith("http") or not p.get("name"):
                store.update_project(pid, name=title)
        else:
            path = store.pdir(pid, p["source_file"])
        info = media.probe(path)
        store.update_project(pid, source_file=os.path.basename(path), info=info)
        play = os.path.basename(path)
        if media.needs_proxy(info, path):
            stage(pid, "Converting for preview", 0)
            media.make_proxy(path, store.pdir(pid, "proxy.mp4"), info["duration"],
                             lambda f: stage(pid, "Converting for preview", f))
            play = "proxy.mp4"
        store.update_project(pid, play_file=play)
        media.thumbnail(path, min(info["duration"] * 0.2, 30), store.pdir(pid, "thumb.jpg"), 480)
        if not info["has_audio"]:
            raise RuntimeError("This video has no audio track, so there's nothing to transcribe")
        stage(pid, "Extracting audio", 0)
        wav = store.pdir(pid, "audio.wav")
        media.extract_audio(path, wav)
        stage(pid, f"Transcribing ({opts['model']})", 0)
        tr = T.transcribe(wav, info["duration"], opts["model"], opts.get("language") or None,
                          lambda f: stage(pid, f"Transcribing ({opts['model']})", f))
        store.write_json(store.pdir(pid, "transcript.json"), tr)
        if not tr["words"]:
            raise RuntimeError("No speech was found in this video")
        find_clips(pid, opts)
        stage(pid, "Done", 1, status="ready")
        _fire(ready_hooks, pid)
    except Exception as e:  # noqa: BLE001 - surface any failure in the UI
        traceback.print_exc()
        store.update_project(pid, status="error", error=str(e)[:500])


def find_clips(pid, opts, replace=True):
    p = store.get_project(pid)
    info = p["info"]
    tr = store.get_transcript(pid)
    stage(pid, "Finding viral moments", 0.1)
    env = media.loudness_envelope(store.pdir(pid, "audio.wav"))
    found, note = None, ""
    if opts.get("engine") == "claude":
        try:
            found = finder.find_claude(tr["words"], opts["minLen"], opts["maxLen"], opts["count"], opts.get("focus", ""))
        except Exception as e:  # noqa: BLE001
            note = f"Claude picker failed ({str(e)[:160]}); used the local picker instead."
    if not found:
        found = finder.find_local(tr["words"], env, opts["minLen"], opts["maxLen"], opts["count"], opts.get("focus", ""))
    found.sort(key=lambda c: c["score"], reverse=True)
    clips = [] if replace else store.get_clips(pid)
    src = store.pdir(pid, p["source_file"])
    os.makedirs(store.pdir(pid, "thumbs"), exist_ok=True)
    for k, c in enumerate(found):
        c["id"] = store.new_id(4)
        c["created"] = time.time()
        c["edit"] = E.default_edit(c)
        stage(pid, "Reframing clips (face tracking)", 0.2 + 0.8 * k / max(1, len(found)))
        try:
            tracks = faces.ensure(pid, c, src, info)
            if tracks.get("two"):
                c["edit"]["layout"]["mode"] = "split"
            elif not tracks.get("found"):
                c["edit"]["layout"]["mode"] = "fit"
        except Exception:  # noqa: BLE001 - tracking failure shouldn't kill the project
            traceback.print_exc()
        media.thumbnail(src, c["start"] + 1.0, store.pdir(pid, "thumbs", f"{c['id']}.jpg"))
        clips.append(c)
    store.save_clips(pid, clips)
    store.update_project(pid, note=note)


def add_manual_clip(pid, start, end, title="Custom clip"):
    p = store.get_project(pid)
    c = {"id": store.new_id(4), "start": start, "end": end, "score": None, "title": title,
         "hook": "", "reasons": ["Added manually"], "created": time.time(), "manual": True}
    c["edit"] = E.default_edit(c)
    c["edit"]["hook"]["enabled"] = False
    src = store.pdir(pid, p["source_file"])
    os.makedirs(store.pdir(pid, "thumbs"), exist_ok=True)
    media.thumbnail(src, start + 0.5, store.pdir(pid, "thumbs", f"{c['id']}.jpg"))
    clips = store.get_clips(pid)
    clips.insert(0, c)
    store.save_clips(pid, clips)
    return c


def queue_export(pid, cid, post_id=None):
    eid = store.new_id(5)
    clip = store.get_clip(pid, cid)
    with _exports_lock:
        exports[eid] = {"id": eid, "pid": pid, "cid": cid, "title": clip["title"], "status": "queued",
                        "progress": 0, "created": time.time(), "post": post_id}
    _export_q.put(eid)
    return exports[eid]


def _export(eid):
    job = exports[eid]
    pid, cid = job["pid"], job["cid"]
    clip = store.get_clip(pid, cid)
    out_dir = store.pdir(pid, "exports")
    os.makedirs(out_dir, exist_ok=True)
    name = f"{media.safe_name(clip['title'])}_{cid}_{time.strftime('%H%M%S')}.mp4"
    tmp = os.path.join(out_dir, f".{name}")
    job.update(status="rendering")
    try:
        from . import render
        render.render(pid, clip, tmp, lambda f: job.update(progress=round(f, 3)))
        shutil.move(tmp, os.path.join(out_dir, name))
        job.update(status="done", progress=1, file=name)

        def mark(c):
            c.setdefault("exports", []).append({"file": name, "at": time.time()})
        store.update_clip(pid, cid, mark)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        job.update(status="error", error=str(e)[:600])
        if os.path.exists(tmp):
            os.remove(tmp)
    _fire(export_hooks, job)


def _worker(q, fn):
    while True:
        item = q.get()
        try:
            fn(item)
        finally:
            q.task_done()


def submit(pid):
    _process_q.put(pid)


def start():
    threading.Thread(target=_worker, args=(_process_q, process), daemon=True).start()
    threading.Thread(target=_worker, args=(_export_q, _export), daemon=True).start()
    # projects interrupted by a restart get re-queued
    for p in store.list_projects():
        if p.get("status") == "processing":
            submit(p["id"])
