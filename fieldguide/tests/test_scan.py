import json
import tempfile
import unittest
from pathlib import Path

from fieldguide.course import fix_refs, source_block
from fieldguide.scan import scan

FILES = {
    'pkg/__init__.py': '',
    'pkg/core.py': 'import json\nimport requests\nfrom .util import helper\n\nclass Engine:\n    """Runs things."""\n    def go(self):\n        return helper()\n',
    'pkg/util.py': 'def helper():\n    return 1\n',
    'pkg/__main__.py': 'from pkg import core\nif __name__ == "__main__":\n    core.Engine().go()\n',
    'web/index.html': '<script type="module" src="app.js"></script><link rel="stylesheet" href="/web/app.css">',
    'web/app.js': "import { draw } from './draw.js';\nexport function main() { draw(); }\n",
    'web/draw.js': 'export const draw = () => 1;\n',
    'web/app.css': ':root { --x: 1; }\n',
    'node_modules/junk/index.js': 'x',
    'README.md': '# Demo\n## Usage\n',
}


class ScanTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        for p, t in FILES.items():
            (root / p).parent.mkdir(parents=True, exist_ok=True)
            (root / p).write_text(t)
        cls.s = scan(root)
        cls.f = {f['path']: f for f in cls.s['files']}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_skips_vendor_dirs(self):
        self.assertNotIn('node_modules/junk/index.js', self.f)

    def test_python_imports_resolve(self):
        self.assertEqual(self.f['pkg/core.py']['imports'], ['pkg/util.py'])
        self.assertEqual(self.f['pkg/__main__.py']['imports'], ['pkg/core.py'])
        self.assertIn('pkg/core.py', self.f['pkg/util.py']['imported_by'])

    def test_externals_are_third_party_only(self):
        self.assertEqual(self.f['pkg/core.py']['external'], ['requests'])

    def test_python_symbols(self):
        syms = {(s['name'], s['kind'], s['parent']) for s in self.f['pkg/core.py']['symbols']}
        self.assertIn(('Engine', 'class', None), syms)
        self.assertIn(('go', 'method', 'Engine'), syms)

    def test_js_and_html_edges(self):
        self.assertEqual(self.f['web/app.js']['imports'], ['web/draw.js'])
        self.assertEqual(self.f['web/index.html']['imports'], ['web/app.css', 'web/app.js'])
        self.assertIn('draw', [s['name'] for s in self.f['web/draw.js']['symbols']])

    def test_entries(self):
        self.assertIn('pkg/__main__.py', self.s['entries'])
        self.assertIn('web/index.html', self.s['entries'])
        self.assertNotIn('pkg/util.py', self.s['entries'])

    def test_readme_and_supporting(self):
        self.assertTrue(self.s['readme'].startswith('# Demo'))
        self.assertTrue(self.f['README.md']['supporting'])
        self.assertEqual(self.s['stats']['files'], 8)


class GlueTest(unittest.TestCase):
    def test_source_block_numbers_and_truncates(self):
        f = {'path': 'a.py', 'lang': 'python', 'lines': 300, 'symbols': []}
        text = '\n'.join(f'x{i} = {i}' for i in range(1, 301))
        full = source_block(f, text, 10 ** 6)
        self.assertIn('   1  x1 = 1', full)
        self.assertIn(' 300  x300 = 300', full)
        cut = source_block(f, text, 500)
        self.assertIn('more lines cut', cut)
        self.assertNotIn('x300 = 300', cut)

    def test_fix_refs_repairs_paths_and_clamps(self):
        project = {'files': [{'path': 'src/a.py', 'lines': 50}, {'path': 'src/b.py', 'lines': 10}]}
        texts = {'src/a.py': '', 'src/b.py': ''}
        body = {'sections': [{'code': [{'file': 'a.py', 'start': 40, 'end': 999},
                                       {'file': 'nope.py', 'start': 1, 'end': 2}],
                              'diagram': {'nodes': [{'id': 'x'}, {'id': 'y'}], 'edges': [{'from': 'x', 'to': 'z'}]}}],
                'improvements': [{'file': './src/b.py'}],
                'quiz': [{'choices': ['a', 'b'], 'answer': 5}]}
        out = fix_refs(json.loads(json.dumps(body)), project, texts)
        self.assertEqual(out['sections'][0]['code'], [{'file': 'src/a.py', 'start': 40, 'end': 50}])
        self.assertEqual(out['sections'][0]['diagram']['edges'], [])
        self.assertEqual(out['improvements'][0]['file'], 'src/b.py')
        self.assertEqual(out['quiz'][0]['answer'], 1)

    def test_changed_spots_edits_and_deletions(self):
        from fieldguide.server import changed
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'a.py').write_text('x = 1\n')
            (root / 'b.py').write_text('y = 2\n')
            g = {'project': {'root': d}, 'sources': {'a.py': 'x = 1\n', 'b.py': 'y = 1\n', 'gone.py': ''}}
            self.assertEqual(changed(g), ['b.py', 'gone.py'])


if __name__ == '__main__':
    unittest.main()
