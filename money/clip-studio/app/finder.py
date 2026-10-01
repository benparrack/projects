"""Finds the moments worth clipping. Two engines:

- "local": scores every sentence-aligned window in the length range on hook
  strength, vocal energy, pacing, emotional language, dead air and whether it
  is a complete thought, then keeps the best non-overlapping windows.
- "claude": hands the sentence-numbered transcript to Claude and asks it to
  pick the moments (needs ANTHROPIC_API_KEY); falls back to "local" on error.

Both return the same clip dicts: start/end snapped to word boundaries, a
0-100 virality score, a title, a hook line and the reasons behind the score.
"""

import os
import re

import numpy as np

CONJ = {"and", "but", "so", "because", "or", "which", "that", "then", "also", "um", "uh", "like"}
HOOK_PATTERNS = [
    r"^(here'?s|this is) (why|how|what|the)", r"\bthe (secret|truth|problem|reason|key|biggest)\b",
    r"^(nobody|no one|everyone|most people)\b", r"^(stop|never|don'?t)\b", r"^(why|how|what if|imagine)\b",
    r"\byou (need|have to|should|won'?t|will never)\b", r"\b(mistake|lesson|rule|trick|hack)s?\b",
    r"^i (never|almost|got|lost|made|quit|realized)\b", r"\b\d+(k|%| percent| million| thousand| dollars| years)?\b",
]
EMOTION = set("""crazy insane wild love hate never always best worst money million billion dead died
shocking shocked scared afraid honestly literally secret actually amazing incredible terrible horrible
unbelievable genius stupid destroyed broke rich fired quit lost won crying cried laughed angry mad
huge massive biggest everything nothing impossible ridiculous perfect beautiful disgusting brutal
""".split())
FILLERS = {"um", "uh", "uhm", "umm", "erm", "er", "ah", "hmm", "mm", "mhm"}


def norm(w):
    return re.sub(r"[^\w']", "", w.lower())


def sentences(words):
    """Groups words into sentences on end punctuation, long pauses or length."""
    out, cur = [], []
    for i, w in enumerate(words):
        if cur and (w["s"] - words[i - 1]["e"] > 1.2 or len(cur) >= 45):
            out.append(cur)
            cur = []
        cur.append(i)
        if re.search(r"[.?!]['\"]?$", w["w"]):
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return [{"i0": s[0], "i1": s[-1], "s": words[s[0]]["s"], "e": words[s[-1]]["e"],
             "text": " ".join(words[i]["w"] for i in s)} for s in out]


def _title_from(text, n=9):
    t = re.sub(r"\b(um|uh|uhm|like,|you know,|i mean,)\s*", "", text, flags=re.I).strip()
    t = re.sub(r"^(and|but|so|okay|ok|yeah|well|right)[, ]+", "", t, flags=re.I).strip(" -,.")
    words = t.split()
    t = " ".join(words[:n]) + ("…" if len(words) > n else "")
    return (t[:1].upper() + t[1:]) if t else "Untitled clip"


def _hook(sents, a, b):
    """Best on-screen hook from inside the clip: a short complete sentence
    (questions and charged words win), else the opening clause."""
    best, best_s = None, -1e9
    for k in range(a, min(b, a + 6) + 1):
        t = _title_from(sents[k]["text"], 99)
        n = len(t.split())
        if not 3 <= n <= 10:
            continue
        low = t.lower()
        sc = (1.5 if t.endswith("?") else 0) + (0.8 if t.endswith("!") else 0)
        sc += 0.7 * sum(1 for w in EMOTION if w in low) - 0.25 * (k - a) - 0.05 * abs(n - 7)
        if sc > best_s:
            best, best_s = t, sc
    if best:
        return best
    first = _title_from(sents[a]["text"], 99)
    clause = re.split(r"(?<=[,;:])\s", first)[0].rstrip(",;:")
    return clause if 3 <= len(clause.split()) <= 9 else _title_from(sents[a]["text"], 7)


def _features(words, sents, a, b, env, hop, gmed, gstd, grate):
    s, e = sents[a]["s"], sents[b]["e"]
    dur = max(0.1, e - s)
    ws = words[sents[a]["i0"]: sents[b]["i1"] + 1]
    toks = [norm(w["w"]) for w in ws]
    first = sents[a]["text"].strip()
    first_l = first.lower()
    f = {}
    seg = env[int(s / hop): max(int(s / hop) + 1, int(e / hop))]
    f["energy"] = float((np.mean(seg) - gmed) / gstd) if len(seg) else 0.0
    f["peaks"] = float((np.percentile(seg, 95) - gmed) / gstd) if len(seg) else 0.0
    f["pace"] = (len(ws) / dur) / grate - 1
    gaps = sum(max(0.0, ws[k + 1]["s"] - ws[k]["e"] - 0.6) for k in range(len(ws) - 1))
    f["dead_air"] = gaps / dur
    hook = sum(1 for p in HOOK_PATTERNS if re.search(p, first_l))
    hook += 1.0 if first.endswith("?") else 0
    hook += 0.4 if re.search(r"\byou\b", first_l) else 0
    hook += 0.4 if len(first.split()) <= 14 else -0.3
    f["hook"] = hook
    f["emotion"] = sum(1 for t in toks if t in EMOTION) / max(1, len(toks)) * 20
    f["excite"] = sum(1 for w in ws if w["w"].endswith("!")) + 2 * sum(1 for t in toks if t.startswith("haha"))
    starts_bad = (toks and toks[0] in CONJ) or not first[:1].isupper()
    f["complete"] = (0.8 if re.search(r"[.?!]['\"]?$", ws[-1]["w"]) else -0.6) + (-0.8 if starts_bad else 0.4)
    f["fillers"] = sum(1 for t in toks if t in FILLERS) / max(1, len(toks)) * 10
    return f, s, e


WEIGHTS = {"energy": 0.9, "peaks": 0.5, "pace": 1.2, "dead_air": -4.0, "hook": 1.1,
           "emotion": 0.8, "excite": 0.3, "complete": 1.0, "fillers": -0.8}


def _reasons(f):
    r = []
    if f["hook"] >= 1.4:
        r.append("Strong opening hook")
    if f["energy"] > 0.35 or f["peaks"] > 1.0:
        r.append("High vocal energy")
    if f["pace"] > 0.1:
        r.append("Fast, punchy delivery")
    if f["emotion"] > 0.8 or f["excite"] >= 1:
        r.append("Emotional / charged language")
    if f["complete"] > 1:
        r.append("Complete standalone thought")
    if f["dead_air"] < 0.03:
        r.append("No dead air")
    return r or ["Solid talking segment"]


def find_local(words, wav_env, min_len, max_len, count, focus=""):
    env, hop = wav_env
    sents = sentences(words)
    if not sents:
        return []
    gmed, gstd = float(np.median(env)), float(np.std(env) or 1.0)
    grate = len(words) / max(1.0, sum(s["e"] - s["s"] for s in sents)) or 2.5
    focus_terms = [norm(t) for t in focus.split() if len(t) > 2]
    cands = []
    for a in range(len(sents)):
        for b in range(a, len(sents)):
            dur = sents[b]["e"] - sents[a]["s"]
            if dur > max_len:
                break
            if dur < min_len:
                continue
            f, s, e = _features(words, sents, a, b, env, hop, gmed, gstd, grate)
            score = sum(WEIGHTS[k] * v for k, v in f.items())
            if focus_terms:
                text = " ".join(x["text"].lower() for x in sents[a:b + 1])
                score += 1.5 * sum(1 for t in focus_terms if t in text)
            cands.append((score, a, b, s, e, f))
    if not cands:  # whole video shorter than min_len: one clip of everything
        f, s, e = _features(words, sents, 0, len(sents) - 1, env, hop, gmed, gstd, grate)
        cands = [(0.0, 0, len(sents) - 1, s, e, f)]
    scores = np.array([c[0] for c in cands])
    mu, sd = float(scores.mean()), float(scores.std() or 1.0)
    cands.sort(key=lambda c: c[0], reverse=True)
    picked = []
    for c in cands:
        if all(min(c[4], p[4]) - max(c[3], p[3]) < 0.25 * min(c[4] - c[3], p[4] - p[3]) for p in picked):
            picked.append(c)
        if len(picked) >= count:
            break
    out = []
    for score, a, b, s, e, f in picked:
        z = max(0.0, (score - mu) / sd)
        out.append({
            "start": round(max(0, s - 0.05), 3), "end": round(e + 0.15, 3),
            "score": int(round(40 + 59 * (1 - np.exp(-z / 1.8)))),
            "title": _title_from(sents[a]["text"]),
            "hook": _hook(sents, a, b),
            "reasons": _reasons(f),
        })
    return out


SYSTEM = """You are an expert short-form video editor who finds the moments in long videos that will perform as viral TikTok / YouTube Shorts / Reels clips.

A great clip:
- grabs attention in the first 2-3 seconds (a bold claim, a question, a surprising statement, conflict, or a story opener),
- is a complete, self-contained thought or story that makes sense with no outside context,
- has a payoff (punchline, insight, reveal, emotional peak) before it ends,
- avoids starting mid-sentence or ending before the point lands.

You get a transcript split into numbered sentences with timestamps. Pick clips by sentence numbers (inclusive). Respect the requested length range strictly. Clips must not overlap. Rank the best first. The score is your honest 0-100 estimate of viral potential. Titles are short, punchy, curiosity-driven (no clickbait lies, no hashtags). The hook is an on-screen text line (max ~8 words) shown at the start of the clip."""

SCHEMA = {
    "type": "object",
    "properties": {"clips": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "start_sentence": {"type": "integer"}, "end_sentence": {"type": "integer"},
            "title": {"type": "string"}, "hook": {"type": "string"},
            "score": {"type": "integer"}, "reason": {"type": "string"},
        },
        "required": ["start_sentence", "end_sentence", "title", "hook", "score", "reason"],
        "additionalProperties": False,
    }}},
    "required": ["clips"],
    "additionalProperties": False,
}


def claude_available():
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
                or os.path.isdir(os.path.expanduser("~/.config/anthropic")))


def find_claude(words, min_len, max_len, count, focus=""):
    import json
    import anthropic

    sents = sentences(words)
    lines = [f"[{i}] ({s['s']:.1f}s-{s['e']:.1f}s) {s['text']}" for i, s in enumerate(sents)]
    ask = (f"Find the {count} best clips, each between {min_len} and {max_len} seconds long."
           + (f"\nPrioritise moments about: {focus}" if focus.strip() else "")
           + "\n\nTranscript:\n" + "\n".join(lines))
    client = anthropic.Anthropic()
    resp = client.beta.messages.create(
        model="claude-opus-5-5",
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
        system=SYSTEM,
        messages=[{"role": "user", "content": ask}],
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError("Claude declined this transcript")
    text = next(b.text for b in resp.content if b.type == "text")
    out = []
    for c in json.loads(text)["clips"]:
        a = max(0, min(len(sents) - 1, c["start_sentence"]))
        b = max(a, min(len(sents) - 1, c["end_sentence"]))
        while b > a and sents[b]["e"] - sents[a]["s"] > max_len * 1.15:
            b -= 1
        s, e = sents[a]["s"], sents[b]["e"]
        if any(min(e, o["end"]) - max(s, o["start"]) > 1 for o in out):
            continue
        out.append({"start": round(max(0, s - 0.05), 3), "end": round(e + 0.15, 3),
                    "score": max(1, min(99, int(c["score"]))), "title": c["title"].strip(),
                    "hook": c["hook"].strip(), "reasons": [c["reason"].strip()]})
    return out[:count]
