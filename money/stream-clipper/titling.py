"""Generates a real title/caption from what's actually said in a clip,
instead of the placeholder "<video_id> highlight #Shorts" this project
shipped with initially. Pure string logic, no network/model calls — fully
unit-tested (tests/test_titling.py).

Title quality matters more for click-through than the edit itself (people
decide whether to tap in from the title text, not the video), and it's also
where the real SEO benefit of naming a source lives — the channel name
deliberately stays generic (see README), but a video's own title can and
should name the streamer.
"""

import re

_FILLER_WORDS = {"um", "uh", "uhh", "umm", "like", "you know", "i mean"}


def _clean_transcript_text(words: list, start: float, end: float) -> str:
    """Joins the words spoken within [start, end) into plain text, stripping
    leading/trailing filler words (mid-sentence fillers are left alone —
    only the ones that'd make an ugly title opener/closer are worth the
    trouble to strip)."""
    spoken = [w["word"].strip() for w in words if w["start"] >= start and w["end"] <= end]
    while spoken and spoken[0].lower().strip(".,!?").strip() in _FILLER_WORDS:
        spoken.pop(0)
    while spoken and spoken[-1].lower().strip(".,!?").strip() in _FILLER_WORDS:
        spoken.pop()
    text = " ".join(spoken)
    text = re.sub(r"\s+([.,!?])", r"\1", text)  # "word ." -> "word."
    text = re.sub(r"\s{2,}", " ", text).strip()
    return text


def _truncate_at_word_boundary(text: str, max_length: int) -> str:
    if len(text) <= max_length:
        return text
    # Reserve 1 char for the appended ellipsis so the *returned* string
    # actually respects max_length, not just the pre-ellipsis slice.
    truncated = text[: max(1, max_length - 1)].rsplit(" ", 1)[0]
    return truncated.rstrip(".,!?") + "…"


def title_from_transcript(words: list, start: float, end: float, source_label: str = None, max_length: int = 90) -> str:
    """Builds a title from the clip's own spoken words, capped at
    max_length (YouTube's practical Shorts title sweet spot is well under
    its 100-char hard limit, so titles don't truncate in the feed).
    Prefixes with `source_label` (e.g. "Kai Cenat") when given, since that's
    real search/click-through value a generic channel name can't provide.
    Falls back to a generic title if the clip had no usable transcript text
    (e.g. mostly music/silence — see stream-clipper's own first test run)."""
    text = _clean_transcript_text(words, start, end)
    prefix = f"{source_label}: " if source_label else ""

    # Real bug caught on stream-clipper's own second test run: a clip with
    # near-silent/music-only audio can still produce whisper tokens like
    # "..." — non-empty text with no actual words, which produced titles
    # like "Kai Cenat: .... #Shorts". Treat "no letters at all" the same as
    # "no text".
    if not text or not any(c.isalpha() for c in text):
        return _truncate_at_word_boundary(f"{prefix}Highlight #Shorts", max_length)

    if text[0].islower():
        text = text[0].upper() + text[1:]

    budget = max_length - len(prefix) - len(" #Shorts")
    body = _truncate_at_word_boundary(text, max(1, budget))
    return f"{prefix}{body} #Shorts"


def caption_text(title: str, source_label: str = None, extra_hashtags: list = None) -> str:
    """Builds the video description/caption text: the title verbatim, plus a
    hashtag line below it (repeating #Shorts alongside the title's own is
    normal practice for Shorts, not a bug — both the title and description
    carry it). Kept separate from title-building so a future platform
    needing a different format (e.g. Instagram's 2200-char caption budget
    vs YouTube's ~100-char title) can reuse `title_from_transcript`'s output
    without re-deriving it."""
    hashtags = ["#Shorts", "#Reels"]
    if source_label:
        tag = "#" + re.sub(r"[^A-Za-z0-9]", "", source_label)
        if tag != "#":
            hashtags.append(tag)
    hashtags.extend(extra_hashtags or [])
    # de-dupe while preserving order
    seen = set()
    unique_hashtags = [h for h in hashtags if not (h.lower() in seen or seen.add(h.lower()))]
    return f"{title}\n\n{' '.join(unique_hashtags)}"
