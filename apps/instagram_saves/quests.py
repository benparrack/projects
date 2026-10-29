"""data/tags.jsonl → data/quests.jsonl: for every post saved to learn/try/buy/visit, pull out the one
concrete thing to do (song to play, recipe, exercise, title to watch...). Local Qwen, resumable.
  ../../money/clip-studio/.venv/bin/python quests.py [--limit N]"""

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "money", "clip-studio"))
from app import llm  # noqa: E402 - needs the path above

DATA = os.path.join(HERE, "data")
OUT = os.path.join(DATA, "quests.jsonl")
BATCH = 10
KINDS = ["song", "recipe", "exercise", "watch", "skill", "gear", "place", "none"]
DOABLE = {"learn", "try", "buy", "place", "music", "watch", "recommendation"}

SYSTEM = f"""Someone saved these Instagram posts meaning to act on them. For each post, name the ONE
concrete thing they'd do. Return per post:
- kind: one of {KINDS}
  song = a song to learn on an instrument; recipe = a dish to cook; exercise = a workout move or routine;
  watch = a film, show, anime, book or video to watch/read; skill = a technique to practise (drawing,
  coding, editing, a life skill...); gear = a product to buy; place = somewhere to go; none = nothing concrete
- item: a short canonical name, max 6 words, so duplicates match: "Song - Artist" for songs,
  the dish name, the exercise name, the exact title, the technique, the product, the place.
  Use the real name if the caption gives it, never invent one; if it's not named, kind is none.
- tip: max 12 words, what exactly to do or what's special about it."""


def prompt(batch):
    lines = []
    for i, (p, t) in enumerate(batch, 1):
        cap = " ".join(p["caption"].split())[:500] or "(no caption)"
        lines.append(f"[{i}] @{p['owner']}: {t['summary']} | caption: {cap}")
    return "\n".join(lines) + "\n/no_think"


def main():
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    posts = {json.loads(line)["url"]: json.loads(line) for line in open(os.path.join(DATA, "posts.jsonl"))}
    tags = [json.loads(line) for line in open(os.path.join(DATA, "tags.jsonl"))]
    done = {json.loads(line)["url"] for line in open(OUT)} if os.path.exists(OUT) else set()
    todo = [(posts[t["url"]], t) for t in tags if t["intent"] in DOABLE and t["url"] not in done][:limit]
    print(f"{len(todo)} to read ({len(done)} already done)", flush=True)
    example = {"posts": [{"i": 1, "kind": KINDS[0], "item": "...", "tip": "..."}]}
    start = time.time()
    with open(OUT, "a") as out:
        for b in range(0, len(todo), BATCH):
            batch = todo[b:b + BATCH]
            try:
                got = {r.get("i"): r for r in llm.ask_json(SYSTEM, prompt(batch), example)["posts"]}
            except Exception as e:  # noqa: BLE001 - bad JSON from the model: retry this batch on the next run
                print(f"  batch at {b} failed: {e}", flush=True)
                continue
            for i, (p, _) in enumerate(batch, 1):
                r = got.get(i)
                if r:
                    kind = r.get("kind") if r.get("kind") in KINDS else "none"
                    out.write(json.dumps({"url": p["url"], "kind": kind, "item": str(r.get("item", "")).strip(),
                                          "tip": str(r.get("tip", "")).strip()}) + "\n")
            out.flush()
            n = b + len(batch)
            print(f"{n}/{len(todo)}  ~{(time.time() - start) / n * (len(todo) - n) / 60:.0f} min left", flush=True)


if __name__ == "__main__":
    main()
