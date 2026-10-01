# Clip Studio

A local, single-user take on ssemble.com: it turns long videos into vertical
shorts. You paste a link or drop a file, and it:

1. downloads the video (yt-dlp) and transcribes it locally with faster-whisper,
   using word-level timestamps;
2. finds the most clip-worthy moments, giving each a score, title, hook line and
   reasons;
3. reframes each moment to 9:16 with face tracking (MediaPipe), or uses split
   screen for two speakers or a blurred-background "fit";
4. adds animated word-by-word captions (8 presets: pop, bounce, reveal, highlight
   box…) and a hook title;
5. exports 1080×1920 H.264 MP4s through ffmpeg/libass.

## Run

```bash
./run.sh            # first run creates .venv and installs requirements
# → http://localhost:5055   (PORT=xxxx ./run.sh to change)
```

You need `ffmpeg` on PATH with libass, which the Ubuntu package has. Whisper runs
on the CPU (int8). The `small` model takes about 1–3 min per 10 min of video, and
`base` is roughly 3× faster.

**Clip finder engines**
- **Local** (default): free and offline. It scores sentence windows by hook
  strength, questions, emotion words, energy, speech rate and dead air.
- **Claude**: smarter picks. Set `ANTHROPIC_API_KEY` before `./run.sh`. If the
  call fails, it falls back to Local and shows a note on the project.

## Editor

| Area | What it does |
|---|---|
| Preview | A canvas preview that mirrors the export: crop and face track, captions, hook, watermark and progress bar. Space plays and pauses, ←/→ step. |
| Trim timeline | Drag the purple handles or the whole selection. Edges snap to word boundaries. |
| Captions | Presets, font, size, words per caption, lines, position, animation, colours, outline, shadow and highlight box. |
| Transcript | Click a word to seek, shift-click to select a range, and press Del to cut it. Double-click fixes a word. Auto-removes filler words and silences. Start here / End here. |
| Layout | Auto-reframe, Fit + blur, Split or Center; zoom and nudge; 9:16, 1:1, 4:5 or 16:9. |
| Hook | Opening title over the first N seconds, in 4 styles. The AI suggests the text. |
| Extras | Progress bar, watermark, and background music (upload your own). |
| Export | Queued renders. The ⬇ Exports drawer in the top bar shows progress and downloads. |

## Layout

```
app/server.py     Flask API + static files
app/jobs.py       background queues: process (download → transcribe → find → faces) and export
app/transcribe.py faster-whisper wrapper
app/finder.py     local + Claude clip finders
app/faces.py      MediaPipe face tracks per clip (cached in data/projects/<id>/faces/)
app/edit.py       edit model, cut timeline, caption/hook layout, ASS subtitle writer
app/render.py     ffmpeg filtergraph for crop/fit/split + subtitles + music
app/static/       vanilla JS single-page app
fonts/            caption fonts (OFL, from Google Fonts)
models/           MediaPipe BlazeFace models
data/             projects, exports and music (gitignored)
```

Caption layout is computed once in Python (`edit.layout`) and used by both the
browser preview and the libass export, so the two match. libass sizes fonts by
the OS/2 win ascent + descent, which `edit._win_metrics` accounts for.

Notes:
- Pin `av<19`, because av 19 breaks faster-whisper 1.2.1.
- Reposting other people's content can break platform ToS and copyright. Stick
  to creators who run clipping programmes, or to content you have rights to.
