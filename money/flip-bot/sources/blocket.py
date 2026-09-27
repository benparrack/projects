"""Blocket (FINN platform) search: listings live in the page as base64 JSON."""
import base64
import json
import re
from dataclasses import dataclass, field

import requests

SEARCH_URL = "https://www.blocket.se/recommerce/forsale/search"
UA = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"
_STATE_RE = re.compile(r'<script[^>]*data-react-query-state[^>]*>(.*?)</script>', re.S)


@dataclass
class Listing:
    source: str
    id: str
    title: str
    price_sek: int
    location: str
    lat: float | None
    lon: float | None
    posted_at: float  # unix seconds
    url: str
    image_urls: list = field(default_factory=list)


def parse(html: str) -> list[Listing]:
    m = _STATE_RE.search(html)
    if not m:
        raise ValueError("blocket: react-query-state script not found (page layout changed?)")
    state = json.loads(base64.b64decode(m.group(1).strip()))
    for q in state.get("queries", []):
        data = q.get("state", {}).get("data")
        if isinstance(data, dict) and "docs" in data:
            return [_to_listing(d) for d in data["docs"] if d.get("price")]
    return []


def _to_listing(d: dict) -> Listing:
    c = d.get("coordinates") or {}
    return Listing(
        source="blocket",
        id=str(d["id"]),
        title=d.get("heading", ""),
        price_sek=int(d["price"]["amount"]),
        location=d.get("location", ""),
        lat=c.get("lat"),
        lon=c.get("lon"),
        posted_at=d.get("timestamp", 0) / 1000,
        url=d.get("canonical_url", ""),
        image_urls=d.get("image_urls") or [],
    )


def search(query: str, session: requests.Session | None = None) -> list[Listing]:
    s = session or requests.Session()
    r = s.get(SEARCH_URL, params={"q": query, "sort": "PUBLISHED_DESC"},
              headers={"User-Agent": UA}, timeout=20)
    r.raise_for_status()
    return parse(r.text)
