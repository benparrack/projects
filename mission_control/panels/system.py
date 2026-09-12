from __future__ import annotations

import asyncio
import time
from collections import deque

import psutil
from textual.app import ComposeResult
from textual.widgets import Label, Sparkline, Static

from .base import LivePanel

HISTORY_LEN = 40


def _human_bytes(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}PB"


class SystemPanel(LivePanel):
    def __init__(self, **kwargs):
        super().__init__(title="System", refresh_interval=2.0, **kwargs)
        self._cpu_history = deque([0.0] * HISTORY_LEN, maxlen=HISTORY_LEN)
        self._mem_history = deque([0.0] * HISTORY_LEN, maxlen=HISTORY_LEN)
        self._last_net = None
        self._last_net_time = None

    def compose(self) -> ComposeResult:
        yield Label("CPU", id="cpu_label")
        yield Sparkline([], id="cpu_spark", min_color="green", max_color="red")
        yield Label("Memory", id="mem_label")
        yield Sparkline([], id="mem_spark", min_color="green", max_color="red")
        yield Static("", id="disk_net_text")

    async def refresh_data(self) -> None:
        cpu, mem, disk, net_line = await asyncio.to_thread(self._sample)
        self._cpu_history.append(cpu)
        self._mem_history.append(mem.percent)

        self.query_one("#cpu_label", Label).update(f"CPU    {cpu:5.1f}%")
        self.query_one("#cpu_spark", Sparkline).data = list(self._cpu_history)

        self.query_one("#mem_label", Label).update(
            f"Memory {mem.percent:5.1f}%  ({_human_bytes(mem.used)} / {_human_bytes(mem.total)})"
        )
        self.query_one("#mem_spark", Sparkline).data = list(self._mem_history)

        self.query_one("#disk_net_text", Static).update(
            f"Disk   {disk.percent:5.1f}%  ({_human_bytes(disk.free)} free)\n{net_line}"
        )

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
