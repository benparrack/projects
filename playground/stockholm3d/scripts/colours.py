"""OSM colour tag parsing (hex or CSS-ish names)."""

NAMED = {
    "white": (238, 236, 230), "black": (40, 40, 42), "grey": (150, 150, 150), "gray": (150, 150, 150),
    "lightgrey": (200, 200, 198), "lightgray": (200, 200, 198), "darkgrey": (90, 90, 92),
    "darkgray": (90, 90, 92), "silver": (190, 190, 192), "red": (170, 60, 46), "darkred": (120, 40, 34),
    "maroon": (110, 36, 30), "brown": (128, 82, 54), "saddlebrown": (130, 74, 36), "sienna": (160, 82, 45),
    "tan": (210, 180, 140), "beige": (228, 214, 180), "wheat": (240, 222, 179), "cream": (240, 230, 200),
    "ivory": (240, 238, 224), "yellow": (232, 200, 90), "lightyellow": (242, 230, 170), "gold": (220, 180, 60),
    "khaki": (220, 206, 140), "orange": (222, 140, 60), "salmon": (230, 140, 120), "pink": (230, 170, 170),
    "coral": (230, 120, 90), "green": (90, 130, 80), "darkgreen": (50, 90, 50), "olive": (128, 128, 60),
    "lightgreen": (160, 200, 150), "teal": (60, 128, 128), "turquoise": (80, 180, 170),
    "blue": (70, 100, 160), "lightblue": (160, 190, 220), "navy": (40, 50, 100), "skyblue": (140, 190, 230),
    "darkblue": (40, 50, 110), "purple": (120, 70, 120), "violet": (170, 120, 190), "copper": (104, 150, 128),
    "terracotta": (190, 100, 70), "ochre": (204, 150, 70), "sand": (216, 196, 150),
}


def parse_colour(v):
    if not v:
        return None
    s = str(v).strip().lower().split(";")[0].replace(" ", "").replace("_", "")
    if s.startswith("#"):
        h = s[1:]
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        if len(h) == 6:
            try:
                return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
            except ValueError:
                return None
        return None
    return NAMED.get(s)
