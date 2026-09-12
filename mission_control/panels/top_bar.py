from __future__ import annotations

from textual.widgets import Static


class TopBar(Static):
    def __init__(self, **kwargs):
        super().__init__("MISSION CONTROL", id="title", **kwargs)
