// Portal math, kept free of rendering so it can be tested in node.
// A portal is a w×h plane mesh whose local +Z faces the room you stand in.
// Walking into its front comes out of its partner's front.
import { Matrix4, Vector3 } from './vendor/three/three.core.js';

const FLIP = new Matrix4().makeRotationY(Math.PI);

export function link(a, b) {
  a.dest = b; b.dest = a;
  for (const p of [a, b]) {
    p.mesh.updateMatrixWorld(true);
    p.inv = p.mesh.matrixWorld.clone().invert();
    p.pos = new Vector3().setFromMatrixPosition(p.mesh.matrixWorld);
    p.n = new Vector3(0, 0, 1).transformDirection(p.mesh.matrixWorld);
  }
  for (const p of [a, b]) p.through = p.dest.mesh.matrixWorld.clone().multiply(FLIP).multiply(p.inv);
}

const _a = new Vector3(), _b = new Vector3();
// Did a step from -> to go in through the front of p?
export function crossed(p, from, to) {
  if (p.closed) return false;
  _a.copy(from).applyMatrix4(p.inv); _b.copy(to).applyMatrix4(p.inv);
  if (!(_a.z >= 0 && _b.z < 0)) return false;
  const t = _a.z / (_a.z - _b.z);
  return Math.abs(_a.x + (_b.x - _a.x) * t) < p.w / 2 && Math.abs(_a.y + (_b.y - _a.y) * t) < p.h / 2;
}

const _f = new Vector3(), _s = new Vector3();
// player: { pos: Vector3, yaw, scale }. Forward is (-sin yaw, 0, -cos yaw).
export function teleport(p, player) {
  player.pos.applyMatrix4(p.through);
  _f.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)).transformDirection(p.through);
  player.yaw = Math.atan2(-_f.x, -_f.z);
  player.scale *= _s.setFromMatrixScale(p.through).x;
}
