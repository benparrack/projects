"""SQLite state: seen listings, flips (state machine), comps cache, and money controls."""
import json
import os
import sqlite3
import time

STATES = ["found", "approved", "bought", "arrived", "listed", "sold", "shipped", "closed", "skipped", "lost"]
OPEN = ("approved", "bought", "arrived", "listed", "sold")  # capital tied up / in progress
SCHEMA = """
CREATE TABLE IF NOT EXISTS seen (source TEXT, id TEXT, at REAL, PRIMARY KEY (source, id));
CREATE TABLE IF NOT EXISTS flips (
  id INTEGER PRIMARY KEY, source TEXT, listing_id TEXT, model TEXT, title TEXT, url TEXT,
  ask_sek INTEGER, fair_sek INTEGER, profit_est INTEGER, state TEXT, cost_sek INTEGER,
  list_price INTEGER, sold_sek INTEGER, history TEXT, created REAL, updated REAL);
CREATE TABLE IF NOT EXISTS comps (model TEXT PRIMARY KEY, prices TEXT, fetched REAL);
"""


class Store:
    def __init__(self, path="flipbot.sqlite"):
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        try:  # migration: fixed-price vs auction resale listing
            self.db.execute("ALTER TABLE flips ADD COLUMN list_kind TEXT")
        except sqlite3.OperationalError:
            pass

    def first_seen(self, source, lid) -> bool:
        cur = self.db.execute("INSERT OR IGNORE INTO seen VALUES (?,?,?)", (source, lid, time.time()))
        self.db.commit()
        return cur.rowcount == 1

    def add_flip(self, deal) -> int:
        l, now = deal.listing, time.time()
        cur = self.db.execute(
            "INSERT INTO flips (source,listing_id,model,title,url,ask_sek,fair_sek,profit_est,state,history,created,updated)"
            " VALUES (?,?,?,?,?,?,?,?,'found',?,?,?)",
            (l.source, l.id, deal.model.name, l.title, l.url, l.price_sek, deal.fair_sek, deal.profit_sek,
             json.dumps([["found", now, None]]), now, now))
        self.db.commit()
        return cur.lastrowid

    def get(self, fid):
        return self.db.execute("SELECT * FROM flips WHERE id=?", (fid,)).fetchone()

    def set_state(self, fid, state, **fields):
        assert state in STATES, state
        row = self.get(fid)
        hist = json.loads(row["history"]) + [[state, time.time(), fields or None]]
        sets = ", ".join(f"{k}=?" for k in fields)
        self.db.execute(f"UPDATE flips SET state=?, history=?, updated=?{', ' + sets if sets else ''} WHERE id=?",
                        (state, json.dumps(hist), time.time(), *fields.values(), fid))
        self.db.commit()

    def by_state(self, *states):
        q = ",".join("?" * len(states))
        return self.db.execute(f"SELECT * FROM flips WHERE state IN ({q}) ORDER BY id", states).fetchall()

    def comps(self, model, max_age=86400):
        r = self.db.execute("SELECT * FROM comps WHERE model=?", (model,)).fetchone()
        return json.loads(r["prices"]) if r and time.time() - r["fetched"] < max_age else None

    def save_comps(self, model, prices):
        self.db.execute("INSERT OR REPLACE INTO comps VALUES (?,?,?)", (model, json.dumps(prices), time.time()))
        self.db.commit()

    # --- money ---
    def realized_profit(self):
        r = self.db.execute("SELECT COALESCE(SUM(sold_sek - cost_sek),0) FROM flips WHERE state='closed'").fetchone()
        return r[0]

    def tied_up(self):
        r = self.db.execute(f"SELECT COALESCE(SUM(COALESCE(cost_sek, ask_sek)),0) FROM flips WHERE state IN "
                            f"({','.join('?' * len(OPEN))})", OPEN).fetchone()
        return r[0]

    def spent_today(self):
        start = time.time() - 86400
        rows = self.db.execute("SELECT history FROM flips WHERE cost_sek IS NOT NULL").fetchall()
        total = 0
        for r in rows:
            for state, at, f in json.loads(r["history"]):
                if state == "bought" and at >= start and f:
                    total += f.get("cost_sek", 0)
        return total


def buying_paused(root=".") -> bool:
    return os.path.exists(os.path.join(root, "STOP"))


def can_spend(store, price, cfg, root=".") -> tuple[bool, str]:
    """Checks every money control; returns (ok, reason)."""
    if buying_paused(root):
        return False, "paused (STOP)"
    available = cfg["bankroll_sek"] + store.realized_profit() - store.tied_up()
    if price > available:
        return False, f"bankroll: {available} kr available"
    if len(store.by_state(*OPEN)) >= cfg["max_open_flips"]:
        return False, "max open flips reached"
    if store.spent_today() + price > cfg["daily_spend_cap_sek"]:
        return False, "daily spend cap"
    return True, "ok"


def needs_approval(price, cfg) -> bool:
    return price > cfg["auto_buy_max_sek"]
