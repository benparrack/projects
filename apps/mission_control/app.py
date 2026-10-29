"""Mission Control - a glanceable terminal dashboard.

Run with:
    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python app.py
"""

from __future__ import annotations

from pathlib import Path

from textual.app import App
from textual.theme import Theme

import config as cfg
from panels.base import LivePanel, Panel
from panels.now_playing import NowPlayingPanel
from screens import LAYOUTS

CSS_PATH = Path(__file__).resolve().parent / "styles" / "common.tcss"

MISSION_CONTROL_THEME = Theme(
    name="mission-control",
    primary="#00d9ff",
    secondary="#ff9d00",
    warning="#ffb454",
    error="#ff5555",
    success="#50fa7b",
    accent="#bd93f9",
    foreground="#e6edf3",
    background="#05070a",
    surface="#0a0e14",
    panel="#0d1117",
    dark=True,
    variables={
        "panel-pink": "#ff79c6",
        "panel-teal": "#2dd4bf",
    },
)


class MissionControlApp(App):
    CSS_PATH = CSS_PATH
    TITLE = "Mission Control"
    BINDINGS = [
        ("q", "quit", "Quit"),
        ("r", "refresh_all", "Refresh"),
        ("p", "play_pause", "Play/Pause"),
        ("n", "next_track", "Next"),
        ("b", "prev_track", "Prev"),
        ("l", "cycle_layout", "Layout"),
    ]

    def __init__(self):
        super().__init__()
        self.config = cfg.load()
        self.register_theme(MISSION_CONTROL_THEME)
        self.theme = "mission-control"
        self._layout_index = 0

    def on_mount(self) -> None:
        self.push_screen(LAYOUTS[self._layout_index](self.config))

    def action_cycle_layout(self) -> None:
        self._layout_index = (self._layout_index + 1) % len(LAYOUTS)
        self.switch_screen(LAYOUTS[self._layout_index](self.config))

    def action_refresh_all(self) -> None:
        for panel in list(self.screen.query(Panel)) + list(self.screen.query(LivePanel)):
            panel._trigger_refresh()

    def action_play_pause(self) -> None:
        panel = self.screen.query_one(NowPlayingPanel)
        panel.run_worker(panel.toggle_play_pause(), exclusive=True)

    def action_next_track(self) -> None:
        panel = self.screen.query_one(NowPlayingPanel)
        panel.run_worker(panel.skip_next(), exclusive=True)

    def action_prev_track(self) -> None:
        panel = self.screen.query_one(NowPlayingPanel)
        panel.run_worker(panel.skip_previous(), exclusive=True)


if __name__ == "__main__":
    MissionControlApp().run()
