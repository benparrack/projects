import numpy as np
import pandas as pd
import pytest

from stockpred import data, evaluate, features, model


def synth(n=900, seed=0, start="2018-01-01"):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range(start, periods=n)
    c = 100 * np.exp(np.cumsum(rng.normal(0, 0.03, n)))
    o = c * np.exp(rng.normal(0, 0.005, n))
    return pd.DataFrame({"Open": o, "High": np.maximum(o, c) * 1.01, "Low": np.minimum(o, c) * 0.99,
                         "Close": c, "Volume": rng.integers(1e6, 5e6, n).astype(float)}, index=idx)


def test_features_have_no_lookahead():
    df = synth()
    full = features.stock_features(df)
    for t in (300, 500, 899):
        trunc = features.stock_features(df.iloc[: t + 1])
        pd.testing.assert_series_equal(full.iloc[t], trunc.iloc[-1], check_names=False)


def test_target_is_forward_return_and_not_a_feature():
    df = synth()
    f = features.build(df, None, 5)
    assert np.isclose(f["fwd_ret"].iloc[10], np.log(df["Close"].iloc[15] / df["Close"].iloc[10]))
    assert f["fwd_ret"].iloc[-5:].isna().all()
    cols = features.feature_cols(model.make_panel({"X": f}))
    assert not {"fwd_ret", "next_ret", "close", "target", "date", "ticker"} & set(cols)


def test_walk_forward_purges_training_labels_before_test_block():
    frames = {t: features.build(synth(seed=i), None, 5).iloc[200:] for i, t in enumerate("ABC")}
    panel = model.make_panel(frames)
    dates = np.array(sorted(panel["date"].unique()))
    records = []

    def fn(k):
        class M:
            def fit(self, X, y):
                records.append(("fit", panel.loc[X.index, "date"].max()))

            def predict_proba(self, X):
                records.append(("test", panel.loc[X.index, "date"].min()))
                return np.full((len(X), 2), 0.5)
        return M()

    model.walk_forward(panel, horizon=5, retrain_every=50, min_train_days=300, model_fn=fn, log=None)
    fits = [d for k, d in records if k == "fit"]
    tests = [d for k, d in records if k == "test"]
    assert len(fits) == len(tests) > 3
    for last_train, first_test in zip(fits, tests):
        gap = np.searchsorted(dates, first_test) - np.searchsorted(dates, last_train)
        assert gap >= 5  # the training label (t -> t+5) was fully known when the test block started


def test_positions_hysteresis():
    p = pd.Series([0.4, 0.56, 0.52, 0.49, 0.6, 0.3])
    assert evaluate.positions(p, 0.55, 0.5).tolist() == [0, 1, 1, 0, 1, 0]


def test_backtest_math_with_costs():
    dates = pd.bdate_range("2020-01-01", periods=4)
    r = np.log1p(np.array([0.10, -0.05, 0.02, 0.0]))
    oos = pd.DataFrame({"date": dates, "prob": [0.6, 0.4, 0.6, 0.4], "next_ret": r})
    bt = evaluate.backtest(oos, 0.55, 0.5, cost_bps=10, n_perm=0)
    # long day 1 (+10%), flat day 2, long day 3 (+2%), flat day 4; 4 position changes at 0.1%
    expected = (1 + 0.10 - 0.001) * (1 - 0.001) * (1 + 0.02 - 0.001) * (1 - 0.001) - 1
    assert bt["strategy"]["total_ret"] == pytest.approx(expected)
    assert bt["buy_hold"]["total_ret"] == pytest.approx((1.1 - 0.001) * 0.95 * 1.02 - 1)
    assert bt["trades"] == 2 and bt["exposure"] == 0.5


def test_auc_with_p():
    rng = np.random.default_rng(1)
    y = rng.integers(0, 2, 4000)
    auc, p = evaluate.auc_with_p(y, rng.random(4000))
    assert abs(auc - 0.5) < 0.03 and p > 0.01
    auc, p = evaluate.auc_with_p(y, y + rng.normal(0, 1, 4000))
    assert auc > 0.6 and p < 1e-6


def test_load_csv(tmp_path):
    f = tmp_path / "mystock.csv"
    f.write_text("date,open,high,low,close,adj close,volume\n2024-01-02,1,2,1,1.5,1.4,100\n2024-01-03,1.5,2,1,1.8,1.7,200\n")
    df = data.load_csv(f)
    assert list(df.columns) == data.COLS and df["Close"].tolist() == [1.4, 1.7]
