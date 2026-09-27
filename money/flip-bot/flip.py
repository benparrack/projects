#!/usr/bin/env python3
"""flip — Stockholm flip bot. `flip once | run | status | arrived ID | shipped ID | bought ID PRICE`."""
import logging
import math
import os
import random
import sys
import time

import yaml

import catalog
import notify
import pricing
import scorer
import store
from sources import blocket

ROOT = os.path.dirname(os.path.abspath(__file__))
log = logging.getLogger("flip")


def load_env(path=os.path.join(ROOT, ".env")):
    if os.path.exists(path):
        for line in open(path):
            if "=" in line and not line.startswith("#"):
                k, v = line.strip().split("=", 1)
                os.environ.setdefault(k, v)


def ensure_topics(path=os.path.join(ROOT, ".env")):
    """Generate secret ntfy topics on first run so Ben only has to subscribe."""
    added = []
    for key in ("NTFY_ALERT_TOPIC", "NTFY_REPLY_TOPIC"):
        if not os.environ.get(key):
            os.environ[key] = notify.new_topic()
            added.append(f"{key}={os.environ[key]}")
    if added:
        with open(path, "a") as f:
            f.write("\n".join(added) + "\n")
        print(f"Generated ntfy topics in .env. Subscribe in the ntfy app to: {os.environ['NTFY_ALERT_TOPIC']}")


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


class Bot:
    def __init__(self, cfg, st, models, dry_run=None, fetch=blocket.search):
        self.cfg, self.st, self.models, self.fetch = cfg, st, models, fetch
        self.dry = cfg["mode"] != "live" if dry_run is None else dry_run
        self.alert_topic = os.environ.get("NTFY_ALERT_TOPIC", "")
        self.reply_topic = os.environ.get("NTFY_REPLY_TOPIC", "")
        self.sent = []

    def alert(self, payload):
        self.sent.append(notify.send(self.alert_topic, payload, dry_run=False if self.alert_topic else True))

    def scan_blocket(self):
        found = []
        for m in self.models:
            listings = []
            for q in m.queries:
                listings += self.fetch(q)
            matched = [l for l in listings if l.price_sek >= catalog.MIN_PRICE_SEK
                       and catalog.match(l.title, self.models) is m]
            fair, src = pricing.fair_value(m, self.st.comps(m.name) or (), [l.price_sek for l in matched])
            for l in matched:
                if l.lat and km(self.cfg["home"], (l.lat, l.lon)) > self.cfg["max_km"]:
                    continue
                if not self.st.first_seen(l.source, l.id):
                    continue
                d = scorer.score(l, m, fair, src, self.cfg)
                if scorer.is_deal(d, self.cfg):
                    found.append(d)
                    self.on_blocket_deal(d)
        return found

    def on_blocket_deal(self, d):
        fid = self.st.add_flip(d)
        l = d.listing
        offer = l.price_sek
        if d.profit_sek - 0.1 * l.price_sek >= (d.model.min_profit_sek or self.cfg["min_profit_sek"]):
            offer = int(l.price_sek * 0.9 / 10) * 10
        msg = f"Hej! Är den kvar? Jag kan hämta idag och swisha direkt. Skulle du ta {offer} kr?"
        dist = f"{km(self.cfg['home'], (l.lat, l.lon)):.0f} km" if l.lat else l.location
        warn = "⚠ SUSPICIOUSLY CHEAP — likely scam/typo. " if d.suspicious else ""
        self.alert(notify.build(
            f"#{fid} {l.price_sek} kr → ~{d.profit_sek} kr profit: {d.model.name}",
            f"{warn}{l.title}\n{dist} · fair {d.fair_sek} kr ({d.fair_source})\n\nMessage to send:\n{msg}",
            url=l.url, tags=["moneybag"],
            actions=[notify.reply_button("Bought it", self.reply_topic, f"bought {fid} {offer}"),
                     notify.reply_button("Skip", self.reply_topic, f"skip {fid}")]))

    def handle(self, cmd, args):
        st = self.st
        if cmd == "stop":
            open(os.path.join(ROOT, "STOP"), "w").close()
            return "Buying paused."
        if cmd == "resume":
            if os.path.exists(os.path.join(ROOT, "STOP")):
                os.remove(os.path.join(ROOT, "STOP"))
            return "Buying resumed."
        if cmd == "status":
            return status_text(st, self.cfg)
        if not args or not args[0].isdigit() or not st.get(int(args[0])):
            return f"Unknown flip id for '{cmd}'."
        fid = int(args[0])
        if cmd == "bought":
            cost = int(args[1]) if len(args) > 1 and args[1].isdigit() else st.get(fid)["ask_sek"]
            st.set_state(fid, "bought", cost_sek=cost)
            return f"#{fid} bought for {cost} kr. Put photos in inbox/{fid}/ and reply 'arrived {fid}'."
        if cmd == "skip":
            st.set_state(fid, "skipped")
            return f"#{fid} skipped."
        if cmd == "approve":
            st.set_state(fid, "approved")
            return f"#{fid} approved."
        if cmd == "arrived":
            os.makedirs(os.path.join(ROOT, "inbox", str(fid)), exist_ok=True)
            st.set_state(fid, "arrived")
            return f"#{fid} arrived. Listing goes up once photos are in inbox/{fid}/."
        if cmd == "shipped":
            row = st.get(fid)
            st.set_state(fid, "closed")
            return f"#{fid} closed. Profit {(row['sold_sek'] or 0) - (row['cost_sek'] or 0)} kr."

    def process_replies(self, since):
        if not self.reply_topic:
            return since
        try:
            cmds, since = notify.poll_replies(self.reply_topic, since)
        except Exception as e:  # network blips shouldn't kill the loop
            log.warning("reply poll failed: %s", e)
            return since
        for cmd, args in cmds:
            self.alert(notify.build("flipbot", self.handle(cmd, args)))
        return since

    def once(self):
        deals = self.scan_blocket()
        log.info("scan done: %d new deals", len(deals))
        return deals


def status_text(st, cfg):
    open_ = st.by_state(*store.OPEN)
    avail = cfg["bankroll_sek"] + st.realized_profit() - st.tied_up()
    lines = [f"Bankroll available: {avail} kr · realized profit: {st.realized_profit()} kr",
             f"Buying {'PAUSED' if store.buying_paused(ROOT) else 'active'} · mode: {cfg['mode']}"]
    lines += [f"#{r['id']} {r['state']:<8} {r['model']} (cost {r['cost_sek'] or '-'} kr)" for r in open_]
    return "\n".join(lines)


def main(argv):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    os.chdir(ROOT)
    load_env()
    cfg = yaml.safe_load(open("config.yaml"))
    st = store.Store()
    cmd = argv[1] if len(argv) > 1 else "once"
    if cmd in ("once", "run"):
        ensure_topics()
    bot = Bot(cfg, st, catalog.load())
    if cmd == "once":
        bot.once()
    elif cmd == "run":
        since = str(int(time.time()))
        while True:
            try:
                bot.once()
            except Exception as e:
                log.exception("scan failed: %s", e)
            end = time.time() + 60 * random.uniform(*cfg["poll_minutes"])
            while time.time() < end:  # stay responsive to phone replies between scans
                since = bot.process_replies(since)
                time.sleep(20)
    elif cmd == "status":
        print(status_text(st, cfg))
    elif cmd in ("arrived", "shipped", "bought", "skip", "approve"):
        print(bot.handle(cmd, argv[2:]))
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv)
