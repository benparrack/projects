"""Copernicus GLO-30 DSM sampler over the two 1°x1° tiles we need (E017, E018)."""
from pathlib import Path

import numpy as np
import tifffile
from scipy import ndimage

from config import to_latlon

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
_dem = None


def _mosaic():
    global _dem
    if _dem is None:
        a = tifffile.imread(RAW / "cop30_N59_E017.tif").astype(np.float32)
        b = tifffile.imread(RAW / "cop30_N59_E018.tif").astype(np.float32)
        _dem = np.hstack([a, b])  # lat 59..60 (row 0 = 60N), lon 17..19
    return _dem


def dem_at(x, z):
    """Raw surface height (m) at local (x, z); bilinear, pixel-centre registered."""
    dem = _mosaic()
    H, W = dem.shape
    lat, lon = to_latlon(np.asarray(x, dtype=np.float64), np.asarray(z, dtype=np.float64))
    return ndimage.map_coordinates(dem, [(60.0 - lat) * H - 0.5, (lon - 17.0) * (W / 2) - 0.5], order=1, mode="nearest")
