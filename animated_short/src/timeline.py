"""Single source of truth for timing. Both the renderer (scene.py) and the
synth (audio.py) read from here, so picture and sound cannot drift apart."""

FPS = 60
DURATION = 176.0

# (name, start, end)
SHOTS = [
    ("title",      0.0,   8.0),
    ("drift",      8.0,  20.0),
    ("closeup",   20.0,  32.0),
    ("reveal",    32.0,  50.0),
    ("approach",  50.0,  62.0),
    ("ringreveal",62.0,  76.0),
    ("flyover",   76.0,  88.0),
    ("contact",   88.0,  98.0),
    ("cascade",   98.0, 110.0),
    ("powerup",  110.0, 122.0),
    ("gate",     122.0, 134.0),
    ("dive",     134.0, 144.0),
    ("tunnel",   144.0, 150.0),
    ("arrival",  150.0, 166.0),
    ("credits",  166.0, 176.0),
]

# Lantern's call (A4 -> E5).  Beacon answer (A3 -> E4).
PROBE_PINGS = [22.5, 26.5, 89.0, 93.6, 152.5]
BEACON_ANSWERS = [91.8, 94.6]
PING_NOTE_GAP = 0.22          # seconds between the two notes of a call

SUNRISE = 41.0
CASCADE_START, CASCADE_MEET = 98.5, 106.0
POWER_START = 110.0
PORTAL_TEAR = 122.8
SHOCK_START, SHOCK_HIT = 124.0, 125.2
DARK_END = 129.4             # first flicker of the relight
RELIT = 131.0
TUNNEL_START, WHITEOUT = 144.0, 149.6
SWARM_START = 152.5          # swarm clock zero (= ping 5)
SWARM_FIRST = 154.6          # first answer
FADE_OUT = (164.0, 166.0)
FINAL_PING = 172.0

# probe flicker moments (start, end, depth)
FLICKERS = [(29.5, 31.2, 0.55), (116.5, 118.0, 0.35), (119.8, 121.6, 0.4)]


def shot_at(t):
    for i, (name, a, b) in enumerate(SHOTS):
        if a <= t < b:
            return i, name, a, b
    name, a, b = SHOTS[-1]
    return len(SHOTS) - 1, name, a, b
