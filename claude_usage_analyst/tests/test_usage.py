"""Tests on synthetic transcripts: python3 -m unittest discover -s tests"""

import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from claude_usage import live, pricing  # noqa: E402
from claude_usage.analysis import Analysis  # noqa: E402
from claude_usage.parser import Scanner, parse_file, parse_reset  # noqa: E402

T0 = datetime(2026, 9, 20, 10, 3, tzinfo=timezone.utc).timestamp()


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat().replace("+00:00", "Z")


def assistant(t, mid, out=100, cr=0, cw=0, inp=10, tools=(), model="claude-sonnet-5", side=False):
    content = [{"type": "tool_use", "id": tid, "name": name, "input": inp_} for tid, name, inp_ in tools]
    return {"type": "assistant", "timestamp": iso(t), "requestId": "req_" + mid, "isSidechain": side,
            "cwd": "/proj", "message": {"id": "msg_" + mid, "model": model, "content": content or [{"type": "text", "text": "ok"}],
                                        "usage": {"input_tokens": inp, "output_tokens": out, "cache_read_input_tokens": cr,
                                                  "cache_creation_input_tokens": cw,
                                                  "cache_creation": {"ephemeral_1h_input_tokens": cw, "ephemeral_5m_input_tokens": 0}}}}


def user(t, text, uid):
    return {"type": "user", "timestamp": iso(t), "uuid": uid, "cwd": "/proj", "origin": {"kind": "human"},
            "message": {"role": "user", "content": text}}


def tool_result(t, tid, chars):
    return {"type": "user", "timestamp": iso(t), "uuid": "tr" + tid,
            "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid, "content": "x" * chars}]}}


class Fixture:
    def __init__(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "projects"
        self.proj = Path(self.tmp.name) / "proj"
        (self.proj / "gameA").mkdir(parents=True)
        (self.proj / "gameB").mkdir(parents=True)
        d = self.root / "-proj"
        d.mkdir(parents=True)
        pj = str(self.proj)
        lines = [
            user(T0, "build game A please", "u1"),
            assistant(T0 + 5, "a1", out=50, cw=20000,
                      tools=[("t1", "Read", {"file_path": pj + "/gameA/main.js"})]),
            # the same response streamed again with more output: must dedupe, keep max
            assistant(T0 + 6, "a1", out=400, cw=20000),
            tool_result(T0 + 7, "t1", 200_000),
            assistant(T0 + 60, "a2", out=300, cr=70000, cw=1000),
            user(T0 + 120, "<task-notification><summary>Agent \"x\" finished</summary></task-notification>", "u2"),
            {"type": "ai-title", "aiTitle": "Game A work", "sessionId": "s1"},
            {"type": "cost-state", "totalCostUSD": 0.0},  # replaced below once we know the cost
        ]
        for i in range(30):
            lines.append(assistant(T0 + 200 + i * 10, f"b{i}", out=100, cr=80000 + i * 5000, cw=500,
                                   tools=[(f"e{i}", "Edit", {"file_path": pj + "/gameB/x.js"})]))
        # rate-limit hit, resetting 5h after the window start at 10:00 UTC (12:00 Stockholm)
        lines.append({"type": "assistant", "timestamp": iso(T0 + 600), "isApiErrorMessage": True, "error": "rate_limit",
                      "message": {"model": "<synthetic>", "content": [{"type": "text", "text": "You've hit your session limit · resets 5pm (Europe/Stockholm)"}]}})
        for x in lines:
            if "cwd" in x:
                x["cwd"] = pj
        # compute the expected transcript cost for the cost-state line (+ 10% background)
        rec_path = d / "s1.jsonl"
        rec_path.write_text("\n".join(json.dumps(x) for x in lines) + "\n")
        parsed = parse_file(rec_path)
        self.transcript_cost = sum(sum(pricing.cost_parts(r["model"], r["in"], r["cw5"], r["cw1"], r["cr"], r["out"]))
                                   for r in parsed["requests"])
        lines[7] = {"type": "cost-state", "totalCostUSD": self.transcript_cost * 1.1}
        rec_path.write_text("\n".join(json.dumps(x) for x in lines) + "\n")
        # subagent transcript
        sub = d / "s1" / "subagents"
        sub.mkdir(parents=True)
        (sub / "agent-abc.jsonl").write_text("\n".join(json.dumps(x) for x in [
            {**user(T0 + 30, "explore the code", "su1"), "isSidechain": True},
            assistant(T0 + 40, "sa1", out=200, cw=5000, side=True),
        ]) + "\n")
        (sub / "agent-abc.meta.json").write_text(json.dumps({"agentType": "Explore", "description": "look around"}))
        self.cache = Path(self.tmp.name) / "cache.pickle"

    def records(self):
        return Scanner(root=self.root, cache_file=self.cache).scan()[0]

    def cleanup(self):
        self.tmp.cleanup()


class ParserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fx = Fixture()
        cls.recs = cls.fx.records()

    @classmethod
    def tearDownClass(cls):
        cls.fx.cleanup()

    def main_rec(self):
        return next(r for r in self.recs.values() if not r["is_subagent"])

    def test_dedupes_streamed_lines_keeping_max_output(self):
        rec = self.main_rec()
        a1 = [r for r in rec["requests"] if r["key"].startswith("msg_a1")]
        self.assertEqual(len(a1), 1)
        self.assertEqual(a1[0]["out"], 400)
        self.assertEqual(len(rec["requests"]), 32)

    def test_tool_result_size_and_prompts(self):
        rec = self.main_rec()
        t1 = next(t for t in rec["tools"] if t["id"] == "t1")
        self.assertEqual(t1["chars"], 200_000)
        kinds = [p["kind"] for p in rec["prompts"]]
        self.assertEqual(kinds, ["human", "notification"])
        self.assertEqual(rec["prompts"][1]["text"], 'Agent "x" finished')

    def test_subagent_record(self):
        sub = next(r for r in self.recs.values() if r["is_subagent"])
        self.assertEqual(sub["session_id"], "s1")
        self.assertEqual(sub["agent_type"], "Explore")
        self.assertEqual(sub["prompts"][0]["kind"], "task")

    def test_reset_parsing(self):
        hit = datetime(2026, 9, 21, 14, 42, tzinfo=timezone.utc).timestamp()
        r = parse_reset("You've hit your session limit · resets 9:20pm (Europe/Stockholm)", hit)
        self.assertEqual(datetime.fromtimestamp(r, timezone.utc), datetime(2026, 9, 21, 19, 20, tzinfo=timezone.utc))
        r = parse_reset("resets 2am (Europe/Stockholm)", hit)
        self.assertEqual(datetime.fromtimestamp(r, timezone.utc), datetime(2026, 9, 22, 0, 0, tzinfo=timezone.utc))
        self.assertIsNone(parse_reset("no reset info", hit))

    def test_cache_roundtrip(self):
        s = Scanner(root=self.fx.root, cache_file=self.fx.cache)
        _, changed = s.scan()
        self.assertFalse(changed)


class AnalysisTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fx = Fixture()
        cls.a = Analysis(cls.fx.records(), now=T0 + 3600)

    @classmethod
    def tearDownClass(cls):
        cls.fx.cleanup()

    def test_pricing(self):
        c = pricing.cost_parts("claude-sonnet-5", 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000)
        self.assertAlmostEqual(c[0], 2.0)
        self.assertAlmostEqual(c[1], 2.5 + 4.0)
        self.assertAlmostEqual(c[2], 0.2)
        self.assertAlmostEqual(c[3], 10.0)
        self.assertAlmostEqual(pricing.rate_for("claude-opus-5-5").cache_read, 0.2)
        self.assertEqual(pricing.rate_for("claude-haiku-4-5-20251001").input, 1.0)

    def test_session_merges_subagent_and_reconciles_background(self):
        s = self.a.sessions["s1"]
        self.assertEqual(len(s["threads"]), 2)
        total = sum(r["cost"] for r in s["requests"])
        # after spreading the background gap, the session matches Claude Code's own total
        self.assertAlmostEqual(total, self.fx.transcript_cost * 1.1, places=6)
        self.assertGreater(s["bg_cost"], 0)
        self.assertEqual(self.a.session_title("s1"), "Game A work")

    def test_block_anchored_by_reset(self):
        b = self.a.blocks[0]
        self.assertEqual(datetime.fromtimestamp(b["start"], timezone.utc).hour, 10)
        self.assertEqual(datetime.fromtimestamp(b["end"], timezone.utc).hour, 15)
        self.assertIsNotNone(b["hit_ts"])
        self.assertEqual(self.a.calibration["source"], "calibrated")

    def test_subproject_attribution(self):
        s = self.a.sessions["s1"]
        self.assertEqual(s["sub"], "gameB")
        self.assertIn("gameA", s["subs"])

    def test_big_result_tax(self):
        kinds = {f["kind"] for f in self.a.findings}
        self.assertIn("big_result", kinds)

    def test_model_weight_fit_from_usage_reading(self):
        # an Opus-only window whose /usage reading implies Opus counts 1.5x the reference
        recs = self.fx.records()
        base = Analysis(recs, now=T0 + 3600)
        L = base.calibration["block_limit"]
        t = T0 + 8 * 3600
        opus = {"session_id": "s2", "project_dir": "-proj", "is_subagent": False, "agent_id": None,
                "agent_type": None, "agent_desc": None, "title": "opus", "slug": None, "cwd": "/x", "branch": None,
                "version": None, "first_ts": t, "last_ts": t + 60, "prompts": [], "tools": [], "compactions": [],
                "limit_hits": [], "api_errors": 0, "cost_state": None,
                "requests": [{"ts": t, "model": "claude-opus-5-5", "in": 0, "cw5": 0, "cw1": 0, "cr": 0, "out": 100_000,
                              "think": 0, "speed": None, "side": False, "text": "", "tools": [], "key": "o1|r", "i": 0}]}
        recs = dict(recs, opus=opus)
        units = 100_000
        pct = units * 1.5 / L * 100
        a = Analysis(recs, settings={"usage_readings": [{"ts": t + 30, "pct": pct}]}, now=t + 60)
        self.assertAlmostEqual(a.calibration["weights"]["opus"], 1.5, places=3)
        self.assertAlmostEqual(a.calibration["readings"][0]["predicted"], pct, places=3)
        self.assertAlmostEqual(a.current_block()["pct"], pct, places=3)

    def test_live_usage_overrides_estimate(self):
        recs = self.fx.records()
        now = T0 + 3600
        est = Analysis(recs, now=now).current_block()
        self.assertEqual(est["source"], "estimate")
        lv = live.parse({"five_hour": {"utilization": 37.0, "resets_at": iso(T0 + 4 * 3600)},
                         "seven_day": {"utilization": 12.0, "resets_at": iso(T0 + 86400)}}, now)
        a = Analysis(recs, now=now, live=lv)
        cur = a.current_block()
        self.assertEqual(cur["source"], "live")
        self.assertEqual(cur["pct"], 37.0)
        self.assertAlmostEqual(cur["remaining_s"], 3 * 3600)
        self.assertAlmostEqual(cur["block"]["units"] / cur["limit"] * 100, 37.0)
        self.assertEqual(a.weekly()["live"]["pct"], 12.0)
        # numbers for a window that has already reset are ignored
        old = live.parse({"five_hour": {"utilization": 90.0, "resets_at": iso(now - 60)}}, now)
        self.assertEqual(Analysis(recs, now=now, live=old).current_block()["source"], "estimate")
        self.assertFalse(live.parse({})["ok"])

    def test_live_cache_and_stale_fallback(self):
        calls = []

        def fake():
            calls.append(1)
            if len(calls) == 1:
                return live.parse({"five_hour": {"utilization": 50.0, "resets_at": None}})
            return {"ok": False, "error": "HTTP 500", "fetched_at": time.time()}
        lu = live.LiveUsage(fetcher=fake, ttl=60)
        self.assertTrue(lu.get()["ok"])
        lu.get()
        self.assertEqual(len(calls), 1)  # cached within the TTL
        r = lu.get(force=True)
        self.assertTrue(r["ok"] and r["stale"])  # a failure falls back to the last good value

    def test_payloads_serialize(self):
        for payload in (self.a.data_payload(), self.a.limits_payload(), self.a.insights(),
                        self.a.tools_payload(), self.a.session_detail("s1")):
            json.dumps(payload, default=str)


class ServerTests(unittest.TestCase):
    def test_api_endpoints(self):
        fx = Fixture()
        os.environ["XDG_CONFIG_HOME"] = str(Path(fx.tmp.name) / "cfg")
        os.environ["XDG_CACHE_HOME"] = str(Path(fx.tmp.name) / "cache")
        os.environ["CLAUDE_CONFIG_DIR"] = str(Path(fx.tmp.name) / "noclaude")  # never touch real credentials
        from claude_usage import server
        holder = {}
        th = threading.Thread(target=server.serve, kwargs={"port": 0, "root": fx.root,
                                                            "ready": lambda h: holder.setdefault("h", h)}, daemon=True)
        th.start()
        for _ in range(100):
            if "h" in holder:
                break
            time.sleep(0.05)
        port = holder["h"].server_address[1]
        try:
            for ep in ("ping", "data", "limits", "insights", "tools", "settings", "session/s1"):
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/{ep}") as r:
                    self.assertNotIn("error", json.loads(r.read()))
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/") as r:
                self.assertIn(b"Claude Usage", r.read())
            req = urllib.request.Request(f"http://127.0.0.1:{port}/api/settings", method="POST",
                                         data=json.dumps({"block_limit_units": 1234}).encode())
            with urllib.request.urlopen(req) as r:
                self.assertEqual(json.loads(r.read())["settings"]["block_limit_units"], 1234.0)
        finally:
            holder["h"].shutdown()
            fx.cleanup()


if __name__ == "__main__":
    unittest.main()
