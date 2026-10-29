from __future__ import annotations

import asyncio
import re
from pathlib import Path

from .base import Panel

_ITEM = re.compile(r"^- \*\*(.+?)\*\*", re.MULTILINE)


def _section(text: str, title: str) -> str:
    """Body of the top-level `# <title>` section of IDEAS.md, up to the next `# ` heading."""
    m = re.search(rf"^# {re.escape(title)}\n(.*?)(?=^# |\Z)", text, re.MULTILINE | re.DOTALL)
    return m.group(1) if m else ""
_STOCKED = re.compile(r"^\*\*Status:\*\*\s*Stocked, not started\.", re.MULTILINE)


class UpNextPanel(Panel):
    def __init__(self, config, **kwargs):
        super().__init__(title="Up Next", refresh_interval=30.0, **kwargs)
        self._projects_dir = config.projects_dir

    async def refresh_data(self) -> None:
        ideas_path = self._projects_dir / "IDEAS.md"
        ideas_text = await asyncio.to_thread(self._read, ideas_path)

        if ideas_text is None:
            self.update(f"[dim]No IDEAS.md found in {self._projects_dir}[/dim]")
            return

        unchecked = _ITEM.findall(_section(ideas_text, "Up next"))
        checked = _ITEM.findall(_section(ideas_text, "Done"))

        lines = []
        if unchecked:
            lines.append(f"[bold]Next:[/bold] {unchecked[0]}")
            for item in unchecked[1:4]:
                lines.append(f"  then {item}")
        else:
            lines.append("[dim]Nothing queued in IDEAS.md[/dim]")

        lines.append(f"\n{len(checked)} done, {len(unchecked)} queued")

        if ideas_text:
            stocked = len(_STOCKED.findall(ideas_text))
            lines.append(f"{stocked} more ideas stocked in IDEAS.md")

        self.update("\n".join(lines))

    def _read(self, path: Path) -> str | None:
        try:
            return path.read_text()
        except OSError:
            return None
