"""Ground-cover classification shared by the terrain and texture stages."""
import pickle
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import LineString, box
from shapely.ops import polygonize, unary_union

from config import BBOX, to_local

WORK = Path(__file__).resolve().parent.parent / "data" / "work"

# Ground colours (sRGB). Drawn in list order, later entries on top.
CLASSES = [
    # name, rgb, predicate(tags)
    ("industrial", (150, 144, 134), lambda t: t.get("landuse") in ("industrial", "railway", "construction", "brownfield", "depot", "port")),
    ("farm", (152, 160, 102), lambda t: t.get("landuse") in ("farmland", "allotments", "orchard", "plant_nursery", "farmyard")),
    ("grass", (112, 148, 72), lambda t: t.get("landuse") in ("grass", "meadow", "recreation_ground", "village_green", "flowerbed")
        or t.get("leisure") in ("park", "garden", "common", "dog_park", "golf_course", "nature_reserve", "playground")
        or t.get("natural") in ("grassland", "heath", "wetland")),
    ("cemetery", (98, 128, 72), lambda t: t.get("landuse") == "cemetery" or t.get("amenity") == "grave_yard"),
    ("forest", (70, 100, 52), lambda t: t.get("natural") in ("wood", "scrub") or t.get("landuse") == "forest"),
    ("rock", (128, 124, 116), lambda t: t.get("natural") in ("bare_rock", "rock", "scree")),
    ("sand", (206, 190, 150), lambda t: t.get("natural") in ("beach", "sand")),
    ("pitch", (98, 142, 80), lambda t: t.get("leisure") in ("pitch", "stadium")),
    ("track", (170, 88, 70), lambda t: t.get("leisure") == "track"),
    ("parking", (120, 120, 122), lambda t: t.get("amenity") == "parking"),
    ("square", (186, 178, 164), lambda t: t.get("place") == "square" or t.get("highway") in ("pedestrian", "footway")
        or "area:highway" in t),
    ("pier", (138, 118, 96), lambda t: t.get("man_made") in ("pier", "quay", "breakwater")),
]
BASE_RGB = (168, 164, 156)  # generic urban ground: asphalt/paving mix
WATER_RGB = (46, 74, 92)

# Road widths in metres and colours; roads draw over ground cover.
ROAD_W = {
    "motorway": 16, "trunk": 14, "primary": 13, "secondary": 11, "tertiary": 9,
    "motorway_link": 7, "trunk_link": 7, "primary_link": 7, "secondary_link": 7, "tertiary_link": 7,
    "unclassified": 7, "residential": 7, "living_street": 6, "service": 4.5, "pedestrian": 6,
    "road": 6, "footway": 2.5, "cycleway": 2.5, "path": 1.8, "steps": 2.5, "track": 3, "bridleway": 2,
}
ROAD_RGB = (82, 84, 88)
FOOT_RGB = (196, 186, 170)
PATH_RGB = (176, 160, 128)
RAIL_RGB = (108, 98, 90)


def classify(tags):
    for i in range(len(CLASSES) - 1, -1, -1):
        if CLASSES[i][2](tags):
            return i
    return None


def is_water_area(t):
    return (t.get("natural") == "water" or t.get("waterway") == "riverbank"
            or ("water" in t and t.get("natural") in (None, "water")))


def local_bbox(pad=200.0):
    x0, z0 = to_local(BBOX["north"], BBOX["west"])
    x1, z1 = to_local(BBOX["south"], BBOX["east"])
    return box(x0 - pad, z0 - pad, x1 + pad, z1 + pad)


def dem_sampler():
    from dem import dem_at
    return dem_at


def bridge_gaps(lines, frame, max_gap=1500.0):
    """Mälaren's relation stops where the lake meets the sea (Slussen,
    Norrström, Hammarby lock), and the coastline stops too, leaving open
    ends. Close them by joining each dangling end to its nearest dangling
    neighbour, shortest pairs first."""
    from shapely.ops import linemerge
    edge = LineString(frame.exterior.coords)
    merged = linemerge(unary_union(lines))
    ends = []
    for g in getattr(merged, "geoms", [merged]):
        if g.is_closed:
            continue
        for p in (g.coords[0], g.coords[-1]):
            if shapely.Point(p).distance(edge) > 1.0:
                ends.append(tuple(p))
    ends = list(dict.fromkeys(ends))
    out = []
    E = np.array(ends) if ends else np.zeros((0, 2))
    seen = set()
    for i, p in enumerate(ends):
        d = np.hypot(*(E - p).T)
        d[i] = np.inf
        j = int(np.argmin(d)) if len(d) > 1 else -1
        if j < 0 or d[j] > max_gap or (min(i, j), max(i, j)) in seen:
            continue
        seen.add((min(i, j), max(i, j)))
        out.append(LineString([ends[i], ends[j]]))
    return out


def land_evidence(feats):
    """Places we know are dry: buildings, land-cover areas, ground-level roads."""
    g = [b["geom"].buffer(6) for b in feats["buildings"]]
    g += [a["geom"] for a in feats["areas"] if not is_water_area(a["tags"]) and classify(a["tags"]) is not None
          and classify(a["tags"]) != len(CLASSES) - 1]  # not piers
    for l in feats["lines"]:
        t = l["tags"]
        if t.get("highway") in ROAD_W and t.get("bridge") in (None, "no") and t.get("tunnel") in (None, "no"):
            g.append(l["geom"].buffer(ROAD_W[t["highway"]] / 2 + 8))
    return unary_union(g)


def shoreline_faces(lines, grid=250.0, land=None):
    """Split the frame by coastlines + lake shores (+ a coarse grid) into
    faces, and keep the faces the elevation model says are water.

    Mälaren is only partly in the extract and its member ways have arbitrary
    direction, so ring assembly / left-right rules don't work. The DEM does:
    Copernicus flattens water to ~0-0.7 m. The grid bounds the damage of any
    shoreline gap we failed to close to one cell.
    """
    frame = local_bbox()
    lines = [l.intersection(frame) for l in lines]
    lines = [g for l in lines for g in getattr(l, "geoms", [l]) if g.geom_type == "LineString" and not g.is_empty]
    lines += bridge_gaps(lines, frame)
    x0, z0, x1, z1 = frame.bounds
    lines += [LineString([(x, z0), (x, z1)]) for x in np.arange(x0 + grid, x1, grid)]
    lines += [LineString([(x0, z), (x1, z)]) for z in np.arange(z0 + grid, z1, grid)]
    noded = unary_union(lines + [LineString(frame.exterior.coords)])
    dem = dem_sampler()
    rng = np.random.default_rng(1)
    water = []
    for f in polygonize(noded):
        minx, minz, maxx, maxz = f.bounds
        cand = np.column_stack([rng.uniform(minx, maxx, 600), rng.uniform(minz, maxz, 600)])
        pts = shapely.points(cand)
        inside = shapely.contains(f, pts)
        # prefer points away from the shore: DEM pixels (30 m) there are mixed
        far = inside & (shapely.distance(f.exterior, pts) > 20)
        use = far if far.sum() >= 12 else inside
        if use.sum() == 0:
            continue
        frac = np.mean(dem(cand[use, 0], cand[use, 1]) < 1.2)
        if frac > 0.6:
            water.append(f)
        elif frac > 0.1 and land is not None:
            # mixed face (a shoreline we couldn't close): the DEM is too
            # coarse to draw the edge, so water is whatever isn't known land
            water.append(f.difference(land))
    return water


def dem_water(step=5.0):
    """Water straight from the DEM: Copernicus flattens water bodies to ~0 m.
    Catches the Mälaren arms (Ulvsundasjön, Karlbergssjön) whose shorelines
    aren't closed in the extract. 30 m source, so the edges are coarse."""
    from scipy import ndimage
    fr = local_bbox()
    x0, z0, x1, z1 = fr.bounds
    xs = np.arange(x0, x1, step)
    zs = np.arange(z0, z1, step)
    X, Z = np.meshgrid(xs, zs)
    low = dem_sampler()(X, Z) < 1.0
    low = ndimage.binary_opening(low, iterations=2)
    lab, n = ndimage.label(low)
    sizes = ndimage.sum(low, lab, range(1, n + 1)) * step * step
    keep = np.isin(lab, 1 + np.nonzero(sizes > 5000)[0])
    boxes = []
    for r in range(keep.shape[0]):
        row = keep[r]
        if not row.any():
            continue
        d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
        for a, b in zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]):
            boxes.append(box(xs[0] + a * step, zs[0] + r * step, xs[0] + b * step, zs[0] + (r + 1) * step))
    return unary_union(boxes).buffer(3).buffer(-3).simplify(3)


def _water(feats):
    outlines = [LineString(r.coords) for a in feats["areas"] if is_water_area(a["tags"])
                for p in getattr(a["geom"], "geoms", [a["geom"]]) if p.geom_type == "Polygon"
                for r in [p.exterior, *p.interiors]]
    parts = shoreline_faces(feats["coast"] + feats["water_ways"] + outlines, land=land_evidence(feats))
    parts.append(dem_water())
    parts += [a["geom"] for a in feats["areas"] if is_water_area(a["tags"])]
    g = unary_union([shapely.make_valid(p) for p in parts]).intersection(local_bbox())
    return shapely.make_valid(g)


def water_geometry(feats=None):
    cache = WORK / "water.pkl"
    if cache.exists() and (WORK / "features.pkl").stat().st_mtime < cache.stat().st_mtime:
        return pickle.load(open(cache, "rb"))
    g = _water(feats if feats is not None else pickle.load(open(WORK / "features.pkl", "rb")))
    pickle.dump(g, open(cache, "wb"))
    return g
