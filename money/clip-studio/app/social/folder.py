""""Folder" target: copies the MP4 plus a caption .txt into a folder, e.g. one
synced to your phone (Syncthing, Google Drive, Dropbox) for posting by hand on
platforms without an API connection."""

import os
import shutil

from .. import media

KEY = "folder"
NAME = "Folder / phone sync"
KIND = "token"
PRIVACY = []
CONNECT_FIELDS = [{"name": "path", "label": "Folder path (created if missing)"},
                  {"name": "name", "label": "Label (optional)"}]
HELP = "Drops each published clip and its caption into a folder — point it at a synced folder to post from your phone."


def connect(fields):
    path = os.path.abspath(os.path.expanduser((fields.get("path") or "").strip()))
    if not fields.get("path"):
        raise ValueError("Enter a folder path")
    os.makedirs(path, exist_ok=True)
    return {"name": (fields.get("name") or "").strip() or path, "uid": path, "creds": {"path": path}}


def check(a):
    if not os.path.isdir(a["creds"]["path"]):
        raise RuntimeError("Folder no longer exists")
    return {}


def publish(a, path, post):
    d = a["creds"]["path"]
    os.makedirs(d, exist_ok=True)
    base = media.safe_name(post.get("title") or "clip") or "clip"
    dst = os.path.join(d, f"{base}.mp4")
    k = 2
    while os.path.exists(dst):
        dst = os.path.join(d, f"{base}_{k}.mp4")
        k += 1
    shutil.copy(path, dst)
    tags = " ".join("#" + t.lstrip("#") for t in post.get("hashtags", []))
    with open(dst[:-4] + ".txt", "w") as f:
        f.write("\n\n".join(x for x in [post.get("title", ""), post.get("text", ""), tags] if x.strip()) + "\n")
    return {"id": os.path.basename(dst), "url": None, "note": f"Saved to {dst}"}
