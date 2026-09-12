"""Loads config.toml (falling back to defaults) for the dashboard panels."""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent


@dataclass
class WeatherConfig:
    latitude: float | None
    longitude: float | None
    label: str


@dataclass
class Config:
    calendar_ics_url: str
    weather: WeatherConfig
    projects_dir: Path


def _load_raw() -> dict:
    config_path = HERE / "config.toml"
    if not config_path.exists():
        return {}
    with config_path.open("rb") as f:
        return tomllib.load(f)


def load() -> Config:
    raw = _load_raw()

    calendar = raw.get("calendar", {})
    weather = raw.get("weather", {})
    projects = raw.get("projects", {})

    lat_raw = weather.get("latitude", "")
    lon_raw = weather.get("longitude", "")

    projects_dir = projects.get("dir") or ""

    return Config(
        calendar_ics_url=calendar.get("ics_url", "") or "",
        weather=WeatherConfig(
            latitude=float(lat_raw) if lat_raw else None,
            longitude=float(lon_raw) if lon_raw else None,
            label=weather.get("label", "") or "",
        ),
        projects_dir=Path(projects_dir).expanduser() if projects_dir else HERE.parent,
    )
