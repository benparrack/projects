"""Turn the current model probability + its track record into a plain-English call."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .evaluate import expected_from_calibration


@dataclass
class Rec:
    ticker: str
    as_of: str
    close: float
    prob_up: float
    action: str
    confidence: str
    hist_hit_rate: float
    hist_avg_ret: float
    stop: float
    target: float
    shares: int
    position_usd: float
    why: list[str]


def recommend(ticker: str, last, cal, model_edge: bool, tick_bt: dict, tick_auc: float,
              horizon: int, buy_th: float, account: float, risk_pct: float = 0.01,
              max_pos_pct: float = 0.25) -> Rec:
    prob = float(last["prob"])
    close = float(last["close"])
    atr = float(last["atr_pct"]) * close
    hit, avg = expected_from_calibration(cal, prob)
    s, b = tick_bt["strategy"], tick_bt["buy_hold"]
    perm_p = tick_bt["perm_p"]
    ticker_track = (not np.isnan(perm_p) and perm_p < 0.10) or (tick_auc == tick_auc and tick_auc >= 0.53)
    beat_bh = s["sharpe"] > b["sharpe"]
    move = float(last["vol_20"]) / np.sqrt(252) * np.sqrt(horizon)
    why = [
        f"model says {prob:.0%} chance it's up in {horizon} trading days",
        f"historically, at this confidence it was up {hit:.0%} of the time, avg {avg:+.1%} over {horizon}d",
        f"on {ticker} out-of-sample: strategy Sharpe {s['sharpe']:.2f} vs buy-and-hold {b['sharpe']:.2f}, "
        f"max drawdown {s['max_dd']:.0%} vs {b['max_dd']:.0%}, timing p={perm_p:.2f}",
        f"risk: a typical {horizon}-day move is about ±{move:.0%} (1 std dev); "
        f"it is {float(last['dd_252']):.0%} from its 1-year high",
    ]
    if not model_edge:
        action, conf = "NO EDGE", "none"
        why.insert(0, "the model failed its out-of-sample test, so its P(up) is no better than a coin flip")
    elif prob >= buy_th and avg > 0:
        if ticker_track and beat_bh:
            action, conf = "BUY", "medium" if prob >= buy_th + 0.05 else "low"
        else:
            action, conf = "LEAN BUY", "low"
            why.insert(0, "signal is bullish, but the model's track record on this ticker is weak")
    elif prob <= 1 - buy_th or avg < 0:
        action, conf = "AVOID / SELL", "medium" if prob <= 1 - buy_th - 0.05 else "low"
    else:
        action, conf = "WAIT", "n/a"

    stop, target = close - 2 * atr, close + 3 * atr
    shares, pos_usd = 0, 0.0
    if action in ("BUY", "LEAN BUY") and atr > 0:
        risk_usd = account * risk_pct * (0.5 if action == "LEAN BUY" else 1.0)
        shares_f = min(risk_usd / (close - stop), account * max_pos_pct / close)
        shares = int(shares_f)
        pos_usd = shares_f * close  # fractional shares are common on retail brokers
    return Rec(ticker, str(last["date"].date()), close, prob, action, conf, hit, avg,
               stop, target, shares, pos_usd, why)
