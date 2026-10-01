"""Command-line entry point: `scan` finds volatile stocks, `run` trains + recommends."""
from __future__ import annotations

import argparse
import datetime as dt
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from . import data, evaluate, features, model, recommend, report

WATCHLIST = data.ROOT / "watchlist.txt"


def _drop_partial_bar(df: pd.DataFrame) -> pd.DataFrame:
    """yfinance includes today's still-forming bar during US market hours; drop it."""
    now = dt.datetime.now(ZoneInfo("America/New_York"))
    if len(df) and df.index[-1].date() == now.date() and now.hour * 60 + now.minute < 16 * 60 + 15:
        return df.iloc[:-1]
    return df


def cmd_scan(a) -> None:
    print(f"Screening {len(data.CANDIDATES)} candidates by 6-month volatility (liquidity >= $50M/day)...")
    res = data.screen_volatile(data.CANDIDATES, top=a.top, refresh=a.refresh)
    if res.empty:
        print("No data. Check your internet connection.")
        return
    print(res.to_string(index=False, formatters={
        "ann_vol": "{:.0%}".format, "ret_6m": "{:+.0%}".format,
        "dollar_vol_m": "${:,.0f}M".format, "years_history": "{:.1f}".format}))
    WATCHLIST.write_text("\n".join(res["ticker"]) + "\n")
    print(f"\nSaved to {WATCHLIST.name}. Run `./run.sh run --watchlist` next.")


def cmd_run(a) -> None:
    tickers = [t.upper() for t in a.tickers]
    if a.watchlist:
        if not WATCHLIST.exists():
            raise SystemExit("No watchlist.txt yet. Run `./run.sh scan` first, or pass tickers.")
        tickers += [l.strip().upper() for l in WATCHLIST.read_text().split() if l.strip() and not l.startswith("#")]
    tickers = list(dict.fromkeys(tickers))
    if not tickers and not a.csv:
        raise SystemExit("Give tickers (e.g. `run TSLA COIN`), --watchlist, or --csv FILE.")

    targets = set(tickers) | {Path(c).stem.upper() for c in a.csv or []}
    universe = tickers + ([t for t in data.CANDIDATES if t not in tickers] if a.train_on == "all" else [])
    print(f"Loading price history for {len(universe)} tickers "
          f"({len(tickers)} to recommend{', rest for training only' if a.train_on == 'all' else ''})...")
    raw = data.fetch_many(universe, a.years, a.refresh)
    for path in a.csv or []:
        name = Path(path).stem.upper()
        raw[name] = data.load_csv(path)
        print(f"  loaded {name} from {path} ({len(raw[name])} rows)")
    raw = {t: _drop_partial_bar(df) for t, df in raw.items()}
    if not raw:
        raise SystemExit("No usable data.")

    spy = _drop_partial_bar(data.fetch("SPY", a.years, a.refresh))
    try:
        vix = data.fetch("^VIX", a.years, a.refresh)
    except Exception:
        vix = None
    mkt = features.market_features(spy, vix)
    frames = {t: features.build(df, mkt, a.horizon) for t, df in raw.items()}
    for t, f in frames.items():
        frames[t] = f.iloc[200:]  # warm-up for the 200-day indicators
    panel = model.make_panel(frames)
    cols = features.feature_cols(panel)
    panel[cols] = panel[cols].replace([np.inf, -np.inf], np.nan)

    print(f"Walk-forward training on {len(panel):,} rows, {len(cols)} features "
          f"(retrain every {a.retrain} days, {a.horizon}-day horizon)...")
    oos = model.walk_forward(panel, a.horizon, a.retrain, a.min_train)
    if oos.empty:
        raise SystemExit("Not enough history for a walk-forward test (need ~3+ years).")

    fair = evaluate.non_overlapping(oos, a.horizon)
    auc, auc_p = evaluate.auc_with_p(fair["target"], fair["prob"])
    cal = evaluate.calibration(oos)
    quint = evaluate.quintile_returns(fair)
    # A real edge has to be both statistically and economically there: the
    # model's most-confident "up" picks must actually earn more than its least
    # confident ones and more than just holding everything.
    top, bottom, avg_all = quint.iloc[-1], quint.iloc[0], float(np.expm1(fair["fwd_ret"]).mean())
    model_edge = auc_p < 0.05 and auc >= 0.51 and top > bottom and top > avg_all
    spread = (f"its top-fifth picks averaged {top:+.2%} per {a.horizon}d vs {bottom:+.2%} for its bottom fifth "
              f"and {avg_all:+.2%} for everything")
    if model_edge:
        verdict = (f"A small one. AUC {auc:.3f} (p={auc_p:.3f}), and {spread}. Expect many wrong calls.")
    else:
        verdict = (f"No. Out of sample the model was not usefully better than a coin flip: AUC {auc:.3f} "
                   f"(p={auc_p:.2f}), and {spread}. It won't make BUY calls; buy-and-hold was the better plan.")

    print("Fitting final model on all history and scoring today...")
    final, cols = model.fit_final(panel)
    last = model.latest_probs(panel, final, cols)

    bts, recs = {}, []
    exit_th = a.exit_threshold if a.exit_threshold is not None else 0.5
    for t in frames:
        if t not in targets:
            continue
        t_oos = oos[oos["ticker"] == t]
        if t_oos.empty:
            continue
        bts[t] = evaluate.backtest(t_oos, a.buy_threshold, exit_th, a.cost_bps)
        tf = evaluate.non_overlapping(t_oos, a.horizon)
        t_auc, _ = evaluate.auc_with_p(tf["target"], tf["prob"]) if len(tf) > 30 else (float("nan"), 1.0)
        recs.append(recommend.recommend(t, last.loc[t], cal, model_edge, bts[t], t_auc, a.horizon,
                                        a.buy_threshold, a.account))
    order = {"BUY": 0, "LEAN BUY": 1, "WAIT": 2, "AVOID / SELL": 3, "NO EDGE": 4}
    recs.sort(key=lambda r: (order[r.action], -r.prob_up))

    print("\n" + "=" * 78)
    print(f"IS THERE AN EDGE?  {verdict}")
    print("=" * 78)
    hdr = f"{'ticker':<7}{'close':>10}  {'action':<13}{'P(up)':>6}{'hist avg':>9}  {'stop':>9}{'target':>9}{'size $':>8}  {'strat/B&H Sharpe':>17}"
    print(hdr)
    print("-" * len(hdr))
    for r in recs:
        bt = bts[r.ticker]
        sz = f"{r.position_usd:,.0f}" if r.position_usd else "-"
        st = f"{r.stop:,.2f}" if r.position_usd else "-"
        tg = f"{r.target:,.2f}" if r.position_usd else "-"
        print(f"{r.ticker:<7}{r.close:>10,.2f}  {r.action:<13}{r.prob_up:>6.0%}{r.hist_avg_ret:>+9.1%}  "
              f"{st:>9}{tg:>9}{sz:>8}  {bt['strategy']['sharpe']:>8.2f} / {bt['buy_hold']['sharpe']:<6.2f}")
    as_of = max(r.as_of for r in recs)
    print(f"\nAs of close {as_of}. Horizon {a.horizon} trading days. Not financial advice.")

    if a.explain:
        for r in recs:
            print(f"\n{r.ticker} — {r.action}")
            for w in r.why:
                print(f"  - {w}")

    out_dir = data.ROOT / "reports"
    out_dir.mkdir(exist_ok=True)
    path = out_dir / f"report_{as_of}.html"
    report.write(path, {
        "as_of": as_of, "verdict": verdict, "auc": auc, "auc_p": auc_p, "n_oos": len(fair), "quintiles": quint.tolist(),
        "oos_range": f"{oos['date'].min().date()} to {oos['date'].max().date()}",
        "horizon": a.horizon, "buy_th": a.buy_threshold, "cost_bps": a.cost_bps,
        "account": a.account, "risk_pct": 0.01,
    }, recs, bts, cal)
    (out_dir / "latest.html").write_text(path.read_text())
    print(f"Report: {path}")


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="stockpred", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("scan", help="find the most volatile liquid stocks and save them to watchlist.txt")
    s.add_argument("--top", type=int, default=12)
    s.add_argument("--refresh", action="store_true", help="re-download even if cached today")
    s.set_defaults(fn=cmd_scan)

    r = sub.add_parser("run", help="train walk-forward, backtest, and recommend")
    r.add_argument("tickers", nargs="*", help="e.g. TSLA COIN PLTR (Stockholm: EVO.ST, SINCH.ST)")
    r.add_argument("--watchlist", action="store_true", help="include tickers from watchlist.txt")
    r.add_argument("--csv", nargs="+", help="your own OHLCV CSV file(s); file name becomes the ticker")
    r.add_argument("--horizon", type=int, default=5, help="days ahead to predict (default 5)")
    r.add_argument("--buy-threshold", type=float, default=0.55, help="P(up) needed to BUY (default 0.55)")
    r.add_argument("--exit-threshold", type=float, default=None, help="backtest exits below this P(up) (default 0.50)")
    r.add_argument("--account", type=float, default=1000, help="account size in $ for position sizing")
    r.add_argument("--cost-bps", type=float, default=10, help="trading cost per side in basis points")
    r.add_argument("--years", type=int, default=10, help="years of history to download")
    r.add_argument("--retrain", type=int, default=63, help="retrain every N trading days in the backtest")
    r.add_argument("--min-train", type=int, default=504, help="trading days of history before the first test")
    r.add_argument("--train-on", choices=["all", "mine"], default="all",
                   help="all = also train on the ~60 built-in volatile stocks (more data, default); mine = only yours")
    r.add_argument("--explain", action="store_true", help="print the reasoning for each ticker")
    r.add_argument("--refresh", action="store_true")
    r.set_defaults(fn=cmd_run)

    a = p.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
