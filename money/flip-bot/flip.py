#!/usr/bin/env python3
"""flip — Stockholm flip bot.

flip once | run | status | auth | catalog check | bought ID PRICE | arrived ID | shipped ID | approve ID | skip ID
"""
import logging
import math
import pathlib
from datetime import datetime, timedelta, timezone
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
from sources.tradera import Tradera

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
    def __init__(self, cfg, st, models, dry_run=None, fetch=blocket.search, tradera=None):
        self.cfg, self.st, self.models, self.fetch, self.tr = cfg, st, models, fetch, tradera
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

    # ---------------- Tradera ----------------
    def refresh_comps(self, m):
        if self.st.comps(m.name) is not None:
            return
        prices, cat = [], None
        for q in m.queries:
            p, c = self.tr.sold_comps(q, m)
            prices += p
            cat = cat or c
        self.st.save_comps(m.name, prices)
        if cat:
            self.st.save_comps("cat:" + m.name, [cat])

    def scan_tradera(self):
        found = []
        for m in self.models:
            try:
                self.refresh_comps(m)
                listings = [l for q in m.queries for l in self.tr.search(q)]
            except Exception as e:
                log.warning("tradera %s: %s", m.name, e)
                continue
            fair, src = pricing.fair_value(m, self.st.comps(m.name) or ())
            for l in listings:
                # Buy-Now only: auctions would need end-of-auction bid scheduling (not built).
                if not l.extra.get("bin") or catalog.match(l.title, self.models) is not m:
                    continue
                if not self.st.first_seen(l.source, l.id):
                    continue
                d = scorer.score(l, m, fair, src, self.cfg)
                if scorer.is_deal(d, self.cfg):
                    found.append(d)
                    self.on_tradera_deal(d)
        return found

    def on_tradera_deal(self, d):
        l, fid = d.listing, self.st.add_flip(d)
        ok, why = store.can_spend(self.st, l.price_sek, self.cfg, ROOT)
        head = f"#{fid} Tradera {l.price_sek} kr → ~{d.profit_sek} kr: {d.model.name}"
        body = f"{l.title}\nfair {d.fair_sek} kr ({d.fair_source}) · incl. ~{self.cfg['buy_shipping_sek']} kr shipping"
        if not ok:
            self.st.set_state(fid, "skipped")
            log.info("#%s not bought: %s", fid, why)
            return
        if d.suspicious or store.needs_approval(l.price_sek, self.cfg) or not self.tr.can_act:
            reason = "⚠ suspiciously cheap. " if d.suspicious else ""
            self.alert(notify.build(head, f"{reason}Approve buy?\n{body}", url=l.url, tags=["question"],
                                    actions=[notify.reply_button("Approve", self.reply_topic, f"approve {fid}"),
                                             notify.reply_button("Skip", self.reply_topic, f"skip {fid}")]))
            return
        self.execute_buy(fid)

    def execute_buy(self, fid):
        row = self.st.get(fid)
        if row["source"] != "tradera":
            self.st.set_state(fid, "approved")
            return f"#{fid} approved. Contact the seller: {row['url']}"
        if self.dry:
            self.st.set_state(fid, "bought", cost_sek=row["ask_sek"] + self.cfg["buy_shipping_sek"])
            msg = f"[DRY RUN] would buy #{fid} {row['model']} for {row['ask_sek']} kr"
        elif not self.tr or not self.tr.can_act:
            return f"#{fid}: no Tradera user token. Buy manually: {row['url']}"
        else:
            status = self.tr.buy(row["listing_id"], row["ask_sek"])
            if status.split(".")[-1] != "Bought":  # BuyStatus enum; anything else = not purchased
                self.st.set_state(fid, "lost")
                msg = f"#{fid} buy failed: {status}"
                self.alert(notify.build("flipbot", msg))
                return msg
            self.st.set_state(fid, "bought", cost_sek=row["ask_sek"] + self.cfg["buy_shipping_sek"])
            msg = f"Bought #{fid} {row['model']} for {row['ask_sek']} kr. Pay on Tradera; reply 'arrived {fid}' when it comes."
        self.alert(notify.build("flipbot", msg, url=row["url"], tags=["shopping_cart"]))
        return msg

    def expire_approvals(self):
        cutoff = time.time() - 60 * self.cfg["approval_timeout_min"]
        for r in self.st.by_state("found"):
            if r["source"] == "tradera" and r["created"] < cutoff:
                self.st.set_state(r["id"], "skipped")

    def sell_tick(self):
        """List arrived items that have photos, reprice stale listings, pick up sold orders."""
        now = time.time()
        for r in self.st.by_state("arrived"):
            photos = sorted(str(p) for p in pathlib.Path(ROOT, "inbox", str(r["id"])).glob("*")
                            if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
            if photos:
                self.list_flip(r, photos)
        for r in self.st.by_state("listed"):
            days = (now - r["updated"]) / 86400
            if r["list_kind"] == "auction":  # can't reprice a running auction; nudge after it ends
                if days >= 8:
                    self.alert(notify.build(f"#{r['id']} auction ended unsold?", f"{r['model']}: relist or sell on Blocket."))
                    self.st.set_state(r["id"], "listed")  # resets the timer so this nudges weekly
                continue
            floor = (r["cost_sek"] or 0) + self.cfg["min_profit_sek"] // 2
            new = max(floor, int(r["list_price"] * 0.95))
            if days >= 21 and new == r["list_price"]:
                self.alert(notify.build(f"#{r['id']} unsold 21+ days", f"{r['model']} at floor {floor} kr — relist, keep or sell locally?"))
            elif days >= 3 and new < r["list_price"]:
                if not self.dry:
                    self.tr.set_price(r["listing_id"], new)
                self.st.set_state(r["id"], "listed", list_price=new)
                log.info("#%s repriced %s -> %s", r["id"], r["list_price"], new)
        if self.tr and self.tr.can_act and not self.dry:
            self.poll_orders()

    def list_flip(self, r, photos):
        fair = r["fair_sek"]
        title = f"{r['model']} – fint skick"
        desc = (f"{r['model']}. Testad och fungerar. Säljes då den inte används längre. "
                f"Skickas med PostNord inom 1–2 dagar efter betalning.")
        if self.dry or not (self.tr and self.tr.can_act):
            self.st.set_state(r["id"], "listed", list_price=fair)
            self.alert(notify.build("flipbot", f"[DRY RUN] would list #{r['id']} '{title}' at {fair} kr with {len(photos)} photos"))
            return
        try:
            cat = (self.st.comps("cat:" + r["model"], max_age=10 ** 9) or [None])[0]
            try:
                _, item_id = self.tr.list_item(title, desc, fair, cat, photos, self.tr.FIXED)
                kind, price = "fixed", fair
            except Exception as e:
                # New/restricted sellers may only create plain auctions: start at the profit floor.
                log.info("fixed-price listing rejected (%s); falling back to auction", e)
                price = (r["cost_sek"] or 0) + self.cfg["min_profit_sek"] // 2
                _, item_id = self.tr.list_item(title, desc, price, cat, photos, self.tr.AUCTION)
                kind = "auction"
            self.st.set_state(r["id"], "listed", list_price=price, listing_id=str(item_id), list_kind=kind)
            self.alert(notify.build("flipbot", f"Listed #{r['id']} on Tradera ({kind}) at {price} kr"))
        except Exception as e:
            self.alert(notify.build(f"#{r['id']} listing failed", f"{e}"[:300] + " — list it manually; reply 'listed' not needed."))
            log.exception("listing failed")

    def poll_orders(self):
        since = datetime.now(timezone.utc) - timedelta(days=7)
        listed = {r["listing_id"]: r for r in self.st.by_state("listed")}
        orders = (self.tr.seller_orders(since) or {}).get("SellerOrders") or {}
        for o in orders.get("SellerOrder", []) if isinstance(orders, dict) else orders:
            items = ((o.get("Items") or {}).get("SellerOrderItem")) or []
            for it in items:
                r = listed.get(str(it.get("ItemId")))
                if r:
                    self.st.set_state(r["id"], "sold", sold_sek=o.get("SubTotal") or r["list_price"])
                    ship = o.get("ShipTo") or {}
                    addr = ", ".join(str(v) for v in ship.values() if v)
                    self.alert(notify.build(f"SOLD #{r['id']} {r['model']}", f"Ship to: {addr}\nReply 'shipped {r['id']}' after drop-off.", tags=["tada"]))

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
            ok, why = store.can_spend(st, st.get(fid)["ask_sek"], self.cfg, ROOT)
            return self.execute_buy(fid) if ok else f"#{fid} not bought: {why}"
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
        if self.tr:
            deals += self.scan_tradera()
            self.expire_approvals()
        self.sell_tick()
        log.info("scan done: %d new deals", len(deals))
        return deals


def status_text(st, cfg):
    open_ = st.by_state(*store.OPEN)
    avail = cfg["bankroll_sek"] + st.realized_profit() - st.tied_up()
    lines = [f"Bankroll available: {avail} kr · realized profit: {st.realized_profit()} kr",
             f"Buying {'PAUSED' if store.buying_paused(ROOT) else 'active'} · mode: {cfg['mode']}"]
    lines += [f"#{r['id']} {r['state']:<8} {r['model']} (cost {r['cost_sek'] or '-'} kr)" for r in open_]
    return "\n".join(lines)


def set_env(key, value, path=os.path.join(ROOT, ".env")):
    lines = [l for l in open(path).read().splitlines() if not l.startswith(key + "=")] if os.path.exists(path) else []
    open(path, "w").write("\n".join(lines + [f"{key}={value}"]) + "\n")


def auth(tr):
    """One-time Tradera user consent -> token in .env (lets the bot buy and list as Ben)."""
    if not tr:
        sys.exit("Put TRADERA_APP_ID, TRADERA_APP_KEY and TRADERA_PUBLIC_KEY in .env first (SETUP.md step 2).")
    import secrets
    secret = secrets.token_hex(16)
    print("1. Open this URL, log in to Tradera and accept:\n  ", tr.login_url(secret))
    print("2. After accepting, Tradera redirects to your app's return URL. Copy the userId from it.")
    user_id = input("userId: ").strip()
    token, expires = tr.fetch_token(user_id, secret)
    set_env("TRADERA_USER_ID", user_id)
    set_env("TRADERA_USER_TOKEN", token)
    print(f"Saved token to .env (expires {expires}).")


def catalog_check(tr, models):
    if not tr:
        sys.exit("Needs Tradera API keys in .env (SETUP.md step 2).")
    for m in models:
        prices = [p for q in m.queries for p in tr.sold_comps(q, m)[0]]
        fair, src = pricing.fair_value(m, prices)
        flag = "  <-- seed off by >25%" if prices and abs(fair - m.fair_sek) > 0.25 * m.fair_sek else ""
        print(f"{m.name:<40} seed {m.fair_sek:>4}  comps {fair:>4} ({src}){flag}")


def main(argv):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    os.chdir(ROOT)
    load_env()
    cfg = yaml.safe_load(open("config.yaml"))
    st = store.Store()
    cmd = argv[1] if len(argv) > 1 else "once"
    if cmd in ("once", "run"):
        ensure_topics()
    tr = Tradera.from_env()
    if not tr and cmd in ("once", "run"):
        log.info("Tradera disabled: no TRADERA_APP_ID/TRADERA_APP_KEY in .env (see SETUP.md)")
    bot = Bot(cfg, st, catalog.load(), tradera=tr)
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
    elif cmd == "auth":
        auth(tr)
    elif cmd == "catalog":
        catalog_check(tr, bot.models)
    elif cmd in ("arrived", "shipped", "bought", "skip", "approve"):
        print(bot.handle(cmd, argv[2:]))
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv)
