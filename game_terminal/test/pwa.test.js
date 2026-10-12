// Installable app: the manifest parses, its icons exist at their stated sizes, and index.html links it.
// Run: node test/pwa.test.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const pub = path.join(__dirname, '..', 'public');
const m = JSON.parse(fs.readFileSync(path.join(pub, 'manifest.webmanifest'), 'utf8'));
assert.strictEqual(m.display, 'standalone');
assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
for (const icon of m.icons) {
  const png = fs.readFileSync(path.join(pub, icon.src));
  const [w, h] = icon.sizes.split('x').map(Number);
  assert.deepStrictEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [w, h], icon.src);
}
const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
assert.ok(html.includes('rel="manifest" href="/manifest.webmanifest"'));
assert.ok(fs.existsSync(path.join(pub, 'sw.js')));
console.log('pwa.test: all passed');
