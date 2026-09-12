from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

import icalendar
import recurring_ical_events
import requests

from .base import Panel


class CalendarPanel(Panel):
    def __init__(self, config, **kwargs):
        super().__init__(title="Calendar", refresh_interval=300.0, **kwargs)
        self._ics_url = config.calendar_ics_url

    async def refresh_data(self) -> None:
        if not self._ics_url:
            self.update(
                "[dim]not configured[/dim]\n"
                "Set ics_url under the calendar section\n"
                "in config.toml (Google Calendar -> Settings\n"
                "-> Integrate calendar -> Secret address\n"
                "in iCal format)"
            )
            return

        try:
            events = await asyncio.to_thread(self._fetch_events)
        except Exception as err:  # noqa: BLE001 - surface any failure in-panel
            self.show_error(f"calendar unavailable: {err}")
            return

        if not events:
            self.update("[dim]Nothing on the calendar in the next 7 days.[/dim]")
            return

        lines = []
        last_day = None
        for start, summary in events[:8]:
            day = start.date()
            if day != last_day:
                label = "Today" if day == datetime.now().astimezone().date() else day.strftime("%a %b %d")
                lines.append(f"[bold]{label}[/bold]")
                last_day = day
            lines.append(f"  {start.strftime('%H:%M')}  {summary}")
        self.update("\n".join(lines))

    def _fetch_events(self) -> list[tuple[datetime, str]]:
        resp = requests.get(self._ics_url, timeout=10)
        resp.raise_for_status()
        cal = icalendar.Calendar.from_ical(resp.content)

        now = datetime.now().astimezone()
        window_end = now + timedelta(days=7)
        occurrences = recurring_ical_events.of(cal).between(now, window_end)

        events = []
        for occ in occurrences:
            start = occ["DTSTART"].dt
            if not isinstance(start, datetime):
                # all-day event (a date, not a datetime) - anchor at midnight local
                start = combine_date(start, now.tzinfo)
            summary = str(occ.get("SUMMARY", "(no title)"))
            events.append((start, summary))

        events.sort(key=lambda pair: pair[0])
        return events


def combine_date(d, tz):
    return datetime(d.year, d.month, d.day, tzinfo=tz)
