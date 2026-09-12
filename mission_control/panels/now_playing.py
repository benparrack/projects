from __future__ import annotations

import asyncio
import shutil
import subprocess

from .base import Panel

_FORMAT = "{{status}}\t{{artist}}\t{{title}}"


class NowPlayingPanel(Panel):
    def __init__(self, **kwargs):
        super().__init__(title="Now Playing", refresh_interval=3.0, **kwargs)

    async def refresh_data(self) -> None:
        if shutil.which("playerctl") is None:
            self.update("[dim]playerctl not installed - see README[/dim]")
            return

        status, artist, title = await asyncio.to_thread(self._query)
        if status is None:
            self.update("[dim]Nothing playing[/dim]")
            return

        icon = "▶" if status == "Playing" else "⏸"
        who = f"{artist} - {title}" if artist else title
        self.update(f"{icon}  {who}")

    def _query(self) -> tuple[str | None, str | None, str | None]:
        try:
            result = subprocess.run(
                ["playerctl", "metadata", "--format", _FORMAT],
                capture_output=True,
                text=True,
                timeout=3,
            )
        except (OSError, subprocess.SubprocessError):
            return None, None, None

        if result.returncode != 0 or not result.stdout.strip():
            return None, None, None

        parts = result.stdout.strip("\n").split("\t")
        if len(parts) < 3:
            return None, None, None
        return parts[0], parts[1], parts[2]
