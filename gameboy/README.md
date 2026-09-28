# Game Boy / Game Boy Color emulator (vanilla JS)

A cycle-stepped DMG + CGB emulator written from scratch in plain ES modules — no build
step, no dependencies. The same core runs in the browser and headless in Node (for tests).

```
node serve.js            # → http://localhost:8080/  (standalone player page)
bash roms/fetch.sh       # download test ROMs + the bundled free homebrew (gitignored)
npm test                 # Blargg / Mooneye / acid2 suites, headless (~30 s)
node test/shot.js roms/homebrew/ucity.gbc out.png 300 "200:start:5"   # headless screenshot
```

## Layout

| path | what |
|---|---|
| `src/gameboy.js` | `GameBoy` — memory map, IO, OAM DMA, CGB HDMA/speed switch, serial, save states |
| `src/cpu.js` | SM83 CPU, M-cycle accurate (every access ticks the rest of the machine) |
| `src/ppu.js` | scanline renderer with per-dot mode timing, STAT IRQ line, CGB palettes/banks/priority |
| `src/apu.js` | 4 channels, frame sequencer off DIV, box-filter resampler + DC-block high-pass |
| `src/timer.js` | falling-edge DIV/TIMA model incl. write glitches and reload delay |
| `src/cart.js` | ROM-only, MBC1 (+multicart), MBC2, MBC3+RTC (wall-clock), MBC5 (+rumble); battery saves |
| `web/player.js` | UI-agnostic `Player`: rAF loop @ 59.73 Hz, AudioWorklet with rate control, keyboard/gamepad/touch, IndexedDB battery saves + 4 state slots, fast-forward, rewind, screenshot |
| `web/index.html`, `ui.js`, `style.css` | standalone page with a CSS-drawn handheld shell, homebrew library, drag-and-drop ROM loading (.gb/.gbc/.zip) |
| `test/run-tests.js` | test-ROM runner (`--verbose`, `--shots=dir`, name filters) |

## Accuracy (131 / 141 test ROMs)

Passing: all Blargg `cpu_instrs`, `instr_timing`, `mem_timing`, `mem_timing-2`, `halt_bug`,
`interrupt_time`, `cgb_sound`, most of `dmg_sound`; dmg-acid2 and cgb-acid2 pixel-exact;
Mooneye acceptance timing/interrupt/timer/OAM-DMA tests and MBC1/2/5 emulator-only tests.

Known failures: `dmg_sound` 09/12 (DMG wave-RAM access timing while playing), Mooneye
`boot_div`/`boot_hwio`/`boot_sclk_align` (exact post-boot state), and a handful of PPU
edge cases (`hblank_ly_scx_timing`, `intr_2_mode0_timing_sprites`, `lcdon_timing`,
`lcdon_write_timing`, `stat_lyc_onoff`). No commercial game depends on these to be playable
in practice. Headless speed ≈ 900 fps (~15× real time) on this machine.

## Controls (web)

Arrows/WASD · A = X/K · B = Z/J · Start = Enter · Select = Shift/Backspace ·
hold Space = fast-forward · hold R = rewind · P/Esc = pause · F5/F8 = save/load state,
1–4 = slot. Standard-mapping gamepads work (RT fast-forward, LT rewind).

## Homebrew library (free, redistributable)

- **µCity** — Antonio Niño Díaz, GPL-3.0 — https://github.com/AntonioND/ucity
- **Libbet and the Magic Floor** — Damian Yerrick, zlib — https://github.com/pinobatch/libbet
- **Big2Small** — Matthew D. Steele, GPL-3.0 — https://github.com/mdsteele/big2small

Only free homebrew is bundled/fetched; bring your own ROM dumps for anything else.
