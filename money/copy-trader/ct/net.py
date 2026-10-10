"""HTTP with polite pacing, retries and backoff. Every fetch in the bot goes through here."""
import logging
import time

import requests

log = logging.getLogger("net")
RETRY_STATUS = {429, 500, 502, 503, 504}


class FetchError(Exception):
    pass


class Client:
    def __init__(self, min_interval=0.0, headers=None, retries=5, timeout=40):
        self.s = requests.Session()
        self.s.headers.update(headers or {})
        self.min_interval, self.retries, self.timeout = min_interval, retries, timeout
        self._last = 0.0

    def request(self, method, url, **kw):
        err = None
        for attempt in range(self.retries):
            wait = self.min_interval - (time.time() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.time()
            try:
                r = self.s.request(method, url, timeout=self.timeout, **kw)
                if r.status_code in RETRY_STATUS:
                    ra = r.headers.get("Retry-After")
                    err = FetchError(f"HTTP {r.status_code} {url}")
                    back = float(ra) if ra and ra.isdigit() else min(90, 3 * 2 ** attempt)
                else:
                    r.raise_for_status()
                    return r
            except (requests.ConnectionError, requests.Timeout, requests.exceptions.ChunkedEncodingError) as e:
                err, back = e, min(90, 3 * 2 ** attempt)
            log.warning("retry %d for %s in %.0fs: %s", attempt + 1, url, back, err)
            time.sleep(back)
        raise FetchError(str(err))

    def get(self, url, **kw):
        return self.request("GET", url, **kw)

    def post(self, url, **kw):
        return self.request("POST", url, **kw)
