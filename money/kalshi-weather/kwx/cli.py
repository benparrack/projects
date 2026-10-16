import argparse
import pickle

import pandas as pd

from . import backtest, data, dataset, live, report

OOS = live.STATE.parent / "oos.pkl"


def run_backtest(series):
    events, quotes = dataset.build(series)
    m = data.load_markets(series)
    print(f"bracket check (share of markets whose result disagrees with our reading): "
          f"{dataset.check_brackets(dataset.normalize(m), dataset.event_values(dataset.normalize(m)))}")
    print(f"{len(events)} forecast rows, {len(quotes)} quote rows; walking forward...")
    oos = backtest.walk_forward(events, quotes, progress=lambda mo, n: print(f"  {mo}: {n} quotes"))
    ev = backtest.evaluate(oos)
    models, blends = backtest.final_models(events, oos)
    live.save_state({"models": models, "blends": blends, "margin": ev["margin"], "verdict": ev["verdict"]})
    OOS.write_bytes(pickle.dumps((ev, oos)))
    h = ev["holdout"]
    print(f"\nVERDICT: {ev['verdict']}  margin {ev['margin']:.2f}  holdout {h['n']} trades, "
          f"ROI {h['roi']:+.1%}, p {h['p']:.3f}")
    for d, s in ev["scores"].items():
        print(f"  {d:15s} logloss market {s['market']['logloss']:.4f}  market_cal {s['market_cal']['logloss']:.4f}  "
              f"model {s['model']['logloss']:.4f}  blend {s['blend']['logloss']:.4f}  (n={s['n']})")
    for k, name in (("recent", f"since settlement switch {backtest.SOURCE_SWITCH}"), ("market_cal", "baseline: market recalibrated, no weather"), ("slipped", "same trades 1c worse")):
        print(f"  {name}: ROI {ev[k]['roi']:+.1%}, p {ev[k]['p']:.3f}" if ev[k].get("n") else f"  {name}: no trades")
    print("report:", report.build(ev, oos, blends))


def show(t):
    if t.empty:
        print("No picks right now (decision windows: day-of highs 07-09 local, evening-before 18-24 local).")
        return
    cols = ["mode", "ticker", "decision", "side", "price", "p_side", "ev", "contracts"]
    with pd.option_context("display.width", 200, "display.max_rows", 200):
        print(t[cols].round(3).to_string(index=False))


def main():
    p = argparse.ArgumentParser(prog="kwx", description="Kalshi temperature-market model")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("pull", help="download/refresh markets, quotes and archived forecasts")
    c.add_argument("series", nargs="*", help="e.g. KXHIGHNY (default: every daily high/low series)")
    c = sub.add_parser("backtest", help="walk-forward test, verdict, train live models, write report")
    c.add_argument("series", nargs="*")
    c = sub.add_parser("scan", help="today's picks from live quotes; logs them to the paper ledger")
    c.add_argument("--bankroll", type=float, default=100.0)
    c.add_argument("--no-log", action="store_true", help="don't record picks in data/paper.csv")
    sub.add_parser("settle", help="fill in results of settled paper trades")
    sub.add_parser("report", help="rebuild reports/latest.html with current picks and the ledger")
    a = p.parse_args()

    if a.cmd == "pull":
        data.pull(a.series or None)
    elif a.cmd == "backtest":
        run_backtest(a.series or None)
    elif a.cmd == "scan":
        state = live.load_state()
        t = live.picks(state, a.bankroll)
        show(t)
        if state["verdict"] != "EDGE":
            print(f"\nBacktest verdict is {state['verdict']}: these are paper trades only.")
        if len(t) and not a.no_log:
            print(f"logged {live.log_paper(t)} new paper trades")
    elif a.cmd in ("settle", "report"):
        led = live.settle()
        s = live.ledger_summary(led)
        print("paper ledger:", s)
        if a.cmd == "report":
            if not OOS.exists():
                raise SystemExit("run `./run.sh backtest` first")
            ev, oos = pickle.loads(OOS.read_bytes())
            state = live.load_state()
            print("report:", report.build(ev, oos, state["blends"], live.picks(state, 100.0), led, s))
