"""Flask app: JSON API + the single-page UI in static/."""
from __future__ import annotations

import logging
import math
import os

import numpy as np
from flask import Flask, jsonify, request, send_from_directory
from flask.json.provider import DefaultJSONProvider

from . import db, service
from .service import UserError

log = logging.getLogger("cockpit")
STATIC = os.path.join(os.path.dirname(__file__), "static")


class NumpyJSON(DefaultJSONProvider):
    @staticmethod
    def default(o):
        if isinstance(o, np.generic):
            o = o.item()
            return None if isinstance(o, float) and not math.isfinite(o) else o
        if isinstance(o, np.ndarray):
            return o.tolist()
        return DefaultJSONProvider.default(o)

    def dumps(self, obj, **kw):
        return super().dumps(_clean(obj), **kw)


def _clean(o):
    if isinstance(o, float) and not math.isfinite(o):
        return None
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, np.floating):
        return _clean(float(o))
    return o


app = Flask(__name__, static_folder=None)
app.json = NumpyJSON(app)


@app.errorhandler(UserError)
def _user_error(e):
    return jsonify({"error": str(e)}), 400


@app.errorhandler(Exception)
def _error(e):
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return e
    log.exception("request failed")
    return jsonify({"error": f"{type(e).__name__}: {e}"}), 500


def body() -> dict:
    return request.get_json(silent=True) or {}


@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html", max_age=0)


@app.get("/static/<path:p>")
def static_files(p):
    return send_from_directory(STATIC, p, max_age=0)


@app.get("/api/accounts")
def api_accounts():
    return jsonify(service.accounts())


@app.get("/api/accounts/<int:aid>/state")
def api_state(aid):
    return jsonify(service.state(aid))


@app.post("/api/accounts/<int:aid>/cash")
def api_cash(aid):
    d = body()
    service.cash_move(aid, d.get("amount"), d.get("note", ""))
    return jsonify({"ok": True})


@app.post("/api/accounts/<int:aid>/check")
def api_check(aid):
    d = body()
    return jsonify(service.check(aid, d.get("ticker", ""), d.get("entry"), d.get("stop"), d.get("target"),
                                 d.get("hold_days"), d.get("thesis", ""), d.get("risk_pct")))


@app.post("/api/accounts/<int:aid>/plans")
def api_save_plan(aid):
    pid = service.save_plan(aid, body())
    return jsonify({"id": pid})


@app.get("/api/plans/<int:pid>")
def api_plan(pid):
    return jsonify(service.plan_detail(pid))


@app.patch("/api/plans/<int:pid>")
def api_update_plan(pid):
    service.update_plan(pid, body())
    return jsonify({"ok": True})


@app.post("/api/plans/<int:pid>/<side>")
def api_trade(pid, side):
    d = body()
    tid = service.record_trade(pid, side, d.get("qty"), d.get("price"), d.get("fees"), None, d.get("note", ""))
    return jsonify({"id": tid})


@app.get("/api/accounts/<int:aid>/journal")
def api_journal(aid):
    return jsonify(service.journal(aid))


@app.get("/api/accounts/<int:aid>/curve")
def api_curve(aid):
    return jsonify(service.curve(aid))


@app.get("/api/settings")
def api_settings():
    return jsonify(db.settings())


@app.post("/api/settings")
def api_set_settings():
    for k, v in body().items():
        try:
            db.set_setting(k, v)
        except KeyError:
            raise UserError(f"Unknown setting {k}")
    return jsonify(db.settings())


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    db.init()
    from . import alerts, lab
    alerts.register(app)
    lab.register(app)
    port = int(os.environ.get("PORT", 5070))
    print(f"Trading cockpit on http://localhost:{port}")
    app.run(host="127.0.0.1", port=port, threaded=True, debug=False)


if __name__ == "__main__":
    main()
