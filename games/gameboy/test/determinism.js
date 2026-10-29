// Checks that "keyframe + input log" replay reproduces a run bit-exactly (the basis for
// spectating in game_terminal): run A with random inputs, snapshot mid-way through the network
// encoder, replay the logged inputs on a fresh GameBoy B, and compare framebuffers every frame.
//   node test/determinism.js [rom ...]
import { readFileSync, existsSync } from 'node:fs';
import { GameBoy, BUTTONS } from '../src/gameboy.js';
import { encodeState, decodeState } from '../web/netstate.js';

const roms = process.argv.slice(2);
if (!roms.length) for (const f of ['ucity.gbc', 'libbet.gb', 'big2small.gb', 'tobudx.gb', 'porklike.gb', 'shocklobster.gb', 'geometrix.gbc', 'adjustris.gb', '2048.gb']) roms.push('roms/homebrew/' + f);

function setMask(gb, prev, mask) {
  for (let i = 0; i < 8; i++) if ((prev ^ mask) & (1 << i)) gb.setButton(BUTTONS[i], (mask >> i) & 1);
}

let failed = 0;
for (const path of roms) {
  if (!existsSync(path)) { console.log(`skip ${path} (missing)`); continue; }
  const rom = new Uint8Array(readFileSync(path));
  const a = new GameBoy(rom);
  let seed = 12345, mask = 0;
  const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const KEYF = 400, END = 1600;
  let key = null, keyMask = 0;
  const log = new Map();
  const frames = [];
  for (let f = 0; f < END; f++) {
    if (f === KEYF) { key = await encodeState(a.saveState()); keyMask = mask; }
    if (rand() < 0.08) {
      const next = rand() < 0.3 ? 0 : 1 << Math.floor(rand() * 8);
      setMask(a, mask, next); mask = next;
      if (f >= KEYF) log.set(f, mask);
    }
    a.runFrame();
    if (f >= KEYF) frames.push(a.ppu.frame.slice());
  }
  const b = new GameBoy(rom);
  b.loadState(await decodeState(key));
  let m = 0;
  setMask(b, m, keyMask); m = keyMask;
  let diverged = -1;
  for (let f = KEYF; f < END; f++) {
    if (log.has(f)) { setMask(b, m, log.get(f)); m = log.get(f); }
    b.runFrame();
    const fa = frames[f - KEYF], fb = b.ppu.frame;
    let same = true;
    for (let i = 0; i < fa.length; i++) if (fa[i] !== fb[i]) { same = false; break; }
    if (!same) { diverged = f; break; }
  }
  const ok = diverged < 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${path}: keyframe ${(key.length / 1024).toFixed(1)} KiB, ${log.size} input changes` +
    (ok ? '' : `, diverged at frame ${diverged}`));
}
process.exit(failed ? 1 : 0);
