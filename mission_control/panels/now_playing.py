from __future__ import annotations

import asyncio
import time

import requests

from .base import Panel


class NowPlayingPanel(Panel):
    """Shows account-wide Spotify playback (any device, phone included)
    via the Web API, rather than local MPRIS/playerctl - see spotify_auth.py.
    """

    def __init__(self, config, **kwargs):
        super().__init__(title="Now Playing", refresh_interval=10.0, **kwargs)
        self._spotify = config.spotify
        self._access_token: str | None = None
        self._token_expiry = 0.0

    async def refresh_data(self) -> None:
        if not self._spotify.refresh_token:
            self.update(
                "[dim]not configured[/dim]\n"
                "Run spotify_auth.py once to connect your\n"
                "Spotify account (see README)"
            )
            return

        try:
            data = await asyncio.to_thread(self._fetch_current)
        except Exception as err:  # noqa: BLE001 - surface any failure in-panel
            self.show_error(f"spotify unavailable: {err}")
            return

        if data is None:
            self.update("[dim]Nothing playing[/dim]")
            return

        icon = "▶" if data["is_playing"] else "⏸"
        device = f"  ({data['device']})" if data["device"] else ""
        self.update(f"{icon}  {data['artist']} - {data['title']}{device}")

    def _fetch_current(self) -> dict | None:
        token = self._get_access_token()
        resp = requests.get(
            "https://api.spotify.com/v1/me/player",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        if resp.status_code == 204 or not resp.content:
            return None
        resp.raise_for_status()
        body = resp.json()

        item = body.get("item")
        if not item:
            return None

        device = body.get("device") or {}
        return {
            "is_playing": bool(body.get("is_playing")),
            "title": item["name"],
            "artist": ", ".join(a["name"] for a in item["artists"]),
            "device": device.get("name"),
        }

    def _get_access_token(self) -> str:
        if self._access_token and time.monotonic() < self._token_expiry:
            return self._access_token

        resp = requests.post(
            "https://accounts.spotify.com/api/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": self._spotify.refresh_token,
                "client_id": self._spotify.client_id,
                "client_secret": self._spotify.client_secret,
            },
            timeout=10,
        )
        resp.raise_for_status()
        payload = resp.json()

        self._access_token = payload["access_token"]
        self._token_expiry = time.monotonic() + payload.get("expires_in", 3600) - 60
        return self._access_token
