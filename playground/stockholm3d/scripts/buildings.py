#!/usr/bin/env python3
"""Stage 3: building meshes per tile.

Implements the useful subset of OSM Simple 3D Buildings:
  - height / building:levels / roof:levels / min_height / building:min_level
  - building:part (outline is hidden when parts cover it)
  - roof:shape flat, gabled, hipped (+ half-hipped, gambrel, mansard, saltbox...),
    skillion, pyramidal, cone, dome, onion, round
  - building:colour / roof:colour / *:material

Output per tile (web/data/tiles/b_<i>_<j>.bin.gz + i_j.json):
  header: magic 'SB3D', u32 vertCount, u32 triCount
  positions f32[v*3]  (local metres, y up)
  normals   i8[v*4]   (xyz * 127, w = flags)
  colours   u8[v*4]   (rgb, a = per-building random seed)
  triBuilding u16[t]  index into the tile's info list (for picking)
"""
import gzip, json, math, pickle, struct, sys, zlib
from collections import defaultdict
from multiprocessing import Pool
from pathlib import Path

import mapbox_earcut as earcut
import numpy as np
import shapely
from shapely.geometry import Polygon, MultiPolygon, LineString, Point
from shapely.geometry.polygon import orient
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).parent))
from config import TILE_SIZE  # noqa: E402
from terrain import Terrain  # noqa: E402
from colours import parse_colour  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "data" / "work"
OUT = ROOT / "web" / "data" / "tiles"

LEVEL_H = 3.2
F_ROOF, F_WINDOWS, F_GLASS, F_PLAIN = 1, 2, 4, 8

PITCHED = {"gabled", "hipped", "half-hipped", "gambrel", "mansard", "saltbox", "side_hipped",
           "quadruple_saltbox", "round", "side_half-hipped", "crosspitched"}
WINDOWLESS_TYPES = {"shed", "garage", "garages", "roof", "church", "cathedral", "chapel", "tower",
                    "bunker", "silo", "storage_tank", "container", "carport", "bridge", "ruins",
                    "greenhouse", "transformer_tower", "hut", "kiosk", "toilets", "boathouse"}

# Stockholm façade palette (inner-city stucco: ochre, saffron, salmon, rust, cream)
STHLM_WALLS = [(214, 164, 84), (226, 190, 118), (216, 140, 86), (212, 138, 116), (170, 86, 58),
               (232, 216, 184), (204, 196, 180), (190, 118, 76), (222, 176, 132), (178, 150, 116),
               (236, 226, 204), (160, 120, 92)]
ROOF_DEFAULTS = [(74, 76, 80), (74, 76, 80), (60, 62, 66), (122, 60, 44), (110, 52, 40), (88, 84, 82)]
MATERIAL_WALL = {"brick": (156, 76, 54), "glass": (110, 140, 156), "concrete": (178, 176, 170),
                 "stone": (176, 168, 150), "wood": (150, 70, 52), "metal": (150, 154, 158),
                 "plaster": (222, 206, 170), "granite": (160, 156, 150), "sandstone": (206, 186, 146),
                 "timber_framing": (220, 210, 190), "steel": (150, 154, 160)}
MATERIAL_ROOF = {"copper": (104, 150, 128), "metal": (74, 76, 80), "tile": (150, 72, 50),
                 "roof_tiles": (150, 72, 50), "slate": (70, 72, 78), "glass": (140, 170, 186),
                 "concrete": (150, 150, 146), "tar_paper": (60, 60, 62), "asphalt": (60, 60, 62),
                 "stone": (130, 126, 118), "grass": (96, 128, 70), "eternit": (110, 110, 108),
                 "thatch": (150, 130, 80), "gravel": (140, 136, 128), "zinc": (140, 144, 146),
                 "wood": (110, 80, 56), "plants": (96, 128, 70)}


def parse_len(v):
    if v is None:
        return None
    s = str(v).strip().lower().replace(",", ".")
    try:
        if s.endswith("'") or s.endswith("ft"):
            return float(s.rstrip("'ft ").strip()) * 0.3048
        return float(s.split()[0].rstrip("m"))
    except (ValueError, IndexError):
        return None


def hash01(s, salt=0):
    return (zlib.crc32(f"{s}:{salt}".encode()) & 0xFFFFFF) / 0xFFFFFF


# --------------------------------------------------------------------- geometry
def earcut_poly(poly):
    """Triangulate a polygon (with holes) -> (verts (n,2), tris (m,3))."""
    rings = [np.asarray(poly.exterior.coords)[:-1]] + [np.asarray(r.coords)[:-1] for r in poly.interiors]
    rings = [r for r in rings if len(r) >= 3]
    if not rings:
        return np.zeros((0, 2)), np.zeros((0, 3), dtype=np.int64)
    verts = np.vstack(rings)
    ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
    idx = earcut.triangulate_float64(verts, ends)
    return verts, np.asarray(idx, dtype=np.int64).reshape(-1, 3)


def polys_of(g):
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    return [p for p in getattr(g, "geoms", []) if isinstance(p, Polygon) and p.area > 0.01]


class Mesh:
    def __init__(self):
        self.tris = []    # (n,3,3) arrays
        self.flags = []   # per-array flag
        self.cols = []    # per-array rgb

    def add(self, tris, rgb, flags, up=None, outward=None):
        """tris: (n,3,3) xyz. Orientation fixed so normals face `up` (+y) or `outward`."""
        tris = np.asarray(tris, dtype=np.float64).reshape(-1, 3, 3)
        if len(tris) == 0:
            return
        n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
        ln = np.linalg.norm(n, axis=1)
        keep = ln > 1e-9
        tris, n, ln = tris[keep], n[keep], ln[keep]
        if len(tris) == 0:
            return
        if up:
            flip = n[:, 1] < 0
        elif outward is not None:
            flip = (n[:, 0] * outward[0] + n[:, 2] * outward[1]) < 0
        else:
            flip = np.zeros(len(tris), bool)
        tris[flip] = tris[flip][:, ::-1]
        self.tris.append(tris)
        self.cols.append((rgb, flags))
        self.flags.append(flags)


def rect_frame(poly, across=False):
    """Oriented bounding rectangle -> centre c, ridge axis a, cross axis b, half-length hl, half-width hw."""
    r = shapely.minimum_rotated_rectangle(poly)
    if r.geom_type != "Polygon":
        return None
    c = np.asarray(r.exterior.coords)[:4]
    e1, e2 = c[1] - c[0], c[2] - c[1]
    l1, l2 = np.linalg.norm(e1), np.linalg.norm(e2)
    if l1 < 1e-6 or l2 < 1e-6:
        return None
    if (l1 >= l2) != across:
        a, hl, hw = e1 / l1, l1 / 2, l2 / 2
    else:
        a, hl, hw = e2 / l2, l2 / 2, l1 / 2
    b = np.array([-a[1], a[0]])
    ctr = c.mean(axis=0)
    return ctr, a, b, hl, hw


def insert_crossings(ring, creases):
    """Insert points where ring edges cross crease lines (so wall tops follow the roof)."""
    out = []
    pts = np.asarray(ring)
    for p, q in zip(pts[:-1], pts[1:]):
        out.append(p)
        seg = LineString([p, q])
        extra = []
        for cl in creases:
            x = seg.intersection(cl)
            for g in getattr(x, "geoms", [x]):
                if g.geom_type == "Point":
                    t = np.hypot(g.x - p[0], g.y - p[1])
                    if 1e-3 < t < seg.length - 1e-3:
                        extra.append((t, (g.x, g.y)))
        out.extend(np.array(e[1]) for e in sorted(extra))
    out.append(pts[-1])
    return np.array(out)


# --------------------------------------------------------------------- roofs
def roof_planar(poly, shape, rh, top, tags):
    """Gabled / hipped / skillion family on the oriented rectangle.
    Returns (roof tris list [(tris)], height fn, crease lines)."""
    across = tags.get("roof:orientation") == "across"
    fr = rect_frame(poly, across)
    if fr is None:
        return None
    ctr, a, b, hl, hw = fr
    hl *= 1.001
    hw *= 1.001

    def uv(p):
        d = np.asarray(p)[..., :2] - ctr
        return d @ a, d @ b

    if shape == "skillion":
        ang = parse_len(tags.get("roof:direction"))
        dirs = {"n": 0, "ne": 45, "e": 90, "se": 135, "s": 180, "sw": 225, "w": 270, "nw": 315}
        if ang is None:
            ang = dirs.get(str(tags.get("roof:direction", "")).lower())
        if ang is None:
            d = b
        else:  # compass bearing -> local (x east, z south)
            r = math.radians(ang)
            d = np.array([math.sin(r), -math.cos(r)])
        ext = np.asarray(poly.exterior.coords)
        proj = ext @ d
        lo, hi = proj.min(), proj.max()
        span = max(hi - lo, 1e-6)

        def h(p):  # high side opposite the downhill direction
            return rh * (1 - (np.asarray(p)[..., :2] @ d - lo) / span)
        return [poly], h, []

    if shape in ("hipped", "half-hipped", "mansard", "side_hipped", "quadruple_saltbox", "side_half-hipped"):
        e = hw if shape in ("hipped", "mansard", "side_hipped", "quadruple_saltbox") else hw * 0.5
        e = min(e, hl)
    else:
        e = 0.0  # gabled

    def h(p):
        u, v = uv(p)
        side = 1 - np.abs(v) / hw
        if e > 0:
            end = 1 - (np.abs(u) - (hl - e)) / e
            side = np.minimum(side, end)
        return rh * np.clip(side, 0, 1)

    P = lambda uu, vv: tuple(ctr + a * uu + b * vv)  # noqa: E731
    r0, r1 = P(-(hl - e), 0), P(hl - e, 0)
    creases = [LineString([P(-hl * 1.5, 0), P(hl * 1.5, 0)])] if e == 0 else [
        LineString([r0, r1]),
        LineString([P(-hl, hw), r0]), LineString([P(-hl, -hw), r0]),
        LineString([P(hl, hw), r1]), LineString([P(hl, -hw), r1])]
    if e == 0:
        regions = [Polygon([P(-hl, 0), P(hl, 0), P(hl, hw), P(-hl, hw)]),
                   Polygon([P(-hl, 0), P(hl, 0), P(hl, -hw), P(-hl, -hw)])]
    else:
        regions = [Polygon([P(-hl, hw), P(hl, hw), r1, r0]), Polygon([P(-hl, -hw), P(hl, -hw), r1, r0]),
                   Polygon([P(-hl, hw), P(-hl, -hw), r0]), Polygon([P(hl, hw), P(hl, -hw), r1])]
    pieces = []
    for reg in regions:
        if reg.is_valid and reg.area > 1e-6:
            pieces += polys_of(poly.intersection(reg))
    return pieces, h, creases


def build_building(b, ground_y, info_idx, mesh):
    """Add one building/part to `mesh`. ground_y: terrain base height."""
    t = b["tags"]
    geom = b["geom"]
    btype = t.get("building") or t.get("building:part") or "yes"
    oid = b.get("owner", b["id"])

    levels = parse_len(t.get("building:levels"))
    roof_levels = parse_len(t.get("roof:levels")) or 0.0
    height = parse_len(t.get("height"))
    min_h = parse_len(t.get("min_height"))
    if min_h is None and t.get("building:min_level"):
        min_h = (parse_len(t.get("building:min_level")) or 0) * LEVEL_H
    min_h = min_h or 0.0

    shape = (t.get("roof:shape") or "").lower()
    if shape in ("many", "", "flat") and shape != "flat" and roof_levels > 0:
        shape = "inset"
    if shape == "" and btype in ("apartments", "residential", "yes", "house", "detached", "terrace",
                                 "semidetached_house", "dormitory", "hotel", "school", "public") \
            and (levels or 0) <= 9 and b.get("default_pitched", True):
        shape = "inset"
    if shape in ("", "many"):
        shape = "flat"

    polys = polys_of(geom)
    if not polys:
        return 0
    width = min(2 * rect_frame(p)[4] if rect_frame(p) else 10 for p in polys)

    rh = parse_len(t.get("roof:height"))
    if rh is None and roof_levels:
        rh = roof_levels * 2.8
    if rh is None and t.get("roof:angle"):
        ang = parse_len(t.get("roof:angle")) or 30
        rh = math.tan(math.radians(min(ang, 75))) * width / 2
    if rh is None:
        rh = {"flat": 0.0, "skillion": 1.5, "pyramidal": width * 0.6, "cone": width * 0.9,
              "dome": width / 2, "onion": width * 0.9, "inset": 3.0}.get(shape, min(width * 0.35, 7.0))

    if height is None:
        if levels is not None:
            height = min_h + levels * LEVEL_H + (roof_levels * 2.8 if roof_levels else 0)
            if shape not in ("flat", "inset") and not roof_levels:
                height += rh
            elif shape == "inset" and not roof_levels:
                height += rh
        else:
            height = {"house": 7, "detached": 7, "shed": 3, "garage": 3, "garages": 3, "roof": 4,
                      "allotment_house": 3.5, "hut": 3, "kiosk": 3, "houseboat": 3, "church": 20,
                      "apartments": 18, "residential": 16, "industrial": 9, "warehouse": 9,
                      "retail": 8, "carport": 3, "greenhouse": 3, "service": 3.5,
                      "transformer_tower": 4}.get(btype, 10.0)
            if shape not in ("flat",):
                height += rh * 0.5
    if btype == "roof" and not t.get("min_height") and not t.get("building:min_level"):
        min_h = max(height - 1.0, 0)
        shape, rh = "flat", 0
    if height <= min_h + 0.2:
        height = min_h + 1.0
    rh = max(0.0, min(rh, (height - min_h) * (0.98 if shape in ("pyramidal", "cone", "dome", "onion") else 0.6)))
    if shape == "flat":
        rh = 0.0

    # colours
    wall = parse_colour(t.get("building:colour")) or MATERIAL_WALL.get(t.get("building:material", ""))
    if wall is None:
        if btype in ("apartments", "residential", "yes", "hotel", "dormitory", "house", "terrace", "public",
                     "school", "civic", "government", "church", "detached", "university", "commercial"):
            wall = STHLM_WALLS[int(hash01(oid, 1) * len(STHLM_WALLS))]
            if btype in ("house", "detached", "allotment_house", "shed", "cabin", "hut", "boathouse"):
                wall = (150, 58, 44) if hash01(oid, 2) < 0.6 else (236, 230, 216)  # falu red / white
        elif btype in ("office", "retail", "commercial"):
            wall = (150, 156, 158)
        elif btype in ("allotment_house", "shed", "cabin", "hut", "boathouse", "houseboat"):
            wall = (150, 58, 44) if hash01(oid, 2) < 0.6 else (236, 230, 216)
        else:
            wall = (170, 168, 160)
    roof = parse_colour(t.get("roof:colour")) or MATERIAL_ROOF.get(t.get("roof:material", ""))
    if roof is None:
        if shape in ("dome", "onion", "pyramidal", "cone") and btype in ("church", "cathedral", "chapel", "tower", "yes", "civic", "palace") and rh > 4:
            roof = (104, 150, 128)  # copper patina on spires and domes
        elif shape == "flat":
            roof = (112, 112, 110)
        else:
            roof = ROOF_DEFAULTS[int(hash01(oid, 3) * len(ROOF_DEFAULTS))]
    glass = t.get("building:material") == "glass" or (btype == "office" and (levels or 0) >= 8)
    wflags = 0 if btype in WINDOWLESS_TYPES or b.get("windowless") else F_WINDOWS
    if glass:
        wflags |= F_GLASS
    if btype in ("church", "cathedral", "chapel") or t.get("building:part") in ("tower", "steeple"):
        wflags = F_PLAIN

    base = ground_y + min_h if min_h > 0 else ground_y - 2.0
    top = ground_y + height - rh  # wall top (eaves)
    if top < base + 0.1:
        top = base + 0.1
    n0 = sum(len(x) for x in mesh.tris)

    for poly in polys:
        poly = orient(poly.simplify(0.05, preserve_topology=True), sign=1.0)
        if poly.is_empty or poly.area < 1.0:
            continue
        s = shape
        rects = poly.area / max(shapely.minimum_rotated_rectangle(poly).area, 1e-6)
        if s in PITCHED or s == "skillion":
            if poly.interiors or (rects < 0.8 and s != "skillion"):
                s = "inset"
        if s in ("pyramidal", "cone", "dome", "onion") and poly.interiors:
            s = "inset"
        rings = [np.asarray(poly.exterior.coords)] + [np.asarray(r.coords) for r in poly.interiors]
        wall_top = None  # fn(xy) -> height above `top`

        if s in PITCHED or s == "skillion":
            res = roof_planar(poly, s, rh, top, t)
            if res is None:
                s = "flat"
            else:
                pieces, hfn, creases = res
                for pc in pieces:
                    v, tri = earcut_poly(pc)
                    if len(tri) == 0:
                        continue
                    y = top + hfn(v)
                    v3 = np.column_stack([v[:, 0], y, v[:, 1]])
                    mesh.add(v3[tri], roof, F_ROOF, up=True)
                rings = [insert_crossings(r, creases) for r in rings]
                wall_top = hfn
        if s in ("pyramidal", "cone", "dome", "onion"):
            ext = rings[0][:-1]
            cen = np.asarray(poly.centroid.coords[0])
            if s in ("pyramidal", "cone"):
                prof = [(1.0, 0.0), (0.0, 1.0)]
            elif s == "dome":
                prof = [(math.cos(k / 8 * math.pi / 2), math.sin(k / 8 * math.pi / 2)) for k in range(9)]
            else:  # onion: bulge out, then taper to a point
                prof = [(1.0, 0.0), (1.18, 0.12), (1.25, 0.3), (1.1, 0.48), (0.75, 0.64), (0.4, 0.78),
                        (0.15, 0.9), (0.0, 1.0)]
            ringsP = [np.column_stack([cen[0] + (ext[:, 0] - cen[0]) * sc, np.full(len(ext), top + rh * hh),
                                       cen[1] + (ext[:, 1] - cen[1]) * sc]) for sc, hh in prof]
            tris = []
            for A, B in zip(ringsP[:-1], ringsP[1:]):
                A2, B2 = np.roll(A, -1, axis=0), np.roll(B, -1, axis=0)
                tris.append(np.stack([A, A2, B2], 1))
                tris.append(np.stack([A, B2, B], 1))
            tris = np.concatenate(tris)
            # orient each triangle outward from the vertical axis
            mid = tris.mean(axis=1)
            out = np.stack([mid[:, 0] - cen[0], mid[:, 2] - cen[1]], 1)
            n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
            flip = (n[:, 0] * out[:, 0] + n[:, 2] * out[:, 1] + n[:, 1] * 0.01) < 0
            tris[flip] = tris[flip][:, ::-1]
            mesh.add(tris, roof, F_ROOF)
            if s == "onion" or (prof[0][0] != 1.0):
                pass
        if s == "inset":
            d = min(rh * 1.3, 6.0)
            inner = None
            for dd in (d, d * 0.6, d * 0.35, d * 0.2):
                g = poly.buffer(-dd, join_style="mitre", mitre_limit=3.0)
                if not g.is_empty and g.area > 0.5:
                    inner, d = g, dd
                    break
            if inner is None:
                s = "flat"
            else:
                slope_h = rh * min(1.0, d / max(min(rh * 1.3, 6.0), 1e-6))
                ann = polys_of(poly.difference(inner))
                bnd = poly.boundary
                for pc in ann:
                    v, tri = earcut_poly(pc)
                    if len(tri) == 0:
                        continue
                    dist = shapely.distance(shapely.points(v), bnd)
                    y = top + np.where(dist < 0.02, 0.0, slope_h)
                    v3 = np.column_stack([v[:, 0], y, v[:, 1]])
                    mesh.add(v3[tri], roof, F_ROOF, up=True)
                for pc in polys_of(inner):
                    v, tri = earcut_poly(pc)
                    if len(tri):
                        v3 = np.column_stack([v[:, 0], np.full(len(v), top + slope_h), v[:, 1]])
                        mesh.add(v3[tri], roof, F_ROOF, up=True)
        if s == "flat":
            v, tri = earcut_poly(poly)
            if len(tri):
                v3 = np.column_stack([v[:, 0], np.full(len(v), top), v[:, 1]])
                mesh.add(v3[tri], roof, F_ROOF, up=True)

        # walls
        for ring in rings:
            p = ring[:-1] if np.allclose(ring[0], ring[-1]) else ring
            q = np.roll(p, -1, axis=0)
            ht_p = top + (wall_top(p) if wall_top else 0.0)
            ht_q = top + (wall_top(q) if wall_top else 0.0)
            ht_p = np.broadcast_to(ht_p, (len(p),))
            ht_q = np.broadcast_to(ht_q, (len(p),))
            d = q - p
            ln = np.hypot(d[:, 0], d[:, 1])
            ok = ln > 1e-4
            outward = np.stack([d[:, 1], -d[:, 0]], 1)
            for i in np.nonzero(ok)[0]:
                a0 = (p[i, 0], base, p[i, 1]); a1 = (q[i, 0], base, q[i, 1])
                b0 = (p[i, 0], ht_p[i], p[i, 1]); b1 = (q[i, 0], ht_q[i], q[i, 1])
                mesh.add(np.array([[a0, a1, b1], [a0, b1, b0]]), wall, wflags, outward=outward[i])
            # bottom never visible (sunk into terrain / sits on another part)
    return sum(len(x) for x in mesh.tris) - n0


# --------------------------------------------------------------------- driver
def plan(feats):
    """Decide what to render: parts replace the outlines they cover."""
    B = feats["buildings"]
    parts = [b for b in B if b["part"]]
    outlines = [b for b in B if not b["part"]]
    ptree = STRtree([p["geom"] for p in parts]) if parts else None
    part_owner = {}
    render = []
    for o in outlines:
        g = o["geom"]
        inside = []
        if ptree is not None:
            for i in ptree.query(g, predicate="intersects"):
                pg = parts[i]["geom"]
                try:
                    if g.buffer(0.5).contains(pg.representative_point()):
                        inside.append(i)
                except shapely.errors.GEOSException:
                    pass
        if inside:
            for i in inside:
                part_owner.setdefault(i, o)
            cover = shapely.union_all([parts[i]["geom"] for i in inside]).buffer(0.3)
            covered = cover.intersection(g).area / max(g.area, 1e-6)
            if covered < 0.75:
                rest = g.difference(cover)
                if rest.area > 4:
                    t = dict(o["tags"])
                    ph = [parse_len(parts[i]["tags"].get("height")) for i in inside]
                    ph = [x for x in ph if x]
                    oh = parse_len(t.get("height"))
                    if oh and ph and oh > np.median(ph) * 1.3:
                        t["height"] = str(np.median(ph))
                    render.append({**o, "tags": t, "geom": rest, "owner": o["id"], "outline": o})
        else:
            render.append({**o, "owner": o["id"], "outline": o})
    for i, p in enumerate(parts):
        o = part_owner.get(i)
        t = dict(p["tags"])
        if o is not None:
            for k in ("building:colour", "roof:colour", "building:material", "roof:material"):
                if k not in t and k in o["tags"]:
                    t[k] = o["tags"][k]
            if "building" not in t and "building" in o["tags"]:
                t["building"] = o["tags"]["building"]
        render.append({**p, "tags": t, "owner": o["id"] if o else p["id"], "outline": o or p,
                       "default_pitched": False})
    return render


def info_of(o):
    t = o["tags"]
    keys = ["name", "building", "height", "building:levels", "start_date", "architect", "wikipedia",
            "wikidata", "addr:street", "addr:housenumber", "amenity", "tourism", "historic", "roof:shape",
            "building:colour", "roof:material", "building:material", "description", "website", "alt_name", "old_name"]
    d = {k: t[k] for k in keys if k in t}
    d["id"] = o["id"]
    return d


def build_tile(args):
    key, items = args
    terr = Terrain()
    mesh = Mesh()
    infos, info_index = [], {}
    tri_owner = []
    fails = 0
    for b, ground_y in items:
        oid = b["owner"]
        if oid not in info_index:
            info_index[oid] = len(infos)
            infos.append(info_of(b["outline"]))
        ii = info_index[oid]
        before = len(mesh.tris)
        try:
            build_building(b, ground_y, ii, mesh)
        except Exception as e:  # noqa: BLE001
            fails += 1
            del mesh.tris[before:]
            del mesh.cols[before:]
            del mesh.flags[before:]
            continue
        for arr in mesh.tris[before:]:
            tri_owner.append(np.full(len(arr), ii, dtype=np.uint32))
    if not mesh.tris:
        return key, 0, 0, fails
    tris = np.concatenate(mesh.tris)  # (t,3,3)
    T = len(tris)
    pos = tris.reshape(-1, 3).astype(np.float32)
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True)
    nrm = np.zeros((T, 3, 4), np.int8)
    nrm[:, :, :3] = np.round(n * 127).astype(np.int8)[:, None, :]
    col = np.zeros((T, 3, 4), np.uint8)
    k = 0
    owners = np.concatenate(tri_owner)
    for arr, (rgb, flags) in zip(mesh.tris, mesh.cols):
        m = len(arr)
        nrm[k:k + m, :, 3] = flags
        col[k:k + m, :, :3] = rgb
        k += m
    seeds = np.array([int(hash01(infos[o]["id"], 9) * 255) for o in range(len(infos))], np.uint8)
    col[:, :, 3] = seeds[owners][:, None]
    tid = owners.astype(np.uint16 if len(infos) < 65535 else np.uint32)
    header = b"SB3D" + struct.pack("<III", T * 3, T, 2 if tid.dtype == np.uint16 else 4)
    blob = header + pos.tobytes() + nrm.tobytes() + col.tobytes() + tid.tobytes()
    i, j = key
    with gzip.open(OUT / f"b_{i}_{j}.bin.gz", "wb", compresslevel=9) as f:
        f.write(blob)
    (OUT / f"i_{i}_{j}.json").write_text(json.dumps(infos, ensure_ascii=False, separators=(",", ":")))
    return key, T, len(infos), fails


def main():
    feats = pickle.load(open(WORK / "features.pkl", "rb"))
    terr = Terrain()
    render = plan(feats)
    print(f"{len(render)} solids to build")
    x0, z0 = terr.x0, terr.z0
    tiles = defaultdict(list)
    # ground height per outline (parts share their outline's base)
    ground_cache = {}
    for b in render:
        o = b["outline"]
        if o["id"] not in ground_cache:
            ext = np.vstack([np.asarray(p.exterior.coords) for p in polys_of(o["geom"])] or [np.zeros((1, 2))])
            ground_cache[o["id"]] = float(terr.at(ext[:, 0], ext[:, 1]).min())
        c = o["geom"].centroid
        key = (int((c.x - x0) // TILE_SIZE), int((c.y - z0) // TILE_SIZE))
        tiles[key].append((b, ground_cache[o["id"]]))
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("b_*"):
        f.unlink()
    for f in OUT.glob("i_*"):
        f.unlink()
    tot = fails = 0
    summary = {}
    with Pool() as pool:
        for key, T, ninfo, nf in pool.imap_unordered(build_tile, sorted(tiles.items())):
            tot += T
            fails += nf
            if T:
                summary[f"{key[0]}_{key[1]}"] = {"tris": T, "buildings": ninfo}
    json.dump(summary, open(WORK / "building_tiles.json", "w"))
    size = sum(f.stat().st_size for f in OUT.glob("b_*"))
    print(f"{len(summary)} tiles, {tot/1e6:.2f}M triangles, {fails} failed solids, {size/1e6:.1f} MB gz")


if __name__ == "__main__":
    main()
