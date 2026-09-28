// Headless test-ROM runner: Blargg (serial / $A000 protocol), Mooneye (Fibonacci registers on LD B,B)
// and acid2 (framebuffer diff vs reference PNG).
// Usage: node test/run-tests.js [filter-substring ...] [--verbose] [--shots=dir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameBoy } from '../src/gameboy.js';
import { DMG_PALETTES, WIDTH, HEIGHT } from '../src/ppu.js';
import { decodePNG, encodePNG, frameToRGBA } from './png.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'roms', 'test');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const shotsArg = args.find(a => a.startsWith('--shots='));
const shotsDir = shotsArg ? shotsArg.slice(8) : null;
const filters = args.filter(a => !a.startsWith('--'));

const FRAME = 70224 / 4; // M-cycles per frame

function makeGB(file, mode) {
  const gb = new GameBoy(new Uint8Array(fs.readFileSync(file)), { mode });
  gb.apu.enabledOutput = false;
  gb.ppu.shades = DMG_PALETTES.gray;
  gb.ppu.setColorCorrection(false);
  return gb;
}

function shot(gb, name) {
  if (!shotsDir) return;
  fs.mkdirSync(shotsDir, { recursive: true });
  fs.writeFileSync(path.join(shotsDir, name.replace(/[\/]/g, '_') + '.png'), encodePNG(WIDTH, HEIGHT, frameToRGBA(gb.ppu.frame)));
}

function runBlarggSerial(file, mode, maxSeconds = 60) {
  const gb = makeGB(file, mode);
  let out = '';
  gb.onSerialByte = b => { out += String.fromCharCode(b); return undefined; };
  for (let f = 0; f < maxSeconds * 60; f++) {
    gb.runCycles(FRAME);
    if (/Passed|Failed/.test(out)) break;
  }
  return { pass: /Passed/.test(out) && !/Failed/.test(out), detail: out.trim().split('\n').slice(-3).join(' | '), gb };
}

function runBlarggMem(file, mode, maxSeconds = 60) {
  const gb = makeGB(file, mode);
  const sig = () => gb.cart.ram.length >= 4 && gb.cart.ram[1] === 0xde && gb.cart.ram[2] === 0xb0 && gb.cart.ram[3] === 0x61;
  let started = false;
  for (let f = 0; f < maxSeconds * 60; f++) {
    gb.runCycles(FRAME);
    if (sig()) {
      if (gb.cart.ram[0] === 0x80) started = true;
      else if (started || f > 10) break;
    }
  }
  let text = '';
  for (let i = 4; i < gb.cart.ram.length && gb.cart.ram[i]; i++) text += String.fromCharCode(gb.cart.ram[i]);
  const code = sig() ? gb.cart.ram[0] : -1;
  return { pass: code === 0, detail: `code=${code} ${text.trim().replace(/\n/g, ' | ')}`, gb };
}

function runMooneye(file, mode, maxSeconds = 30) {
  const gb = makeGB(file, mode);
  let result = null;
  gb.cpu.breakHook = cpu => {
    if (result) return;
    const ok = cpu.b === 3 && cpu.c === 5 && cpu.d === 8 && cpu.e === 13 && cpu.h === 21 && cpu.l === 34;
    const fail = cpu.b === 0x42 && cpu.c === 0x42 && cpu.d === 0x42;
    if (ok || fail) result = ok;
  };
  for (let f = 0; f < maxSeconds * 60 && result === null; f++) gb.runCycles(FRAME);
  return { pass: result === true, detail: result === null ? 'timeout' : result ? '' : 'failed (0x42)', gb };
}

function runAcid(file, mode, ref) {
  const gb = makeGB(file, mode);
  for (let f = 0; f < 60; f++) gb.runFrame();
  // Stop at a LD B,B the ROM executes once the image is complete; 60 frames is plenty either way.
  const want = decodePNG(fs.readFileSync(ref)).rgba;
  const got = frameToRGBA(gb.ppu.frame);
  let diff = 0;
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    if (got[i * 4] !== want[i * 4] || got[i * 4 + 1] !== want[i * 4 + 1] || got[i * 4 + 2] !== want[i * 4 + 2]) diff++;
  }
  return { pass: diff === 0, detail: diff ? `${diff} pixels differ` : '', gb };
}

// ---------------- test list ----------------
const tests = [];
const add = (name, fn) => tests.push({ name, fn });
const ls = (dir, re = /\.gbc?$/) => fs.existsSync(path.join(ROOT, dir)) ? fs.readdirSync(path.join(ROOT, dir)).filter(f => re.test(f)).sort() : [];

for (const f of ls('blargg/cpu_instrs/individual')) add(`blargg/cpu_instrs/${f}`, () => runBlarggSerial(path.join(ROOT, 'blargg/cpu_instrs/individual', f), 'dmg'));
add('blargg/cpu_instrs (all, CGB)', () => runBlarggSerial(path.join(ROOT, 'blargg/cpu_instrs/cpu_instrs.gb'), 'cgb', 120));
add('blargg/instr_timing', () => runBlarggSerial(path.join(ROOT, 'blargg/instr_timing/instr_timing.gb'), 'dmg'));
for (const f of ls('blargg/mem_timing/individual')) add(`blargg/mem_timing/${f}`, () => runBlarggSerial(path.join(ROOT, 'blargg/mem_timing/individual', f), 'dmg'));
for (const f of ls('blargg/mem_timing-2/rom_singles')) add(`blargg/mem_timing-2/${f}`, () => runBlarggMem(path.join(ROOT, 'blargg/mem_timing-2/rom_singles', f), 'dmg'));
add('blargg/halt_bug', () => runBlarggMem(path.join(ROOT, 'blargg/halt_bug.gb'), 'dmg'));
add('blargg/interrupt_time (CGB)', () => runBlarggMem(path.join(ROOT, 'blargg/interrupt_time/interrupt_time.gb'), 'cgb'));
for (const f of ls('blargg/dmg_sound/rom_singles')) add(`blargg/dmg_sound/${f}`, () => runBlarggMem(path.join(ROOT, 'blargg/dmg_sound/rom_singles', f), 'dmg'));
for (const f of ls('blargg/cgb_sound/rom_singles')) add(`blargg/cgb_sound/${f}`, () => runBlarggMem(path.join(ROOT, 'blargg/cgb_sound/rom_singles', f), 'cgb'));
add('acid2/dmg-acid2', () => runAcid(path.join(ROOT, 'dmg-acid2.gb'), 'dmg', path.join(ROOT, 'dmg-acid2-ref.png')));
add('acid2/cgb-acid2', () => runAcid(path.join(ROOT, 'cgb-acid2.gbc'), 'cgb', path.join(ROOT, 'cgb-acid2-ref.png')));

// Mooneye: pick a hardware mode from the filename's model suffix; skip SGB/AGB/dmg0/mgb-only tests.
function mooneyeMode(name) {
  const m = name.match(/-([A-Za-z0-9]+)\.gb$/);
  if (!m) return 'dmg';
  const tags = m[1];
  if (/^(dmgABC|dmgABCmgb|G|dmgABCmgbS|GS)$/.test(tags)) return 'dmg';
  if (/^(cgb|cgbABCDE|C|cgbE)$/.test(tags)) return 'cgb';
  if (tags.includes('C') && /^[A-Z]+$/.test(tags)) return 'cgb';
  if (tags.includes('G') && /^[A-Z]+$/.test(tags)) return 'dmg';
  return null;
}
const MTS = fs.readdirSync(ROOT).find(d => d.startsWith('mts-'));
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else if (e.name.endsWith('.gb')) out.push(p);
  }
  return out;
}
if (MTS) {
  for (const sub of ['acceptance', 'emulator-only']) {
    for (const p of walk(path.join(ROOT, MTS, sub)).sort()) {
      const rel = path.relative(path.join(ROOT, MTS), p);
      const mode = mooneyeMode(path.basename(p));
      if (!mode) continue;
      add(`mooneye/${rel}`, () => runMooneye(p, mode));
    }
  }
}

// ---------------- run ----------------
const selected = filters.length ? tests.filter(t => filters.some(f => t.name.includes(f))) : tests;
let passed = 0;
const failed = [];
const t0 = Date.now();
for (const t of selected) {
  let r;
  try { r = t.fn(); } catch (e) { r = { pass: false, detail: 'EXCEPTION ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' ') }; }
  if (r.pass) passed++; else failed.push(t.name);
  if (verbose || !r.pass) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${t.name}${r.detail ? '  — ' + r.detail.slice(0, 200) : ''}`);
  if (r.gb) shot(r.gb, t.name);
}
const groups = {};
for (const t of selected) {
  const g = t.name.split('/').slice(0, t.name.startsWith('mooneye') ? 3 : 2).join('/').replace(/\.gbc?$/, '');
  groups[g] ??= [0, 0];
  groups[g][1]++;
  if (!failed.includes(t.name)) groups[g][0]++;
}
console.log('\n' + Object.entries(groups).map(([g, [p, n]]) => `${p === n ? '✔' : '✘'} ${g}: ${p}/${n}`).join('\n'));
console.log(`\n${passed}/${selected.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
