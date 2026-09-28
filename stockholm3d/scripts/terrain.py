#!/usr/bin/env python3
"""Stage 2: bare-earth heightmap on a 5 m local grid.

Copernicus GLO-30 is a *surface* model (roofs + tree canopy included), so we
mask building footprints and woods, fill the holes from the surrounding ground,
then clamp water to below sea level and land to just above it.

Writes data/work/terrain.npz (heights float32 [rows, cols], x0, z0, step) and
data/work/masks.npz (water mask on the same grid).
"""
import pickle, sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).parent))
from config import BBOX, to_local  # noqa: E402
from landcover import water_geometry  # noqa: E402
from dem import dem_at  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "data" / "work"
STEP = 5.0


def grid_extent():
    x0, z0 = to_local(BBOX["north"], BBOX["west"])
    x1, z1 = to_local(BBOX["south"], BBOX["east"])
    x0, z0 = np.floor(x0 / 100) * 100, np.floor(z0 / 100) * 100
    x1, z1 = np.ceil(x1 / 100) * 100, np.ceil(z1 / 100) * 100
    cols = int(round((x1 - x0) / STEP)) + 1
    rows = int(round((z1 - z0) / STEP)) + 1
    return x0, z0, cols, rows


def rasterize(geoms, x0, z0, cols, rows, dilate_m=0.0):
    img = Image.new("L", (cols, rows), 0)
    d = ImageDraw.Draw(img)

    def px(c):
        return [((x - x0) / STEP, (z - z0) / STEP) for x, z in c]

    for g in geoms:
        for p in getattr(g, "geoms", [g]):
            if p.geom_type != "Polygon" or p.is_empty:
                continue
            d.polygon(px(p.exterior.coords), fill=255)
            for h in p.interiors:
                d.polygon(px(h.coords), fill=0)
    m = np.asarray(img) > 127
    if dilate_m > 0:
        m = ndimage.binary_dilation(m, iterations=max(1, int(round(dilate_m / STEP))))
    return m


def main():
    feats = pickle.load(open(WORK / "features.pkl", "rb"))
    x0, z0, cols, rows = grid_extent()
    print(f"grid {cols}x{rows} @ {STEP} m, origin ({x0},{z0})")

    # --- sample the DEM (bilinear) at every grid point
    xs = x0 + np.arange(cols) * STEP
    zs = z0 + np.arange(rows) * STEP
    X, Z = np.meshgrid(xs, zs)
    raw = dem_at(X, Z)

    # --- mask everything that is not bare ground
    bgeoms = [b["geom"] for b in feats["buildings"]]
    woods = [a["geom"] for a in feats["areas"]
             if a["tags"].get("natural") in ("wood", "scrub") or a["tags"].get("landuse") == "forest"]
    water = water_geometry(feats)
    water_m = rasterize([water], x0, z0, cols, rows)
    mask = rasterize(bgeoms, x0, z0, cols, rows, dilate_m=15) | rasterize(woods, x0, z0, cols, rows, dilate_m=10)
    mask &= ~water_m

    # DSM at 30 m smears roofs into streets too: take a local minimum of the
    # unmasked ground (streets/courtyards/parks), which is what we actually stand on.
    ground = np.where(mask | water_m, np.inf, raw)
    ground = ndimage.minimum_filter(ground, size=5)
    known = np.isfinite(ground) & ~water_m
    # Fill the holes by normalized convolution at growing scales, which gives
    # smooth ramps instead of the Voronoi facets a nearest-neighbour fill makes.
    v = np.where(known, ground, 0.0)
    m = known.astype(np.float64)
    filled = np.where(known, ground, np.nan)
    for sigma in (2, 4, 8, 16, 32, 64):
        est = ndimage.gaussian_filter(v, sigma) / np.maximum(ndimage.gaussian_filter(m, sigma), 1e-9)
        ok = ndimage.gaussian_filter(m, sigma) > 0.02
        fill_here = np.isnan(filled) & ok
        filled[fill_here] = est[fill_here]
    filled = np.where(np.isnan(filled), 2.0, filled)
    filled = ndimage.gaussian_filter(filled, sigma=2.5)

    # --- water/land shaping: quays sit ~1.5 m above the water, water bottoms at -4 m
    h = np.maximum(filled, 1.5)
    dist_in_water = ndimage.distance_transform_edt(water_m) * STEP
    h = np.where(water_m, -np.minimum(0.6 + dist_in_water * 0.4, 6.0), h)
    h = h.astype(np.float32)
    np.savez_compressed(WORK / "terrain.npz", h=h, x0=x0, z0=z0, step=STEP)
    np.savez_compressed(WORK / "masks.npz", water=water_m)
    land = h[~water_m]
    print(f"terrain land min/median/max = {land.min():.1f}/{np.median(land):.1f}/{land.max():.1f} m, "
          f"water cells {water_m.mean()*100:.0f}%")


class Terrain:
    """Bilinear lookup into the saved heightmap (used by later stages)."""

    def __init__(self):
        d = np.load(WORK / "terrain.npz")
        self.h, self.x0, self.z0, self.step = d["h"], float(d["x0"]), float(d["z0"]), float(d["step"])

    def at(self, x, z):
        c = (np.asarray(x) - self.x0) / self.step
        r = (np.asarray(z) - self.z0) / self.step
        return ndimage.map_coordinates(self.h, [np.atleast_1d(r), np.atleast_1d(c)], order=1, mode="nearest")


if __name__ == "__main__":
    main()
