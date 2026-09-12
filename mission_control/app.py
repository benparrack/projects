"""Mission Control - a glanceable terminal dashboard.

Run with:
    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python app.py
"""

from __future__ import annotations

from pathlib import Path

from textual.app import App, ComposeResult
from textual.containers import Grid
from textual.widgets import Footer, Header

import config as cfg
from panels.base import Panel
from panels.calendar_panel import CalendarPanel
from panels.git_status import GitStatusPanel
from panels.system import SystemPanel
from panels.up_next import UpNextPanel
from panels.weather import WeatherPanel

CSS_PATH = Path(__file__).resolve().parent / "styles.tcss"


class MissionControlApp(App):
    CSS_PATH = CSS_PATH
    TITLE = "Mission Control"
    BINDINGS = [
        ("q", "quit", "Quit"),
        ("r", "refresh_all", "Refresh"),
    ]

    def __init__(self):
        super().__init__()
        self.config = cfg.load()

    def compose(self) -> ComposeResult:
        yield Header()
        with Grid(id="grid"):
            yield SystemPanel(id="system")
            yield WeatherPanel(self.config, id="weather")
            yield CalendarPanel(self.config, id="calendar")
            yield GitStatusPanel(self.config, id="git")
            yield UpNextPanel(self.config, id="upnext")
        yield Footer()

    def action_refresh_all(self) -> None:
        for panel in self.query(Panel):
            panel._trigger_refresh()


if __name__ == "__main__":
    MissionControlApp().run()
