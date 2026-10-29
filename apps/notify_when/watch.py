#!/usr/bin/env python3
"""notify-when: watch pages/APIs from watches.toml and push to ntfy when a condition becomes true.

  watch.py run            check every due watch, push on new hits (the systemd timer calls this)
  watch.py check NAME     fetch one watch now and print the value + condition (no push, no state change)
  watch.py list           show watches with their last value and status
"""
import json
import re
import sys
import time
import tomllib
from pathlib import Path

import requests
from bs4 import BeautifulSoup

HERE = Path(__file__).resolve().parent
WATCHES = HERE / "watches.toml"
STATE = HERE / "state.json"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"}


def load_env():
    """NTFY_ALERT_TOPIC from ./.env, falling back to flip-bot's (same phone topic everything else uses)."""
    env = {}
    for p in (HERE.parent.parent / "money/flip-bot/.env", HERE / ".env"):
        if p.exists():
            for line in p.read_text().splitlines():
                k, _, v = line.partition("=")
                if v and not k.startswith("#"):
                    env[k.strip()] = v.strip().strip('"\'')
    return env


def parse_every(s):
    """'30m' / '2h' / '1d' -> seconds."""
    m = re.fullmatch(r"(\d+)\s*([mhd])", str(s).strip())
    if not m:
        raise ValueError(f"bad 'every': {s!r} (use e.g. 30m, 2h, 1d)")
    return int(m[1]) * {"m": 60, "h": 3600, "d": 86400}[m[2]]


def to_number(v):
    """'1 299,90 kr' -> 1299.9; None if there's no number."""
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"-?\d[\d\s ]*(?:[.,]\d+)?", str(v))
    return float(re.sub(r"[\s ]", "", m[0]).replace(",", ".")) if m else None


def extract(w, resp):
    """Pull the watched value out of the response, using whichever of json/css/regex the watch sets."""
    if "json" in w:
        v = resp.json()
        for key in w["json"].split("."):
            v = v[int(key)] if isinstance(v, list) else v[key]
        return v if isinstance(v, (int, float, str)) else json.dumps(v, sort_keys=True)
    text = resp.text
    if "css" in w:
        el = BeautifulSoup(text, "html.parser").select_one(w["css"])
        if el is None:
            return None  # element gone counts as "missing", which `contains`/`changed` handle
        text = el.get_text(" ", strip=True)
    elif "regex" not in w:
        text = BeautifulSoup(text, "html.parser").get_text(" ", strip=True)  # whole page text
    if "regex" in w:
        m = re.search(w["regex"], text, re.S)
        return (m[1] if m.groups() else m[0]) if m else None
    return text


def evaluate(cond, value, last):
    """Return True when the condition holds. `last` is the previous value (for 'changed')."""
    cond = cond.strip()
    if cond == "changed":
        return last is not None and value != last
    if cond == "exists":
        return value is not None
    if cond == "missing":
        return value is None
    op, _, arg = cond.partition(" ")
    if op in ("contains", "!contains"):
        hit = value is not None and arg.lower() in str(value).lower()
        return hit if op == "contains" else not hit
    if op in ("<", "<=", ">", ">=", "==", "!="):
        n = to_number(value) if value is not None else None
        if n is None:
            return False
        t = float(arg)
        return {"<": n < t, "<=": n <= t, ">": n > t, ">=": n >= t, "==": n == t, "!=": n != t}[op]
    raise ValueError(f"unknown condition: {cond!r}")


def fetch(w):
    r = requests.get(w["url"], headers={**UA, **w.get("headers", {})}, timeout=30)
    r.raise_for_status()
    return r


def push(env, title, message, url=None, tags=("bell",)):
    topic = env.get("NTFY_ALERT_TOPIC")
    payload = {"topic": topic, "title": title, "message": message, "tags": list(tags)}
    if url:
        payload["click"] = url
    if not topic:
        print("NTFY (no topic set):", json.dumps(payload, ensure_ascii=False))
        return
    requests.post("https://ntfy.sh", data=json.dumps(payload).encode(), timeout=15).raise_for_status()


def step(w, st, now):
    """Check one watch, update its state dict, and return a push message or None.
    Pushes only on a false->true transition (or every change for 'changed'), so a standing hit doesn't spam."""
    value = extract(w, fetch(w))
    hit = evaluate(w["when"], value, st.get("value"))
    msg = None
    if hit and (w["when"].strip() == "changed" or not st.get("hit")):
        was = f" (was {st['value']})" if w["when"].strip() == "changed" else ""
        msg = f"{w['name']}: {value}{was}"
    st.update(value=value, hit=hit, checked=now, error=None, fails=0)
    return msg


def load_watches():
    ws = tomllib.loads(WATCHES.read_text()).get("watch", [])
    for w in ws:
        missing = {"name", "url", "when"} - w.keys()
        if missing:
            raise SystemExit(f"watch {w.get('name', w)} is missing {missing}")
        parse_every(w.get("every", "1h"))
    return ws


def run(env):
    ws = load_watches()
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    now = time.time()
    for w in ws:
        st = state.setdefault(w["name"], {})
        if now - st.get("checked", 0) < parse_every(w.get("every", "1h")) - 30:
            continue
        try:
            msg = step(w, st, now)
            if msg:
                push(env, "Notify: " + w["name"], msg, url=w.get("link", w["url"]))
                print("PUSH", msg)
        except Exception as e:  # one broken watch must not stop the others
            st.update(checked=now, error=str(e)[:200], fails=st.get("fails", 0) + 1)
            print(f"ERROR {w['name']}: {e}", file=sys.stderr)
            if st["fails"] == 3:  # tell the phone once, not on every retry
                push(env, "Notify: watch broken", f"{w['name']} failed 3 times: {e}"[:300], tags=("warning",))
    STATE.write_text(json.dumps(state, indent=1, ensure_ascii=False))


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "run"
    if cmd == "run":
        run(load_env())
    elif cmd == "check":
        w = next((w for w in load_watches() if w["name"] == " ".join(argv[2:])), None)
        if not w:
            raise SystemExit("no such watch")
        last = (json.loads(STATE.read_text()) if STATE.exists() else {}).get(w["name"], {}).get("value")
        value = extract(w, fetch(w))
        print(f"value: {value!r}\nwhen {w['when']!r}: {evaluate(w['when'], value, last)}")
    elif cmd == "list":
        state = json.loads(STATE.read_text()) if STATE.exists() else {}
        for w in load_watches():
            st = state.get(w["name"], {})
            status = "ERROR " + st["error"] if st.get("error") else ("HIT" if st.get("hit") else "ok")
            print(f"{w['name']:<30} {status:<6} every {w.get('every', '1h'):<4} value={str(st.get('value'))[:50]}")
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv)
