from __future__ import annotations

from datetime import datetime

from textual.app import ComposeResult
from textual.containers import Horizontal
from textual.widgets import Static


class TopBar(Horizontal):
    def compose(self) -> ComposeResult:
        yield Static("MISSION CONTROL", id="title")
        yield Static("", id="clock")

    def on_mount(self) -> None:
        self._tick()
        self.set_interval(1.0, self._tick)

    def _tick(self) -> None:
        self.query_one("#clock", Static).update(datetime.now().strftime("%a %b %d   %H:%M:%S"))
