# Autonomous run prompt — Animated Short (NEW_IDEAS.md N2)

Paste everything below the line as the single prompt of a fresh session
launched with full permissions (`claude --dangerously-skip-permissions` from
`/home/ben/projects`).

---

Make a finished 2–3 minute animated short film, entirely in code, in
`/home/ben/projects/animated_short/`. This is a full-autonomy test: work the
whole session without asking me anything. When a decision comes up, make the
call yourself, log it in `DECISIONS.md`, and keep going. Only touch files
inside `animated_short/`, plus `NEW_IDEAS.md` / `TODO_FIRST.md` at the end.

## Fixed creative brief (already decided — don't revisit)
- **Genre:** sci-fi with a sense of awe. Aim for big visual moments, scale and discovery.
- **Wordless:** no dialogue and no voices. Tell the story through visuals, music and sound effects. A title card and end credits are fine.
- **Visual style:** your choice. Pick whatever serves the story best and that you can execute to a polished standard. Justify it in `DECISIONS.md`.
- **Output:** `output/film.mp4`, 1920×1080, 60 fps, H.264 + AAC, 2:00–3:00 long.

## Everything else is your call
Concept, story, characters, technique and tools are up to you. The machine
has ffmpeg 6.1, Node 22, Python 3, 22 cores, 30 GB RAM and an RTX 4060. Firefox
is the default browser, and Playwright is available. Headless Chromium can be
used just as a render host if it's more reliable; check whether WebGL is really
GPU-accelerated or falling back to software. Install npm/pip packages locally
as needed. There's no Blender. Keep it code-first: no downloaded art, models,
music or sound assets. Everything must be generated procedurally or authored
in code, so the film is 100% original. Free fonts are OK.

## Required approach
1. **Story first.** Write `SCRIPT.md` with a logline, a beat sheet with timings
   and a shot list (shot #, duration, camera, what happens, sound). It needs a
   real arc: setup, a turn, a climax, a resolution. Keep the scope achievable:
   one or two settings and one or two characters or focal objects.
2. **Deterministic offline rendering.** The film must be a pure function of
   time: `render(t)`. Render frame by frame (not real-time screen capture),
   and pipe or write the frames to ffmpeg. The same inputs must give the same film.
3. **Audio is generated too.** Write a synthesized score plus sound effects,
   rendered offline to WAV (e.g. OfflineAudioContext or a Node/Python synth),
   and time them to the shot list. Music should swell with the story beats.
4. **Iterate cheaply, render final once.** Use low-res or low-fps previews and
   per-shot renders while developing. Only render the full 1080p60 once the
   film is locked (with a final fix pass after that if needed).
5. **Self-review like a director.** You can see images, so use that heavily.
   After each pass, make contact sheets (e.g. one frame every 2s via ffmpeg
   tile) and look at them. Check composition, readability, lighting, pacing,
   continuity, and glitches (z-fighting, popping, aliasing, black frames).
   Check the audio too: levels, clipping, sync with visual hits (inspect
   waveforms or spectrograms as images). Keep a running critique in
   `REVIEW.md` and fix what you find. Do at least three full review passes
   before the final render.
6. **Resume-safe.** Keep `PROGRESS.md` current (what's done, what's next, how
   to render) so a fresh session could pick up cold if this one gets cut off.

## Done when
- [ ] `output/film.mp4` exists: 1080p60, 2:00–3:00, with a sound track, and ffprobe confirms it
- [ ] There's a clear wordless story arc, and a first-time viewer can follow what happens
- [ ] At least 3 visual "wow" moments with real scale or spectacle
- [ ] Music and sound effects are synced to the picture, with no clipping and no dead silences unless intentional
- [ ] No visible rendering glitches on the final contact sheets
- [ ] Title card + end credits ("Written, directed, animated and scored by Claude")
- [ ] One command re-renders everything from scratch (documented in `README.md`)
- [ ] `SCRIPT.md`, `DECISIONS.md`, `REVIEW.md`, `PROGRESS.md`, `README.md` are all up to date

## Git
- Add `output/` and any frame/preview dirs to `.gitignore`, and don't commit
  video or frame dumps. Commit source + docs at each milestone (script done,
  first full preview, final).
- Always use `git commit --only -- <exact paths>`. Other Claude sessions may be
  sharing this repo's index.
- At the end, move N2 in `NEW_IDEAS.md` to done and add a line to the Done log
  in `TODO_FIRST.md`.

## Final report
End with an honest summary: what the film is about, runtime and render time,
what you're proud of, what's still weak (be specific and self-critical), and
what you'd do with 4 more hours. Put the path to `film.mp4` last so I can
open it.
