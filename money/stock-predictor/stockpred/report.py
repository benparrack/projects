"""Self-contained HTML report (charts inlined as PNG)."""
from __future__ import annotations

import base64
import html
import io

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ACTION_COLOR = {"BUY": "#1a7f37", "LEAN BUY": "#4d9a5b", "WAIT": "#777", "AVOID / SELL": "#c0392b",
                "NO EDGE": "#999"}


def _png(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=90, bbox_inches="tight")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


def equity_chart(ticker: str, eq) -> str:
    fig, ax = plt.subplots(figsize=(7, 2.6))
    ax.plot(eq["date"], eq["buy_hold"], color="#999", lw=1.2, label="buy & hold")
    ax.plot(eq["date"], eq["strategy"], color="#2463eb", lw=1.4, label="model strategy")
    ax.set_yscale("log")
    ax.set_title(f"{ticker}: out-of-sample growth of $1", fontsize=10)
    ax.legend(fontsize=8, frameon=False)
    ax.grid(alpha=0.25)
    return _png(fig)


def calibration_chart(cal) -> str:
    fig, ax = plt.subplots(figsize=(5, 3))
    ax.plot(cal["p_mean"], cal["hit_rate"], "o-", color="#2463eb", label="actual")
    lo, hi = cal["p_mean"].min(), cal["p_mean"].max()
    ax.plot([lo, hi], [lo, hi], "--", color="#999", label="perfectly calibrated")
    ax.set_xlabel("model probability of going up")
    ax.set_ylabel("how often it actually went up")
    ax.legend(fontsize=8, frameon=False)
    ax.grid(alpha=0.25)
    return _png(fig)


def write(path, summary: dict, recs, bts: dict, cal) -> None:
    e = html.escape
    rows = []
    for r in recs:
        bt = bts[r.ticker]
        rows.append(
            f"<tr><td><b>{e(r.ticker)}</b></td><td>${r.close:,.2f}</td>"
            f"<td style='color:{ACTION_COLOR[r.action]};font-weight:600'>{e(r.action)}</td>"
            f"<td>{r.prob_up:.0%}</td><td>{r.hist_avg_ret:+.1%}</td>"
            f"<td>{'$%.2f / $%.2f' % (r.stop, r.target) if r.position_usd else '—'}</td>"
            f"<td>{'$%.0f' % r.position_usd if r.position_usd else '—'}</td>"
            f"<td>{bt['strategy']['cagr']:+.0%} / {bt['buy_hold']['cagr']:+.0%}</td>"
            f"<td>{bt['strategy']['sharpe']:.2f} / {bt['buy_hold']['sharpe']:.2f}</td>"
            f"<td>{bt['perm_p']:.2f}</td></tr>")
    detail = []
    for r in recs:
        detail.append(f"<h3>{e(r.ticker)} — <span style='color:{ACTION_COLOR[r.action]}'>{e(r.action)}</span>"
                      f" <small>(confidence: {e(r.confidence)})</small></h3><ul>"
                      + "".join(f"<li>{e(w)}</li>" for w in r.why) + "</ul>"
                      f"<img src='data:image/png;base64,{equity_chart(r.ticker, bts[r.ticker]['equity'])}'>")
    s = summary
    doc = f"""<!doctype html><html><head><meta charset="utf-8"><title>Stock Predictor Report</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{{font:14px/1.5 system-ui,sans-serif;max-width:1000px;margin:24px auto;padding:0 16px;color:#222;background:#fff}}
table{{border-collapse:collapse;width:100%;font-size:13px}}td,th{{padding:5px 8px;border-bottom:1px solid #eee;text-align:left}}
.box{{background:#f6f8fa;border-radius:8px;padding:12px 16px;margin:12px 0}}img{{max-width:100%}}
.warn{{background:#fff4e5;border-left:4px solid #e67e22;padding:10px 14px}}</style></head><body>
<h1>Stock Predictor — {e(s['as_of'])}</h1>
<div class="warn">This is a statistical experiment, not financial advice. Short-term moves of volatile stocks are
mostly noise. Read the "is there an edge?" box before acting on anything below.</div>
<div class="box"><b>Is there an edge?</b> {e(s['verdict'])}<br>
Pooled out-of-sample AUC: <b>{s['auc']:.3f}</b> (0.5 = coin flip, p = {s['auc_p']:.3f}) over {s['n_oos']:,} non-overlapping
predictions, {e(s['oos_range'])}. Average {s['horizon']}-day return by model-confidence fifth (least → most bullish):
{' · '.join(f"{q:+.2%}" for q in s['quintiles'])}.<br>Horizon {s['horizon']} trading days; buy threshold {s['buy_th']:.0%}; costs {s['cost_bps']} bps/side.</div>
<h2>Recommendations</h2>
<table><tr><th>Ticker</th><th>Close</th><th>Action</th><th>P(up)</th><th>Hist. avg {s['horizon']}d</th>
<th>Stop / target</th><th>Size (${s['account']:,.0f} acct)</th><th>CAGR strat / B&amp;H</th><th>Sharpe strat / B&amp;H</th><th>Timing p</th></tr>
{''.join(rows)}</table>
<p><small>Timing p: share of random time-shifts of the same trades that did as well; under 0.10 suggests the timing is real.
Stop = 2×ATR below, target = 3×ATR above. Size risks {s['risk_pct']:.0%} of the account to the stop.</small></p>
<h2>Calibration</h2><p>When the model said X%, how often did the stock actually go up?</p>
<img src="data:image/png;base64,{calibration_chart(cal)}">
<h2>Per-ticker detail</h2>{''.join(detail)}
</body></html>"""
    path.write_text(doc)
