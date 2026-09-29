#!/usr/bin/env python3
"""Generate 512x512 game pass / developer product icons for every game.

Each icon: a blurred, tinted crop of the game's marketing shot, a glow, a big emoji and a
Fredoka label, kept inside the centre circle (Roblox sometimes shows icons round).
Output: games/<game>/marketing/icons/<key>.png (key = the Config key for that item).
"""
import glob
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
S = 512
EMOJI_FONT = "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf"
FREDOKA = next(iter(glob.glob(os.path.expanduser(
    "~/.var/app/org.vinegarhq.Vinegar/data/vinegar/versions/*/content/fonts/FredokaOne-Regular.ttf"))), None)

# game -> (background shot, [(key, emoji, label, rgb)])
GAMES = {
    "jump-tower": ("hero1.png", [
        ("x2Jump", "🦘", "2x JUMP", (60, 150, 255)),
        ("x2Wins", "🏆", "2x WINS", (255, 180, 30)),
        ("vip", "👑", "VIP", (170, 90, 255)),
        ("boostSmall", "⚡", "+5 MIN", (40, 200, 120)),
        ("boostLarge", "🚀", "+60 MIN", (255, 90, 90)),
        ("skipZone", "⏩", "SKIP ZONE", (0, 190, 210)),
    ]),
    "steal-a-satellite": ("hero1.png", [
        ("x2Cash", "💰", "2x CASH", (40, 190, 90)),
        ("biggerBase", "🛰", "BIGGER BASE", (70, 120, 255)),
        ("speedyThief", "👟", "SPEEDY THIEF", (255, 120, 40)),
        ("vip", "👑", "VIP", (170, 90, 255)),
        ("cashSmall", "💵", "+10 MIN", (60, 200, 110)),
        ("cashLarge", "💎", "+2 HOURS", (0, 180, 230)),
        ("shield", "🛡", "SHIELD", (80, 140, 255)),
        ("luck", "🍀", "SERVER LUCK", (60, 200, 80)),
    ]),
    "anomaly-shift": ("hero1.png", [
        ("coins2x", "💰", "2x COINS", (230, 170, 30)),
        ("lucky", "🍀", "LUCKY BADGE", (50, 190, 90)),
        ("radar", "🛰", "RADAR PRO", (60, 140, 255)),
        ("revive", "💫", "2ND CHANCE", (170, 90, 255)),
        ("radar3", "📡", "3 RADARS", (40, 170, 220)),
        ("revive3", "💫", "3 CHANCES", (220, 80, 200)),
    ]),
    "candy-garden": ("hero1.png", [
        ("sell2x", "💰", "2x SELL", (60, 190, 100)),
        ("fastgrow", "⚡", "FAST GROW", (255, 170, 30)),
        ("basket", "🧺", "BIG BASKET", (230, 120, 60)),
        ("vip", "⭐", "VIP", (170, 90, 255)),
        ("restock", "🌱", "RESTOCK", (60, 180, 90)),
        ("growall", "✨", "GROW ALL", (255, 110, 190)),
        ("weather", "🌈", "WEATHER", (80, 160, 255)),
    ]),
}


def background(shot: Image.Image, color, seed: int) -> Image.Image:
    # square crop from the shot, shifted per icon so they don't all look identical
    w, h = shot.size
    side = min(w, h)
    x = int((w - side) * ((seed * 0.37) % 1))
    bg = shot.crop((x, 0, x + side, side)).resize((S, S), Image.LANCZOS)
    bg = bg.filter(ImageFilter.GaussianBlur(9)).convert("RGB")
    bg = Image.blend(bg, Image.new("RGB", (S, S), color), 0.62)
    # white glow behind the emoji
    glow = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(glow)
    for r in range(260, 0, -4):
        d.ellipse((S / 2 - r, S / 2 - 60 - r, S / 2 + r, S / 2 - 60 + r), fill=int(170 * (1 - r / 260) ** 1.6))
    bg = Image.composite(Image.new("RGB", (S, S), (255, 255, 255)), bg, glow)
    # darker edges
    vig = Image.new("L", (S, S), 150)
    d = ImageDraw.Draw(vig)
    for r in range(362, 200, -3):
        d.ellipse((S / 2 - r, S / 2 - r, S / 2 + r, S / 2 + r), fill=int(150 * ((r - 200) / 162) ** 2))
    return Image.composite(Image.new("RGB", (S, S), tuple(int(c * 0.35) for c in color)), bg, vig)


def emoji(ch: str, size: int) -> Image.Image:
    f = ImageFont.truetype(EMOJI_FONT, 109)
    im = Image.new("RGBA", (160, 160), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((80, 80), ch, font=f, embedded_color=True, anchor="mm")
    im = im.crop(im.getbbox())
    k = size / max(im.size)
    return im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)


def label(img: Image.Image, text: str, color):
    d = ImageDraw.Draw(img)
    size = 96
    while True:
        f = ImageFont.truetype(FREDOKA, size)
        l, t, r, b = d.textbbox((0, 0), text, font=f, stroke_width=10)
        if r - l <= 390 or size <= 40:
            break
        size -= 4
    stroke = tuple(int(c * 0.3) for c in color)
    d.text((S / 2, 392), text, font=f, anchor="mm", fill=(255, 255, 255), stroke_width=10, stroke_fill=stroke)


def make(game: str, shot_name: str, items):
    shot = Image.open(ROOT / "games" / game / "marketing" / shot_name)
    out = ROOT / "games" / game / "marketing" / "icons"
    out.mkdir(exist_ok=True)
    paths = []
    for i, (key, ch, text, color) in enumerate(items):
        img = background(shot, color, i + 1).convert("RGBA")
        e = emoji(ch, 250)
        # soft drop shadow
        sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
        alpha = e.split()[3].point(lambda a: int(a * 0.45))
        sh.paste((0, 0, 0, 255), (int(S / 2 - e.width / 2) + 8, 196 - e.height // 2 + 12), alpha)
        img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(10)))
        img.alpha_composite(e, (int(S / 2 - e.width / 2), 196 - e.height // 2))
        img = img.convert("RGB")
        label(img, text, color)
        p = out / f"{key}.png"
        img.save(p)
        paths.append(p)
    return paths


if __name__ == "__main__":
    assert FREDOKA, "FredokaOne font not found in the Vinegar Studio install"
    all_paths = []
    for game, (shot, items) in GAMES.items():
        all_paths += make(game, shot, items)
    # contact sheet for review
    cols = 7
    thumb = 180
    rows = (len(all_paths) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * thumb, rows * thumb), (30, 30, 30))
    for i, p in enumerate(all_paths):
        sheet.paste(Image.open(p).resize((thumb, thumb), Image.LANCZOS), ((i % cols) * thumb, (i // cols) * thumb))
    sheet_path = ROOT / "build" / "icons-sheet.png"
    sheet.save(sheet_path)
    print(len(all_paths), "icons;", "sheet:", sheet_path)
