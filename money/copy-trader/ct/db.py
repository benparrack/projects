"""SQLite store: raw source data (append-only), price cache, and simulation results."""
import json
import os
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
-- One row per leader disclosure. src: 13f | house | senate. public_time: unix seconds when it became public.
CREATE TABLE IF NOT EXISTS filings(src TEXT, doc_id TEXT, leader TEXT, public_time REAL, payload TEXT,
    PRIMARY KEY(src, doc_id));
CREATE TABLE IF NOT EXISTS figi(cusip TEXT PRIMARY KEY, ticker TEXT, name TEXT);
-- iv: 1d (stocks, t = unix of the trading date 00:00 UTC) or 1h (crypto, t = bar open, unix seconds)
CREATE TABLE IF NOT EXISTS bars(sym TEXT, iv TEXT, t INTEGER, o REAL, h REAL, l REAL, c REAL, PRIMARY KEY(sym, iv, t));
CREATE TABLE IF NOT EXISTS price_meta(sym TEXT, iv TEXT, fetched REAL, ok INTEGER, PRIMARY KEY(sym, iv));
CREATE TABLE IF NOT EXISTS funding(coin TEXT, t INTEGER, rate REAL, PRIMARY KEY(coin, t));
CREATE TABLE IF NOT EXISTS hl_fills(user TEXT, tid INTEGER, t INTEGER, coin TEXT, sz REAL, px REAL,
    PRIMARY KEY(user, tid));
-- ref_t/positions: clearinghouse snapshot taken when fills were fetched (anchor for rebuilding past positions)
CREATE TABLE IF NOT EXISTS hl_users(user TEXT PRIMARY KEY, fetched REAL, fills_from INTEGER, truncated INTEGER,
    ref_t INTEGER, account_value REAL, positions TEXT, portfolio TEXT);
CREATE TABLE IF NOT EXISTS hl_snapshots(user TEXT, t INTEGER, account_value REAL, positions TEXT, PRIMARY KEY(user, t));
CREATE TABLE IF NOT EXISTS hl_selections(strategy TEXT, t INTEGER, leaders TEXT, detail TEXT, PRIMARY KEY(strategy, t));
CREATE TABLE IF NOT EXISTS runs(mode TEXT, strategy TEXT, updated REAL, summary TEXT, PRIMARY KEY(mode, strategy));
CREATE TABLE IF NOT EXISTS trades(mode TEXT, strategy TEXT, t INTEGER, sym TEXT, qty REAL, px REAL, fee REAL,
    notional REAL, reason TEXT);
CREATE INDEX IF NOT EXISTS trades_idx ON trades(mode, strategy, t);
CREATE TABLE IF NOT EXISTS equity(mode TEXT, strategy TEXT, t INTEGER, equity REAL, bench REAL,
    PRIMARY KEY(mode, strategy, t));
"""


def connect(path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    con = sqlite3.connect(path, timeout=60)
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(SCHEMA)
    return con


def kv_get(con, k, default=None):
    row = con.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
    return json.loads(row[0]) if row else default


def kv_set(con, k, v):
    con.execute("INSERT OR REPLACE INTO kv VALUES(?,?)", (k, json.dumps(v)))
    con.commit()
