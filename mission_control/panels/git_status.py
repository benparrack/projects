from __future__ import annotations

import asyncio
from pathlib import Path

from .base import Panel


class GitStatusPanel(Panel):
    """Assumes a single repo at projects_dir (a monorepo of project
    folders), and reports overall repo status plus which project folder
    was touched most recently.
    """

    def __init__(self, config, **kwargs):
        super().__init__(title="Projects", refresh_interval=20.0, **kwargs)
        self._repo_dir = config.projects_dir

    async def refresh_data(self) -> None:
        if not (self._repo_dir / ".git").exists():
            self.update(f"[dim]No git repo found at {self._repo_dir}[/dim]")
            return

        branch = await self._run_git("rev-parse", "--abbrev-ref", "HEAD")
        status_out = await self._run_git("status", "--porcelain")
        dirty_count = len(status_out.splitlines()) if status_out else 0
        ahead_behind = await self._run_git("rev-list", "--left-right", "--count", "@{u}...HEAD")

        header = f"[bold]{branch or '?'}[/bold]"
        header += f"  [yellow]{dirty_count} uncommitted[/yellow]" if dirty_count else "  [green]clean[/green]"
        if ahead_behind:
            parts = ahead_behind.split()
            if len(parts) == 2:
                behind, ahead = parts
                if ahead != "0":
                    header += f"  ↑{ahead}"
                if behind != "0":
                    header += f"  ↓{behind}"

        project_dirs = sorted(
            p.name for p in self._repo_dir.iterdir() if p.is_dir() and not p.name.startswith(".")
        )
        touches = await asyncio.gather(*(self._last_touch(name) for name in project_dirs))
        touches = [t for t in touches if t]
        touches.sort(key=lambda t: t[0], reverse=True)

        lines = [header, ""]
        for _, text in touches[:6]:
            lines.append(text)
        self.update("\n".join(lines))

    async def _last_touch(self, name: str) -> tuple[int, str] | None:
        out = await self._run_git("log", "-1", "--format=%ct\t%cr\t%s", "--", name)
        if not out:
            return None
        ts, when, subject = out.split("\t", 2)
        label = name.ljust(24)[:24]
        return int(ts), f"{label} {when:<14} {subject[:36]}"

    async def _run_git(self, *args: str) -> str:
        try:
            proc = await asyncio.create_subprocess_exec(
                "git",
                "-C",
                str(self._repo_dir),
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            stdout, _ = await proc.communicate()
            return stdout.decode().strip()
        except FileNotFoundError:
            return ""
