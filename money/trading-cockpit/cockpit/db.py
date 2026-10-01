"""SQLite storage. One connection per call site; the file lives in data/cockpit.sqlite."""
from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("COCKPIT_DB", ROOT / "data" / "cockpit.sqlite"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('paper','real')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cash_moves (
  id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id),
  ts TEXT NOT NULL, amount REAL NOT NULL, note TEXT
);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id),
  ticker TEXT NOT NULL, created_at TEXT NOT NULL, thesis TEXT, setup TEXT,
  entry REAL, stop REAL, target REAL, hold_days INTEGER, risk_pct REAL, shares REAL,
  confidence INTEGER, check_json TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','open','closed','cancelled')),
  exit_reason TEXT, followed_plan INTEGER, lesson TEXT, closed_at TEXT
);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id),
  plan_id INTEGER REFERENCES plans(id), ticker TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')), qty REAL NOT NULL CHECK (qty > 0),
  price REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', fx REAL NOT NULL DEFAULT 1,
  fees REAL NOT NULL DEFAULT 0, ts TEXT NOT NULL, note TEXT
);
CREATE TABLE IF NOT EXISTS watchlist (
  ticker TEXT PRIMARY KEY, note TEXT, added_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_rules (
  id INTEGER PRIMARY KEY, ticker TEXT NOT NULL, kind TEXT NOT NULL, value REAL,
  note TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_log (
  id INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL, ts TEXT NOT NULL, ticker TEXT,
  kind TEXT, title TEXT, message TEXT, sent INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS strategies (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, spec_json TEXT NOT NULL,
  result_json TEXT, alert INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS trades_acct ON trades(account_id, ticker, ts);
"""

DEFAULTS = {
    "risk_pct": 0.01,          # risk per trade as a fraction of account equity
    "max_position_pct": 0.25,  # biggest single position as a fraction of equity
    "max_heat_pct": 0.06,      # total open risk across all positions
    "st_tax_rate": 0.22,       # US ordinary-income rate used for short-term gains
    "lt_tax_rate": 0.15,
    "paper_slippage_bps": 5,
    "paper_fee": 0.0,
    "paper_auto_exit": 1,      # paper positions exit automatically at their stop/target
    "fractional": 1,
    "ntfy_topic": "",
    "sec_user_agent": "",
    "alerts_enabled": 1,
    "alert_earnings_days": 3,     # warn this many calendar days before earnings
    "alert_volume_mult": 3.0,     # last session's volume vs its 50-day average
    "alert_move_sigma": 3.0,      # day move vs the stock's normal daily swing
    "alert_fast_min": 5,          # scan interval while a watched market is open
    "alert_slow_min": 60,         # ...and while they're all closed
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")
    return con


def init(paper_cash: float = 1000.0) -> None:
    with connect() as con:
        con.executescript(SCHEMA)
        if not con.execute("SELECT 1 FROM accounts").fetchone():
            ts = now()
            cur = con.execute("INSERT INTO accounts(name, mode, created_at) VALUES ('Paper', 'paper', ?)", (ts,))
            con.execute("INSERT INTO cash_moves(account_id, ts, amount, note) VALUES (?, ?, ?, 'starting paper cash')",
                        (cur.lastrowid, ts, paper_cash))
            con.execute("INSERT INTO accounts(name, mode, created_at) VALUES ('Real', 'real', ?)", (ts,))
        for k, v in DEFAULTS.items():
            con.execute("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (k, json.dumps(v)))


def settings() -> dict:
    with connect() as con:
        out = dict(DEFAULTS)
        for r in con.execute("SELECT key, value FROM settings"):
            out[r["key"]] = json.loads(r["value"])
        return out


def set_setting(key: str, value) -> None:
    if key not in DEFAULTS:
        raise KeyError(key)
    with connect() as con:
        con.execute("INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)", (key, json.dumps(value)))


def rows(sql: str, args=()) -> list[dict]:
    with connect() as con:
        return [dict(r) for r in con.execute(sql, args)]


def one(sql: str, args=()) -> dict | None:
    r = rows(sql, args)
    return r[0] if r else None


def execute(sql: str, args=()) -> int:
    with connect() as con:
        return con.execute(sql, args).lastrowid
