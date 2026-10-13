"""Local reader: the bookshelf, each guide's viewer, and an /api/ask endpoint for follow-up questions."""
import json
import re
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import llm
from .course import VOICE, source_block
from .scan import read_text

ASK_SCHEMA = {'type': 'object', 'required': ['answer', 'files'],
              'properties': {'answer': {'type': 'string', 'description': 'Markdown answer.'},
                             'files': {'type': 'array', 'items': {'type': 'string'},
                                       'description': 'Project files the answer relies on.'}}}
_guides: dict[str, dict] = {}
_qa_lock = threading.Lock()


def load(guides: Path, name: str) -> dict | None:
    f = guides / name / 'guide.json'
    if not re.fullmatch(r'[a-z0-9-]+', name) or not f.exists():
        return None
    mtime = f.stat().st_mtime
    if name not in _guides or _guides[name]['_mtime'] != mtime:
        _guides[name] = json.loads(f.read_text()) | {'_mtime': mtime}
    return _guides[name]


def changed(g) -> list[str]:
    """Files whose source differs from what the guide was built from (edited or deleted)."""
    # shortcut: files added since the build aren't noticed; a rescan would catch them but costs a full walk
    root, out = Path(g['project']['root']), []
    for path, text in g['sources'].items():
        try:
            if read_text(root / path) != text:
                out.append(path)
        except OSError:
            out.append(path)
    return out


def pick_files(g, question, focus):
    """Files to hand the model: what the reader is looking at, then the best keyword matches."""
    words = {w for w in re.findall(r'[a-z_][a-z0-9_]{2,}', question.lower())}
    scored = []
    for f in g['project']['files']:
        d = g['digests'].get(f['path'], {})
        hay = ' '.join([f['path'], d.get('purpose', ''), d.get('summary', ''),
                        ' '.join(s['name'] for s in f['symbols'])]).lower()
        score = sum(hay.count(w) for w in words) + (50 if f['path'] in focus else 0)
        if score:
            scored.append((score, f))
    scored.sort(key=lambda x: -x[0])
    return [f for _, f in scored[:12]]


def answer(g, question, focus, model):
    budget, blocks = 90000, []
    for f in pick_files(g, question, focus):
        text = g['sources'].get(f['path'])
        if text is None or budget < 3000:
            continue
        b = source_block(f, text, min(30000, budget))
        blocks.append(b)
        budget -= len(b)
    notes = '\n'.join(f"- {p}: {d['purpose']}" for p, d in g['digests'].items())
    prompt = f"""Project: {g['course']['title']}: {g['course']['tagline']}

{g['course']['overview']}

Every file, one line each:
{notes}

Relevant source (real line numbers):
{chr(10).join(blocks)}

The reader is studying this project and asks:
{question}

Answer it directly and concretely, citing files as `path:line`. If the source shown doesn't settle it, say what you'd check."""
    return llm.ask(VOICE + '\n\nYou are answering one follow-up question from the reader. A heading-free answer of a few paragraphs is ideal; use a short code excerpt only when it helps.',
                   prompt, ASK_SCHEMA, model=model, cache=None)


def serve(guides: Path, web: Path, port: int, open_guide=None, ask_model='sonnet', open_browser=True):
    class H(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(web), **kw)

        def log_message(self, *a):
            pass

        def send_json(self, obj, code=200):
            data = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = self.path.split('?')[0]
            if path == '/api/guides':
                shelf = []
                for f in sorted(guides.glob('*/guide.json'), key=lambda p: -p.stat().st_mtime):
                    g = load(guides, f.parent.name)
                    shelf.append({'slug': g['slug'], 'title': g['course']['title'], 'tagline': g['course']['tagline'],
                                  'built': g['built'], 'stats': g['project']['stats'],
                                  'chapters': len(g['course']['chapters']), 'stale': len(changed(g))})
                return self.send_json(shelf)
            m = re.fullmatch(r'/api/guide/([a-z0-9-]+)', path)
            if m:
                g = load(guides, m.group(1))
                if not g:
                    return self.send_json({'error': 'no such guide'}, 404)
                qa = guides / m.group(1) / 'qa.json'
                return self.send_json({k: v for k, v in g.items() if k != '_mtime'} |
                                      {'qa': json.loads(qa.read_text()) if qa.exists() else [], 'stale': changed(g)})
            if re.fullmatch(r'/g/[a-z0-9-]+/?', path):
                self.path = '/index.html'
            return super().do_GET()

        def do_POST(self):
            if self.path != '/api/ask':
                return self.send_json({'error': 'not found'}, 404)
            try:
                body = json.loads(self.rfile.read(min(int(self.headers.get('Content-Length', 0)), 20000)))
                g = load(guides, str(body.get('guide', '')))
                q = str(body.get('question', '')).strip()[:2000]
                focus = [str(x) for x in body.get('focus', [])][:20]
            except (ValueError, TypeError):
                return self.send_json({'error': 'bad request'}, 400)
            if not g or not q:
                return self.send_json({'error': 'need a guide and a question'}, 400)
            try:
                r = answer(g, q, focus, ask_model)
            except llm.LLMError as e:
                return self.send_json({'error': str(e)}, 502)
            entry = {'question': q, 'answer': r['answer'], 'files': r['files'], 'context': str(body.get('where', ''))[:200]}
            with _qa_lock:
                f = guides / g['slug'] / 'qa.json'
                log = json.loads(f.read_text()) if f.exists() else []
                f.write_text(json.dumps(log + [entry], indent=1))
            return self.send_json(entry)

    srv = ThreadingHTTPServer(('127.0.0.1', port), H)
    url = f'http://127.0.0.1:{port}/' + (f'g/{open_guide}/' if open_guide else '')
    print(f'Field Guide at {url}  (Ctrl+C to stop)')
    if open_browser:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
