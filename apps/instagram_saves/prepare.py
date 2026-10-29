"""Flattens Instagram's "Download your information" saved_posts.json → data/posts.jsonl
(one post per line: url, saved, owner, name, caption, hashtags). Oldest save first."""

import datetime
import glob
import json
import os

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def fix(s):
    """Meta's export double-encodes text: UTF-8 bytes stored as Latin-1 characters."""
    try:
        return s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def flatten(entry):
    p = {"url": "", "saved": datetime.datetime.fromtimestamp(entry["timestamp"]).date().isoformat(),
         "owner": "", "name": "", "caption": "", "hashtags": []}
    for lv in entry["label_values"]:
        if lv.get("label") == "URL":
            p["url"] = lv["value"]
        elif lv.get("label") == "Caption":
            p["caption"] = fix(lv["value"])
        elif lv.get("title") == "Owner":
            for d in lv["dict"]:
                f = {x["label"]: x["value"] for x in d["dict"]}
                p["owner"], p["name"] = f.get("Username", ""), fix(f.get("Name", ""))
        elif lv.get("title") == "Hashtags":
            p["hashtags"] = [fix(x["value"]) for d in lv["dict"] for x in d["dict"]]
    return p


def main():
    src = glob.glob(os.path.join(DATA, "export", "**", "saved_posts.json"), recursive=True)[0]
    posts = sorted((flatten(e) for e in json.load(open(src))), key=lambda p: p["saved"])
    assert fix("Worldâ\x80\x99s") == "World\u2019s"
    assert posts and all(p["url"] for p in posts), "export format changed: some posts have no URL"
    with open(os.path.join(DATA, "posts.jsonl"), "w") as f:
        f.writelines(json.dumps(p, ensure_ascii=False) + "\n" for p in posts)
    print(f"{len(posts)} posts → data/posts.jsonl")


if __name__ == "__main__":
    main()
