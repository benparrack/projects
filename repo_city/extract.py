#!/usr/bin/env python3
"""Dump this repo's git history as compact JSON for the Repo City viewer.

Usage: python3 repo_city/extract.py      # writes repo_city/index.html (+ artifact.html)
"""
import json, math, os, subprocess, sys
from collections import OrderedDict

ROOT = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
SEP = "\x1e"

def district_of(path):
    parts = path.split("/")
    if len(parts) == 1:
        return "(town hall)"
    if parts[0] == "money" and len(parts) > 2 and parts[1] == "roblox" and len(parts) > 4 and parts[2] == "games":
        return "/".join(parts[:4])
    if parts[0] in ("money", "3dgames") and len(parts) > 2:
        return "/".join(parts[:2])
    return parts[0]

raw = subprocess.check_output(
    ["git", "-C", ROOT, "log", "--reverse", "--no-renames", "--numstat",
     "--format=" + SEP + "%h%x00%at%x00%ai%x00%s"], text=True, errors="replace")

files = OrderedDict()      # path -> index
commits = []
for chunk in raw.split(SEP)[1:]:
    lines = chunk.strip("\n").split("\n")
    h, t, ai, msg = lines[0].split("\x00", 3)
    tz = ai.strip()[-5:]
    off = (1 if tz[0] == "+" else -1) * (int(tz[1:3]) * 3600 + int(tz[3:5]) * 60)
    ch = []
    for ln in lines[1:]:
        if not ln.strip():
            continue
        a, d, p = ln.split("\t", 2)
        if a == "-":           # binary: count as a small fixed size
            a, d = "40", "0"
        if p not in files:
            files[p] = len(files)
        ch.append([files[p], int(a), int(d)])
    commits.append({"h": h, "t": int(t) + off, "m": msg, "c": ch})  # t = local wall-clock seconds

# ---- layout: each district is a block of lots, blocks packed on a spiral ----
paths = list(files)
districts = OrderedDict()
for i, p in enumerate(paths):
    districts.setdefault(district_of(p), []).append(i)

first_seen = {}
for ci, c in enumerate(commits):
    for fi, _, _ in c["c"]:
        first_seen.setdefault(fi, ci)

LOT = 1.0          # lot pitch within a block
PAD = 2            # street width between blocks (grid cells)
occupied = set()

def fits(x0, z0, w, h):
    return all((x, z) not in occupied
               for x in range(x0 - PAD, x0 + w + PAD) for z in range(z0 - PAD, z0 + h + PAD))

def spiral():
    yield 0, 0
    r = 1
    while True:
        pts = [(x, z) for x in range(-r, r + 1) for z in range(-r, r + 1) if max(abs(x), abs(z)) == r]
        pts.sort(key=lambda p: (p[0] ** 2 + p[1] ** 2, math.atan2(p[1], p[0])))
        yield from pts
        r += 1

order = sorted(districts, key=lambda d: min(first_seen.get(i, 1e9) for i in districts[d]))
out_d, file_pos = [], {}
for name in order:
    idx = sorted(districts[name], key=lambda i: first_seen.get(i, 1e9))
    cols = max(2, math.ceil(math.sqrt(len(idx))))
    rows = math.ceil(len(idx) / cols)
    for cx, cz in spiral():
        x0, z0 = cx - cols // 2, cz - rows // 2
        if fits(x0, z0, cols, rows):
            break
    for x in range(x0, x0 + cols):
        for z in range(z0, z0 + rows):
            occupied.add((x, z))
    for k, fi in enumerate(idx):
        file_pos[fi] = (x0 + k % cols + 0.5, z0 + k // cols + 0.5)
    out_d.append({"n": name, "x": x0, "z": z0, "w": cols, "h": rows,
                  "born": min(first_seen.get(i, 0) for i in idx)})

dnames = [d["n"] for d in out_d]
out_f = []
for i, p in enumerate(paths):
    x, z = file_pos[i]
    ext = os.path.splitext(p)[1].lstrip(".").lower() or "none"
    out_f.append([p, dnames.index(district_of(p)), round(x * LOT, 2), round(z * LOT, 2), ext])

data = json.dumps({"repo": os.path.basename(ROOT), "files": out_f, "districts": out_d, "commits": commits},
                  separators=(",", ":"))
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "template.html")) as f:
    page = f.read().replace("/*__DATA__*/null", data.replace("</", "<\\/"))
# index.html is standalone; artifact.html is the bare body the claude.ai artifact skeleton wraps
with open(os.path.join(here, "index.html"), "w") as f:
    f.write('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            '</head>\n<body>\n' + page + '\n</body>\n</html>\n')
with open(os.path.join(here, "artifact.html"), "w") as f:
    f.write(page)
print(f"{len(commits)} commits, {len(paths)} files, {len(out_d)} districts -> index.html", file=sys.stderr)
