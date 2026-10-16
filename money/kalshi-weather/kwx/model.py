"""Temperature model: a predictive distribution for each day's high/low, turned into bracket probabilities.

mean:   ensemble mean of the weather models + a ridge-regression correction (which models to trust,
        each station's bias and how it changes with the season).
spread: a second ridge model for how uncertain each day is (bigger when the weather models disagree),
        with Student-t tails fitted to past errors.
Then a blend layer: a logistic regression on the model's probability *and* the market's price,
so the final number only moves away from the market as far as history says the model deserves.
"""
import math

import numpy as np
import pandas as pd
from scipy.stats import t as student_t
from sklearn.linear_model import LogisticRegression, Ridge

from .weather import MODELS

NUS = (2.5, 4, 6, 10, 20, 60)
CLIP = 0.003
HALF_LIFE = 365


def features(ev, kind, series_levels):
    """Design matrix for one kind ('high'/'low'): model deviations from the ensemble, ensemble spread,
    season, and per-station intercept + seasonal terms."""
    suffix = "_max" if kind == "high" else "_min"
    f = ev[[m + suffix for m in MODELS]].to_numpy(dtype=float)
    have = np.isfinite(f)
    ens = np.nanmean(np.where(have, f, np.nan), axis=1)
    f = np.where(have, f, ens[:, None])  # a missing model "agrees" with the rest
    spread = np.sqrt(np.nanmean((f - ens[:, None]) ** 2, axis=1))
    doy = pd.to_datetime(ev["date"]).dt.dayofyear.to_numpy()
    s, c = np.sin(2 * np.pi * doy / 365.25), np.cos(2 * np.pi * doy / 365.25)
    onehot = (ev["series"].to_numpy()[:, None] == np.array(series_levels)[None, :]).astype(float)
    # How far the models were off in the hours just before the decision (observed - forecast), 0 if unknown.
    err = (ev["obsnow"] - ev["fcnow"]).to_numpy(dtype=float) if "obsnow" in ev else np.full(len(ev), np.nan)
    known = np.isfinite(err)
    err = np.where(known, np.clip(err, -15, 15), 0.0)
    # NWS blend (NBS) issued hours before the decision, as a deviation from the ensemble; 0 if unknown.
    nb = (ev["nbs"].to_numpy(dtype=float) - ens) if "nbs" in ev else np.full(len(ev), np.nan)
    nb_known = np.isfinite(nb)
    nb = np.where(nb_known, np.clip(nb, -20, 20), 0.0)
    x_mean = np.column_stack([f - ens[:, None], have, s, c, err, known, nb, nb_known, onehot, onehot * s[:, None],
                              onehot * c[:, None]])
    # More weather models in the ensemble -> smaller errors (three only start in late 2024 / 2025).
    x_sd = np.column_stack([np.log(spread + 0.3), np.abs(err), known, np.abs(nb), nb_known, have.sum(axis=1), s, c, onehot])
    return ens, x_mean, x_sd, have.sum(axis=1)


class TempModel:
    """One model per (kind, lead). fit() on rows with a settled value; dist() gives (mu, sigma, nu)."""

    def fit(self, ev, kind):
        ev = ev[np.isfinite(ev["value_f"])]
        self.kind, self.levels = kind, sorted(ev["series"].unique())
        ens, xm, xs, n = features(ev, kind, self.levels)
        ok = n >= 2
        y = ev["value_f"].to_numpy()[ok] - ens[ok]
        # Forecasts keep improving, so recent errors count more (one-year half-life).
        age = (pd.to_datetime(ev["date"]).max() - pd.to_datetime(ev["date"])).dt.days.to_numpy()[ok]
        w = 0.5 ** (age / HALF_LIFE)
        self.mean = Ridge(alpha=3.0).fit(xm[ok], y, sample_weight=w)
        r = y - self.mean.predict(xm[ok])
        self.var = Ridge(alpha=3.0).fit(xs[ok], np.log(r * r + 0.25), sample_weight=w)
        s2 = np.exp(self.var.predict(xs[ok]))
        self.scale = float(np.average(r * r / s2, weights=w))
        z = r / np.sqrt(self.scale * s2)
        # Pick tails by likelihood; rescale so each t keeps the fitted variance.
        def ll(nu):
            k = math.sqrt((nu - 2) / nu) if nu > 2 else 1.0
            return float(np.sum(student_t.logpdf(z / k, nu) - math.log(k)))
        self.nu = max(NUS, key=ll)
        self.n_train = int(ok.sum())
        self.rmse = float(np.sqrt(np.mean(r * r)))
        return self

    def dist(self, ev):
        ens, xm, xs, n = features(ev, self.kind, self.levels)
        mu = ens + self.mean.predict(xm)
        sd = np.sqrt(self.scale * np.exp(self.var.predict(xs)))
        mu[n < 2] = np.nan
        return mu, sd

    def prob(self, mu, sd, lo_f, hi_f):
        """P(lo_f <= T < hi_f) for continuous edges in °F (already widened by ±0.5 in native units)."""
        k = math.sqrt((self.nu - 2) / self.nu) if self.nu > 2 else 1.0
        scale = sd * k
        p = student_t.cdf((hi_f - mu) / scale, self.nu) - student_t.cdf((lo_f - mu) / scale, self.nu)
        return np.clip(p, CLIP, 1 - CLIP)


def edges_f(q):
    """Continuous °F edges of each quote row's YES range: [lo - 0.5, hi + 0.5] in the native unit."""
    lo = np.where(np.isfinite(q["lo"]), q["lo"] - 0.5, -np.inf)
    hi = np.where(np.isfinite(q["hi"]), q["hi"] + 0.5, np.inf)
    c = (q["unit"] == "C").to_numpy()
    lo = np.where(c, lo * 1.8 + 32, lo)
    hi = np.where(c, hi * 1.8 + 32, hi)
    return lo, hi


def logit(p):
    p = np.clip(p, CLIP, 1 - CLIP)
    return np.log(p / (1 - p))


def mid(q):
    return ((q["bid"] + q["ask"]) / 2).clip(CLIP, 1 - CLIP).to_numpy()


def blend_x(p_model, q):
    return np.column_stack([logit(p_model), logit(mid(q))])


class Blend:
    def fit(self, p_model, q):
        self.lr = LogisticRegression(C=1.0).fit(blend_x(p_model, q), q["yes"].to_numpy())
        return self

    def predict(self, p_model, q):
        return np.clip(self.lr.predict_proba(blend_x(p_model, q))[:, 1], CLIP, 1 - CLIP)

    @property
    def weights(self):
        """(weight on model logit, weight on market logit)."""
        return tuple(float(w) for w in self.lr.coef_[0])


class MarketCal:
    """Baseline: the market's own price, recalibrated on history (captures favorite-longshot bias, no weather)."""
    def fit(self, q):
        self.lr = LogisticRegression(C=1.0).fit(logit(mid(q))[:, None], q["yes"].to_numpy())
        return self

    def predict(self, q):
        return np.clip(self.lr.predict_proba(logit(mid(q))[:, None])[:, 1], CLIP, 1 - CLIP)


def bracket_probs(models, events, quotes):
    """Model probability for each quote row. models: {(kind, lead): TempModel}."""
    p = np.full(len(quotes), np.nan)
    key = quotes[["series", "date", "lead"]].merge(
        events, on=["series", "date", "lead"], how="left")
    lo, hi = edges_f(quotes)
    for (kind, lead), m in models.items():
        sel = ((key["kind"] == kind) & (key["lead"] == lead) & key["series"].isin(m.levels)).to_numpy()
        if not sel.any():
            continue
        mu, sd = m.dist(key[sel])
        p[sel] = m.prob(mu, sd, lo[sel], hi[sel])
    return p
