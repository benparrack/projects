"""Common base for a dashboard panel: a titled box that refreshes itself
on an interval via a background worker, so a slow network call in one
panel never blocks the others or the UI loop.
"""

from __future__ import annotations

from textual.containers import Container
from textual.widgets import Static


class Panel(Static):
    """A titled box holding plain text, refreshed on an interval."""

    def __init__(self, *, title: str, refresh_interval: float, **kwargs):
        super().__init__(**kwargs)
        self.border_title = title
        self._refresh_interval = refresh_interval
        self.update("loading...")

    def on_mount(self) -> None:
        self._trigger_refresh()
        self.set_interval(self._refresh_interval, self._trigger_refresh)

    def _trigger_refresh(self) -> None:
        self.run_worker(self.refresh_data(), exclusive=True)

    async def refresh_data(self) -> None:
        raise NotImplementedError

    def show_error(self, message: str) -> None:
        self.update(f"[red]{message}[/red]")


class LivePanel(Container):
    """A titled box holding live sub-widgets (e.g. Sparkline) that a
    subclass updates directly in refresh_data, refreshed on an interval.
    """

    def __init__(self, *, title: str, refresh_interval: float, **kwargs):
        super().__init__(**kwargs)
        self.border_title = title
        self._refresh_interval = refresh_interval

    def on_mount(self) -> None:
        self._trigger_refresh()
        self.set_interval(self._refresh_interval, self._trigger_refresh)

    def _trigger_refresh(self) -> None:
        self.run_worker(self.refresh_data(), exclusive=True)

    async def refresh_data(self) -> None:
        raise NotImplementedError
