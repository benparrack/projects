"""data/posts.jsonl → data/tags.jsonl: a one-line summary, topic and "why saved" guess per post,
from the local Qwen model clip-studio already has (GPU, free, offline). Resumable.
  ../../money/clip-studio/.venv/bin/python summarize.py [--limit N]"""

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "money", "clip-studio"))
from app import llm  # noqa: E402 - needs the path above

DATA = os.path.join(HERE, "data")
OUT = os.path.join(DATA, "tags.jsonl")
BATCH = 10
INTENTS = ["learn", "try", "inspiration", "funny", "music", "buy", "place", "relatable", "other"]

SYSTEM = f"""You tag someone's saved Instagram posts so they can finally sort through them.
For each post you get the account, caption and hashtags (the video itself isn't available).
Return per post:
- summary: what the post is about, max 15 words, concrete (name the recipe, song, exercise, tool...)
- topic: a short broad topic, 1-3 words, lowercase (e.g. cooking, guitar, fitness, coding, film,
  history, sports, memes, music, travel, fashion, science, business, art, relationships, self improvement)
- intent: why they most likely saved it, one of {INTENTS}
If the caption says almost nothing, guess from the account name and hashtags, and keep the summary vague."""


def prompt(batch):
    lines = []
    for i, p in enumerate(batch, 1):
        cap = " ".join(p["caption"].split())[:600] or "(no caption)"
        tags = " ".join("#" + h for h in p["hashtags"][:10])
        lines.append(f"[{i}] @{p['owner']} ({p['name']}): {cap} {tags}")
    return "\n".join(lines) + "\n/no_think"


def main():
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    posts = [json.loads(line) for line in open(os.path.join(DATA, "posts.jsonl"))]
    done = set()
    if os.path.exists(OUT):
        done = {json.loads(line)["url"] for line in open(OUT)}
    todo = [p for p in posts if p["url"] not in done][:limit]
    print(f"{len(todo)} to tag ({len(done)} already done)")
    example = {"posts": [{"i": 1, "summary": "...", "topic": "...", "intent": INTENTS[0]}]}
    start = time.time()
    with open(OUT, "a") as out:
        for b in range(0, len(todo), BATCH):
            batch = todo[b:b + BATCH]
            try:
                got = {r.get("i"): r for r in llm.ask_json(SYSTEM, prompt(batch), example)["posts"]}
            except Exception as e:  # noqa: BLE001 - bad JSON from the model: retry this batch on the next run
                print(f"  batch at {b} failed: {e}")
                continue
            for i, p in enumerate(batch, 1):
                r = got.get(i)
                if r:  # posts the model skipped stay untagged and get retried next run
                    out.write(json.dumps({"url": p["url"], "summary": r.get("summary", ""),
                                          "topic": str(r.get("topic", "")).lower().strip(),
                                          "intent": r.get("intent", "other")}, ensure_ascii=False) + "\n")
            out.flush()
            n = b + len(batch)
            eta = (time.time() - start) / n * (len(todo) - n) / 60
            print(f"{n}/{len(todo)}  ~{eta:.0f} min left")


if __name__ == "__main__":
    main()
