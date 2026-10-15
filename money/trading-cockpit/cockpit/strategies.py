"""The starting population for the natural-selection run: published, rule-based stock strategies and their common
parameter variants, written in the Lab's rule language, plus placebo "coin flip" strategies as a control group.

Every family cites where the idea comes from. The parameter grids are the commonly quoted settings, not tuned ones:
the point of the evolution run is to find out which survive, so nothing here was picked by looking at results.
"""
from __future__ import annotations

from itertools import product

SOURCES = {
    "connors": ("Connors & Alvarez, Short Term Trading Strategies That Work (2008)",
                "https://www.amazon.com/dp/0981923909"),
    "double7": ("Connors & Alvarez, the Double 7 strategy (tested by StrategyQuant)",
                "https://strategyquant.com/blog/larry-connors-double-7-strategy-tested-on-spy-and-8-other-markets/"),
    "qs_ibs": ("Quantified Strategies, Internal Bar Strength (IBS)",
               "https://quantifiedstrategies.substack.com/p/ibs-internal-bar-strength-trading-64c"),
    "qs_mr": ("Quantified Strategies, mean-reversion strategies",
              "https://quantifiedstrategies.substack.com/p/3-best-mean-reversion-trading-strategies"),
    "qs_macd": ("Quantified Strategies, MACD histogram rules",
                "https://quantifiedstrategies.substack.com/p/macd-histogram-trading-strategy-rules"),
    "bollinger": ("John Bollinger, Bollinger on Bollinger Bands (2001)", "https://www.bollingerbands.com/bollinger-bands"),
    "williams": ("Larry Williams, Williams %R; Long-Term Secrets to Short-Term Trading (1999)",
                 "https://www.investopedia.com/terms/w/williamsr.asp"),
    "lane": ("George Lane, stochastic oscillator", "https://www.investopedia.com/terms/s/stochasticoscillator.asp"),
    "reversal": ("Jegadeesh (1990), Lehmann (1990): short-term return reversal",
                 "https://doi.org/10.1111/j.1540-6261.1990.tb05110.x"),
    "gap": ("Gap-fade / gap-down reversal setups (Connors; Bulkowski, Encyclopedia of Chart Patterns)",
            "https://thepatternsite.com/"),
    "lambert": ("Donald Lambert, Commodity Channel Index (1980)", "https://www.investopedia.com/terms/c/commoditychannelindex.asp"),
    "mfi": ("Quong & Soudack, Money Flow Index", "https://www.investopedia.com/terms/m/mfi.asp"),
    "raschke": ("Raschke & Connors, Street Smarts (1995): the Holy Grail ADX pullback",
                "https://www.amazon.com/dp/0965046109"),
    "pullback": ("Buy-the-dip in an uptrend, e.g. Connors, How Markets Really Work (2004)",
                 "https://www.amazon.com/dp/0470915021"),
    "crabel": ("Toby Crabel, Day Trading with Short Term Price Patterns (1990): NR4/NR7, inside days",
               "https://www.amazon.com/dp/0934380171"),
    "turtle": ("Curtis Faith, Way of the Turtle (2007); Richard Donchian channels",
               "https://www.amazon.com/dp/007148664X"),
    "hwang": ("George & Hwang (2004), The 52-Week High and Momentum Investing, Journal of Finance",
              "https://doi.org/10.1111/j.1540-6261.2004.00695.x"),
    "ma_cross": ("Brock, Lakonishok & LeBaron (1992), Simple Technical Trading Rules, Journal of Finance",
                 "https://doi.org/10.1111/j.1540-6261.1992.tb04681.x"),
    "faber": ("Meb Faber (2007), A Quantitative Approach to Tactical Asset Allocation",
              "https://papers.ssrn.com/abstract=962461"),
    "appel": ("Gerald Appel, MACD", "https://www.investopedia.com/terms/m/macd.asp"),
    "tsmom": ("Moskowitz, Ooi & Pedersen (2012), Time Series Momentum, JFE",
              "https://doi.org/10.1016/j.jfineco.2011.11.003"),
    "wilder": ("J. Welles Wilder, New Concepts in Technical Trading Systems (1978): ADX / DMI",
               "https://www.investopedia.com/terms/a/adx.asp"),
    "oneil": ("William O'Neil, How to Make Money in Stocks: breakouts on heavy volume",
              "https://www.amazon.com/dp/0071614133"),
    "granville": ("Joseph Granville, On-Balance Volume (1963)", "https://www.investopedia.com/terms/o/onbalancevolume.asp"),
    "keltner": ("Chester Keltner (1960) / Linda Raschke: Keltner channels", "https://www.investopedia.com/terms/k/keltnerchannel.asp"),
    "lebeau": ("Chuck LeBeau, the Chandelier exit; Supertrend (Olivier Seban)",
               "https://www.investopedia.com/terms/c/chandelierexit.asp"),
    "lwvb": ("Larry Williams, volatility breakout (range-expansion day), Long-Term Secrets to Short-Term Trading",
             "https://www.amazon.com/dp/0471297224"),
    "streak": ("Momentum continuation after up-streaks (Connors; Quantified Strategies)",
               "https://quantifiedstrategies.substack.com/"),
    "tom": ("Ariel (1987); Lakonishok & Smidt (1988): turn-of-the-month effect", "https://doi.org/10.1016/0304-405X(87)90066-3"),
    "dow": ("French (1980), Stock Returns and the Weekend Effect, JFE; Connors' 'Turnaround Tuesday'",
            "https://doi.org/10.1016/0304-405X(80)90021-5"),
    "placebo": ("Control group: random entries. If these survive as often as real strategies, selection is luck.", ""),
}

FAMILIES = {
    "rsi2": ("RSI-2 dip", "Mean reversion", "connors"),
    "cumrsi": ("Cumulative RSI-2", "Mean reversion", "connors"),
    "double7": ("Double 7", "Mean reversion", "double7"),
    "ibs": ("Low IBS", "Mean reversion", "qs_ibs"),
    "rsi3ibs": ("RSI-3 + IBS", "Mean reversion", "qs_mr"),
    "downdays": ("Down-day streak", "Mean reversion", "connors"),
    "boll": ("Bollinger lower band", "Mean reversion", "bollinger"),
    "willr": ("Williams %R oversold", "Mean reversion", "williams"),
    "stoch": ("Stochastic oversold", "Mean reversion", "lane"),
    "macdh": ("MACD histogram fade", "Mean reversion", "qs_macd"),
    "reversal": ("Short-term reversal", "Mean reversion", "reversal"),
    "gapdown": ("Gap-down reversal", "Mean reversion", "gap"),
    "cci": ("CCI oversold", "Mean reversion", "lambert"),
    "mfi": ("MFI oversold", "Mean reversion", "mfi"),
    "kelt_lo": ("Keltner lower band", "Mean reversion", "keltner"),
    "holygrail": ("Holy Grail pullback", "Pullback", "raschke"),
    "pullback": ("Uptrend pullback", "Pullback", "pullback"),
    "nr": ("Narrow range (NR4/NR7)", "Volatility", "crabel"),
    "inside": ("Inside day", "Volatility", "crabel"),
    "rangex": ("Range expansion", "Volatility", "lwvb"),
    "donchian": ("Donchian / Turtle breakout", "Trend", "turtle"),
    "hi52": ("52-week high", "Momentum", "hwang"),
    "macross": ("Moving-average crossover", "Trend", "ma_cross"),
    "priceabove": ("Price crosses its average", "Trend", "faber"),
    "macd": ("MACD crossover", "Trend", "appel"),
    "tsmom": ("Time-series momentum", "Momentum", "tsmom"),
    "dmi": ("ADX / DMI trend", "Trend", "wilder"),
    "volbo": ("Breakout on volume", "Momentum", "oneil"),
    "obv": ("OBV breakout", "Momentum", "granville"),
    "kelt_hi": ("Keltner breakout", "Trend", "keltner"),
    "chandelier": ("Chandelier / Supertrend flip", "Trend", "lebeau"),
    "upstreak": ("Up-streak continuation", "Momentum", "streak"),
    "tom": ("Turn of the month", "Calendar", "tom"),
    "weekday": ("Day of the week", "Calendar", "dow"),
    "placebo": ("Placebo (coin flip)", "Control", "placebo"),
}

TREND = "close > sma(close, 200) and "


def _fmt(x) -> str:
    return f"{x:g}"


def library() -> list[dict]:
    out: list[dict] = []

    def add(fam, label, entry, exit="", stop_type="none", stop_value=0, target_r=None, max_hold=10):
        out.append({"family": fam, "name": f"{FAMILIES[fam][0]} · {label}", "entry": entry, "exit": exit,
                    "stop_type": stop_type, "stop_value": stop_value, "target_r": target_r, "max_hold": max_hold})

    trend = ((True, "above 200d"), (False, "any trend"))

    # ---- mean reversion: buy short-term weakness, sell the bounce. Connors uses no stop, a time limit instead.
    for t, (f, fl), ex in product((2, 5, 10, 15, 20), trend, ("sma5", "rsi70")):
        add("rsi2", f"RSI(2)<{t}, {fl}, exit {'close>SMA5' if ex == 'sma5' else 'RSI>70'}",
            (TREND if f else "") + f"rsi(2) < {t}", "close > sma(close, 5)" if ex == "sma5" else "rsi(2) > 70")
    for t, (f, fl) in product((10, 20, 35, 50), trend):
        add("cumrsi", f"2-day RSI sum<{t}, {fl}", (TREND if f else "") + f"rsi(2) + prev(rsi(2), 1) < {t}", "rsi(2) > 65")
    for n, (f, fl) in product((5, 7, 10, 14), trend):
        add("double7", f"{n}-day low close, {fl}", (TREND if f else "") + f"close < lowest(close, {n - 1})",
            f"close > highest(close, {n - 1})", max_hold=20)
    for t, (f, fl), ex in product((0.1, 0.15, 0.2, 0.25), trend, ("hi", "ibs")):
        add("ibs", f"IBS<{_fmt(t)}, {fl}, exit {'close>yday high' if ex == 'hi' else 'IBS>0.8'}",
            (TREND if f else "") + f"ibs() < {t}", "close > prev(high)" if ex == "hi" else "ibs() > 0.8", max_hold=5)
    for t, (f, fl) in product((10, 20, 30), trend):
        add("rsi3ibs", f"RSI(3)<{t} & IBS<0.25, {fl}", (TREND if f else "") + f"rsi(3) < {t} and ibs() < 0.25",
            "close > prev(high)", max_hold=5)
    for n, (f, fl), mh in product((3, 4, 5), trend, (3, 5)):
        add("downdays", f"{n} down closes, {fl}, {mh}d", (TREND if f else "") + f"streak() <= -{n}",
            "close > prev(high)", max_hold=mh)
    for n, k, (f, fl) in product((10, 20), (1.5, 2, 2.5), trend):
        add("boll", f"close<BB({n},{_fmt(k)}), {fl}", (TREND if f else "") + f"close < sma(close, {n}) - {k} * stdev(close, {n})",
            f"close > sma(close, {n})", max_hold=15)
    for n, t, (f, fl) in product((2, 5, 14), (-90, -95), trend):
        add("willr", f"%R({n})<{t}, {fl}", (TREND if f else "") + f"willr({n}) < {t}", f"willr({n}) > -30")
    for n, t, (f, fl) in product((5, 14), (10, 20), trend):
        add("stoch", f"%K({n})<{t}, {fl}", (TREND if f else "") + f"stoch({n}) < {t}", f"stoch({n}) > 80")
    for k, (f, fl) in product((3, 4), trend):
        falling = " and ".join(f"prev(macd_hist(), {i}) < prev(macd_hist(), {i + 1})" if i else "macd_hist() < prev(macd_hist(), 1)"
                               for i in range(k))
        add("macdh", f"{k} falling bars, {fl}", (TREND if f else "") + falling + f" and prev(macd_hist(), {k - 1}) < 0 and close < prev(close)",
            "close > prev(close)", max_hold=10)
    for n, x, (f, fl) in product((3, 5, 10), (0.05, 0.08, 0.12), trend):
        add("reversal", f"{n}-day drop >{x:.0%}, {fl}", (TREND if f else "") + f"ret({n}) < -{x}", max_hold=n * 2)
    for g, (f, fl) in product((0.01, 0.02, 0.03, 0.05), trend):
        add("gapdown", f"gap {g:.0%} below low, green close, {fl}", (TREND if f else "") + f"open < prev(low) * {1 - g:g} and close > open",
            stop_type="atr", stop_value=2, target_r=2, max_hold=5)
    for t, (f, fl) in product((100, 150, 200), trend):
        add("cci", f"CCI(20)<-{t}, {fl}", (TREND if f else "") + f"cci(20) < -{t}", "cci(20) > 0")
    for t, (f, fl) in product((10, 20), trend):
        add("mfi", f"MFI(14)<{t}, {fl}", (TREND if f else "") + f"mfi(14) < {t}", "mfi(14) > 50")
    for k, (f, fl) in product((1.5, 2, 2.5), trend):
        add("kelt_lo", f"close<EMA20−{_fmt(k)}×ATR, {fl}", (TREND if f else "") + f"close < ema(close, 20) - {k} * atr(10)",
            "close > ema(close, 20)", max_hold=15)

    # ---- pullbacks inside a trend
    for a, (tr, mh) in product((20, 25, 30), ((2, 10), (3, 20))):
        add("holygrail", f"ADX>{a}, touch EMA20, {tr}R target",
            f"adx(14) > {a} and di_plus(14) > di_minus(14) and low <= ema(close, 20) and close > ema(close, 20)",
            stop_type="atr", stop_value=1.5, target_r=tr, max_hold=mh)
    for L, S in product((100, 200), (10, 20)):
        add("pullback", f"above {L}d, below {S}d", f"close > sma(close, {L}) and close < sma(close, {S})",
            f"close > sma(close, {S})", max_hold=15)
        add("pullback", f"above {L}d, RSI(5)<30", f"close > sma(close, {L}) and rsi(5) < 30 and close < sma(close, {S})",
            "rsi(5) > 60", max_hold=15)

    # ---- volatility contraction / expansion
    for n, (flt, fl), (tr, mh) in product((4, 7), (("close > sma(close, 50)", "uptrend"), ("close > prev(close)", "up close")),
                                         ((1, 3), (2, 5))):
        add("nr", f"NR{n}, {fl}, {tr}R / {mh}d", f"high - low < lowest(high - low, {n - 1}) and {flt}",
            stop_type="atr", stop_value=1, target_r=tr, max_hold=mh)
    for (flt, fl), (tr, mh) in product((("close > sma(close, 50)", "uptrend"), ("ibs() > 0.5", "upper half")), ((1, 3), (2, 5))):
        add("inside", f"{fl}, {tr}R / {mh}d", f"high < prev(high) and low > prev(low) and {flt}",
            stop_type="atr", stop_value=1, target_r=tr, max_hold=mh)
    for k, mh in product((1.5, 2), (1, 3, 5)):
        add("rangex", f"range>{_fmt(k)}×ATR, strong close, {mh}d", f"high - low > {k} * prev(atr(10)) and ibs() > 0.8 and close > open",
            max_hold=mh)

    # ---- trend following and momentum
    for (n, m), st in product(((10, 5), (20, 10), (50, 25), (55, 20), (100, 50), (200, 50)), ("atr", "none")):
        add("donchian", f"{n}-day high, exit {m}-day low{', 2×ATR stop' if st == 'atr' else ''}",
            f"close > highest(high, {n})", f"close < lowest(low, {m})", stop_type=st, stop_value=2 if st == "atr" else 0,
            max_hold=250)
    for x, (ex, exl, mh) in product((1.0, 0.98, 0.95), (("close < sma(close, 50)", "exit <50d", 250), ("", "hold 1m", 21),
                                                         ("", "hold 3m", 63))):
        add("hi52", f"within {1 - x:.0%} of 52w high, {exl}" if x < 1 else f"new 52w high, {exl}",
            f"close >= highest(high, 252) * {x:g}", ex, max_hold=mh)
    for (a, b), kind, st in product(((5, 20), (10, 30), (20, 50), (10, 50), (50, 200)), ("sma", "ema"), ("none", "pct")):
        add("macross", f"{kind.upper()} {a}/{b}{', 10% stop' if st == 'pct' else ''}",
            f"crosses_above({kind}(close, {a}), {kind}(close, {b}))", f"crosses_below({kind}(close, {a}), {kind}(close, {b}))",
            stop_type=st, stop_value=10 if st == "pct" else 0, max_hold=250)
    for n, kind in product((20, 50, 100, 200), ("sma", "ema")):
        add("priceabove", f"close crosses {kind.upper()}{n}", f"crosses_above(close, {kind}(close, {n}))",
            f"crosses_below(close, {kind}(close, {n}))", max_hold=250)
    for (f, s, g), zone in product(((12, 26, 9), (5, 35, 5)), ("any", "below0", "above0")):
        z = {"any": "", "below0": f" and macd({f}, {s}) < 0", "above0": f" and macd({f}, {s}) > 0"}[zone]
        add("macd", f"{f}/{s}/{g}, {zone.replace('below0', 'below zero').replace('above0', 'above zero')}",
            f"crosses_above(macd({f}, {s}), macd_signal({f}, {s}, {g})){z}",
            f"crosses_below(macd({f}, {s}), macd_signal({f}, {s}, {g}))", max_hold=60)
    for n, x in product((63, 126, 252), (0, 0.1, 0.2)):
        add("tsmom", f"{n}d return >{x:.0%}, above 200d, hold 1m", TREND + f"ret({n}) > {x}", max_hold=21)
    for a in (20, 25, 30):
        add("dmi", f"ADX>{a}, +DI crosses −DI", f"adx(14) > {a} and crosses_above(di_plus(14), di_minus(14))",
            "crosses_below(di_plus(14), di_minus(14))", stop_type="atr", stop_value=2, max_hold=60)
    for n, v in product((10, 20, 50), (1.5, 2, 3)):
        add("volbo", f"{n}-day high on {_fmt(v)}× volume", f"close > highest(high, {n}) and volume > {v} * volume_avg(20)",
            "close < lowest(low, 10)", stop_type="atr", stop_value=2, max_hold=60)
    for n, (flt, fl) in product((20, 50), (("close > sma(close, 50)", "uptrend"), ("close > highest(close, 20)", "price breakout"))):
        add("obv", f"OBV {n}-day high, {fl}", f"obv() > highest(obv(), {n}) and {flt}", "close < sma(close, 20)", max_hold=60)
    for k in (1.5, 2, 2.5):
        add("kelt_hi", f"close>EMA20+{_fmt(k)}×ATR", f"close > ema(close, 20) + {k} * atr(10)", "close < ema(close, 20)",
            max_hold=60)
    for n, k in product((10, 22), (2, 3)):
        add("chandelier", f"{n}d, {k}×ATR", f"crosses_above(close, highest(high, {n}) - {k} * atr({n}))",
            f"crosses_below(close, highest(high, {n}) - {k} * atr({n}))", max_hold=120)
    for n, mh in product((3, 5), (3, 5)):
        add("upstreak", f"{n} up closes, hold {mh}d", f"streak() >= {n}", max_hold=mh)

    # ---- calendar
    for d, mh in product((0, 1, 2), (4, 6)):
        add("tom", ("buy on the month's last day" if d == 0 else f"buy {d} day{'s' if d > 1 else ''} before month end") + f", hold {mh}d", f"days_left() == {d}", max_hold=mh)
    for d, name in enumerate(("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")):
        add("weekday", f"buy after {name} close, hold 1d", f"dow() == {d}", max_hold=1)
    add("weekday", "Turnaround Tuesday (down Monday)", "dow() == 0 and close < prev(close)", max_hold=1)
    add("weekday", "down Friday, hold to Monday", "dow() == 4 and close < prev(close)", max_hold=1)

    # ---- control group: same machinery, random entries at a few typical signal rates and holding periods
    for i, (p, mh) in enumerate(product((0.03, 0.08, 0.15), (2, 5, 10, 21))):
        for k in (1, 2):
            add("placebo", f"{p:.0%} of days, hold {mh}d, #{k}", f"coin({i * 2 + k}) < {p}", max_hold=mh)

    for i, s in enumerate(out):
        s["id"] = f"{s['family']}-{sum(1 for x in out[:i] if x['family'] == s['family']) + 1:02d}"
    return out


def describe(s: dict) -> str:
    """Plain-English exit summary."""
    parts = []
    if s.get("exit"):
        parts.append(f"sell when {s['exit']}")
    if s["stop_type"] == "atr":
        parts.append(f"stop {_fmt(s['stop_value'])}×ATR")
    elif s["stop_type"] == "pct":
        parts.append(f"stop {_fmt(s['stop_value'])}%")
    if s.get("target_r"):
        parts.append(f"target {_fmt(s['target_r'])}R")
    parts.append(f"max {s['max_hold']} days")
    return ", ".join(parts)
