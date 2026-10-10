"""CLI tables and the static HTML report."""
import html
import json
import time
from pathlib import Path
from datetime import datetime, timezone

from . import db
from .config import ROOT

STRAT_ORDER = None


def runs(con, mode):
    rows = con.execute("SELECT strategy, updated, summary FROM runs WHERE mode=?", (mode,)).fetchall()
    return {s: (u, json.loads(j)) for s, u, j in rows}


def pct(x):
    return "    —" if x is None else f"{x * 100:+6.1f}%"


def perf_table(con, mode):
    rs = runs(con, mode)
    if not rs:
        return f"(no {mode} results yet)"
    head = f"{'strategy':<26}{'equity':>9}{'return':>9}{'CAGR':>9}{'maxDD':>9}{'after-tax':>10}{'bench':>6}{'bench ret':>10}{'bench AT':>9}  beat?"
    lines = [head, "-" * len(head)]
    for sid, (_, m) in sorted(rs.items()):
        b = m["benchmark"]
        verdict = ("YES" if m["beat_benchmark"] else "no") + ("/YES" if m["beat_benchmark_after_tax"] else "/no")
        lines.append(f"{sid:<26}{m['final']:>9.0f}{pct(m['total_return']):>9}{pct(m.get('cagr')):>9}"
                     f"{pct(m['max_drawdown']):>9}{pct(m['after_tax_return']):>10}{b['symbol']:>6}"
                     f"{pct(b['total_return']):>10}{pct(b['after_tax_return']):>9}  {verdict}")
    lines.append("beat? = pre-tax/after-tax total return vs benchmark over the same period")
    return "\n".join(lines)


def trades_table(con, mode, strategy=None, limit=40):
    q = "SELECT strategy, t, sym, qty, px, fee, reason FROM trades WHERE mode=?"
    args = [mode]
    if strategy:
        q += " AND strategy=?"
        args.append(strategy)
    rows = con.execute(q + " ORDER BY t DESC LIMIT ?", (*args, limit)).fetchall()
    out = [f"{'time (UTC)':<17}{'strategy':<24}{'sym':<8}{'qty':>12}{'price':>11}{'$':>10}{'fee':>7}  reason"]
    for s, t, sym, q, px, fee, r in rows:
        out.append(f"{datetime.fromtimestamp(t, timezone.utc):%Y-%m-%d %H:%M} {s:<24}{sym:<8}{q:>12.4f}{px:>11.2f}"
                   f"{q * px:>10.2f}{fee:>7.2f}  {r}")
    return "\n".join(out) if rows else "(no trades)"


def status_text(con, cfg):
    now = time.time()
    lines = []
    ls = db.kv_get(con, "live_start")
    last = db.kv_get(con, "last_tick", {})
    lines.append(f"live paper trading since {datetime.fromtimestamp(ls).strftime('%Y-%m-%d %H:%M') if ls else '(not started)'}")
    if last:
        age = (now - last.get("t", 0)) / 60
        lines.append(f"last tick {age:.0f} min ago ({'OK' if not last.get('errors') else 'errors: ' + '; '.join(last['errors'])})")
    for k in ("src_edgar", "src_house", "src_senate", "src_hl", "src_prices"):
        v = db.kv_get(con, k)
        if v:
            lines.append(f"  {k[4:]:<8} last ok {(now - v) / 3600:.1f} h ago")
    for sid, l in con.execute("SELECT strategy, leaders FROM hl_selections h WHERE t=(SELECT max(t) FROM hl_selections "
                              "WHERE strategy=h.strategy)"):
        lines.append(f"  {sid} following: " + ", ".join(u[:10] for u, _ in json.loads(l)))
    lines.append("")
    lines.append(perf_table(con, "live"))
    return "\n".join(lines)


# ------------------------------------------------------------------ HTML
def svg_chart(series, w=560, h=170):
    if len(series) < 2:
        return "<p class=muted>not enough data yet</p>"
    t0, t1 = series[0][0], series[-1][0]
    vals = [v for _, a, b in series for v in (a, b)]
    lo, hi = min(vals), max(vals)
    if hi - lo < 1e-9:
        hi = lo + 1
    pad = (hi - lo) * 0.06
    lo, hi = lo - pad, hi + pad

    def xy(t, v):
        return (40 + (t - t0) / max(t1 - t0, 1) * (w - 50), 10 + (hi - v) / (hi - lo) * (h - 30))

    def path(ix):
        return " ".join(("M" if i == 0 else "L") + "%.1f,%.1f" % xy(p[0], p[ix]) for i, p in enumerate(series))

    y0 = xy(t0, series[0][1])[1]
    ticks = "".join(f'<text x="36" y="{xy(t0, v)[1] + 4:.0f}" text-anchor="end">{v:,.0f}</text>'
                    for v in (lo + pad, (lo + hi) / 2, hi - pad))
    d0 = datetime.fromtimestamp(t0, timezone.utc).strftime("%Y-%m-%d")
    d1 = datetime.fromtimestamp(t1, timezone.utc).strftime("%Y-%m-%d")
    return (f'<svg viewBox="0 0 {w} {h}" role="img"><line x1="40" x2="{w - 10}" y1="{y0:.1f}" y2="{y0:.1f}" class="base"/>'
            f'{ticks}<path d="{path(2)}" class="bench"/><path d="{path(1)}" class="strat"/>'
            f'<text x="40" y="{h - 4}">{d0}</text><text x="{w - 10}" y="{h - 4}" text-anchor="end">{d1}</text></svg>')


CSS = """
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#6b6a65;--card:#fff;--line:#e4e2dc;--strat:#2563eb;--bench:#a3a29c;--good:#15803d;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe6;--muted:#9a9993;--card:#1d1d1b;--line:#33322f;--strat:#60a5fa;--bench:#6b6a65;--good:#4ade80;--bad:#f87171}}
body{background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;margin:0;padding:24px 16px;max-width:1180px;margin:auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}.muted{color:var(--muted)}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:13px}
th,td{padding:5px 8px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left}
.wrap{overflow-x:auto}.good{color:var(--good)}.bad{color:var(--bad)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px}
.card h3{font-size:14px;margin:0 0 2px}svg{width:100%;height:auto}svg text{fill:var(--muted);font-size:10px}
path{fill:none;stroke-width:1.6}.strat{stroke:var(--strat)}.bench{stroke:var(--bench);stroke-dasharray:4 3}.base{stroke:var(--line)}
.key span{display:inline-block;width:14px;height:2px;vertical-align:middle;margin:0 4px 0 10px}
"""


def fmt(x):
    return "—" if x is None else f"{x * 100:+.1f}%"


def cls(a, b):
    return "good" if a > b else "bad"


def section(con, mode, title, note):
    rs = runs(con, mode)
    if not rs:
        return f"<h2>{title}</h2><p class=muted>No results yet.</p>"
    rows, cards = [], []
    for sid, (upd, m) in sorted(rs.items()):
        b = m["benchmark"]
        rows.append(
            f"<tr><td>{html.escape(sid)}</td><td>${m['final']:,.0f}</td>"
            f"<td class={cls(m['total_return'], b['total_return'])}>{fmt(m['total_return'])}</td><td>{fmt(b['total_return'])}</td>"
            f"<td>{fmt(m.get('cagr'))}</td><td>{fmt(b.get('cagr'))}</td>"
            f"<td>{fmt(m['max_drawdown'])}</td><td>{fmt(b['max_drawdown'])}</td>"
            f"<td class={cls(m['after_tax_return'], b['after_tax_return'])}>{fmt(m['after_tax_return'])}</td>"
            f"<td>{fmt(b['after_tax_return'])}</td><td>{fmt(m.get('after_tax_cagr'))}</td>"
            f"<td>{m['trades']}</td><td>${m['fees']:,.0f}</td><td>{b['symbol']}</td></tr>")
        series = con.execute("SELECT t, equity, bench FROM equity WHERE mode=? AND strategy=? ORDER BY t",
                             (mode, sid)).fetchall()
        extra = ""
        if m.get("liquidations"):
            extra = f" · {m['liquidations']} liquidations"
        if m.get("funding"):
            extra += f" · funding ${m['funding']:,.0f}"
        cards.append(f"<div class=card><h3>{html.escape(sid)}</h3><div class=muted>"
                     f"{fmt(m['total_return'])} vs {b['symbol']} {fmt(b['total_return'])}{extra}</div>{svg_chart(series)}</div>")
    return (f"<h2>{title}</h2><p class=muted>{note}</p><div class=wrap><table><tr><th>strategy</th><th>equity</th>"
            "<th>return</th><th>bench</th><th>CAGR</th><th>bench CAGR</th><th>max DD</th><th>bench DD</th>"
            "<th>after-tax</th><th>bench AT</th><th>AT CAGR</th><th>trades</th><th>fees*</th><th></th></tr>"
            + "".join(rows) + "</table></div>"
            '<p class="key muted"><span style="background:var(--strat)"></span>strategy'
            '<span style="background:var(--bench)"></span>benchmark (buy &amp; hold) · *fees exclude slippage, which is in the fill prices</p>'
            f"<div class=grid>{''.join(cards)}</div>")


def write_html(con, cfg):
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    t = cfg["tax"]
    body = (f"<h1>Copy-trader (paper)</h1><p class=muted>Generated {now}. Every strategy starts with "
            f"${cfg['start_capital']:,}. After-tax = US federal, short-term {t['short_term_rate']:.0%}, long-term "
            f"{t['long_term_rate']:.0%}, assuming everything is sold at the end. No real money is ever traded.</p>"
            + section(con, "live", "Live paper trading", "Same engine as the backtest, run forward from the live start.")
            + section(con, "backtest", "Backtest", "Stocks from 2020-01-01 vs SPY; crypto over the window Hyperliquid's API "
                      "still serves (~200 days) vs BTC. Read PROGRESS.md for the caveats (survivorship etc.)."))
    page = (f"<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>Copy-trader report</title><style>{CSS}</style></head><body>{body}</body></html>")
    out = Path(ROOT) / "report" / "index.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(page)
    return out
