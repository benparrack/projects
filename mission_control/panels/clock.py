from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from .base import Panel

HOME_TZ = ZoneInfo("America/New_York")


class ClockPanel(Panel):
    def __init__(self, **kwargs):
        super().__init__(title="Clock", refresh_interval=1.0, **kwargs)

    async def refresh_data(self) -> None:
        now_local = datetime.now().astimezone()
        now_home = now_local.astimezone(HOME_TZ)

        lines = [
            f"[bold]{now_local.strftime('%a %b %d')}[/bold]",
            f"{now_local.strftime('%H:%M:%S')}  {now_local.tzname()}",
            "",
            f"{now_home.strftime('%H:%M:%S')}  {now_home.tzname()}  [dim](home)[/dim]",
        ]
        self.update("\n".join(lines))
