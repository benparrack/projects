"""Broker sync/import, guardrails, trade management, after-exit, screener, portfolio sim, PIN gate and scheduler."""
import datetime as dt
import json
from zoneinfo import ZoneInfo

import numpy as np
import pytest

from cockpit import broker, db, evolve, lab, manage, market, reports, screener, service
from cockpit.service import UserError
from conftest import make_df

REAL = 2  # db.init() creates Paper (1) and Real (2)


# ---------- CSV parsers ----------
AVANZA = ("Datum;Konto;Typ av transaktion;Värdepapper/beskrivning;Antal;Kurs;Belopp;Transaktionsvaluta;Courtage;"
          "Valutakurs;Instrumentvaluta;ISIN;Resultat\n"
          "2026-03-02;ISK;Köp;Volvo B;10;250,50;-2 505,00;SEK;1,00;;SEK;SE0000115446;-\n"
          "2026-03-01;ISK;Insättning;Insättning;;;10 000,00;SEK;;;;;-\n"
          "2026-03-09;ISK;Sälj;Volvo B;-10;270,00;2 700,00;SEK;1,00;;SEK;SE0000115446;195,00\n").encode("utf-8-sig")
NORDNET = ("Id\tBokföringsdag\tAffärsdag\tTransaktionstyp\tVärdepapper\tISIN\tAntal\tKurs\tTotal Avgift\tBelopp\tValuta\n"
           "1\t2026-03-03\t2026-03-03\tKÖPT\tEricsson B\tSE0000108656\t20\t60,1\t39\t-1241\tSEK\n"
           "2\t2026-03-01\t2026-03-01\tINSÄTTNING\t\t\t\t\t\t5000\tSEK\n").encode("utf-16")
IBKR = ('Statement,Header,Field Name,Field Value\n'
        'Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Comm/Fee\n'
        'Trades,Data,Order,Stocks,USD,AAPL,"2026-03-04, 10:31:00",5,180.25,-1\n'
        'Trades,Data,Order,Stocks,USD,AAPL,"2026-03-06, 15:00:00",-5,190,-1\n'
        'Trades,SubTotal,,Stocks,USD,AAPL,,0,,-2\n'
        'Deposits & Withdrawals,Header,Currency,Settle Date,Description,Amount\n'
        'Deposits & Withdrawals,Data,USD,2026-03-01,Electronic Fund Transfer,2000\n'
        'Deposits & Withdrawals,Data,Total,,,2000\n').encode()
GENERIC = b"date,symbol,side,quantity,price,fee\n2026-03-05,MSFT,BUY,3,400.5,1\n2026-03-06,MSFT,hold,3,1,0\n"


def test_parse_avanza():
    p = broker.parse_csv(AVANZA)
    assert p["format"] == "Avanza"
    tr = [r for r in p["rows"] if r["kind"] == "trade"]
    assert [(r["side"], r["qty"], r["price"]) for r in tr] == [("buy", 10, 250.5), ("sell", 10, 270.0)]
    assert tr[0]["isin"] == "SE0000115446" and tr[0]["fees"] == 1.0
    cash = [r for r in p["rows"] if r["kind"] == "cash"]
    assert cash[0]["amount"] == 10000.0


def test_parse_nordnet_utf16_tabs():
    p = broker.parse_csv(NORDNET)
    assert p["format"] == "Nordnet"
    t = p["rows"][0]
    assert (t["side"], t["qty"], t["price"], t["fees"]) == ("buy", 20, 60.1, 39)
    assert p["rows"][1] == dict(p["rows"][1], kind="cash", amount=5000.0)


def test_parse_ibkr():
    p = broker.parse_csv(IBKR)
    tr = [r for r in p["rows"] if r["kind"] == "trade"]
    assert [(r["side"], r["qty"], r["ticker"]) for r in tr] == [("buy", 5, "AAPL"), ("sell", 5, "AAPL")]
    assert tr[0]["ts"] == "2026-03-04T10:31:00"
    assert [r["amount"] for r in p["rows"] if r["kind"] == "cash"] == [2000.0]  # the Total row is ignored


def test_parse_generic_and_unknown():
    p = broker.parse_csv(GENERIC)
    assert len(p["rows"]) == 1 and p["rows"][0]["ticker"] == "MSFT" and p["rows"][0]["side"] == "buy"
    with pytest.raises(UserError):
        broker.parse_csv(b"foo,bar\n1,2\n")


def test_import_commit_is_idempotent(fresh_db, fake_market, monkeypatch):
    monkeypatch.setattr(market, "fx_at", lambda c, ts: 0.1 if c == "SEK" else 1.0)
    monkeypatch.setattr(broker, "resolve_ticker", lambda name, isin="": "VOLV-B.ST")
    pv = broker.preview(REAL, AVANZA)
    assert pv["securities"]["SE0000115446"]["ticker"] == "VOLV-B.ST"
    c = broker.commit(REAL, pv["rows"], {"SE0000115446": "VOLV-B.ST"})
    assert (c["trades"], c["cash"]) == (2, 1)
    plans = db.rows("SELECT * FROM plans WHERE account_id = ?", (REAL,))
    assert len(plans) == 1 and plans[0]["status"] == "closed" and plans[0]["source"] == "broker"
    again = broker.preview(REAL, AVANZA)
    assert all(r["duplicate"] for r in again["rows"])
    c2 = broker.commit(REAL, again["rows"], {"SE0000115446": "VOLV-B.ST"})
    assert (c2["trades"], c2["cash"], c2["duplicates"]) == (0, 0, 2)


# ---------- attach_fill ----------
def test_attach_fill_prefers_planned_and_guards_oversell(fresh_db, fake_market):
    fake_market["prices"]["AAA"] = 100.0
    pid = service.save_plan(REAL, {"ticker": "AAA", "entry": 100, "stop": 90, "target": 130, "hold_days": 10})
    kw = dict(currency="USD", fx=1.0, fees=0.0, source="alpaca")
    assert service.attach_fill(REAL, ticker="AAA", side="buy", qty=4, price=100, ts="2026-03-02T15:00:00",
                               ext_id="x1", **kw) == "added"
    assert service.plan(pid)["status"] == "open"
    assert service.attach_fill(REAL, ticker="AAA", side="buy", qty=4, price=100, ts="2026-03-02T15:00:00",
                               ext_id="x1", **kw) == "duplicate"
    assert service.attach_fill(REAL, ticker="AAA", side="sell", qty=9, price=110, ts="2026-03-03T15:00:00",
                               ext_id="x2", **kw).startswith("skipped")
    assert service.attach_fill(REAL, ticker="AAA", side="sell", qty=4, price=89, ts="2026-03-04T15:00:00",
                               ext_id="x3", **kw) == "added"
    p = service.plan(pid)
    assert p["status"] == "closed" and p["exit_reason"] == "hit stop"


# ---------- Alpaca sync (mocked HTTP) ----------
class FakeResp:
    def __init__(self, data, code=200):
        self._d, self.status_code = data, code
        self.content = b"x"
        self.text = json.dumps(data)

    def json(self):
        return self._d


def test_alpaca_sync(fresh_db, fake_market, monkeypatch):
    calls = []
    fills = [{"id": "f1", "side": "buy", "symbol": "BRK.B", "qty": "2", "price": "400", "order_id": "o1",
              "transaction_time": "2026-03-02T15:00:00Z"},
             {"id": "f2", "side": "sell_short", "symbol": "TSLA", "qty": "1", "price": "200",
              "transaction_time": "2026-03-03T15:00:00Z"}]

    def req(method, url, **kw):
        calls.append((method, url, kw.get("params")))
        assert kw["headers"]["APCA-API-KEY-ID"] == "KEY"
        assert url.startswith("https://paper-api.alpaca.markets")
        path = url.split(".markets")[1]
        if path == "/v2/account":
            return FakeResp({"status": "ACTIVE", "cash": "200", "equity": "1000"})
        if path == "/v2/account/activities/FILL":
            return FakeResp(fills)
        if path == "/v2/account/activities":
            return FakeResp([{"id": "d1", "activity_type": "CSD", "net_amount": "1000", "date": "2026-03-01"}])
        if path == "/v2/positions":
            return FakeResp([{"symbol": "BRK.B", "qty": "2"}])
        raise AssertionError(path)

    monkeypatch.setattr(broker.requests, "request", req)
    broker.link_alpaca(REAL, "KEY", "SECRET", paper=True, allow_orders=False)
    a = next(x for x in service.accounts() if x["id"] == REAL)
    assert "broker_cfg" not in a and a["broker"] == "alpaca"
    r = broker.sync_alpaca(REAL)
    assert r["added"] == 1 and r["cash_moves"] == 1 and not r["mismatch"]
    assert any("sell_short" in n for n in r["notes"])
    t = db.one("SELECT * FROM trades WHERE ext_id = 'alpaca:f1'")
    assert t["ticker"] == "BRK-B" and t["qty"] == 2
    # cockpit cash: 1000 deposit - 800 buy = 200, same as Alpaca
    assert abs(r["cash_diff"]) < 0.01
    r2 = broker.sync_alpaca(REAL)
    assert r2["added"] == 0 and r2["duplicates"] == 1 and r2["cash_moves"] == 0
    assert calls[-4][2]["after"] == "2026-03-02"  # incremental from a day before the newest activity


def test_alpaca_bad_keys(fresh_db, monkeypatch):
    monkeypatch.setattr(broker.requests, "request", lambda *a, **k: FakeResp({"message": "forbidden"}, 403))
    with pytest.raises(UserError, match="rejected"):
        broker.link_alpaca(REAL, "K", "S", paper=True, allow_orders=False)
    with pytest.raises(UserError):
        broker.link_alpaca(1, "K", "S", paper=True, allow_orders=False)  # paper account


# ---------- guardrails ----------
def test_daily_loss_limit_blocks_then_override(fresh_db, fake_market):
    db.set_setting("max_loss_streak", 0)
    fake_market["prices"]["AAA"] = 100.0
    p1 = service.save_plan(1, {"ticker": "AAA", "entry": 100, "stop": 90, "target": 130, "hold_days": 10, "shares": 3})
    service.record_trade(p1, "buy")
    fake_market["prices"]["AAA"] = 80.0
    service.record_trade(p1, "sell")  # ~-$60 on a ~$1000 account: past the 2% daily limit
    g = manage.guardrails(1)
    assert g["day_pnl"] < -50 and "daily loss limit" in [b["rule"] for b in g["blocks"]]
    fake_market["prices"]["BBB"] = 50.0
    p2 = service.save_plan(1, {"ticker": "BBB", "entry": 50, "stop": 45, "target": 60, "hold_days": 10, "shares": 1})
    with pytest.raises(UserError, match="^GUARDRAIL"):
        service.record_trade(p2, "buy")
    with pytest.raises(UserError, match="^GUARDRAIL"):
        service.record_trade(p2, "buy", override="meh")  # too short
    service.record_trade(p2, "buy", override="breakout I planned last week")
    assert service.plan(p2)["override_reason"] == "breakout I planned last week"


def test_losing_streak_cooldown(fresh_db, fake_market):
    db.set_setting("daily_loss_limit_pct", 0)
    db.set_setting("weekly_loss_limit_pct", 0)
    db.set_setting("max_loss_streak", 2)
    for tk in ("AAA", "BBB"):
        fake_market["prices"][tk] = 100.0
        pid = service.save_plan(1, {"ticker": tk, "entry": 100, "stop": 95, "target": 120, "hold_days": 5, "shares": 1})
        service.record_trade(pid, "buy")
        fake_market["prices"][tk] = 96.0
        service.record_trade(pid, "sell")
    g = manage.guardrails(1)
    assert g["streak"] == 2 and g["blocks"][0]["rule"] == "losing streak cooldown"
    later = manage._local_now() + dt.timedelta(days=3)
    assert not manage.guardrails(1, now=later)["blocks"]


# ---------- trailing stops / scale-outs ----------
def test_trail_levels():
    hist = make_df(np.r_[np.full(30, 100.0), np.linspace(100, 130, 10)], spread=0.0)
    p = {"stop": 90.0, "initial_stop": 90.0, "first_buy": str(hist.index[29].date()), "scaled": 0,
         "trail_json": json.dumps({"breakeven_r": 1, "trail_pct": 0.1, "scale_r": 2, "scale_frac": 0.5})}
    lv = manage.trail_levels(p, hist, 130.0, 100.0)
    # breakeven (100) vs 10% under the 130 high (117): the higher wins; +3R ≥ 2R → scale half
    assert lv["stop"] == pytest.approx(117.0) and "trailing" in lv["why"] and lv["scale"] == 0.5
    # Never lowers the stop.
    assert manage.trail_levels(dict(p, stop=120.0), hist, 130.0, 100.0)["why"] is None
    # No rules → untouched.
    assert manage.trail_levels(dict(p, trail_json=None), hist, 130.0, 100.0) == {"stop": 90.0, "why": None, "scale": False}


def test_clean_trail_percent_inputs():
    assert service.clean_trail({"trail_pct": "8", "scale_r": "2", "breakeven_r": ""}) == \
        {"trail_pct": 0.08, "scale_r": 2.0, "scale_frac": 0.5}
    with pytest.raises(UserError):
        service.clean_trail({"scale_frac": 150})


# ---------- after-exit ----------
def test_after_exit_in_r():
    hist = make_df(np.r_[np.full(10, 100.0), np.arange(101, 121, dtype=float)], spread=0.0)
    r = {"status": "closed", "last_sell": str(hist.index[9].date()), "avg_exit": 100.0, "avg_entry": 95.0,
         "initial_stop": 90.0, "ticker": "X"}
    a = manage.after_exit(r, hist)
    assert a["rps"] == 5 and a["close5_r"] == pytest.approx(1.0) and a["close10_r"] == pytest.approx(2.0)
    assert a["close20_r"] == pytest.approx(4.0) and a["days"] == 20


# ---------- portfolio sim ----------
def test_portfolio_sim_caps_positions(fake_market):
    trades = [{"ticker": t, "entry_date": "2025-01-02", "exit_date": "2025-01-10", "ret": 0.10, "risk_frac": 0.05}
              for t in "ABC"] + [{"ticker": "D", "entry_date": "2025-01-20", "exit_date": "2025-02-01", "ret": -0.05,
                                  "risk_frac": 0.05}]
    s = lab.portfolio_sim(trades, start=10_000, risk_pct=0.01, max_positions=2)
    # Each position: 1% risk / 5% stop = 20% of equity; two taken, third skipped (slots full).
    assert s["trades"] == 3 and s["skipped"] == 1
    after_two = 10_000 + 2 * 2000 * 0.10
    assert s["final"] == pytest.approx(after_two - after_two * 0.2 * 0.05)
    assert s["max_drawdown"] < 0


# ---------- screener ----------
def test_screener_filters(fresh_db, fake_market, monkeypatch):
    up = make_df(np.linspace(50, 100, 300), start="2024-01-01")
    cheap = make_df(np.linspace(2, 4, 300), start="2024-01-01")
    fake_market["hists"].update({"UP": up, "CHEAP": cheap})
    monkeypatch.setattr(screener, "universe", lambda n: [{"ticker": "UP", "name": "Up Inc", "sector": "Tech"},
                                                         {"ticker": "CHEAP", "name": "Penny", "sector": ""}])
    monkeypatch.setattr(market, "prefetch", lambda *a, **k: None)
    r = screener.run({"rule": "close > sma(close, 50)", "universe": "sp500", "min_price": 5, "min_dollar_vol": 1})
    assert [h["ticker"] for h in r["hits"]] == ["UP"] and r["scanned"] == 2
    r = screener.run({"rule": "close < sma(close, 50)", "universe": "sp500", "min_price": 0})
    assert r["hits"] == []
    with pytest.raises(UserError):
        screener.run({"rule": "nonsense(", "universe": "sp500"})


# ---------- scheduler ----------
def test_scheduler_runs_each_job_once_per_day(fresh_db, monkeypatch):
    ran = []
    monkeypatch.setattr(reports, "send_briefing", lambda day: ran.append("b"))
    monkeypatch.setattr(reports, "send_weekly", lambda day: ran.append("w"))
    monkeypatch.setattr(screener, "run_all", lambda fire=None: ran.append("s"))
    monkeypatch.setattr(evolve, "daily", lambda fire=None: ran.append("e"))
    tz = ZoneInfo("Europe/Stockholm")
    db.set_setting("timezone", "Europe/Stockholm")
    fri = dt.datetime(2026, 10, 2, 7, 0, tzinfo=tz)
    assert reports.tick(fri) == ["evolution-catchup"]    # app opened: catch up, then nothing until the briefing time
    assert reports.tick(fri.replace(hour=9)) == ["briefing"]
    assert reports.tick(fri.replace(hour=12)) == []
    assert reports.tick(fri.replace(hour=23)) == ["screener", "evolution", "weekly"]
    assert reports.tick(fri.replace(hour=23, minute=30)) == []
    assert reports.tick(dt.datetime(2026, 10, 3, 23, 0, tzinfo=tz)) == ["evolution-catchup"]  # Saturday: catch-up only
    assert ran == ["e", "b", "s", "e", "w", "e"]


# ---------- settings masking + remote PIN gate ----------
@pytest.fixture
def client(fresh_db, monkeypatch):
    monkeypatch.setenv("COCKPIT_NO_WATCHER", "1")
    from cockpit import pwa, server
    if not getattr(server.app, "_pwa_test", False):
        pwa.register(server.app)
        server.app._pwa_test = True
    return server.app.test_client()


def test_secrets_masked_and_kept(client):
    db.set_setting("anthropic_api_key", "sk-ant-secret-1234")
    s = client.get("/api/settings").get_json()
    assert s["anthropic_api_key"] == "••••1234"
    client.post("/api/settings", json={"anthropic_api_key": s["anthropic_api_key"]})
    assert db.settings()["anthropic_api_key"] == "sk-ant-secret-1234"


def test_remote_needs_pin(client):
    remote = {"REMOTE_ADDR": "100.64.0.7"}
    assert client.get("/api/settings", environ_base=remote).status_code == 403  # no PIN set → remote off
    db.set_setting("access_pin", "4321")
    assert client.get("/api/settings", environ_base=remote).status_code == 401
    assert client.get("/", environ_base=remote).status_code == 302
    # tailscale serve proxies from localhost but adds headers: still remote
    assert client.get("/api/settings", headers={"X-Forwarded-For": "100.64.0.7"}).status_code == 401
    assert client.get("/manifest.json", environ_base=remote).status_code == 200
    assert client.post("/login", data={"pin": "0000"}, environ_base=remote).status_code in (200, 401)
    client.post("/login", data={"pin": "4321"}, environ_base=remote)
    assert client.get("/api/settings", environ_base=remote).status_code == 200
    assert client.get("/api/settings").status_code == 200  # local always fine
