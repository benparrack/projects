"""Which weather station each Kalshi series settles on, where it is, and how its 'day' is defined."""
import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

DATA = Path(__file__).resolve().parent.parent / "data"
FILE = DATA / "stations.json"


def parse_rules(rules):
    """Station ICAO id, unit and day convention from a market's rules_primary text.
    US series cite an NWS climate report (CLINYC -> KNYC), whose day runs midnight to midnight
    local *standard* time all year. International ones cite the airport (EGLL) and use Celsius."""
    m = re.search(r"\(CLI([A-Z]{3})\)", rules)
    if m:
        return {"icao": "K" + m[1], "unit": "C" if "Celsius" in rules else "F", "standard_time": True}
    m = re.search(r"recorded at ([A-Z]{4})\b", rules)
    if m:
        return {"icao": m[1], "unit": "C" if "Celsius" in rules else "F", "standard_time": False}
    return None


def _fetch_json(url):
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "kalshi-weather"}),
                                        timeout=30) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError):
            if attempt == 5:
                raise
            time.sleep(2 ** attempt * 3)


def locate(icaos):
    """lat/lon from aviationweather.gov, IANA timezone from Open-Meteo."""
    info = {s["icaoId"]: s for s in _fetch_json(
        "https://aviationweather.gov/api/data/stationinfo?format=json&ids=" + ",".join(sorted(icaos)))}
    out = {}
    for icao in icaos:
        s = info.get(icao)
        if not s:
            continue
        tz = _fetch_json(f"https://api.open-meteo.com/v1/forecast?latitude={s['lat']}&longitude={s['lon']}"
                         "&timezone=auto&forecast_days=1")["timezone"]
        out[icao] = {"lat": s["lat"], "lon": s["lon"], "name": s.get("site", icao), "tz": tz}
    return out


def load():
    return json.loads(FILE.read_text()) if FILE.exists() else {}


def save(stations):
    DATA.mkdir(exist_ok=True)
    FILE.write_text(json.dumps(stations, indent=1, sort_keys=True))


def update(series_rules):
    """series_rules: {series: rules text}. Adds any unknown series to data/stations.json."""
    st = load()
    todo = {s: parse_rules(r) for s, r in series_rules.items() if s not in st}
    todo = {s: p for s, p in todo.items() if p}
    if todo:
        where = locate({p["icao"] for p in todo.values()})
        for s, p in todo.items():
            if p["icao"] in where:
                st[s] = {**p, **where[p["icao"]]}
        save(st)
    return st


def std_offset(tz):
    """The zone's standard-time UTC offset: the smaller of its January and July offsets."""
    z = ZoneInfo(tz)
    return min(datetime(2025, mo, 15, tzinfo=z).utcoffset() for mo in (1, 7))


def day_start_utc(station, d):
    """UTC instant where the settlement day `d` begins at this station."""
    midnight = datetime(d.year, d.month, d.day)
    if station["standard_time"]:
        return (midnight - std_offset(station["tz"])).replace(tzinfo=timezone.utc)
    return midnight.replace(tzinfo=ZoneInfo(station["tz"])).astimezone(timezone.utc)


def local_time_utc(station, d, hour, days_before=0):
    """UTC instant of wall-clock `hour`:00 on day d - days_before (civil local time, DST included)."""
    day = d - timedelta(days=days_before)
    return datetime(day.year, day.month, day.day, hour, tzinfo=ZoneInfo(station["tz"])).astimezone(timezone.utc)
