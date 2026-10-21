# The Nowhere House

A small walkable house in the browser where the doors don't go where they should.
Built with three.js (vendored, no build step).

- **The wardrobe** in the sitting room opens onto a 40 m columned hall with a clock that keeps real time.
- **The north door** leads into a yellow hallway that loops forever. Turning back doesn't help.
  A sign counts your laps, and after four a door unlocks in the side wall, taking you to the sitting room's south door.
- **The east door** leads out into a courtyard at night. Walk through the free-standing doorframe and you come
  out of a 21 cm doorframe on the sitting-room table, 1/10 your size. Walk back through it to grow again.
  From behind, the frame is just a frame.

Run: `./serve.sh` → http://localhost:8091 (or "The Nowhere House" in the Projects app folder).
Controls: WASD/arrows to walk, drag to look, Shift to hurry. Drag-look avoids pointer lock, so Firefox works too.

## How it works

- Every area lives in one scene, far apart. A portal is a plane mesh linked to a partner, and `portal.js` holds the math
  (crossing test, and teleporting position, facing and scale through a pair). `node test/portal.test.mjs` tests it.
- Each visible portal is drawn into a render target from a virtual camera:
  `dest · rotY(π) · src⁻¹ · camera`, with an oblique near plane on the destination doorway.
  The portal quad samples that texture in screen space. Views nest 3 deep (that's how the hallway looks
  endless); deeper than that, portals show fog.
- Each nested render is scissored to the portal's on-screen rectangle. That took the sitting room from
  20 to 60 fps on the Intel iGPU.
- Collision is circles against 2D boxes. The table top is fenced by four thin boxes, so shrunk-you can walk on it.
