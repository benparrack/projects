"""Thin wrapper around The Odds API v4. No business logic here."""

import requests


class OddsAPIError(Exception):
    pass


class OddsAPIClient:
    BASE_URL = "https://api.the-odds-api.com/v4"

    def __init__(self, api_key: str, session: requests.Session | None = None):
        if not api_key:
            raise OddsAPIError(
                "No API key provided. Set ODDS_API_KEY in .env "
                "(get a free key at https://the-odds-api.com/)."
            )
        self.api_key = api_key
        self.session = session or requests.Session()

    def _request(self, path: str, params: dict):
        url = f"{self.BASE_URL}{path}"
        params = {**params, "apiKey": self.api_key}
        try:
            response = self.session.get(url, params=params, timeout=15)
        except requests.exceptions.RequestException:
            raise OddsAPIError(
                "Could not reach The Odds API — check your network connection."
            )

        if response.status_code == 401:
            raise OddsAPIError(
                "Invalid API key (401). Check ODDS_API_KEY in .env."
            )
        if response.status_code == 429:
            raise OddsAPIError(
                "Rate limit or monthly quota exceeded (429). "
                "Wait for your quota to reset or upgrade your plan."
            )
        if not response.ok:
            raise OddsAPIError(
                f"The Odds API returned {response.status_code}: "
                f"{response.text[:300]}"
            )

        quota_info = {
            "remaining": response.headers.get("x-requests-remaining"),
            "used": response.headers.get("x-requests-used"),
            "last_cost": response.headers.get("x-requests-last"),
        }
        return response.json(), quota_info

    def get_soccer_sports(self):
        """GET /sports — free call, no credit cost. Returns active soccer leagues."""
        data, _ = self._request("/sports", {})
        return [s for s in data if s.get("group") == "Soccer" and s.get("active")]

    def get_odds(self, sport_key: str, regions: str, markets: str = "h2h"):
        """GET /sports/{sport_key}/odds. Costs ~markets x regions credits."""
        params = {
            "regions": regions,
            "markets": markets,
            "oddsFormat": "decimal",
            "dateFormat": "iso",
        }
        events, quota_info = self._request(f"/sports/{sport_key}/odds", params)
        return events, quota_info
