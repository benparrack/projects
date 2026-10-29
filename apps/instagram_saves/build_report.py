"""posts.jsonl + tags.jsonl + categories.json → data/report.html (one self-contained page).
categories.json is hand-written: topic→category mapping, per-category write-ups, curated picks."""

import collections
import datetime
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
INTENTS = {"learn", "try", "inspiration", "funny", "music", "buy", "place", "relatable", "other"}


def main():
    posts = [json.loads(line) for line in open(os.path.join(DATA, "posts.jsonl"))]
    tags = {}
    for line in open(os.path.join(DATA, "tags.jsonl")):
        t = json.loads(line)
        tags[t["url"]] = t
    cfg = json.load(open(os.path.join(HERE, "categories.json")))
    topic_to_cat = {t: c["id"] for c in cfg["categories"] for t in c["topics"]}

    rows, unmapped = [], collections.Counter()
    for p in posts:
        t = tags.get(p["url"], {})
        topic = t.get("topic", "")
        cat = topic_to_cat.get(topic, "misc")
        if topic and cat == "misc":
            unmapped[topic] += 1
        rows.append({
            "u": p["url"].replace("https://www.instagram.com/", ""),
            "d": p["saved"], "o": p["owner"],
            "s": t.get("summary", ""), "c": " ".join(p["caption"].split())[:220],
            "t": topic, "i": t.get("intent") if t.get("intent") in INTENTS else "other", "k": cat,
        })
    assert len(rows) == len(posts)
    linked = [u for c in cfg["categories"] for u in c.get("examples", [])] + [p["u"] for p in cfg["picks"]]
    missing = set(linked) - {r["u"] for r in rows}
    assert not missing, f"categories.json links posts that aren't in the export: {missing}"
    print(f"{len(rows)} posts, {len(tags)} tagged; unmapped topics → misc: {sum(unmapped.values())}")
    print("  top unmapped:", unmapped.most_common(40))

    blob = json.dumps({"posts": rows, "cfg": cfg}, ensure_ascii=False, separators=(",", ":"))
    html = open(os.path.join(HERE, "template.html")).read().replace("__DATA__", blob.replace("</", "<\\/"))
    out = os.path.join(DATA, "report.html")
    open(out, "w").write(html)
    print(f"wrote {out} ({len(html) / 1e6:.1f} MB)")
    wrapped(rows, cfg)


def wrapped(rows, cfg):
    """Second page: a story of the stats, then the quest board (data/quests.jsonl, from quests.py)."""
    names = {c["id"]: c["name"] for c in cfg["categories"]} | {"misc": "Everything else"}
    by_u = {r["u"]: r for r in rows}
    top = lambda rs, n: [[names[k], v] for k, v in collections.Counter(r["k"] for r in rs if r["k"] != "misc").most_common(n)]
    days = collections.Counter(r["d"] for r in rows)
    big_day = max(days, key=days.get)
    months = collections.Counter(r["d"][:7] for r in rows)
    big_month = max(months, key=months.get)
    best = (0, None)  # (length, end date)
    run, prev = 0, None
    for d in sorted(map(datetime.date.fromisoformat, days)):
        run = run + 1 if prev and (d - prev).days == 1 else 1
        prev = d
        if run > best[0]:
            best = (run, d)
    streak = {"n": best[0], "start": str(best[1] - datetime.timedelta(days=best[0] - 1)), "end": str(best[1])}
    years = sorted(collections.Counter(r["d"][:4] for r in rows).items())
    first = min(rows, key=lambda r: r["d"])

    groups = {}
    qpath = os.path.join(DATA, "quests.jsonl")
    for line in open(qpath) if os.path.exists(qpath) else []:
        q = json.loads(line)
        u = q["url"].replace("https://www.instagram.com/", "")
        if q["kind"] == "none" or q["item"].lower() in {"", "none", "n/a", "unknown", "..."} or u not in by_u:
            continue
        name = q["item"]
        if q["kind"] == "song" and name.lower().startswith("song - "):
            continue  # the model's placeholder when the caption names no song
        if q["kind"] == "song":  # "Creep" and "Creep - Radiohead" are the same quest; match on the title
            name = re.split(r" [-–—(] ?|\(", name)[0]
        key = re.sub(r"[^a-z0-9]", "", name.lower())
        g = groups.setdefault((q["kind"], key), {"id": q["kind"] + ":" + key, "k": q["kind"], "n": q["item"], "tip": q["tip"], "u": []})
        g["u"].append(u)
        if " - " not in g["n"] and " - " in q["item"]:  # pick up the artist if the first save lacked it
            g["n"] = q["item"]
    for g in groups.values():
        g["d"] = max(by_u[u]["d"] for u in g["u"])
        g["s"] = by_u[g["u"][0]]["s"]
    # most re-saved first, newest first within a tie (two stable sorts)
    quests = sorted(sorted(groups.values(), key=lambda g: g["d"], reverse=True), key=lambda g: -len(g["u"]))

    stats = {
        "total": len(rows), "first": {"d": first["d"], "s": first["s"], "u": first["u"]},
        "years": years, "yearTop": [[y, top([r for r in rows if r["d"][:4] == y], 1)] for y, _ in years],
        "bigDay": {"d": big_day, "n": days[big_day], "top": top([r for r in rows if r["d"] == big_day], 3)},
        "bigMonth": {"m": big_month, "n": months[big_month]}, "streak": streak, "activeDays": len(days),
        "owners": collections.Counter(r["o"] for r in rows).most_common(5), "cats": top(rows, 5),
    }
    assert streak["n"] >= 1 and sum(n for _, n in years) == len(rows)
    blob = json.dumps({"stats": stats, "quests": quests}, ensure_ascii=False, separators=(",", ":"))
    html = open(os.path.join(HERE, "wrapped_template.html")).read().replace("__DATA__", blob.replace("</", "<\\/"))
    out = os.path.join(DATA, "wrapped.html")
    open(out, "w").write(html)
    print(f"wrote {out}: {len(quests)} quests from {sum(len(g['u']) for g in quests)} posts")


if __name__ == "__main__":
    main()
