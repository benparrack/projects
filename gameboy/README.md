# Game Boy / Game Boy Color emulator (vanilla JS)

A cycle-stepped DMG + CGB emulator written from scratch in plain ES modules — no build
step, no dependencies. The same core runs in the browser and headless in Node (for tests).

```
node serve.js            # → http://localhost:8080/  (standalone player page)
bash roms/fetch.sh       # download test ROMs + the bundled free homebrew (gitignored)
npm test                 # Blargg / Mooneye / acid2 suites, headless (~30 s)
node test/shot.js roms/homebrew/ucity.gbc out.png 300 "200:start:5"   # headless screenshot
node test/determinism.js # keyframe + input-log replay is bit-exact (basis for spectating)
node test/link.js        # two linked consoles running Link Tron: handshake, agreement, replay
node test/netlink.js 90 40  # link netplay over a simulated laggy connection (latency, jitter ms)
bash homebrew/linktron/build.sh  # rebuild Link Tron (needs RGBDS; the built ROM is committed)
tools/sync-game-terminal.sh  # copy core + player + ROMs into ../game_terminal/public/games/gameboy/
```

## game_terminal integration

The hub's **RETRO → GAME BOY** room (`game_terminal/public/games/gameboy/client.js`,
`server/games/gameboy.js`) runs this emulator client-side. game_terminal has no build step,
so it serves a *copy* under `emu/` — edit here, then run `tools/sync-game-terminal.sh`.
Everyone plays locally; anyone playing a bundled homebrew game can be **watched** live via
lockstep replay: one gzipped save state (~8–17 KiB) and then only frame-tagged button changes.

**Link cable:** press LINK next to someone in the room; once they accept, both play
**Link Tron** (our own two-player homebrew, `homebrew/linktron/`) over an emulated cable. Each
browser emulates *both* consoles (`src/link.js`, interleaved in 32-dot slices so serial
handshakes behave like real hardware) and only button masks cross the network. Inputs apply
`delay` frames after they're pressed (sized from a ping: `linkDelayFor(rtt)`, 3–15 frames), a
peer that hasn't heard from the other yet waits instead of guessing, and state fingerprints are
compared every 120 frames to catch desyncs. A linked player whose tab is hidden stalls both.

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
| `src/link.js` | `Link` — two consoles joined by a cable, run in lockstep; byte-level serial exchange |
| `homebrew/linktron/` | Link Tron (MIT) — RGBDS source for the two-player link demo, plus the built ROM |
| `web/netstate.js` | save state ⇄ gzipped base64 string for the network |
| `test/run-tests.js` | test-ROM runner (`--verbose`, `--shots=dir`, name filters) |

## Accuracy (141 / 141 test ROMs)

Everything in the suite passes: all Blargg `cpu_instrs`, `instr_timing`, `mem_timing`,
`mem_timing-2`, `halt_bug`, `interrupt_time`, `dmg_sound`, `cgb_sound`; dmg-acid2 and cgb-acid2
pixel-exact; every Mooneye acceptance test for DMG (timing, interrupts, timer, OAM DMA, PPU,
post-boot state, serial) plus the MBC1/2/5 emulator-only tests. Headless speed is about 900 fps
(roughly 15× real time) on this machine.

Quirks the last few tests needed, for reference:
- **Post-boot state:** DIV starts at `0xABC8`, P1 reads `$CF`. The serial clock is a falling
  edge of divider bit 8, so bits align to the system counter rather than the SC write.
- **PPU:**
  - LY shows the next line one M-cycle before the line ends. During that M-cycle the LY=LYC
    flag reads 0 and OAM reads are already locked.
  - VRAM reads lock one M-cycle before mode 3. Writes are only blocked in the real modes, and
    OAM even accepts writes in mode 2's last M-cycle.
  - Line 0 after LCD-on starts at dot 0.
  - Sprites lengthen mode 3 according to the Pan Docs penalty algorithm.
  - With the LCD off, the LYC comparator holds its last result.
- **DMG wave RAM:** while channel 3 plays, the CPU only reaches wave RAM on the exact T-cycle
  of a sample fetch; otherwise reads return `$FF` and writes are dropped.

## Controls (web)

Arrows/WASD · A = X/K · B = Z/J · Start = Enter · Select = Shift/Backspace ·
hold Space = fast-forward · hold R = rewind · P/Esc = pause · F5/F8 = save/load state,
1–4 = slot. Standard-mapping gamepads work (RT fast-forward, LT rewind).

## Homebrew library (free, redistributable)

- **µCity** — Antonio Niño Díaz, GPL-3.0 — https://github.com/AntonioND/ucity
- **Libbet and the Magic Floor** — Damian Yerrick, zlib — https://github.com/pinobatch/libbet
- **Big2Small** — Matthew D. Steele, GPL-3.0 — https://github.com/mdsteele/big2small
- **Tobu Tobu Girl Deluxe** — Tangram Games, MIT code + CC-BY 4.0 assets — https://github.com/SimonLarsen/tobutobugirl-dx
- **Porklike GB** — Ben Smith (binji), MIT — https://github.com/binji/porklike.gb
- **Shock Lobster** — Dave VanEe (tbsp), zlib — https://github.com/tbsp/shock-lobster
- **Geometrix** — Antonio Niño Díaz, GPL-3.0 — https://github.com/AntonioND/geometrix
- **Adjustris** — Dave VanEe (tbsp), CC0 — https://github.com/tbsp/Adjustris
- **2048-gb** — Sanqui, zlib — https://github.com/Sanqui/2048-gb
- **Link Tron** — ours (Ben Parrack), MIT — `homebrew/linktron/`

Only free homebrew is bundled/fetched; bring your own ROM dumps for anything else.
