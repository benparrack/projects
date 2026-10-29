#!/usr/bin/env python3
"""Stage 1: read the OSM PBF, keep what we render, clip to the bbox, project to
local metres, and pickle it to data/work/features.pkl.

Output dict:
  buildings: [{id, tags, geom (Polygon/MultiPolygon, local xz), part: bool}]
  areas:     [{id, tags, geom}]            ground cover polygons
  coast:     [LineString]                  coastline, local xz, in OSM direction
  water_ways:[LineString]                  members of water multipolygons
  lines:     [{id, tags, geom LineString}] highways + railways
  trees:     [(x, z, tags)]
  pois:      [{id, tags, x, z}]
"""
import pickle, sys, time
from pathlib import Path

import osmium
import shapely
from shapely.geometry import Polygon, MultiPolygon, LineString, box
from shapely.ops import transform

sys.path.insert(0, str(Path(__file__).parent))
from config import BBOX, to_local  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PBF = ROOT / "data" / "raw" / "Stockholm.osm.pbf"
OUT = ROOT / "data" / "work" / "features.pkl"

S, W, N, E = BBOX["south"], BBOX["west"], BBOX["north"], BBOX["east"]
PAD = 0.004  # read a little beyond the bbox so clipping is clean
BB_LL = box(W, S, E, N)

AREA_KEYS = {"natural", "water", "waterway", "landuse", "leisure", "amenity",
             "area:highway", "place", "man_made", "highway"}
AREA_VALUES = {
    "natural": {"water", "wood", "scrub", "grassland", "heath", "wetland", "bare_rock",
                "beach", "sand", "rock", "scree"},
    "leisure": {"park", "garden", "pitch", "golf_course", "playground", "marina",
                "nature_reserve", "track", "stadium", "dog_park", "common"},
    "amenity": {"parking", "grave_yard"},
    "man_made": {"pier", "bridge", "quay", "breakwater"},
    "place": {"square"},
    "highway": {"pedestrian", "footway", "service"},
}
LINE_RAIL = {"rail", "subway", "tram", "light_rail", "narrow_gauge"}


def inside(lat, lon):
    return S - PAD <= lat <= N + PAD and W - PAD <= lon <= E + PAD


def proj(geom):
    return transform(lambda lon, lat, z=None: to_local(lat, lon), geom)


def area_wanted(tags):
    for k in AREA_KEYS:
        v = tags.get(k)
        if v is None:
            continue
        if k in ("landuse", "water", "area:highway"):
            return True
        if k == "waterway" and v == "riverbank":
            return True
        if k in AREA_VALUES and v in AREA_VALUES[k]:
            if k == "highway" and tags.get("area") != "yes":
                continue
            return True
    return False


def ring_coords(ring):
    return [(n.lon, n.lat) for n in ring]


def area_to_geom(a):
    polys = []
    for outer in a.outer_rings():
        oc = ring_coords(outer)
        if len(oc) < 4:
            continue
        holes = [ring_coords(i) for i in a.inner_rings(outer)]
        p = Polygon(oc, [h for h in holes if len(h) >= 4])
        if not p.is_valid:
            p = shapely.make_valid(p)
        polys.append(p)
    if not polys:
        return None
    g = shapely.union_all(polys) if len(polys) > 1 else polys[0]
    return g


def polygonal(g):
    """Keep only polygon parts of a (possibly collection) geometry."""
    if g is None or g.is_empty:
        return None
    if isinstance(g, (Polygon, MultiPolygon)):
        return g
    parts = [p for p in getattr(g, "geoms", []) if isinstance(p, (Polygon, MultiPolygon))]
    return shapely.union_all(parts) if parts else None


def main():
    t0 = time.time()
    out = {"buildings": [], "areas": [], "coast": [], "water_ways": [], "lines": [], "trees": [], "pois": []}
    # Water multipolygons like Mälaren are only partly inside the extract, so the
    # area assembler drops them. Keep their member ways and rebuild them later.
    water_members = set()
    for r in osmium.FileProcessor(str(PBF), osmium.osm.RELATION):
        t = dict(r.tags)
        if t.get("natural") == "water" or "water" in t or t.get("waterway") == "riverbank":
            water_members.update(m.ref for m in r.members if m.type == "w")
    fp = osmium.FileProcessor(str(PBF)).with_locations().with_areas()
    n = 0
    for obj in fp:
        n += 1
        tags = dict(obj.tags)
        if not tags:
            continue
        if obj.is_node():
            if not obj.location.valid() or not inside(obj.location.lat, obj.location.lon):
                continue
            lat, lon = obj.location.lat, obj.location.lon
            if tags.get("natural") == "tree":
                x, z = to_local(lat, lon)
                out["trees"].append((x, z, tags))
            if "name" in tags and (tags.get("tourism") in ("attraction", "museum", "viewpoint", "gallery")
                                   or "historic" in tags or tags.get("amenity") == "place_of_worship"
                                   or tags.get("place") in ("suburb", "quarter", "neighbourhood", "island", "islet")):
                x, z = to_local(lat, lon)
                out["pois"].append({"id": f"n{obj.id}", "tags": tags, "x": x, "z": z})
        elif obj.is_way():
            if obj.id in water_members:
                try:
                    coords = [(nd.lon, nd.lat) for nd in obj.nodes]
                    if len(coords) >= 2 and any(inside(la, lo) for lo, la in coords):
                        out["water_ways"].append(proj(LineString(coords)))
                except osmium.InvalidLocationError:
                    pass
            if "highway" in tags or tags.get("railway") in LINE_RAIL or tags.get("natural") in ("coastline", "tree_row"):
                try:
                    coords = [(nd.lon, nd.lat) for nd in obj.nodes]
                except osmium.InvalidLocationError:
                    continue
                if len(coords) < 2 or not any(inside(la, lo) for lo, la in coords):
                    continue
                ls = LineString(coords)
                if tags.get("natural") == "coastline":
                    out["coast"].append(proj(ls))
                elif tags.get("natural") == "tree_row":
                    out["lines"].append({"id": f"w{obj.id}", "tags": tags, "geom": proj(ls)})
                elif not (tags.get("area") == "yes" and ls.is_closed):
                    out["lines"].append({"id": f"w{obj.id}", "tags": tags, "geom": proj(ls)})
        elif obj.is_area():
            is_b = "building" in tags and tags["building"] != "no"
            is_part = "building:part" in tags and tags["building:part"] != "no"
            if not (is_b or is_part or area_wanted(tags) or
                    ("name" in tags and ("tourism" in tags or "historic" in tags))):
                continue
            try:
                g = area_to_geom(obj)
            except Exception:  # noqa: BLE001 - broken multipolygons happen
                continue
            if g is None or not g.intersects(BB_LL):
                continue
            oid = f"{'w' if obj.from_way() else 'r'}{obj.orig_id()}"
            if is_b or is_part:
                # buildings are assigned whole (not clipped) if their centroid is inside
                if not BB_LL.contains(g.centroid):
                    continue
                out["buildings"].append({"id": oid, "tags": tags, "geom": polygonal(proj(g)), "part": is_part and not is_b})
            if area_wanted(tags):
                gc = polygonal(g.intersection(BB_LL))
                if gc is not None:
                    out["areas"].append({"id": oid, "tags": tags, "geom": proj(gc)})
            if "name" in tags and (tags.get("tourism") in ("attraction", "museum") or "historic" in tags
                                   or tags.get("amenity") == "place_of_worship" or tags.get("place") == "island"):
                c = g.representative_point()
                x, z = to_local(c.y, c.x)
                out["pois"].append({"id": oid, "tags": tags, "x": x, "z": z})
    out["buildings"] = [b for b in out["buildings"] if b["geom"] is not None and not b["geom"].is_empty]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "wb") as f:
        pickle.dump(out, f)
    print(f"read {n} objects in {time.time()-t0:.0f}s: " +
          ", ".join(f"{k}={len(v)}" for k, v in out.items()))


if __name__ == "__main__":
    main()
