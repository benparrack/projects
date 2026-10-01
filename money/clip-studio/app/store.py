"""On-disk project storage. Every project is a folder under data/projects/<id>/
holding the source video, its transcript, the found clips (with each clip's
edit state) and rendered exports. JSON files are written atomically so a
crash mid-write never leaves a half-written project behind."""

import json
import os
import secrets
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
PROJECTS = os.path.join(DATA, "projects")
MUSIC = os.path.join(DATA, "music")
FONTS = os.path.join(ROOT, "fonts")
MODELS = os.path.join(ROOT, "models")

os.makedirs(PROJECTS, exist_ok=True)
os.makedirs(MUSIC, exist_ok=True)

_lock = threading.RLock()


def new_id(n=6):
    return secrets.token_hex(n)


def pdir(pid, *parts):
    return os.path.join(PROJECTS, pid, *parts)


def read_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path, obj):
    tmp = f"{path}.tmp{threading.get_ident()}"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, path)


def get_project(pid):
    return read_json(pdir(pid, "project.json"))


def update_project(pid, **fields):
    with _lock:
        p = get_project(pid) or {}
        p.update(fields)
        p["updated"] = time.time()
        write_json(pdir(pid, "project.json"), p)
        return p


def list_projects():
    out = []
    for pid in os.listdir(PROJECTS):
        p = get_project(pid)
        if p:
            out.append(p)
    return sorted(out, key=lambda p: p.get("created", 0), reverse=True)


def get_clips(pid):
    return read_json(pdir(pid, "clips.json"), [])


def save_clips(pid, clips):
    with _lock:
        write_json(pdir(pid, "clips.json"), clips)


def get_clip(pid, cid):
    for c in get_clips(pid):
        if c["id"] == cid:
            return c
    return None


def update_clip(pid, cid, mutate):
    """Applies mutate(clip) under the lock and saves. Returns the clip."""
    with _lock:
        clips = get_clips(pid)
        for c in clips:
            if c["id"] == cid:
                mutate(c)
                save_clips(pid, clips)
                return c
    return None


def get_transcript(pid):
    return read_json(pdir(pid, "transcript.json"))
