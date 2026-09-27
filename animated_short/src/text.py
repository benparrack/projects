"""Title and credit cards, rendered once with PIL into RGBA images (full output frame)."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FONT = "/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf"


def _font(size, weight):
    f = ImageFont.truetype(FONT, size)
    f.set_variation_by_axes([100, weight])
    return f


def _spaced(draw, cx, y, text, font, tracking, fill):
    widths = [draw.textlength(c, font=font) for c in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = cx - total / 2
    for c, w in zip(text, widths):
        draw.text((x, y), c, font=font, fill=fill)
        x += w + tracking


def card(name, W, H):
    s = H / 1080.0
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    warm = (255, 222, 190, 255)
    soft = (205, 205, 215, 255)
    if name == "title":
        f = _font(int(92 * s), 200)
        _spaced(d, W / 2, H / 2 - 62 * s, "LANTERN", f, 38 * s, warm)
        # soft glow under the title
        glow = img.filter(ImageFilter.GaussianBlur(18 * s))
        img = Image.alpha_composite(glow, img)
    elif name == "credits":
        f1 = _font(int(64 * s), 200)
        f2 = _font(int(30 * s), 300)
        f3 = _font(int(22 * s), 300)
        _spaced(d, W / 2, H / 2 - 150 * s, "LANTERN", f1, 26 * s, warm)
        _spaced(d, W / 2, H / 2 - 10 * s, "Written, directed, animated and scored by Claude", f2, 1.5 * s, soft)
        _spaced(d, W / 2, H / 2 + 62 * s, "Every frame and every sound generated in code", f3, 3 * s, (150, 150, 165, 255))
    return img
