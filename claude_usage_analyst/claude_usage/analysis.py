"""Turn parsed FileRecords into sessions, rows, blocks, and waste findings."""

import os
import time
from collections import Counter, defaultdict
from pathlib import Path

from . import pricing

HOME = str(Path.home())
BLOCK_SECONDS = 5 * 3600
EST_CHARS_PER_TOKEN = 4.0

DEFAULTS = {
    "plan": "pro",
    "block_limit_units": None,  # None = calibrate from rate-limit hits
    "weekly_limit_units": None,
    "compact_threshold": 120_000,
    "notify": True,
}


def pretty_path(p):
    if not p:
        return "?"
    if p == HOME:
        return "~"
    if p.startswith(HOME + "/"):
        return "~/" + p[len(HOME) + 1:]
    return p


def floor10(ts):
    return ts - (ts % 600)


def req_ctx(r):
    return r["in"] + r["cw5"] + r["cw1"] + r["cr"]


class Analysis:
    """Everything the dashboard needs, computed from a {path: record} dict."""

    def __init__(self, records, settings=None, now=None):
        self.settings = dict(DEFAULTS)
        self.settings.update(settings or {})
        self.now = now or time.time()
        self.records = records
        self._dir_cache = {}
        self._build_sessions()
        self._attribute_subprojects()
        self._build_blocks()
        self._find_waste()

    # ------------------------------------------------------------------ sessions

    def _build_sessions(self):
        files = sorted(self.records.values(), key=lambda r: (r["first_ts"] or 0, r["is_subagent"]))
        seen_keys = set()
        seen_prompts = set()
        sessions = {}
        self.threads = []  # every file = one thread of requests (main or subagent)
        for rec in files:
            sid = rec["session_id"]
            s = sessions.get(sid)
            if s is None:
                s = sessions[sid] = {
                    "id": sid, "project_dir": rec["project_dir"], "cwd": None, "title": None,
                    "slug": None, "branch": None, "version": None, "first_ts": None, "last_ts": None,
                    "threads": [], "prompts": [], "compactions": [], "limit_hits": [],
                    "cost_state": None, "api_errors": 0,
                }
            if not rec["is_subagent"]:
                s["cwd"] = rec["cwd"] or s["cwd"]
                s["title"] = rec["title"] or s["title"]
                s["slug"] = rec["slug"] or s["slug"]
                s["branch"] = rec["branch"] or s["branch"]
                s["cost_state"] = rec["cost_state"] or s["cost_state"]
            s["version"] = rec["version"] or s["version"]
            if not s["cwd"]:
                s["cwd"] = rec["cwd"]
            for k, fn in (("first_ts", min), ("last_ts", max)):
                if rec[k] is not None:
                    s[k] = rec[k] if s[k] is None else fn(s[k], rec[k])
            s["api_errors"] += rec["api_errors"]
            reqs = []
            for r in rec["requests"]:
                if r["key"] in seen_keys:
                    s["dup_cost"] = s.get("dup_cost", 0.0) + sum(pricing.cost_parts(
                        r["model"], r["in"], r["cw5"], r["cw1"], r["cr"], r["out"], r["speed"]))
                    continue
                seen_keys.add(r["key"])
                r = dict(r)
                parts = pricing.cost_parts(r["model"], r["in"], r["cw5"], r["cw1"], r["cr"], r["out"], r["speed"])
                r["c_in"], r["c_cw"], r["c_cr"], r["c_out"] = parts
                r["cost"] = sum(parts)
                r["c_bg"] = 0.0
                r["ctx"] = req_ctx(r)
                w = pricing.rate_for(r["model"]).input / pricing.RATES["claude-sonnet-5"].input
                r["u_out"] = r["out"] * w
                r["u_in"] = (r["in"] + r["cw5"] + r["cw1"]) * w
                r["u_cr"] = r["cr"] * w
                r["sid"] = sid
                r["agent"] = rec["agent_id"]
                reqs.append(r)
            tools = [dict(tc) for tc in rec["tools"]]
            thread = {
                "session": sid,
                "agent_id": rec["agent_id"],
                "agent_type": rec["agent_type"],
                "agent_desc": rec["agent_desc"],
                "requests": reqs,
                "tools": tools,
                "compactions": rec["compactions"],
                "first_ts": rec["first_ts"],
            }
            # map tool call -> deduped request object (by original index)
            by_i = {r["i"]: r for r in reqs}
            for tc in tools:
                tc["_r"] = by_i.get(tc.get("req"))
            s["threads"].append(thread)
            self.threads.append(thread)
            for p in rec["prompts"]:
                if p["uuid"] in seen_prompts:
                    continue
                seen_prompts.add(p["uuid"])
                p = dict(p)
                p["agent"] = rec["agent_id"]
                s["prompts"].append(p)
            s["compactions"].extend(rec["compactions"])
            s["limit_hits"].extend(rec["limit_hits"])
        for s in sessions.values():
            s["prompts"].sort(key=lambda p: p["ts"] or 0)
            s["requests"] = sorted((r for t in s["threads"] for r in t["requests"]), key=lambda r: r["ts"] or 0)
            s["project"] = pretty_path(s["cwd"]) if s["cwd"] else s["project_dir"]
            # file-level timestamps include resume/queue bookkeeping lines; use real activity
            act = [r["ts"] for r in s["requests"] if r["ts"]] + [p["ts"] for p in s["prompts"] if p["ts"] and p["kind"] == "human"]
            if act:
                s["first_ts"], s["last_ts"] = min(act), max(act)
            self._apply_background(s)
        # drop sessions with no activity at all (e.g. empty stubs)
        self.sessions = {k: v for k, v in sessions.items() if v["requests"] or v["prompts"]}
        self.requests = sorted((r for s in self.sessions.values() for r in s["requests"]), key=lambda r: r["ts"] or 0)

    @staticmethod
    def _apply_background(s):
        """Spread untranscribed API spend across the session's requests.

        Claude Code makes calls that never reach the transcript (auto-mode
        permission classifier, title generation, Haiku side-queries). Its own
        cost-state total includes them, so the gap between that total and the
        transcript-derived cost is real usage. It's added pro rata as c_bg.
        """
        cs = (s["cost_state"] or {}).get("total")
        mine = sum(r["cost"] for r in s["requests"])
        s["bg_cost"] = 0.0
        if not cs or mine <= 0:
            return
        gap = cs - mine - s.get("dup_cost", 0.0)
        # a cost-state written before the latest requests (live session) can lag
        if gap <= 0 or gap > mine:
            return
        k = gap / mine
        for r in s["requests"]:
            r["c_bg"] = r["cost"] * k
            r["cost"] += r["c_bg"]
        s["bg_cost"] = gap

    # --------------------------------------------------------- sub-projects

    def _is_dir(self, p):
        v = self._dir_cache.get(p)
        if v is None:
            v = self._dir_cache[p] = os.path.isdir(p)
        return v

    def _sub_of(self, cwd, path):
        if not cwd or not path.startswith(cwd.rstrip("/") + "/"):
            return None
        rest = path[len(cwd.rstrip("/")) + 1:]
        first = rest.split("/", 1)[0]
        if not first or first.startswith(".") or "/" not in rest:
            return None
        if not self._is_dir(os.path.join(cwd, first)):
            return None
        return first

    def _attribute_subprojects(self):
        """Attribute each request to a sub-directory of the session cwd.

        Walks each thread in order; a request inherits the sub-project of the
        most recent tool call that touched a path under cwd (edits weigh more
        than reads when picking the session-level default).
        """
        for s in self.sessions.values():
            cwd = s["cwd"]
            votes = Counter()
            for t in s["threads"]:
                for tc in t["tools"]:
                    for p in tc["paths"]:
                        sub = self._sub_of(cwd, p)
                        if sub:
                            votes[sub] += 3 if tc["name"] in ("Edit", "Write", "MultiEdit", "NotebookEdit") else 1
            default = votes.most_common(1)[0][0] if votes else None
            s["sub_votes"] = votes
            for t in s["threads"]:
                cur = default
                tools_by_req = defaultdict(list)
                for tc in t["tools"]:
                    if tc.get("_r") is not None:
                        tools_by_req[id(tc["_r"])].append(tc)
                # a request's own tool calls decide its sub (it's where the model
                # is looking); otherwise carry the last one forward
                pending = cur
                for r in t["requests"]:
                    r["sub"] = pending
                    for tc in tools_by_req.get(id(r), ()):
                        for p in tc["paths"]:
                            sub = self._sub_of(cwd, p)
                            if sub:
                                pending = sub
                    if r["sub"] is None:
                        r["sub"] = pending
            by_sub = Counter()
            for r in s["requests"]:
                by_sub[r["sub"]] += r["cost"]
            s["sub"] = by_sub.most_common(1)[0][0] if by_sub else None
            s["subs"] = {k: v for k, v in by_sub.items() if k}

    # --------------------------------------------------------------- blocks

    def _build_blocks(self):
        hits = []
        for s in self.sessions.values():
            for h in s["limit_hits"]:
                h = dict(h, session=s["id"])
                h["weekly"] = "week" in (h["text"] or "").lower()
                hits.append(h)
        hits.sort(key=lambda h: h["ts"] or 0)
        self.limit_hits = hits
        anchors = {}
        for h in hits:
            if h["reset"] and not h["weekly"]:
                end = h["reset"]
                a = anchors.setdefault(end, {"start": end - BLOCK_SECONDS, "end": end, "hits": []})
                a["hits"].append(h)
        anchor_list = sorted(anchors.values(), key=lambda a: a["start"])

        blocks = []
        cur = None
        for r in self.requests:
            ts = r["ts"]
            if ts is None:
                continue
            a = next((a for a in anchor_list if a["start"] <= ts < a["end"]), None)
            if a is not None:
                if cur is None or cur.get("anchor") is not a:
                    cur = {"start": a["start"], "end": a["end"], "anchor": a, "reqs": []}
                    blocks.append(cur)
            elif cur is None or ts >= cur["end"] or cur.get("anchor"):
                start = floor10(ts)
                end = start + BLOCK_SECONDS
                nxt = next((a for a in anchor_list if a["start"] > start), None)
                if nxt and nxt["start"] < end:
                    end = nxt["start"]
                cur = {"start": start, "end": end, "anchor": None, "reqs": []}
                blocks.append(cur)
            cur["reqs"].append(r)

        out = []
        for i, b in enumerate(blocks):
            reqs = b["reqs"]
            hit = b["anchor"]["hits"][0] if b["anchor"] else None
            cost = sum(r["cost"] for r in reqs)
            cost_at_hit = sum(r["cost"] for r in reqs if hit and r["ts"] <= hit["ts"]) if hit else None
            first_local = reqs[0]["ts"]
            out.append({
                "i": i,
                "start": b["start"],
                "end": b["end"],
                "first": first_local,
                "last": reqs[-1]["ts"],
                "cost": cost,
                "tokens": sum(r["ctx"] + r["out"] for r in reqs),
                "output": sum(r["out"] for r in reqs),
                "requests": len(reqs),
                "sessions": sorted({r["sid"] for r in reqs}),
                "hit_ts": hit["ts"] if hit else None,
                "cost_at_hit": cost_at_hit,
                # a hit long before local activity explains the limit means
                # usage we can't see (claude.ai, another machine)
                "untracked_lead_min": round((first_local - b["start"]) / 60) if hit else None,
            })
            for r in reqs:
                r["block"] = i
        self.blocks = out
        self._calibrate()

    # Pro/Max limits aren't published in tokens. Fitting against real limit hits
    # showed API-dollar cost is a poor predictor (hits ranged $22-$87, and an
    # $80 window never hit), while output tokens plus a fraction of fresh input
    # predicts them tightly. The weights are refit whenever there are >= 2
    # usable hits.
    ALPHAS = (0.0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0)
    BETAS = (0.0, 0.0005, 0.001, 0.002, 0.004)
    DEFAULT_FIT = (0.2, 0.0)

    def _block_components(self, b, until=None):
        o = i = c = 0.0
        for r in self._block_reqs[b["i"]]:
            if until is not None and r["ts"] > until:
                break
            o += r["u_out"]
            i += r["u_in"]
            c += r["u_cr"]
        return o, i, c

    def _calibrate(self):
        self._block_reqs = defaultdict(list)
        for r in self.requests:
            if r.get("block") is not None:
                self._block_reqs[r["block"]].append(r)
        hit_blocks = [b for b in self.blocks if b["hit_ts"]]
        # hits with a long gap between the window start and local activity had
        # usage we can't see, so they only bound the limit from below
        clean = [b for b in hit_blocks if (b["untracked_lead_min"] or 0) < 30]
        comps_hit = {b["i"]: self._block_components(b, b["hit_ts"]) for b in hit_blocks}
        comps_all = {b["i"]: self._block_components(b) for b in self.blocks}
        alpha, beta = self.DEFAULT_FIT
        spread = None
        if len(clean) >= 2:
            best = None
            for a in self.ALPHAS:
                for be in self.BETAS:
                    hits = [o + a * i + be * c for o, i, c in (comps_hit[b["i"]] for b in clean)]
                    non = [o + a * i + be * c for bi, (o, i, c) in comps_all.items()
                           if not self.blocks[bi]["hit_ts"]]
                    L = max(hits)
                    sp = L / max(min(hits), 1)
                    viol = max(non, default=0) / L
                    score = sp * max(1.0, viol) ** 3
                    if best is None or score < best[0]:
                        best = (score, a, be, sp)
            _, alpha, beta, spread = best
        self.fit = (alpha, beta)

        def units(o, i, c):
            return o + alpha * i + beta * c

        for b in self.blocks:
            b["units"] = units(*comps_all[b["i"]])
            b["units_at_hit"] = units(*comps_hit[b["i"]]) if b["i"] in comps_hit else None
        for r in self.requests:
            r["units"] = units(r["u_out"], r["u_in"], r["u_cr"])
        est = max((b["units_at_hit"] for b in clean), default=None)
        if est is None and hit_blocks:
            est = max(b["units_at_hit"] for b in hit_blocks)
        user = self.settings.get("block_limit_units")
        if user:
            limit, source = float(user), "manual"
        elif est:
            limit, source = est, "calibrated"
        else:
            limit, source = None, "none"
        peak = max((b["units"] for b in self.blocks), default=0)
        self.calibration = {
            "block_limit": limit,
            "source": source,
            "estimate": est,
            "alpha": alpha,
            "beta": beta,
            "spread": spread,
            "clean_hits": len(clean),
            "samples": [{"block": b["i"], "start": b["start"], "hit_ts": b["hit_ts"],
                          "units_at_hit": b["units_at_hit"], "cost_at_hit": b["cost_at_hit"],
                          "untracked_lead_min": b["untracked_lead_min"],
                          "clean": b in clean} for b in hit_blocks],
            "peak_block": peak,
            "weekly_limit": self.settings.get("weekly_limit_units"),
        }

    def current_block(self):
        now = self.now
        if not self.blocks:
            return None
        b = self.blocks[-1]
        active = b["start"] <= now < b["end"]
        limit = self.calibration["block_limit"]
        reqs = self._block_reqs.get(b["i"], [])
        window = 30 * 60
        recent = [r for r in reqs if r["ts"] >= now - window]
        if recent and active:
            span = max(now - max(recent[0]["ts"], b["start"]), 300)
            rate = sum(r["units"] for r in recent) / span  # units/s
            rate_cost = sum(r["cost"] for r in recent) / span
        else:
            rate = rate_cost = 0.0
        remaining = max(b["end"] - now, 0) if active else 0
        projected = b["units"] + rate * remaining
        eta = None
        if active and limit and rate > 0 and b["units"] < limit:
            secs = (limit - b["units"]) / rate
            if secs < remaining:
                eta = now + secs
        per_session = defaultdict(lambda: [0.0, 0.0, 0.0])
        for r in reqs:
            ps = per_session[r["sid"]]
            ps[0] += r["units"]
            ps[1] += r["cost"]
            if r["ts"] >= now - 15 * 60:
                ps[2] += r["units"]
        timeline = []
        acc = 0.0
        for r in reqs:
            acc += r["units"]
            timeline.append([r["ts"], round(acc)])
        return {
            "block": b,
            "active": active,
            "limit": limit,
            "pct": (b["units"] / limit * 100) if limit else None,
            "rate_per_hour": rate * 3600,
            "cost_rate_per_hour": rate_cost * 3600,
            "remaining_s": remaining,
            "projected": projected,
            "projected_pct": (projected / limit * 100) if limit else None,
            "eta_limit": eta,
            "timeline": timeline,
            "sessions": [
                {"id": sid, "title": self.session_title(sid), "project": self.sessions[sid]["project"],
                 "units": v[0], "cost": v[1], "recent_units": v[2], "live": v[2] > 0}
                for sid, v in sorted(per_session.items(), key=lambda kv: -kv[1][0])
            ],
        }

    def weekly(self):
        now = self.now
        cur = [r for r in self.requests if r["ts"] and r["ts"] >= now - 7 * 86400]
        prev = [r for r in self.requests if r["ts"] and now - 14 * 86400 <= r["ts"] < now - 7 * 86400]
        lim = self.settings.get("weekly_limit_units")
        units = sum(r["units"] for r in cur)
        days = []
        for d in range(13, -1, -1):
            lo = now - (d + 1) * 86400
            hi = now - d * 86400
            days.append(sum(r["units"] for r in self.requests if r["ts"] and lo <= r["ts"] < hi))
        return {
            "units": units,
            "cost": sum(r["cost"] for r in cur),
            "prev_units": sum(r["units"] for r in prev),
            "prev_cost": sum(r["cost"] for r in prev),
            "limit": float(lim) if lim else None,
            "pct": (units / float(lim) * 100) if lim else None,
            "blocks_equiv": (units / self.calibration["block_limit"]) if self.calibration["block_limit"] else None,
            "daily_units": days,
            "weekly_hits": [h for h in self.limit_hits if h["weekly"]],
        }

    # --------------------------------------------------------------- waste

    def _find_waste(self):
        """Simulate cheaper habits per thread and record what they'd have saved."""
        T = float(self.settings.get("compact_threshold") or 120_000)
        findings = []
        for s in self.sessions.values():
            s["waste"] = 0.0
        for t in self.threads:
            reqs = t["requests"]
            if not reqs:
                continue
            s = self.sessions.get(t["session"])
            if s is None:
                continue
            findings.extend(self._thread_findings(s, t, T))
        for f in findings:
            self.sessions[f["session"]]["waste"] += f["savings"]
        self.findings = findings

    def _thread_findings(self, s, t, T):
        reqs = t["requests"]
        sid = s["id"]
        out = []
        n = len(reqs)
        base = min(r["ctx"] for r in reqs[: min(3, n)]) or 20_000
        base = max(base, 15_000)
        # what a /compact or /clear realistically leaves behind: the summary plus
        # files the model re-reads to get back up to speed (real compactions in
        # these transcripts land at ~15K post-tokens before any re-reading)
        kept = base + 30_000

        # --- 1) compaction / clear simulation --------------------------------
        offset = 0
        prev_ctx = 0
        events = []  # (index, reason, ctx_at_event)
        saved_by_event = defaultdict(float)
        prev_sub = reqs[0].get("sub")
        sub_run = 0
        for j, r in enumerate(reqs):
            ctx = r["ctx"]
            if prev_ctx and ctx < prev_ctx * 0.6:  # real compaction or /clear happened
                offset = 0
            prev_ctx = ctx
            sim = max(ctx - offset, kept if offset else base)
            if events and offset:
                saved_by_event[len(events) - 1] += (ctx - sim) * pricing.read_price_per_token(r["model"])
            remaining = n - j - 1
            sub = r.get("sub")
            switched = (not t["agent_id"]) and sub and prev_sub and sub != prev_sub and self._sustained(reqs, j, sub)
            if sub:
                prev_sub = sub
            reason = None
            if switched and sim >= 60_000 and remaining >= 10:
                reason = "switch"
            elif sim >= T and remaining >= 15:
                reason = "threshold"
            if reason and sim > kept * 1.2:
                cost_of_compaction = (sim * pricing.read_price_per_token(r["model"])
                                      + kept * pricing.write_price_per_token(r["model"])
                                      + 6_000 * pricing.rate_for(r["model"]).output * 1e-6)
                events.append({"j": j, "reason": reason, "ctx": sim, "ts": r["ts"],
                               "from": prev_sub if reason == "switch" else None, "sub": sub,
                               "overhead": cost_of_compaction if reason == "threshold" else 0.0})
                offset += sim - kept
        for k, ev in enumerate(events):
            saved = saved_by_event.get(k, 0.0) - ev["overhead"]
            if saved < 0.05:
                continue
            if ev["reason"] == "switch":
                kind = "clear_on_switch"
                detail = (f"Kept {ev['ctx']/1000:.0f}K tokens of unrelated context when work moved to "
                          f"'{ev['sub']}'; /clear there would have saved ≈${saved:.2f}.")
            else:
                kind = "compact_late"
                detail = (f"Context reached {ev['ctx']/1000:.0f}K tokens and kept growing; "
                          f"/compact there would have saved ≈${saved:.2f} in cache reads.")
            out.append({"kind": kind, "session": sid, "agent": t["agent_id"], "ts": ev["ts"],
                        "req": ev["j"], "savings": saved, "detail": detail})

        # --- 2) idle cache expiry: context rewritten after a long gap ---------
        for j in range(1, n):
            r, p = reqs[j], reqs[j - 1]
            cw = r["cw5"] + r["cw1"]
            if cw < 30_000 or r["ts"] is None or p["ts"] is None:
                continue
            gap = r["ts"] - p["ts"]
            ttl = 3600 if p["cw1"] or r["cw1"] else 300
            if gap <= ttl:
                continue
            extra = cw * (pricing.write_price_per_token(r["model"], r["cw1"] > 0)
                          - pricing.read_price_per_token(r["model"]))
            if extra < 0.03:
                continue
            out.append({"kind": "idle_rewrite", "session": sid, "agent": t["agent_id"], "ts": r["ts"],
                        "req": j, "savings": extra,
                        "detail": (f"Came back after {gap/60:.0f} min idle; the cache had expired so "
                                   f"{cw/1000:.0f}K tokens were re-written (≈${extra:.2f} extra).")})

        # --- 3) big tool results that ride along in context ------------------
        comp_ts = sorted(c["ts"] for c in t["compactions"] if c["ts"])
        pos = {id(r): j for j, r in enumerate(reqs)}
        for tc in t["tools"]:
            r = tc.get("_r")
            if r is None or id(r) not in pos:
                continue
            j = pos[id(r)]
            tok = tc["chars"] / EST_CHARS_PER_TOKEN
            # how many later requests carried it (until a compaction or a big context drop)
            carried = 0
            prev = reqs[j]["ctx"]
            nxt_comp = next((c for c in comp_ts if c > (r["ts"] or 0)), None)
            for k in range(j + 1, n):
                rk = reqs[k]
                if nxt_comp and rk["ts"] and rk["ts"] >= nxt_comp:
                    break
                if rk["ctx"] < prev * 0.6:
                    break
                prev = rk["ctx"]
                carried += 1
            tax = tok * carried * pricing.read_price_per_token(r["model"]) + tok * pricing.write_price_per_token(r["model"])
            tc["tokens"] = tok
            tc["carried"] = carried
            tc["tax"] = tax
            tc["session"] = sid
            if tok >= 8_000 and tax >= 0.05:
                # a leaner call (ranged read, head/tail, narrower grep) typically
                # keeps ~15% of the output
                savings = tax * 0.85
                what = tc["name"] + (" " + tc["target"] if tc["target"] else "")
                out.append({"kind": "big_result", "session": sid, "agent": t["agent_id"], "ts": tc["ts"],
                            "req": j, "savings": savings, "tool": tc["name"], "target": tc["target"],
                            "detail": (f"{what[:90]} returned ≈{tok/1000:.0f}K tokens, re-read on "
                                       f"{carried} later turns (≈${tax:.2f} total).")})

        # --- 4) exploration done in the main thread --------------------------
        if not t["agent_id"]:
            searches = [tc for tc in t["tools"] if tc["name"] in ("Read", "Grep", "Glob")
                        or (tc["name"] == "Bash" and tc["target"].split(" ", 1)[0] in ("cat", "grep", "find", "ls", "rg", "head", "sed"))]
            used_agents = any(tc["name"] in ("Agent", "Task") for tc in t["tools"])
            tax = sum(tc.get("tax", 0) for tc in searches)
            if len(searches) >= 40 and tax >= 0.5:
                out.append({"kind": "explore_inline", "session": sid, "agent": None, "ts": searches[0]["ts"],
                            "req": 0, "savings": tax * 0.6,
                            "detail": (f"{len(searches)} read/search calls ran in the main conversation "
                                       f"(≈${tax:.2f} in carried context){'' if used_agents else ', no subagents used'}.")})

        # --- 5) repeated full reads of the same file --------------------------
        reads = defaultdict(list)
        for tc in t["tools"]:
            if tc["name"] == "Read" and not tc.get("ranged") and tc["target"]:
                reads[tc["target"]].append(tc)
        for path, tcs in reads.items():
            if len(tcs) >= 3:
                extra = sum(tc.get("tax", 0) for tc in tcs[1:])
                if extra >= 0.05:
                    out.append({"kind": "repeat_read", "session": sid, "agent": t["agent_id"], "ts": tcs[1]["ts"],
                                "req": 0, "savings": extra * 0.7, "target": path,
                                "detail": f"Read {pretty_path(path)} in full {len(tcs)} times (≈${extra:.2f} for the repeats)."})
        return out

    @staticmethod
    def _sustained(reqs, j, sub, need=8):
        cnt = 0
        for r in reqs[j:j + need * 2]:
            if r.get("sub") == sub:
                cnt += 1
        return cnt >= need

    # --------------------------------------------------------------- output

    def session_title(self, sid):
        s = self.sessions.get(sid)
        if not s:
            return sid
        if s["title"]:
            return s["title"]
        for p in s["prompts"]:
            if p["kind"] == "human":
                return p["text"][:80]
        return s["slug"] or sid[:8]

    def session_summary(self, s):
        reqs = s["requests"]
        main = [r for r in reqs if not r["agent"]]
        cost = sum(r["cost"] for r in reqs)
        models = Counter()
        for r in reqs:
            models[r["model"]] += r["cost"]
        tools = sum(len(t["tools"]) for t in s["threads"])
        cs = s["cost_state"] or {}
        return {
            "id": s["id"],
            "title": self.session_title(s["id"]),
            "project": s["project"],
            "sub": s["sub"],
            "subs": s["subs"],
            "branch": s["branch"],
            "start": s["first_ts"],
            "end": s["last_ts"],
            "requests": len(reqs),
            "prompts": sum(1 for p in s["prompts"] if p["kind"] == "human"),
            "cost": cost,
            "c_cr": sum(r["c_cr"] for r in reqs),
            "c_cw": sum(r["c_cw"] for r in reqs),
            "c_in": sum(r["c_in"] for r in reqs),
            "c_out": sum(r["c_out"] for r in reqs),
            "c_bg": s.get("bg_cost", 0.0),
            "output": sum(r["out"] for r in reqs),
            "peak_ctx": max((r["ctx"] for r in main), default=0),
            "compactions": len(s["compactions"]),
            "subagents": sum(1 for t in s["threads"] if t["agent_id"]),
            "subagent_cost": sum(r["cost"] for r in reqs if r["agent"]),
            "models": dict(models),
            "tools": tools,
            "waste": s.get("waste", 0.0),
            "limit_hits": len(s["limit_hits"]),
            "cc_cost": cs.get("total"),
            "lines_added": cs.get("lines_added"),
            "lines_removed": cs.get("lines_removed"),
        }

    def data_payload(self):
        """Compact per-request rows; the dashboard aggregates them client-side."""
        projects, subs, models, sids = {}, {}, {}, {}

        def ix(d, k):
            if k not in d:
                d[k] = len(d)
            return d[k]

        rows = []
        for r in self.requests:
            s = self.sessions[r["sid"]]
            rows.append([
                round(r["ts"]),
                ix(sids, r["sid"]),
                ix(projects, s["project"]),
                ix(subs, r.get("sub") or ""),
                ix(models, r["model"]),
                r["in"], r["cw5"] + r["cw1"], r["cr"], r["out"],
                round(r["c_in"], 6), round(r["c_cw"], 6), round(r["c_cr"], 6), round(r["c_out"], 6),
                1 if r["agent"] else 0,
                round(r["c_bg"], 6),
            ])
        return {
            "generated": self.now,
            "columns": ["ts", "session", "project", "sub", "model", "in", "cw", "cr", "out",
                        "c_in", "c_cw", "c_cr", "c_out", "subagent", "c_bg"],
            "rows": rows,
            "projects": list(projects),
            "subs": list(subs),
            "models": list(models),
            "sessions": [self.session_summary(self.sessions[sid]) for sid in sids],
            "prompts_by_day": self._prompts_by_day(),
        }

    def _prompts_by_day(self):
        c = Counter()
        for s in self.sessions.values():
            for p in s["prompts"]:
                if p["kind"] == "human" and p["ts"]:
                    c[time.strftime("%Y-%m-%d", time.localtime(p["ts"]))] += 1
        return dict(c)

    def insights(self):
        total = sum(r["cost"] for r in self.requests)
        kinds = defaultdict(lambda: {"savings": 0.0, "count": 0, "sessions": set(), "examples": []})
        for f in self.findings:
            k = kinds[f["kind"]]
            k["savings"] += f["savings"]
            k["count"] += 1
            k["sessions"].add(f["session"])
            k["examples"].append(f)
        out = []
        for kind, k in kinds.items():
            ex = sorted(k["examples"], key=lambda f: -f["savings"])[:12]
            out.append({
                "kind": kind,
                "savings": k["savings"],
                "count": k["count"],
                "sessions": len(k["sessions"]),
                "examples": [dict(f, title=self.session_title(f["session"])) for f in ex],
                **ADVICE.get(kind, {"title": kind, "advice": ""}),
            })
        out.sort(key=lambda x: -x["savings"])
        # "habits" = patterns across the whole history, not individual findings
        return {
            "total_cost": total,
            "total_savings": sum(x["savings"] for x in out),
            "recommendations": out,
            "habits": self._habits(),
        }

    def _habits(self):
        reqs = self.requests
        total = sum(r["cost"] for r in reqs) or 1e-9
        cr = sum(r["c_cr"] for r in reqs)
        cw = sum(r["c_cw"] for r in reqs)
        out_c = sum(r["c_out"] for r in reqs)
        sub_cost = sum(r["cost"] for r in reqs if r["agent"])
        sess = [self.session_summary(s) for s in self.sessions.values()]
        sess = [s for s in sess if s["requests"]]
        big = sorted(sess, key=lambda s: -s["cost"])
        top5 = sum(s["cost"] for s in big[:5])
        long_no_compact = [s for s in sess if s["requests"] >= 200 and s["compactions"] == 0]
        human_prompts = sum(s["prompts"] for s in sess) or 1
        by_model = Counter()
        for r in reqs:
            by_model[r["model"]] += r["cost"]
        return {
            "cache_read_share": cr / total,
            "cache_write_share": cw / total,
            "output_share": out_c / total,
            "subagent_share": sub_cost / total,
            "top5_share": top5 / total,
            "cost_per_prompt": total / human_prompts,
            "requests_per_prompt": len(reqs) / human_prompts,
            "long_sessions_no_compact": len(long_no_compact),
            "sessions": len(sess),
            "models": dict(by_model),
            "compactions": sum(s["compactions"] for s in sess),
        }

    def tools_payload(self):
        by = defaultdict(lambda: {"calls": 0, "errors": 0, "tokens": 0.0, "tax": 0.0, "main": 0})
        targets = defaultdict(lambda: {"calls": 0, "tokens": 0.0, "tax": 0.0, "tool": None})
        for t in self.threads:
            for tc in t["tools"]:
                name = tc["name"]
                if name.startswith("mcp__"):
                    name = "mcp:" + name.split("__")[1]
                b = by[name]
                b["calls"] += 1
                b["errors"] += tc["error"]
                b["tokens"] += tc.get("tokens", tc["chars"] / EST_CHARS_PER_TOKEN)
                b["tax"] += tc.get("tax", 0.0)
                b["main"] += 0 if t["agent_id"] else 1
                if tc["target"] and tc["name"] in ("Read", "Bash", "Grep", "Glob", "WebFetch", "Edit", "Write"):
                    key = (tc["name"], pretty_path(tc["target"]) if tc["target"].startswith("/") else tc["target"])
                    tg = targets[key]
                    tg["calls"] += 1
                    tg["tokens"] += tc.get("tokens", 0.0)
                    tg["tax"] += tc.get("tax", 0.0)
                    tg["tool"] = tc["name"]
        tools = [dict(v, name=k) for k, v in by.items()]
        tools.sort(key=lambda x: -x["tax"])
        tlist = [dict(v, target=k[1]) for k, v in targets.items()]
        tlist.sort(key=lambda x: -x["tax"])
        return {"tools": tools, "targets": tlist[:60]}

    def session_detail(self, sid):
        s = self.sessions.get(sid)
        if not s:
            return None
        summary = self.session_summary(s)
        t0 = s["first_ts"] or 0
        reqs = []
        for r in s["requests"]:
            reqs.append({
                "ts": r["ts"], "agent": r["agent"], "model": r["model"], "ctx": r["ctx"],
                "in": r["in"], "cw": r["cw5"] + r["cw1"], "cr": r["cr"], "out": r["out"],
                "think": r["think"], "cost": r["cost"], "tools": r["tools"], "text": r["text"],
                "sub": r.get("sub"), "block": r.get("block"),
            })
        tools = []
        for t in s["threads"]:
            for tc in t["tools"]:
                tools.append({
                    "ts": tc["ts"], "name": tc["name"], "target": tc["target"], "agent": t["agent_id"],
                    "tokens": tc.get("tokens", tc["chars"] / EST_CHARS_PER_TOKEN),
                    "carried": tc.get("carried", 0), "tax": tc.get("tax", 0.0), "error": tc["error"],
                })
        tools.sort(key=lambda x: x["ts"] or 0)
        agents = []
        for t in s["threads"]:
            if t["agent_id"]:
                agents.append({
                    "id": t["agent_id"], "type": t["agent_type"], "desc": t["agent_desc"],
                    "requests": len(t["requests"]), "cost": sum(r["cost"] for r in t["requests"]),
                    "start": t["first_ts"],
                    "peak_ctx": max((r["ctx"] for r in t["requests"]), default=0),
                })
        findings = [f for f in self.findings if f["session"] == sid]
        findings.sort(key=lambda f: -f["savings"])
        return {
            "summary": summary,
            "cwd": s["cwd"],
            "t0": t0,
            "requests": reqs,
            "prompts": [p for p in s["prompts"] if p["kind"] in ("human", "task", "notification")],
            "compactions": s["compactions"],
            "limit_hits": s["limit_hits"],
            "tools": tools,
            "agents": agents,
            "findings": findings,
            "advice": {k: v["title"] for k, v in ADVICE.items()},
        }

    def limits_payload(self):
        return {
            "calibration": self.calibration,
            "current": self.current_block(),
            "weekly": self.weekly(),
            "blocks": [dict(b, sessions=b["sessions"][:20]) for b in self.blocks[-120:]],
            "hits": self.limit_hits,
            "now": self.now,
        }


ADVICE = {
    "compact_late": {
        "title": "Compact long sessions earlier",
        "advice": ("Every turn re-reads the whole conversation from cache. Once context passes the "
                   "threshold, each extra turn costs more than the last. Run /compact at natural "
                   "checkpoints (a feature done, tests green) instead of waiting for auto-compact."),
    },
    "clear_on_switch": {
        "title": "/clear when switching sub-projects",
        "advice": ("The session moved on to a different sub-project but kept dragging the old one's "
                   "context. Start a fresh session (or /clear) when the task changes, since the old "
                   "context isn't helping."),
    },
    "big_result": {
        "title": "Trim huge tool outputs",
        "advice": ("A single large Read, command output or fetch stays in context and gets re-read on "
                   "every later turn. Read with offset/limit, pipe noisy commands through tail/head/grep, "
                   "or push the exploration into a subagent so only its summary comes back."),
    },
    "idle_rewrite": {
        "title": "Avoid resuming stale, huge contexts",
        "advice": ("The prompt cache expires after idle time, so the next message re-writes the whole "
                   "context at write price. Before stepping away from a big session, /compact it, or "
                   "start a new session when you come back."),
    },
    "explore_inline": {
        "title": "Delegate exploration to subagents",
        "advice": ("Lots of read/search calls in the main conversation pile their results into "
                   "context forever. Ask for an Explore/general-purpose subagent to do the digging; "
                   "only its short summary lands in the main thread."),
    },
    "repeat_read": {
        "title": "Stop re-reading the same big files",
        "advice": ("The same file was read in full several times. Read the relevant range, or rely on "
                   "the earlier read (the content is still in context)."),
    },
}
