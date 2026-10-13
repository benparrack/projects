// Node self-check for the browser modules that are pure functions: markdown, highlighting, diagram layout.
import assert from 'node:assert/strict';
import { md, setLinker, highlight, highlightLines } from '../fieldguide/web/md.js';
import { flow, sequence, architecture, forceLayout } from '../fieldguide/web/diagrams.js';

setLinker(c => (c === 'src/app.py' ? '#/files/src/app.py' : null));
const html = md('Intro with **bold**, *it* and `src/app.py` and `other`.\n\n- one\n- two\n\n1. a\n2. b\n\n```py\nx = 1\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |');
assert.match(html, /<strong>bold<\/strong>/);
assert.match(html, /<em>it<\/em>/);
assert.match(html, /<a class="ref" href="#\/files\/src\/app.py"><code>src\/app.py<\/code><\/a>/);
assert.match(html, /<code>other<\/code>/);
assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
assert.match(html, /<ol><li>a<\/li><li>b<\/li><\/ol>/);
assert.match(html, /<table>/);
assert.ok(!md('<script>alert(1)</script>').includes('<script>'), 'escapes html');
assert.ok(!md('[x](javascript:alert(1))').includes('href'), 'drops unsafe links');

assert.match(highlight('def f(x):\n    return "s" # c', 'python'), /t-kw">def.*t-fn">f.*t-str">&quot;s&quot;.*t-com"># c/s);
const lines = highlightLines('a = """one\ntwo"""\nb = 2', 'python');
assert.equal(lines.length, 3);
for (const l of lines) assert.equal((l.match(/<span/g) || []).length, (l.match(/<\/span>/g) || []).length, 'balanced spans per line');

const nodes = ['a', 'b', 'c', 'd'].map(id => ({ id, label: id.toUpperCase() }));
const svg = flow({ title: 't', nodes, edges: [{ from: 'a', to: 'b', label: 'x' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }, { from: 'b', to: 'd' }] });
assert.match(svg, /^<svg/);
assert.equal((svg.match(/class="dg-edge"/g) || []).length, 4, 'cycle edge still drawn');
assert.ok(!/NaN/.test(svg), 'no NaN coordinates');
const seq = sequence({ title: 's', nodes: nodes.slice(0, 3), edges: [{ from: 'a', to: 'b', label: 'call' }, { from: 'b', to: 'b', label: 'self' }, { from: 'b', to: 'a', label: 'ret' }] });
assert.ok(!/NaN/.test(seq));
const arch = architecture([{ id: 'x', name: 'X', summary: 'does x', files: [], layer: 0 }, { id: 'y', name: 'Y', summary: 'does y', files: [], layer: 2 }], [{ from: 'x', to: 'y', label: 'calls' }], () => '0 files');
assert.ok(!/NaN/.test(arch));
const gn = Array.from({ length: 30 }, (_, i) => ({ id: i, r: 4 + (i % 5) * 3, group: i % 3 }));
forceLayout(gn, gn.slice(1).map((n, i) => ({ s: gn[i >> 1], t: n })));
for (const a of gn) for (const b of gn) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r, 'graph nodes do not overlap');
console.log('web ok');
