#!/usr/bin/env python3
"""Stage 7: web/data/manifest.json — tile lists, frame, landmarks, labels, search index."""
import json, pickle, sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from config import BBOX, ORIGIN_LAT, ORIGIN_LON, M_PER_DEG_LAT, M_PER_DEG_LON, TILE_SIZE, to_local  # noqa: E402
from terrain import Terrain  # noqa: E402
from buildings import parse_len, LEVEL_H  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "data" / "work"
OUT = ROOT / "web" / "data"

# (label, building id or (lat, lon), azimuth the camera looks *from*, degrees clockwise from north)
LANDMARKS = [
    ("Stockholms stadshus", "r29368", 150),
    ("Kungliga slottet", "r34394", 20),
    ("Storkyrkan", "w8049504", 200),
    ("Riddarholmskyrkan", "w23841420", 250),
    ("Tyska kyrkan", "w8049509", 140),
    ("Riksdagshuset", "r34395", 320),
    ("Katarina kyrka", "w37079169", 170),
    ("Sofia kyrka", "w1350868500", 200),
    ("Klara kyrka", "w163637452", 240),
    ("Hötorgsskraporna", (59.3346, 18.0633), 200),
    ("Kungstornen", "w121266...", 180),
    ("Nationalmuseum", "w24968329", 250),
    ("Hedvig Eleonora kyrka", "w27741605", 200),
    ("Engelbrektskyrkan", "w21572801", 180),
    ("Vasamuseet", "w27288534", 250),
    ("Nordiska museet", "w348345482", 280),
    ("Gröna Lund", (59.3233, 18.0960), 300),
    ("Kaknästornet", "Kaknästornet", 230),
    ("Avicii Arena", "w25431325", 330),
    ("Västerbron", (59.3226, 18.0240), 90),
]


def height_of(b):
    t = b["tags"]
    h = parse_len(t.get("height"))
    if h is None and t.get("building:levels"):
        try:
            h = float(t["building:levels"]) * LEVEL_H + 2
        except ValueError:
            pass
    return h or 12.0


def main():
    feats = pickle.load(open(WORK / "features.pkl", "rb"))
    terr = Terrain()
    byid = {b["id"]: b for b in feats["buildings"]}
    byname = {}
    for b in feats["buildings"]:
        n = b["tags"].get("name")
        if n:
            byname.setdefault(n, b)
    kung = [b for b in feats["buildings"] if b["tags"].get("name", "").endswith("kungstornet")]

    def top_of(geom, own):
        hs = [own] + [height_of(p) for p in feats["buildings"] if p["part"] and p["geom"].intersects(geom)
                      and p["geom"].intersection(geom).area > 0.3 * p["geom"].area]
        return max(hs)

    landmarks = []
    for label, ref, az in LANDMARKS:
        if isinstance(ref, tuple):
            x, z = to_local(*ref)
            h = 30.0
            bid = None
        else:
            b = byid.get(ref) or byname.get(ref)
            if ref.startswith("w121266") and kung:
                b = kung[0]
            if b is None:
                print("missing landmark", label)
                continue
            c = b["geom"].centroid
            x, z = c.x, c.y
            h = top_of(b["geom"], height_of(b))
            bid = b["id"]
        g = float(terr.at(x, z)[0])
        landmarks.append({"name": label, "x": round(x, 1), "z": round(z, 1), "ground": round(g, 1),
                          "height": round(h, 1), "az": az, "id": bid})

    # labels: districts / islands from place nodes
    labels = []
    for p in feats["pois"]:
        t = p["tags"]
        if t.get("place") in ("suburb", "quarter", "neighbourhood", "island", "islet") and t.get("name"):
            labels.append({"name": t["name"], "x": round(p["x"]), "z": round(p["z"]),
                           "rank": 0 if t["place"] == "suburb" else 1})

    # search index: named buildings + POIs + places
    search, seen = [], set()
    for b in feats["buildings"]:
        n = b["tags"].get("name")
        if not n or b["part"]:
            continue
        c = b["geom"].centroid
        key = (n, round(c.x / 50), round(c.y / 50))
        if key in seen:
            continue
        seen.add(key)
        search.append({"n": n, "x": round(c.x), "z": round(c.y), "h": round(height_of(b)), "k": b["tags"].get("building", "")})
    for p in feats["pois"]:
        t = p["tags"]
        n = t.get("name")
        if not n:
            continue
        key = (n, round(p["x"] / 50), round(p["z"] / 50))
        if key in seen:
            continue
        seen.add(key)
        kind = next((t[k] for k in ("place", "tourism", "historic", "amenity", "leisure") if k in t), "")
        search.append({"n": n, "x": round(p["x"]), "z": round(p["z"]), "h": 0, "k": kind})

    bt = json.load(open(WORK / "building_tiles.json"))
    st = json.load(open(WORK / "structure_tiles.json"))
    gt = json.load(open(WORK / "ground_tiles.json"))
    man = {
        "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON, "mPerDegLat": M_PER_DEG_LAT, "mPerDegLon": M_PER_DEG_LON},
        "bbox": BBOX,
        "tileSize": TILE_SIZE,
        "grid": {"x0": terr.x0, "z0": terr.z0, "nx": gt["nx"], "nz": gt["nz"]},
        "buildingTiles": sorted(bt),
        "structureTiles": sorted(st),
        "landmarks": landmarks,
        "labels": labels,
        "search": search,
    }
    (OUT / "manifest.json").write_text(json.dumps(man, ensure_ascii=False, separators=(",", ":")))
    print(f"manifest: {len(landmarks)} landmarks, {len(labels)} labels, {len(search)} search entries, "
          f"{(OUT / 'manifest.json').stat().st_size/1e3:.0f} kB")
    for l in landmarks:
        print(f"  {l['name']:24s} h={l['height']:6.1f} at ({l['x']:.0f},{l['z']:.0f})")


if __name__ == "__main__":
    main()
