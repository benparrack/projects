"""Static pass: walk a project, pull out symbols and imports, build the dependency graph.

No LLM here. Everything in this module is deterministic and free, so it runs on every
build and the LLM passes only ever see facts this module found.
"""
import ast
import hashlib
import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

LANGS = {
    '.py': 'python', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript', '.lua': 'lua',
    '.luau': 'lua', '.go': 'go', '.rs': 'rust', '.c': 'c', '.h': 'c', '.cpp': 'cpp',
    '.cc': 'cpp', '.hpp': 'cpp', '.java': 'java', '.kt': 'kotlin', '.cs': 'csharp',
    '.rb': 'ruby', '.php': 'php', '.swift': 'swift', '.sh': 'shell', '.bash': 'shell',
    '.html': 'html', '.css': 'css', '.scss': 'css', '.sql': 'sql', '.glsl': 'glsl',
    '.frag': 'glsl', '.vert': 'glsl', '.wgsl': 'glsl', '.gd': 'gdscript', '.zig': 'zig',
    '.json': 'json', '.toml': 'toml', '.yaml': 'yaml', '.yml': 'yaml', '.md': 'markdown',
    '.vue': 'javascript', '.svelte': 'javascript',
}
# Config/docs are worth showing in the explorer but aren't "code" for LOC and graphs.
SUPPORTING = {'json', 'toml', 'yaml', 'markdown'}
SKIP_DIRS = {'.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next',
             'target', 'graphify-out', '.fieldguide', 'fieldguide-out', '.pytest_cache',
             '.mypy_cache', 'coverage', '.idea', '.vscode', 'vendor', '.playwright-mcp'}
SKIP_FILES = {'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'Cargo.lock'}
MAX_BYTES = 300_000


def list_files(root: Path) -> list[str]:
    """Project-relative paths, honouring .gitignore when the project lives in a git repo."""
    try:
        out = subprocess.run(['git', 'ls-files', '-co', '--exclude-standard', '.'], cwd=root,
                             capture_output=True, text=True, check=True).stdout
        paths = [p for p in out.splitlines() if p]
    except (subprocess.CalledProcessError, FileNotFoundError):
        paths = []
        for d, dirs, files in os.walk(root):
            dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not x.startswith('.'))
            paths += [os.path.relpath(os.path.join(d, f), root) for f in files]
    keep = []
    for p in sorted(set(paths)):
        parts = Path(p).parts
        if any(x in SKIP_DIRS for x in parts[:-1]) or parts[-1] in SKIP_FILES:
            continue
        if Path(p).suffix.lower() in LANGS and (root / p).is_file():
            keep.append(p)
    return keep


def read_text(path: Path) -> str | None:
    if path.stat().st_size > MAX_BYTES:
        return None
    data = path.read_bytes()
    if b'\0' in data[:4096]:
        return None
    text = data.decode('utf-8', errors='replace')
    lines = text.splitlines()
    if lines and max(map(len, lines)) > 2000 and len(lines) < 20:  # minified bundle
        return None
    return text


# ---------- Python ----------

def py_symbols(text: str):
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return generic_symbols(text, 'python'), [], False
    syms, imports = [], []

    def visit(node, parent=None):
        for n in ast.iter_child_nodes(node):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                kind = 'class' if isinstance(n, ast.ClassDef) else ('method' if parent else 'function')
                doc = (ast.get_docstring(n) or '').strip().split('\n')[0][:200]
                syms.append({'name': n.name, 'kind': kind, 'line': n.lineno,
                             'end': n.end_lineno, 'parent': parent, 'doc': doc})
                if isinstance(n, ast.ClassDef):
                    visit(n, n.name)
            elif isinstance(n, ast.Import):
                imports.extend((a.name, 0) for a in n.names)
            elif isinstance(n, ast.ImportFrom):
                mod = n.module or ''
                imports.append((mod, n.level))
                # `from . import x` / `from pkg import sub` may name submodules
                imports.extend([((mod + '.' if mod else '') + a.name, n.level) for a in n.names])
            elif not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                visit(n, parent)  # imports inside if/try blocks
    visit(tree)
    is_main = '__name__' in text and '__main__' in text
    return syms, imports, is_main


def resolve_py(spec, level, src: str, index: set[str]) -> str | None:
    if level:
        base = Path(src).parent
        for _ in range(level - 1):
            base = base.parent
        parts = [*base.parts, *[p for p in spec.split('.') if p]]
        candidates = ['/'.join(parts)]
    else:
        # absolute imports may be rooted at the project or any parent dir of the file
        rel = spec.replace('.', '/')
        candidates = [rel] + ['/'.join([*Path(src).parts[:i], rel])
                              for i in range(1, len(Path(src).parts))]
    for c in candidates:
        for cand in (c + '.py', c + '/__init__.py'):
            if cand in index:
                return cand
    return None


# ---------- JavaScript / TypeScript ----------

JS_IMPORT = re.compile(r'''(?:import\s[^'"]*?from\s*|import\s*\(?\s*|require\s*\(\s*|export\s[^'"]*?from\s*)['"]([^'"]+)['"]''')
JS_SYMS = [
    (re.compile(r'^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)', re.M), 'function'),
    (re.compile(r'^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)', re.M), 'class'),
    (re.compile(r'^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>', re.M), 'function'),
    (re.compile(r'^\s*(?:export\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)', re.M), 'type'),
    (re.compile(r'^(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*=', re.M), 'constant'),
]
JS_EXTS = ['', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.cjs', '/index.js', '/index.ts', '/index.mjs']


def resolve_rel(spec: str, src: str, index: set[str], exts) -> str | None:
    if spec.startswith('/'):
        base = spec.lstrip('/')
    elif spec.startswith('.'):
        base = os.path.normpath(os.path.join(os.path.dirname(src), spec))
    else:
        return None
    for e in exts:
        if (base + e) in index:
            return base + e
    return None


# ---------- everything else: regex outlines ----------

GENERIC = {
    'lua': [(r'^\s*(?:local\s+)?function\s+([\w.:]+)', 'function'),
            (r'^\s*(?:local\s+)?([\w.]+)\s*=\s*function', 'function')],
    'go': [(r'^func\s+(?:\([^)]*\)\s*)?(\w+)', 'function'), (r'^type\s+(\w+)\s+(?:struct|interface)', 'class')],
    'rust': [(r'^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)', 'function'),
             (r'^\s*(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)', 'class')],
    'c': [(r'^[A-Za-z_][\w\s\*]*?\b(\w+)\s*\([^;]*\)\s*\{?\s*$', 'function'), (r'^(?:typedef\s+)?struct\s+(\w+)', 'class')],
    'java': [(r'^\s*(?:public|private|protected)?\s*(?:abstract\s+)?(?:class|interface|enum)\s+(\w+)', 'class'),
             (r'^\s*(?:public|private|protected)\s+[\w<>\[\], ]+\s+(\w+)\s*\(', 'method')],
    'ruby': [(r'^\s*def\s+([\w.?!]+)', 'function'), (r'^\s*(?:class|module)\s+([\w:]+)', 'class')],
    'shell': [(r'^\s*(?:function\s+)?([\w-]+)\s*\(\)\s*\{', 'function')],
    'gdscript': [(r'^func\s+(\w+)', 'function'), (r'^class_name\s+(\w+)', 'class')],
    'glsl': [(r'^\s*\w+\s+(\w+)\s*\([^)]*\)\s*\{?\s*$', 'function')],
    'css': [(r'^(:root|[.#][\w-]+)\s*[{,]', 'selector')],
}
GENERIC['cpp'] = GENERIC['c'] + [(r'^\s*class\s+(\w+)', 'class')]
GENERIC['kotlin'] = [(r'^\s*(?:\w+\s+)*fun\s+(\w+)', 'function'), (r'^\s*(?:\w+\s+)*class\s+(\w+)', 'class')]
GENERIC['csharp'] = GENERIC['java']
GENERIC['swift'] = [(r'^\s*(?:\w+\s+)*func\s+(\w+)', 'function'), (r'^\s*(?:\w+\s+)*(?:class|struct|protocol)\s+(\w+)', 'class')]
GENERIC['php'] = [(r'^\s*(?:\w+\s+)*function\s+(\w+)', 'function'), (r'^\s*class\s+(\w+)', 'class')]
GENERIC['zig'] = [(r'^\s*(?:pub\s+)?fn\s+(\w+)', 'function')]
C_KEYWORDS = {'if', 'for', 'while', 'switch', 'return', 'sizeof', 'else'}


def generic_symbols(text: str, lang: str):
    syms = []
    for pat, kind in GENERIC.get(lang, []):
        for m in re.finditer(pat, text, re.M):
            name = m.group(1)
            if name in C_KEYWORDS:
                continue
            syms.append({'name': name, 'kind': kind, 'line': text.count('\n', 0, m.start()) + 1,
                         'end': None, 'parent': None, 'doc': ''})
    syms.sort(key=lambda s: s['line'])
    fill_ends(syms, text.count('\n') + 1)
    return syms


def fill_ends(syms, total):
    """Regex outlines don't know where a block ends; assume it runs until the next symbol."""
    tops = [s for s in syms if not s.get('end')]
    for a, b in zip(tops, tops[1:] + [None]):
        a['end'] = (b['line'] - 1) if b else total


def js_symbols(text: str):
    syms, seen = [], set()
    for pat, kind in JS_SYMS:
        for m in pat.finditer(text):
            line = text.count('\n', 0, m.start()) + 1
            if (m.group(1), line) in seen:
                continue
            seen.add((m.group(1), line))
            # top-level only: indented matches are nested helpers or methods-ish
            indent = len(m.group(0)) - len(m.group(0).lstrip())
            syms.append({'name': m.group(1), 'kind': kind if indent == 0 else 'inner',
                         'line': line, 'end': None, 'parent': None, 'doc': ''})
    syms = [s for s in syms if s['kind'] != 'inner'] or syms
    syms.sort(key=lambda s: s['line'])
    fill_ends(syms, text.count('\n') + 1)
    return syms


# ---------- whole project ----------

def scan(root: Path) -> dict:
    root = root.resolve()
    paths = list_files(root)
    index = set(paths)
    files = []
    for p in paths:
        lang = LANGS[Path(p).suffix.lower()]
        text = read_text(root / p)
        if text is None:
            continue
        f = {'path': p, 'lang': lang, 'loc': sum(1 for ln in text.splitlines() if ln.strip()),
             'lines': text.count('\n') + (0 if text.endswith('\n') else 1),
             'sha': hashlib.sha1(text.encode()).hexdigest()[:12],
             'symbols': [], 'imports': [], 'external': [], 'entry': False, 'supporting': lang in SUPPORTING}
        raw = []
        if lang == 'python':
            f['symbols'], specs, f['entry'] = py_symbols(text)
            for spec, level in specs:
                hit = resolve_py(spec, level, p, index)
                if hit and hit != p:
                    raw.append(hit)
                elif not level and spec and not hit and spec.split('.')[0] not in sys.stdlib_module_names:
                    f['external'].append(spec.split('.')[0])
        elif lang in ('javascript', 'typescript'):
            f['symbols'] = js_symbols(text)
            for spec in JS_IMPORT.findall(text):
                hit = resolve_rel(spec, p, index, JS_EXTS)
                if hit:
                    raw.append(hit)
                elif not spec.startswith(('.', '/')):
                    f['external'].append(spec.split('/')[0] if not spec.startswith('@') else '/'.join(spec.split('/')[:2]))
        elif lang == 'html':
            for spec in re.findall(r'''(?:src|href)\s*=\s*["']([^"'#?]+)''', text):
                if not re.match(r'^[a-z]+:|^//', spec):
                    hit = resolve_rel(spec if spec.startswith(('.', '/')) else './' + spec, p, index, [''])
                    if hit:
                        raw.append(hit)
                    elif spec.startswith('/'):  # site-root paths: try relative to the html file's dir
                        hit = resolve_rel('.' + spec, p, index, [''])
                        if hit:
                            raw.append(hit)
            f['entry'] = Path(p).name == 'index.html'
        elif lang == 'lua':
            f['symbols'] = generic_symbols(text, lang)
            for spec in re.findall(r'''require\s*\(?\s*["']([^"']+)["']''', text):
                hit = resolve_rel('./' + spec.replace('.', '/'), p, index, ['.lua', '.luau', '/init.lua', '/init.luau'])
                raw.append(hit) if hit else None
        elif lang in ('c', 'cpp'):
            f['symbols'] = generic_symbols(text, lang)
            for spec in re.findall(r'^\s*#include\s+"([^"]+)"', text, re.M):
                hit = resolve_rel('./' + spec, p, index, [''])
                raw.append(hit) if hit else None
        elif lang == 'markdown':
            f['symbols'] = [{'name': m.group(2).strip(), 'kind': 'heading', 'line': text.count('\n', 0, m.start()) + 1,
                             'end': None, 'parent': None, 'doc': ''}
                            for m in re.finditer(r'^(#{1,3})\s+(.+)$', text, re.M)][:40]
        else:
            f['symbols'] = generic_symbols(text, lang)
        f['imports'] = sorted(set(raw) - {p})
        f['external'] = sorted(set(f['external']))
        if Path(p).stem in ('main', '__main__', 'cli', 'server', 'app') and not f['supporting']:
            f['entry'] = f['entry'] or Path(p).stem in ('__main__', 'main')
        files.append(f)

    by_path = {f['path']: f for f in files}
    for f in files:  # `from . import x` also names the empty __init__.py; that edge is noise
        f['imports'] = [t for t in f['imports'] if not (t.endswith('__init__.py') and by_path[t]['loc'] == 0)]
    for f in files:
        f['imported_by'] = []
    for f in files:
        for t in f['imports']:
            by_path[t]['imported_by'].append(f['path'])
    code = [f for f in files if not f['supporting']]
    # Nothing imports it, but it imports things: a likely way in.
    for f in code:
        if not f['imported_by'] and f['imports'] and f['lang'] != 'css':
            f['entry'] = True
    local = {part for p in paths for part in Path(p).parts[:-1]} | {Path(p).stem for p in paths}
    for f in files:
        f['external'] = [e for e in f['external'] if e not in local]
    externals = Counter(e for f in code for e in f['external'])
    langs = Counter()
    for f in code:
        langs[f['lang']] += f['loc']
    return {
        'name': root.name,
        'root': str(root),
        'files': files,
        'stats': {'files': len(code), 'loc': sum(f['loc'] for f in code), 'languages': langs.most_common(),
                  'supporting_files': len(files) - len(code)},
        'external': [{'name': k, 'uses': v} for k, v in externals.most_common(40)],
        'entries': [f['path'] for f in code if f['entry']],
        'readme': next((read_text(root / p)[:6000] for p in ('README.md', 'readme.md', 'README.rst', 'README')
                        if (root / p).is_file()), ''),
    }


def tree_text(files, limit=400) -> str:
    """Compact indented tree for prompts."""
    lines, prev = [], []
    for f in files[:limit]:
        parts = Path(f['path']).parts
        common = 0
        while common < min(len(prev), len(parts) - 1) and prev[common] == parts[common]:
            common += 1
        for i in range(common, len(parts) - 1):
            lines.append('  ' * i + parts[i] + '/')
        lines.append('  ' * (len(parts) - 1) + f"{parts[-1]}  ({f['loc']} loc)")
        prev = parts[:-1]
    if len(files) > limit:
        lines.append(f'... and {len(files) - limit} more files')
    return '\n'.join(lines)


if __name__ == '__main__':
    s = scan(Path(sys.argv[1] if len(sys.argv) > 1 else '.'))
    print(json.dumps({k: v for k, v in s.items() if k != 'files'}, indent=2))
    print(tree_text(s['files']))
