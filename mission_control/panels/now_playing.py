from __future__ import annotations

import asyncio
import time

import requests

from .base import Panel


class NowPlayingPanel(Panel):
    """Shows account-wide Spotify playback (any device, phone included)
    via the Web API, rather than local MPRIS/playerctl - see spotify_auth.py.
    Also exposes playback controls (play/pause/next/previous), wired to
    the p/n/b keybindings in app.py, and a peek at the next couple of
    queued tracks.
    """

    def __init__(self, config, **kwargs):
        super().__init__(title="Now Playing", refresh_interval=10.0, **kwargs)
        self._spotify = config.spotify
        self._access_token: str | None = None
        self._token_expiry = 0.0
        self._is_playing = False
        self._last_device_id: str | None = None
        self.border_subtitle = "p play/pause  n next  b prev"

    async def refresh_data(self) -> None:
        if not self._spotify.refresh_token:
            self.update(
                "[dim]not configured[/dim]\n"
                "Run spotify_auth.py once to connect your\n"
                "Spotify account (see README)"
            )
            return

        try:
            data, upcoming = await asyncio.to_thread(self._fetch_current_and_queue)
        except Exception as err:  # noqa: BLE001 - surface any failure in-panel
            self.show_error(f"spotify unavailable: {err}")
            return

        if data is None:
            self._is_playing = False
            self.update("[dim]Nothing playing[/dim]")
            return

        self._is_playing = data["is_playing"]
        icon = "▶" if data["is_playing"] else "⏸"
        device = f"  ({data['device']})" if data["device"] else ""

        lines = [f"{icon}  {data['artist']} - {data['title']}{device}"]
        if upcoming:
            lines.append("")
            lines.append("[dim]Up next:[/dim]")
            for track in upcoming:
                lines.append(f"[dim]  {track}[/dim]")
        self.update("\n".join(lines))

    # ---- playback controls (p/n/b in app.py) ----

    async def toggle_play_pause(self) -> None:
        if not self._spotify.refresh_token:
            return
        endpoint = "pause" if self._is_playing else "play"
        error = await asyncio.to_thread(self._control, "PUT", endpoint)
        if error:
            self.show_error(error)
        else:
            self._trigger_refresh()

    async def skip_next(self) -> None:
        if not self._spotify.refresh_token:
            return
        error = await asyncio.to_thread(self._control, "POST", "next")
        if error:
            self.show_error(error)
        else:
            self._trigger_refresh()

    async def skip_previous(self) -> None:
        if not self._spotify.refresh_token:
            return
        error = await asyncio.to_thread(self._control, "POST", "previous")
        if error:
            self.show_error(error)
        else:
            self._trigger_refresh()

    def _control(self, method: str, endpoint: str) -> str | None:
        """Returns an error message on failure, or None on success."""
        try:
            token = self._get_access_token()
        except Exception as err:  # noqa: BLE001
            return f"auth error: {err}"

        resp = self._request(method, endpoint, token)

        if resp.status_code == 404 and endpoint == "play" and self._last_device_id:
            # A paused device (phones especially) can drop out of Spotify's
            # "active device" session within moments of pausing, even
            # though the device itself is still open and reachable -
            # explicitly targeting its device_id can wake it back up.
            resp = self._request(method, endpoint, token, body={"device_id": self._last_device_id})

        if resp.status_code == 204:
            return None
        if resp.status_code == 404:
            return "no active Spotify device"
        if resp.status_code == 403:
            try:
                reason = resp.json()["error"]["message"]
            except Exception:  # noqa: BLE001
                reason = "forbidden"
            return f"{reason} (re-run spotify_auth.py for the control scope, or Premium may be required)"
        try:
            resp.raise_for_status()
        except requests.HTTPError as err:
            return str(err)
        return None

    def _request(self, method: str, endpoint: str, token: str, body: dict | None = None):
        return requests.request(
            method,
            f"https://api.spotify.com/v1/me/player/{endpoint}",
            headers={"Authorization": f"Bearer {token}"},
            json=body,
            timeout=10,
        )

    # ---- data fetching ----

    def _fetch_current_and_queue(self) -> tuple[dict | None, list[str]]:
        data = self._fetch_current()
        if data is None:
            return None, []
        try:
            upcoming = self._fetch_queue()
        except Exception:  # noqa: BLE001 - queue is a nice-to-have, don't blank the panel
            upcoming = []
        return data, upcoming

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
        if device.get("id"):
            self._last_device_id = device["id"]
        return {
            "is_playing": bool(body.get("is_playing")),
            "title": item["name"],
            "artist": ", ".join(a["name"] for a in item["artists"]),
            "device": device.get("name"),
        }

    def _fetch_queue(self, limit: int = 5) -> list[str]:
        token = self._get_access_token()
        resp = requests.get(
            "https://api.spotify.com/v1/me/player/queue",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        resp.raise_for_status()
        body = resp.json()

        upcoming = []
        for item in body.get("queue", [])[:limit]:
            artist = item["artists"][0]["name"] if item.get("artists") else ""
            track = f"{item['name']} - {artist}" if artist else item["name"]
            # Keep each queue entry to one line regardless of panel width -
            # predictable line count matters more here than seeing full titles.
            upcoming.append(track if len(track) <= 24 else track[:23] + "…")
        return upcoming

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
