"""Parse Claude Code transcript files (~/.claude/projects/**/*.jsonl).

Each file is reduced to a compact FileRecord of plain dicts/lists, cached on
disk keyed by (mtime, size) so only new or growing files are re-parsed.

Format notes (learned from real transcripts, Claude Code 2.1.27x):
- One assistant API response is often written as several lines (one per
  content block) sharing message.id + requestId; usage is repeated and may
  grow while streaming, so we keep the line with the largest output_tokens.
- Subagent transcripts live in <session-id>/subagents/agent-<id>.jsonl, with a
  sibling .meta.json holding agentType/description.
- Rate-limit hits are synthetic assistant messages with error == "rate_limit",
  e.g. "You've hit your session limit · resets 9:20pm (Europe/Stockholm)".
- system/compact_boundary lines mark compactions (compactMetadata.preTokens).
- cost-state lines carry Claude Code's own running cost total for the session.
"""

import json
import os
import pickle
import re
from datetime import datetime, timedelta
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

CACHE_VERSION = 9
PROMPT_SNIPPET = 400
REPLY_SNIPPET = 300
TARGET_SNIPPET = 160

SEARCH_TOOLS = {"Read", "Grep", "Glob", "LS"}
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}


def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


_REMINDER_RE = re.compile(r"<system-reminder>.*?</system-reminder>", re.S)
_TAG_RE = re.compile(r"<(command-name|command-args|local-command-stdout)>(.*?)</\1>", re.S)


_SUMMARY_RE = re.compile(r"<summary>(.*?)</summary>", re.S)


def clean_prompt_text(text):
    text = _REMINDER_RE.sub("", text)
    if text.lstrip().startswith("<task-notification>"):
        m = _SUMMARY_RE.search(text)
        return " ".join((m.group(1) if m else "Background task finished").split())
    m = dict((k, v.strip()) for k, v in _TAG_RE.findall(text))
    if "command-name" in m:
        return (m["command-name"] + " " + m.get("command-args", "")).strip()
    text = re.sub(r"<[a-z-]+>|</[a-z-]+>", "", text)
    return " ".join(text.split())


def _content_text(content):
    """Text length and joined text of a tool_result / message content."""
    if isinstance(content, str):
        return content
    parts = []
    if isinstance(content, list):
        for b in content:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "text":
                parts.append(b.get("text", ""))
            elif b.get("type") == "image":
                parts.append("\x00" * 6000)  # ~1.5K tokens per image
    return "".join(parts)


def tool_target(name, inp):
    if not isinstance(inp, dict):
        return ""
    for key in ("file_path", "notebook_path"):
        if inp.get(key):
            return str(inp[key])
    if name == "Bash":
        return " ".join(str(inp.get("command", "")).split())[:TARGET_SNIPPET]
    if name == "Grep":
        return f"/{inp.get('pattern', '')}/ {inp.get('path', '') or ''}".strip()[:TARGET_SNIPPET]
    if name == "Glob":
        return f"{inp.get('pattern', '')} {inp.get('path', '') or ''}".strip()[:TARGET_SNIPPET]
    if name in ("Agent", "Task"):
        return f"{inp.get('subagent_type', '') or 'general'}: {inp.get('description', '')}"[:TARGET_SNIPPET]
    if name == "WebFetch":
        return str(inp.get("url", ""))[:TARGET_SNIPPET]
    if name == "WebSearch":
        return str(inp.get("query", ""))[:TARGET_SNIPPET]
    if name == "Skill":
        return str(inp.get("skill", ""))
    for v in inp.values():
        if isinstance(v, str) and v:
            return " ".join(v.split())[:TARGET_SNIPPET]
    return ""


_ABS_PATH_RE = re.compile(r"(/[\w.@+-]+(?:/[\w.@+-]+)+)")


def tool_paths(name, inp):
    """Filesystem paths a tool call touches (for sub-project attribution)."""
    if not isinstance(inp, dict):
        return []
    out = []
    for key in ("file_path", "notebook_path", "path"):
        v = inp.get(key)
        if isinstance(v, str) and v.startswith("/"):
            out.append(v)
    if name == "Bash":
        out.extend(_ABS_PATH_RE.findall(str(inp.get("command", ""))))
    return out


_RESET_RE = re.compile(r"resets\s+(.+?)\s*\(([^)]+)\)", re.I)


def parse_reset(text, hit_ts):
    """Resolve 'resets 9:20pm (Europe/Stockholm)' to an epoch after hit_ts."""
    m = _RESET_RE.search(text or "")
    if not m or ZoneInfo is None:
        return None
    when, tzname = m.group(1).strip(), m.group(2).strip()
    try:
        tz = ZoneInfo(tzname)
    except Exception:
        return None
    hit_local = datetime.fromtimestamp(hit_ts, tz)
    when_clean = when.replace(",", "").replace(" at ", " ").strip()
    for fmt in ("%I:%M%p", "%I%p", "%H:%M"):
        try:
            t = datetime.strptime(when_clean.upper(), fmt)
        except ValueError:
            continue
        cand = hit_local.replace(hour=t.hour, minute=t.minute, second=0, microsecond=0)
        if cand <= hit_local:
            cand += timedelta(days=1)
        return cand.timestamp()
    for fmt in ("%b %d %I:%M%p", "%b %d %I%p", "%b %d"):
        try:
            t = datetime.strptime(when_clean, fmt)
        except ValueError:
            continue
        cand = hit_local.replace(month=t.month, day=t.day, hour=t.hour, minute=t.minute,
                                 second=0, microsecond=0)
        if cand <= hit_local:
            cand = cand.replace(year=cand.year + 1)
        return cand.timestamp()
    return None


def parse_file(path):
    """Parse one transcript file into a FileRecord dict."""
    p = Path(path)
    rec = {
        "path": str(p),
        "session_id": None,
        "agent_id": None,
        "is_subagent": p.parent.name == "subagents",
        "agent_type": None,
        "agent_desc": None,
        "project_dir": None,
        "title": None,
        "slug": None,
        "cwd": None,
        "branch": None,
        "version": None,
        "first_ts": None,
        "last_ts": None,
        "requests": [],
        "prompts": [],
        "tools": [],
        "compactions": [],
        "limit_hits": [],
        "api_errors": 0,
        "cost_state": None,
    }
    if rec["is_subagent"]:
        rec["session_id"] = p.parent.parent.name
        rec["agent_id"] = p.stem.replace("agent-", "")
        rec["project_dir"] = p.parent.parent.parent.name
        meta = p.with_suffix(".meta.json")
        if meta.exists():
            try:
                m = json.loads(meta.read_text())
                rec["agent_type"] = m.get("agentType")
                rec["agent_desc"] = m.get("description")
            except (OSError, ValueError):
                pass
    else:
        rec["session_id"] = p.stem
        rec["project_dir"] = p.parent.name

    by_key = {}  # (msg id, request id) -> request dict
    tool_by_id = {}
    prompt_uuids = set()
    title = None

    try:
        fh = open(p, encoding="utf-8", errors="replace")
    except OSError:
        return rec
    with fh:
        for line in fh:
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if not isinstance(d, dict):
                continue
            t = d.get("type")
            ts = parse_ts(d.get("timestamp"))
            if ts is not None:
                if rec["first_ts"] is None or ts < rec["first_ts"]:
                    rec["first_ts"] = ts
                if rec["last_ts"] is None or ts > rec["last_ts"]:
                    rec["last_ts"] = ts
            if d.get("cwd") and not rec["cwd"]:
                rec["cwd"] = d["cwd"]
            if d.get("gitBranch") and not rec["branch"]:
                rec["branch"] = d["gitBranch"]
            if d.get("slug"):
                rec["slug"] = d["slug"]
            if d.get("version"):
                rec["version"] = d["version"]

            if t == "assistant":
                _handle_assistant(d, ts, rec, by_key, tool_by_id)
            elif t == "user":
                _handle_user(d, ts, rec, tool_by_id, prompt_uuids)
            elif t == "system" and d.get("subtype") == "compact_boundary":
                cm = d.get("compactMetadata") or {}
                rec["compactions"].append({
                    "ts": ts,
                    "trigger": cm.get("trigger"),
                    "pre": cm.get("preTokens"),
                    "post": cm.get("postTokens"),
                })
            elif t == "ai-title" and d.get("aiTitle"):
                title = d["aiTitle"]
            elif t == "cost-state":
                rec["cost_state"] = {
                    "total": d.get("totalCostUSD"),
                    "lines_added": d.get("totalLinesAdded"),
                    "lines_removed": d.get("totalLinesRemoved"),
                    "api_ms": d.get("totalAPIDuration"),
                    "tool_ms": d.get("totalToolDuration"),
                }

    rec["title"] = title
    reqs = sorted(by_key.values(), key=lambda r: r["ts"] or 0)
    for i, r in enumerate(reqs):
        r["i"] = i
    idx = {id(r): r["i"] for r in reqs}
    for tc in rec["tools"]:
        tc["req"] = idx.get(tc.pop("_req"), None)
    rec["requests"] = reqs
    rec["tools"].sort(key=lambda x: x["ts"] or 0)
    rec["prompts"].sort(key=lambda x: x["ts"] or 0)
    return rec


def _handle_assistant(d, ts, rec, by_key, tool_by_id):
    msg = d.get("message") or {}
    model = msg.get("model")
    content = msg.get("content") or []
    if model == "<synthetic>" or d.get("isApiErrorMessage"):
        text = _content_text(content)
        if d.get("error") == "rate_limit" or "limit" in text.lower() and "resets" in text.lower():
            rec["limit_hits"].append({
                "ts": ts,
                "text": text[:200],
                "reset": parse_reset(text, ts) if ts else None,
            })
        else:
            rec["api_errors"] += 1
        return
    usage = msg.get("usage")
    if not usage:
        return
    key = (msg.get("id"), d.get("requestId"))
    r = by_key.get(key)
    out_tokens = usage.get("output_tokens") or 0
    if r is None:
        cc = usage.get("cache_creation") or {}
        cw_total = usage.get("cache_creation_input_tokens") or 0
        cw1 = cc.get("ephemeral_1h_input_tokens")
        cw5 = cc.get("ephemeral_5m_input_tokens")
        if cw1 is None and cw5 is None:
            cw5, cw1 = cw_total, 0
        r = {
            "ts": ts,
            "model": model,
            "in": usage.get("input_tokens") or 0,
            "cw5": cw5 or 0,
            "cw1": cw1 or 0,
            "cr": usage.get("cache_read_input_tokens") or 0,
            "out": out_tokens,
            "think": (usage.get("output_tokens_details") or {}).get("thinking_tokens") or 0,
            "speed": usage.get("speed"),
            "side": bool(d.get("isSidechain")),
            "text": "",
            "tools": [],
            "key": f"{key[0]}|{key[1]}",
        }
        by_key[key] = r
    elif out_tokens > r["out"]:
        r["out"] = out_tokens
        r["think"] = (usage.get("output_tokens_details") or {}).get("thinking_tokens") or r["think"]
    for b in content if isinstance(content, list) else []:
        if not isinstance(b, dict):
            continue
        bt = b.get("type")
        if bt == "text" and not r["text"] and b.get("text", "").strip():
            r["text"] = " ".join(b["text"].split())[:REPLY_SNIPPET]
        elif bt == "tool_use":
            tid = b.get("id")
            if tid in tool_by_id:
                continue
            name = b.get("name") or "?"
            inp = b.get("input") or {}
            tc = {
                "ts": ts,
                "id": tid,
                "name": name,
                "target": tool_target(name, inp),
                "paths": tool_paths(name, inp)[:6],
                "chars": 0,
                "error": False,
                "_req": id(r),
            }
            if name == "Read" and isinstance(inp, dict):
                tc["ranged"] = bool(inp.get("limit") or inp.get("offset"))
            tool_by_id[tid] = tc
            rec["tools"].append(tc)
            r["tools"].append(name)


def _handle_user(d, ts, rec, tool_by_id, prompt_uuids):
    msg = d.get("message") or {}
    content = msg.get("content")
    if isinstance(content, list):
        has_result = False
        for b in content:
            if isinstance(b, dict) and b.get("type") == "tool_result":
                has_result = True
                tc = tool_by_id.get(b.get("tool_use_id"))
                if tc is not None:
                    tc["chars"] = len(_content_text(b.get("content")))
                    tc["error"] = bool(b.get("is_error"))
        if has_result:
            return
    if d.get("isMeta"):
        return
    raw = _content_text(content) if not isinstance(content, str) else content
    if not raw or not raw.strip():
        return
    origin = (d.get("origin") or {}).get("kind")
    text = clean_prompt_text(raw)
    if not text:
        return
    if raw.lstrip().startswith("<task-notification>") or origin == "task-notification":
        kind = "notification"
    elif rec["is_subagent"] and not rec["prompts"]:
        kind = "task"
    elif origin in (None, "human"):
        kind = "human"
    else:
        kind = origin
    uid = d.get("uuid")
    if uid in prompt_uuids:
        return
    prompt_uuids.add(uid)
    rec["prompts"].append({
        "ts": ts,
        "uuid": uid,
        "kind": kind,
        "text": text[:PROMPT_SNIPPET],
        "len": len(text),
    })


# --------------------------------------------------------------------------
# Incremental scan with an on-disk cache


def default_root():
    return Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude")) / "projects"


def cache_path():
    base = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return base / "claude-usage" / "parse-cache.pickle"


def list_files(root):
    root = Path(root)
    if not root.exists():
        return []
    return sorted(str(p) for p in root.glob("**/*.jsonl"))


class Scanner:
    """Keeps FileRecords fresh; re-parses only files whose mtime/size changed."""

    def __init__(self, root=None, cache_file=None, use_cache=True):
        self.root = Path(root) if root else default_root()
        self.cache_file = Path(cache_file) if cache_file else cache_path()
        self.use_cache = use_cache
        self.records = {}  # path -> (mtime, size, record)
        if use_cache:
            self._load()

    def _load(self):
        try:
            with open(self.cache_file, "rb") as f:
                data = pickle.load(f)
            if data.get("version") == CACHE_VERSION and data.get("root") == str(self.root):
                self.records = data["records"]
        except (OSError, EOFError, pickle.UnpicklingError, KeyError, AttributeError, ValueError):
            self.records = {}

    def _save(self):
        if not self.use_cache:
            return
        try:
            self.cache_file.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.cache_file.with_suffix(".tmp")
            with open(tmp, "wb") as f:
                pickle.dump({"version": CACHE_VERSION, "root": str(self.root),
                             "records": self.records}, f, protocol=pickle.HIGHEST_PROTOCOL)
            os.replace(tmp, self.cache_file)
        except OSError:
            pass

    def signature(self):
        sig = []
        for path in list_files(self.root):
            try:
                st = os.stat(path)
            except OSError:
                continue
            sig.append((path, st.st_mtime_ns, st.st_size))
        return tuple(sig)

    def scan(self, sig=None):
        """Return {path: record} and whether anything changed."""
        sig = sig if sig is not None else self.signature()
        changed = False
        seen = set()
        for path, mtime, size in sig:
            seen.add(path)
            cur = self.records.get(path)
            if cur and cur[0] == mtime and cur[1] == size:
                continue
            self.records[path] = (mtime, size, parse_file(path))
            changed = True
        for path in list(self.records):
            if path not in seen:
                del self.records[path]
                changed = True
        if changed:
            self._save()
        return {p: v[2] for p, v in self.records.items()}, changed
