"""Congressional stock trades from the official disclosure sites (STOCK Act Periodic Transaction Reports).

House: disclosures-clerk.house.gov publishes a yearly ZIP index; electronically filed PTRs are text PDFs.
Senate: efdsearch.senate.gov (accept the usage agreement, then its JSON search + HTML report pages).
Paper/scanned filings (~12% House, a few % Senate) are images and are skipped.
The free aggregators (House/Senate Stock Watcher S3 buckets) now return 403, and Capitol Trades
rate-limits/blocks scripts, so the official sources are the only reliable free option."""
import io
import json
import logging
import re
import zipfile
from datetime import date, timedelta

from ..net import Client
from ..timeutil import end_of_day_et, parse_date
from .figi import yahoo_symbol

log = logging.getLogger("congress")
HOUSE = "https://disclosures-clerk.house.gov/public_disc/"
SENATE = "https://efdsearch.senate.gov"
BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"


def amount_range(text):
    """'$15,001 - $50,000' -> (15001, 50000); 'Over $50,000,000' -> (50000000, 50000000)."""
    nums = [float(x.replace(",", "")) for x in re.findall(r"\$\s?([\d,]{3,})", text)]
    if not nums:
        return None
    return (nums[0], nums[1]) if len(nums) > 1 else (nums[0], nums[0])


ALIASES = {"FB": "META", "BRK.B": "BRK-B", "BRK.A": "BRK-A", "TWTR": "", "ANTM": "ELV"}


def make_txn(ticker, side, lohi, txn_date, asset):
    ticker = ALIASES.get(ticker, ticker)
    return {"ticker": yahoo_symbol(ticker), "side": side, "amount": (lohi[0] + lohi[1]) / 2,
            "txn_date": txn_date.isoformat(), "asset": asset[:80]}


# ---------------------------------------------------------------- House
TXN_RE = re.compile(r"(?:^|\s)(P|S \(partial\)|S|E)\s+(\d{2}/\d{2}/\d{4})\s+(\d{2}/\d{2}/\d{4})\s")
STOP_RE = re.compile(r"^[A-Z](\s{2,}[A-Z]?)+\s*:|^\* For the complete|^ID Owner Asset|^I\s{3,}")
HOUSE_SIDES = {"P": "buy", "S": "sell_full", "S (partial)": "sell_partial"}


def parse_house_ptr(text):
    lines = [l.strip() for l in text.splitlines()]
    starts = [i for i, l in enumerate(lines) if TXN_RE.search(l)]
    out = []
    for n, i in enumerate(starts):
        block = [lines[i]]
        for j in range(i + 1, starts[n + 1] if n + 1 < len(starts) else len(lines)):
            if STOP_RE.search(lines[j]):
                break
            block.append(lines[j])
        joined = " ".join(block)
        m = TXN_RE.search(joined)
        side = HOUSE_SIDES.get(m.group(1))
        tags = re.findall(r"\[([A-Z]{2})\]", joined)
        tks = re.findall(r"\(([A-Z][A-Z0-9.]{0,6})\)", joined)   # ticker can sit before or after the type column
        lohi = amount_range(joined[m.end(3):])
        if side and tks and lohi and tags and tags[0] in ("ST", "EF"):
            asset = re.sub(r"^(SP|JT|DC)\s+", "", joined[:m.start(1)].strip())
            out.append(make_txn(tks[-1], side, lohi, parse_date(m.group(2)), asset))
    return out


def house_index(c, year):
    z = zipfile.ZipFile(io.BytesIO(c.get(f"{HOUSE}financial-pdfs/{year}FD.zip").content))
    xml = z.read(f"{year}FD.xml").decode("utf-8", "replace")
    out = []
    for m in re.findall(r"<Member>(.*?)</Member>", xml, re.S):
        g = lambda t: (re.search(rf"<{t}>(.*?)</{t}>", m, re.S) or [None, ""])[1].strip()
        if g("FilingType") == "P" and g("FilingDate"):
            out.append({"doc_id": g("DocID"), "name": f"{g('Last')}, {g('First')}", "district": g("StateDst"),
                        "filing_date": parse_date(g("FilingDate")), "year": year})
    return out


def ingest_house(con, cfg, years):
    import pdfplumber
    c = Client(min_interval=0.4, headers={"User-Agent": cfg["sec_user_agent"]})
    lag = cfg["delays"]["congress_publish_lag_days"]
    new = 0
    for year in years:
        try:
            idx = house_index(c, year)
        except Exception as e:
            log.warning("House index %s failed: %s", year, e)
            continue
        seen = {r[0] for r in con.execute("SELECT doc_id FROM filings WHERE src='house'")}
        for f in idx:
            if f["doc_id"] in seen:
                continue
            payload = {"name": f["name"], "district": f["district"], "filing_date": f["filing_date"].isoformat()}
            if not f["doc_id"].startswith("2"):        # paper filing: scanned image
                payload["paper"] = True
                payload["txns"] = []
            else:
                try:
                    pdf = c.get(f"{HOUSE}ptr-pdfs/{f['year']}/{f['doc_id']}.pdf").content
                    with pdfplumber.open(io.BytesIO(pdf)) as p:
                        text = "\n".join(pg.extract_text() or "" for pg in p.pages)
                    payload["txns"] = parse_house_ptr(text)
                except Exception as e:
                    log.warning("House PTR %s failed: %s", f["doc_id"], e)
                    continue
            con.execute("INSERT OR REPLACE INTO filings VALUES('house',?,?,?,?)",
                        (f["doc_id"], "H:" + f["name"], end_of_day_et(f["filing_date"], lag), json.dumps(payload)))
            con.commit()
            new += 1
        log.info("House %s: %d PTRs in index", year, len(idx))
    return new


# ---------------------------------------------------------------- Senate
SENATE_SIDES = {"purchase": "buy", "sale (full)": "sell_full", "sale (partial)": "sell_partial", "sale": "sell_full"}


def _cells(row_html):
    cells = re.findall(r"<td[^>]*>(.*?)</td>", row_html, re.S)
    return [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", x)).replace("&amp;", "&").strip() for x in cells]


def parse_senate_ptr(html):
    body = re.search(r"<tbody>(.*?)</tbody>", html, re.S)
    out = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", body.group(1) if body else "", re.S):
        cl = _cells(row)
        if len(cl) < 8:
            continue
        _, tdate, _owner, ticker, asset, atype, typ, amount = cl[:8]
        side = SENATE_SIDES.get(typ.lower())
        lohi = amount_range(amount)
        ticker = ticker.split()[0] if ticker else ""
        if side and lohi and atype.lower() == "stock" and re.fullmatch(r"[A-Z][A-Z0-9.]{0,6}", ticker):
            out.append(make_txn(ticker, side, lohi, parse_date(tdate), asset))
    return out


class Senate:
    def __init__(self):
        self.c = Client(min_interval=0.6, headers={"User-Agent": BROWSER_UA})
        self.ready = False

    def _agree(self):
        r = self.c.get(SENATE + "/search/home/")
        tok = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', r.text).group(1)
        self.c.post(SENATE + "/search/home/", data={"prohibition_agreement": "1", "csrfmiddlewaretoken": tok},
                    headers={"Referer": SENATE + "/search/home/"})
        self.ready = True

    def search(self, start_date, end_date):
        if not self.ready:
            self._agree()
        out, start = [], 0
        while True:
            csrf = self.c.s.cookies.get("csrftoken")
            data = {"start": str(start), "length": "100", "report_types": "[11]", "filer_types": "[]",
                    "submitted_start_date": start_date.strftime("%m/%d/%Y 00:00:00"),
                    "submitted_end_date": end_date.strftime("%m/%d/%Y 23:59:59"), "candidate_state": "",
                    "senator_state": "", "office_id": "", "first_name": "", "last_name": "",
                    "csrfmiddlewaretoken": csrf}
            j = self.c.post(SENATE + "/search/report/data/", data=data,
                            headers={"Referer": SENATE + "/search/", "X-CSRFToken": csrf}).json()
            out += j["data"]
            start += 100
            if start >= j["recordsTotal"] or not j["data"]:
                return out

    def page(self, link):
        r = self.c.get(SENATE + link)
        if "prohibition_agreement" in r.text:   # session expired
            self._agree()
            r = self.c.get(SENATE + link)
        return r.text


def ingest_senate(con, cfg, since, until=None):
    s = Senate()
    lag = cfg["delays"]["congress_publish_lag_days"]
    until = until or date.today()
    new = 0
    seen = {r[0] for r in con.execute("SELECT doc_id FROM filings WHERE src='senate'")}
    d = since
    while d <= until:                                   # search per quarter keeps result pages small
        end = min(until, d + timedelta(days=91))
        try:
            rows = s.search(d, end)
        except Exception as e:
            log.warning("Senate search %s..%s failed: %s", d, end, e)
            d = end + timedelta(days=1)
            continue
        for first, last, office, link_html, fdate in rows:
            link = re.search(r'href="([^"]+)"', link_html).group(1)
            doc_id = link.rstrip("/").split("/")[-1]
            if doc_id in seen:
                continue
            fd = parse_date(fdate)
            payload = {"name": f"{last}, {first}", "office": office, "filing_date": fd.isoformat()}
            if "/ptr/" not in link:
                payload["paper"], payload["txns"] = True, []
            else:
                try:
                    payload["txns"] = parse_senate_ptr(s.page(link))
                except Exception as e:
                    log.warning("Senate PTR %s failed: %s", doc_id, e)
                    continue
            con.execute("INSERT OR REPLACE INTO filings VALUES('senate',?,?,?,?)",
                        (doc_id, f"S:{last}, {first}", end_of_day_et(fd, lag), json.dumps(payload)))
            con.commit()
            seen.add(doc_id)
            new += 1
        log.info("Senate %s..%s: %d PTRs", d, end, len(rows))
        d = end + timedelta(days=1)
    return new
