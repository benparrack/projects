"""Thin wrapper around the Alpaca Trading and Market Data APIs.

No strategy logic here. The paper-vs-live guard is deliberately redundant
(checked both in resolve_base_url and again in __init__) because this
project executes real orders — even in paper mode — and the live-trading
path should never activate by accident.
"""

from datetime import date, timedelta

import requests

import config


class AlpacaAPIError(Exception):
    pass


def resolve_base_url(live: bool) -> str:
    """Paper by default, always. Live requires BOTH --live (the caller's
    `live` flag) AND ALLOW_LIVE_TRADING=true in the environment. This
    project has no other supported way to reach the live endpoint.
    """
    if not live:
        return config.PAPER_BASE_URL
    if not config.ALLOW_LIVE_TRADING:
        raise AlpacaAPIError(
            "--live was passed but ALLOW_LIVE_TRADING=true is not set in .env. "
            "Both are required together to use live trading, which this "
            "project does not support by default. Refusing to continue."
        )
    return config.LIVE_BASE_URL


class AlpacaClient:
    def __init__(
        self,
        api_key: str,
        secret_key: str,
        base_url: str,
        data_feed: str = config.DEFAULT_DATA_FEED,
        session: requests.Session | None = None,
    ):
        if not api_key or not secret_key:
            raise AlpacaAPIError(
                "Missing ALPACA_API_KEY / ALPACA_SECRET_KEY. "
                "Copy .env.example to .env and fill in your paper keys."
            )
        if base_url not in (config.PAPER_BASE_URL, config.LIVE_BASE_URL):
            raise AlpacaAPIError(f"Unrecognized Alpaca base URL: {base_url!r}.")
        if base_url == config.LIVE_BASE_URL and not config.ALLOW_LIVE_TRADING:
            raise AlpacaAPIError(
                "Refusing to use the LIVE endpoint: ALLOW_LIVE_TRADING is not 'true'."
            )

        self.base_url = base_url
        self.is_live = base_url == config.LIVE_BASE_URL
        self.data_feed = data_feed
        self.headers = {
            "APCA-API-KEY-ID": api_key,
            "APCA-API-SECRET-KEY": secret_key,
        }
        self.session = session or requests.Session()

    def _request(self, method: str, url: str, params: dict = None, json_body: dict = None):
        try:
            response = self.session.request(
                method,
                url,
                headers=self.headers,
                params=params,
                json=json_body,
                timeout=config.REQUEST_TIMEOUT,
            )
        except requests.exceptions.RequestException:
            raise AlpacaAPIError("Could not reach Alpaca — check your network connection.")

        if response.status_code in (401, 403):
            raise AlpacaAPIError(
                f"Alpaca auth failed ({response.status_code}). Check ALPACA_API_KEY/ALPACA_SECRET_KEY."
            )
        if response.status_code == 429:
            raise AlpacaAPIError("Alpaca rate limit exceeded (429).")
        if response.status_code == 404:
            return None
        if not response.ok:
            raise AlpacaAPIError(
                f"Alpaca API returned {response.status_code}: {response.text[:300]}"
            )
        if not response.text:
            return None
        return response.json()

    # --- Trading API ---

    def get_account(self) -> dict:
        return self._request("GET", f"{self.base_url}/v2/account")

    def list_assets(self, status: str = "active", asset_class: str = "us_equity") -> list:
        result = self._request(
            "GET",
            f"{self.base_url}/v2/assets",
            params={"status": status, "asset_class": asset_class},
        )
        return result or []

    def get_positions(self) -> list:
        result = self._request("GET", f"{self.base_url}/v2/positions")
        return result or []

    def get_position(self, symbol: str):
        return self._request("GET", f"{self.base_url}/v2/positions/{symbol}")

    def get_open_orders(self, symbols: list = None) -> list:
        params = {"status": "open"}
        if symbols:
            params["symbols"] = ",".join(symbols)
        result = self._request("GET", f"{self.base_url}/v2/orders", params=params)
        return result or []

    def submit_order(
        self,
        symbol: str,
        side: str,
        type_: str = "market",
        time_in_force: str = "day",
        notional: float = None,
        qty: float = None,
        client_order_id: str = None,
    ) -> dict:
        body = {
            "symbol": symbol,
            "side": side,
            "type": type_,
            "time_in_force": time_in_force,
        }
        if notional is not None:
            body["notional"] = str(notional)
        if qty is not None:
            body["qty"] = str(qty)
        if client_order_id:
            body["client_order_id"] = client_order_id
        return self._request("POST", f"{self.base_url}/v2/orders", json_body=body)

    # --- Market Data API ---

    def get_bars(
        self,
        symbols: list,
        timeframe: str = config.BARS_TIMEFRAME,
        limit: int = config.BARS_LIMIT,
        feed: str = None,
        start: str = None,
    ) -> dict:
        # The API defaults `start` to "today" when omitted, which returns
        # only today's single bar — nowhere near enough history for an
        # SMA(50). Default to a lookback window comfortably covering
        # BARS_LIMIT trading days (accounting for weekends/holidays) unless
        # the caller passes an explicit start date.
        if start is None:
            lookback = date.today() - timedelta(days=config.BARS_LOOKBACK_DAYS)
            start = lookback.isoformat()

        params = {
            "symbols": ",".join(symbols),
            "timeframe": timeframe,
            "limit": limit,
            "feed": feed or self.data_feed,
            "start": start,
        }
        result = self._request(
            "GET", f"{config.DATA_BASE_URL}/v2/stocks/bars", params=params
        )
        return (result or {}).get("bars", {})
