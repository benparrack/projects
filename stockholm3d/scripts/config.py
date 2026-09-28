"""Shared constants for the Stockholm 3D data pipeline."""
import math

# Central Stockholm: Kungsholmen/Norrmalm/Östermalm in the north, Södermalm and
# Globen in the south, all of Djurgården + Kaknästornet in the east.
BBOX = {"south": 59.286, "west": 17.995, "north": 59.352, "east": 18.165}

# Local tangent-plane origin (Gamla stan, Stortorget). x = east, z = south (three.js
# convention: -z is north), y = up, all in metres.
ORIGIN_LAT = 59.32500
ORIGIN_LON = 18.07080

R_EARTH = 6378137.0
M_PER_DEG_LAT = math.pi * R_EARTH / 180.0
M_PER_DEG_LON = M_PER_DEG_LAT * math.cos(math.radians(ORIGIN_LAT))

TILE_SIZE = 500.0  # metres per content tile
WATER_LEVEL = 0.0   # sea level; Mälaren sits ~0.7 m higher, not worth modelling


def to_local(lat, lon):
    """Equirectangular projection around the origin -> (x east, z south) metres."""
    return ((lon - ORIGIN_LON) * M_PER_DEG_LON, -(lat - ORIGIN_LAT) * M_PER_DEG_LAT)


def to_latlon(x, z):
    return (ORIGIN_LAT - z / M_PER_DEG_LAT, ORIGIN_LON + x / M_PER_DEG_LON)
