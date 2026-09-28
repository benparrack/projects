#!/usr/bin/env python3
"""Stage 5: bridges and piers, in the same tile format as the buildings
(web/data/tiles/s_<i>_<j>.bin.gz + si_<i>_<j>.json).

OSM bridges are just ways tagged bridge=yes, with no deck height. We chain
connected bridge ways, run the deck from the terrain height at one end to the
other, and add an arch proportional to the span (Västerbron's ~600 m span gives
~25 m of clearance, a canal footbridge a metre or two). Where the deck crosses
water we drop columns every ~45 m.
"""
import gzip, json, math, pickle, struct, sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import LineString
from shapely.ops import linemerge, unary_union
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).parent))
from config import TILE_SIZE  # noqa: E402
from terrain import Terrain  # noqa: E402
from buildings import Mesh, earcut_poly, polys_of, hash01, F_PLAIN, F_ROOF  # noqa: E402
from landcover import ROAD_W, water_geometry  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "data" / "work"
OUT = ROOT / "web" / "data" / "tiles"

DECK_RGB = (92, 92, 96)
RAIL_DECK_RGB = (104, 96, 90)
FOOT_DECK_RGB = (150, 140, 128)
SIDE_RGB = (132, 128, 122)
PIER_RGB = (120, 104, 86)
THICK = 1.4
PARAPET = 1.0


def width_of(t):
    hw, rw = t.get("highway"), t.get("railway")
    try:
        return float(str(t["width"]).split()[0])
    except (KeyError, ValueError):
        pass
    if hw in ROAD_W:
        return max(ROAD_W[hw] + 2.0, 3.0)
    return 5.0 if rw in ("rail", "narrow_gauge") else 4.0


def bridge_chains(feats):
    ways = []
    for l in feats["lines"]:
        t = l["tags"]
        if t.get("bridge") in (None, "no") or t.get("tunnel") not in (None, "no"):
            continue
        if not (t.get("highway") in ROAD_W or t.get("railway") in ("rail", "light_rail", "subway", "tram", "narrow_gauge")):
            continue
        if t.get("highway") in ("path", "track", "bridleway") and t.get("bridge") != "yes":
            continue
        ways.append(l)
    # chain per kind so a rail bridge doesn't merge with the road alongside it
    groups = defaultdict(list)
    for l in ways:
        t = l["tags"]
        kind = "rail" if "railway" in t else ("foot" if t["highway"] in ("footway", "cycleway", "path", "steps", "pedestrian") else "road")
        groups[kind].append(l)
    chains = []
    for kind, ls in groups.items():
        tree = STRtree([l["geom"] for l in ls])
        merged = linemerge(unary_union([l["geom"] for l in ls]))
        for c in getattr(merged, "geoms", [merged]):
            if c.length < 4:
                continue
            members = [ls[i] for i in tree.query(c.buffer(0.5), predicate="intersects")
                       if ls[i]["geom"].intersection(c.buffer(0.5)).length > 1]
            if not members:
                continue
            m = max(members, key=lambda l: l["geom"].length)
            chains.append({"geom": c, "kind": kind, "width": max(width_of(x["tags"]) for x in members),
                           "tags": m["tags"], "id": m["id"],
                           "layer": max(int(float(x["tags"].get("layer", 1) or 1)) if str(x["tags"].get("layer", "1")).lstrip("-").replace(".", "").isdigit() else 1 for x in members)})
    return chains


def deck_profile(c, terr, water):
    g = c["geom"]
    L = g.length
    n = max(2, int(math.ceil(L / 6)) + 1)
    s = np.linspace(0, 1, n)
    pts = np.array([g.interpolate(v, normalized=True).coords[0] for v in s])
    ground = terr.at(pts[:, 0], pts[:, 1])
    h0, h1 = float(ground[0]), float(ground[-1])
    wet = shapely.contains_xy(water, pts[:, 0], pts[:, 1])
    span = L * max(wet.mean(), 0.15)
    arch = np.clip(0.042 * span, 0.6, 26.0) * np.sin(np.pi * s) ** 0.6
    y = h0 + (h1 - h0) * s + arch
    # overpasses on land: clear whatever is underneath
    clear = 4.8 * max(c["layer"], 1) if not wet.any() else 2.5
    under = ground + np.where(wet, 0, clear)
    inner = (s > 0.08) & (s < 0.92)
    y = np.where(inner, np.maximum(y, under), y)
    # smooth the clamp so it doesn't kink
    if n > 5:
        k = np.array([1, 2, 3, 2, 1], float) / 9
        ys = np.convolve(np.pad(y, 2, mode="edge"), k, mode="valid")
        ys[0], ys[-1] = y[0], y[-1]
        y = ys
    return pts, y + 0.25, wet, ground


def ribbon(mesh, pts, y, w, top_rgb, side_rgb, parapet):
    d = np.gradient(pts, axis=0)
    d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
    nrm = np.column_stack([-d[:, 1], d[:, 0]])  # left normal in x/z
    L = pts + nrm * w / 2
    R = pts - nrm * w / 2

    def v(P, Y):
        return np.column_stack([P[:, 0], Y, P[:, 1]])

    Lt, Rt, Lb, Rb = v(L, y), v(R, y), v(L, y - THICK), v(R, y - THICK)
    quads = []
    for i in range(len(pts) - 1):
        quads.append((Lt[i], Rt[i], Rt[i + 1], Lt[i + 1]))
    top = [(a, b, c) for a, b, c, d_ in quads] + [(a, c, d_) for a, b, c, d_ in quads]
    mesh.add(top, top_rgb, F_PLAIN | F_ROOF, up=True)
    bot = []
    for i in range(len(pts) - 1):
        a, b, c, d_ = Lb[i], Rb[i], Rb[i + 1], Lb[i + 1]
        bot += [(a, c, b), (a, d_, c)]
    # bottom faces down: orient manually
    bot = np.array(bot)
    nb = np.cross(bot[:, 1] - bot[:, 0], bot[:, 2] - bot[:, 0])
    flip = nb[:, 1] > 0
    bot[flip] = bot[flip][:, ::-1]
    mesh.add(bot, side_rgb, F_PLAIN)
    for side, (T, B, sgn) in enumerate(((Lt, Lb, 1), (Rt, Rb, -1))):
        P = T.copy()
        P[:, 1] += parapet
        for i in range(len(pts) - 1):
            o = nrm[i] * sgn
            mesh.add([(B[i], B[i + 1], P[i + 1]), (B[i], P[i + 1], P[i])], side_rgb, F_PLAIN, outward=o)
            if parapet > 0:  # inner face of the parapet
                mesh.add([(T[i], T[i + 1], P[i + 1]), (T[i], P[i + 1], P[i])], side_rgb, F_PLAIN, outward=-o)
    for k, sgn in ((0, -1), (-1, 1)):  # end caps
        o = d[k] * sgn
        mesh.add([(Lb[k], Rb[k], Rt[k]), (Lb[k], Rt[k], Lt[k])], side_rgb, F_PLAIN, outward=o)


def box(mesh, cx, cz, hw, hd, ang, y0, y1, rgb):
    ca, sa = math.cos(ang), math.sin(ang)
    corners = [(cx + ca * a - sa * b, cz + sa * a + ca * b) for a, b in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))]
    for i in range(4):
        (x0, z0), (x1, z1) = corners[i], corners[(i + 1) % 4]
        mx, mz = (x0 + x1) / 2 - cx, (z0 + z1) / 2 - cz
        mesh.add([((x0, y0, z0), (x1, y0, z1), (x1, y1, z1)), ((x0, y0, z0), (x1, y1, z1), (x0, y1, z0))], rgb, F_PLAIN, outward=(mx, mz))


def build_bridge(c, terr, water, mesh):
    pts, y, wet, ground = deck_profile(c, terr, water)
    w = c["width"]
    rgb = {"rail": RAIL_DECK_RGB, "foot": FOOT_DECK_RGB}.get(c["kind"], DECK_RGB)
    ribbon(mesh, pts, y, w, rgb, SIDE_RGB, PARAPET if c["kind"] != "rail" else 0.6)
    # columns where the deck is well above ground/water
    cum = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    L = cum[-1]
    if L < 30:
        return
    step = 45.0 if L > 120 else L / 2
    for sv in np.arange(step, L - step * 0.5, step):
        i = int(np.searchsorted(cum, sv))
        i = min(max(i, 1), len(pts) - 2)
        top = y[i] - THICK
        bottom = min(ground[i], -3.0) if wet[i] else ground[i] - 0.5
        if top - bottom < 3.5:
            continue
        d = pts[i + 1] - pts[i - 1]
        ang = math.atan2(d[1], d[0])
        box(mesh, pts[i, 0], pts[i, 1], 1.4, w * 0.36, ang, bottom, top, SIDE_RGB)


def build_pier(a, water, mesh):
    for p in polys_of(a["geom"]):
        if not p.intersects(water) or p.intersection(water).area < 0.3 * p.area:
            continue  # piers on land are just paving (ground texture)
        v, tri = earcut_poly(p)
        if len(tri) == 0:
            continue
        top = 1.1
        mesh.add([[(v[a_, 0], top, v[a_, 1]) for a_ in t] for t in tri], PIER_RGB, F_PLAIN | F_ROOF, up=True)
        for ring in [p.exterior, *p.interiors]:
            c = np.asarray(ring.coords)
            cen = np.asarray(p.centroid.coords[0])
            for (x0, z0), (x1, z1) in zip(c[:-1], c[1:]):
                mx, mz = (x0 + x1) / 2 - cen[0], (z0 + z1) / 2 - cen[1]
                # outward = perpendicular pointing away from the polygon
                nx, nz = z1 - z0, -(x1 - x0)
                if not p.buffer(-0.05).contains(shapely.Point((x0 + x1) / 2 - nx * 0.01, (z0 + z1) / 2 - nz * 0.01)):
                    nx, nz = -nx, -nz
                mesh.add([((x0, -1.0, z0), (x1, -1.0, z1), (x1, top, z1)), ((x0, -1.0, z0), (x1, top, z1), (x0, top, z0))],
                         (96, 82, 66), F_PLAIN, outward=(-nx, -nz))


def write_tile(key, mesh, infos, owners):
    tris = np.concatenate(mesh.tris)
    T = len(tris)
    pos = tris.reshape(-1, 3).astype(np.float32)
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True)
    nrm = np.zeros((T, 3, 4), np.int8)
    nrm[:, :, :3] = np.round(n * 127).astype(np.int8)[:, None, :]
    col = np.zeros((T, 3, 4), np.uint8)
    k = 0
    for arr, (rgb, flags) in zip(mesh.tris, mesh.cols):
        m = len(arr)
        nrm[k:k + m, :, 3] = flags
        col[k:k + m, :, :3] = rgb
        k += m
    owners = np.concatenate(owners)
    col[:, :, 3] = 128
    tid = owners.astype(np.uint16)
    header = b"SB3D" + struct.pack("<III", T * 3, T, 2)
    i, j = key
    with gzip.open(OUT / f"s_{i}_{j}.bin.gz", "wb", compresslevel=9) as f:
        f.write(header + pos.tobytes() + nrm.tobytes() + col.tobytes() + tid.tobytes())
    (OUT / f"si_{i}_{j}.json").write_text(json.dumps(infos, ensure_ascii=False, separators=(",", ":")))
    return T


def main():
    feats = pickle.load(open(WORK / "features.pkl", "rb"))
    terr = Terrain()
    water = water_geometry()
    shapely.prepare(water)
    items = defaultdict(list)
    for c in bridge_chains(feats):
        items[c["geom"].interpolate(0.5, normalized=True)].append(("bridge", c))
    for a in feats["areas"]:
        if a["tags"].get("man_made") == "pier":
            items[a["geom"].centroid].append(("pier", a))
    tiles = defaultdict(list)
    for p, lst in items.items():
        key = (int((p.x - terr.x0) // TILE_SIZE), int((p.y - terr.z0) // TILE_SIZE))
        tiles[key] += lst
    for f in list(OUT.glob("s_*")) + list(OUT.glob("si_*")):
        f.unlink()
    summary, tot, nb = {}, 0, 0
    for key, lst in sorted(tiles.items()):
        mesh, infos, owners = Mesh(), [], []
        for kind, o in lst:
            before = len(mesh.tris)
            try:
                if kind == "bridge":
                    build_bridge(o, terr, water, mesh)
                    nb += 1
                else:
                    build_pier(o, water, mesh)
            except Exception as e:  # noqa: BLE001
                del mesh.tris[before:], mesh.cols[before:], mesh.flags[before:]
                print("fail", kind, o["id"], e)
                continue
            if len(mesh.tris) == before:
                continue
            t = o["tags"]
            info = {k: t[k] for k in ("name", "bridge:name", "highway", "railway", "man_made", "start_date", "wikipedia") if k in t}
            info["id"] = o["id"]
            info["structure"] = "bridge" if kind == "bridge" else "pier"
            if kind == "bridge":
                info["length_m"] = round(o["geom"].length)
            owners += [np.full(len(a), len(infos), np.uint32) for a in mesh.tris[before:]]
            infos.append(info)
        if mesh.tris:
            T = write_tile(key, mesh, infos, owners)
            tot += T
            summary[f"{key[0]}_{key[1]}"] = {"tris": T}
    json.dump(summary, open(WORK / "structure_tiles.json", "w"))
    size = sum(f.stat().st_size for f in OUT.glob("s_*"))
    print(f"{nb} bridge chains, {len(summary)} tiles, {tot/1e3:.0f}k triangles, {size/1e6:.1f} MB gz")


if __name__ == "__main__":
    main()
