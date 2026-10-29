"""fieldguide: turn a codebase into a course you can read.

  fieldguide scan  <path>          free static look: size, languages, entry points, tree
  fieldguide build <path>          write the course (uses Claude through the `claude` CLI)
  fieldguide serve                 open the bookshelf of built guides in the browser
  fieldguide list                  list built guides
"""
import argparse
import json
import re
import sys
from pathlib import Path

from . import course, llm
from .scan import scan, tree_text, read_text

HOME = Path(__file__).resolve().parent.parent
GUIDES = HOME / 'guides'


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-') or 'project'


def log(msg, end=False):
    print(msg, flush=True)


def cmd_scan(a):
    p = scan(Path(a.path))
    s = p['stats']
    print(f"{p['name']}: {s['loc']:,} lines of code in {s['files']} files (+{s['supporting_files']} config/docs)")
    print('Languages: ' + ', '.join(f'{k} {v:,}' for k, v in s['languages']))
    print('Entry points: ' + (', '.join(p['entries']) or 'none found'))
    if p['external']:
        print('Packages: ' + ', '.join(e['name'] for e in p['external'][:20]))
    edges = sum(len(f['imports']) for f in p['files'])
    print(f'Import edges: {edges}\n')
    print(tree_text(p['files']))


def cmd_build(a):
    root = Path(a.path).resolve()
    if not root.is_dir():
        sys.exit(f'not a directory: {root}')
    project = scan(root)
    if not project['files']:
        sys.exit('no source files found there')
    name = slug(a.name or project['name'])
    out = GUIDES / name
    out.mkdir(parents=True, exist_ok=True)
    texts = {f['path']: read_text(root / f['path']) for f in project['files']}
    texts = {k: v for k, v in texts.items() if v is not None}
    s = project['stats']
    print(f"Field Guide: {project['name']}  ({s['loc']:,} lines, {s['files']} files)")
    cfg = {'model': a.model, 'fast_model': a.fast_model, 'effort': a.effort, 'workers': a.workers,
           'cache': HOME / '.cache' / name}
    try:
        result = course.build(project, texts, cfg, log)
    except llm.LLMError as e:
        sys.exit(f'\nStopped: {e}\nEverything finished so far is cached; run the same command again to resume.')
    guide = {'slug': name, 'project': project, 'sources': texts, **result}
    (out / 'guide.json').write_text(json.dumps(guide))
    done = sum(1 for c in result['chapters'] if c)
    print(f"\nDone in {result['seconds'] // 60}m{result['seconds'] % 60:02d}s: {done}/{len(result['chapters'])} chapters. "
          f"{llm.spent['calls']} Claude calls ({llm.spent['cached']} cached), ~${llm.spent['usd']:.2f} API-equivalent.")
    if done < len(result['chapters']) or not result['capstone']:
        print('Some parts failed; run the same command again to fill them in (finished parts are cached).')
    print(f'Read it:  fieldguide serve   →  /g/{name}/')
    if a.open:
        a.port, a.guide = 8770, name
        cmd_serve(a)


def cmd_list(a):
    for g in sorted(GUIDES.glob('*/guide.json')):
        meta = json.loads(g.read_text())
        print(f"{meta['slug']:<28} {meta['course']['title']}  ({meta['built']})")


def cmd_serve(a):
    from .server import serve
    serve(GUIDES, HOME / 'fieldguide' / 'web', a.port, getattr(a, 'guide', None), ask_model=a.ask_model,
          open_browser=not getattr(a, 'no_open', False))


def main(argv=None):
    ap = argparse.ArgumentParser(prog='fieldguide', description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('scan', help='static look at a project, no Claude calls')
    p.add_argument('path')
    p.set_defaults(fn=cmd_scan)
    p = sub.add_parser('build', help='write the course')
    p.add_argument('path')
    p.add_argument('--name', help='guide name (default: folder name)')
    p.add_argument('--model', default='opus', help='model that plans and writes chapters (default opus)')
    p.add_argument('--fast-model', default='sonnet', help='model that takes notes on each file (default sonnet)')
    p.add_argument('--effort', default=None, help='reasoning effort for the writing model (low..max)')
    p.add_argument('--workers', type=int, default=3, help='parallel Claude calls (default 3)')
    p.add_argument('--open', action='store_true', help='serve and open it when done')
    p.add_argument('--ask-model', default='sonnet')
    p.set_defaults(fn=cmd_build)
    p = sub.add_parser('serve', help='read your guides in the browser')
    p.add_argument('--port', type=int, default=8770)
    p.add_argument('--guide', help='open straight to this guide')
    p.add_argument('--ask-model', default='sonnet', help='model that answers questions (default sonnet)')
    p.add_argument('--no-open', action='store_true', help="don't open a browser")
    p.set_defaults(fn=cmd_serve)
    p = sub.add_parser('list', help='list built guides')
    p.set_defaults(fn=cmd_list)
    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == '__main__':
    main()
