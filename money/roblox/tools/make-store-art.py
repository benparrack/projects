#!/usr/bin/env python3
"""Generate the Creator Dashboard store art for every game from its marketing shots.

  games/<game>/marketing/store/icon.png       512x512 experience icon
  games/<game>/marketing/store/thumb<N>.png   1920x1080 thumbnails (16:9), first one carries the title

The shots are 879x675 Studio viewport captures, so thumbnails are upscaled ~2.2x; the text is
drawn at full resolution so it stays crisp.
"""
import glob
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = glob.glob(os.path.expanduser("~/.var/app/org.vinegarhq.Vinegar/data/vinegar/versions/*/content/fonts/"))
LUCKIEST = next(iter(glob.glob(FONTS[0] + "LuckiestGuy-Regular.ttf")), None) if FONTS else None

# game -> title, accent colour, icon shot, icon crop x-centre (0..1), [(shot, caption, y-offset 0..1)]
GAMES = {
    "jump-tower": ("+1 JUMP TOWER", (255, 200, 40), "hero2.png", 0.45, [
        ("hero2.png", None, 0.2),
        ("hero1.png", "JUMP HIGHER EVERY SECOND!", 0.3),
        ("hero3.png", "CLIMB ALL THE WAY TO SPACE", 0.5),
    ]),
    "steal-a-satellite": ("STEAL A SATELLITE", (60, 230, 255), "hero1.png", 0.55, [
        ("hero1.png", None, 0.4),
        ("hero3.png", "STEAL RARE SATELLITES!", 0.2),
        ("hero2.png", "BUILD THE RICHEST BASE", 0.4),
    ]),
    "anomaly-shift": ("ANOMALY SHIFT", (255, 60, 60), "hero3.png", 0.5, [
        ("hero3.png", None, 0.35),
        ("hero1.png", "SOMETHING IS WRONG...", 0.4),
        ("hero4.png", "28 ANOMALIES TO SPOT", 0.3),
        ("hero2.png", "TURN BACK OR KEEP GOING?", 0.4),
    ]),
    "candy-garden": ("GROW A CANDY GARDEN", (255, 100, 190), "hero1.png", 0.5, [
        ("hero1.png", None, 0.3),
        ("hero3.png", "RAINBOW CANDY IS WORTH x50!", 0.75),
        ("hero2.png", "PLANT  -  HARVEST  -  SELL", 0.4),
    ]),
}


def font(size):
    return ImageFont.truetype(LUCKIEST, size)


def fit(draw, text, max_w, size, stroke):
    while size > 20:
        f = font(size)
        l, _, r, _ = draw.textbbox((0, 0), text, font=f, stroke_width=stroke)
        if r - l <= max_w:
            return f
        size -= 4
    return font(size)


def shade(img, top: bool, height: int, alpha: int):
    # dark gradient behind the text so it reads on any shot
    w, h = img.size
    g = Image.new("L", (1, height))
    for y in range(height):
        t = y / height if top else 1 - y / height
        g.putpixel((0, y), int(alpha * (1 - t) ** 1.5))
    g = g.resize((w, height))
    mask = Image.new("L", (w, h), 0)
    mask.paste(g, (0, 0 if top else h - height))
    return Image.composite(Image.new("RGB", (w, h), (10, 8, 20)), img, mask)


def text(draw, xy, s, f, accent, stroke, shadow):
    x, y = xy
    draw.text((x + shadow, y + shadow), s, font=f, anchor="mm", fill=(0, 0, 0), stroke_width=stroke, stroke_fill=(0, 0, 0))
    draw.text((x, y), s, font=f, anchor="mm", fill=(255, 255, 255), stroke_width=stroke, stroke_fill=tuple(int(c * 0.35) for c in accent))


def thumb(shot: Image.Image, title, caption, accent, yoff):
    w, h = shot.size
    ch = round(w * 9 / 16)
    top = round((h - ch) * yoff)
    img = shot.crop((0, top, w, top + ch)).resize((1920, 1080), Image.LANCZOS)
    img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
    d = ImageDraw.Draw(img)
    if caption is None:
        img = shade(img, False, 420, 200)
        d = ImageDraw.Draw(img)
        f = fit(d, title, 1700, 200, 16)
        text(d, (960, 900), title, f, accent, 16, 10)
    else:
        img = shade(img, True, 330, 190)
        d = ImageDraw.Draw(img)
        f = fit(d, caption, 1700, 130, 12)
        text(d, (960, 130), caption, f, accent, 12, 8)
    return img


def icon(shot: Image.Image, title, accent, xc):
    w, h = shot.size
    x = max(0, min(w - h, round(w * xc - h / 2)))
    img = shot.crop((x, 0, x + h, h)).resize((512, 512), Image.LANCZOS)
    img = shade(img, False, 260, 215)
    d = ImageDraw.Draw(img)
    words = title.split()
    if len(title) > 12:
        mid = (len(words) + 1) // 2
        lines = [" ".join(words[:mid]), " ".join(words[mid:])]
    else:
        lines = [title]
    size = min(fit(d, ln, 450, 110, 7).size for ln in lines)
    f = font(size)
    y = 512 - 40 - (len(lines) - 1) * size * 0.95
    for ln in lines:
        text(d, (256, y), ln, f, accent, 7, 5)
        y += size * 0.95
    return img


if __name__ == "__main__":
    assert LUCKIEST, "LuckiestGuy font not found in the Vinegar Studio install"
    sheet_items = []
    for game, (title, accent, icon_shot, xc, thumbs) in GAMES.items():
        mk = ROOT / "games" / game / "marketing"
        out = mk / "store"
        out.mkdir(exist_ok=True)
        ic = icon(Image.open(mk / icon_shot).convert("RGB"), title, accent, xc)
        ic.save(out / "icon.png")
        row = [ic]
        for i, (shot, caption, yoff) in enumerate(thumbs, 1):
            t = thumb(Image.open(mk / shot).convert("RGB"), title, caption, accent, yoff)
            t.save(out / f"thumb{i}.png", optimize=True)
            row.append(t)
        sheet_items.append(row)
    # review sheet: one row per game
    th = 216
    sheet = Image.new("RGB", (th + 4 * 384 + 50, len(sheet_items) * (th + 10)), (30, 30, 30))
    for r, row in enumerate(sheet_items):
        x = 0
        for im in row:
            im = im.resize((th, th) if im.width == 512 else (384, th), Image.LANCZOS)
            sheet.paste(im, (x, r * (th + 10)))
            x += im.width + 10
    sheet.save(ROOT / "build" / "store-sheet.png")
    print("ok")
