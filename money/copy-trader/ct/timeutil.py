from datetime import date, datetime, time as dtime, timedelta, timezone
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
UTC = timezone.utc


def ts(dt):
    return dt.timestamp()


def parse_date(s):
    """'2026-07-13', '7/13/2026' or '07/13/2026' -> date."""
    s = s.strip()
    if "-" in s:
        return date.fromisoformat(s[:10])
    m, d, y = s.split("/")
    return date(int(y), int(m), int(d))


def end_of_day_et(d, plus_days=0):
    d = d + timedelta(days=plus_days)
    return datetime.combine(d, dtime(23, 59), ET).timestamp()


def day_t(d):
    """Key for a daily bar: unix seconds of the date at 00:00 UTC."""
    return int(datetime.combine(d, dtime(0, 0), UTC).timestamp())


def t_day(t):
    return datetime.fromtimestamp(t, UTC).date()


def market_open_ts(d):
    return datetime.combine(d, dtime(9, 30), ET).timestamp()


def market_close_ts(d):
    return datetime.combine(d, dtime(16, 0), ET).timestamp()


def iso(t):
    return datetime.fromtimestamp(t, UTC).strftime("%Y-%m-%d %H:%M")
