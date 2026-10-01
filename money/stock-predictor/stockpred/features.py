"""Feature engineering. Every feature at row t uses only data up to and including t."""
from __future__ import annotations

import numpy as np
import pandas as pd


def _rsi(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn.replace(0, np.nan))


def _atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    pc = df["Close"].shift()
    tr = pd.concat([df["High"] - df["Low"], (df["High"] - pc).abs(), (df["Low"] - pc).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()


def stock_features(df: pd.DataFrame) -> pd.DataFrame:
    c, v = df["Close"], df["Volume"]
    lr = np.log(c).diff()
    f = pd.DataFrame(index=df.index)
    for n in (1, 3, 5, 10, 20, 60, 120):
        f[f"ret_{n}"] = np.log(c / c.shift(n))
    for n in (5, 20, 60):
        f[f"vol_{n}"] = lr.rolling(n).std() * np.sqrt(252)
    f["vol_ratio_5_60"] = f["vol_5"] / f["vol_60"]
    f["vol_ratio_20_60"] = f["vol_20"] / f["vol_60"]
    f["rsi_14"] = _rsi(c, 14)
    f["rsi_3"] = _rsi(c, 3)
    ema12, ema26 = c.ewm(span=12, adjust=False).mean(), c.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    f["macd_hist"] = (macd - macd.ewm(span=9, adjust=False).mean()) / c
    for n in (10, 20, 50, 200):
        f[f"dist_sma{n}"] = c / c.rolling(n).mean() - 1
    sd20 = c.rolling(20).std()
    f["bb_pos"] = (c - c.rolling(20).mean()) / (2 * sd20)
    f["atr_pct"] = _atr(df) / c
    f["range_pct"] = (df["High"] - df["Low"]) / c
    f["gap"] = np.log(df["Open"] / c.shift())
    f["close_in_range"] = (c - df["Low"]) / (df["High"] - df["Low"]).replace(0, np.nan)
    f["dd_252"] = c / c.rolling(252, min_periods=60).max() - 1
    f["up_from_low_252"] = c / c.rolling(252, min_periods=60).min() - 1
    if v.notna().sum() > 0 and (v > 0).any():
        lv = np.log(v.replace(0, np.nan))
        f["volume_z20"] = (lv - lv.rolling(20).mean()) / lv.rolling(20).std()
        f["volume_ratio_5_60"] = v.rolling(5).mean() / v.rolling(60).mean()
    else:
        f["volume_z20"] = 0.0
        f["volume_ratio_5_60"] = 1.0
    f["up_days_10"] = (lr > 0).rolling(10).mean()
    return f


def market_features(spy: pd.DataFrame, vix: pd.DataFrame | None) -> pd.DataFrame:
    c = spy["Close"]
    m = pd.DataFrame(index=spy.index)
    for n in (5, 20, 60):
        m[f"mkt_ret_{n}"] = np.log(c / c.shift(n))
    m["mkt_dist_sma50"] = c / c.rolling(50).mean() - 1
    m["mkt_dist_sma200"] = c / c.rolling(200).mean() - 1
    m["mkt_vol_20"] = np.log(c).diff().rolling(20).std() * np.sqrt(252)
    if vix is not None and not vix.empty:
        vc = vix["Close"].reindex(spy.index).ffill()
        m["vix"] = vc
        m["vix_chg_5"] = np.log(vc / vc.shift(5))
        m["vix_vs_sma50"] = vc / vc.rolling(50).mean() - 1
    return m


def build(df: pd.DataFrame, mkt: pd.DataFrame | None, horizon: int) -> pd.DataFrame:
    """Features + forward-return target for one ticker. Target is NaN for the last `horizon` rows."""
    f = stock_features(df)
    if mkt is not None:
        f = f.join(mkt, how="left")
        f[mkt.columns] = f[mkt.columns].ffill()
        f["rel_ret_20"] = f["ret_20"] - f["mkt_ret_20"]
        f["rel_ret_60"] = f["ret_60"] - f["mkt_ret_60"]
    c = df["Close"]
    f["fwd_ret"] = np.log(c.shift(-horizon) / c)
    f["next_ret"] = np.log(c.shift(-1) / c)  # used by the backtest only, never as a feature
    f["close"] = c
    return f


NON_FEATURES = {"date", "fwd_ret", "next_ret", "close", "ticker", "target"}


def feature_cols(frame: pd.DataFrame) -> list[str]:
    return [c for c in frame.columns if c not in NON_FEATURES]
