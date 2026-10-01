"""A clip's edit state and everything derived from it:

- default_edit(): the editable settings a fresh clip starts with
- timeline(): which source ranges survive the cuts (deleted words, removed
  filler words, trimmed silences) and how source time maps to output time
- layout(): word-by-word caption positions, hook title and watermark,
  measured with the real font files so the browser preview (which draws this
  same layout) matches the render
- to_ass(): turns the layout into an .ass subtitle file libass burns in
"""

import re
import struct
from functools import lru_cache

from PIL import ImageFont

from . import store
from .finder import FILLERS, norm

ASPECTS = {"9:16": (1080, 1920), "1:1": (1080, 1080), "4:5": (1080, 1350), "16:9": (1920, 1080)}

# file -> (ASS font name libass resolves it by, css family used by the editor)
FONTS = {
    "Poppins-Black.ttf": ("Poppins Black", "cs-poppins-black"),
    "Poppins-ExtraBold.ttf": ("Poppins ExtraBold", "cs-poppins-xbold"),
    "Poppins-SemiBold.ttf": ("Poppins SemiBold", "cs-poppins-semibold"),
    "Anton-Regular.ttf": ("Anton", "cs-anton"),
    "Bangers-Regular.ttf": ("Bangers", "cs-bangers"),
    "BebasNeue-Regular.ttf": ("Bebas Neue", "cs-bebas"),
    "ArchivoBlack-Regular.ttf": ("Archivo Black", "cs-archivo"),
    "LuckiestGuy-Regular.ttf": ("Luckiest Guy", "cs-luckiest"),
}

PRESETS = {
    "bold-pop": {"name": "Bold Pop", "font": "Poppins-Black.ttf", "size": 78, "upper": True, "color": "#FFFFFF",
                 "active": "#FFE600", "box": "", "outline": "#000000", "outlineW": 9, "shadow": 4,
                 "words": 3, "lines": 1, "y": 0.66, "anim": "pop"},
    "green-punch": {"name": "Green Punch", "font": "Anton-Regular.ttf", "size": 96, "upper": True, "color": "#FFFFFF",
                    "active": "#39FF5A", "box": "", "outline": "#000000", "outlineW": 8, "shadow": 6,
                    "words": 2, "lines": 1, "y": 0.64, "anim": "pop"},
    "highlight-box": {"name": "Highlight Box", "font": "Poppins-ExtraBold.ttf", "size": 68, "upper": False,
                      "color": "#FFFFFF", "active": "#FFFFFF", "box": "#7C3AED", "outline": "#000000",
                      "outlineW": 6, "shadow": 0, "words": 4, "lines": 2, "y": 0.66, "anim": "pop"},
    "karaoke": {"name": "Karaoke", "font": "ArchivoBlack-Regular.ttf", "size": 64, "upper": True, "color": "#FFFFFF",
                "active": "#22D3EE", "box": "", "outline": "#000000", "outlineW": 7, "shadow": 3,
                "words": 5, "lines": 2, "y": 0.68, "anim": "none"},
    "comic": {"name": "Comic", "font": "Bangers-Regular.ttf", "size": 92, "upper": True, "color": "#FFF7D6",
              "active": "#FF3B3B", "box": "", "outline": "#111111", "outlineW": 10, "shadow": 6,
              "words": 3, "lines": 1, "y": 0.64, "anim": "bounce"},
    "reveal": {"name": "Word Reveal", "font": "LuckiestGuy-Regular.ttf", "size": 76, "upper": True,
               "color": "#FFFFFF", "active": "#FF9F1C", "box": "", "outline": "#000000", "outlineW": 8,
               "shadow": 4, "words": 4, "lines": 2, "y": 0.66, "anim": "reveal"},
    "one-word": {"name": "One Word", "font": "BebasNeue-Regular.ttf", "size": 150, "upper": True,
                 "color": "#FFFFFF", "active": "#FFFFFF", "box": "", "outline": "#000000", "outlineW": 10,
                 "shadow": 6, "words": 1, "lines": 1, "y": 0.62, "anim": "pop"},
    "minimal": {"name": "Minimal", "font": "Poppins-SemiBold.ttf", "size": 52, "upper": False, "color": "#FFFFFF",
                "active": "#FFFFFF", "box": "", "outline": "#000000", "outlineW": 0, "shadow": 5,
                "words": 7, "lines": 2, "y": 0.74, "anim": "none"},
}

HOOK_STYLES = {
    "white-box": {"font": "Poppins-ExtraBold.ttf", "color": "#111111", "box": "#FFFFFF", "outline": "", "outlineW": 0},
    "black-box": {"font": "Poppins-ExtraBold.ttf", "color": "#FFFFFF", "box": "#111111", "outline": "", "outlineW": 0},
    "red-box": {"font": "Poppins-ExtraBold.ttf", "color": "#FFFFFF", "box": "#E11D48", "outline": "", "outlineW": 0},
    "yellow-text": {"font": "Anton-Regular.ttf", "color": "#FFE600", "box": "", "outline": "#000000", "outlineW": 8},
}


def default_edit(clip):
    cap = dict(PRESETS["bold-pop"])
    cap.pop("name")
    return {
        "start": clip["start"], "end": clip["end"],
        "captions": {"enabled": True, "preset": "bold-pop", **cap},
        "hook": {"enabled": True, "text": clip.get("hook", ""), "duration": 3.0, "style": "white-box",
                 "size": 58, "y": 0.17},
        "layout": {"mode": "fill", "aspect": "9:16", "zoom": 1.0, "offset": 0.0, "fitY": 0.5},
        "deleted": [], "wordEdits": {}, "removeFillers": False, "removeSilences": False, "silenceGap": 0.5,
        "progress": {"enabled": False, "color": "#FFE600"},
        "watermark": {"text": ""},
        "music": {"file": "", "volume": 0.12},
    }


# ---------------------------------------------------------------- timeline

def clip_words(words, edit):
    """Global word indices whose midpoint falls inside the clip."""
    s, e = edit["start"], edit["end"]
    return [i for i, w in enumerate(words) if s <= (w["s"] + w["e"]) / 2 <= e]


def _merge(iv):
    iv = sorted(iv)
    out = []
    for a, b in iv:
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def timeline(words, edit):
    """-> {"keep": [[src_s, src_e], ...], "duration": out_seconds, "removed": [word idx...]}"""
    s, e = edit["start"], edit["end"]
    idx = clip_words(words, edit)
    deleted = set(edit.get("deleted", []))
    removed = set()
    cuts = []
    for i in idx:
        w = words[i]
        if i in deleted or (edit.get("removeFillers") and norm(w["w"]) in FILLERS):
            removed.add(i)
            cuts.append([w["s"] - 0.02, w["e"] + 0.02])
    if edit.get("removeSilences"):
        kept = [words[i] for i in idx if i not in removed]
        gap = max(0.2, float(edit.get("silenceGap", 0.5)))
        if kept:
            if kept[0]["s"] - s > gap:
                cuts.append([s, kept[0]["s"] - 0.12])
            if e - kept[-1]["e"] > gap:
                cuts.append([kept[-1]["e"] + 0.2, e])
            for a, b in zip(kept, kept[1:]):
                if b["s"] - a["e"] > gap:
                    cuts.append([a["e"] + 0.12, b["s"] - 0.08])
    keep, cur = [], s
    for a, b in _merge([[max(s, a), min(e, b)] for a, b in cuts if b > a]):
        if a > cur:
            keep.append([cur, a])
        cur = max(cur, b)
    if e > cur:
        keep.append([cur, e])
    keep = [[round(a, 3), round(b, 3)] for a, b in keep if b - a >= 0.1] or [[s, e]]
    return {"keep": keep, "duration": round(sum(b - a for a, b in keep), 3), "removed": sorted(removed)}


def src_to_out(keep, t):
    acc = 0.0
    for a, b in keep:
        if t < a:
            return acc
        if t <= b:
            return acc + t - a
        acc += b - a
    return acc


def out_words(words, edit, tl):
    removed = set(tl["removed"])
    upper = edit["captions"].get("upper")
    out = []
    for i in clip_words(words, edit):
        if i in removed:
            continue
        w = words[i]
        text = edit.get("wordEdits", {}).get(str(i), w["w"])
        if not text.strip():
            continue
        if upper:
            text = text.upper()
        s, e = src_to_out(tl["keep"], w["s"]), src_to_out(tl["keep"], w["e"])
        out.append({"i": i, "w": text, "s": round(s, 3), "e": round(max(e, s + 0.05), 3)})
    return out


# ---------------------------------------------------------------- layout

@lru_cache(maxsize=64)
def _font(file, em):
    return ImageFont.truetype(f"{store.FONTS}/{file}", em)


@lru_cache(maxsize=None)
def _win_metrics(file):
    """(usWinAscent, usWinDescent, unitsPerEm). libass scales a font so that
    \\fs equals winAscent+winDescent (not the hhea metrics PIL reports), and
    centres \\an5 lines on that box, so both size and baseline come from here."""
    d = open(f"{store.FONTS}/{file}", "rb").read()
    tables = {}
    for i in range(struct.unpack(">H", d[4:6])[0]):
        tag, _, off, _ = struct.unpack(">4sIII", d[12 + 16 * i:28 + 16 * i])
        tables[tag] = off
    upm = struct.unpack(">H", d[tables[b"head"] + 18:tables[b"head"] + 20])[0]
    wa, wd = struct.unpack(">HH", d[tables[b"OS/2"] + 74:tables[b"OS/2"] + 78])
    return wa, wd, upm


def font_meta(file, em):
    f = _font(file, em)
    wa, wd, upm = _win_metrics(file)
    return {"file": file, "css": FONTS[file][1], "ass": FONTS[file][0], "em": em,
            "assSize": round(em * (wa + wd) / upm, 2), "baseline": round(em * (wa - wd) / 2 / upm, 2), "space": f.getlength(" ")}


def _wrap(tokens, file, em, max_w, extra=0.0):
    """extra widens the gap between words (outlines and boxes grow each word
    outward, eating into a plain space)."""
    f = _font(file, em)
    space = f.getlength(" ") + extra
    lines, cur, cur_w = [], [], 0.0
    for t in tokens:
        tw = f.getlength(t)
        if cur and cur_w + space + tw > max_w:
            lines.append(cur)
            cur, cur_w = [], 0.0
        cur.append((t, tw))
        cur_w += (space if len(cur) > 1 else 0) + tw
    if cur:
        lines.append(cur)
    return lines, space


def _place(lines, space, W, cy, line_h):
    """Centers lines horizontally around W/2 and the block vertically on cy."""
    placed = []
    top = cy - line_h * (len(lines) - 1) / 2
    for li, line in enumerate(lines):
        total = sum(tw for _, tw in line) + space * (len(line) - 1)
        x = W / 2 - total / 2
        for t, tw in line:
            placed.append({"t": t, "x": round(x + tw / 2, 1), "y": round(top + li * line_h, 1), "w": round(tw, 1)})
            x += tw + space
    return placed


def layout(words, edit, tl):
    W, H = ASPECTS.get(edit["layout"].get("aspect", "9:16"), ASPECTS["9:16"])
    scale = W / 1080 if W <= H else H / 1080
    out = {"W": W, "H": H, "duration": tl["duration"], "phrases": [], "hook": None, "watermark": None}
    cap = edit["captions"]
    if cap.get("enabled"):
        em = max(16, int(cap["size"] * scale))
        meta = font_meta(cap["font"], em)
        out["capFont"] = meta
        max_w = W * 0.86
        line_h = em * 1.18
        gap = 2 * cap.get("outlineW", 0) * W / 1080 + (em * 0.22 if cap.get("box") else em * 0.04)
        ws = out_words(words, edit, tl)
        phrases, cur = [], []
        n = max(1, int(cap.get("words", 3)))
        max_lines = max(1, int(cap.get("lines", 1)))

        def flush():
            if cur:
                phrases.append(list(cur))
                cur.clear()

        for k, w in enumerate(ws):
            if cur:
                trial = [x["w"] for x in cur] + [w["w"]]
                too_wide = len(_wrap(trial, cap["font"], em, max_w, gap)[0]) > max_lines
                if len(cur) >= n or too_wide or w["s"] - cur[-1]["e"] > 0.6:
                    flush()
            cur.append(w)
            if re.search(r"[.?!]$", w["w"]) or (w["w"].endswith(",") and len(cur) >= 2):
                flush()
        flush()
        cy = H * float(cap.get("y", 0.66))
        for pi, ph in enumerate(phrases):
            lines, space = _wrap([w["w"] for w in ph], cap["font"], em, max_w, gap)
            placed = _place(lines, space, W, cy, line_h)
            ps = ph[0]["s"]
            pe = ph[-1]["e"] + 0.35
            if pi + 1 < len(phrases):
                pe = min(pe, phrases[pi + 1][0]["s"])
            pe = max(pe, ph[-1]["e"])
            pw = []
            for k, (w, p) in enumerate(zip(ph, placed)):
                act_end = ph[k + 1]["s"] if k + 1 < len(ph) else pe
                pw.append({**p, "s": w["s"], "e": round(max(act_end, w["s"] + 0.05), 3), "i": w["i"]})
            out["phrases"].append({"s": round(ps, 3), "e": round(pe, 3), "words": pw})
    hk = edit["hook"]
    if hk.get("enabled") and hk.get("text", "").strip():
        st = HOOK_STYLES.get(hk.get("style"), HOOK_STYLES["white-box"])
        em = max(16, int(hk.get("size", 58) * scale))
        meta = font_meta(st["font"], em)
        toks = hk["text"].strip().split()
        lines, space = _wrap(toks, st["font"], em, W * 0.78)
        if len(lines) > 1:  # balance the rows: narrowest width that keeps the same line count
            lo, hi = W * 0.2, W * 0.78
            for _ in range(14):
                mid = (lo + hi) / 2
                if len(_wrap(toks, st["font"], em, mid)[0]) > len(lines):
                    lo = mid
                else:
                    hi = mid
            lines, space = _wrap(toks, st["font"], em, hi)
        line_h = em * 1.32
        placed = _place(lines, space, W, H * float(hk.get("y", 0.17)), line_h)
        rows = []
        for li, line in enumerate(lines):
            row = placed[sum(len(l) for l in lines[:li]): sum(len(l) for l in lines[:li + 1])]
            x0 = row[0]["x"] - row[0]["w"] / 2
            x1 = row[-1]["x"] + row[-1]["w"] / 2
            rows.append({"text": " ".join(r["t"] for r in row), "x": round((x0 + x1) / 2, 1),
                         "y": row[0]["y"], "w": round(x1 - x0, 1)})
        out["hook"] = {"rows": rows, "font": meta, "style": st, "lineH": line_h,
                       "duration": min(float(hk.get("duration", 3)), tl["duration"])}
    wm = edit.get("watermark", {}).get("text", "").strip()
    if wm:
        em = int(34 * scale)
        out["watermark"] = {"text": wm, "x": W / 2, "y": H * 0.93, "font": font_meta("Poppins-SemiBold.ttf", em)}
    return out


# ---------------------------------------------------------------- ASS

def _c(hexcol, alpha=0):
    h = hexcol.lstrip("#")
    return f"&H{alpha:02X}{h[4:6]}{h[2:4]}{h[0:2]}&".upper()


def _ts(t):
    t = max(0.0, t)
    cs = int(round(t * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def _rrect(w, h, r):
    r = min(r, w / 2, h / 2)
    k = r * 0.45
    return (f"m {r:.1f} 0 l {w - r:.1f} 0 b {w - k:.1f} 0 {w:.1f} {k:.1f} {w:.1f} {r:.1f} "
            f"l {w:.1f} {h - r:.1f} b {w:.1f} {h - k:.1f} {w - k:.1f} {h:.1f} {w - r:.1f} {h:.1f} "
            f"l {r:.1f} {h:.1f} b {k:.1f} {h:.1f} 0 {h - k:.1f} 0 {h - r:.1f} "
            f"l 0 {r:.1f} b 0 {k:.1f} {k:.1f} 0 {r:.1f} 0")


def escape(t):
    return t.replace("\\", "\\\\").replace("{", "(").replace("}", ")")


def to_ass(lay, edit):
    W, H = lay["W"], lay["H"]
    ev = []

    def add(layer, s, e, text):
        if e - s >= 0.01:
            ev.append(f"Dialogue: {layer},{_ts(s)},{_ts(e)},Default,,0,0,0,,{text}")

    cap = edit["captions"]
    if lay.get("phrases"):
        fm = lay["capFont"]
        base = (f"\\fn{fm['ass']}\\fs{fm['assSize']}\\b0\\bord{cap['outlineW'] * W / 1080:.1f}"
                f"\\shad{cap['shadow'] * W / 1080:.1f}\\3c{_c(cap['outline'])}\\4c&H000000&\\4a&H70&")
        anim = cap.get("anim", "pop")
        for ph in lay["phrases"]:
            for w in ph["words"]:
                pos = f"\\an5\\pos({w['x']},{w['y']})"
                txt = escape(w["t"])
                inactive = f"{{{pos}{base}\\1c{_c(cap['color'])}}}{txt}"
                if anim != "reveal":
                    add(2, ph["s"], w["s"], inactive)
                act = f"\\1c{_c(cap['active'])}"
                if anim == "pop":
                    act += "\\fscx100\\fscy100\\t(0,70,\\fscx116\\fscy116)\\t(70,150,\\fscx108\\fscy108)"
                elif anim == "bounce":
                    pos = f"\\an5\\move({w['x']},{w['y'] + 14},{w['x']},{w['y']},0,110)"
                    act += "\\fscx110\\fscy110"
                add(2, w["s"], w["e"], f"{{{pos}{base}{act}}}{txt}")
                if cap.get("box"):
                    em = lay["capFont"]["em"]
                    bw, bh = w["w"] + em * 0.36, em * 1.12
                    sc = "\\fscx100\\fscy100\\t(0,70,\\fscx108\\fscy108)\\t(70,150,\\fscx104\\fscy104)" if anim == "pop" else ""
                    add(1, w["s"], w["e"], f"{{\\an5\\pos({w['x']},{w['y']})\\bord0\\shad0\\1c{_c(cap['box'])}{sc}\\p1}}"
                                           f"{_rrect(bw, bh, em * 0.22)}{{\\p0}}")
                after = f"{{\\an5\\pos({w['x']},{w['y']}){base}\\1c{_c(cap['color'])}}}{txt}"
                add(2, w["e"], ph["e"], after)
    hk = lay.get("hook")
    if hk:
        st, fm = hk["style"], hk["font"]
        for r in hk["rows"]:
            if st.get("box"):
                bw, bh = r["w"] + fm["em"] * 0.7, hk["lineH"] * 0.98
                # soft drop shadow so a white box still reads on a white background
                add(3, 0, hk["duration"], f"{{\\an5\\pos({r['x']},{r['y']})\\bord0\\shad{6 * W / 1080:.1f}"
                                          f"\\4c&H000000&\\4a&HA0&\\1c{_c(st['box'])}"
                                          f"\\fad(0,150)\\p1}}{_rrect(bw, bh, fm['em'] * 0.25)}{{\\p0}}")
            bord = st.get("outlineW", 0) * W / 1080
            oc = f"\\3c{_c(st['outline'])}" if st.get("outline") else ""
            add(4, 0, hk["duration"], f"{{\\an5\\pos({r['x']},{r['y']})\\fn{fm['ass']}\\fs{fm['assSize']}\\b0"
                                      f"\\bord{bord:.1f}\\shad0{oc}\\1c{_c(st['color'])}\\fad(0,150)}}{escape(r['text'])}")
    wm = lay.get("watermark")
    if wm:
        fm = wm["font"]
        add(5, 0, lay["duration"], f"{{\\an5\\pos({wm['x']},{wm['y']})\\fn{fm['ass']}\\fs{fm['assSize']}\\b0"
                                   f"\\bord2\\shad0\\3c&H000000&\\1c&HFFFFFF&\\1a&H50&\\3a&H90&}}{escape(wm['text'])}")
    head = (f"[Script Info]\nScriptType: v4.00+\nPlayResX: {W}\nPlayResY: {H}\nWrapStyle: 2\n"
            "ScaledBorderAndShadow: yes\n\n[V4+ Styles]\n"
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, "
            "Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
            "Alignment, MarginL, MarginR, MarginV, Encoding\n"
            "Style: Default,Poppins Black,80,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n\n"
            "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
    return head + "\n".join(ev) + "\n"
