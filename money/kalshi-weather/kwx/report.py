"""Self-contained HTML report (charts embedded as base64 PNGs, like money/stock-predictor)."""
import base64
import html
import io
from datetime import datetime, timezone

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from .backtest import SOURCE_SWITCH
from .model import mid
from .stations import DATA

OUT = DATA.parent / "reports" / "latest.html"
KINDS = ("market", "market_cal", "model", "blend")
COLORS = {"EDGE": "#1a7f37", "MAYBE": "#9a6700", "NO EDGE": "#cf222e"}


def _png(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=110, bbox_inches="tight")
    plt.close(fig)
    return f'<img src="data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}">'


def reliability(oos):
    fig, ax = plt.subplots(figsize=(5.2, 4.6))
    bins = np.linspace(0, 1, 11)
    for name, p in [("market mid", mid(oos)), ("model", oos["p_model"].to_numpy()), ("blend", oos["p_blend"].to_numpy())]:
        i = np.clip(np.digitize(p, bins) - 1, 0, 9)
        g = pd.DataFrame({"i": i, "p": p, "y": oos["yes"].to_numpy()}).groupby("i").agg(p=("p", "mean"), y=("y", "mean"), n=("y", "size"))
        g = g[g["n"] >= 30]
        ax.plot(g["p"], g["y"], "o-", label=name, ms=4)
    ax.plot([0, 1], [0, 1], "k:", lw=1)
    ax.set(xlabel="predicted P(YES)", ylabel="share that settled YES", title="Calibration, all out-of-sample quotes")
    ax.legend()
    return _png(fig)


def equity(ev):
    fig, ax = plt.subplots(figsize=(7.5, 3.6))
    t = ev["trades"]
    if len(t):
        d = t.groupby("date")["pnl"].sum().cumsum() * 10  # dollars at 10 contracts per trade
        ax.plot(pd.to_datetime(d.index), d.to_numpy(), lw=1.6)
    ax.axhline(0, color="k", lw=0.8)
    ax.set(ylabel="cumulative P&L ($, 10 contracts/trade)", title="Holdout equity curve (after taker fees)")
    fig.autofmt_xdate()
    return _png(fig)


def table(df, fmt=None):
    fmt = {c: (lambda x: str(int(x))) for c in ("n", "days", "val_n", "hold_n", "rows", "contracts") if c in df} | (fmt or {})
    rows = "".join("<tr>" + "".join(f"<td>{html.escape(fmt.get(c, str)(v) if pd.notna(v) else '–')}</td>"
                                    for c, v in r.items()) + "</tr>" for _, r in df.iterrows())
    return f"<table><tr>{''.join(f'<th>{html.escape(str(c))}</th>' for c in df.columns)}</tr>{rows}</table>"


pct = lambda x: f"{x:+.1%}"
money = lambda x: f"{x:+.2f}"
p3 = lambda x: f"{x:.3f}"


def stat_block(name, s):
    if not s.get("n"):
        return f"<li><b>{name}</b>: no trades</li>"
    return (f"<li><b>{name}</b>: {s['n']} trades over {s['days']} days, ROI {s['roi']:+.1%} "
            f"(${s['pnl']:+.2f} on ${s['cost']:.2f} staked at 1 contract per trade), win rate {s['win']:.0%}, "
            f"p(ROI&le;0) = {s['p']:.3f}</li>")


def build(ev, oos, blends, picks=None, ledger=None, ledger_stats=None):
    v = ev["verdict"]
    sc = pd.DataFrame([{"decision": d, "rows": s["n"], **{f"{k} logloss": s[k]["logloss"] for k in KINDS},
                        **{f"{k} brier": s[k]["brier"] for k in KINDS}} for d, s in ev["scores"].items()])
    grid = ev["grid"][["margin", "val_n", "val_roi", "val_p", "hold_n", "hold_roi", "hold_p"]]
    weights = "".join(f"<li>{d}: model logit ×{w[0]:.2f}, market logit ×{w[1]:.2f}</li>" for d, w in
                      ((d, b.weights) for d, b in blends.items()))
    parts = [f"""<h1>Kalshi temperature markets: model vs. market</h1>
<p class="muted">Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC. Validation {ev['val_range'][0]} → {ev['val_range'][1]},
holdout {ev['hold_range'][0]} → {ev['hold_range'][1]} (never used to pick anything).</p>
<div class="verdict" style="background:{COLORS[v]}">{v}</div>
<p>EDGE needs ≥100 holdout trades, positive ROI after taker fees, a date-block-bootstrap p &lt; 0.05, and no losing
record since the settlement-source switch (≥100 trades). Otherwise MAYBE: positive but unproven, so picks stay paper.
Trade rule: buy the side whose blended probability beats its price plus fee by more than <b>{ev['margin']:.2f}</b>
(picked on the validation half), at most one trade per city, day and decision time.</p>
<h2>Holdout results</h2><ul>{stat_block('Strategy (blend)', ev['holdout'])}
{stat_block(f'Same strategy since Kalshi switched settlement to The Weather Company ({SOURCE_SWITCH})', ev['recent'])}{stat_block('Model only, same rule', ev['model_only'])}
{stat_block('Same trades filled 1¢ worse', ev['slipped'])}
{stat_block('Baseline: market price recalibrated on history, no weather', ev['market_cal'])}
{stat_block('Baseline: buy favorites ≥85¢', ev['favorites'])}</ul>
{equity(ev)}
<h2>Is the model better than the market?</h2>
<p>Lower is better. market_cal is the market price passed through a logistic fit on past months (it captures
the favorite-longshot bias without any weather). The blend is a logistic regression on the model's and the market's log-odds, fit only on earlier months.</p>
{table(sc, {c: p3 for c in sc.columns if 'loss' in c or 'brier' in c})}
<p>Final blend weights:</p><ul>{weights}</ul>
{reliability(oos[np.isfinite(oos['p_blend'])])}
<h2>Threshold grid</h2>{table(grid, {'val_roi': pct, 'hold_roi': pct, 'val_p': p3, 'hold_p': p3})}
<h2>Holdout by segment</h2>{table(ev['segments'][['segment', 'n', 'days', 'roi', 'win', 'p', 'pnl']], {'roi': pct, 'win': lambda x: f'{x:.0%}', 'p': p3, 'pnl': money})}
<h2>Holdout by city</h2>{table(ev['by_city'][['series', 'n', 'days', 'roi', 'win', 'p', 'pnl']], {'roi': pct, 'win': lambda x: f'{x:.0%}', 'p': p3, 'pnl': money})}"""]
    if picks is not None:
        parts.append("<h2>Current picks</h2>" + (table(picks[["mode", "ticker", "decision", "side", "price", "p_side", "ev", "contracts"]],
                                                         {"price": p3, "p_side": p3, "ev": p3}) if len(picks) else "<p>None right now.</p>"))
    if ledger is not None and len(ledger):
        s = ledger_stats or {}
        head = (f"{s.get('settled', 0)} of {s.get('n', 0)} settled" +
                (f", P&amp;L ${s['pnl']:+.2f}, ROI {s['roi']:+.1%}" if s.get("settled") else ""))
        parts.append(f"<h2>Paper ledger</h2><p>{head}</p>" + table(ledger.tail(60)))
    style = """<style>body{font:15px/1.5 system-ui,sans-serif;max-width:980px;margin:24px auto;padding:0 16px;color:#1f2328;background:#fff}
table{border-collapse:collapse;margin:8px 0 18px;font-size:13px;display:block;overflow-x:auto}td,th{border:1px solid #d0d7de;padding:3px 8px;text-align:right}
th{background:#f6f8fa}.verdict{color:#fff;font-size:28px;font-weight:700;padding:10px 18px;display:inline-block;border-radius:6px}
.muted{color:#656d76}img{max-width:100%}</style>"""
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(f"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><title>Kalshi Weather Edge</title>{style}{''.join(parts)}")
    return OUT
