"""claude-usage command line entry point."""

import argparse
import json
import subprocess
import sys
import time
import urllib.request

from . import server
from .analysis import Analysis, pretty_path
from .parser import Scanner

DEFAULT_PORT = 8765


def _running(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=1) as r:
            return json.loads(r.read()).get("app") == "claude-usage"
    except Exception:
        return False


def _open(url):
    for cmd in (["xdg-open", url], ["firefox", url]):
        try:
            subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            return
        except FileNotFoundError:
            continue
    print(f"Open {url} in your browser.")


def cmd_serve(args):
    url = f"http://127.0.0.1:{args.port}/"
    if _running(args.port):
        print(f"claude-usage is already running at {url}")
        if not args.no_open:
            _open(url)
        return

    def ready(_):
        print(f"claude-usage dashboard: {url}   (Ctrl-C to stop)")
        if not args.no_open:
            _open(url)

    server.serve(port=args.port, host=args.host, ready=ready)


def _fmt_money(x):
    return f"${x:,.2f}"


def _fmt_dur(s):
    s = max(0, int(s))
    return f"{s // 3600}h {s % 3600 // 60:02d}m"


def cmd_summary(args):
    records, _ = Scanner().scan()
    a = Analysis(records, server.load_settings())
    now = time.time()
    day0 = time.mktime(time.localtime(now)[:3] + (0, 0, 0, 0, 0, -1))
    today = [r for r in a.requests if r["ts"] >= day0]
    week = a.weekly()
    cur = a.current_block()
    bold = "\033[1m" if sys.stdout.isatty() else ""
    dim = "\033[2m" if sys.stdout.isatty() else ""
    rst = "\033[0m" if sys.stdout.isatty() else ""
    print(f"{bold}Claude Code usage{rst}  {dim}(API-equivalent $, Pro limit estimates){rst}")
    print(f"  Today      {_fmt_money(sum(r['cost'] for r in today)):>10}   {len(today)} requests")
    print(f"  Last 7d    {_fmt_money(week['cost']):>10}   prev 7d {_fmt_money(week['prev_cost'])}")
    print(f"  All time   {_fmt_money(sum(r['cost'] for r in a.requests)):>10}   {len(a.sessions)} sessions")
    if cur and cur["active"]:
        b = cur["block"]
        pct = f"{cur['pct']:.0f}%" if cur["pct"] is not None else "?"
        bar_n = int(min(cur["pct"] or 0, 100) / 5)
        bar = "█" * bar_n + "░" * (20 - bar_n)
        print(f"\n{bold}Current 5h window{rst}  {bar} {pct} of est. limit")
        print(f"  resets in {_fmt_dur(cur['remaining_s'])}   burn {_fmt_money(cur['cost_rate_per_hour'])}/h"
              f"   window cost {_fmt_money(b['cost'])}")
        if cur["eta_limit"]:
            print(f"  at this pace you'd hit the limit at {time.strftime('%H:%M', time.localtime(cur['eta_limit']))}")
        for s in cur["sessions"][:4]:
            live = "●" if s["live"] else " "
            print(f"  {live} {s['title'][:52]:<52} {s['units'] / (cur['limit'] or 1) * 100:5.1f}%")
    else:
        print(f"\n{dim}No active 5h window: the next message starts a fresh one.{rst}")
    ins = a.insights()
    if ins["recommendations"]:
        top = ins["recommendations"][0]
        print(f"\n{bold}Top saving{rst}  {top['title']}: ≈{_fmt_money(top['savings'])} across {top['sessions']} sessions")
    print(f"{dim}Dashboard: claude-usage   (details, sessions, insights){rst}")


def cmd_validate(args):
    """Compare transcript-derived cost with Claude Code's own cost-state totals."""
    records, _ = Scanner().scan()
    a = Analysis(records)
    rows = []
    for s in a.sessions.values():
        cs = (s["cost_state"] or {}).get("total")
        if not cs:
            continue
        transcript = sum(r["cost"] - r["c_bg"] for r in s["requests"])
        rows.append((s, cs, transcript))
    tot_cc = sum(r[1] for r in rows)
    tot_tr = sum(r[2] for r in rows)
    print(f"{len(rows)} sessions with a cost-state record")
    print(f"  Claude Code total      {_fmt_money(tot_cc)}")
    print(f"  transcript-derived     {_fmt_money(tot_tr)}  ({tot_tr / tot_cc * 100:.1f}%)")
    print(f"  background (untranscribed classifier/title/side calls) ≈ {_fmt_money(sum(s['bg_cost'] for s, _, _ in rows))}")
    for s, cs, tr in sorted(rows, key=lambda x: -x[1])[:args.top]:
        print(f"  {cs:9.2f} {tr:9.2f}  {pretty_path(s['cwd'] or '')[:24]:<24} {a.session_title(s['id'])[:50]}")


def cmd_calibrate(args):
    server.add_usage_reading(args.pct)
    records, _ = Scanner().scan()
    a = Analysis(records, server.load_settings())
    c = a.calibration
    cur = a.current_block()
    print(f"Recorded /usage reading: {args.pct:g}%")
    if c["weights"]:
        print("  model weights vs Sonnet: " + ", ".join(f"{f} {w:.2f}x" for f, w in c["weights"].items()))
    if cur and cur["active"] and cur["pct"] is not None:
        print(f"  dashboard now says {cur['pct']:.0f}% for the current window")


def main(argv=None):
    p = argparse.ArgumentParser(prog="claude-usage", description="Claude Code usage analyst")
    sub = p.add_subparsers(dest="cmd")
    ps = sub.add_parser("serve", help="run the dashboard (default)")
    for q in (p, ps):
        q.add_argument("--port", type=int, default=DEFAULT_PORT)
        q.add_argument("--host", default="127.0.0.1")
        q.add_argument("--no-open", action="store_true", help="don't open a browser")
    sub.add_parser("summary", help="print a quick terminal summary")
    pc = sub.add_parser("calibrate", help="record the %% that Claude Code's /usage shows for the current session")
    pc.add_argument("pct", type=float)
    pv = sub.add_parser("validate", help="check costs against Claude Code's own totals")
    pv.add_argument("--top", type=int, default=10)
    args = p.parse_args(argv)
    if args.cmd == "summary":
        cmd_summary(args)
    elif args.cmd == "calibrate":
        cmd_calibrate(args)
    elif args.cmd == "validate":
        cmd_validate(args)
    else:
        cmd_serve(args)


if __name__ == "__main__":
    main()
