"""Post title, caption and hashtags for a clip: Claude when ANTHROPIC_API_KEY
is set (cheap Haiku call), otherwise a local keyword-based version."""

import json
import re
from collections import Counter

from .. import store
from ..finder import claude_available

STOP = set("""about above after again against all also always am an and any are aren't as at be because been before
being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during
each even ever every few for from further get gets getting go going gonna got gotta had hadn't has hasn't have
haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in
into is isn't it it's its itself just know kind let's like literally little lot make many maybe me mean might more
most much must my myself need never no nor not now of off oh okay on once one only or other ought our ours
ourselves out over own people pretty probably put really right said same say says see she she'd she'll she's should
shouldn't so some something still such sure take than that that's the their theirs them themselves then there
there's these they they'd they'll they're they've thing things think this those though through to too two under
until up us very want wanna was wasn't way we we'd we'll we're we've well were weren't what what's when when's
where where's which while who who's whom why why's will with won't would wouldn't yeah yes you you'd you'll you're
you've your yours yourself yourselves actually basically gonna stuff guys guy okay right three thing
come came look looks looking good great back time ready give gave went tell told keep feel felt done made
love find found start started work works call called first last next year years day days around another
takes take taking sometimes everyone everything someone something anything nothing""".split())


def clip_text(pid, clip):
    ed = clip.get("edit", clip)
    words = (store.get_transcript(pid) or {}).get("words", [])
    return " ".join(w["w"] for w in words if ed["start"] <= w["s"] < ed["end"]).strip()


def _clean_title(t):
    t = re.sub(r"\s+", " ", (t or "").strip().strip("\"'“”")).rstrip(",;:")
    return t[:1].upper() + t[1:] if t else t


def local(pid, clip, base_tags=()):
    text = clip_text(pid, clip)
    hook = _clean_title(clip.get("hook") or "")
    title = hook if 8 <= len(hook) <= 90 and not hook.endswith(("…", "...")) else ""
    if not title:  # hook/title were cut off — use the clip's opening sentence instead
        first = re.split(r"(?<=[.!?])\s", text, maxsplit=1)[0]
        if len(first) > 90:
            first = first[:90].rsplit(" ", 1)[0] + "…"
        title = _clean_title(first) or _clean_title(clip.get("title") or "")
    raw = text.split()
    cnt, proper = Counter(), set()
    for i, w in enumerate(raw):
        t = re.sub(r"[^\w]", "", w.lower())
        if "'" in w or "’" in w or len(t) < 4 or t in STOP or t.isdigit() or t.endswith("ly"):
            continue
        cnt[t] += 1
        if w[:1].isupper() and i and not raw[i - 1].endswith((".", "!", "?")):
            proper.add(t)  # capitalised mid-sentence → likely a name/topic
    keys = sorted(cnt, key=lambda t: (t in proper, cnt[t], len(t)), reverse=True)[:3]
    tags = []
    for t in list(keys) + [t.lstrip("#").lower() for t in base_tags]:
        if t and t not in tags:
            tags.append(t)
    return {"title": title[:100], "text": title, "hashtags": tags[:8]}


def with_claude(pid, clip, base_tags=(), source=""):
    import anthropic
    text = clip_text(pid, clip)[:6000]
    ask = (f"Write the post for this short-form vertical clip (TikTok / YouTube Shorts / Reels)."
           f"\nSource video: {source}\nClip title so far: {clip.get('title', '')}\nTranscript:\n{text}\n\n"
           "Reply with ONLY a JSON object: {\"title\": <punchy curiosity-driven title, max 70 chars, no hashtags>, "
           "\"text\": <1-2 sentence caption that makes people watch to the end, may use 1 emoji>, "
           "\"hashtags\": [<3-5 relevant lowercase hashtags without #, specific to the topic>]}")
    resp = anthropic.Anthropic().messages.create(model="claude-haiku-4-5-20251001", max_tokens=600,
                                                 messages=[{"role": "user", "content": ask}])
    raw = next(b.text for b in resp.content if b.type == "text")
    d = json.loads(re.search(r"\{.*\}", raw, re.S).group(0))
    tags = [re.sub(r"[^\w]", "", str(t).lstrip("#").lower()) for t in d.get("hashtags", [])]
    for t in base_tags:
        t = t.lstrip("#").lower()
        if t and t not in tags:
            tags.append(t)
    return {"title": _clean_title(d["title"])[:100], "text": str(d.get("text", "")).strip(), "hashtags": [t for t in tags if t][:8]}


def generate(pid, clip, base_tags=(), engine="auto"):
    if engine in ("auto", "claude") and claude_available():
        try:
            p = store.get_project(pid) or {}
            return {**with_claude(pid, clip, base_tags, p.get("name", "")), "engine": "claude"}
        except Exception as e:  # noqa: BLE001 - fall back to local
            print("caption: Claude failed:", e)
    return {**local(pid, clip, base_tags), "engine": "local"}
