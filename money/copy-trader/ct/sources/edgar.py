"""SEC EDGAR 13F-HR filings for a fixed set of funds (official API, contact User-Agent required)."""
import json
import logging
import re
from datetime import datetime

from ..net import Client
from ..timeutil import parse_date

log = logging.getLogger("edgar")
SUB = "https://data.sec.gov/submissions/"
ARCH = "https://www.sec.gov/Archives/edgar/data/"


def client(cfg):
    # SEC fair-access limit is 10 req/s; stay well below it.
    return Client(min_interval=0.2, headers={"User-Agent": cfg["sec_user_agent"]})


def list_13f(c, cik, since):
    """[(accession, filing_date, acceptance_ts, report_date)] for original 13F-HR filings since `since`.
    Amendments (13F-HR/A) are ignored: most restate or add a few lines, and mixing them in would need
    per-amendment merge rules."""
    first = c.get(f"{SUB}CIK{cik:010d}.json").json()
    blocks = [first["filings"]["recent"]]
    for f in first["filings"].get("files", []):
        if f.get("filingTo", "9999") >= since.isoformat():
            blocks.append(c.get(SUB + f["name"]).json())
    out = []
    for b in blocks:
        for i, form in enumerate(b["form"]):
            if form != "13F-HR" or parse_date(b["filingDate"][i]) < since:
                continue
            acc_ts = datetime.fromisoformat(b["acceptanceDateTime"][i].replace("Z", "+00:00")).timestamp()
            out.append((b["accessionNumber"][i], b["filingDate"][i], acc_ts, b["reportDate"][i]))
    return sorted(set(out), key=lambda x: x[2])


def parse_infotable(xml):
    """Aggregate an information table to {cusip: value} for plain share positions.
    Skips options (putCall present) and principal-amount rows (bonds/notes)."""
    holdings, names = {}, {}
    for row in re.findall(r"<(?:\w+:)?infoTable>(.*?)</(?:\w+:)?infoTable>", xml, re.S):
        def g(tag):
            m = re.search(rf"<(?:\w+:)?{tag}>\s*(.*?)\s*</(?:\w+:)?{tag}>", row, re.S)
            return m.group(1) if m else None
        if g("putCall") or (g("sshPrnamtType") or "SH").upper() != "SH":
            continue
        cusip = (g("cusip") or "").upper()
        try:
            v = float(g("value") or 0)
        except ValueError:
            continue
        if cusip and v > 0:
            holdings[cusip] = holdings.get(cusip, 0) + v
            names[cusip] = g("nameOfIssuer")
    return holdings, names


def fetch_infotable(c, cik, acc):
    base = f"{ARCH}{cik}/{acc.replace('-', '')}/"
    items = c.get(base + "index.json").json()["directory"]["item"]
    xmls = [x["name"] for x in items if x["name"].lower().endswith(".xml") and x["name"] != "primary_doc.xml"]
    best = None
    for name in xmls:
        txt = c.get(base + name).text
        if "infoTable" in txt:
            best = txt
            break
    return parse_infotable(best) if best else ({}, {})


def ingest(con, cfg, since):
    c = client(cfg)
    lag = cfg["delays"]["edgar_minutes"] * 60
    new = 0
    for fund, cik in cfg["funds"].items():
        try:
            filings = list_13f(c, cik, since)
        except Exception as e:  # one bad fund must not block the others
            log.warning("13F list failed for %s: %s", fund, e)
            continue
        for acc, fdate, acc_ts, period in filings:
            if con.execute("SELECT 1 FROM filings WHERE src='13f' AND doc_id=?", (acc,)).fetchone():
                continue
            try:
                holdings, names = fetch_infotable(c, cik, acc)
            except Exception as e:
                log.warning("13F %s %s failed: %s", fund, acc, e)
                continue
            payload = {"period": period, "filing_date": fdate, "holdings": holdings, "names": names}
            con.execute("INSERT OR REPLACE INTO filings VALUES('13f',?,?,?,?)",
                        (acc, fund, acc_ts + lag, json.dumps(payload)))
            con.commit()
            new += 1
            log.info("13F %s %s (%s): %d holdings", fund, period, fdate, len(holdings))
    return new
