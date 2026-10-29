"""Claude through the Claude Code CLI in headless mode, so it runs on the user's plan, not an API bill.

Every answer is cached on disk by a hash of (model, system, prompt, schema). A build that dies halfway
resumes for free, and rebuilding after a small code change only pays for the parts that changed.
"""
import hashlib
import json
import subprocess
import threading
from pathlib import Path

_lock = threading.Lock()
spent = {'usd': 0.0, 'calls': 0, 'cached': 0}


class LLMError(RuntimeError):
    pass


def ask(system: str, prompt: str, schema: dict, *, model: str, cache: Path | None, effort: str | None = None,
        retries: int = 2) -> dict:
    key = hashlib.sha256(json.dumps([model, effort, system, prompt, schema]).encode()).hexdigest()[:24]
    hit = cache / f'{key}.json' if cache else None
    if hit and hit.exists():
        with _lock:
            spent['cached'] += 1
        return json.loads(hit.read_text())
    cmd = ['claude', '-p', '--output-format', 'json', '--model', model, '--tools', '',
           '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '',
           '--system-prompt', system, '--json-schema', json.dumps(schema)]
    if effort:
        cmd += ['--effort', effort]
    last = None
    for _ in range(retries + 1):
        try:
            p = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=1200)
        except FileNotFoundError:
            raise LLMError('the `claude` CLI is not on PATH; install Claude Code and log in first')
        except subprocess.TimeoutExpired:
            last = 'timed out after 20 minutes'
            continue
        try:
            r = json.loads(p.stdout)
        except json.JSONDecodeError:
            last = (p.stderr or p.stdout or f'exit {p.returncode}').strip()[-400:]
            continue
        if r.get('is_error') or not r.get('structured_output'):
            last = str(r.get('result') or r.get('subtype') or 'no structured output')[:400]
            if 'limit' in last.lower():  # usage limit: retrying now just burns time
                break
            continue
        with _lock:
            spent['usd'] += r.get('total_cost_usd') or 0
            spent['calls'] += 1
        out = r['structured_output']
        if hit:
            hit.parent.mkdir(parents=True, exist_ok=True)
            hit.write_text(json.dumps(out))
        return out
    raise LLMError(last or 'unknown failure')
