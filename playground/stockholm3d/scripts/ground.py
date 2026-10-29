#!/usr/bin/env python3
"""Stage 4: ground textures (one WebP per 500 m tile) + the terrain heightmap for the web.

RGB = ground colour (land cover, water, roads, rails).
A   = night-light mask (lit streets and squares glow warm after dark).
"""
import gzip, io, json, pickle, struct, sys
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import shapely
from PIL import Image, ImageDraw, ImageFilter, ImageChops
from shapely.ops import substring
from shapely.strtree import STRtree
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).parent))
from config import TILE_SIZE  # noqa: E402
from landcover import (CLASSES, BASE_RGB, WATER_RGB, ROAD_W, ROAD_RGB, FOOT_RGB, PATH_RGB, RAIL_RGB,  # noqa: E402
                       classify, water_geometry, is_water_area)
from terrain import Terrain  # noqa: E402
from buildings import earcut_poly  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "data" / "work"
OUT = ROOT / "web" / "data"
PX = 1024     # standard texture size per tile (g_i_j.webp)
HX = 2048     # hi-res variant for walking/low flying (h_i_j.webp)
SS = 2        # supersampling for anti-aliased edges (relative to HX)
CURB_RGB = (128, 126, 122)
MARK_RGB = (222, 222, 216)

G = {}


def init():
    feats = pickle.load(open(WORK / "features.pkl", "rb"))
    areas = []
    for a in feats["areas"]:
        if is_water_area(a["tags"]):
            continue
        c = classify(a["tags"])
        if c is not None:
            areas.append((c, a["geom"]))
    # large areas first so small ones (pitches in parks) land on top; then by class order
    areas.sort(key=lambda x: (-x[1].area if x[0] not in (len(CLASSES) - 1,) else 0))
    G["areas"] = areas
    G["atree"] = STRtree([g for _, g in areas])
    water = water_geometry()
    G["water"] = water
    lines = []
    for l in feats["lines"]:
        t = l["tags"]
        if t.get("tunnel") in ("yes", "building_passage", "culvert") or t.get("bridge") not in (None, "no"):
            continue
        try:
            if float(t.get("layer", 0)) < 0:
                continue
        except ValueError:
            pass
        hw = t.get("highway")
        rw = t.get("railway")
        if hw in ROAD_W:
            w = ROAD_W[hw]
            try:
                w = float(str(t.get("width", w)).split()[0])
            except ValueError:
                pass
            if hw in ("footway", "cycleway", "pedestrian", "steps") or t.get("footway"):
                col, lit = FOOT_RGB, 0.55
            elif hw in ("path", "track", "bridleway"):
                col, lit = PATH_RGB, 0.0
            else:
                col, lit = ROAD_RGB, 1.0
            order = 0 if col is PATH_RGB else (1 if col is FOOT_RGB else 2 + w)
            kind = None
            if (t.get("footway") == "crossing" or t.get("highway") == "crossing") and \
                    t.get("crossing") not in ("unmarked", "no", "informal") and t.get("crossing_ref") != "none":
                kind = "zebra"
            elif col is ROAD_RGB and hw in ("motorway", "trunk", "primary", "secondary", "tertiary"):
                try:
                    lanes = int(str(t.get("lanes", "2")).split(";")[0])
                except ValueError:
                    lanes = 2
                kind = ("lanes", lanes, t.get("oneway") in ("yes", "1", "-1") or hw == "motorway")
            lines.append((order, l["geom"], w, col, lit, kind))
        elif rw:
            w = 3.2 if rw in ("rail", "narrow_gauge") else 2.6
            lines.append((1.5, l["geom"], w + 1.4, RAIL_RGB, 0.0, "rail"))
    lines.sort(key=lambda x: x[0])
    G["lines"] = lines
    blds = [b["geom"] for b in feats["buildings"]
            if b["tags"].get("building") not in ("roof", "carport") and b["tags"].get("building:part") != "roof"
            and str(b["tags"].get("layer", "0")).lstrip("-") == str(b["tags"].get("layer", "0"))
            and b["tags"].get("location") != "underground"]
    G["blds"] = blds
    G["btree"] = STRtree(blds)
    G["ltree"] = STRtree([x[1] for x in lines])
    G["terr"] = Terrain()


def draw_tile(key):
    i, j = key
    terr = G["terr"]
    x0 = terr.x0 + i * TILE_SIZE
    z0 = terr.z0 + j * TILE_SIZE
    frame = box(x0 - 20, z0 - 20, x0 + TILE_SIZE + 20, z0 + TILE_SIZE + 20)
    N = HX * SS
    s = N / TILE_SIZE
    img = Image.new("RGB", (N, N), BASE_RGB)
    lit = Image.new("L", (N, N), 0)
    d = ImageDraw.Draw(img)
    dl = ImageDraw.Draw(lit)

    def px(coords):
        return [((x - x0) * s, (z - z0) * s) for x, z in coords]

    def fill(g, col, lv=None):
        # Triangulate first: Pillow's polygon scanline fill leaks horizontal
        # streaks on some large polygons with near-horizontal edges.
        g = g.intersection(frame)
        for p in getattr(g, "geoms", [g]):
            if p.geom_type != "Polygon" or p.is_empty:
                continue
            v, tri = earcut_poly(p)
            if len(tri) == 0:
                continue
            P = (v - (x0, z0)) * s
            for a, b, c in tri:
                t = [tuple(P[a]), tuple(P[b]), tuple(P[c])]
                d.polygon(t, fill=col)
                if lv is not None:
                    dl.polygon(t, fill=lv)

    for idx in sorted(G["atree"].query(frame)):
        c, g = G["areas"][idx]
        name, rgb, _ = CLASSES[c]
        fill(g, rgb, 150 if name in ("square", "parking") else (0 if name in ("grass", "forest", "cemetery", "farm") else None))
    # water over land cover, piers back over water
    fill(G["water"], WATER_RGB, 0)
    for idx in sorted(G["atree"].query(frame)):
        c, g = G["areas"][idx]
        if CLASSES[c][0] == "pier":
            fill(g, CLASSES[c][1])
    def parts(g):
        g = g.intersection(frame.buffer(30))
        return [p for p in getattr(g, "geoms", [g]) if p.geom_type == "LineString" and not p.is_empty]

    def dashes(line, on, off, trim=0.0):
        L = line.length
        a = trim
        while a + on <= L - trim:
            yield substring(line, a, a + on)
            a += on + off

    sel = [G["lines"][k] for k in sorted(G["ltree"].query(frame))]
    roads = [x for x in sel if x[3] is ROAD_RGB]
    # paths, footways, rails first; then curbs under all roads, then roads, then markings
    for _, g, w, col, lv, kind in [x for x in sel if x[3] is not ROAD_RGB]:
        for part in parts(g):
            pts = px(part.coords)
            d.line(pts, fill=col, width=max(1, int(round(w * s))), joint="curve")
            if lv:
                dl.line(pts, fill=int(255 * lv), width=int((w + 6) * s), joint="curve")
            if kind == "rail":
                for off in (-0.72, 0.72):
                    op = part.offset_curve(off)
                    if not op.is_empty and op.geom_type == "LineString":
                        d.line(px(op.coords), fill=(70, 66, 64), width=max(1, int(0.25 * s)))
    for _, g, w, col, lv, kind in roads:
        for part in parts(g):
            d.line(px(part.coords), fill=CURB_RGB, width=int(round((w + 0.7) * s)), joint="curve")
    for _, g, w, col, lv, kind in roads:
        for part in parts(g):
            pts = px(part.coords)
            d.line(pts, fill=col, width=max(1, int(round(w * s))), joint="curve")
            if lv:
                dl.line(pts, fill=int(255 * lv), width=int((w + 6) * s), joint="curve")
    mw = max(1, int(round(0.2 * s)))
    for _, g, w, col, lv, kind in roads:
        if not kind:
            continue
        _, lanes, oneway = kind
        lanes = max(1, min(lanes, 6))
        for part in parts(g):
            if part.length < 30:
                continue
            offs = [(-w / 2 + w * k / lanes) for k in range(1, lanes)]
            for o in offs:
                ln = part if abs(o) < 0.01 else part.offset_curve(o)
                if ln.is_empty or ln.geom_type != "LineString":
                    continue
                centre = abs(o) < 0.01 and not oneway
                for dsh in (dashes(ln, 3.0, 9.0, 12.0) if not centre else dashes(ln, 9.0, 3.0, 12.0)):
                    if dsh.geom_type == "LineString" and len(dsh.coords) > 1:
                        d.line(px(dsh.coords), fill=MARK_RGB, width=mw)
    road_area = shapely.union_all([g.buffer(w / 2, cap_style="flat") for _, g, w, *_ in roads]) if roads else None
    for _, g, w, col, lv, kind in sel:
        if kind != "zebra" or road_area is None:
            continue
        for part in parts(g):
            if part.length > 40:
                continue
            for dsh in dashes(part, 0.5, 0.5, 0.25):
                if dsh.geom_type != "LineString" or len(dsh.coords) < 2:
                    continue
                stripe = dsh.buffer(1.5, cap_style="flat").intersection(road_area)
                for p in getattr(stripe, "geoms", [stripe]):
                    if p.geom_type == "Polygon" and p.area > 0.2:
                        d.polygon(px(p.exterior.coords), fill=MARK_RGB)
    # contact shadow: soft darkening of the ground around building footprints
    ao = Image.new("L", (N, N), 0)
    da = ImageDraw.Draw(ao)
    for k in sorted(G["btree"].query(frame)):
        g = G["blds"][k].intersection(frame)
        for p in getattr(g, "geoms", [g]):
            if p.geom_type != "Polygon" or p.is_empty:
                continue
            da.polygon(px(p.exterior.coords), fill=255)
    ao = ao.filter(ImageFilter.GaussianBlur(1.6 * s))
    shade = ao.point(lambda v: 255 - int(v * 0.42))
    img = ImageChops.multiply(img, Image.merge("RGB", (shade, shade, shade)))
    img = img.resize((HX, HX), Image.LANCZOS)
    lit = lit.resize((HX, HX), Image.LANCZOS)
    for size, prefix, q in ((HX, "h", 78), (PX, "g", 82)):
        rgba = img if size == HX else img.resize((size, size), Image.LANCZOS)
        rgba = rgba.copy()
        rgba.putalpha(lit if size == HX else lit.resize((size, size), Image.LANCZOS))
        buf = io.BytesIO()
        rgba.save(buf, "WEBP", quality=q, method=5, exact=True)  # keep RGB under alpha=0
        (OUT / "ground" / f"{prefix}_{i}_{j}.webp").write_bytes(buf.getvalue())
    return key


def export_heightmap():
    terr = Terrain()
    h = np.round(terr.h * 10).astype(np.int16)  # decimetres
    rows, cols = h.shape
    blob = b"SHM1" + struct.pack("<IIfff", cols, rows, terr.x0, terr.z0, terr.step) + h.tobytes()
    with gzip.open(OUT / "terrain.bin.gz", "wb", compresslevel=9) as f:
        f.write(blob)
    return cols, rows


def main():
    (OUT / "ground").mkdir(parents=True, exist_ok=True)
    cols, rows = export_heightmap()
    terr = Terrain()
    nx = int(np.ceil((cols - 1) * terr.step / TILE_SIZE))
    nz = int(np.ceil((rows - 1) * terr.step / TILE_SIZE))
    keys = [(i, j) for i in range(nx) for j in range(nz)]
    with Pool(initializer=init) as pool:
        for n, _ in enumerate(pool.imap_unordered(draw_tile, keys)):
            pass
    size = sum(f.stat().st_size for f in (OUT / "ground").glob("g_*.webp"))
    json.dump({"nx": nx, "nz": nz}, open(WORK / "ground_tiles.json", "w"))
    print(f"{len(keys)} ground tiles ({nx}x{nz}), {size/1e6:.1f} MB; heightmap {cols}x{rows}")


if __name__ == "__main__":
    main()
