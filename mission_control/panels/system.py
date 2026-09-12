from __future__ import annotations

import asyncio
import time

import psutil

from .base import Panel


def _bar(pct: float, width: int = 20) -> str:
    pct = max(0.0, min(100.0, pct))
    filled = round(pct / 100 * width)
    color = "green" if pct < 60 else ("yellow" if pct < 85 else "red")
    return f"[{color}]{'█' * filled}{'░' * (width - filled)}[/{color}]"


def _human_bytes(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}PB"


class SystemPanel(Panel):
    def __init__(self, **kwargs):
        super().__init__(title="System", refresh_interval=2.0, **kwargs)
        self._last_net = None
        self._last_net_time = None

    async def refresh_data(self) -> None:
        cpu, mem, disk, net_line = await asyncio.to_thread(self._sample)
        lines = [
            f"CPU    {_bar(cpu)} {cpu:5.1f}%",
            f"Memory {_bar(mem.percent)} {mem.percent:5.1f}%  "
            f"({_human_bytes(mem.used)} / {_human_bytes(mem.total)})",
            f"Disk   {_bar(disk.percent)} {disk.percent:5.1f}%  "
            f"({_human_bytes(disk.free)} free)",
            net_line,
        ]
        self.update("\n".join(lines))

    def _sample(self):
        cpu = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage("/")
        net = psutil.net_io_counters()
        now = time.monotonic()

        if self._last_net is not None:
            dt = max(now - self._last_net_time, 1e-6)
            up = (net.bytes_sent - self._last_net.bytes_sent) / dt
            down = (net.bytes_recv - self._last_net.bytes_recv) / dt
            net_line = f"Net    ↑ {_human_bytes(up)}/s   ↓ {_human_bytes(down)}/s"
        else:
            net_line = "Net    (measuring...)"

        self._last_net = net
        self._last_net_time = now
        return cpu, mem, disk, net_line
