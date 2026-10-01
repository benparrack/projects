"""Price data: yfinance download with a local CSV cache, or a user-supplied CSV."""
from __future__ import annotations

import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data"
COLS = ["Open", "High", "Low", "Close", "Volume"]

# Liquid names that have historically been high-volatility. `scan` ranks these
# by recent realized volatility, so stale entries simply fall down the list.
CANDIDATES = [
    "TSLA", "NVDA", "AMD", "SMCI", "ARM", "MU", "PLTR", "COIN", "MSTR", "HOOD",
    "SOFI", "AFRM", "UPST", "MARA", "RIOT", "CLSK", "RIVN", "LCID", "NIO", "XPEV",
    "SNAP", "RBLX", "ROKU", "SHOP", "NET", "CRWD", "SNOW", "DDOG", "U", "TTD",
    "APP", "DKNG", "CVNA", "CELH", "HIMS", "MRNA", "ENPH", "FSLR", "PLUG", "RUN",
    "IONQ", "RGTI", "QBTS", "RKLB", "ASTS", "SOUN", "BBAI", "OKLO", "SMR", "ACHR",
    "JOBY", "GME", "AMC", "CHWY", "PINS", "DASH", "ABNB", "UBER", "LYFT", "PATH",
]


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    if isinstance(df.columns, pd.MultiIndex):
        df = df.droplevel(1, axis=1) if df.columns.nlevels > 1 else df
    df = df[[c for c in COLS if c in df.columns]].copy()
    df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
    df = df[~df.index.duplicated(keep="last")].sort_index()
    df = df.replace([np.inf, -np.inf], np.nan).dropna(subset=["Close"])
    return df[df["Close"] > 0]


def load_csv(path: str | Path) -> pd.DataFrame:
    """Load OHLCV from a CSV with a Date column (case-insensitive headers)."""
    df = pd.read_csv(path)
    df.columns = [c.strip().title() for c in df.columns]
    if "Adj Close" in df.columns:
        df["Close"] = df["Adj Close"]
    date_col = next(c for c in df.columns if c.lower() in ("date", "datetime", "timestamp"))
    df = df.set_index(pd.to_datetime(df[date_col]))
    if "Volume" not in df.columns:
        df["Volume"] = np.nan
    for c in ("Open", "High", "Low"):
        if c not in df.columns:
            df[c] = df["Close"]
    return _clean(df)


def fetch(ticker: str, years: int = 10, refresh: bool = False) -> pd.DataFrame:
    """Daily split/dividend-adjusted OHLCV. Cached per ticker for the day."""
    CACHE.mkdir(exist_ok=True)
    path = CACHE / f"{ticker.replace('^', '_')}.csv"
    today = dt.date.today()
    if path.exists() and not refresh and dt.date.fromtimestamp(path.stat().st_mtime) == today:
        df = pd.read_csv(path, index_col=0, parse_dates=True)
        return _clean(df)
    import yfinance as yf

    try:
        raw = yf.download(ticker, period=f"{years}y", interval="1d", auto_adjust=True,
                          progress=False, threads=False)
    except Exception as e:  # network/API hiccup: fall back to a stale cache
        raw = pd.DataFrame()
        print(f"  ! download failed for {ticker}: {e}")
    if raw is None or raw.empty:
        if path.exists():
            return _clean(pd.read_csv(path, index_col=0, parse_dates=True))
        raise ValueError(f"no data for {ticker}")
    df = _clean(raw)
    df.to_csv(path)
    return df


def fetch_many(tickers: list[str], years: int = 10, refresh: bool = False) -> dict[str, pd.DataFrame]:
    out = {}
    for t in tickers:
        try:
            df = fetch(t, years, refresh)
            if len(df) >= 300:
                out[t] = df
            else:
                print(f"  ! {t}: only {len(df)} days of history, skipping (need 300+)")
        except Exception as e:
            print(f"  ! {t}: {e}")
    return out


def screen_volatile(candidates: list[str], top: int = 12, min_dollar_vol: float = 50e6,
                    refresh: bool = False) -> pd.DataFrame:
    """Rank candidates by 6-month annualized volatility, filtered for liquidity."""
    rows = []
    for t in candidates:
        try:
            df = fetch(t, 10, refresh)
        except Exception as e:
            print(f"  ! {t}: {e}")
            continue
        recent = df.iloc[-126:]
        if len(recent) < 100:
            continue
        r = np.log(recent["Close"]).diff().dropna()
        dollar_vol = float((recent["Close"] * recent["Volume"]).median())
        rows.append({
            "ticker": t,
            "ann_vol": float(r.std() * np.sqrt(252)),
            "ret_6m": float(recent["Close"].iloc[-1] / recent["Close"].iloc[0] - 1),
            "dollar_vol_m": dollar_vol / 1e6,
            "years_history": len(df) / 252,
        })
    res = pd.DataFrame(rows)
    if res.empty:
        return res
    res = res[res["dollar_vol_m"] >= min_dollar_vol / 1e6]
    res = res[res["years_history"] >= 3]
    return res.sort_values("ann_vol", ascending=False).head(top).reset_index(drop=True)
