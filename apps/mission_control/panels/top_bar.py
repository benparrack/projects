from __future__ import annotations

from textual.widgets import Static


class TopBar(Static):
    def __init__(self, layout_name: str = "", **kwargs):
        text = "MISSION CONTROL"
        if layout_name:
            text += f"   [dim]· {layout_name} layout (l to cycle)[/dim]"
        super().__init__(text, id="title", **kwargs)
