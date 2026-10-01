"""Dashboard helpers: market clocks, ticker search, upcoming earnings."""
import datetime as dt

from cockpit import dash, db, market

UTC = dt.timezone.utc


def test_market_clock_open_and_closed():
    # Wednesday 2026-09-30 15:00 UTC = 11:00 New York → open, closes 20:00 UTC
    c = dash.market_clock("SPY", dt.datetime(2026, 9, 30, 15, 0, tzinfo=UTC))
    assert c["open"] and c["next"].startswith("2026-09-30T20:00")
    # Same moment in Stockholm is 17:00 → still open until 17:30 local (15:30 UTC)
    s = dash.market_clock("VOLV-B.ST", dt.datetime(2026, 9, 30, 15, 0, tzinfo=UTC))
    assert s["open"] and s["next"].startswith("2026-09-30T15:30")
    # Friday evening → next open is Monday
    f = dash.market_clock("SPY", dt.datetime(2026, 10, 2, 22, 0, tzinfo=UTC))
    assert not f["open"] and f["next"].startswith("2026-10-05T13:30")
    # Early morning on a weekday → opens the same day
    m = dash.market_clock("VOLV-B.ST", dt.datetime(2026, 9, 30, 5, 0, tzinfo=UTC))
    assert not m["open"] and m["next"].startswith("2026-09-30T07:00")


def test_search_ranks_mine_and_exact(fresh_db):
    db.execute("INSERT INTO watchlist(ticker, note, added_at) VALUES ('VOLV-B.ST', 'trucks', ?)", (db.now(),))
    r = dash.search("volv")
    assert r[0]["ticker"] == "VOLV-B.ST" and r[0]["tag"] == "watching"
    r = dash.search("AAPL")
    assert r[0]["ticker"] == "AAPL" and "Apple" in r[0]["name"]
    assert any("APPLE" in x["name"].upper() for x in dash.search("apple"))
    # unknown but ticker-shaped input is still offered
    assert dash.search("ZZZQ")[-1]["ticker"] == "ZZZQ"
    assert dash.search("")[0]["ticker"] == "VOLV-B.ST"


def test_upcoming_earnings(fresh_db, monkeypatch):
    today = dt.date.today()
    dates = {"AAA": (today + dt.timedelta(days=3)).isoformat(), "BBB": (today + dt.timedelta(days=90)).isoformat(), "CCC": None}
    monkeypatch.setattr(market, "earnings", lambda t: {"next": dates.get(t)})
    for t in dates:
        db.execute("INSERT INTO watchlist(ticker, note, added_at) VALUES (?, '', ?)", (t, db.now()))
    r = dash.upcoming(1)
    assert [x["ticker"] for x in r] == ["AAA"] and r[0]["days"] == 3 and r[0]["why"] == "watching"
