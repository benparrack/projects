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
    # ---- batch 2 (second run, Oct 2026)
    "connors_etf": ("Connors & Alvarez, High Probability ETF Trading (2009): R3, %b, TPS, multiple days down",
                    "https://quantifiedstrategies.substack.com/p/larry-connors-r3-strategy-it-still-795"),
    "crsi": ("Connors, Alvarez & Radtke, An Introduction to ConnorsRSI (2012)",
             "https://www.luxalgo.com/blog/connors-rsi-guide-enhanced-rsi-for-short-term-signals/"),
    "qs_willr": ("Quantified Strategies, Larry Williams %R strategy (exit on close above yesterday's high)",
                 "https://quantifiedstrategies.substack.com/p/williams-r-trading-strategy-williams-203"),
    "qs_range": ("Quantified Strategies, mean reversion off the 25-day average range + IBS",
                 "https://quantifiedstrategies.substack.com/p/3-best-mean-reversion-trading-strategies"),
    "lw_patterns": ("Larry Williams, Long-Term Secrets to Short-Term Trading (1999): Oops!, smash-day reversals, Ultimate Oscillator",
                    "https://www.amazon.com/dp/0471297224"),
    "raschke2": ("Raschke & Connors, Street Smarts (1995): Turtle Soup, 80-20s, the Anti / 3-10 oscillator",
                 "https://www.amazon.com/dp/0965046109"),
    "bulkowski": ("Thomas Bulkowski, Encyclopedia of Candlestick Charts (2008); pattern statistics at thepatternsite.com",
                  "https://www.thepatternsite.com/CandlePerformers.html"),
    "elder": ("Alexander Elder, Trading for a Living (1993) / Come Into My Trading Room: force index, Elder-ray, impulse, triple screen",
              "https://www.luxalgo.com/blog/elders-force-index-indicator-quantifying-market-force-and-direction"),
    "chaikin": ("Marc Chaikin: Chaikin money flow and the Chaikin (A/D) oscillator", "https://www.investopedia.com/terms/c/chaikinoscillator.asp"),
    "chande": ("Tushar Chande (1995), Aroon indicator", "https://www.investopedia.com/terms/a/aroon.asp"),
    "hutson": ("Jack Hutson, TRIX (Technical Analysis of Stocks & Commodities, 1983)", "https://www.investopedia.com/terms/t/trix.asp"),
    "vortex": ("Botes & Siepman (2010), The Vortex Indicator, TASC", "https://www.investopedia.com/terms/v/vortex-indicator-vi.asp"),
    "ichimoku": ("Goichi Hosoda, Ichimoku Kinko Hyo (tenkan/kijun crosses; cloud computed without the forward shift)",
                 "https://www.investopedia.com/terms/i/ichimoku-cloud.asp"),
    "minervini": ("Mark Minervini, Trade Like a Stock Market Wizard (2013): the trend template",
                  "https://www.prorealcode.com/prorealtime-market-screeners/trend-template-mark-minervini/"),
    "weinstein": ("Stan Weinstein, Secrets for Profiting in Bull and Bear Markets (1988): stage-2 breakout above the 30-week average",
                  "https://www.amazon.com/dp/1556236832"),
    "darvas": ("Nicolas Darvas, How I Made $2,000,000 in the Stock Market (1960): box breakouts near highs",
               "https://www.investopedia.com/terms/d/darvasboxtheory.asp"),
    "jt": ("Jegadeesh & Titman (1993), Returns to Buying Winners and Selling Losers: 12-1 month momentum",
           "https://doi.org/10.1111/j.1540-6261.1993.tb04702.x"),
    "seasonal": ("Bouman & Jacobsen (2002), The Halloween Indicator; Haugen & Lakonishok, The Incredible January Effect",
                 "https://doi.org/10.1257/000282802762024683"),
    "carter": ("John Carter, Mastering the Trade (2005): the TTM squeeze (volatility contraction, then breakout)",
               "https://www.amazon.com/dp/0071775145"),
    "wyckoff": ("Richard Wyckoff: selling climax (huge volume at a new low that closes off the low)",
                "https://www.investopedia.com/articles/trading/10/richard-wyckoff-method.asp"),
    "pead": ("Bernard & Thomas (1989): post-earnings-announcement drift (proxied by a big gap up on heavy volume)",
             "https://doi.org/10.2307/2491062"),
    "envelope": ("Moving-average envelope (percentage band) mean reversion", "https://www.investopedia.com/terms/e/envelope.asp"),
    "original": ("Made up for this run, not from a publication: published entries crossed with filters and exits they weren't "
                 "published with, and pairs of oversold signals", ""),
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
    "r3": ("Connors R3", "Mean reversion", "connors_etf"),
    "pctb": ("Connors %b", "Mean reversion", "connors_etf"),
    "tps": ("Connors TPS", "Mean reversion", "connors_etf"),
    "mdd": ("Multiple days down", "Mean reversion", "connors_etf"),
    "crsi": ("ConnorsRSI dip", "Mean reversion", "crsi"),
    "rsin": ("Short RSI dip", "Mean reversion", "connors"),
    "qsrange": ("Average-range band + IBS", "Mean reversion", "qs_range"),
    "wr2": ("Williams %R, QS exit", "Mean reversion", "qs_willr"),
    "lowerlows": ("Lower lows", "Mean reversion", "qs_mr"),
    "envelope": ("MA envelope", "Mean reversion", "envelope"),
    "uo": ("Ultimate Oscillator", "Mean reversion", "lw_patterns"),
    "oops": ("Williams Oops!", "Reversal pattern", "lw_patterns"),
    "smash": ("Smash-day reversal", "Reversal pattern", "lw_patterns"),
    "soup": ("Turtle Soup", "Reversal pattern", "raschke2"),
    "r8020": ("80-20 reversal", "Reversal pattern", "raschke2"),
    "climax": ("Selling climax", "Reversal pattern", "wyckoff"),
    "candle": ("Candlestick pattern", "Reversal pattern", "bulkowski"),
    "force": ("Elder force index", "Pullback", "elder"),
    "elderray": ("Elder-ray", "Pullback", "elder"),
    "triple": ("Elder triple screen", "Pullback", "elder"),
    "impulse": ("Elder impulse", "Trend", "elder"),
    "osc310": ("3-10 oscillator / the Anti", "Pullback", "raschke2"),
    "cmf": ("Chaikin money flow", "Trend", "chaikin"),
    "chosc": ("Chaikin oscillator", "Trend", "chaikin"),
    "aroon": ("Aroon cross", "Trend", "chande"),
    "trix": ("TRIX", "Trend", "hutson"),
    "vortex": ("Vortex cross", "Trend", "vortex"),
    "ichi": ("Ichimoku", "Trend", "ichimoku"),
    "minervini": ("Minervini trend template", "Momentum", "minervini"),
    "stage2": ("Weinstein stage 2", "Momentum", "weinstein"),
    "darvas": ("Darvas box", "Momentum", "darvas"),
    "squeeze": ("Volatility squeeze breakout", "Volatility", "carter"),
    "jt": ("12-1 momentum", "Momentum", "jt"),
    "gapgo": ("Earnings-style gap up", "Momentum", "pead"),
    "seasonal": ("Seasonal", "Calendar", "seasonal"),
    "mixmr": ("Made-up dip combo", "Mean reversion", "original"),
    "mixmo": ("Made-up breakout combo", "Momentum", "original"),
    "dbl": ("Made-up double oversold", "Mean reversion", "original"),
    "placebo": ("Placebo (coin flip)", "Control", "placebo"),
}

TREND = "close > sma(close, 200) and "


def _fmt(x) -> str:
    return f"{x:g}"


def _key(s: dict) -> tuple:
    return (s["entry"], s["exit"], s["stop_type"], s["stop_value"], s["target_r"], s["max_hold"])


def library(batch: int = 1) -> list[dict]:
    """batch 1 = the first run's population; batch 2 = ~1000 new strategies (none repeating a batch-1 rule set)."""
    if batch == 2:
        seen = {_key(s) for s in library(1)}
        out = []
        for s in _batch2():
            if _key(s) not in seen:
                seen.add(_key(s))
                out.append(s)
        return _ids(out)
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

    return _ids(out)


def _ids(out: list[dict]) -> list[dict]:
    n: dict[str, int] = {}
    for s in out:
        n[s["family"]] = n.get(s["family"], 0) + 1
        s["id"] = f"{s['family']}-{n[s['family']]:02d}"
    return out


def _batch2() -> list[dict]:
    out: list[dict] = []

    def add(fam, label, entry, exit="", stop_type="none", stop_value=0, target_r=None, max_hold=10):
        out.append({"family": fam, "name": f"{FAMILIES[fam][0]} · {label}", "entry": entry, "exit": exit,
                    "stop_type": stop_type, "stop_value": stop_value, "target_r": target_r, "max_hold": max_hold})

    trend = ((True, "above 200d"), (False, "any trend"))
    T = lambda f: TREND if f else ""  # noqa: E731
    pb = "((close - sma(close, 20) + 2 * stdev(close, 20)) / (4 * stdev(close, 20)))"  # Bollinger %b
    tenkan, kijun = "(highest(high, 9) + lowest(low, 9)) / 2", "(highest(high, 26) + lowest(low, 26)) / 2"

    # ---- Connors & Alvarez, High Probability ETF Trading; ConnorsRSI
    for t, first, ex, (f, fl) in product((5, 10, 15), (60, 70), ("rsi70", "sma5"), trend):
        add("r3", f"RSI(2) falls 3 days from <{first} to <{t}, {fl}, exit {'RSI>70' if ex == 'rsi70' else 'close>SMA5'}",
            T(f) + f"prev(rsi(2), 2) < {first} and prev(rsi(2), 1) < prev(rsi(2), 2) and rsi(2) < prev(rsi(2), 1) and rsi(2) < {t}",
            "rsi(2) > 70" if ex == "rsi70" else "close > sma(close, 5)")
    for d, t, (f, fl) in product((1, 2, 3), (0, 0.1, 0.2), trend):
        add("pctb", f"%b<{_fmt(t)} for {d} day{'s' if d > 1 else ''}, {fl}", T(f) + f"count({pb} < {t}, {d}) == {d}", f"{pb} > 0.8")
    for t, d, (f, fl) in product((20, 25, 30), (2, 3), trend):
        add("tps", f"RSI(2)<{t} {d} days in a row, {fl}", T(f) + f"count(rsi(2) < {t}, {d}) == {d}", "rsi(2) > 70")
    for k, ex, (f, fl) in product((3, 4, 5), ("sma5", "rsi70"), trend):
        add("mdd", f"{k} of 5 days down, below SMA5, {fl}, exit {'close>SMA5' if ex == 'sma5' else 'RSI>70'}",
            T(f) + f"count(close < prev(close), 5) >= {k} and close < sma(close, 5)",
            "close > sma(close, 5)" if ex == "sma5" else "rsi(2) > 70")
    for t, ex, (f, fl) in product((5, 10, 15, 20), (50, 70, "sma5"), trend):
        add("crsi", f"CRSI<{t}, {fl}, exit {'close>SMA5' if ex == 'sma5' else f'CRSI>{ex}'}", T(f) + f"crsi() < {t}",
            "close > sma(close, 5)" if ex == "sma5" else f"crsi() > {ex}")
    for n, t, ex, (f, fl) in product((3, 4, 5), (10, 20, 30), (50, 70), trend):
        add("rsin", f"RSI({n})<{t}, {fl}, exit RSI>{ex}", T(f) + f"rsi({n}) < {t}", f"rsi({n}) > {ex}")

    # ---- more published mean reversion
    for k, ib, (f, fl) in product((1.5, 2, 2.5), (0.3, 0.5), trend):
        add("qsrange", f"close<10d high−{_fmt(k)}×avg range, IBS<{_fmt(ib)}, {fl}",
            T(f) + f"close < highest(high, 10) - {k} * sma(high - low, 25) and ibs() < {ib}", "close > prev(high)")
    for n, t, (f, fl) in product((2, 3, 5, 10), (-90, -95, -98), trend):
        add("wr2", f"%R({n})<{t}, {fl}", T(f) + f"willr({n}) < {t}", f"close > prev(high) or willr({n}) > -30")
    for k, mh, (f, fl) in product((3, 4, 5), (5, 10), trend):
        add("lowerlows", f"{k} lower lows, {fl}, max {mh}d", T(f) + f"count(low < prev(low), {k}) == {k}", "close > prev(high)", max_hold=mh)
    for n, x, (f, fl) in product((10, 20, 50), (0.03, 0.05, 0.08, 0.1), trend):
        add("envelope", f"{x:.0%} below SMA{n}, {fl}", T(f) + f"close < sma(close, {n}) * {1 - x:g}", f"close > sma(close, {n})", max_hold=20)
    for t, ex, (f, fl) in product((30, 35, 40), (50, 65), trend):
        add("uo", f"UO<{t}, {fl}, exit UO>{ex}", T(f) + f"uo() < {t}", f"uo() > {ex}")

    # ---- reversal patterns
    for g, mh, (f, fl) in product((0, 0.005, 0.01), (1, 3, 5), trend):
        add("oops", f"gap {'below' if not g else f'{g:.1%} below'} yday low, closes back above, {fl}, {mh}d",
            T(f) + f"open < prev(low) * {1 - g:g} and close > prev(low)", max_hold=mh)
    for n, mh, (f, fl) in product((1, 3, 5), (3, 5), trend):
        add("smash", f"yday closed under {n}-day low, today closes over yday high, {fl}, {mh}d",
            T(f) + f"prev(close) < prev(lowest(low, {n})) and close > prev(high)", max_hold=mh)
    for n, (st, tr, mh), (f, fl) in product((10, 20, 55), (("atr", 2, 10), ("none", None, 5)), trend):
        add("soup", f"new {n}-day low that closes back above it, {fl}, {f'1×ATR stop, {tr}R' if st == 'atr' else f'{mh}d'}",
            T(f) + f"low < lowest(low, {n}) and close > lowest(low, {n})", stop_type=st, stop_value=1 if st == "atr" else 0,
            target_r=tr, max_hold=mh)
    for (a, b), mh, (f, fl) in product(((0.8, 0.2), (0.7, 0.3)), (1, 3, 5), trend):
        add("r8020", f"yday opened top {1 - a:.0%}, closed bottom {b:.0%}, today undercuts and recovers, {fl}, {mh}d",
            T(f) + f"(prev(open) - prev(low)) / (prev(high) - prev(low)) > {a} and prev(ibs()) < {b} and low < prev(low) and close > prev(low)",
            max_hold=mh)
    for v, (f, fl) in product((2.5, 3, 4), (("ibs() > 0.5", "closes in top half"), ("close > open", "green close"))):
        add("climax", f"{_fmt(v)}× volume at a 20-day low, {fl}", f"volume > {v} * volume_avg(20) and low < lowest(low, 20) and {f}",
            "close > sma(close, 10)", max_hold=15)
    small = "prev(close - open) < 0.3 * prev(high - low) and prev(open - close) < 0.3 * prev(high - low)"
    candles = {
        "hammer": "close > open and open - low >= 2 * (close - open) and high - close <= 0.1 * (high - low)",
        "inverted hammer": "close > open and high - close >= 2 * (close - open) and open - low <= 0.1 * (high - low)",
        "bullish engulfing": "prev(close) < prev(open) and close > open and open <= prev(close) and close >= prev(open)",
        "piercing line": "prev(close) < prev(open) and open < prev(low) and close > (prev(open) + prev(close)) / 2 and close < prev(open)",
        "morning star": f"prev(close, 2) < prev(open, 2) and {small} and close > open and close > (prev(open, 2) + prev(close, 2)) / 2",
        "three white soldiers": "count(close > open, 3) == 3 and count(close > prev(close), 3) == 3 and count(ibs() > 0.7, 3) == 3",
        "bullish harami": "prev(close) < prev(open) and close > open and open > prev(close) and close < prev(open)",
        "three outside up": "prev(close, 2) < prev(open, 2) and prev(close) > prev(open) and prev(open) <= prev(close, 2) "
                            "and prev(close) >= prev(open, 2) and close > prev(close)",
        "three inside up": "prev(close, 2) < prev(open, 2) and prev(close) > prev(open) and prev(open) > prev(close, 2) "
                           "and prev(close) < prev(open, 2) and close > prev(open, 2)",
        "dragonfly doji": "high - low > 0 and close - open < 0.1 * (high - low) and open - close < 0.1 * (high - low) "
                          "and high - close < 0.1 * (high - low) and high - open < 0.1 * (high - low)",
    }
    for (nm, rule), (ctx, cl), (st, tr, mh) in product(candles.items(),
                                                       (("ret(10) < -0.03 and ", "after a 10-day drop"), (TREND, "above 200d"), ("", "anywhere")),
                                                       (("none", None, 3), ("none", None, 10), ("atr", 2, 10))):
        add("candle", f"{nm}, {cl}, {f'1×ATR stop, {tr}R' if st == 'atr' else f'hold {mh}d'}", ctx + rule,
            stop_type=st, stop_value=1 if st == "atr" else 0, target_r=tr, max_hold=mh)

    # ---- Elder, Raschke pullbacks
    ups = (("ema(close, 22) > prev(ema(close, 22), 1)", "EMA22 rising"), ("close > sma(close, 200)", "above 200d"),
           ("ema(close, 65) > prev(ema(close, 65), 5)", "EMA65 rising"))
    for (u, ul), (ex, el, mh) in product(ups, (("force(2) > 0", "force>0", 10), ("", "hold 5d", 5), ("close > prev(high)", "close>yday high", 10))):
        add("force", f"force(2)<0, {ul}, {el}", f"{u} and force(2) < 0", ex, max_hold=mh)
    for n, (f, fl) in product((13, 50, 100), trend):
        add("force", f"force({n}) crosses above 0, {fl}", T(f) + f"crosses_above(force({n}), 0)", f"crosses_below(force({n}), 0)", max_hold=60)
    for mh, (f, fl) in product((5, 10, 20), trend):
        add("elderray", f"bear power <0 and rising, EMA13 rising, {fl}, {mh}d",
            T(f) + "ema(close, 13) > prev(ema(close, 13), 1) and low < ema(close, 13) and low - ema(close, 13) > prev(low - ema(close, 13), 1)",
            max_hold=mh)
    for (u, ul), (osc, ol) in product((("ema(close, 65) > prev(ema(close, 65), 5)", "weekly trend up"),
                                       ("macd_hist(60, 130, 45) > prev(macd_hist(60, 130, 45), 5)", "weekly MACD-H rising")),
                                      (("stoch(5) < 20", "%K(5)<20"), ("stoch(5) < 30", "%K(5)<30"), ("force(2) < 0", "force(2)<0"),
                                       ("willr(5) < -80", "%R(5)<-80"))):
        add("triple", f"{ul}, {ol}", f"{u} and {osc}", "close > prev(high)", stop_type="atr", stop_value=2, max_hold=10)
    impulse = "ema(close, 13) > prev(ema(close, 13), 1) and macd_hist() > prev(macd_hist(), 1)"
    for st, (f, fl) in product(("none", "atr"), trend):
        add("impulse", f"first green bar, {fl}{', 2×ATR stop' if st == 'atr' else ''}",
            T(f) + f"{impulse} and not (prev(ema(close, 13), 1) > prev(ema(close, 13), 2) and prev(macd_hist(), 1) > prev(macd_hist(), 2))",
            "ema(close, 13) < prev(ema(close, 13), 1) and macd_hist() < prev(macd_hist(), 1)",
            stop_type=st, stop_value=2 if st == "atr" else 0, max_hold=60)
    for ex, (f, fl) in product((("crosses_below(macd(3, 10), macd_signal(3, 10, 16))", "cross back", 20), ("", "hold 5d", 5)), trend):
        add("osc310", f"3-10 crosses its 16 line, {fl}, {ex[1]}", T(f) + "crosses_above(macd(3, 10), macd_signal(3, 10, 16))",
            ex[0], max_hold=ex[2])
    for (st, tr, mh), (f, fl) in product((("none", None, 3), ("none", None, 5), ("atr", 2, 10)), trend):
        add("osc310", f"the Anti: slow line up, fast hooks up, {fl}, {f'1×ATR stop, {tr}R' if st == 'atr' else f'{mh}d'}",
            T(f) + "macd_signal(3, 10, 16) > prev(macd_signal(3, 10, 16), 1) and macd(3, 10) > prev(macd(3, 10), 1) "
                   "and prev(macd(3, 10), 1) < prev(macd(3, 10), 2)",
            stop_type=st, stop_value=1 if st == "atr" else 0, target_r=tr, max_hold=mh)

    # ---- volume / trend indicators
    for t, (f, fl) in product((0, 0.05, 0.1), trend):
        add("cmf", f"CMF(20) crosses above {_fmt(t)}, {fl}", T(f) + f"crosses_above(cmf(20), {t})", "cmf(20) < -0.05", max_hold=60)
    for st, (f, fl) in product(("none", "atr"), trend):
        add("chosc", f"Chaikin osc crosses 0, {fl}{', 2×ATR stop' if st == 'atr' else ''}",
            T(f) + "crosses_above(ema(adl(), 3) - ema(adl(), 10), 0)", "crosses_below(ema(adl(), 3) - ema(adl(), 10), 0)",
            stop_type=st, stop_value=2 if st == "atr" else 0, max_hold=60)
    for n, strong, (ex, el, mh) in product((14, 25, 50), (False, True), (("cross", "cross back", 120), ("", "hold 1m", 21))):
        add("aroon", f"Aroon({n}) up crosses down{', up>70' if strong else ''}, {el}",
            f"crosses_above(aroon_up({n}), aroon_down({n}))" + (f" and aroon_up({n}) > 70" if strong else ""),
            f"crosses_below(aroon_up({n}), aroon_down({n}))" if ex else "", max_hold=mh)
    for n, (ex, el, mh), (f, fl) in product((9, 15, 30), (("x", "cross back", 120), ("", "hold 1m", 21)), trend):
        add("trix", f"TRIX({n}) crosses 0, {fl}, {el}", T(f) + f"crosses_above(trix({n}), 0)", f"crosses_below(trix({n}), 0)" if ex else "",
            max_hold=mh)
    for n in (9, 15, 30):
        for f, fl in trend:
            add("trix", f"TRIX({n}) crosses its 9-day signal, {fl}", T(f) + f"crosses_above(trix({n}), ema(trix({n}), 9))",
                f"crosses_below(trix({n}), ema(trix({n}), 9))", max_hold=60)
    for n, st, (f, fl) in product((14, 21, 28), ("none", "atr"), trend):
        add("vortex", f"VI+ crosses VI−({n}), {fl}{', 2×ATR stop' if st == 'atr' else ''}", T(f) + f"crosses_above(vi_plus({n}), vi_minus({n}))",
            f"crosses_below(vi_plus({n}), vi_minus({n}))", stop_type=st, stop_value=2 if st == "atr" else 0, max_hold=120)
    cloud = f"close > ({tenkan} + {kijun}) / 2 and close > (highest(high, 52) + lowest(low, 52)) / 2"
    for (ent, el), cl, (ex, xl, mh) in product(((f"crosses_above({tenkan}, {kijun})", "tenkan crosses kijun"),
                                                (f"crosses_above(close, {kijun})", "price crosses kijun")),
                                               (False, True), ((f"crosses_below(close, {kijun})", "exit below kijun", 120), ("", "hold 1m", 21))):
        add("ichi", f"{el}{', above the cloud' if cl else ''}, {xl}", ent + (f" and {cloud}" if cl else ""), ex, max_hold=mh)

    # ---- momentum / growth-stock setups
    tmpl = ("close > sma(close, 50) and sma(close, 50) > sma(close, 150) and sma(close, 150) > sma(close, 200) "
            "and sma(close, 200) > prev(sma(close, 200), 21) and close > 1.3 * lowest(low, 252)")
    for hi, (trg, tl), (ex, st, xl) in product((0.75, 0.85), (("", "any day"), (" and close > highest(high, 20)", "on a 20-day high"),
                                                                (" and close > highest(high, 20) and volume > 1.5 * volume_avg(20)", "20-day high on 1.5× volume")),
                                               (("close < sma(close, 50)", "none", "exit <50d"), ("close < sma(close, 50)", "pct", "exit <50d, 8% stop"))):
        add("minervini", f"template, within {1 - hi:.0%} of 52w high, {tl}, {xl}", f"{tmpl} and close > {hi} * highest(high, 252){trg}",
            ex, stop_type=st, stop_value=8 if st == "pct" else 0, max_hold=250)
    for v, (ex, xl) in product((0, 1.5, 2), (("close < sma(close, 150)", "exit <30wk"), ("close < sma(close, 50)", "exit <50d"))):
        add("stage2", f"crosses rising 30-week avg{f' on {_fmt(v)}× volume' if v else ''}, {xl}",
            "crosses_above(close, sma(close, 150)) and sma(close, 150) > prev(sma(close, 150), 10)" + (f" and volume > {v} * volume_avg(20)" if v else ""),
            ex, max_hold=250)
    for n, x, st in product((10, 20), (0.1, 0.15), ("none", "atr")):
        add("darvas", f"{n}-day box <{x:.0%} tall within 10% of 52w high, breakout{', 2×ATR stop' if st == 'atr' else ''}",
            f"close > highest(high, {n}) and highest(high, {n}) - lowest(low, {n}) < {x} * close and close > 0.9 * highest(high, 252)",
            f"close < lowest(low, {n})", stop_type=st, stop_value=2 if st == "atr" else 0, max_hold=120)
    for p_, (trg, tl), (ex, xl) in product((10, 20), (("close > highest(high, 20)", "20-day high"), ("close > highest(high, 55)", "55-day high")),
                                          (("close < sma(close, 20)", "exit <20d"), ("", "hold 1m"))):
        add("squeeze", f"20d band width in bottom {p_}% of 120 days, {tl}, {xl}",
            f"prev(pctrank(stdev(close, 20) / sma(close, 20), 120), 1) < {p_} and {trg}", ex, max_hold=60 if ex else 21)
    for x, mh in product((0.1, 0.25, 0.5), (21, 63, 126)):
        add("jt", f"12-1 month return >{x:.0%}, hold {mh}d", f"prev(ret(231), 21) > {x}", max_hold=mh)
    for g, v, mh in product((0.04, 0.07), (2, 3), (21, 63)):
        add("gapgo", f"gap up {g:.0%} on {v}× volume, holds the gap, {mh}d", f"open > prev(close) * {1 + g:g} and volume > {v} * volume_avg(20) and close > prev(close) * {1 + g:g}",
            max_hold=mh)
    for mh, (f, fl) in product((21, 63), trend):
        add("seasonal", f"Halloween: Nov–Apr only, hold {mh}d, {fl}", T(f) + "(month() >= 11 or month() <= 4)", max_hold=mh)
    for mh in (5, 10):
        add("seasonal", f"Santa rally: from Dec 15, hold {mh}d", "month() == 12 and dom() >= 15 and dom() <= 17", max_hold=mh)
        add("seasonal", f"January effect: buy Dec's last day, hold {mh}d", "month() == 12 and days_left() == 0", max_hold=mh)

    # ---- made up: published dip entries × filters they weren't published with × exits
    dips = {"RSI(2)<10": "rsi(2) < 10", "CRSI<15": "crsi() < 15", "IBS<0.2": "ibs() < 0.2", "%R(2)<-90": "willr(2) < -90",
            "5-day low close": "close < lowest(close, 5)", "%b<0": f"{pb} < 0", "%K(3)<10": "stoch(3) < 10", "CCI(10)<-150": "cci(10) < -150",
            "MFI(5)<20": "mfi(5) < 20", "5-day drop >7%": "ret(5) < -0.07", "3 down closes": "streak() <= -3", "UO<35": "uo() < 35"}
    filters = {"above 200d & ADX>20": "close > sma(close, 200) and adx(14) > 20 and ", "above 50d": "close > sma(close, 50) and ",
               "1.5× volume": "volume > 1.5 * volume_avg(20) and ", "1-year return >0, above 100d": "ret(252) > 0 and close > sma(close, 100) and ",
               "CMF(20)>0": "cmf(20) > 0 and "}
    mr_exits = (("close > prev(high)", "close>yday high", 10), ("rsi(2) > 70", "RSI(2)>70", 10), ("", "hold 3d", 3))
    for (dn, d), (fn, flt), (ex, xl, mh) in product(dips.items(), filters.items(), mr_exits):
        add("mixmr", f"{dn}, {fn}, {xl}", flt + d, ex, max_hold=mh)
    breaks = {"20-day high": "close > highest(high, 20)", "Aroon up=100": "aroon_up(25) == 100",
              "within 5% of 52w high": "close >= 0.95 * highest(high, 252)", "MACD cross": "crosses_above(macd(), macd_signal())",
              "CRSI>90": "crsi() > 90", "VI+ cross": "crosses_above(vi_plus(14), vi_minus(14))"}
    mfilters = {"1.5× volume": " and volume > 1.5 * volume_avg(20)", "ADX>25": " and adx(14) > 25", "CMF>0.1": " and cmf(20) > 0.1",
                "50d>200d": " and close > sma(close, 200) and sma(close, 50) > sma(close, 200)", "6-month return >20%": " and ret(126) > 0.2"}
    mo_exits = (("close < sma(close, 20)", "none", None, 60, "exit <20d"), ("close < highest(high, 22) - 3 * atr(22)", "none", None, 120, "3×ATR trail"),
                ("", "none", None, 21, "hold 1m"), ("", "atr", 3, 30, "2×ATR stop, 3R"))
    for (bn, b), (fn, flt), (ex, st, tr, mh, xl) in product(breaks.items(), mfilters.items(), mo_exits):
        add("mixmo", f"{bn}, {fn}, {xl}", b + flt, ex, stop_type=st, stop_value=2 if st == "atr" else 0, target_r=tr, max_hold=mh)
    names = list(dips)
    for i, a in enumerate(names):
        for b, (f, fl) in product(names[i + 1:], trend):
            add("dbl", f"{a} and {b}, {fl}", T(f) + f"{dips[a]} and {dips[b]}", "close > prev(high)", max_hold=10)

    # ---- control group: 84 coin flips (seeds 101+, so none repeat batch 1's)
    for i, (p, mh) in enumerate(product((0.02, 0.05, 0.1, 0.2), (1, 3, 5, 10, 21, 42, 63))):
        for k in (1, 2, 3):
            add("placebo", f"{p:.0%} of days, hold {mh}d, #{k}", f"coin({100 + i * 3 + k}) < {p}", max_hold=mh)
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
