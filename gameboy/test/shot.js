// Headless screenshot tool: node test/shot.js <rom> <out.png> [frames] [inputs]
// inputs: comma list of "frame:button:duration", e.g. "120:start:5,200:a:5"
import fs from 'node:fs';
import { GameBoy } from '../src/gameboy.js';
import { WIDTH, HEIGHT } from '../src/ppu.js';
import { encodePNG, frameToRGBA } from './png.js';

const [rom, out, framesArg = '300', inputs = ''] = process.argv.slice(2);
const gb = new GameBoy(new Uint8Array(fs.readFileSync(rom)));
const events = inputs ? inputs.split(',').map(s => { const [f, b, d] = s.split(':'); return { f: +f, b, d: +(d || 5) }; }) : [];
const frames = +framesArg;
const t0 = performance.now();
let samples = 0;
for (let f = 0; f < frames; f++) {
  for (const e of events) {
    if (f === e.f) gb.setButton(e.b, true);
    if (f === e.f + e.d) gb.setButton(e.b, false);
  }
  gb.runFrame();
  samples += gb.apu.takeSamples().length / 2;
}
const ms = performance.now() - t0;
fs.writeFileSync(out, encodePNG(WIDTH, HEIGHT, frameToRGBA(gb.ppu.frame)));
console.log(`${gb.cart.header.title} cgb=${gb.cgb} ${frames} frames in ${ms.toFixed(0)}ms (${(frames / (ms / 1000)).toFixed(0)} fps), ${samples} audio samples, pc=${gb.cpu.pc.toString(16)}`);
