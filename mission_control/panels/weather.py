from __future__ import annotations

import asyncio

import requests

from .base import Panel

# Subset of WMO weather codes (used by Open-Meteo) worth distinguishing
# on a small panel; unlisted codes fall back to a generic label. Plain
# text only (no emoji) - color-emoji glyph support varies a lot across
# terminal fonts, plain text renders identically everywhere.
_WEATHER_CODES = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    80: "Rain showers",
    81: "Rain showers",
    82: "Violent showers",
    95: "Thunderstorm",
    96: "Thunderstorm w/ hail",
    99: "Thunderstorm w/ hail",
}


class WeatherPanel(Panel):
    def __init__(self, config, **kwargs):
        super().__init__(title="Weather", refresh_interval=900.0, **kwargs)
        self._config = config
        self._location = None  # (lat, lon, label), resolved once

    async def refresh_data(self) -> None:
        try:
            if self._location is None:
                self._location = await asyncio.to_thread(self._resolve_location)
            lat, lon, label = self._location
            current = await asyncio.to_thread(self._fetch_weather, lat, lon)
        except Exception as err:  # noqa: BLE001 - surface any failure in-panel
            self.show_error(f"weather unavailable: {err}")
            return

        temp = current["temperature_2m"]
        feels = current["apparent_temperature"]
        wind = current["wind_speed_10m"]
        code = int(current["weather_code"])
        desc = _WEATHER_CODES.get(code, "Unknown")

        lines = [
            f"[bold]{label}[/bold]",
            f"{temp:.0f}°F  ({desc})",
            f"Feels like {feels:.0f}°F",
            f"Wind {wind:.0f} mph",
        ]
        self.update("\n".join(lines))

    def _resolve_location(self):
        w = self._config.weather
        if w.latitude is not None and w.longitude is not None:
            return w.latitude, w.longitude, (w.label or "Configured location")

        resp = requests.get("http://ip-api.com/json/", timeout=5)
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") != "success":
            raise RuntimeError("IP geolocation failed")
        label = f"{data['city']}, {data['regionName']}"
        return data["lat"], data["lon"], label

    def _fetch_weather(self, lat: float, lon: float) -> dict:
        resp = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat,
                "longitude": lon,
                "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
                "temperature_unit": "fahrenheit",
                "wind_speed_unit": "mph",
            },
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()["current"]
