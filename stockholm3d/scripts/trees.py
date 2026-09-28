#!/usr/bin/env python3
"""Stage 6: tree instances -> web/data/trees.bin.gz

OSM tree nodes (street trees, mapped park trees) plus a random scatter in woods
and parks, kept off buildings, roads and water.

Format: magic 'STR1', u32 count, then per tree f32 x, f32 y, f32 z,
u8 kind (0 broadleaf, 1 conifer), u8 height (metres * 8), u16 seed.
"""
import gzip, pickle, struct, sys
from pathlib import Path

import numpy as np
import shapely
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).parent))
from terrain import Terrain  # noqa: E402
from landcover import ROAD_W, water_geometry, local_bbox  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "data" / "work"
OUT = ROOT / "web" / "data"
CAP = 90000
rng = np.random.default_rng(7)


def density(t):
    """trees per m², conifer share"""
    if t.get("natural") == "wood" or t.get("landuse") == "forest":
        lt = t.get("leaf_type", "")
        return 1 / 55, 0.7 if lt == "needleleaved" else (0.1 if lt == "broadleaved" else 0.45)
    if t.get("natural") == "scrub":
        return 1 / 160, 0.3
    if t.get("leisure") in ("park", "garden") or t.get("landuse") == "cemetery" or t.get("amenity") == "grave_yard":
        return 1 / 320, 0.12
    if t.get("landuse") in ("grass", "recreation_ground") or t.get("leisure") == "nature_reserve":
        return 1 / 900, 0.2
    return 0, 0


def main():
    feats = pickle.load(open(WORK / "features.pkl", "rb"))
    terr = Terrain()
    frame = local_bbox(pad=0)
    blocked = [b["geom"].buffer(3) for b in feats["buildings"]]
    for l in feats["lines"]:
        t = l["tags"]
        if t.get("highway") in ROAD_W and t.get("tunnel") in (None, "no"):
            blocked.append(l["geom"].buffer(ROAD_W[t["highway"]] / 2 + 1.5))
        elif t.get("railway") and t.get("tunnel") in (None, "no"):
            blocked.append(l["geom"].buffer(4))
    for a in feats["areas"]:
        t = a["tags"]
        if t.get("leisure") in ("pitch", "track", "stadium", "playground") or t.get("amenity") == "parking" \
                or t.get("man_made") in ("pier", "quay") or t.get("place") == "square":
            blocked.append(a["geom"])
    blocked.append(water_geometry().buffer(2))
    blocked = unary_union(blocked)
    shapely.prepare(blocked)

    xs, zs, kinds = [], [], []
    for x, z, t in feats["trees"]:
        xs.append(x); zs.append(z)
        kinds.append(1 if t.get("leaf_type") == "needleleaved" else 0)
    n_osm = len(xs)
    for a in feats["areas"]:
        d, conif = density(a["tags"])
        if d == 0:
            continue
        g = a["geom"].intersection(frame)
        if g.is_empty:
            continue
        n = rng.poisson(g.area * d)
        if n == 0:
            continue
        minx, minz, maxx, maxz = g.bounds
        cx = rng.uniform(minx, maxx, n * 3)
        cz = rng.uniform(minz, maxz, n * 3)
        ok = shapely.contains_xy(g, cx, cz)
        cx, cz = cx[ok][:n], cz[ok][:n]
        xs += list(cx); zs += list(cz)
        kinds += list((rng.random(len(cx)) < conif).astype(int))
    xs, zs, kinds = np.array(xs), np.array(zs), np.array(kinds, np.uint8)
    keep = ~shapely.contains_xy(blocked, xs, zs)
    keep[:n_osm] = True  # mapped trees are where they are
    xs, zs, kinds = xs[keep], zs[keep], kinds[keep]
    if len(xs) > CAP:
        sel = np.concatenate([np.arange(min(n_osm, CAP)), rng.choice(np.arange(n_osm, len(xs)), CAP - n_osm, replace=False)])
        xs, zs, kinds = xs[sel], zs[sel], kinds[sel]
    ys = terr.at(xs, zs)
    ok = ys > 0.5
    xs, ys, zs, kinds = xs[ok], ys[ok], zs[ok], kinds[ok]
    N = len(xs)
    h = np.clip(rng.normal(np.where(kinds == 1, 17, 13), 3.5), 6, 26)
    rec = np.zeros(N, dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("k", "u1"), ("h", "u1"), ("s", "<u2")])
    rec["x"], rec["y"], rec["z"], rec["k"] = xs, ys, zs, kinds
    rec["h"] = np.round(h * 8).astype(np.uint8)
    rec["s"] = rng.integers(0, 65535, N)
    with gzip.open(OUT / "trees.bin.gz", "wb", compresslevel=9) as f:
        f.write(b"STR1" + struct.pack("<I", N) + rec.tobytes())
    print(f"{N} trees ({n_osm} mapped, {int((kinds == 1).sum())} conifers), "
          f"{(OUT / 'trees.bin.gz').stat().st_size/1e6:.1f} MB gz")


if __name__ == "__main__":
    main()
