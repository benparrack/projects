"""Reads/writes the per-run-date manifest.json that records what clips were
rendered, their metadata, and (once posted) each platform's result — the
single source of truth `poster.py` and `main.py status` both read from.
"""

import json
import os


def manifest_path(date_dir: str) -> str:
    return os.path.join(date_dir, "manifest.json")


def read_manifest(date_dir: str) -> list:
    path = manifest_path(date_dir)
    if not os.path.exists(path):
        return []
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return []


def write_manifest(date_dir: str, entries: list) -> None:
    os.makedirs(date_dir, exist_ok=True)
    with open(manifest_path(date_dir), "w") as f:
        json.dump(entries, f, indent=2)


def append_entry(date_dir: str, entry: dict) -> None:
    entries = read_manifest(date_dir)
    entries.append(entry)
    write_manifest(date_dir, entries)


def all_date_dirs(staging_root: str) -> list:
    if not os.path.isdir(staging_root):
        return []
    return sorted(
        os.path.join(staging_root, name)
        for name in os.listdir(staging_root)
        if os.path.isdir(os.path.join(staging_root, name))
    )
