// Link-cable netplay test: two Players (DOM stubbed out) exchange messages over a simulated
// connection with latency and jitter, playing Link Tron. Both must stay in lockstep (identical
// state fingerprints at the same frame) and the peer that is waiting on input must stall rather
// than guess.
//   node test/netlink.js [latencyMs=90] [jitterMs=40]
import fs from 'node:fs';

globalThis.document = { addEventListener() {}, removeEventListener() {}, hidden: false };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.requestAnimationFrame = () => {};
const { Player, linkDelayFor } = await import('../web/player.js');

const latency = +(process.argv[2] || 90), jitter = +(process.argv[3] || 40);
const rom = new Uint8Array(fs.readFileSync('roms/homebrew/linktron.gb'));
const canvas = () => ({
  getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }),
});
const keys = { addEventListener() {}, removeEventListener() {} };

let now = 0, seed = 1;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const wire = []; // [deliverAt, toIndex, msg]; per-direction FIFO like a WebSocket
const lastAt = [0, 0];
const delay = linkDelayFor(2 * (latency + jitter / 2)); // what the client picks from its ping
const players = [0, 1].map((side) => {
  const p = new Player({ canvas: canvas(), keyTarget: keys });
  p.running = true;
  p.startLink(rom, {
    side, delay,
    send: (msg) => {
      const at = Math.max(lastAt[1 - side], now + latency + rand() * jitter);
      lastAt[1 - side] = at;
      wire.push([at, 1 - side, structuredClone(msg)]);
    },
  });
  return p;
});
let desync = false, waits = 0;
for (const p of players) {
  p.addEventListener('linkdesync', () => { desync = true; });
  p.addEventListener('linkwait', (e) => { if (e.detail) waits++; });
}

// P1 presses START at 1 s; later both steer around (keyboard masks: bit 7 start, 0-3 R/L/U/D).
const script = [[1000, 0, 0x80], [1100, 0, 0], [4000, 0, 4], [4200, 0, 0], [4300, 1, 8], [4700, 1, 0],
  [6000, 1, 1], [6100, 1, 0], [7000, 0, 1], [7200, 0, 0]];
const STEP = 16.6; // each "browser" gets a rAF tick every ~16.6 ms (a hair faster than the GB)
for (now = 0; now < 15000; now += STEP) {
  for (const [t, who, mask] of script) if (t > now - STEP && t <= now) players[who].inputKeyboard = mask;
  wire.sort((x, y) => x[0] - y[0]);
  while (wire.length && wire[0][0] <= now) { const [, to, msg] = wire.shift(); players[to].linkReceive(msg); }
  for (const p of players) p._linkLoop(STEP + (rand() - 0.5) * 2);
}

const [a, b] = players;
const f = Math.min(a.frameCount, b.frameCount);
console.log(`frames: ${a.frameCount} / ${b.frameCount}, stalls: ${waits}, latency ${latency}+${jitter} ms, delay ${delay}`);
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed++; };
check(!desync, 'no desync reported by the periodic hash exchange');
if (delay < 15) check(f > 850, `kept full speed (${f} frames of ~896)`);
else check(f > 600, `delay is capped at 15 frames, so a link this slow runs below full speed (${f} of ~896)`);
check(Math.abs(a.frameCount - b.frameCount) <= 12, 'peers stay within a few frames of each other');
// Roll the one that's ahead back isn't possible, so run the slower one up to the same frame.
const [slow, fast] = a.frameCount < b.frameCount ? [a, b] : [b, a];
while (slow.frameCount < fast.frameCount) {
  while (wire.length) { const [, to, msg] = wire.shift(); players[to].linkReceive(msg); }
  slow._linkStep();
}
check(a.link.core.hash() === b.link.core.hash(), 'identical state at the same frame');
check(a.link.core.gbs[0].read(0xc000) === 0 && a.link.core.gbs[1].read(0xc000) === 1, 'Link Tron handshake completed (P1/P2 roles)');
process.exit(failed ? 1 : 0);
