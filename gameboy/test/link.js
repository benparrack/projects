// Link-cable test: two machines on one Link, running the Link Tron homebrew.
//   node test/link.js [out.png]
// Checks the handshake picks roles, both consoles agree on the game every frame, a scripted round
// ends with the expected winner, and replaying the pair from a save state is bit-exact.
import fs from 'node:fs';
import { GameBoy } from '../src/gameboy.js';
import { Link } from '../src/link.js';
import { WIDTH, HEIGHT } from '../src/ppu.js';
import { encodePNG, frameToRGBA } from './png.js';

const ROM = 'roms/homebrew/linktron.gb';
const W = { role: 0xc000, state: 0xc003, score1: 0xc007, score2: 0xc008, p1x: 0xc00a, grid: 0xc01a }; // from linktron.sym
const out = process.argv[2];

const rom = new Uint8Array(fs.readFileSync(ROM));
const a = new GameBoy(rom.slice()), b = new GameBoy(rom.slice());
const link = new Link(a, b);
const peek = (gb, addr) => gb.read(addr);

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed++; };

// script: frame -> [machine, button, down]
const script = [
  [60, 0, 'start', 1], [66, 0, 'start', 0],   // P1 presses START on the title screen
  [158, 0, 'up', 1], [170, 0, 'up', 0],        // round starts ~152: P1 turns up towards the wall...
  [185, 1, 'up', 1], [195, 1, 'up', 0],        // ...P2 follows later, so P1 crashes first
];
function applyScript(f) {
  for (const [sf, m, btn, down] of script) if (sf === f) link.gbs[m].setButton(btn, !!down);
}

// Both consoles must hold the same game state (roles aside) once the match is running. P2 runs
// each tick a few hundred dots after P1 does, and each redraws the arena between rounds from its
// own VBlank (with the LCD off, those frames are skipped), so allow a few frames of skew.
const game = (gb) => { let s = ''; for (let i = W.state; i < W.grid + 360; i++) s += String.fromCharCode(peek(gb, i)); return s; };
const hist = [[], []];
let frame = 0, snap = null, snapFrame = 150;
for (; frame < 600; frame++) {
  if (frame === snapFrame) snap = structuredClone(link.saveState());
  applyScript(frame);
  link.runFrame();
  // null while that console is mid-redraw (LCD off between rounds)
  hist[0].push(peek(a, 0xff40) & 0x80 ? game(a) : null);
  hist[1].push(peek(b, 0xff40) & 0x80 ? game(b) : null);
}
let agree = true;
const SKEW = 3;
for (let f = 121; f < 600 - SKEW && agree; f++) {
  const near = [];
  for (let g = f - SKEW; g <= f + SKEW; g++) near.push(hist[0][g]);
  agree = hist[1][f] === null || near.includes(hist[1][f]);
}
check(peek(a, W.role) === 0 && peek(b, W.role) === 1, `handshake: roles P1=${peek(a, W.role)} P2=${peek(b, W.role)}`);
check(agree, 'both consoles agree on game state every frame');
check(peek(a, W.score2) === 1 && peek(a, W.score1) === 0, `P1 hit the wall, P2 scored (score ${peek(a, W.score1)}-${peek(a, W.score2)})`);

const endHash = link.hash();
link.loadState(snap);
for (let f = snapFrame; f < 600; f++) { applyScript(f); link.runFrame(); }
check(link.hash() === endHash, `replay from save state is bit-exact (${endHash.toString(16)})`);

if (out) {
  const rgba = [frameToRGBA(link.shown[0]), frameToRGBA(link.shown[1])];
  const pic = new Uint8Array(WIDTH * 2 * HEIGHT * 4 + HEIGHT * 4 * 8);
  const w = WIDTH * 2 + 8;
  for (let y = 0; y < HEIGHT; y++) {
    for (let m = 0; m < 2; m++) {
      pic.set(rgba[m].subarray(y * WIDTH * 4, (y + 1) * WIDTH * 4), (y * w + m * (WIDTH + 8)) * 4);
    }
  }
  fs.writeFileSync(out, encodePNG(w, HEIGHT, pic));
}
process.exit(failed ? 1 : 0);
