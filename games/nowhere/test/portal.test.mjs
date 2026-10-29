// node test/portal.test.mjs
import assert from 'node:assert/strict';
import { Object3D, Vector3 } from '../vendor/three/three.core.js';
import { link, crossed, teleport } from '../portal.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
function portal(x, y, z, rot, s = 1, w = 1, h = 2) {
  const mesh = new Object3D(); mesh.position.set(x, y, z); mesh.rotation.y = rot; mesh.scale.setScalar(s);
  return { mesh, w, h };
}

// A door in a north wall (front faces +z) leading to one facing -z far away.
const a = portal(0, 1, 0, 0), b = portal(100, 1, -50, Math.PI);
link(a, b);
assert.ok(crossed(a, new Vector3(0, 1.6, 0.1), new Vector3(0, 1.6, -0.1)), 'walk in the front');
assert.ok(!crossed(a, new Vector3(0, 1.6, -0.1), new Vector3(0, 1.6, 0.1)), 'not from behind');
assert.ok(!crossed(a, new Vector3(2, 1.6, 0.1), new Vector3(2, 1.6, -0.1)), 'not beside it');
assert.ok(!crossed(a, new Vector3(0, 3.5, 0.1), new Vector3(0, 3.5, -0.1)), 'not over it');

const pl = { pos: new Vector3(0, 1.6, -0.1), yaw: 0, scale: 1 };
teleport(a, pl);
near(pl.pos.x, 100, 'x'); near(pl.pos.y, 1.6, 'y'); near(pl.pos.z, -50.1, 'comes out in front of b');
near(Math.cos(pl.yaw), 1, 'still walking out of b (-z)');
// Turn around and walk back through b: back where we started.
pl.yaw += Math.PI; pl.pos.z += 0.2;
assert.ok(crossed(b, new Vector3(100, 1.6, -50.1), pl.pos), 'b crossed going back');
teleport(b, pl);
near(pl.pos.x, 0, 'round trip x'); near(pl.pos.z, 0.1, 'round trip z'); near(Math.sin(pl.yaw), 0, 'round trip yaw');

// A scale portal: big frame -> frame at 1/10 size, turned 90 degrees.
const big = portal(-200, 1, 0, -Math.PI / 2), tiny = portal(3, 0.9, 3, 0, 0.1);
link(big, tiny);
const p2 = { pos: new Vector3(-199.95, 1.6, 0), yaw: -Math.PI / 2, scale: 1 }; // walking +x
assert.ok(crossed(big, new Vector3(-200.05, 1.6, 0), p2.pos), 'big frame crossed');
teleport(big, p2);
near(p2.scale, 0.1, 'shrunk'); near(p2.pos.y, 0.9 + 0.06, 'eye scaled onto the table');
near(p2.pos.z, 3.005, 'just in front of tiny');
assert.ok(!crossed(tiny, new Vector3(3, 1.6, 3.1), new Vector3(3, 1.6, 2.9)), 'full-size eye misses tiny frame');
console.log('portal tests passed');
