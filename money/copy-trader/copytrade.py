#!/usr/bin/env python3
"""Copy Trader: paper-only copy-trading simulator. See README.md."""
import argparse
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ct import config, db  # noqa: E402


def main():
    ap = argparse.ArgumentParser(prog="copytrade")
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch-history", help="download backtest data (slow; resumable)")
    f.add_argument("what", nargs="*", default=["13f", "house", "senate", "prices", "hl"])
    b = sub.add_parser("backtest", help="run every strategy over history and store the results")
    b.add_argument("--only", nargs="*", help="strategy ids")
    b.add_argument("--kinds", nargs="*", default=["stocks", "crypto"])
    sub.add_parser("tick", help="one live paper-trading step (what the systemd timer runs)")
    sub.add_parser("status", help="live state + live performance")
    p = sub.add_parser("perf", help="per-strategy performance table")
    p.add_argument("--mode", default="live", choices=["live", "backtest"])
    t = sub.add_parser("trades", help="trade log")
    t.add_argument("--mode", default="live", choices=["live", "backtest"])
    t.add_argument("--strategy")
    t.add_argument("-n", type=int, default=40)
    sub.add_parser("report", help="regenerate report/index.html")
    sub.add_parser("notify-test", help="send the daily summary now")
    a = ap.parse_args()
    quiet = a.cmd in ("status", "perf", "trades")
    logging.basicConfig(level=logging.WARNING if quiet else logging.INFO,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    logging.getLogger("yfinance").setLevel(logging.CRITICAL)
    cfg = config.load()
    con = db.connect(cfg["db_path"])
    if a.cmd == "fetch-history":
        from ct import ingest
        steps = {"13f": ingest.run_13f, "house": ingest.run_house, "senate": ingest.run_senate,
                 "prices": ingest.run_stock_prices, "hl": ingest.run_hl_history}
        for w in a.what:
            logging.info("fetch %s -> %s new", w, steps[w](con, cfg))
    elif a.cmd == "backtest":
        from ct import report, runner
        runner.run_mode(con, cfg, "backtest", kinds=a.kinds, only=a.only)
        print(report.perf_table(con, "backtest"))
        report.write_html(con, cfg)
    elif a.cmd == "tick":
        from ct import live
        errs = live.tick(con, cfg)
        if errs:
            logging.warning("tick finished with errors: %s", errs)
    elif a.cmd == "status":
        from ct import report
        print(report.status_text(con, cfg))
    elif a.cmd == "perf":
        from ct import report
        print(report.perf_table(con, a.mode))
    elif a.cmd == "trades":
        from ct import report
        print(report.trades_table(con, a.mode, a.strategy, a.n))
    elif a.cmd == "report":
        from ct import report
        print(report.write_html(con, cfg))
    elif a.cmd == "notify-test":
        from ct import notify
        print(notify.summary(con))
        notify.send(cfg, "Copy-trader test (paper)", notify.summary(con))


if __name__ == "__main__":
    main()
