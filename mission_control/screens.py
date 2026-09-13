"""Alternate top-level layouts, switchable live with the 'l' keybinding
(see app.py). Each Screen gets its own fresh set of panel widgets - a
widget can only be mounted in one place at a time, so layouts can't
share instances - and its own structural stylesheet in styles/; panel
look (borders, colors) is shared via styles/common.tcss.
"""

from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import Grid, Horizontal, Vertical, VerticalScroll
from textual.screen import Screen
from textual.widgets import Footer

from panels.calendar_panel import CalendarPanel
from panels.clock import ClockPanel
from panels.git_status import GitStatusPanel
from panels.notes import NotesPanel
from panels.now_playing import NowPlayingPanel
from panels.system import SystemPanel
from panels.top_bar import TopBar
from panels.up_next import UpNextPanel
from panels.weather import WeatherPanel


def _fresh_panels(config) -> dict:
    return {
        "system": SystemPanel(id="system"),
        "weather": WeatherPanel(config, id="weather"),
        "calendar": CalendarPanel(config, id="calendar"),
        "nowplaying": NowPlayingPanel(config, id="nowplaying"),
        "clock": ClockPanel(id="clock"),
        "upnext": UpNextPanel(config, id="upnext"),
        "notes": NotesPanel(id="notes"),
        "git": GitStatusPanel(config, id="git"),
    }


class GridScreen(Screen):
    """The original layout."""

    CSS_PATH = "styles/grid.tcss"
    NAME = "grid"

    def __init__(self, config):
        super().__init__()
        self._config = config

    def compose(self) -> ComposeResult:
        p = _fresh_panels(self._config)
        yield TopBar(self.NAME)
        with Grid(id="grid"):
            yield p["system"]
            yield p["weather"]
            yield p["calendar"]
            yield p["nowplaying"]
            yield p["clock"]
            yield p["upnext"]
            yield p["git"]
        yield Footer()


class SidebarScreen(Screen):
    """Narrow sidebar (Clock, Now Playing, Up Next) beside a wider main
    area (System/Weather/Calendar on top, Git full-width below)."""

    CSS_PATH = "styles/sidebar.tcss"
    NAME = "sidebar"

    def __init__(self, config):
        super().__init__()
        self._config = config

    def compose(self) -> ComposeResult:
        p = _fresh_panels(self._config)
        yield TopBar(self.NAME)
        with Horizontal(id="body"):
            with Vertical(id="sidebar"):
                yield p["clock"]
                yield p["nowplaying"]
                yield p["upnext"]
            with Vertical(id="main"):
                with Horizontal(id="top_area"):
                    with Vertical(id="top_left"):
                        with Horizontal(id="sys_weather_row"):
                            yield p["system"]
                            yield p["weather"]
                        yield p["notes"]
                    yield p["calendar"]
                yield p["git"]
        yield Footer()


class StackedScreen(Screen):
    """Single scrolling column, all panels stacked in priority order."""

    CSS_PATH = "styles/stacked.tcss"
    NAME = "stacked"

    def __init__(self, config):
        super().__init__()
        self._config = config

    def compose(self) -> ComposeResult:
        p = _fresh_panels(self._config)
        yield TopBar(self.NAME)
        with VerticalScroll(id="stack"):
            yield p["clock"]
            yield p["nowplaying"]
            yield p["system"]
            yield p["weather"]
            yield p["notes"]
            yield p["calendar"]
            yield p["upnext"]
            yield p["git"]
        yield Footer()


LAYOUTS = [SidebarScreen, GridScreen, StackedScreen]
